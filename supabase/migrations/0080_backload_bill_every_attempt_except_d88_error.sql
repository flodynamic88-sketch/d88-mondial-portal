-- ============================================================================
-- v_billing: bill EVERY backload attempt (not just ones flagged
-- "Charge to Mondial"), except attempts tagged "D88 Error"
-- ============================================================================
-- Bug report: "bakit isang beses lang nabibill sa mondial yung mga backload
-- na 2-3 pataas beses na backload? dapat sa bawat backload niya nabibill sya.
-- saka dapat iba pa yung bill once na naredeliver successful siya. kaya pala
-- ang baba ng billing ko" -- an invoice that gets backloaded multiple times
-- before its eventual successful redelivery should be billed once per
-- backload attempt PLUS once more for the final successful delivery. Instead
-- it was frequently billed fewer times than the number of attempts.
--
-- Root cause, confirmed live: for invoices backloaded exactly twice before a
-- successful redelivery (84 such invoices), the first (superseded) backload
-- attempt was only being billed to Mondial when its delivery_reasons row had
-- chargeable_to_mondial = true. Exactly 42 of the 84 had that flag true and
-- 42 had it false (0 were a non-BACKLOAD type) -- an even 50/50 split. For
-- the 42 with the flag false, Branch 2 of v_billing (added in 0028) never
-- fired for that attempt, so the wasted trip was never billed at all, no
-- matter how many times the invoice bounced. This is exactly the reported
-- symptom and the reason overall billing has been running low. (Separately,
-- of the 84, 20 had their backload's route plan not yet Approved and 29 had
-- their final redelivery's route plan not yet Approved -- both branches
-- require rp.approved_at is not null by design (0002/0004), so those are
-- pending normal Admin approval, not this bug, and are unaffected by this
-- migration; they'll appear in v_billing once approved, same as any other
-- invoice.)
--
-- Why chargeable_to_mondial was the wrong gate: that flag was introduced in
-- 0028 to answer a narrower question -- "was this backload Mondial's own
-- fault" -- for reporting/labeling purposes (is_mondial_fault_charge,
-- reason_label on the Billing page). It was never meant to gate whether D88
-- gets paid for the trip at all. 0029 made the actual business rule explicit
-- in its own header comment: "a backload is either nobody's fault, D88's
-- fault, or Mondial's fault" -- and D88 should not bill the client only when
-- the backload was D88's OWN error (is_d88_error = true). A backload that's
-- nobody's fault (both flags false -- e.g. store closed, weather, traffic)
-- still cost D88 a real trip and should still be billed, exactly like a
-- Mondial-fault one.
--
-- Fix: rebuild v_billing (unchanged from 0071 otherwise) with Branch 2's
-- condition relaxed from "dr.chargeable_to_mondial = true" to
-- "not dr.is_d88_error" -- every BACKLOAD attempt bills as a separate line
-- once superseded, EXCEPT attempts explicitly tagged D88 Error, preserving
-- the carve-out 0029 was built for. is_mondial_fault_charge/reason_label
-- still reflect the true chargeable_to_mondial value (unchanged column
-- selects), so the Billing page's existing "why is this billed twice"
-- explanation keeps working correctly for the Mondial-fault case -- it will
-- now just also show non-D88-error, non-Mondial-fault backload lines with
-- is_mondial_fault_charge = false, which is accurate: these are real D88
-- trips being billed on their own merit, not "Mondial's fault" charges.
--
-- Verify after applying: re-run the attempts=2 breakdown live -- the 42
-- previously-unbilled non-chargeable backload attempts (whose route plans
-- are approved and final delivery is in) should now appear in v_billing.
-- ============================================================================

drop view if exists v_mondial_billing_statements;
drop view if exists v_final_billing;
drop view if exists v_billing;

create view v_billing as
-- Normal branch: unchanged from 0071.
select
  i.id as invoice_id,
  i.document_no,
  i.category,
  i.zone,
  i.is_dc,
  i.amount,
  i.billing_statement_id,
  coalesce(c.name, i.company_name_raw) as company_name,
  i.branch_address,
  i.plan_date,
  i.posting_date,
  i.transmittal_received_date,
  i.billing_period,
  rpi.delivered_at,
  rpi.service_rate_pct,
  round(i.amount * rpi.service_rate_pct / 100.0, 2) as service_fee,
  false as is_mondial_fault_charge,
  null::text as reason_label
from invoices i
left join companies c on c.id = i.company_id
join route_plan_invoices rpi on rpi.invoice_id = i.id
join route_plan_trucks t on t.id = rpi.route_plan_truck_id
join route_plans rp on rp.id = t.route_plan_id
where rpi.delivered_at is not null
  and rp.approved_at is not null
  and i.category <> 'FLO_PRINCIPAL'

union all

-- Backload branch: every superseded backload attempt on an approved route
-- plan bills as its own line, whether or not it was Mondial's fault --
-- EXCEPT attempts tagged D88 Error (0029), which D88 eats itself. This is
-- the fix in this migration -- see header comment. is_mondial_fault_charge
-- and reason_label still reflect the real chargeable_to_mondial/label values
-- so the Billing page's existing explanation of Mondial-fault double-billing
-- keeps working; non-Mondial-fault, non-D88-error attempts now also show up
-- here (is_mondial_fault_charge = false) since they're still billable D88
-- trips, just not ones caused by Mondial.
select
  i.id as invoice_id,
  i.document_no,
  i.category,
  i.zone,
  i.is_dc,
  i.amount,
  i.billing_statement_id,
  coalesce(c.name, i.company_name_raw) as company_name,
  i.branch_address,
  i.plan_date,
  i.posting_date,
  i.transmittal_received_date,
  i.billing_period,
  rpi.superseded_at as delivered_at,
  rpi.service_rate_pct,
  round(i.amount * rpi.service_rate_pct / 100.0, 2) as service_fee,
  dr.chargeable_to_mondial as is_mondial_fault_charge,
  dr.label as reason_label
from invoices i
left join companies c on c.id = i.company_id
join route_plan_invoices rpi on rpi.invoice_id = i.id
join route_plan_trucks t on t.id = rpi.route_plan_truck_id
join route_plans rp on rp.id = t.route_plan_id
join delivery_reasons dr on dr.id = rpi.reason_id
where dr.type = 'BACKLOAD'
  and not dr.is_d88_error
  and rpi.superseded_at is not null
  and rp.approved_at is not null
  and i.category <> 'FLO_PRINCIPAL'

union all

-- Fallback branch: unchanged from 0071, except its Branch-2 exclusion clause
-- is updated to mirror the same "not dr.is_d88_error" condition above, so an
-- invoice already covered by the (now-broader) backload branch is still
-- correctly excluded from double-counting in the fallback.
select
  i.id as invoice_id,
  i.document_no,
  i.category,
  i.zone,
  i.is_dc,
  i.amount,
  i.billing_statement_id,
  coalesce(c.name, i.company_name_raw) as company_name,
  i.branch_address,
  i.plan_date,
  i.posting_date,
  i.transmittal_received_date,
  i.billing_period,
  i.actual_delivery_date::timestamptz as delivered_at,
  fr.rate_pct as service_rate_pct,
  case when fr.rate_pct is not null
    then round(i.amount * fr.rate_pct / 100.0, 2)
    else null
  end as service_fee,
  false as is_mondial_fault_charge,
  null::text as reason_label
from invoices i
left join companies c on c.id = i.company_id
left join fee_rates fr
  on fr.category = i.category
  and fr.is_dc = i.is_dc
  and (fr.zone = i.zone or (i.category = 'MERCURY_DRUG' and fr.zone is null))
where i.category <> 'FLO_PRINCIPAL'
  and i.actual_delivery_date is not null
  and not exists (
    -- already covered by the normal branch
    select 1
    from route_plan_invoices rpi_b1
    join route_plan_trucks t_b1 on t_b1.id = rpi_b1.route_plan_truck_id
    join route_plans rp_b1 on rp_b1.id = t_b1.route_plan_id
    where rpi_b1.invoice_id = i.id
      and rpi_b1.delivered_at is not null
      and rp_b1.approved_at is not null
  )
  and not exists (
    -- already covered by the backload branch
    select 1
    from route_plan_invoices rpi_b2
    join route_plan_trucks t_b2 on t_b2.id = rpi_b2.route_plan_truck_id
    join route_plans rp_b2 on rp_b2.id = t_b2.route_plan_id
    join delivery_reasons dr_b2 on dr_b2.id = rpi_b2.reason_id
    where rpi_b2.invoice_id = i.id
      and dr_b2.type = 'BACKLOAD'
      and not dr_b2.is_d88_error
      and rpi_b2.superseded_at is not null
      and rp_b2.approved_at is not null
  );

create view v_final_billing as
select b.*, mc.confirmed, mc.confirmed_at
from v_billing b
join mondial_confirmations mc on mc.invoice_id = b.invoice_id
where mc.confirmed = true;

-- ----------------------------------------------------------------------------
-- v_mondial_billing_statements (from 0070) -- recreated unchanged, since it
-- depends on v_billing and was dropped above to allow v_billing's rebuild.
-- ----------------------------------------------------------------------------
create view v_mondial_billing_statements as
select
  ms.id,
  ms.series_no,
  ms.period_start,
  ms.period_end,
  ms.generated_by,
  up.full_name as generated_by_name,
  ms.generated_at,
  count(vb.invoice_id) as line_count,
  coalesce(sum(vb.amount), 0) as total_amount,
  coalesce(sum(vb.service_fee), 0) as total_fee
from mondial_billing_statements ms
left join v_billing vb on vb.billing_statement_id = ms.id
left join user_profiles up on up.id = ms.generated_by
group by ms.id, ms.series_no, ms.period_start, ms.period_end, ms.generated_by, up.full_name, ms.generated_at
order by ms.generated_at desc;

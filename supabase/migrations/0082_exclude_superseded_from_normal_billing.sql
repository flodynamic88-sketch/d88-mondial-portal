-- ============================================================================
-- Fix: v_billing's Normal branch double-bills a superseded (corrected) row.
-- ============================================================================
-- Bug report: "CD_0100533 nadeliver ng 8/10 daw pero 8/17 tlaga sya
-- nadeliver" -- CD_0100533 was mistakenly marked delivered on 8/10
-- (route_plan_invoices.delivered_at = 8/10), then that assignment was later
-- flagged BACKLOAD and rescheduled (superseded_at = 8/13) once the mistake
-- was caught, and finally actually delivered on 8/17 via a brand-new
-- route_plan_invoices row (per migration 0010's redelivery-reschedule
-- pattern).
--
-- v_billing's Normal branch WHERE clause only ever checked
-- "rpi.delivered_at is not null" -- it never excluded rows that were
-- subsequently superseded. So the stale 8/10 row kept producing its own
-- "normal delivered" billing line (at the wrong date and, being a separate
-- line, a wrong/duplicate fee) IN ADDITION to that same row's own legitimate
-- Backload-branch line (keyed off superseded_at) and the new row's correct
-- 8/17 line. Net effect: 3 billing lines for what should only ever be 2
-- (the backload attempt + the eventual real delivery).
--
-- Confirmed live: 5 route_plan_invoices rows hit this (CD_0100533,
-- CD_0100353, CD_0100974, PSI-0066208, CD_0100843), totaling ₱11,331.55 in
-- phantom fees. None had been included in an SOA yet (billing_statement_id
-- was null on the bogus lines), but 4 of 5 had already been wrongly
-- "Confirmed" by Mondial since v_final_billing had no way to tell the
-- phantom line apart from a real one.
--
-- Fix: a row that has been superseded is by definition no longer the live
-- assignment for that invoice, so the Normal branch must exclude it --
-- exactly like the Backload branch already requires superseded_at is not
-- null for its own row. Only change from 0081: add
-- "and rpi.superseded_at is null" to the Normal branch's WHERE clause.
-- Backload and Fallback branches are unchanged.
-- ============================================================================

drop view if exists v_mondial_billing_statements;
drop view if exists v_final_billing;
drop view if exists v_billing;

create view v_billing as
-- Normal branch: same as 0081, plus "and rpi.superseded_at is null" so a
-- corrected/superseded assignment can no longer produce a phantom line here.
select
  i.id as invoice_id,
  i.document_no,
  i.category,
  i.zone,
  i.is_dc,
  i.amount,
  mbl.billing_statement_id,
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
left join mondial_billing_lines mbl
  on mbl.invoice_id = i.id and mbl.delivered_at = rpi.delivered_at
where rpi.delivered_at is not null
  and rpi.superseded_at is null
  and rp.approved_at is not null
  and i.category <> 'FLO_PRINCIPAL'

union all

-- Backload branch: unchanged from 0081.
select
  i.id as invoice_id,
  i.document_no,
  i.category,
  i.zone,
  i.is_dc,
  i.amount,
  mbl.billing_statement_id,
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
left join mondial_billing_lines mbl
  on mbl.invoice_id = i.id and mbl.delivered_at = rpi.superseded_at
where dr.type = 'BACKLOAD'
  and not dr.is_d88_error
  and rpi.superseded_at is not null
  and rp.approved_at is not null
  and i.category <> 'FLO_PRINCIPAL'

union all

-- Fallback branch: unchanged from 0081.
select
  i.id as invoice_id,
  i.document_no,
  i.category,
  i.zone,
  i.is_dc,
  i.amount,
  mbl.billing_statement_id,
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
left join mondial_billing_lines mbl
  on mbl.invoice_id = i.id and mbl.delivered_at = i.actual_delivery_date::timestamptz
where i.category <> 'FLO_PRINCIPAL'
  and i.actual_delivery_date is not null
  and not exists (
    select 1
    from route_plan_invoices rpi_b1
    join route_plan_trucks t_b1 on t_b1.id = rpi_b1.route_plan_truck_id
    join route_plans rp_b1 on rp_b1.id = t_b1.route_plan_id
    where rpi_b1.invoice_id = i.id
      and rpi_b1.delivered_at is not null
      and rpi_b1.superseded_at is null
      and rp_b1.approved_at is not null
  )
  and not exists (
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
join mondial_confirmations mc
  on mc.invoice_id = b.invoice_id
  and mc.delivered_at = b.delivered_at
where mc.confirmed = true;

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

-- ----------------------------------------------------------------------------
-- Data hygiene: clear delivered_at + un-confirm on the 5 already-superseded
-- rows currently carrying a stale delivered_at, so the Route Plan/TruckCard
-- UI's "Delivered" badge (which reads route_plan_invoices.delivered_at
-- directly, not v_billing) stops showing these as delivered on their old,
-- wrong date. The view fix above already stops the phantom billing line
-- regardless of this; this just cleans up the underlying data these rows
-- were built from. mondial_confirmations rows for the now-removed phantom
-- lines are deleted too, since a confirmation for a line that no longer
-- exists in v_billing is meaningless and would otherwise dangle.
-- ----------------------------------------------------------------------------
delete from mondial_confirmations mc
using route_plan_invoices rpi
where mc.invoice_id = rpi.invoice_id
  and mc.delivered_at = rpi.delivered_at
  and rpi.delivered_at is not null
  and rpi.superseded_at is not null;

update route_plan_invoices
set delivered_at = null
where delivered_at is not null
  and superseded_at is not null;

-- ============================================================================
-- v_billing: fallback branch must not be blocked by an unrelated/stale
-- route_plan_invoices row
-- ============================================================================
-- Bug report: Transmittal CONS-0021's invoices were not showing up in
-- Mondial Confirmation / Final Billing at all. Confirmed live: 39 of its 44
-- invoices were missing from v_billing. Root cause, confirmed via query
-- against production data (not the 46 affected invoices system-wide are all
-- the same shape):
--
--   - Each of these invoices HAS a live (non-superseded) route_plan_invoices
--     row, and that row DOES have delivered_at set (rpi.delivered_at is not
--     null) -- so on the surface it looks like a normal, fully-delivered
--     route-plan invoice.
--   - But the route plan that row belongs to was never approved
--     (route_plans.approved_at is null).
--   - Branch 1 of v_billing (0048/0070) requires rp.approved_at is not null,
--     so it correctly excludes this row.
--   - Branch 3, the "no-route-plan fallback" added in 0048 specifically to
--     catch invoices delivered outside of an approved route plan, excludes
--     ANY invoice that has ANY live route_plan_invoices row at all
--     (`not exists (... where rpi2.superseded_at is null)`), regardless of
--     whether that row is actually the reason the invoice counts as billed.
--   - Net effect: an invoice assigned to a route plan that never got
--     formally approved falls into a gap between the two branches and never
--     appears in v_billing, hence never in Mondial Confirmation or Final
--     Billing -- exactly the CONS-0021 symptom.
--
-- This also matches a second, related scenario the user explicitly called
-- out: an invoice not really carried by a route plan (assigned there once,
-- or never at all), but which gets its actual_delivery_date entered directly
-- on Encode Invoices -- and which still needs to be charged to Mondial /
-- paid a service fee. Live data currently has zero invoices in exactly that
-- shape (assigned + live rpi row + rpi.delivered_at still null), but the fix
-- below covers it the same way, defensively, since it's the same root cause:
-- Branch 3 must not be gated on "does a live rpi row merely exist", it must
-- be gated on "is this invoice already accounted for by Branch 1 or 2".
--
-- Fix: rebuild v_billing (unchanged from 0070 otherwise) with Branch 3's
-- exclusion narrowed to mirror Branch 1's and Branch 2's own join
-- conditions, instead of "any live route_plan_invoices row exists". An
-- invoice is now excluded from the fallback only if it is actually already
-- being billed by Branch 1 (live rpi, delivered_at set, route approved) or
-- Branch 2 (live-but-superseded rpi, chargeable-to-Mondial backload, route
-- approved) -- never merely because some route_plan_invoices row exists for
-- it.
--
-- Verified live before applying: 46 invoices currently have
-- actual_delivery_date set, category <> FLO_PRINCIPAL, and are missing from
-- v_billing -- all 46 are this exact "delivered via an unapproved route
-- plan" shape (CONS-0021 accounts for 39 of them). Re-run the same audit
-- query after applying to confirm the count drops to 0.
-- ============================================================================

drop view if exists v_mondial_billing_statements;
drop view if exists v_final_billing;
drop view if exists v_billing;

create view v_billing as
-- Normal branch: no reason to explain.
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

-- Mondial-fault branch: the wasted backload attempt -- carry the backload's
-- own reason label so the Billing page can explain why this document_no is
-- billed a second time.
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
  true as is_mondial_fault_charge,
  dr.label as reason_label
from invoices i
left join companies c on c.id = i.company_id
join route_plan_invoices rpi on rpi.invoice_id = i.id
join route_plan_trucks t on t.id = rpi.route_plan_truck_id
join route_plans rp on rp.id = t.route_plan_id
join delivery_reasons dr on dr.id = rpi.reason_id
where dr.type = 'BACKLOAD'
  and dr.chargeable_to_mondial = true
  and rpi.superseded_at is not null
  and rp.approved_at is not null
  and i.category <> 'FLO_PRINCIPAL'

union all

-- Fallback branch: delivered (directly on Encode Invoices, via Transmittal,
-- or via a route plan that was never approved / never actually carried the
-- delivery) without being covered by Branch 1 or Branch 2 above. Falls back
-- to fee_rates (by category/zone/is_dc, same lookup DocumentLookup.tsx uses)
-- for the service rate since there's no billable route-plan assignment to
-- snapshot a rate from. If zone/is_dc haven't been set yet, the rate/fee
-- simply come through blank, same as any other missing-data invoice.
--
-- Excluding only invoices actually covered by Branch 1/2 (rather than
-- excluding on "any live route_plan_invoices row exists", as before) is the
-- fix in this migration -- see header comment.
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
    -- already covered by Branch 1
    select 1
    from route_plan_invoices rpi_b1
    join route_plan_trucks t_b1 on t_b1.id = rpi_b1.route_plan_truck_id
    join route_plans rp_b1 on rp_b1.id = t_b1.route_plan_id
    where rpi_b1.invoice_id = i.id
      and rpi_b1.delivered_at is not null
      and rp_b1.approved_at is not null
  )
  and not exists (
    -- already covered by Branch 2
    select 1
    from route_plan_invoices rpi_b2
    join route_plan_trucks t_b2 on t_b2.id = rpi_b2.route_plan_truck_id
    join route_plans rp_b2 on rp_b2.id = t_b2.route_plan_id
    join delivery_reasons dr_b2 on dr_b2.id = rpi_b2.reason_id
    where rpi_b2.invoice_id = i.id
      and dr_b2.type = 'BACKLOAD'
      and dr_b2.chargeable_to_mondial = true
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

-- Two changes to v_billing, rebuilt from 0039's definition:
--
-- 1. FLO-Principal exclusion. FLO_PRINCIPAL invoices can be assigned to a
--    route plan / trucking billing like any other invoice (Route Plan's
--    document lookup has never filtered by category), so without this they
--    would flow straight into Mondial's Billing/Mondial Confirmation once
--    delivered on an approved route plan -- exactly what they must never do,
--    since these principals are billed on a separate system entirely. Added
--    to every branch below.
--
-- 2. No-route-plan fallback (new 3rd branch). Previously an invoice only
--    ever reached v_billing via an approved route plan's route_plan_invoices
--    row. Invoices delivered without ever being added to a route plan --
--    e.g. a delivery date entered directly on Recently Encoded, or one that
--    only went through the Transmittal process -- had no path in at all.
--    This branch picks up any invoice with actual_delivery_date set that
--    has no live (non-superseded) route_plan_invoices row, falling back to
--    fee_rates (by category/zone/is_dc, same lookup DocumentLookup.tsx uses)
--    for the service rate since there's no route-plan assignment to snapshot
--    a rate from. If zone/is_dc haven't been set yet, the rate/fee simply
--    come through blank, same as any other missing-data invoice.

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

-- No-route-plan fallback: delivered (directly or via Transmittal) without
-- ever being assigned to a route plan.
select
  i.id as invoice_id,
  i.document_no,
  i.category,
  i.zone,
  i.is_dc,
  i.amount,
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
    select 1 from route_plan_invoices rpi2
    where rpi2.invoice_id = i.id
      and rpi2.superseded_at is null
  );

create view v_final_billing as
select b.*, mc.confirmed, mc.confirmed_at
from v_billing b
join mondial_confirmations mc on mc.invoice_id = b.invoice_id
where mc.confirmed = true;

-- Auto-confirm billing for transmitted invoices.
--
-- Previously the ONLY way an invoice reached v_final_billing was a manual
-- "Confirm Received" click on the Mondial Confirmation page (a
-- mondial_confirmations row with confirmed = true). That meant every invoice
-- already delivered AND already batched into a printed Transmittal for
-- Mondial's Invoice Department still needed a separate manual confirmation
-- before Final Billing would pick it up -- redundant, since being included
-- in a Transmittal already means Mondial has the paperwork.
--
-- This migration:
-- 1. Adds i.transmittal_id to every branch of v_billing (it was never
--    selected before), so downstream views/pages can tell whether a billing
--    row has been transmitted.
-- 2. Rewrites v_final_billing so an invoice qualifies via EITHER path: the
--    existing manual mondial_confirmations.confirmed = true, OR having a
--    transmittal_id set (auto-confirmed). The manual path is left fully
--    intact for any billing row that reaches v_billing without ever going
--    through a Transmittal.

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
  i.transmittal_id,
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
  i.transmittal_id,
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
  i.transmittal_id,
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

-- confirmed is always true here (the where clause guarantees it) --
-- surfaced as a literal so VFinalBilling's shape is unchanged for existing
-- callers. confirmed_at prefers the manual confirmation timestamp when one
-- exists, falling back to the transmittal's date_transmitted for rows that
-- were only ever auto-confirmed via Transmittal.
create view v_final_billing as
select
  b.*,
  true as confirmed,
  coalesce(mc.confirmed_at, tr.date_transmitted) as confirmed_at
from v_billing b
left join mondial_confirmations mc on mc.invoice_id = b.invoice_id
left join transmittals tr on tr.id = b.transmittal_id
where coalesce(mc.confirmed, false) = true
   or b.transmittal_id is not null;

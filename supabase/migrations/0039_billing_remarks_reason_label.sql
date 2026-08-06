-- Task #197's "Charge to Mondial" automation makes a document_no legitimately
-- appear twice in v_billing/v_final_billing (once for the wasted backload
-- attempt, once for the eventual redelivery) -- but neither the view nor the
-- Billing/Final Billing pages explain WHY to whoever is looking at it. This
-- adds a reason_label column so the Mondial-fault line can carry the
-- backload's own reason (e.g. "Wrong Contact Info Given"), surfaced as a
-- Remarks column in the UI.
--
-- Rebuilt from 0028's definition (the current one) -- just adds one column
-- to each union branch: null for the normal branch (nothing to explain),
-- dr.label for the Mondial-fault branch (already joins delivery_reasons,
-- just wasn't selecting the label before).

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
  and rp.approved_at is not null;

create view v_final_billing as
select b.*, mc.confirmed, mc.confirmed_at
from v_billing b
join mondial_confirmations mc on mc.invoice_id = b.invoice_id
where mc.confirmed = true;

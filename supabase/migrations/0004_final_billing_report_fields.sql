-- Adds the fields needed for the Final Billing report, whose column layout
-- differs per invoice category (Consignment / Outright / Mercury Drug):
-- retail chain / account name, branch/store address, plan date, posting
-- date, transmittal forward date, and billing month.
--
-- Recreate v_billing (and v_final_billing, which depends on it) in
-- dependency order.

drop view if exists v_final_billing;
drop view if exists v_billing;

create view v_billing as
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
  round(i.amount * rpi.service_rate_pct / 100.0, 2) as service_fee
from invoices i
left join companies c on c.id = i.company_id
join route_plan_invoices rpi on rpi.invoice_id = i.id
join route_plan_trucks t on t.id = rpi.route_plan_truck_id
join route_plans rp on rp.id = t.route_plan_id
where rpi.delivered_at is not null
  and rp.approved_at is not null;

create view v_final_billing as
select b.*, mc.confirmed, mc.confirmed_at
from v_billing b
join mondial_confirmations mc on mc.invoice_id = b.invoice_id
where mc.confirmed = true;

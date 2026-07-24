-- Route plan sign-off: Prepared By / Checked By / Approved By.
-- Billing should only pick up invoices from route plans that have been
-- explicitly approved (approved_at is not null).

alter table route_plans
  add column prepared_by text,
  add column checked_by text,
  add column approved_by text,
  add column approved_at timestamptz;

-- Recreate billing views to require route plan approval.
-- v_final_billing depends on v_billing, so drop in dependency order.
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
  rpi.delivered_at,
  rpi.service_rate_pct,
  round(i.amount * rpi.service_rate_pct / 100.0, 2) as service_fee
from invoices i
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

-- ============================================================================
-- Backload "Charge to Mondial" -- automatic double invoice on redelivery
-- ============================================================================
-- Scenario: a delivery gets backloaded for a reason that's Mondial's fault
-- (wrong info, store not informed, etc). The truck already made a real trip
-- for that document -- fuel, driver, helper time -- even though the invoice
-- was never actually delivered that day, so no billing was captured for it.
-- If it's Mondial's fault the trip was wasted, D88 should still get paid for
-- that failed attempt IN ADDITION to the eventual successful redelivery.
--
-- delivery_reasons.chargeable_to_mondial marks specific Backload reasons
-- (any label -- there can be several, e.g. "Wrong Contact Info Given",
-- "Store Not Informed by Mondial") as "this kind of backload is Mondial's
-- fault." Whoever reports the issue picks a reason from the Backload list;
-- if that reason is flagged chargeable_to_mondial, the failed-attempt charge
-- is captured automatically the moment the invoice is rescheduled for
-- redelivery (superseded_at gets set) -- no separate manual billing step.
--
-- v_billing already drives both the Billing and Final Billing pages, and
-- neither page dedupes/groups by document_no, so a document_no appearing
-- twice in v_billing naturally becomes two line items / doubles the totals
-- wherever it's summed -- which is exactly the "double invoice" the
-- business wants, with no separate app-side branching needed.
--
-- This rebuilds v_billing/v_final_billing from their CURRENT definition
-- (migration 0004 -- company_name/branch_address/dates + the
-- rp.approved_at gate), not the original 0001 version, and just adds the
-- second union branch on top.
-- ============================================================================

alter table delivery_reasons
  add column if not exists chargeable_to_mondial boolean not null default false;

drop view if exists v_final_billing;
drop view if exists v_billing;

create view v_billing as
-- Normal branch: every route_plan_invoices row that was actually delivered
-- on an approved route plan (unchanged from 0004 -- this still fires once
-- for the eventual redelivery's own row, same as any other invoice).
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
  false as is_mondial_fault_charge
from invoices i
left join companies c on c.id = i.company_id
join route_plan_invoices rpi on rpi.invoice_id = i.id
join route_plan_trucks t on t.id = rpi.route_plan_truck_id
join route_plans rp on rp.id = t.route_plan_id
where rpi.delivered_at is not null
  and rp.approved_at is not null

union all

-- Mondial-fault branch: the ORIGINAL (now-superseded) backload attempt, only
-- once it has actually been superseded (i.e. rescheduled for redelivery via
-- TruckCard's "Reschedule for Redelivery" action) AND only if that reason is
-- flagged chargeable_to_mondial. This is what produces the second, separate
-- billable line for the wasted trip -- keyed off the ORIGINAL assignment
-- row's own service_rate_pct snapshot, same rate as if it had been billed
-- normally, and gated by the same route-plan-approved requirement.
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
  true as is_mondial_fault_charge
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

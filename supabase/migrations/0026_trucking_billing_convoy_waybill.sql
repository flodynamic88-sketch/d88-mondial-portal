-- ============================================================================
-- Trucking Billing -- Convoy Waybill # (shared-rate convoy trucks)
-- ============================================================================
-- Some route plan trucks travel as a convoy: a main truck plus one or more
-- convoy trucks (route_plan_trucks.is_convoy = true, main_truck_id pointing
-- back to the main truck) that share the SAME rate -- see the existing
-- "Hide truck rate for convoy trucks" behaviour elsewhere in the app. JMD
-- bills that pair as ONE statement/sheet, with both waybill numbers shown
-- together separated by " / " (e.g. "12345 / 67890").
--
-- To match that:
--   1. Convoy trucks are dropped from the Generate candidates list --
--      they're never billed as their own separate statement.
--   2. The main truck's statement gets a second free-text field,
--      convoy_waybill_no, for the paired convoy truck's waybill #.
--   3. Item counts/boxes/amounts and the Delivery Report line items for a
--      main truck's statement now pull from BOTH the main truck's own
--      route_plan_invoices AND any convoy truck(s) linked to it via
--      main_truck_id -- since they're billed together, their deliveries
--      belong on the same sheet.
--   4. has_convoy flags, on both the statements and candidates views,
--      whether a truck actually has a convoy paired to it, so the UI only
--      shows the Convoy Waybill # field when relevant.
-- ============================================================================

alter table trucking_billing_statements
  add column if not exists convoy_waybill_no text;

-- ── Statements view ─────────────────────────────────────────────────────
create or replace view v_trucking_billing_statements
with (security_invoker = false) as
select
  s.id,
  s.route_plan_truck_id,
  s.series_no,
  s.waybill_no,
  s.status,
  s.billed_at,
  s.paid_at,
  s.prepared_by,
  s.approved_by,
  s.created_by,
  s.created_at,
  s.updated_at,
  t.plate_number,
  t.carrier,
  t.driver_name,
  t.helper1_name,
  t.helper2_name,
  case
    when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER') then t.truck_rate
    else null
  end as truck_rate,
  rp.id as route_plan_id,
  rp.route_date,
  rp.label as route_plan_label,
  coalesce(li.item_count, 0) as item_count,
  coalesce(li.total_boxes, 0) as total_boxes,
  coalesce(li.total_amount, 0) as total_amount,
  -- New columns are appended at the end, not inserted where they logically
  -- belong -- `create or replace view` refuses to rename a positional
  -- column, so existing column positions must stay untouched.
  s.area,
  s.truck_type,
  s.convoy_waybill_no,
  exists (
    select 1 from route_plan_trucks tc where tc.main_truck_id = t.id
  ) as has_convoy
from trucking_billing_statements s
join route_plan_trucks t on t.id = s.route_plan_truck_id
left join route_plans rp on rp.id = t.route_plan_id
left join (
  select
    coalesce(t2.main_truck_id, t2.id) as group_truck_id,
    count(*) as item_count,
    sum(qty_box) as total_boxes,
    sum(i.amount) as total_amount
  from route_plan_invoices rpi
  join invoices i on i.id = rpi.invoice_id
  join route_plan_trucks t2 on t2.id = rpi.route_plan_truck_id
  where rpi.superseded_at is null
  group by coalesce(t2.main_truck_id, t2.id)
) li on li.group_truck_id = t.id;

grant select on v_trucking_billing_statements to authenticated;

-- ── Line items view -- now also pulls the convoy truck's own deliveries ──
create or replace view v_trucking_billing_statement_items
with (security_invoker = true) as
select
  s.id as statement_id,
  rpi.id as route_plan_invoice_id,
  i.id as invoice_id,
  i.document_no,
  i.category,
  i.company_name_raw,
  i.branch_address,
  i.amount as declared_value,
  rpi.qty_box,
  i.actual_delivery_date,
  i.posting_date
from trucking_billing_statements s
join route_plan_trucks t on t.id = s.route_plan_truck_id
join route_plan_trucks t2 on (t2.id = t.id or t2.main_truck_id = t.id)
join route_plan_invoices rpi on rpi.route_plan_truck_id = t2.id and rpi.superseded_at is null
join invoices i on i.id = rpi.invoice_id
order by i.actual_delivery_date, i.document_no;

grant select on v_trucking_billing_statement_items to authenticated;

-- ── Candidates view -- convoy trucks are no longer billable on their own ─
create or replace view v_trucking_billing_candidates
with (security_invoker = false) as
select
  t.id as route_plan_truck_id,
  t.plate_number,
  t.carrier,
  t.driver_name,
  case
    when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER') then t.truck_rate
    else null
  end as truck_rate,
  rp.id as route_plan_id,
  rp.route_date,
  rp.label as route_plan_label,
  coalesce(li.item_count, 0) as item_count,
  coalesce(li.total_boxes, 0) as total_boxes,
  coalesce(li.total_amount, 0) as total_amount,
  exists (
    select 1 from route_plan_trucks tc where tc.main_truck_id = t.id
  ) as has_convoy
from route_plan_trucks t
join route_plans rp on rp.id = t.route_plan_id
left join trucking_billing_statements s on s.route_plan_truck_id = t.id
left join (
  select
    coalesce(t2.main_truck_id, t2.id) as group_truck_id,
    count(*) as item_count,
    sum(qty_box) as total_boxes,
    sum(i.amount) as total_amount
  from route_plan_invoices rpi
  join invoices i on i.id = rpi.invoice_id
  join route_plan_trucks t2 on t2.id = rpi.route_plan_truck_id
  where rpi.superseded_at is null
  group by coalesce(t2.main_truck_id, t2.id)
) li on li.group_truck_id = t.id
where s.id is null
  and not t.is_convoy;

grant select on v_trucking_billing_candidates to authenticated;

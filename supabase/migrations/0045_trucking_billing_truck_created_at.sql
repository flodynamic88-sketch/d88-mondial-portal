-- ============================================================================
-- Expose the truck's own created_at so the Excel export can sort sheets
-- ============================================================================
-- Business need: JMD wants the Trucking Billing Excel export's sheets to come
-- out in order -- by delivery date first, then by truck number within that
-- date (Truck 1, Truck 2, ...). "Truck number" everywhere else in the app
-- (Route Plan board, the printable per-day Delivery Route report) is derived
-- client-side as the ascending route_plan_trucks.created_at order of main
-- trucks (see RoutePlanBoard.tsx truckLabelById / route-plan/print/day).
--
-- v_trucking_billing_statements already exposes s.created_at (the billing
-- STATEMENT's own created_at, unrelated to truck ordering) -- there is no
-- existing column carrying the truck's created_at, so the export currently
-- has no reliable field to reproduce that same "Truck 1, 2, 3" order. This
-- appends t.created_at (aliased truck_created_at, append-only convention
-- from 0024/0026/0033/0040/0043/0044) so the client can sort
-- (route_date, truck_created_at) to match.
--
-- View rebuilt verbatim from its 0043 definition -- convoy-aware total_boxes
-- subquery, area/destination masking, is_negotiated_rate, total_boxes_override
-- all preserved unchanged; only the new tail column is added.
-- ============================================================================

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
  coalesce(s.total_boxes_override, li.total_boxes, 0) as total_boxes,
  coalesce(li.total_amount, 0) as total_amount,
  case
    when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE')
      then coalesce(tr.area, s.area)
    else null
  end as area,
  s.truck_type,
  s.convoy_waybill_no,
  exists (
    select 1 from route_plan_trucks tc where tc.main_truck_id = t.id
  ) as has_convoy,
  t.destination,
  t.is_negotiated_rate,
  s.total_boxes_override,
  t.created_at as truck_created_at
from trucking_billing_statements s
join route_plan_trucks t on t.id = s.route_plan_truck_id
left join route_plans rp on rp.id = t.route_plan_id
left join trucking_rates tr on tr.destination = t.destination
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

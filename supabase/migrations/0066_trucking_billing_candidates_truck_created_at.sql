-- ============================================================================
-- Expose truck_created_at on v_trucking_billing_candidates too
-- ============================================================================
-- 0045 added truck_created_at to v_trucking_billing_statements so the For
-- Billing/Billed/Paid tabs and the Excel export could sort trucks in the same
-- Truck 1, 2, 3... order as the Route Plan board (route_plan_trucks.created_at
-- ASC among main trucks -- see RoutePlanBoard.tsx truckLabelById).
--
-- v_trucking_billing_candidates (the Generate tab's truck checklist) never got
-- the same column, so that list has no reliable field to sort by truck number
-- either -- it's ordered by route_date only today. This appends t.created_at
-- (aliased truck_created_at, same append-only convention as 0024/0026/0033/
-- 0040/0043/0044/0045) so the Generate tab can match the same order.
--
-- View rebuilt verbatim from its 0033 definition -- convoy-aware item/boxes/
-- amount subquery, area masking, is_negotiated_rate, "no statement yet, not a
-- convoy truck" filter all preserved unchanged; only the new tail column is
-- added.
-- ============================================================================

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
  ) as has_convoy,
  t.destination,
  case
    when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE') then tr.area
    else null
  end as area,
  t.is_negotiated_rate,
  t.created_at as truck_created_at
from route_plan_trucks t
join route_plans rp on rp.id = t.route_plan_id
left join trucking_rates tr on tr.destination = t.destination
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

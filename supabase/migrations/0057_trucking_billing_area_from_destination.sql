-- ============================================================================
-- Trucking Billing Area should mirror the truck's Route Plan Destination
-- ============================================================================
-- Business need: JMD's Area column in Trucking Billing was showing the
-- broader region grouped in trucking_rates.area (e.g. "LAGUNA") instead of
-- the exact Destination the truck was assigned to in Route Plan (e.g.
-- "CALAMBA" or "STA ROSA" -- both of which map to the LAGUNA region). The
-- user wants Area to show literally "kung ano ang nakalagay sa Route Plan"
-- -- the Destination value itself -- not the rate card's region grouping.
--
-- Verified live (2026-08-13) via direct SQL: route_plan_trucks.destination
-- correctly matches trucking_rates.destination byte-for-byte for every
-- truck checked (KAWIT, CALAMBA, STA ROSA, BALIUAG, MANDALUYONG all
-- resolved their region cleanly) -- there was no string-matching bug. The
-- "wrong value" complaint is about which column feeds Area, not a masking
-- or join bug, so this migration only changes the source expression.
--
-- The trucking_rates join is now unused inside this view (it existed only
-- to resolve tr.area) and is dropped. trucking_rates itself is untouched --
-- it's still the destination -> truck_rate lookup used elsewhere (the
-- auto-rate trigger on route_plan_trucks from migration 0033).
--
-- View rebuilt verbatim from its 0045 definition -- convoy-aware
-- total_boxes subquery, truck_created_at tail column, is_negotiated_rate,
-- total_boxes_override all preserved unchanged; only the `area` expression
-- changes and the now-dead trucking_rates join is removed.
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
      then t.destination
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

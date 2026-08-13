-- ============================================================================
-- Add driver_name to each convoy sub-truck entry in v_trucking_billing_statements.convoys
-- ============================================================================
-- Business need: on a convoy route (one main truck + one or more convoy
-- sub-trucks sharing the same rate), the Delivery Report and Billing
-- Statement should show ALL plate numbers and ALL drivers involved --
-- combined with " / ", the same way combinedWaybill() already joins the
-- main truck's waybill # with each convoy sub-truck's own waybill #.
-- Verified live on the Aug 4, 2026 route plan: main truck DBR2926 convoys
-- with NKH2668 -- today the Delivery Report/Billing Statement only ever
-- show DBR2926's own plate_number/driver_name, silently dropping NKH2668's
-- plate and driver.
--
-- `convoys` (added 0058) already carries each convoy sub-truck's
-- route_plan_truck_id + plate_number + waybill_no -- this just adds
-- driver_name to that same jsonb object so the app can build a combined
-- "MAIN / CONVOY1 / CONVOY2" string for plate and driver, mirroring
-- combinedWaybill(). Rebuilt verbatim from 0058 -- only the new jsonb key
-- is added.
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
  t.created_at as truck_created_at,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'route_plan_truck_id', tc.id,
          'plate_number', tc.plate_number,
          'waybill_no', cw.waybill_no,
          'driver_name', tc.driver_name
        )
        order by tc.created_at asc
      )
      from route_plan_trucks tc
      left join trucking_billing_convoy_waybills cw
        on cw.route_plan_truck_id = tc.id and cw.statement_id = s.id
      where tc.main_truck_id = t.id
    ),
    '[]'::jsonb
  ) as convoys
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

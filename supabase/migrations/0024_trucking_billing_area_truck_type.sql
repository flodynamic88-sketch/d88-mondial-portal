-- ============================================================================
-- Trucking Billing -- Area + Truck Type
-- ============================================================================
-- JMD's own "Billing Statement" + "Delivery Report" sheet format (see the
-- sample JMD BILLING workbook) carries two fields we don't otherwise track
-- anywhere in Route Plan / Invoice data:
--   * "Branch Name" on the billing summary row / "Sched / Area" on the
--     Delivery Report -- the delivery zone/area name for the whole truck
--     (e.g. "PARANAQUE"), which is coarser than an individual invoice's
--     branch_address and isn't recorded today.
--   * "Truck Class." on the billing summary row / "Truck Type" on the
--     Delivery Report -- the vehicle classification (e.g. "4W", "6W"),
--     which route_plan_trucks has no column for.
--
-- Like waybill_no, both are vendor-supplied values that can't be derived
-- from our own data, so they're added as plain nullable columns on
-- trucking_billing_statements and edited inline the same way waybill_no is.
-- ============================================================================

alter table trucking_billing_statements
  add column if not exists area text,
  add column if not exists truck_type text;

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
  -- belong next to waybill_no -- `create or replace view` refuses to rename
  -- a positional column (e.g. it would try to rename "status" to "area" if
  -- these were inserted earlier in the list), so existing column positions
  -- must stay untouched and new ones can only be added at the tail.
  s.area,
  s.truck_type
from trucking_billing_statements s
join route_plan_trucks t on t.id = s.route_plan_truck_id
left join route_plans rp on rp.id = t.route_plan_id
left join (
  select route_plan_truck_id, count(*) as item_count, sum(qty_box) as total_boxes, sum(i.amount) as total_amount
  from route_plan_invoices rpi
  join invoices i on i.id = rpi.invoice_id
  where rpi.superseded_at is null
  group by route_plan_truck_id
) li on li.route_plan_truck_id = t.id;

grant select on v_trucking_billing_statements to authenticated;

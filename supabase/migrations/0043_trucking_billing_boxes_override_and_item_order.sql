-- ============================================================================
-- Trucking Billing: editable total-boxes override + truck-order line items
-- ============================================================================
-- 1. The Delivery Report's "Boxes" column should show ONE merged total across
--    all receipts on the truck (not a per-receipt qty_box figure), and that
--    total must be manually editable before printing -- JMD's own delivery
--    reports don't always match the sum of what was keyed in per route
--    invoice, so the printed total needs a manual override, separate from the
--    live-computed sum. total_boxes_override is null by default (falls back
--    to the computed sum, itself convoy-aware since 0026/0033); once set, it
--    wins. Appended as the new tail column on v_trucking_billing_statements,
--    per the append-only convention from 0024/0026/0033/0040 -- the existing
--    total_boxes column keeps its name/position, only its expression changes
--    to prefer the override.
-- 2. Delivery Report / Billing Statement line items were ordered by
--    (actual_delivery_date, document_no) -- i.e. receipt/waybill series order.
--    They should instead follow the order the invoices were assigned to this
--    particular truck in Route Plan (route_plan_invoices.created_at), since
--    that's the truck's own delivery sequence, not a receipt-series sequence.
--
-- Both views below are rebuilt verbatim from their current (0040 / 0026)
-- definitions -- convoy-aware total_boxes subquery, area/destination masking,
-- is_negotiated_rate, and the convoy line-item join are all preserved
-- unchanged; only the two edits above are applied.
-- ============================================================================

alter table trucking_billing_statements
  add column if not exists total_boxes_override integer;

comment on column trucking_billing_statements.total_boxes_override is
  'Manual override for the Delivery Report''s merged Boxes total. Null = use the live-computed (convoy-aware) sum of route_plan_invoices.qty_box.';

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
  s.total_boxes_override
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
order by rpi.created_at;

grant select on v_trucking_billing_statement_items to authenticated;

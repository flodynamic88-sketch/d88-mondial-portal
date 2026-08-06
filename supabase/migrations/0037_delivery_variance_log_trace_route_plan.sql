-- ============================================================================
-- Delivery Variance Log: trace back to Route Plan truck / date
-- ============================================================================
-- Adds route_plan_id, route_date, and truck_label to v_delivery_variance_logs
-- so each variance log row can be traced back to exactly which truck (and
-- which route plan day) encountered the discrepancy/backload, straight from
-- the Delivery Variance Log page -- no need to go hunt through Route Plan.
--
-- truck_label reproduces the same "Truck N" / "Truck N · Convoy M" numbering
-- RoutePlanBoard.tsx computes client-side (ordered by created_at ascending,
-- main trucks numbered within their route plan, convoy trucks numbered
-- within their main truck).
--
-- New columns are appended at the very end of the existing SELECT list --
-- Postgres' CREATE OR REPLACE VIEW only allows adding columns at the end,
-- never inserting them in the middle (42P16: cannot change name of view
-- column) -- so the first 20 columns below are byte-for-byte the same as
-- migration 0007's version, in the same order.
-- ============================================================================

create or replace view v_delivery_variance_logs
with (security_invoker = true) as
with truck_numbers as (
  select
    t.id,
    t.route_plan_id,
    t.main_truck_id,
    case
      when t.main_truck_id is null then
        row_number() over (partition by t.route_plan_id order by t.created_at)
      else null
    end as main_seq,
    case
      when t.main_truck_id is not null then
        row_number() over (partition by t.main_truck_id order by t.created_at)
      else null
    end as convoy_seq
  from route_plan_trucks t
),
truck_labels as (
  select
    tn.id as truck_id,
    case
      when tn.main_truck_id is null then 'Truck ' || tn.main_seq
      else
        (select 'Truck ' || m.main_seq from truck_numbers m where m.id = tn.main_truck_id)
        || ' · Convoy ' || tn.convoy_seq
    end as truck_label
  from truck_numbers tn
)
select
  l.id,
  l.series_no,
  l.invoice_id,
  i.document_no,
  i.company_name_raw as retail_chain,
  i.branch_address,
  i.category,
  l.route_plan_invoice_id,
  l.reason_id,
  r.type as reason_type,
  r.label as reason_label,
  l.log_date,
  l.prepared_by,
  l.checked_by,
  l.received_by_1,
  l.received_by_2,
  l.remarks,
  l.created_at,
  l.updated_at,
  coalesce(items.item_count, 0) as item_count,
  coalesce(items.total_amount, 0) as total_amount,
  rp.id as route_plan_id,
  rp.route_date,
  tl.truck_label
from delivery_variance_logs l
left join invoices i on i.id = l.invoice_id
left join delivery_reasons r on r.id = l.reason_id
left join (
  select log_id, count(*) as item_count, sum(amount) as total_amount
  from delivery_variance_log_items
  group by log_id
) items on items.log_id = l.id
left join route_plan_invoices rpi on rpi.id = l.route_plan_invoice_id
left join route_plan_trucks rpt on rpt.id = rpi.route_plan_truck_id
left join route_plans rp on rp.id = rpt.route_plan_id
left join truck_labels tl on tl.truck_id = rpt.id;

grant select on v_delivery_variance_logs to authenticated;

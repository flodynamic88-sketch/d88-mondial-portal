-- ============================================================================
-- Delivery Variance Log: lump-sum Backload total amount
-- ============================================================================
-- For BACKLOAD-type variance logs, requiring a full itemized breakdown
-- (qty/unit/unit price per item) is often more than the receipt gives you --
-- sometimes all you have is a total peso amount. This adds an optional
-- backload_total_amount column on the log header: when set, it overrides
-- the sum of delivery_variance_log_items as the log's total (both on the
-- list page and the printable forms). Itemizing is still fully supported
-- and unaffected -- this is purely an alternative for when itemizing isn't
-- practical.
--
-- New view column is appended at the very end of the existing SELECT list --
-- CREATE OR REPLACE VIEW only allows adding columns at the end, never
-- inserting them in the middle (42P16) -- so columns 1-23 below are
-- byte-for-byte the same as migration 0037's version, in the same order.
-- Only the total_amount expression (column 20) changes, from a straight
-- items-sum to a coalesce against this new override.
-- ============================================================================

alter table delivery_variance_logs
  add column backload_total_amount numeric;

comment on column delivery_variance_logs.backload_total_amount is
  'Optional lump-sum total for BACKLOAD logs when the receipt isn''t itemized -- when set, this value is used as the log''s total instead of summing delivery_variance_log_items (see v_delivery_variance_logs.total_amount).';

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
  coalesce(l.backload_total_amount, items.total_amount, 0) as total_amount,
  rp.id as route_plan_id,
  rp.route_date,
  tl.truck_label,
  l.backload_total_amount
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

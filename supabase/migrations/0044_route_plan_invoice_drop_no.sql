-- ============================================================================
-- Manual Drop No. (delivery-sequence number) per invoice per truck
-- ============================================================================
-- Business need: the Delivery Report's item order must follow the truck's
-- actual planned drop/stop sequence (1st drop, 2nd drop, ...), set manually
-- by whoever plans the route -- not just the order invoices happened to be
-- assigned in Route Plan (which is what 0043 fell back to via
-- route_plan_invoices.created_at). drop_no is nullable: unset rows sort last
-- and fall back to the assignment-order tiebreak from 0043, so this is a
-- purely additive, non-breaking change for trucks that never set it.
--
-- v_trucking_billing_statement_items is rebuilt verbatim from its 0043
-- definition -- convoy-aware join preserved unchanged -- with drop_no
-- appended as the new tail column (append-only view convention, see 0024/
-- 0026/0033/0040/0043) and the ORDER BY switched to drop_no first.
-- ============================================================================

alter table route_plan_invoices
  add column if not exists drop_no integer;

comment on column route_plan_invoices.drop_no is
  'Manual drop/stop sequence number (1st drop, 2nd drop, ...) for this invoice on this truck, set in Route Plan. Null = no manual sequence set; Delivery Report falls back to assignment order (created_at) for those rows.';

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
  i.posting_date,
  rpi.drop_no
from trucking_billing_statements s
join route_plan_trucks t on t.id = s.route_plan_truck_id
join route_plan_trucks t2 on (t2.id = t.id or t2.main_truck_id = t.id)
join route_plan_invoices rpi on rpi.route_plan_truck_id = t2.id and rpi.superseded_at is null
join invoices i on i.id = rpi.invoice_id
order by rpi.drop_no nulls last, rpi.created_at;

grant select on v_trucking_billing_statement_items to authenticated;

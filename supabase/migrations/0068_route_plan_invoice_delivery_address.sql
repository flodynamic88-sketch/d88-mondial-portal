-- ============================================================================
-- Per-assignment Delivery Address override on route_plan_invoices
-- ============================================================================
-- Business need: invoices.branch_address is the invoice's own static address
-- on file, but the actual delivery point for a given route-plan assignment
-- sometimes differs (e.g. a temporary drop point, a more precise address than
-- what's on the invoice). Route Plan/JMD Planner needs to type (or pick from
-- previously-used addresses) an exact delivery address per truck+invoice
-- assignment, without touching the invoice's own branch_address. Nullable and
-- purely additive -- unset rows keep falling back to invoices.branch_address
-- in the UI/print output, so this is non-breaking for existing rows.
--
-- v_trucking_billing_statement_items is rebuilt verbatim from its 0061
-- definition (backload nearest-sibling sort, is_backload/is_redeliver calc,
-- all joins) with rpi.delivery_address appended as the new tail column
-- (append-only view convention, see 0024/0026/0033/0040/0043/0044/0060/0061).
-- ============================================================================

alter table route_plan_invoices
  add column if not exists delivery_address text;

comment on column route_plan_invoices.delivery_address is
  'Optional exact delivery address override for this invoice on this specific truck/route-plan assignment. Null = use invoices.branch_address as-is.';

create or replace view v_trucking_billing_statement_items
with (security_invoker = true) as
with base as (
  select
    s.id as statement_id,
    rpi.id as route_plan_invoice_id,
    i.id as invoice_id,
    i.document_no,
    i.document_no_sort,
    i.category,
    i.company_name_raw,
    i.branch_address,
    i.amount as declared_value,
    rpi.qty_box,
    i.actual_delivery_date,
    i.posting_date,
    rpi.drop_no,
    rpi.created_at,
    rpi.delivery_address,
    (rpi.superseded_at is not null and dr.type = 'BACKLOAD') as is_backload,
    (
      rpi.superseded_at is null
      and exists (
        select 1
        from route_plan_invoices rpi2
        join delivery_reasons dr2 on dr2.id = rpi2.reason_id
        where rpi2.invoice_id = rpi.invoice_id
          and rpi2.id <> rpi.id
          and rpi2.superseded_at is not null
          and dr2.type = 'BACKLOAD'
      )
    ) as is_redeliver
  from trucking_billing_statements s
  join route_plan_trucks t on t.id = s.route_plan_truck_id
  join route_plan_trucks t2 on (t2.id = t.id or t2.main_truck_id = t.id)
  join route_plan_invoices rpi on rpi.route_plan_truck_id = t2.id
  left join delivery_reasons dr on dr.id = rpi.reason_id
  join invoices i on i.id = rpi.invoice_id
  where rpi.superseded_at is null
     or (rpi.superseded_at is not null and dr.type = 'BACKLOAD')
),
sorted as (
  select
    b.*,
    -- nearest active same-prefix sibling immediately BELOW this backload in
    -- the document series -- "kasunod ng <this sibling>" -- picked by actual
    -- document_no_sort distance, not by aggregate drop_no.
    (
      select b2.drop_no
      from base b2
      where b2.statement_id = b.statement_id
        and b2.is_backload = false
        and regexp_replace(b2.document_no_sort, '[0-9]', '', 'g')
          = regexp_replace(b.document_no_sort, '[0-9]', '', 'g')
        and b2.document_no_sort < b.document_no_sort
      order by b2.document_no_sort desc
      limit 1
    ) as prev_sibling_drop_no,
    -- fallback: nearest active same-prefix sibling immediately ABOVE it --
    -- used only when the backload is the first in its series on this truck.
    (
      select b2.drop_no
      from base b2
      where b2.statement_id = b.statement_id
        and b2.is_backload = false
        and regexp_replace(b2.document_no_sort, '[0-9]', '', 'g')
          = regexp_replace(b.document_no_sort, '[0-9]', '', 'g')
        and b2.document_no_sort > b.document_no_sort
      order by b2.document_no_sort asc
      limit 1
    ) as next_sibling_drop_no
  from base b
)
select
  statement_id,
  route_plan_invoice_id,
  invoice_id,
  document_no,
  category,
  company_name_raw,
  branch_address,
  declared_value,
  qty_box,
  actual_delivery_date,
  posting_date,
  drop_no,
  is_backload,
  is_redeliver,
  delivery_address
from sorted
order by
  statement_id,
  coalesce(
    case
      when is_backload then coalesce(prev_sibling_drop_no, next_sibling_drop_no, drop_no)
      else drop_no
    end
  ) nulls last,
  document_no_sort,
  created_at;

grant select on v_trucking_billing_statement_items to authenticated;

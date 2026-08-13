-- ============================================================================
-- Trucking Billing: fix backload inline-sort to use the truly NEAREST
-- same-series sibling, not the sibling with the smallest/largest drop_no
-- ============================================================================
-- Bug (user report, 2026-08-13, second round): 0060 tried to slot a backloaded
-- row next to its nearest same-prefix sibling, but picked that sibling with
-- `min(drop_no) where document_no_sort > backload` / `max(drop_no) where
-- document_no_sort < backload` -- i.e. it picked whichever sibling had the
-- smallest/largest drop_no among ALL siblings on that side, not the sibling
-- whose document_no_sort is actually closest.
--
-- Concretely, on truck DBH.../statement 675ca3ef: CD_0100261 was backloaded.
-- Its nearest lower sibling by document number is CD_0100259 (drop_no 1), but
-- CD_0100251 -- a much earlier-numbered document that happened to be
-- delivered LATER on this truck (drop_no 4) -- has a *larger* drop_no than
-- CD_0100259, so `max(drop_no) where document_no_sort < '...0261'` picked
-- CD_0100251's bucket (4) instead of CD_0100259's bucket (1). Same problem on
-- the upper side. Net effect: CD_0100261 sorted to the very front of the
-- whole report, not "kasunod ng CD_0100259" as expected -- document number
-- and drop_no don't move in lockstep across a whole truck, only between
-- adjacent documents.
--
-- Fix:
--   1. Find the nearest sibling by document_no_sort distance (order by
--      document_no_sort asc/desc limit 1), not by aggregate min/max(drop_no).
--   2. Prefer sitting right after the nearest LOWER sibling ("kasunod ng
--      CD_0100259") since that's literally what "kasunod" (follows) means;
--      fall back to the nearest HIGHER sibling's bucket only when the
--      backload is the very first in its series on this truck.
--   3. Drop the separate before/after case flag entirely -- once the
--      backload shares a bucket with its real neighbor, plain
--      `document_no_sort` ordering within that bucket already places it
--      exactly between its lower and upper neighbors, no extra flag needed.
--
-- Only the ORDER BY / sibling-lookup subqueries change from 0060 -- selected
-- columns, joins, and is_backload/is_redeliver computation are unchanged.
-- ============================================================================

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
  is_redeliver
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

-- ============================================================================
-- Trucking Billing: sort backloaded items inline by invoice series, not last
-- ============================================================================
-- Bug (user report, 2026-08-13): 0059 made a truck's own backloaded invoices
-- visible again (tagged "BACKLOAD"), but it kept the existing
-- `order by rpi.drop_no nulls last, rpi.created_at`. A backloaded row's
-- drop_no is whatever it was before it got bumped off the truck -- which, in
-- the reported case, happened to be the highest drop_no on that truck (it
-- was the last drop before it was rescheduled), so it sorted dead last on
-- the printed report. User expectation: it should still sit "sunod-sunod
-- based sa series ng invoice" -- inline with its same-series siblings (e.g.
-- CD_0100349, CD_0100350, then the backloaded CD_0100414, CD_0100421 --
-- not pushed after PSI-prefixed items with a later drop_no).
--
-- Fix: keep drop_no as the primary sort for every ACTIVE (non-backload) row
-- -- that's the real physical stop order and must stay untouched. Only a
-- backloaded row's own position changes: instead of its stale drop_no, it's
-- given a synthetic slot right next to the nearest active sibling that
-- shares its document-number prefix (CD_/PSI-/BR_/MDR_, matched via
-- document_no_sort with digits stripped, so "CD_"/"CD-" match each other) --
-- placed just before the next-higher same-prefix sibling's drop_no, or just
-- after the highest same-prefix sibling's drop_no if it's last in that
-- series. Two backloaded rows landing in the same slot break the tie by
-- document_no_sort so they still read low-to-high among themselves.
--
-- Only the ORDER BY changes -- selected columns, the is_backload/is_redeliver
-- computation, and the join conditions are unchanged from 0059.
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
    -- nearest active same-prefix sibling whose series comes right AFTER
    -- this backloaded row -- it should slot in just before that one
    (
      select min(b2.drop_no)
      from base b2
      where b2.statement_id = b.statement_id
        and b2.is_backload = false
        and regexp_replace(b2.document_no_sort, '[0-9]', '', 'g')
          = regexp_replace(b.document_no_sort, '[0-9]', '', 'g')
        and b2.document_no_sort > b.document_no_sort
    ) as next_sibling_drop_no,
    -- fallback: nearest active same-prefix sibling whose series comes right
    -- BEFORE this one -- used when the backload is last in its own series
    (
      select max(b2.drop_no)
      from base b2
      where b2.statement_id = b.statement_id
        and b2.is_backload = false
        and regexp_replace(b2.document_no_sort, '[0-9]', '', 'g')
          = regexp_replace(b.document_no_sort, '[0-9]', '', 'g')
        and b2.document_no_sort < b.document_no_sort
    ) as prev_sibling_drop_no
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
      when is_backload then coalesce(next_sibling_drop_no, prev_sibling_drop_no, drop_no)
      else drop_no
    end
  ) nulls last,
  case
    when not is_backload then 1
    when next_sibling_drop_no is not null then 0
    else 2
  end,
  document_no_sort,
  created_at;

grant select on v_trucking_billing_statement_items to authenticated;

-- ============================================================================
-- v_transmittals: per-prefix document ranges (fixes misleading cross-prefix span)
-- ============================================================================
-- Bug: first_document_no/last_document_no (added in 0013, sort-key-corrected in
-- 0030) are computed as a single min/max across ALL items in a transmittal
-- batch, regardless of document_no prefix (CD_/PSI-/BR_/MDR_). OUTRIGHT batches
-- routinely mix BR_ and PSI- invoices in one transmittal. Because the range is
-- printed/read as if it were contiguous ("BR_0013335 - PSI_0065812"), staff
-- read it as "every document number in this span was transmitted" -- which is
-- false. This is confirmed as the root cause of a user report that BR_0013359
-- (never delivered, never transmitted) looked like it was already covered by
-- 6 different OUTRIGHT transmittals, purely because their BR/PSI min-max span
-- happened to straddle it.
--
-- Verified fix via live query: computing the range separately per alpha prefix
-- (regexp_replace(document_no, '[0-9_-]+$', '')) means each transmittal's BR-only
-- range no longer spans further than the BR_ invoices actually in that batch --
-- none of the 6 affected transmittals' true BR-only ranges include BR_0013359.
--
-- Fix: add document_ranges, a prefix-grouped, human-readable range string
-- (e.g. "BR_0013335 - BR_0013348, PSI-0065801 - PSI-0065812"), computed from
-- per-prefix array_agg(... order by document_no_sort). first_document_no /
-- last_document_no are left in place (unchanged, same global min/max as
-- before) since other code (search filter, delete-confirmation dialogs) still
-- references them and changing their meaning is out of scope here -- only the
-- display of the *range* in the Transmittals UI changes, in a follow-up code
-- change that switches to document_ranges.
-- ============================================================================

drop view if exists v_transmittals;

create or replace view v_transmittals
with (security_invoker = true) as
with prefix_items as (
  select
    ti.transmittal_id,
    regexp_replace(i.document_no, '[0-9_-]+$', '') as doc_prefix,
    i.document_no,
    i.document_no_sort
  from transmittal_items ti
  join invoices i on i.id = ti.invoice_id
),
prefix_ranges as (
  select
    transmittal_id,
    doc_prefix,
    (array_agg(document_no order by document_no_sort asc))[1] as prefix_first,
    (array_agg(document_no order by document_no_sort desc))[1] as prefix_last,
    min(document_no_sort) as prefix_min_sort
  from prefix_items
  group by transmittal_id, doc_prefix
),
prefix_ranges_agg as (
  select
    transmittal_id,
    string_agg(
      case
        when prefix_first = prefix_last then prefix_first
        else prefix_first || ' - ' || prefix_last
      end,
      ', '
      order by prefix_min_sort asc
    ) as document_ranges
  from prefix_ranges
  group by transmittal_id
)
select
  t.id,
  t.transmittal_no,
  t.category,
  t.delivery_date,
  t.date_transmitted,
  t.status,
  t.created_by,
  t.created_at,
  t.updated_at,
  coalesce(count(ti.id), 0) as item_count,
  coalesce(sum(i.amount), 0) as amount,
  (array_agg(i.document_no order by i.document_no_sort asc))[1] as first_document_no,
  (array_agg(i.document_no order by i.document_no_sort desc))[1] as last_document_no,
  pra.document_ranges
from transmittals t
left join transmittal_items ti on ti.transmittal_id = t.id
left join invoices i on i.id = ti.invoice_id
left join prefix_ranges_agg pra on pra.transmittal_id = t.id
group by t.id, pra.document_ranges;

grant select on v_transmittals to authenticated;

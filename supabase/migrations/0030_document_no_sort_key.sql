-- ============================================================================
-- Transmittal document # series must always sort lowest -> highest
-- ============================================================================
-- Bug: invoices.document_no is free-text (see InvoiceForm.tsx) and real data
-- mixes separator styles for the same prefix -- e.g. "CD_0100363" alongside
-- "CD-0100364", or "PSI-0065924". Plain lexicographic ORDER BY document_no
-- (Postgres) and .localeCompare() (JS, transmittals/page.tsx) sort '-'
-- before '_' in ASCII, so "CD-0100364" sorts BEFORE "CD_0100363" even though
-- 364 > 363 numerically. Confirmed via:
--   select distinct regexp_replace(document_no, '[0-9]', '#', 'g') as pattern,
--     count(*) from invoices group by 1 order by 2 desc;
-- which returned only '_' / '-' as the varying separator across all prefixes
-- (CD_#######, PSI-#######, CD-#######, BR_#######, MDR_####-####) -- no
-- other punctuation appears, so normalizing '-' -> '_' is sufficient.
--
-- Fix: add a generated column that normalizes the separator for sorting
-- only (display keeps the original document_no). App code and views switch
-- from ordering by document_no to ordering by document_no_sort.
-- ============================================================================

alter table invoices
  add column if not exists document_no_sort text
  generated always as (replace(document_no, '-', '_')) stored;

create index if not exists idx_invoices_document_no_sort on invoices(document_no_sort);

-- v_transmittal_items: expose document_no_sort so the Transmittals page and
-- print view can order by it while still displaying document_no as-is.
drop view if exists v_transmittal_items;

create or replace view v_transmittal_items
with (security_invoker = true) as
select
  ti.id,
  ti.transmittal_id,
  ti.invoice_id,
  ti.remarks,
  i.document_no,
  i.document_no_sort,
  i.category,
  i.actual_delivery_date,
  i.billing_period,
  i.posting_date,
  i.company_name_raw,
  i.branch_address,
  i.amount
from transmittal_items ti
join invoices i on i.id = ti.invoice_id;

grant select on v_transmittal_items to authenticated;

-- v_transmittals: first_document_no/last_document_no previously used
-- min(document_no)/max(document_no), which have the exact same lexicographic
-- bug. Postgres has no MIN/MAX-with-custom-sort-key aggregate, so use
-- array_agg(... order by document_no_sort)[1] to pick the order-correct
-- first/last value while still returning the original document_no string.
drop view if exists v_transmittals;

create or replace view v_transmittals
with (security_invoker = true) as
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
  (array_agg(i.document_no order by i.document_no_sort desc))[1] as last_document_no
from transmittals t
left join transmittal_items ti on ti.transmittal_id = t.id
left join invoices i on i.id = ti.invoice_id
group by t.id;

grant select on v_transmittals to authenticated;

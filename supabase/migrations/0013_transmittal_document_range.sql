-- ============================================================================
-- Transmittal document number range
-- ============================================================================
-- The Transmittal Summary and "Recently Generated" tables led with
-- transmittal_no (e.g. CONS-0001) -- an internal batch reference. Per user
-- feedback, the invoices' own document numbers (CD_/PSI-/BR_ series) should
-- be the lead identifier instead, since that's what staff actually recognize.
-- A transmittal batches many invoices though, so we surface the first and
-- last document_no (by ascending sort, matching the ordering already used in
-- the Generate tab and printable form) as a range; transmittal_no remains as
-- a secondary reference column.
-- ============================================================================

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
  min(i.document_no) as first_document_no,
  max(i.document_no) as last_document_no
from transmittals t
left join transmittal_items ti on ti.transmittal_id = t.id
left join invoices i on i.id = ti.invoice_id
group by t.id;

grant select on v_transmittals to authenticated;

-- ============================================================================
-- Allow deleting invoices that were already confirmed by the Mondial Team
-- ============================================================================
-- mondial_confirmations.invoice_id references invoices(id) with no ON DELETE
-- clause (defaults to NO ACTION), so once an invoice has ever been confirmed
-- by the Mondial Team, deleting it from Encode Invoices / Deliveries always
-- fails with a foreign key violation (23503) -- even after it has been fully
-- unassigned from every route plan. There is no UI to "unconfirm" an invoice,
-- so this was a dead end for users trying to remove a bad/duplicate record.
--
-- Since a confirmation row is meaningless without the invoice it confirms,
-- this switches the FK to ON DELETE CASCADE: deleting an invoice now also
-- removes its (now-orphaned) confirmation row, the same way route plan
-- assignments are already cleaned up elsewhere.
--
-- route_plan_invoices.invoice_id is intentionally left as-is: deleting an
-- invoice while it's still assigned to a route plan/truck should keep
-- failing with a friendly message telling the user to unassign it first
-- (already handled in RecentInvoicesTable.tsx).
-- ============================================================================

alter table mondial_confirmations
  drop constraint mondial_confirmations_invoice_id_fkey;

alter table mondial_confirmations
  add constraint mondial_confirmations_invoice_id_fkey
  foreign key (invoice_id) references invoices(id) on delete cascade;

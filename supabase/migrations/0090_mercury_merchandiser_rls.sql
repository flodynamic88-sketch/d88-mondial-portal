-- ============================================================================
-- Mercury Merchandiser: SELECT + INSERT + UPDATE (no DELETE) across the flo
-- schema, Billing-adjacent tables included (view-only is enforced in the UI
-- layer, not by excluding these tables -- see note below), booklet_invoice_
-- status gets SELECT only (matches every other non-admin Mercury role).
-- ============================================================================
-- Context: migration 0052 opened the 21 non-Billing flo-schema admin_only
-- RLS policies to FLO_ASSOCIATE (full read/write) via
-- is_mondial_admin_or_flo_associate(), 0085 extended the same function to
-- LOGISTICS_OFFICER, and 0088 added a SELECT-only policy per table for
-- MERCURY_ASSOCIATE. Those are all single-purpose shapes (FOR ALL, or FOR
-- SELECT only) that don't fit MERCURY_MERCHANDISER's actual grant: it needs
-- SELECT + INSERT + UPDATE, but never DELETE -- delete stays admin-only
-- everywhere, same restriction every other non-admin Mercury role already
-- has. So instead of touching the existing ALL policies (admin-only delete
-- would otherwise either block everyone's deletes or open
-- MERCURY_MERCHANDISER's), this migration adds three new, separate
-- permissive policies per table (SELECT / INSERT / UPDATE). Postgres ORs
-- multiple permissive policies together per command, and requires a
-- matching policy to exist for INSERT/UPDATE to be allowed at all, so this
-- additively grants exactly those three commands without ever touching
-- DELETE.
--
-- Same 21 tables as 0052/0085/0088's list. Unlike FLO_ASSOCIATE/
-- MERCURY_ASSOCIATE, Billing is NOT excluded here: Billing/Booklet Summary
-- stay visible to MERCURY_MERCHANDISER (view-only, per explicit user
-- decision), and since Mercury has no dedicated Billing tables -- the
-- Billing and Booklet Summary pages read/write the very same
-- clients/delivery_headers tables every other Mercury page uses (see 0052's
-- own comments on this same limitation) -- RLS cannot distinguish a billing
-- read on delivery_headers from a normal delivery one anyway. The view-only
-- restriction for Billing/Booklet Summary is therefore enforced entirely at
-- the UI layer (nested RoleProvider forcing readOnly in
-- app/(app)/mercury/billing/layout.tsx and
-- app/(app)/mercury/booklet-summary/layout.tsx), same accepted trade-off
-- already documented for FLO_ASSOCIATE's exclusion.
--
-- booklet_invoice_status is the one table that IS genuinely isolable at the
-- DB layer (it's purely additive bookkeeping, not read by any other Mercury
-- page) -- MERCURY_MERCHANDISER gets SELECT only on it, so the (UI-blocked)
-- "Mark as Cancelled/Blank" action has no working RLS path even if someone
-- bypassed the UI gate.
-- ============================================================================

create or replace function public.is_mercury_merchandiser()
returns boolean
language sql
stable
security definer
as $function$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role = 'MERCURY_MERCHANDISER'
  );
$function$;

do $$
declare
  t text;
  tables text[] := array[
    'bad_order_headers',
    'bad_order_lines',
    'branches',
    'client_branch_links',
    'clients',
    'delivery_headers',
    'delivery_lines',
    'incident_report_attachments',
    'incident_reports',
    'items',
    'lookup_values',
    'po_lines',
    'profiles',
    'purchase_orders',
    'stock_movements',
    'stock_receipt_lines',
    'stock_receipts',
    'stock_request_lines',
    'stock_requests',
    'store_visit_headers',
    'store_visit_lines'
  ];
begin
  foreach t in array tables loop
    execute format(
      'create policy %I on flo.%I for select using (is_mercury_merchandiser());',
      t || '_mercury_merchandiser_select', t
    );
    execute format(
      'create policy %I on flo.%I for insert with check (is_mercury_merchandiser());',
      t || '_mercury_merchandiser_insert', t
    );
    execute format(
      'create policy %I on flo.%I for update using (is_mercury_merchandiser()) with check (is_mercury_merchandiser());',
      t || '_mercury_merchandiser_update', t
    );
  end loop;
end $$;

-- booklet_invoice_status: SELECT only (no insert/update/delete) -- keeps the
-- view-only Billing/Booklet Summary restriction genuinely enforced at the DB
-- layer for the one table where that's actually possible.
create policy booklet_invoice_status_mercury_merchandiser_select on flo.booklet_invoice_status
  for select using (is_mercury_merchandiser());

-- ============================================================================
-- Flo Associate: RLS access to the flo schema, everything except Billing
-- ============================================================================
-- Context: the `flo` schema (Mercury module) was set up directly in Supabase,
-- not via this repo's migrations (see 0040_flo_schema_write_grants.sql). It
-- has 22 tables with a single "<table>_admin_only" RLS policy each, all
-- using the same public.is_mondial_admin() function (ADMIN role only, see
-- its definition below for reference):
--
--   create or replace function public.is_mondial_admin()
--   returns boolean language sql stable security definer as $$
--     select exists (
--       select 1 from public.user_profiles
--       where id = auth.uid() and role = 'ADMIN'
--     );
--   $$;
--
-- Mercury has no dedicated "billing" tables -- the Billing and Booklet
-- Summary pages (app/(app)/mercury/billing, .../booklet-summary) read and
-- write the *same* clients/delivery_headers tables that every other Mercury
-- page uses, so RLS cannot distinguish a "billing" read/write on those
-- tables from a normal delivery/master-data one. The one exception is
-- `booklet_invoice_status`, which is used exclusively by booklet-summary
-- (grep confirms no other page touches it) -- so that table is deliberately
-- left out below and stays ADMIN-only, giving the Billing exclusion real
-- teeth at the database layer, not just a hidden nav link.
--
-- Everything else FLO_ASSOCIATE needs (deliveries, purchase orders,
-- warehouse/stock, store visits, incident reports, master data, Mercury's
-- own profiles table) is opened up via a new, separate function so
-- is_mondial_admin() itself -- and therefore true ADMIN-only tables like
-- booklet_invoice_status -- is untouched.
-- ============================================================================

create or replace function public.is_mondial_admin_or_flo_associate()
returns boolean
language sql
stable
security definer
as $function$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role in ('ADMIN', 'FLO_ASSOCIATE')
  );
$function$;

-- All 22 flo-schema admin_only policies, minus booklet_invoice_status (kept
-- on is_mondial_admin() so it stays ADMIN-only -- Billing exclusion).
alter policy bad_order_headers_admin_only on flo.bad_order_headers
  using (is_mondial_admin_or_flo_associate()) with check (is_mondial_admin_or_flo_associate());
alter policy bad_order_lines_admin_only on flo.bad_order_lines
  using (is_mondial_admin_or_flo_associate()) with check (is_mondial_admin_or_flo_associate());
alter policy branches_admin_only on flo.branches
  using (is_mondial_admin_or_flo_associate()) with check (is_mondial_admin_or_flo_associate());
alter policy client_branch_links_admin_only on flo.client_branch_links
  using (is_mondial_admin_or_flo_associate()) with check (is_mondial_admin_or_flo_associate());
alter policy clients_admin_only on flo.clients
  using (is_mondial_admin_or_flo_associate()) with check (is_mondial_admin_or_flo_associate());
alter policy delivery_headers_admin_only on flo.delivery_headers
  using (is_mondial_admin_or_flo_associate()) with check (is_mondial_admin_or_flo_associate());
alter policy delivery_lines_admin_only on flo.delivery_lines
  using (is_mondial_admin_or_flo_associate()) with check (is_mondial_admin_or_flo_associate());
alter policy incident_report_attachments_admin_only on flo.incident_report_attachments
  using (is_mondial_admin_or_flo_associate()) with check (is_mondial_admin_or_flo_associate());
alter policy incident_reports_admin_only on flo.incident_reports
  using (is_mondial_admin_or_flo_associate()) with check (is_mondial_admin_or_flo_associate());
alter policy items_admin_only on flo.items
  using (is_mondial_admin_or_flo_associate()) with check (is_mondial_admin_or_flo_associate());
alter policy lookup_values_admin_only on flo.lookup_values
  using (is_mondial_admin_or_flo_associate()) with check (is_mondial_admin_or_flo_associate());
alter policy po_lines_admin_only on flo.po_lines
  using (is_mondial_admin_or_flo_associate()) with check (is_mondial_admin_or_flo_associate());
alter policy profiles_admin_only on flo.profiles
  using (is_mondial_admin_or_flo_associate()) with check (is_mondial_admin_or_flo_associate());
alter policy purchase_orders_admin_only on flo.purchase_orders
  using (is_mondial_admin_or_flo_associate()) with check (is_mondial_admin_or_flo_associate());
alter policy stock_movements_admin_only on flo.stock_movements
  using (is_mondial_admin_or_flo_associate()) with check (is_mondial_admin_or_flo_associate());
alter policy stock_receipt_lines_admin_only on flo.stock_receipt_lines
  using (is_mondial_admin_or_flo_associate()) with check (is_mondial_admin_or_flo_associate());
alter policy stock_receipts_admin_only on flo.stock_receipts
  using (is_mondial_admin_or_flo_associate()) with check (is_mondial_admin_or_flo_associate());
alter policy stock_request_lines_admin_only on flo.stock_request_lines
  using (is_mondial_admin_or_flo_associate()) with check (is_mondial_admin_or_flo_associate());
alter policy stock_requests_admin_only on flo.stock_requests
  using (is_mondial_admin_or_flo_associate()) with check (is_mondial_admin_or_flo_associate());
alter policy store_visit_headers_admin_only on flo.store_visit_headers
  using (is_mondial_admin_or_flo_associate()) with check (is_mondial_admin_or_flo_associate());
alter policy store_visit_lines_admin_only on flo.store_visit_lines
  using (is_mondial_admin_or_flo_associate()) with check (is_mondial_admin_or_flo_associate());

-- booklet_invoice_status is intentionally NOT altered here -- it stays on
-- is_mondial_admin() (ADMIN only), which is the DB-level half of the Billing
-- exclusion for FLO_ASSOCIATE.

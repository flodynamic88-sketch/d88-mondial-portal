-- ============================================================================
-- Mercury Associate: SELECT-only RLS access to the flo schema, Billing
-- excluded entirely (same table left out as FLO_ASSOCIATE's exclusion).
-- ============================================================================
-- Context: migration 0052 opened the 21 non-Billing flo-schema admin_only
-- RLS policies to FLO_ASSOCIATE (full read/write) via
-- is_mondial_admin_or_flo_associate(), and 0085 extended the same function to
-- LOGISTICS_OFFICER. Those are single "FOR ALL" policies (one USING/WITH
-- CHECK pair covers SELECT/INSERT/UPDATE/DELETE), so they can't be reused for
-- a role that should only ever read.
--
-- MERCURY_ASSOCIATE needs real view-only enforcement at the database layer,
-- not just hidden UI controls -- so instead of touching the existing ALL
-- policies (which would either block everyone's writes or open
-- MERCURY_ASSOCIATE's), this migration adds a second, SELECT-only permissive
-- policy per table. Postgres OR's multiple permissive policies together per
-- command: the new SELECT policy grants MERCURY_ASSOCIATE read access, while
-- INSERT/UPDATE/DELETE stay governed solely by the existing ALL policy, whose
-- role check never includes MERCURY_ASSOCIATE -- so writes remain denied
-- regardless of the table-level INSERT/UPDATE/DELETE grants already given to
-- `authenticated` by migration 0040.
--
-- Same 21 tables as 0052/0085's is_mondial_admin_or_flo_associate() list,
-- booklet_invoice_status deliberately excluded -- the DB-level half of
-- keeping Billing/Booklet Summary fully inaccessible to MERCURY_ASSOCIATE
-- (matches FLO_ASSOCIATE's own exclusion, per explicit user decision to
-- exclude Billing entirely rather than allow view-only).
-- ============================================================================

create or replace function public.is_mercury_associate()
returns boolean
language sql
stable
security definer
as $function$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role = 'MERCURY_ASSOCIATE'
  );
$function$;

create policy bad_order_headers_mercury_associate_select on flo.bad_order_headers
  for select using (is_mercury_associate());
create policy bad_order_lines_mercury_associate_select on flo.bad_order_lines
  for select using (is_mercury_associate());
create policy branches_mercury_associate_select on flo.branches
  for select using (is_mercury_associate());
create policy client_branch_links_mercury_associate_select on flo.client_branch_links
  for select using (is_mercury_associate());
create policy clients_mercury_associate_select on flo.clients
  for select using (is_mercury_associate());
create policy delivery_headers_mercury_associate_select on flo.delivery_headers
  for select using (is_mercury_associate());
create policy delivery_lines_mercury_associate_select on flo.delivery_lines
  for select using (is_mercury_associate());
create policy incident_report_attachments_mercury_associate_select on flo.incident_report_attachments
  for select using (is_mercury_associate());
create policy incident_reports_mercury_associate_select on flo.incident_reports
  for select using (is_mercury_associate());
create policy items_mercury_associate_select on flo.items
  for select using (is_mercury_associate());
create policy lookup_values_mercury_associate_select on flo.lookup_values
  for select using (is_mercury_associate());
create policy po_lines_mercury_associate_select on flo.po_lines
  for select using (is_mercury_associate());
create policy profiles_mercury_associate_select on flo.profiles
  for select using (is_mercury_associate());
create policy purchase_orders_mercury_associate_select on flo.purchase_orders
  for select using (is_mercury_associate());
create policy stock_movements_mercury_associate_select on flo.stock_movements
  for select using (is_mercury_associate());
create policy stock_receipt_lines_mercury_associate_select on flo.stock_receipt_lines
  for select using (is_mercury_associate());
create policy stock_receipts_mercury_associate_select on flo.stock_receipts
  for select using (is_mercury_associate());
create policy stock_request_lines_mercury_associate_select on flo.stock_request_lines
  for select using (is_mercury_associate());
create policy stock_requests_mercury_associate_select on flo.stock_requests
  for select using (is_mercury_associate());
create policy store_visit_headers_mercury_associate_select on flo.store_visit_headers
  for select using (is_mercury_associate());
create policy store_visit_lines_mercury_associate_select on flo.store_visit_lines
  for select using (is_mercury_associate());

-- booklet_invoice_status is intentionally NOT given a MERCURY_ASSOCIATE
-- policy here -- it stays reachable only via is_mondial_admin() (ADMIN) and
-- is_mondial_admin_or_logistics_officer() (+ LOGISTICS_OFFICER), which is the
-- DB-level half of excluding Billing/Booklet Summary for MERCURY_ASSOCIATE.

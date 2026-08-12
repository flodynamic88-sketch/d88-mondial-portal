-- ============================================================================
-- Logistics Associate: full Encode Invoices access
-- ============================================================================
-- Logistics Associate now gets the same full (add/edit/delete) Encode
-- Invoices access as Logistics Officer/Admin. Previously the "invoices
-- insert/update/delete" policies (migration 0019) only covered
-- ADMIN/LOGISTICS_OFFICER, and LOGISTICS_ASSOCIATE had no access to the
-- Encode Invoices page at all (not in its RequireRole list). This migration
-- widens the write policies; the app-side page/nav role guards were updated
-- separately (app/(app)/encode/page.tsx, components/Sidebar.tsx).
-- ============================================================================

drop policy if exists "invoices insert" on invoices;
create policy "invoices insert" on invoices for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE'));

drop policy if exists "invoices update" on invoices;
create policy "invoices update" on invoices for update to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE'))
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE'));

drop policy if exists "invoices delete" on invoices;
create policy "invoices delete" on invoices for delete to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE'));

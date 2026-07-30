-- ============================================================================
-- Encode Invoices access update
-- ============================================================================
-- Logistics Officer now gets full Encode Invoices access (same level JMD
-- Planner previously had). JMD Planner's Encode Invoices access becomes
-- view-only -- the existing "invoices select" policy (select ... using
-- (true)) already covers that, so JMD Planner is simply removed from the
-- write policies here.
-- ============================================================================

drop policy if exists "invoices insert" on invoices;
create policy "invoices insert" on invoices for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER'));

drop policy if exists "invoices update" on invoices;
create policy "invoices update" on invoices for update to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER'))
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER'));

drop policy if exists "invoices delete" on invoices;
create policy "invoices delete" on invoices for delete to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER'));

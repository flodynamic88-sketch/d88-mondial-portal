-- ============================================================================
-- Invoicing Team role — RLS policy updates
-- ============================================================================
-- Visibility overhaul per updated role spec:
--   * Invoicing Team: full access to Mondial Confirmation; Transmittals is
--     view-only for them (the existing "select ... using (true)" policies
--     already cover that -- no insert/update/delete grants added here).
--   * Logistics Officer: no longer has any access to Transmittals (they
--     already had none on Billing/Final Billing at the RLS layer).
--   * JMD Planner: Route Plan access only -- removed from Transmittals
--     write policies (their page/nav access is removed separately in the
--     application layer).
-- ============================================================================

-- ── Mondial confirmations: add Invoicing Team ──────────────────────────────
drop policy if exists "mondial_confirmations insert" on mondial_confirmations;
create policy "mondial_confirmations insert" on mondial_confirmations for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','MONDIAL_TEAM','INVOICING_TEAM'));

drop policy if exists "mondial_confirmations update" on mondial_confirmations;
create policy "mondial_confirmations update" on mondial_confirmations for update to authenticated
  using (public.current_user_role() in ('ADMIN','MONDIAL_TEAM','INVOICING_TEAM'))
  with check (public.current_user_role() in ('ADMIN','MONDIAL_TEAM','INVOICING_TEAM'));

-- ── Transmittals: remove Logistics Officer and JMD Planner ─────────────────
drop policy if exists "transmittals insert" on transmittals;
create policy "transmittals insert" on transmittals for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_ASSOCIATE'));

drop policy if exists "transmittals update" on transmittals;
create policy "transmittals update" on transmittals for update to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_ASSOCIATE'))
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_ASSOCIATE'));

-- transmittals delete stays ADMIN-only; no change needed.

drop policy if exists "transmittal_items insert" on transmittal_items;
create policy "transmittal_items insert" on transmittal_items for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_ASSOCIATE'));

drop policy if exists "transmittal_items update" on transmittal_items;
create policy "transmittal_items update" on transmittal_items for update to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_ASSOCIATE'))
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_ASSOCIATE'));

drop policy if exists "transmittal_items delete" on transmittal_items;
create policy "transmittal_items delete" on transmittal_items for delete to authenticated
  using (public.current_user_role() = 'ADMIN');

-- ============================================================================
-- JMD Planner: allow editing Qty per Box on Route Plan
-- ============================================================================
-- The "route_plan_invoices update" policy (0003_user_management.sql) only
-- allowed ADMIN / LOGISTICS_ASSOCIATE / LOGISTICS_OFFICER to UPDATE rows on
-- route_plan_invoices. JMD Planner already has INSERT/DELETE rights there
-- (assign/unassign invoices to a truck) but was missing from UPDATE, so
-- typing a Qty/Box value as JMD Planner silently matched 0 rows under RLS --
-- no error, but nothing ever got saved.
--
-- Adding JMD_PLANNER here only actually exposes Qty/Box in the UI: the
-- Delivery Date / Reported Issue inputs in TruckCard.tsx are separately
-- gated to ADMIN/LOGISTICS_OFFICER/LOGISTICS_ASSOCIATE (canUpdateDelivery),
-- and service_rate_pct edits are independently blocked for non-Admin/
-- Logistics Officer by the trg_service_rate_edit trigger regardless of this
-- policy. So this change is scoped in practice to just Qty/Box.
-- ============================================================================

drop policy if exists "route_plan_invoices update" on route_plan_invoices;
create policy "route_plan_invoices update" on route_plan_invoices for update to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_ASSOCIATE','LOGISTICS_OFFICER','JMD_PLANNER'))
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_ASSOCIATE','LOGISTICS_OFFICER','JMD_PLANNER'));

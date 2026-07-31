-- ============================================================================
-- Logistics Officer: full Route Plan access (parity with JMD Planner)
-- ============================================================================
-- Logistics Officer already had INSERT/UPDATE/DELETE on route_plan_trucks
-- and UPDATE on route_plans (0003) and route_plan_invoices (0020), but was
-- missing from the tables/actions below, which blocked them from fully
-- managing a Route Plan end-to-end:
--   - route_plans insert   -> could not create a new Route Plan
--   - route_plans delete   -> could not delete a Route Plan
--   - route_plan_invoices insert -> could not assign an invoice to a truck
--   - route_plan_invoices delete -> could not unassign / reschedule an invoice
--
-- This grants Logistics Officer the same rights JMD Planner has on all four,
-- so they can create, edit, and delete Route Plans, add/remove trucks,
-- assign/unassign invoices, and edit Truck Details -- everything except
-- final Route Plan Approval, which stays Admin-only by design (Logistics
-- Officer's designated sign-off role is "Checked By", per
-- enforce_route_plan_signoff() in 0003_user_management.sql).
-- ============================================================================

drop policy if exists "route_plans insert" on route_plans;
create policy "route_plans insert" on route_plans for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','JMD_PLANNER','LOGISTICS_OFFICER'));

drop policy if exists "route_plans delete" on route_plans;
create policy "route_plans delete" on route_plans for delete to authenticated
  using (public.current_user_role() in ('ADMIN','JMD_PLANNER','LOGISTICS_OFFICER'));

drop policy if exists "route_plan_invoices insert" on route_plan_invoices;
create policy "route_plan_invoices insert" on route_plan_invoices for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','JMD_PLANNER','LOGISTICS_OFFICER'));

drop policy if exists "route_plan_invoices delete" on route_plan_invoices;
create policy "route_plan_invoices delete" on route_plan_invoices for delete to authenticated
  using (public.current_user_role() in ('ADMIN','JMD_PLANNER','LOGISTICS_OFFICER'));

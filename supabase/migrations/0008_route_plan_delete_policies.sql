-- ============================================================================
-- Route Plan delete policies
-- ============================================================================
-- 0003_user_management.sql enabled RLS on route_plans and route_plan_trucks
-- but never added a DELETE policy for either table (only route_plan_invoices
-- got one). With RLS enabled and no policy, Postgres denies the operation by
-- default, so deleting a route plan or a truck from the Route Plan UI was
-- silently impossible. This adds DELETE policies mirroring the existing
-- INSERT/UPDATE role sets for each table, so the Route Plan page can offer
-- "Delete Route Plan" and "Remove Truck" actions.
--
-- Cascade behavior (already in place from 0001_init.sql):
--   route_plan_trucks.route_plan_id -> route_plans(id) on delete cascade
--   route_plan_invoices.route_plan_truck_id -> route_plan_trucks(id) on delete cascade
-- So deleting a route plan removes its trucks and their assigned-invoice
-- rows automatically; the underlying `invoices` rows themselves are
-- untouched (they just become unassigned again).
-- ============================================================================

create policy "route_plans delete" on route_plans for delete to authenticated
  using (public.current_user_role() in ('ADMIN', 'JMD_PLANNER'));

create policy "route_plan_trucks delete" on route_plan_trucks for delete to authenticated
  using (public.current_user_role() in ('ADMIN', 'JMD_PLANNER', 'LOGISTICS_OFFICER'));

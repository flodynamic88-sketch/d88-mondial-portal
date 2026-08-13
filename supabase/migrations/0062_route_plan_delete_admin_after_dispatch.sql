-- ============================================================================
-- Route Plan delete: Admin-only once any truck has been dispatched
-- ============================================================================
-- 0008_route_plan_delete_policies.sql let ADMIN and JMD_PLANNER delete any
-- route_plans row (and ADMIN/JMD_PLANNER/LOGISTICS_OFFICER delete any
-- route_plan_trucks row) regardless of dispatch status. Once a truck has
-- been dispatched, its assigned invoices are effectively "in flight" and
-- shouldn't be unassignable by anyone other than an Admin -- deleting the
-- plan/truck at that point would silently detach delivered-or-in-transit
-- invoices from their billing trail.
--
-- This replaces both DELETE policies so that:
--   - ADMIN can still delete any route plan / truck, dispatched or not.
--   - JMD_PLANNER (route_plans) and JMD_PLANNER/LOGISTICS_OFFICER
--     (route_plan_trucks) can only delete when NO truck under that plan
--     (or the truck itself, for the trucks policy) has been dispatched yet.
--
-- This is enforced at the RLS layer so it can't be bypassed by calling
-- Supabase directly; RoutePlanBoard.tsx also blocks + explains this
-- client-side for a clean error message instead of a raw RLS failure.
-- ============================================================================

drop policy if exists "route_plans delete" on route_plans;
drop policy if exists "route_plan_trucks delete" on route_plan_trucks;

create policy "route_plans delete" on route_plans for delete to authenticated
  using (
    public.current_user_role() = 'ADMIN'
    or (
      public.current_user_role() = 'JMD_PLANNER'
      and not exists (
        select 1 from route_plan_trucks rpt
        where rpt.route_plan_id = route_plans.id
          and rpt.dispatched_at is not null
      )
    )
  );

create policy "route_plan_trucks delete" on route_plan_trucks for delete to authenticated
  using (
    public.current_user_role() = 'ADMIN'
    or (
      public.current_user_role() in ('JMD_PLANNER', 'LOGISTICS_OFFICER')
      and dispatched_at is null
    )
  );

-- ============================================================================
-- Enable Supabase Realtime on Route Plan tables
-- ============================================================================
-- Route Plan today only ever refreshes when the viewing user does something
-- themselves (add a truck, assign an invoice, etc.) -- another user's edits
-- on the same route plan (e.g. JMD Planner adding a drop while Logistics
-- Officer is dispatching a truck) never show up until a manual browser
-- refresh. This adds route_plans/route_plan_trucks/route_plan_invoices to
-- the supabase_realtime publication so the client can subscribe to
-- postgres_changes and patch state in place (see RoutePlanBoard.tsx /
-- TruckCard.tsx) instead of requiring a full page reload.
--
-- Guarded with a DO block + pg_publication_tables check since
-- "ALTER PUBLICATION ... ADD TABLE" has no IF NOT EXISTS form and errors if
-- the table is already a member (e.g. if this is re-run by hand).
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'route_plans'
  ) then
    alter publication supabase_realtime add table public.route_plans;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'route_plan_trucks'
  ) then
    alter publication supabase_realtime add table public.route_plan_trucks;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'route_plan_invoices'
  ) then
    alter publication supabase_realtime add table public.route_plan_invoices;
  end if;
end $$;

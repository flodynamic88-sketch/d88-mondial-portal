-- ============================================================================
-- JMD Admin: view-only visibility into the Route Plan truck rate
-- ============================================================================
-- JMD_ADMIN's entire access is a view-only Route Plan (see 0035_jmd_admin_role.sql
-- and Sidebar.tsx/RequireRole gates) -- they cannot edit anything, but they
-- were never given SELECT visibility into truck_rate itself, since the
-- masking CASE in v_route_plan_trucks (rebuilt most recently in
-- 0040_negotiated_truck_rate.sql) only allow-listed ADMIN/LOGISTICS_OFFICER.
-- This adds JMD_ADMIN to that allow-list so they can see the rate in Route
-- Plan. No write path is affected: enforce_truck_rate_edit() and the
-- route_plan_trucks UPDATE RLS policy are untouched, and TruckCard.tsx's
-- canEditTruckDetails gate (which controls the only path into edit mode)
-- still excludes JMD_ADMIN, so this is read-only.
-- ============================================================================

create or replace view v_route_plan_trucks
with (security_invoker = false) as
select
  t.id,
  t.route_plan_id,
  t.plate_number,
  t.carrier,
  case when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','JMD_ADMIN') then t.truck_rate else null end as truck_rate,
  t.is_convoy,
  t.main_truck_id,
  t.dispatched_at,
  t.created_at,
  t.driver_name,
  t.helper1_name,
  t.helper2_name,
  t.destination,
  case when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE') then tr.area else null end as area,
  t.contact_number,
  t.is_negotiated_rate
from route_plan_trucks t
left join trucking_rates tr on tr.destination = t.destination;

grant select on v_route_plan_trucks to authenticated;

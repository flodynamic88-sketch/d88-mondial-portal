-- ============================================================================
-- Driver + Helpers per truck
-- ============================================================================
-- Each truck in a Route Plan should record who's assigned to it: one Driver
-- and up to two Helpers, entered once when the truck is added (alongside
-- plate_number/carrier) and shown read-only afterwards, matching the existing
-- plate_number/carrier UX in AddTruckForm.tsx / TruckCard.tsx.
-- ============================================================================

alter table route_plan_trucks
  add column if not exists driver_name text,
  add column if not exists helper1_name text,
  add column if not exists helper2_name text;

-- Extend the column-level grant added in 0003_user_management.sql (which
-- revoked table-wide SELECT and re-granted it column-by-column, excluding
-- truck_rate) so the new columns are readable the same way as
-- plate_number/carrier -- i.e. by everyone, unlike truck_rate which stays
-- masked to Admin/Logistics Officer via the view below.
revoke select on route_plan_trucks from authenticated;
grant select (
  id, route_plan_id, plate_number, carrier, is_convoy, main_truck_id,
  dispatched_at, created_at, driver_name, helper1_name, helper2_name
) on route_plan_trucks to authenticated;

create or replace view v_route_plan_trucks
with (security_invoker = false) as
select
  t.id,
  t.route_plan_id,
  t.plate_number,
  t.carrier,
  case
    when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER') then t.truck_rate
    else null
  end as truck_rate,
  t.is_convoy,
  t.main_truck_id,
  t.dispatched_at,
  t.created_at,
  t.driver_name,
  t.helper1_name,
  t.helper2_name
from route_plan_trucks t;

grant select on v_route_plan_trucks to authenticated;

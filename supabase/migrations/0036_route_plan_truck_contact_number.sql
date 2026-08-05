-- Adds an editable contact number to each route plan truck, so the per-day
-- "Delivery Route" report can show/edit a contact # before printing/export.

alter table route_plan_trucks
  add column if not exists contact_number text;

-- Column-level grants must be re-declared in full (they replace, not add).
revoke select on route_plan_trucks from authenticated;
grant select (
  id, route_plan_id, plate_number, carrier, is_convoy, main_truck_id,
  dispatched_at, created_at, driver_name, helper1_name, helper2_name,
  destination, contact_number
) on route_plan_trucks to authenticated;

-- Every authenticated role may edit the contact number from the report page.
grant update (contact_number) on route_plan_trucks to authenticated;

-- Note: CREATE OR REPLACE VIEW cannot reorder or rename existing output
-- columns -- new columns must be appended at the end, so contact_number
-- goes after area (not next to destination) despite the logical grouping.
create or replace view v_route_plan_trucks
with (security_invoker = false) as
select
  t.id,
  t.route_plan_id,
  t.plate_number,
  t.carrier,
  case when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER') then t.truck_rate else null end as truck_rate,
  t.is_convoy,
  t.main_truck_id,
  t.dispatched_at,
  t.created_at,
  t.driver_name,
  t.helper1_name,
  t.helper2_name,
  t.destination,
  case when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE') then tr.area else null end as area,
  t.contact_number
from route_plan_trucks t
left join trucking_rates tr on tr.destination = t.destination;

grant select on v_route_plan_trucks to authenticated;

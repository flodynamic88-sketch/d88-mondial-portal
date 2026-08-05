-- Restrict setting/changing route_plan_trucks.destination to ADMIN and
-- LOGISTICS_OFFICER only. Per business feedback: the destination should be
-- allowed to be filled in later (after the route plan/truck already exists),
-- and only by Officer/Admin -- it must never block JMD Planner from creating
-- a truck or route plan. A JMD Planner insert that simply leaves destination
-- null must always succeed unobstructed; only an actual attempt to set/change
-- destination to a non-null value by a non-Officer/Admin role is rejected.
--
-- This mirrors the exact enforcement pattern already used for truck_rate in
-- enforce_truck_rate_edit() (0033_trucking_rates.sql). We extend that same
-- function rather than adding a second trigger, since trg_truck_rate_edit
-- (0003_user_management.sql) already fires "before insert or update" and
-- calls this function -- no trigger re-attachment is needed here.

create or replace function public.enforce_truck_rate_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role := public.current_user_role();
  v_has_convoy boolean;
  v_rate numeric;
begin
  if new.main_truck_id is not null then
    new.truck_rate := null;
    return new;
  end if;

  -- Destination can only be set or changed by Admin/Logistics Officer. A
  -- null destination never blocks anything (JMD Planner can freely create
  -- and edit trucks without ever touching this field); only a non-null
  -- new value that differs from the existing one is gated.
  if new.destination is not null
     and (tg_op = 'INSERT' or new.destination is distinct from old.destination)
     and v_role not in ('ADMIN', 'LOGISTICS_OFFICER') then
    raise exception 'Only Logistics Officer or Admin can set the destination.';
  end if;

  if new.destination is not null then
    v_has_convoy := exists (
      select 1 from route_plan_trucks where main_truck_id = new.id
    );
    select case when v_has_convoy then convoy_rate else rate end
      into v_rate
      from trucking_rates
      where destination = new.destination;
    if v_rate is not null then
      new.truck_rate := v_rate;
      return new;
    end if;
  end if;

  if (tg_op = 'UPDATE' and new.truck_rate is distinct from old.truck_rate
      and v_role not in ('ADMIN','LOGISTICS_OFFICER')) then
    raise exception 'Only Logistics Officer or Admin can set the trucking rate.';
  end if;
  if (tg_op = 'INSERT' and new.truck_rate is not null
      and v_role not in ('ADMIN','LOGISTICS_OFFICER')) then
    raise exception 'Only Logistics Officer or Admin can set the trucking rate.';
  end if;
  return new;
end;
$$;

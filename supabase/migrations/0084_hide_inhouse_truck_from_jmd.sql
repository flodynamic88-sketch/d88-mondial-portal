-- ============================================================================
-- Hide in-house (D88-owned) truck deliveries from JMD
-- ============================================================================
-- Request: when D88 dispatches its own truck instead of paying JMD to carry
-- a load, JMD should not be able to see what that truck is delivering.
--
-- Until now there was no explicit "in-house" flag on route_plan_trucks --
-- migration 0083 inferred it from truck_rate IS NULL for CTS purposes. That
-- heuristic is NOT safe to reuse here: JMD_PLANNER itself is blocked from
-- setting truck_rate (enforce_truck_rate_edit(), 0003/0033/0034/0040), so a
-- brand-new JMD truck also has truck_rate = null until an Admin/Logistics
-- Officer fills it in later -- a null-rate-based hide would risk hiding
-- JMD's own freshly-added trucks from JMD. So this adds a real, explicit
-- flag instead, set only by ADMIN/LOGISTICS_OFFICER (same gate as
-- truck_rate/destination/is_negotiated_rate).
--
-- Scope of the hide: the truck row itself stays visible to JMD_PLANNER/
-- JMD_ADMIN (so the route plan's truck count/plate list still looks
-- complete), but:
--   1. the is_inhouse flag itself is masked to false for JMD in
--      v_route_plan_trucks -- JMD never even sees the label.
--   2. every route_plan_invoices row linked to an in-house truck is hidden
--      from JMD via a role-aware SELECT policy -- this is a raw-table RLS
--      policy (not just a view), so it applies uniformly to every read path
--      already in the app that queries route_plan_invoices directly:
--      TruckCard.tsx's assigned-invoice list, RoutePlanBoard.tsx's Excel
--      export, and the print/[truckId] + print/day/[planId] Delivery
--      Itinerary pages (neither of which carry a RequireRole guard, so this
--      also closes that gap).
--   3. JMD_PLANNER is additionally blocked from *inserting* a new invoice
--      assignment onto an in-house truck, so they can't accidentally assign
--      something that would immediately vanish from their own view.
-- ============================================================================

alter table route_plan_trucks
  add column if not exists is_inhouse boolean not null default false;

-- Extend the column-level grant re-declared in 0003/0014/0033/0036/0040 so
-- is_inhouse is readable the same way as the other plain columns -- however,
-- unlike those, is_inhouse is intentionally OMITTED from this raw-table
-- grant list, mirroring how truck_rate is excluded: the only sanctioned read
-- path is v_route_plan_trucks below, which masks it for JMD.
revoke select on route_plan_trucks from authenticated;
grant select (
  id, route_plan_id, plate_number, carrier, is_convoy, main_truck_id,
  dispatched_at, created_at, driver_name, helper1_name, helper2_name,
  destination, contact_number, is_negotiated_rate
) on route_plan_trucks to authenticated;

-- Column-level rule: only Admin/Logistics Officer can set is_inhouse --
-- same gate as truck_rate/destination/is_negotiated_rate. Rebuilt from
-- 0040's version (the current one) rather than 0003's, since 0033/0034/0040
-- added destination auto-lookup + negotiated-rate + convoy-nulling logic
-- that must be preserved. Adds:
--   * is_inhouse forced false for convoy sub-trucks, same as truck_rate/
--     is_negotiated_rate -- a convoy's in-house status is determined by its
--     main truck (see the route_plan_invoices SELECT/INSERT policies below,
--     which walk up to main_truck_id), not carried on the sub-truck row.
--   * is_inhouse itself is Admin/Logistics Officer only -- same gate as
--     destination/is_negotiated_rate.
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
    new.is_negotiated_rate := false;
    new.is_inhouse := false;
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

  -- Negotiated-rate flag: same gate as destination, since flipping it on is
  -- what unlocks a manual truck_rate even when a destination is set.
  if new.is_negotiated_rate
     and (tg_op = 'INSERT' or new.is_negotiated_rate is distinct from old.is_negotiated_rate)
     and v_role not in ('ADMIN', 'LOGISTICS_OFFICER') then
    raise exception 'Only Logistics Officer or Admin can set a negotiated rate.';
  end if;

  -- In-house flag: same gate as destination/is_negotiated_rate.
  if new.is_inhouse
     and (tg_op = 'INSERT' or new.is_inhouse is distinct from old.is_inhouse)
     and v_role not in ('ADMIN', 'LOGISTICS_OFFICER') then
    raise exception 'Only Logistics Officer or Admin can set the in-house flag.';
  end if;

  -- Negotiated rate: skip the destination-based auto-lookup entirely -- the
  -- typed-in truck_rate is used as-is (still gated below like any other
  -- manual entry).
  if not new.is_negotiated_rate and new.destination is not null then
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

-- Rebuilt from 0041's version (the current one, which already added
-- JMD_ADMIN to the truck_rate allow-list). is_inhouse is masked to false for
-- JMD_PLANNER/JMD_ADMIN -- they never see the label at all, on top of the
-- invoice-hiding policy below.
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
  t.is_negotiated_rate,
  case
    when public.current_user_role() in ('JMD_PLANNER','JMD_ADMIN') then false
    else t.is_inhouse
  end as is_inhouse
from route_plan_trucks t
left join trucking_rates tr on tr.destination = t.destination;

grant select on v_route_plan_trucks to authenticated;

-- Helper: is this specific truck row (or its main truck, if it's a convoy
-- sub-truck) flagged in-house? is_inhouse is forced false on convoy rows by
-- the trigger above, so a convoy truck's in-house status always comes from
-- its main truck -- this walks up that one level so invoices assigned
-- directly to a convoy sub-truck are hidden too.
create or replace function public.truck_is_inhouse(p_truck_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(t.is_inhouse, false)
    or coalesce((select mt.is_inhouse from route_plan_trucks mt where mt.id = t.main_truck_id), false)
  from route_plan_trucks t
  where t.id = p_truck_id;
$$;

-- ── route_plan_invoices: hide rows delivered by an in-house truck from JMD ──
-- Replaces the wide-open "using (true)" SELECT policy from 0003 (never
-- redefined since) with a role-aware one. Every other role keeps full
-- visibility; JMD_PLANNER/JMD_ADMIN lose visibility only into rows whose
-- truck (or that truck's main truck, if it's a convoy) is flagged is_inhouse.
--
-- Note (see 0021_route_plan_trucks_select_policy.sql): Postgres RLS needs a
-- matching SELECT policy to even locate a row for UPDATE/DELETE. That means
-- this same restriction also silently blocks JMD_PLANNER's own UPDATE/DELETE
-- against an in-house truck's invoice rows (can't unassign/edit delivery
-- info on something they can't see) -- consistent with the intent that JMD
-- has no business interacting with an in-house delivery at all.
drop policy if exists "route_plan_invoices select" on route_plan_invoices;
create policy "route_plan_invoices select" on route_plan_invoices for select to authenticated using (
  public.current_user_role() not in ('JMD_PLANNER','JMD_ADMIN')
  or not public.truck_is_inhouse(route_plan_invoices.route_plan_truck_id)
);

-- INSERT policy (last redefined in 0022_logistics_officer_route_plan_full_access.sql)
-- gets the same in-house guard, scoped to JMD_PLANNER (the only JMD role that
-- could insert here in the first place) -- prevents JMD from assigning an
-- invoice onto an in-house truck and having it immediately disappear from
-- their own view under the SELECT policy above.
drop policy if exists "route_plan_invoices insert" on route_plan_invoices;
create policy "route_plan_invoices insert" on route_plan_invoices for insert to authenticated
  with check (
    public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER')
    or (
      public.current_user_role() = 'JMD_PLANNER'
      and not public.truck_is_inhouse(route_plan_truck_id)
    )
  );

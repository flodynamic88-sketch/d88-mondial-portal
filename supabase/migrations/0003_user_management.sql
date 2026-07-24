-- ============================================================================
-- User management, roles, and Row Level Security (RLS)
-- ============================================================================
-- Roles:
--   ADMIN                 - Logistics Manager. Full access everywhere,
--                            including approving route plans and managing
--                            user accounts.
--   LOGISTICS_OFFICER      - Sets trucking rate on route plan trucks and is
--                            the "Checked By" on route plans.
--   JMD_PLANNER            - Creates route plans, adds trucks, dispatches.
--                            Is the "Prepared By". Cannot see truck rate or
--                            CTS percentage (Pass/Not Pass only).
--   MONDIAL_TEAM            - Confirms billing (mondial_confirmations).
--                            View-only everywhere else.
--   LOGISTICS_ASSOCIATE    - Updates actual delivery date and
--                            discrepancy/backload reason on the Route Plan.
--   GENERAL_MANAGER         - View access to everything, no writes.
-- ============================================================================

create type user_role as enum (
  'ADMIN',
  'LOGISTICS_OFFICER',
  'JMD_PLANNER',
  'MONDIAL_TEAM',
  'LOGISTICS_ASSOCIATE',
  'GENERAL_MANAGER'
);

create table user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  full_name text,
  role user_role not null,
  created_at timestamptz default now()
);

-- Resolves the role of the currently authenticated user. SECURITY DEFINER
-- so it can read user_profiles regardless of that table's own RLS policies
-- (it only ever returns the caller's own role, looked up by auth.uid()).
create or replace function public.current_user_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from user_profiles where id = auth.uid();
$$;

alter table user_profiles enable row level security;

create policy "profiles readable by authenticated"
  on user_profiles for select
  to authenticated
  using (true);

create policy "profiles writable by admin"
  on user_profiles for all
  to authenticated
  using (public.current_user_role() = 'ADMIN')
  with check (public.current_user_role() = 'ADMIN');

-- ── Enable RLS on business tables ──────────────────────────────────────────
alter table companies enable row level security;
alter table branch_addresses enable row level security;
alter table fee_rates enable row level security;
alter table delivery_reasons enable row level security;
alter table invoices enable row level security;
alter table route_plans enable row level security;
alter table route_plan_trucks enable row level security;
alter table route_plan_invoices enable row level security;
alter table mondial_confirmations enable row level security;

-- Lock down anonymous (not-logged-in) access entirely; everything now
-- requires a logged-in Supabase Auth session.
revoke all on companies, branch_addresses, fee_rates, delivery_reasons,
  invoices, route_plans, route_plan_trucks, route_plan_invoices,
  mondial_confirmations
  from anon;

-- ── Reference data (companies / branch addresses) ──────────────────────────
create policy "companies select" on companies for select to authenticated using (true);
create policy "companies insert" on companies for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','JMD_PLANNER'));

create policy "branch_addresses select" on branch_addresses for select to authenticated using (true);
create policy "branch_addresses insert" on branch_addresses for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','JMD_PLANNER'));

-- ── Fee rates (static reference; Admin-managed) ─────────────────────────────
create policy "fee_rates select" on fee_rates for select to authenticated using (true);
create policy "fee_rates write" on fee_rates for all to authenticated
  using (public.current_user_role() = 'ADMIN')
  with check (public.current_user_role() = 'ADMIN');

-- ── Delivery reasons (discrepancy/backload lookup, incl. custom entries) ───
create policy "delivery_reasons select" on delivery_reasons for select to authenticated using (true);
create policy "delivery_reasons insert" on delivery_reasons for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_ASSOCIATE'));

-- ── Invoices (Encode Invoices page) ─────────────────────────────────────────
create policy "invoices select" on invoices for select to authenticated using (true);
create policy "invoices insert" on invoices for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','JMD_PLANNER'));
create policy "invoices update" on invoices for update to authenticated
  using (public.current_user_role() in ('ADMIN','JMD_PLANNER'))
  with check (public.current_user_role() in ('ADMIN','JMD_PLANNER'));
create policy "invoices delete" on invoices for delete to authenticated
  using (public.current_user_role() in ('ADMIN','JMD_PLANNER'));

-- ── Route plans ──────────────────────────────────────────────────────────
create policy "route_plans select" on route_plans for select to authenticated using (true);
create policy "route_plans insert" on route_plans for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','JMD_PLANNER'));
create policy "route_plans update" on route_plans for update to authenticated
  using (public.current_user_role() in ('ADMIN','JMD_PLANNER','LOGISTICS_OFFICER'))
  with check (public.current_user_role() in ('ADMIN','JMD_PLANNER','LOGISTICS_OFFICER'));

-- Column-level rule: only Admin can approve; only Admin/Logistics Officer
-- can set Checked By.
create or replace function public.enforce_route_plan_signoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role := public.current_user_role();
begin
  if (new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at)
     and v_role <> 'ADMIN' then
    raise exception 'Only Admin can approve a route plan.';
  end if;

  if (new.checked_by is distinct from old.checked_by)
     and v_role not in ('ADMIN','LOGISTICS_OFFICER') then
    raise exception 'Only Logistics Officer or Admin can set Checked By.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_route_plan_signoff on route_plans;
create trigger trg_route_plan_signoff
  before update on route_plans
  for each row execute function public.enforce_route_plan_signoff();

-- ── Route plan trucks ────────────────────────────────────────────────────
create policy "route_plan_trucks insert" on route_plan_trucks for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','JMD_PLANNER','LOGISTICS_OFFICER'));
create policy "route_plan_trucks update" on route_plan_trucks for update to authenticated
  using (public.current_user_role() in ('ADMIN','JMD_PLANNER','LOGISTICS_OFFICER'))
  with check (public.current_user_role() in ('ADMIN','JMD_PLANNER','LOGISTICS_OFFICER'));

-- Column-level rule: only Admin/Logistics Officer can set truck_rate.
create or replace function public.enforce_truck_rate_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role := public.current_user_role();
begin
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

drop trigger if exists trg_truck_rate_edit on route_plan_trucks;
create trigger trg_truck_rate_edit
  before insert or update on route_plan_trucks
  for each row execute function public.enforce_truck_rate_edit();

-- No plain SELECT policy is created on the raw route_plan_trucks table on
-- purpose: reads must go through v_route_plan_trucks below, which masks
-- truck_rate for roles other than Admin/Logistics Officer. We revoke
-- table-wide SELECT and re-grant it column-by-column, excluding
-- truck_rate, so the raw table can't be queried directly (e.g. straight
-- REST API calls) to bypass the mask, while UPDATE/INSERT statements that
-- filter by id (and don't touch truck_rate) still work normally.
revoke select on route_plan_trucks from authenticated;
grant select (
  id, route_plan_id, plate_number, carrier, is_convoy, main_truck_id,
  dispatched_at, created_at
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
  t.created_at
from route_plan_trucks t;

grant select on v_route_plan_trucks to authenticated;

-- ── Route plan invoices (assignment + delivered/reason updates) ───────────
create policy "route_plan_invoices select" on route_plan_invoices for select to authenticated using (true);
create policy "route_plan_invoices insert" on route_plan_invoices for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','JMD_PLANNER'));
create policy "route_plan_invoices update" on route_plan_invoices for update to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_ASSOCIATE','LOGISTICS_OFFICER'))
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_ASSOCIATE','LOGISTICS_OFFICER'));
create policy "route_plan_invoices delete" on route_plan_invoices for delete to authenticated
  using (public.current_user_role() in ('ADMIN','JMD_PLANNER'));

-- Column-level rule: only Admin/Logistics Officer can set service_rate_pct.
create or replace function public.enforce_service_rate_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role := public.current_user_role();
begin
  if new.service_rate_pct is distinct from old.service_rate_pct
     and v_role not in ('ADMIN','LOGISTICS_OFFICER') then
    raise exception 'Only Logistics Officer or Admin can set the service rate.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_service_rate_edit on route_plan_invoices;
create trigger trg_service_rate_edit
  before update on route_plan_invoices
  for each row execute function public.enforce_service_rate_edit();

-- ── Mondial confirmations ──────────────────────────────────────────────────
create policy "mondial_confirmations select" on mondial_confirmations for select to authenticated using (true);
create policy "mondial_confirmations insert" on mondial_confirmations for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','MONDIAL_TEAM'));
create policy "mondial_confirmations update" on mondial_confirmations for update to authenticated
  using (public.current_user_role() in ('ADMIN','MONDIAL_TEAM'))
  with check (public.current_user_role() in ('ADMIN','MONDIAL_TEAM'));

-- ============================================================================
-- CTS Pass/Fail threshold
-- Passing CTS is 5% and below; above 5% is a fail (flagged red in the UI).
-- JMD Planner only sees the Pass/Not Pass flag, not the raw percentage or
-- underlying truck rate / total invoice amount.
-- ============================================================================

drop view if exists v_truck_cts;

create or replace view v_truck_cts
with (security_invoker = false) as
select
  t.id as truck_id,
  t.route_plan_id,
  t.plate_number,
  case
    when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER') then t.truck_rate
    else null
  end as truck_rate,
  case
    when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER') then sum(i.amount)
    else null
  end as total_invoice_amount,
  case
    when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER')
      then round(100.0 * t.truck_rate / nullif(sum(i.amount),0), 2)
    else null
  end as cts_pct,
  (round(100.0 * t.truck_rate / nullif(sum(i.amount),0), 2) <= 5) as cts_pass
from route_plan_trucks t
join route_plan_invoices rpi on rpi.route_plan_truck_id = t.id
join invoices i on i.id = rpi.invoice_id
group by t.id, t.route_plan_id, t.plate_number, t.truck_rate;

grant select on v_truck_cts to authenticated;

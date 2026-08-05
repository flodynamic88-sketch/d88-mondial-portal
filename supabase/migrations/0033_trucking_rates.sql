-- ============================================================================
-- Trucking Rates: destination-based rate table + fully automatic rate lookup
-- ============================================================================
-- Today truck_rate on route_plan_trucks is typed in by hand (Admin/Logistics
-- Officer only). JMD's own rate card is actually a fixed table keyed by
-- delivery destination -- one rate for a standalone/main truck, a higher
-- "convoy rate" when that truck has one or more convoy trucks riding with
-- it (see AddTruckForm.tsx: convoy trucks never carry their own rate, the
-- main truck's rate already covers the whole group).
--
-- This migration:
--   1. Adds trucking_rates (destination -> area/rate/convoy_rate), seeded
--      from JMD's 67-destination rate card. rate/convoy_rate are masked to
--      ADMIN/LOGISTICS_OFFICER the same way route_plan_trucks.truck_rate is
--      -- these are cost figures, area/destination are not.
--   2. Adds route_plan_trucks.destination and rewrites the truck_rate
--      trigger so truck_rate is *derived*, not typed, whenever a
--      destination is set: looked up from trucking_rates, automatically
--      switching between plain/convoy rate as convoy trucks are added or
--      removed from the group. No manual override once destination is set.
--      Legacy rows with no destination keep the old manual-entry behavior
--      (still Admin/Logistics Officer only) as a fallback.
--   3. Exposes destination (unmasked, like plate_number) and area (masked
--      to ADMIN/LOGISTICS_OFFICER/LOGISTICS_ASSOCIATE only) on
--      v_route_plan_trucks.
-- ============================================================================

-- ── Rate table ──────────────────────────────────────────────────────────────
create table trucking_rates (
  id uuid primary key default gen_random_uuid(),
  destination text not null unique,
  area text not null,
  rate numeric(14,2) not null,
  convoy_rate numeric(14,2) not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_trucking_rates_touch on trucking_rates;
create trigger trg_trucking_rates_touch
  before update on trucking_rates
  for each row execute function public.touch_updated_at();

alter table trucking_rates enable row level security;
revoke all on trucking_rates from anon;

create policy "trucking_rates select" on trucking_rates for select to authenticated using (true);
create policy "trucking_rates insert" on trucking_rates for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER'));
create policy "trucking_rates update" on trucking_rates for update to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER'))
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER'));
create policy "trucking_rates delete" on trucking_rates for delete to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER'));

-- Same masking pattern as route_plan_trucks.truck_rate (0003): revoke
-- table-wide SELECT, re-grant column-by-column excluding rate/convoy_rate,
-- so a straight REST/table query can't read the rate figures -- only the
-- view below can, and only for the right roles.
revoke select on trucking_rates from authenticated;
grant select (id, destination, area, created_at, updated_at) on trucking_rates to authenticated;

create or replace view v_trucking_rates
with (security_invoker = false) as
select
  r.id,
  r.destination,
  r.area,
  case when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER') then r.rate else null end as rate,
  case when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER') then r.convoy_rate else null end as convoy_rate,
  r.created_at,
  r.updated_at
from trucking_rates r;

grant select on v_trucking_rates to authenticated;

-- ── Seed: JMD 4W rate card (67 destinations) ────────────────────────────────
insert into trucking_rates (destination, area, rate, convoy_rate) values
  ('MEYCAUAYAN','BULACAN',10290.00,17050.00),
  ('MARILAO','BULACAN',10185.00,16940.00),
  ('BOCAUE','BULACAN',10395.00,17160.00),
  ('STA MARIA','BULACAN',10395.00,17600.00),
  ('GUIGUINTO','BULACAN',10500.00,17820.00),
  ('PLARIDEL','BULACAN',10605.00,18150.00),
  ('MALOLOS','BULACAN',10710.00,18150.00),
  ('BALIUAG','BULACAN',13020.00,19250.00),
  ('APALIT','PAMPANGA',14070.00,21450.00),
  ('MEXICO','PAMPANGA',14805.00,23100.00),
  ('SAN FERNANDO','PAMPANGA',14490.00,24750.00),
  ('ANGELES','PAMPANGA',15540.00,26400.00),
  ('MABALACAT','PAMPANGA',15960.00,26950.00),
  ('CAPAS','TARLAC',15225.00,25850.00),
  ('SAN RAFAEL','TARLAC',16275.00,27500.00),
  ('PANIQUI','TARLAC',17325.00,30250.00),
  ('CAMILING','TARLAC',17640.00,30800.00),
  ('GERONA','TARLAC',17115.00,29700.00),
  ('CONCEPCION','TARLAC',15225.00,25850.00),
  ('FAIRVIEW','NCR',7770.00,12210.00),
  ('QUEZON CITY','NCR',7560.00,11660.00),
  ('MANDALUYONG','NCR',7245.00,11110.00),
  ('PASAY','NCR',7140.00,10890.00),
  ('TAGUIG','NCR',7035.00,10780.00),
  ('MALABON','NCR',7560.00,11770.00),
  ('NAVOTAS','NCR',7560.00,11770.00),
  ('CALOOCAN','NCR',7455.00,11550.00),
  ('PATEROS','NCR',7245.00,11000.00),
  ('VALENZUELA','NCR',7560.00,11660.00),
  ('MARIKINA','NCR',7455.00,11550.00),
  ('MANILA','NCR',7350.00,11330.00),
  ('SAN JUAN','NCR',7350.00,11220.00),
  ('PASIG','NCR',7245.00,11220.00),
  ('MAKATI','NCR',7140.00,11000.00),
  ('PARAÑAQUE','NCR',6720.00,9790.00),
  ('LAS PIÑAS','NCR',6700.00,10200.00),
  ('ALABANG','NCR',6142.50,9130.00),
  ('MUNTINLUPA','NCR',5985.00,8800.00),
  ('CAINTA','NCR',7350.00,11440.00),
  ('ANTIPOLO','RIZAL',7350.00,11330.00),
  ('TAYTAY','RIZAL',7140.00,11000.00),
  ('MONTALBAN','RIZAL',7875.00,12430.00),
  ('TANAY','RIZAL',8400.00,13400.00),
  ('PILILLA','RIZAL',8400.00,12870.00),
  ('BACOOR','CAVITE',6300.00,9350.00),
  ('DASMARIÑAS','CAVITE',6090.00,9020.00),
  ('IMUS','CAVITE',6300.00,9570.00),
  ('GEN TRIAS','CAVITE',6300.00,9570.00),
  ('TANZA','CAVITE',6300.00,9570.00),
  ('TRECE MARTIRES','CAVITE',6090.00,9350.00),
  ('NAIC','CAVITE',6510.00,10010.00),
  ('AMADEO','CAVITE',6195.00,9240.00),
  ('SILANG','CAVITE',6615.00,10230.00),
  ('KAWIT','CAVITE',6720.00,10400.00),
  ('SAN PEDRO','LAGUNA',5670.00,8470.00),
  ('STA ROSA','LAGUNA',5670.00,8300.00),
  ('CABUYAO','LAGUNA',5900.00,8900.00),
  ('CALAMBA','LAGUNA',6300.00,9400.00),
  ('ALAMINOS','LAGUNA',6900.00,10600.00),
  ('SAN PABLO','LAGUNA',7140.00,11100.00),
  ('SANTA CRUZ','LAGUNA',7140.00,11100.00),
  ('SANTO TOMAS','BATANGAS',6600.00,10200.00),
  ('LIPA','BATANGAS',7665.00,12100.00),
  ('NASUGBU','BATANGAS',7560.00,11770.00),
  ('BATANGAS CITY','BATANGAS',8400.00,13090.00),
  ('SARIAYA','QUEZON PROV',8300.00,13000.00),
  ('LUCENA','QUEZON PROV',9100.00,14500.00)
on conflict (destination) do update set
  area = excluded.area, rate = excluded.rate, convoy_rate = excluded.convoy_rate;

-- ── route_plan_trucks.destination + automatic rate derivation ──────────────
alter table route_plan_trucks add column if not exists destination text;

-- Extend the column-level grant from 0003/0017 to include the new column --
-- unmasked, like plate_number/carrier (it's a place name, not a cost figure).
revoke select on route_plan_trucks from authenticated;
grant select (
  id, route_plan_id, plate_number, carrier, is_convoy, main_truck_id,
  dispatched_at, created_at, driver_name, helper1_name, helper2_name,
  destination
) on route_plan_trucks to authenticated;

-- Replaces the 0003 manual-entry-only check with automatic derivation:
--   * Convoy sub-trucks (main_truck_id set) never carry their own rate.
--   * When destination is set on a main/standalone truck, truck_rate is
--     always looked up from trucking_rates -- convoy_rate if this truck
--     currently has any convoy trucks attached, plain rate otherwise --
--     overwriting whatever was passed in. This isn't a "manual edit" so it
--     bypasses the role check entirely.
--   * When no destination is set (legacy rows) or no matching rate exists,
--     falls back to the original manual-entry behavior, still gated to
--     Admin/Logistics Officer.
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

-- trg_truck_rate_edit (0003) already fires "before insert or update" and
-- calls this same function, so no trigger re-attachment is needed here.

-- When a convoy truck is added to or removed from a group, the MAIN
-- truck's own row isn't touched by that statement, so its BEFORE trigger
-- above never re-fires on its own. This AFTER trigger forces that
-- recompute by touching the main truck's row whenever a convoy truck
-- (main_truck_id is not null) is inserted or deleted.
create or replace function public.sync_main_truck_rate_on_convoy_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_main_id uuid := coalesce(new.main_truck_id, old.main_truck_id);
begin
  if v_main_id is not null then
    update route_plan_trucks set truck_rate = truck_rate where id = v_main_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_sync_main_truck_rate_on_convoy_insert on route_plan_trucks;
create trigger trg_sync_main_truck_rate_on_convoy_insert
  after insert on route_plan_trucks
  for each row
  when (new.main_truck_id is not null)
  execute function public.sync_main_truck_rate_on_convoy_change();

drop trigger if exists trg_sync_main_truck_rate_on_convoy_delete on route_plan_trucks;
create trigger trg_sync_main_truck_rate_on_convoy_delete
  after delete on route_plan_trucks
  for each row
  when (old.main_truck_id is not null)
  execute function public.sync_main_truck_rate_on_convoy_change();

-- ── v_route_plan_trucks: expose destination (open) + area (locked) ─────────
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
  t.helper2_name,
  t.destination,
  case
    when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE') then tr.area
    else null
  end as area
from route_plan_trucks t
left join trucking_rates tr on tr.destination = t.destination;

grant select on v_route_plan_trucks to authenticated;

-- ── Trucking Billing: area now derived from the truck's destination ────────
-- Rebuilt on top of the latest shape from 0026 (convoy grouping + has_convoy)
-- -- replaces the free-typed s.area in place (same column position, new
-- expression) and appends destination as a new tail column, per the
-- append-only convention noted in 0024/0026 (CREATE OR REPLACE VIEW can't
-- reorder or remove existing positional columns).
--
-- area is masked to ADMIN/LOGISTICS_OFFICER/LOGISTICS_ASSOCIATE specifically
-- -- narrower than "whoever can reach the Trucking Billing page" (General
-- Manager and Invoicing Team can open the page but no longer see area).
-- Falls back to the legacy manually-typed s.area for trucks that predate the
-- destination field.
create or replace view v_trucking_billing_statements
with (security_invoker = false) as
select
  s.id,
  s.route_plan_truck_id,
  s.series_no,
  s.waybill_no,
  s.status,
  s.billed_at,
  s.paid_at,
  s.prepared_by,
  s.approved_by,
  s.created_by,
  s.created_at,
  s.updated_at,
  t.plate_number,
  t.carrier,
  t.driver_name,
  t.helper1_name,
  t.helper2_name,
  case
    when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER') then t.truck_rate
    else null
  end as truck_rate,
  rp.id as route_plan_id,
  rp.route_date,
  rp.label as route_plan_label,
  coalesce(li.item_count, 0) as item_count,
  coalesce(li.total_boxes, 0) as total_boxes,
  coalesce(li.total_amount, 0) as total_amount,
  case
    when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE')
      then coalesce(tr.area, s.area)
    else null
  end as area,
  s.truck_type,
  s.convoy_waybill_no,
  exists (
    select 1 from route_plan_trucks tc where tc.main_truck_id = t.id
  ) as has_convoy,
  t.destination
from trucking_billing_statements s
join route_plan_trucks t on t.id = s.route_plan_truck_id
left join route_plans rp on rp.id = t.route_plan_id
left join trucking_rates tr on tr.destination = t.destination
left join (
  select
    coalesce(t2.main_truck_id, t2.id) as group_truck_id,
    count(*) as item_count,
    sum(qty_box) as total_boxes,
    sum(i.amount) as total_amount
  from route_plan_invoices rpi
  join invoices i on i.id = rpi.invoice_id
  join route_plan_trucks t2 on t2.id = rpi.route_plan_truck_id
  where rpi.superseded_at is null
  group by coalesce(t2.main_truck_id, t2.id)
) li on li.group_truck_id = t.id;

grant select on v_trucking_billing_statements to authenticated;

create or replace view v_trucking_billing_candidates
with (security_invoker = false) as
select
  t.id as route_plan_truck_id,
  t.plate_number,
  t.carrier,
  t.driver_name,
  case
    when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER') then t.truck_rate
    else null
  end as truck_rate,
  rp.id as route_plan_id,
  rp.route_date,
  rp.label as route_plan_label,
  coalesce(li.item_count, 0) as item_count,
  coalesce(li.total_boxes, 0) as total_boxes,
  coalesce(li.total_amount, 0) as total_amount,
  exists (
    select 1 from route_plan_trucks tc where tc.main_truck_id = t.id
  ) as has_convoy,
  t.destination,
  case
    when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE') then tr.area
    else null
  end as area
from route_plan_trucks t
join route_plans rp on rp.id = t.route_plan_id
left join trucking_rates tr on tr.destination = t.destination
left join trucking_billing_statements s on s.route_plan_truck_id = t.id
left join (
  select
    coalesce(t2.main_truck_id, t2.id) as group_truck_id,
    count(*) as item_count,
    sum(qty_box) as total_boxes,
    sum(i.amount) as total_amount
  from route_plan_invoices rpi
  join invoices i on i.id = rpi.invoice_id
  join route_plan_trucks t2 on t2.id = rpi.route_plan_truck_id
  where rpi.superseded_at is null
  group by coalesce(t2.main_truck_id, t2.id)
) li on li.group_truck_id = t.id
where s.id is null
  and not t.is_convoy;

grant select on v_trucking_billing_candidates to authenticated;

-- ============================================================================
-- Support more than one convoy sub-truck's waybill # per billing statement
-- ============================================================================
-- Business need: a main truck's Trucking Billing statement can only ride
-- along ONE convoy waybill # today (trucking_billing_statements.convoy_
-- waybill_no is a single TEXT column, added 0026, back when only one convoy
-- sub-truck per main truck was ever seen). Verified live on the Aug 7, 2026
-- route plan: main truck DBR2926 has TWO convoy sub-trucks attached
-- (DBH2039 and DBR2929, both route_plan_trucks.main_truck_id = DBR2926's
-- id) -- but its billing statement's single convoy_waybill_no column can
-- only ever record one waybill #, so the second convoy's waybill # has
-- nowhere to be saved or displayed.
--
-- This adds a child table keyed by (statement, convoy truck) so a main
-- truck's statement can carry one waybill # per ACTUAL convoy sub-truck,
-- how ever many there are. v_trucking_billing_statements gets a new tail
-- column `convoys` (jsonb array, one entry per convoy sub-truck, ordered by
-- the convoy truck's own created_at -- matching the "Truck 1, 2, 3" /
-- convoy ordering convention used everywhere else, e.g. RoutePlanBoard.tsx
-- truckLabelById) so the UI can render one input per real convoy truck
-- instead of a single boolean-gated field.
--
-- The legacy `convoy_waybill_no` / `has_convoy` columns on the view are
-- left in place unchanged for anything not yet updated to read `convoys` --
-- existing single-convoy data is backfilled into the new table below so no
-- previously-entered waybill # is lost.
-- ============================================================================

create table trucking_billing_convoy_waybills (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references trucking_billing_statements(id) on delete cascade,
  route_plan_truck_id uuid not null references route_plan_trucks(id) on delete cascade,
  waybill_no text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (statement_id, route_plan_truck_id)
);

create index idx_trucking_billing_convoy_waybills_statement
  on trucking_billing_convoy_waybills (statement_id);

drop trigger if exists trg_trucking_billing_convoy_waybills_touch on trucking_billing_convoy_waybills;
create trigger trg_trucking_billing_convoy_waybills_touch
  before update on trucking_billing_convoy_waybills
  for each row execute function public.touch_updated_at();

-- ── RLS -- mirrors trucking_billing_statements exactly (0023) ─────────────
alter table trucking_billing_convoy_waybills enable row level security;
revoke all on trucking_billing_convoy_waybills from anon;

create policy "trucking_billing_convoy_waybills select" on trucking_billing_convoy_waybills
  for select to authenticated using (true);
create policy "trucking_billing_convoy_waybills insert" on trucking_billing_convoy_waybills
  for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','GENERAL_MANAGER','INVOICING_TEAM'));
create policy "trucking_billing_convoy_waybills update" on trucking_billing_convoy_waybills
  for update to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','GENERAL_MANAGER','INVOICING_TEAM'))
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','GENERAL_MANAGER','INVOICING_TEAM'));
create policy "trucking_billing_convoy_waybills delete" on trucking_billing_convoy_waybills
  for delete to authenticated
  using (public.current_user_role() = 'ADMIN');

-- ── Backfill: existing single convoy_waybill_no -> earliest convoy truck ──
-- Assigns each statement's legacy single waybill # to the first-created
-- (Truck 1's own convoy, if it's the only one on record) convoy sub-truck
-- of that statement's main truck. Any additional convoy sub-truck simply
-- starts blank, ready to be filled in on the Status tab.
insert into trucking_billing_convoy_waybills (statement_id, route_plan_truck_id, waybill_no)
select
  s.id,
  earliest.id,
  s.convoy_waybill_no
from trucking_billing_statements s
join lateral (
  select tc.id
  from route_plan_trucks tc
  where tc.main_truck_id = s.route_plan_truck_id
  order by tc.created_at asc
  limit 1
) earliest on true
where s.convoy_waybill_no is not null
on conflict (statement_id, route_plan_truck_id) do nothing;

-- ── View: append `convoys` jsonb array ─────────────────────────────────────
-- Rebuilt verbatim from 0057 -- only the new tail column is added.
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
  coalesce(s.total_boxes_override, li.total_boxes, 0) as total_boxes,
  coalesce(li.total_amount, 0) as total_amount,
  case
    when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE')
      then t.destination
    else null
  end as area,
  s.truck_type,
  s.convoy_waybill_no,
  exists (
    select 1 from route_plan_trucks tc where tc.main_truck_id = t.id
  ) as has_convoy,
  t.destination,
  t.is_negotiated_rate,
  s.total_boxes_override,
  t.created_at as truck_created_at,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'route_plan_truck_id', tc.id,
          'plate_number', tc.plate_number,
          'waybill_no', cw.waybill_no
        )
        order by tc.created_at asc
      )
      from route_plan_trucks tc
      left join trucking_billing_convoy_waybills cw
        on cw.route_plan_truck_id = tc.id and cw.statement_id = s.id
      where tc.main_truck_id = t.id
    ),
    '[]'::jsonb
  ) as convoys
from trucking_billing_statements s
join route_plan_trucks t on t.id = s.route_plan_truck_id
left join route_plans rp on rp.id = t.route_plan_id
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

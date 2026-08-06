-- ============================================================================
-- Negotiated truck rate: manual override of the destination-based auto rate
-- ============================================================================
-- Since 0033, setting a destination on a main/standalone truck always
-- overwrites truck_rate from the trucking_rates card -- no manual override
-- once destination is set. Business need: some deliveries are negotiated at
-- a one-off rate that differs from the rate card. This adds an
-- is_negotiated_rate flag (Admin/Logistics Officer only, same gate as
-- destination and truck_rate itself) that, when true, skips the
-- destination-based lookup entirely so the typed-in truck_rate is used as-is.
-- That value then flows unchanged through v_route_plan_trucks into Trucking
-- Billing (v_trucking_billing_statements / v_trucking_billing_candidates
-- both read truck_rate straight off route_plan_trucks), satisfying "yun na
-- ang gagamitin hanggang trucking billing" with no separate propagation code.
--
-- New columns are appended at the very end of each view's existing SELECT
-- list -- CREATE OR REPLACE VIEW only allows adding columns at the end,
-- never inserting them in the middle (42P16).
-- ============================================================================

alter table route_plan_trucks
  add column if not exists is_negotiated_rate boolean not null default false;

comment on column route_plan_trucks.is_negotiated_rate is
  'When true, truck_rate is a manually-negotiated one-off amount and the destination-based rate card lookup is skipped. Admin/Logistics Officer only -- see enforce_truck_rate_edit().';

-- Column-level grants must be re-declared in full (they replace, not add).
revoke select on route_plan_trucks from authenticated;
grant select (
  id, route_plan_id, plate_number, carrier, is_convoy, main_truck_id,
  dispatched_at, created_at, driver_name, helper1_name, helper2_name,
  destination, contact_number, is_negotiated_rate
) on route_plan_trucks to authenticated;

-- Rebuilt from 0034's version (the current one). Adds:
--   * is_negotiated_rate forced false for convoy sub-trucks, same as
--     truck_rate (convoy trucks never carry their own rate).
--   * The is_negotiated_rate flag itself is Admin/Logistics Officer only --
--     same gate as destination.
--   * When is_negotiated_rate is true, the destination-based auto-lookup is
--     skipped entirely, falling through to the existing manual-entry gate
--     (still Admin/Logistics Officer only) so the typed-in truck_rate wins.
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

-- trg_truck_rate_edit (0003) already fires "before insert or update" and
-- calls this same function, so no trigger re-attachment is needed here.
-- sync_main_truck_rate_on_convoy_change() (0033) is unaffected -- it just
-- forces this same trigger to re-fire on the main truck, and re-running the
-- logic above with an unchanged is_negotiated_rate/destination reproduces
-- the same truck_rate either way.

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
  t.contact_number,
  t.is_negotiated_rate
from route_plan_trucks t
left join trucking_rates tr on tr.destination = t.destination;

grant select on v_route_plan_trucks to authenticated;

-- ── Trucking Billing: surface is_negotiated_rate for transparency ──────────
-- Appended as the new final column on both views, same append-only rule.
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
  t.destination,
  t.is_negotiated_rate
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
  end as area,
  t.is_negotiated_rate
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

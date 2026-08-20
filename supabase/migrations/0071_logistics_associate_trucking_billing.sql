-- ============================================================================
-- Grant LOGISTICS_ASSOCIATE full access to Trucking Billing
-- ============================================================================
-- Trucking Billing (Generate / For Billing / Billed / Paid / Trucking Rates)
-- has so far been ADMIN / LOGISTICS_OFFICER / GENERAL_MANAGER only. Per
-- explicit request, LOGISTICS_ASSOCIATE now gets the same level of access as
-- LOGISTICS_OFFICER on this page: generate/edit/delete-gate parity (delete
-- stays ADMIN-only, unchanged -- LOGISTICS_OFFICER doesn't have it either)
-- plus visibility into truck_rate / trucking_rates.rate / convoy_rate, which
-- were previously masked to ADMIN/LOGISTICS_OFFICER only as confidential
-- cost figures (see 0023, 0033).
--
-- This only touches the three Trucking Billing views below (each is
-- self-contained -- none of them delegate to v_route_plan_trucks), so Route
-- Plan's own truck_rate masking (0021/0034/0041) is untouched; this is scoped
-- to Trucking Billing only, as requested.
--
-- Views rebuilt verbatim from their latest definitions (0066 for candidates,
-- 0065 for statements, 0033 for rates) with LOGISTICS_ASSOCIATE added to each
-- role-gated CASE expression.
-- ============================================================================

-- ── RLS: allow LOGISTICS_ASSOCIATE to create/edit statements ───────────────
drop policy if exists "trucking_billing_statements insert" on trucking_billing_statements;
create policy "trucking_billing_statements insert" on trucking_billing_statements
  for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE','GENERAL_MANAGER','INVOICING_TEAM'));

drop policy if exists "trucking_billing_statements update" on trucking_billing_statements;
create policy "trucking_billing_statements update" on trucking_billing_statements
  for update to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE','GENERAL_MANAGER','INVOICING_TEAM'))
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE','GENERAL_MANAGER','INVOICING_TEAM'));

-- ── RLS: allow LOGISTICS_ASSOCIATE to manage the Trucking Rates table ──────
drop policy if exists "trucking_rates insert" on trucking_rates;
create policy "trucking_rates insert" on trucking_rates for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE'));

drop policy if exists "trucking_rates update" on trucking_rates;
create policy "trucking_rates update" on trucking_rates for update to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE'))
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE'));

drop policy if exists "trucking_rates delete" on trucking_rates;
create policy "trucking_rates delete" on trucking_rates for delete to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE'));

-- ── v_trucking_billing_candidates (Generate tab) -- expose truck_rate ──────
create or replace view v_trucking_billing_candidates
with (security_invoker = false) as
select
  t.id as route_plan_truck_id,
  t.plate_number,
  t.carrier,
  t.driver_name,
  case
    when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE') then t.truck_rate
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
  t.is_negotiated_rate,
  t.created_at as truck_created_at
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

-- ── v_trucking_billing_statements (For Billing/Billed/Paid) -- expose truck_rate ──
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
    when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE') then t.truck_rate
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
          'waybill_no', cw.waybill_no,
          'driver_name', tc.driver_name
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

-- ── v_trucking_rates (Trucking Rates sub-tab) -- expose rate/convoy_rate ───
create or replace view v_trucking_rates
with (security_invoker = false) as
select
  r.id,
  r.destination,
  r.area,
  case when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE') then r.rate else null end as rate,
  case when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE') then r.convoy_rate else null end as convoy_rate,
  r.created_at,
  r.updated_at
from trucking_rates r;

grant select on v_trucking_rates to authenticated;

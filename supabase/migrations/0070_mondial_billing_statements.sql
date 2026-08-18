-- ============================================================================
-- Final Billing: batch generation into a single SOA per period
-- ============================================================================
-- Today Final Billing is a live report only -- Generate just runs a
-- .gte/.lte query against v_final_billing and throws the result away once
-- you navigate off the page. There is no record of "this batch of invoices
-- was already billed to Mondial as one SOA."
--
-- This migration adds that batching, mirroring the two existing patterns in
-- this codebase for "group rows into one document, then hide them from the
-- pending list": Transmittals (0012, invoices.transmittal_id) and Trucking
-- Billing (0023, trucking_billing_statements). Specifically:
--
--   1. mondial_billing_statements -- one row per Generate click, auto
--      numbered SOA-0001, SOA-0002, ... (same identity+generated-column
--      trick as trucking_billing_statements.series_no).
--   2. invoices.billing_statement_id -- denormalized back-pointer, same
--      shape as invoices.transmittal_id. NULL = still pending / not yet
--      billed. Set once and never re-set, so an invoice can only ever
--      belong to one SOA.
--   3. v_billing's three UNION ALL branches now expose
--      i.billing_statement_id, which flows through automatically to
--      v_final_billing via its `select b.*`.
--   4. generate_mondial_billing_statement(p_period_start, p_period_end) --
--      SECURITY DEFINER, because GENERAL_MANAGER (a role with access to the
--      Final Billing page, see RequireRole in app/(app)/final-billing/
--      page.tsx) is not covered by the "invoices update" RLS policy
--      (0053 only grants ADMIN/LOGISTICS_OFFICER/LOGISTICS_ASSOCIATE). The
--      function creates the statement row, then stamps
--      billing_statement_id on every invoice currently in
--      v_final_billing with billing_statement_id is null and delivered_at
--      inside [p_period_start, p_period_end].
--   5. v_mondial_billing_statements -- one row per statement with rolled-up
--      totals, for the new "Billed" tab.
--
-- Because the WHERE clause only ever matches billing_statement_id is null,
-- an invoice that later gets a delivered_at date landing inside an
-- already-billed period (e.g. a late invoice dated Aug 1-15 encoded after
-- the Aug 1-15 SOA was generated) is simply never touched by that already-run
-- statement -- it just sits pending until the next Generate call, whatever
-- period that one covers. No extra logic needed for that requirement; it
-- falls out of "already billed" being a one-way, one-time stamp.
-- ============================================================================

create table mondial_billing_statements (
  id uuid primary key default gen_random_uuid(),
  series_seq bigint generated always as identity,
  series_no text generated always as ('SOA-' || lpad(series_seq::text, 4, '0')) stored,
  period_start date not null,
  period_end date not null,
  generated_by uuid references user_profiles(id),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mondial_billing_statements_period
  on mondial_billing_statements(period_start, period_end);

alter table mondial_billing_statements enable row level security;

create policy "mondial_billing_statements select" on mondial_billing_statements
  for select to authenticated using (true);

-- Direct insert/delete are gated the same as the RPC's own role check below,
-- mostly for consistency with every other table in this schema (the RPC
-- itself is SECURITY DEFINER and bypasses these anyway).
create policy "mondial_billing_statements insert" on mondial_billing_statements
  for insert to authenticated
  with check (public.current_user_role() in ('ADMIN', 'GENERAL_MANAGER'));

create policy "mondial_billing_statements delete" on mondial_billing_statements
  for delete to authenticated
  using (public.current_user_role() = 'ADMIN');

-- ----------------------------------------------------------------------------
-- invoices.billing_statement_id -- denormalized back-pointer, same pattern
-- as invoices.transmittal_id (0012).
-- ----------------------------------------------------------------------------
alter table invoices
  add column if not exists billing_statement_id uuid references mondial_billing_statements(id) on delete set null;

create index if not exists idx_invoices_billing_statement_id on invoices(billing_statement_id);

-- ----------------------------------------------------------------------------
-- Rebuild v_billing / v_final_billing (from 0048) to expose billing_statement_id.
-- ----------------------------------------------------------------------------
drop view if exists v_final_billing;
drop view if exists v_billing;

create view v_billing as
-- Normal branch: no reason to explain.
select
  i.id as invoice_id,
  i.document_no,
  i.category,
  i.zone,
  i.is_dc,
  i.amount,
  i.billing_statement_id,
  coalesce(c.name, i.company_name_raw) as company_name,
  i.branch_address,
  i.plan_date,
  i.posting_date,
  i.transmittal_received_date,
  i.billing_period,
  rpi.delivered_at,
  rpi.service_rate_pct,
  round(i.amount * rpi.service_rate_pct / 100.0, 2) as service_fee,
  false as is_mondial_fault_charge,
  null::text as reason_label
from invoices i
left join companies c on c.id = i.company_id
join route_plan_invoices rpi on rpi.invoice_id = i.id
join route_plan_trucks t on t.id = rpi.route_plan_truck_id
join route_plans rp on rp.id = t.route_plan_id
where rpi.delivered_at is not null
  and rp.approved_at is not null
  and i.category <> 'FLO_PRINCIPAL'

union all

-- Mondial-fault branch: the wasted backload attempt -- carry the backload's
-- own reason label so the Billing page can explain why this document_no is
-- billed a second time.
select
  i.id as invoice_id,
  i.document_no,
  i.category,
  i.zone,
  i.is_dc,
  i.amount,
  i.billing_statement_id,
  coalesce(c.name, i.company_name_raw) as company_name,
  i.branch_address,
  i.plan_date,
  i.posting_date,
  i.transmittal_received_date,
  i.billing_period,
  rpi.superseded_at as delivered_at,
  rpi.service_rate_pct,
  round(i.amount * rpi.service_rate_pct / 100.0, 2) as service_fee,
  true as is_mondial_fault_charge,
  dr.label as reason_label
from invoices i
left join companies c on c.id = i.company_id
join route_plan_invoices rpi on rpi.invoice_id = i.id
join route_plan_trucks t on t.id = rpi.route_plan_truck_id
join route_plans rp on rp.id = t.route_plan_id
join delivery_reasons dr on dr.id = rpi.reason_id
where dr.type = 'BACKLOAD'
  and dr.chargeable_to_mondial = true
  and rpi.superseded_at is not null
  and rp.approved_at is not null
  and i.category <> 'FLO_PRINCIPAL'

union all

-- No-route-plan fallback: delivered (directly or via Transmittal) without
-- ever being assigned to a route plan.
select
  i.id as invoice_id,
  i.document_no,
  i.category,
  i.zone,
  i.is_dc,
  i.amount,
  i.billing_statement_id,
  coalesce(c.name, i.company_name_raw) as company_name,
  i.branch_address,
  i.plan_date,
  i.posting_date,
  i.transmittal_received_date,
  i.billing_period,
  i.actual_delivery_date::timestamptz as delivered_at,
  fr.rate_pct as service_rate_pct,
  case when fr.rate_pct is not null
    then round(i.amount * fr.rate_pct / 100.0, 2)
    else null
  end as service_fee,
  false as is_mondial_fault_charge,
  null::text as reason_label
from invoices i
left join companies c on c.id = i.company_id
left join fee_rates fr
  on fr.category = i.category
  and fr.is_dc = i.is_dc
  and (fr.zone = i.zone or (i.category = 'MERCURY_DRUG' and fr.zone is null))
where i.category <> 'FLO_PRINCIPAL'
  and i.actual_delivery_date is not null
  and not exists (
    select 1 from route_plan_invoices rpi2
    where rpi2.invoice_id = i.id
      and rpi2.superseded_at is null
  );

create view v_final_billing as
select b.*, mc.confirmed, mc.confirmed_at
from v_billing b
join mondial_confirmations mc on mc.invoice_id = b.invoice_id
where mc.confirmed = true;

-- ----------------------------------------------------------------------------
-- generate_mondial_billing_statement -- the actual "commit this batch" write.
-- SECURITY DEFINER: GENERAL_MANAGER can reach the Final Billing page but the
-- invoices UPDATE policy (0053) doesn't cover that role, so a plain
-- client-side update would be silently blocked by RLS.
-- ----------------------------------------------------------------------------
create or replace function public.generate_mondial_billing_statement(
  p_period_start date,
  p_period_end date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_statement_id uuid;
  v_range_start timestamptz;
  v_range_end timestamptz;
  v_matched int;
begin
  if public.current_user_role() not in ('ADMIN', 'GENERAL_MANAGER') then
    raise exception 'Not authorized to generate billing statements';
  end if;

  if p_period_start is null or p_period_end is null or p_period_start > p_period_end then
    raise exception 'Invalid billing period';
  end if;

  v_range_start := p_period_start::timestamptz;
  v_range_end := (p_period_end + 1)::timestamptz; -- exclusive, i.e. through end-of-day p_period_end

  select count(*) into v_matched
  from v_final_billing
  where billing_statement_id is null
    and delivered_at >= v_range_start
    and delivered_at < v_range_end;

  if v_matched = 0 then
    raise exception 'No unbilled, confirmed invoices found in this period';
  end if;

  insert into mondial_billing_statements (period_start, period_end, generated_by)
  values (p_period_start, p_period_end, auth.uid())
  returning id into v_statement_id;

  update invoices
  set billing_statement_id = v_statement_id
  where id in (
    select invoice_id from v_final_billing
    where billing_statement_id is null
      and delivered_at >= v_range_start
      and delivered_at < v_range_end
  );

  return v_statement_id;
end;
$$;

grant execute on function public.generate_mondial_billing_statement(date, date) to authenticated;

-- ----------------------------------------------------------------------------
-- v_mondial_billing_statements -- rolled-up totals per SOA, for the Billed tab.
-- ----------------------------------------------------------------------------
create view v_mondial_billing_statements as
select
  ms.id,
  ms.series_no,
  ms.period_start,
  ms.period_end,
  ms.generated_by,
  up.full_name as generated_by_name,
  ms.generated_at,
  count(vb.invoice_id) as line_count,
  coalesce(sum(vb.amount), 0) as total_amount,
  coalesce(sum(vb.service_fee), 0) as total_fee
from mondial_billing_statements ms
left join v_billing vb on vb.billing_statement_id = ms.id
left join user_profiles up on up.id = ms.generated_by
group by ms.id, ms.series_no, ms.period_start, ms.period_end, ms.generated_by, up.full_name, ms.generated_at
order by ms.generated_at desc;

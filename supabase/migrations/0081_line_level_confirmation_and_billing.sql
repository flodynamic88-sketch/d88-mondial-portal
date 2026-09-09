-- ============================================================================
-- Re-key mondial_confirmations and billing-statement tracking to
-- (invoice_id, delivered_at) -- one confirmation slot and one billed-or-not
-- flag per actual v_billing LINE, not per invoice.
-- ============================================================================
-- Bug report: "parang ndi pa din makita sa mondial confirmation yung mga
-- icoconfirm na mga paulit-ulit na backload na dapat billable din" -- after
-- 0080 made every backload attempt its own billable v_billing line, two
-- older per-invoice-only tables silently broke:
--
--   1. mondial_confirmations has UNIQUE(invoice_id) -- one confirmation row
--      per invoice, no matter how many v_billing lines that invoice now
--      produces. A NEW backload line on an ALREADY-confirmed invoice
--      silently inherited the OLD confirmation (confirmed = true) via
--      v_final_billing's `join mondial_confirmations mc on mc.invoice_id =
--      b.invoice_id`, without Mondial ever reviewing that specific attempt.
--      Confirmed live: CD_0100221 was confirmed Aug 11 (before its 2nd
--      backload line existed); CD_0100261 was confirmed Aug 13 (before its
--      3 backload lines existed). Both read "Confirmed" for every line.
--
--   2. invoices.billing_statement_id is a single column on `invoices`.
--      generate_mondial_billing_statement() (0070) stamped it on the WHOLE
--      invoice the moment ANY of its lines was included in a SOA. v_billing
--      selected this same column for every branch/row of that invoice, so
--      once stamped, every other current or future line of that invoice
--      (e.g. a backload happening after the SOA was generated) would be
--      permanently and silently glued to that old SOA id and vanish from
--      "For Billing" -- despite never actually being billed itself.
--
-- Fix: re-key both to (invoice_id, delivered_at), matching each v_billing
-- row's true identity (delivered_at is already rpi.delivered_at /
-- rpi.superseded_at / actual_delivery_date per branch -- computed per-line
-- in v_billing already, so this needs no new join to route_plan_invoices).
--
-- Per user direction: every backload attempt is its own billable event and
-- must be confirmable/billable on its own merits, no matter how many times
-- the same invoice bounces -- "duplicate" confirmations/billing lines for
-- one invoice_id are expected and correct, not a bug.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. mondial_confirmations: add delivered_at, re-key uniqueness.
-- ----------------------------------------------------------------------------
alter table mondial_confirmations
  add column if not exists delivered_at timestamptz;

-- Backfill: every confirmation made before this migration was made back when
-- multi-line backload billing didn't exist, i.e. against the invoice's own
-- final/normal delivery -- so backfill from that same delivery timestamp
-- (NOT from any backload superseded_at). This keeps existing confirmations
-- covering only that one original line; any backload lines on the same
-- invoice start fresh as unconfirmed (needs review), which is exactly the
-- behavior being fixed.
update mondial_confirmations mc
set delivered_at = coalesce(
  (
    select rpi.delivered_at
    from route_plan_invoices rpi
    join route_plan_trucks t on t.id = rpi.route_plan_truck_id
    join route_plans rp on rp.id = t.route_plan_id
    where rpi.invoice_id = mc.invoice_id
      and rpi.delivered_at is not null
      and rp.approved_at is not null
    order by rpi.delivered_at desc
    limit 1
  ),
  (
    select i.actual_delivery_date::timestamptz
    from invoices i
    where i.id = mc.invoice_id
  )
)
where mc.invoice_id is not null
  and mc.delivered_at is null;

alter table mondial_confirmations
  drop constraint if exists mondial_confirmations_invoice_id_key;

create unique index if not exists mondial_confirmations_invoice_delivered_key
  on mondial_confirmations(invoice_id, delivered_at);

-- ----------------------------------------------------------------------------
-- 2. mondial_billing_lines -- per-line replacement for invoices.billing_statement_id.
--    Mirrors mondial_billing_statements' own RLS shape (0070): direct
--    insert/delete gated the same as the RPC's role check, for consistency
--    -- the RPC itself is SECURITY DEFINER and bypasses these anyway.
-- ----------------------------------------------------------------------------
create table if not exists mondial_billing_lines (
  invoice_id uuid not null references invoices(id) on delete cascade,
  delivered_at timestamptz not null,
  billing_statement_id uuid not null references mondial_billing_statements(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (invoice_id, delivered_at)
);

create index if not exists idx_mondial_billing_lines_statement_id
  on mondial_billing_lines(billing_statement_id);

alter table mondial_billing_lines enable row level security;

create policy "mondial_billing_lines select" on mondial_billing_lines
  for select to authenticated using (true);

create policy "mondial_billing_lines insert" on mondial_billing_lines
  for insert to authenticated
  with check (public.current_user_role() in ('ADMIN', 'GENERAL_MANAGER'));

create policy "mondial_billing_lines delete" on mondial_billing_lines
  for delete to authenticated
  using (public.current_user_role() = 'ADMIN');

-- Carry over any invoice already stamped billed under the old per-invoice
-- column, against the same final-delivery timestamp just backfilled above
-- into mondial_confirmations (an invoice can only have billing_statement_id
-- set if it was confirmed first, so mc.delivered_at is already correct here).
insert into mondial_billing_lines (invoice_id, delivered_at, billing_statement_id)
select i.id, mc.delivered_at, i.billing_statement_id
from invoices i
join mondial_confirmations mc on mc.invoice_id = i.id
where i.billing_statement_id is not null
  and mc.delivered_at is not null
on conflict (invoice_id, delivered_at) do nothing;

-- ----------------------------------------------------------------------------
-- 3. Rebuild v_billing / v_final_billing / v_mondial_billing_statements.
--    Only change from 0080: billing_statement_id now comes from a left join
--    to mondial_billing_lines on (invoice_id, delivered_at) instead of
--    straight off the invoices row, so each line tracks its OWN billed
--    status. Column list/order is unchanged, so no app/type changes needed
--    on the billing side.
-- ----------------------------------------------------------------------------
drop view if exists v_mondial_billing_statements;
drop view if exists v_final_billing;
drop view if exists v_billing;

create view v_billing as
-- Normal branch: unchanged from 0080 except billing_statement_id's source.
select
  i.id as invoice_id,
  i.document_no,
  i.category,
  i.zone,
  i.is_dc,
  i.amount,
  mbl.billing_statement_id,
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
left join mondial_billing_lines mbl
  on mbl.invoice_id = i.id and mbl.delivered_at = rpi.delivered_at
where rpi.delivered_at is not null
  and rp.approved_at is not null
  and i.category <> 'FLO_PRINCIPAL'

union all

-- Backload branch: unchanged from 0080 except billing_statement_id's source
-- -- each backload attempt now tracks its OWN billed status via
-- mondial_billing_lines keyed on (invoice_id, superseded_at), instead of
-- inheriting whatever the invoice's normal-branch line was stamped with.
select
  i.id as invoice_id,
  i.document_no,
  i.category,
  i.zone,
  i.is_dc,
  i.amount,
  mbl.billing_statement_id,
  coalesce(c.name, i.company_name_raw) as company_name,
  i.branch_address,
  i.plan_date,
  i.posting_date,
  i.transmittal_received_date,
  i.billing_period,
  rpi.superseded_at as delivered_at,
  rpi.service_rate_pct,
  round(i.amount * rpi.service_rate_pct / 100.0, 2) as service_fee,
  dr.chargeable_to_mondial as is_mondial_fault_charge,
  dr.label as reason_label
from invoices i
left join companies c on c.id = i.company_id
join route_plan_invoices rpi on rpi.invoice_id = i.id
join route_plan_trucks t on t.id = rpi.route_plan_truck_id
join route_plans rp on rp.id = t.route_plan_id
join delivery_reasons dr on dr.id = rpi.reason_id
left join mondial_billing_lines mbl
  on mbl.invoice_id = i.id and mbl.delivered_at = rpi.superseded_at
where dr.type = 'BACKLOAD'
  and not dr.is_d88_error
  and rpi.superseded_at is not null
  and rp.approved_at is not null
  and i.category <> 'FLO_PRINCIPAL'

union all

-- Fallback branch: unchanged from 0080 except billing_statement_id's source.
select
  i.id as invoice_id,
  i.document_no,
  i.category,
  i.zone,
  i.is_dc,
  i.amount,
  mbl.billing_statement_id,
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
left join mondial_billing_lines mbl
  on mbl.invoice_id = i.id and mbl.delivered_at = i.actual_delivery_date::timestamptz
where i.category <> 'FLO_PRINCIPAL'
  and i.actual_delivery_date is not null
  and not exists (
    select 1
    from route_plan_invoices rpi_b1
    join route_plan_trucks t_b1 on t_b1.id = rpi_b1.route_plan_truck_id
    join route_plans rp_b1 on rp_b1.id = t_b1.route_plan_id
    where rpi_b1.invoice_id = i.id
      and rpi_b1.delivered_at is not null
      and rp_b1.approved_at is not null
  )
  and not exists (
    select 1
    from route_plan_invoices rpi_b2
    join route_plan_trucks t_b2 on t_b2.id = rpi_b2.route_plan_truck_id
    join route_plans rp_b2 on rp_b2.id = t_b2.route_plan_id
    join delivery_reasons dr_b2 on dr_b2.id = rpi_b2.reason_id
    where rpi_b2.invoice_id = i.id
      and dr_b2.type = 'BACKLOAD'
      and not dr_b2.is_d88_error
      and rpi_b2.superseded_at is not null
      and rp_b2.approved_at is not null
  );

-- v_final_billing now joins mondial_confirmations on BOTH invoice_id and
-- delivered_at, so a confirmation only ever covers the one specific line it
-- was actually given for -- this is the fix for issue (1) above.
create view v_final_billing as
select b.*, mc.confirmed, mc.confirmed_at
from v_billing b
join mondial_confirmations mc
  on mc.invoice_id = b.invoice_id
  and mc.delivered_at = b.delivered_at
where mc.confirmed = true;

-- Unchanged from 0070 -- still just rolls up v_billing per statement id.
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

-- ----------------------------------------------------------------------------
-- 4. generate_mondial_billing_statement -- now inserts one
--    mondial_billing_lines row per matched (invoice_id, delivered_at) pair
--    instead of stamping the whole invoice. Same SECURITY DEFINER reasoning
--    as 0070 (GENERAL_MANAGER isn't covered by any UPDATE/INSERT policy on
--    these tables from the client).
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

  insert into mondial_billing_lines (invoice_id, delivered_at, billing_statement_id)
  select invoice_id, delivered_at, v_statement_id
  from v_final_billing
  where billing_statement_id is null
    and delivered_at >= v_range_start
    and delivered_at < v_range_end
  on conflict (invoice_id, delivered_at) do nothing;

  return v_statement_id;
end;
$$;

grant execute on function public.generate_mondial_billing_statement(date, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Drop the now-unused per-invoice column -- every read/write went through
--    v_billing/v_final_billing/the RPC above, none of which touch it anymore.
-- ----------------------------------------------------------------------------
drop index if exists idx_invoices_billing_statement_id;
alter table invoices drop column if exists billing_statement_id;

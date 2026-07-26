-- ============================================================================
-- Delivery Variance Log
-- ============================================================================
-- Logs discrepancies/backloads reported during delivery. Auto-linked to
-- Route Plan: when a Logistics Associate sets a Discrepancy or Backload
-- reason on an assigned invoice (route_plan_invoices.reason_id), the app
-- automatically creates/keeps in sync a variance log header row for that
-- invoice (see lib/varianceLog.ts). Each log carries line items (the goods
-- affected) and a printable form with Prepared By / Checked By / two
-- Received By signatories.
-- ============================================================================

create type returned_status as enum ('RETURNED', 'NOT_RETURNED', 'PARTIAL');

create table delivery_variance_logs (
  id uuid primary key default gen_random_uuid(),
  series_seq bigint generated always as identity,
  series_no text generated always as ('DVL-' || lpad(series_seq::text, 6, '0')) stored,
  invoice_id uuid references invoices(id) on delete set null,
  route_plan_invoice_id uuid references route_plan_invoices(id) on delete set null,
  reason_id uuid references delivery_reasons(id) on delete set null,
  log_date date not null default current_date,
  prepared_by text,
  checked_by text,
  received_by_1 text,
  received_by_2 text,
  remarks text,
  created_by uuid references user_profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- One auto-linked variance log per assigned invoice (route_plan_invoice).
-- A plain (non-partial) unique constraint is used on purpose: Postgres
-- treats every NULL as distinct from every other NULL, so manually-created
-- logs (route_plan_invoice_id left null) are never blocked by this
-- constraint, while it still lets the app's upsert(..., { onConflict:
-- "route_plan_invoice_id" }) correctly infer this index for auto-linked rows.
create unique index delivery_variance_logs_route_plan_invoice_id_key
  on delivery_variance_logs (route_plan_invoice_id);

create index delivery_variance_logs_invoice_id_idx on delivery_variance_logs (invoice_id);
create index delivery_variance_logs_log_date_idx on delivery_variance_logs (log_date);
create index delivery_variance_logs_reason_id_idx on delivery_variance_logs (reason_id);

create table delivery_variance_log_items (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references delivery_variance_logs(id) on delete cascade,
  item_description text not null,
  qty numeric not null default 0,
  unit text,
  unit_price numeric not null default 0,
  amount numeric generated always as (round(qty * unit_price, 2)) stored,
  returned_status returned_status not null default 'NOT_RETURNED',
  remarks text,
  created_at timestamptz default now()
);

create index delivery_variance_log_items_log_id_idx on delivery_variance_log_items (log_id);

-- Keeps updated_at fresh on edit.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_delivery_variance_logs_touch on delivery_variance_logs;
create trigger trg_delivery_variance_logs_touch
  before update on delivery_variance_logs
  for each row execute function public.touch_updated_at();

-- ── App settings (stores the Dynamic88 logo for printable forms as a data URL) ──
create table if not exists app_settings (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table delivery_variance_logs enable row level security;
alter table delivery_variance_log_items enable row level security;
alter table app_settings enable row level security;

revoke all on delivery_variance_logs, delivery_variance_log_items, app_settings from anon;

create policy "delivery_variance_logs select" on delivery_variance_logs
  for select to authenticated using (true);
create policy "delivery_variance_logs insert" on delivery_variance_logs
  for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_ASSOCIATE','LOGISTICS_OFFICER'));
create policy "delivery_variance_logs update" on delivery_variance_logs
  for update to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_ASSOCIATE','LOGISTICS_OFFICER'))
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_ASSOCIATE','LOGISTICS_OFFICER'));
create policy "delivery_variance_logs delete" on delivery_variance_logs
  for delete to authenticated
  using (public.current_user_role() = 'ADMIN');

create policy "delivery_variance_log_items select" on delivery_variance_log_items
  for select to authenticated using (true);
create policy "delivery_variance_log_items insert" on delivery_variance_log_items
  for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_ASSOCIATE','LOGISTICS_OFFICER'));
create policy "delivery_variance_log_items update" on delivery_variance_log_items
  for update to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_ASSOCIATE','LOGISTICS_OFFICER'))
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_ASSOCIATE','LOGISTICS_OFFICER'));
create policy "delivery_variance_log_items delete" on delivery_variance_log_items
  for delete to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_ASSOCIATE','LOGISTICS_OFFICER'));

create policy "app_settings select" on app_settings for select to authenticated using (true);
create policy "app_settings write" on app_settings for all to authenticated
  using (public.current_user_role() = 'ADMIN')
  with check (public.current_user_role() = 'ADMIN');

-- ── Views ────────────────────────────────────────────────────────────────
-- security_invoker so these simply respect the underlying tables' RLS
-- (all readable by any authenticated user already) -- no column masking
-- needed here, unlike v_route_plan_trucks/v_truck_cts.
create or replace view v_delivery_variance_logs
with (security_invoker = true) as
select
  l.id,
  l.series_no,
  l.invoice_id,
  i.document_no,
  i.company_name_raw as retail_chain,
  i.branch_address,
  i.category,
  l.route_plan_invoice_id,
  l.reason_id,
  r.type as reason_type,
  r.label as reason_label,
  l.log_date,
  l.prepared_by,
  l.checked_by,
  l.received_by_1,
  l.received_by_2,
  l.remarks,
  l.created_at,
  l.updated_at,
  coalesce(items.item_count, 0) as item_count,
  coalesce(items.total_amount, 0) as total_amount
from delivery_variance_logs l
left join invoices i on i.id = l.invoice_id
left join delivery_reasons r on r.id = l.reason_id
left join (
  select log_id, count(*) as item_count, sum(amount) as total_amount
  from delivery_variance_log_items
  group by log_id
) items on items.log_id = l.id;

grant select on v_delivery_variance_logs to authenticated;

-- Reason-frequency summary, powering the Dashboard's "most frequent return
-- reason" widget.
create or replace view v_delivery_variance_reason_summary
with (security_invoker = true) as
select
  r.id as reason_id,
  r.type as reason_type,
  r.label as reason_label,
  count(l.id) as log_count
from delivery_reasons r
join delivery_variance_logs l on l.reason_id = r.id
group by r.id, r.type, r.label
order by log_count desc;

grant select on v_delivery_variance_reason_summary to authenticated;

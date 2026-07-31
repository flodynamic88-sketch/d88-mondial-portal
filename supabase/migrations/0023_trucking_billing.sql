-- ============================================================================
-- Trucking Billing
-- ============================================================================
-- Tracks payment status owed to the trucking vendor (JMD Industrial Trading
-- Inc). A "statement" mirrors what the vendor bills us for one truck on one
-- Route Plan date -- i.e. one row per route_plan_truck, matching the "per
-- truck per day" layout of the vendor's own billing sheets (one waybill/
-- delivery-report pair per truck-day).
--
-- Everything except the vendor's own waybill number is derived live from
-- existing Route Plan / Invoice data via the views below (no manual re-typing
-- of accounts, boxes, or rate): waybill_no is the one field kept on the
-- header row, since it's assigned by the vendor and can't be derived from our
-- own data.
--
-- The 12% VAT-inclusive total is computed in the app layer from
-- v_trucking_billing_statements.truck_rate and is only ever shown in this
-- feature's own monitoring UI -- never in the printable/export document,
-- which mirrors the vendor's own billing-statement format (no VAT line).
-- ============================================================================

create type trucking_billing_status as enum ('FOR_BILLING', 'BILLED', 'PAID');

create table trucking_billing_statements (
  id uuid primary key default gen_random_uuid(),
  route_plan_truck_id uuid not null references route_plan_trucks(id) on delete cascade,
  series_seq bigint generated always as identity,
  series_no text generated always as ('TB-' || lpad(series_seq::text, 4, '0')) stored,
  waybill_no text,
  status trucking_billing_status not null default 'FOR_BILLING',
  billed_at timestamptz,
  paid_at timestamptz,
  prepared_by text,
  approved_by text,
  created_by uuid references user_profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- One statement per truck (each route_plan_truck already represents a single
-- truck on a single Route Plan date, so this is naturally "per truck per
-- day" -- matching the vendor's sheet-per-truck-per-day layout).
create unique index trucking_billing_statements_route_plan_truck_id_key
  on trucking_billing_statements (route_plan_truck_id);

create index idx_trucking_billing_statements_status on trucking_billing_statements (status);

drop trigger if exists trg_trucking_billing_statements_touch on trucking_billing_statements;
create trigger trg_trucking_billing_statements_touch
  before update on trucking_billing_statements
  for each row execute function public.touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table trucking_billing_statements enable row level security;
revoke all on trucking_billing_statements from anon;

create policy "trucking_billing_statements select" on trucking_billing_statements
  for select to authenticated using (true);
create policy "trucking_billing_statements insert" on trucking_billing_statements
  for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','GENERAL_MANAGER','INVOICING_TEAM'));
create policy "trucking_billing_statements update" on trucking_billing_statements
  for update to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','GENERAL_MANAGER','INVOICING_TEAM'))
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','GENERAL_MANAGER','INVOICING_TEAM'));
create policy "trucking_billing_statements delete" on trucking_billing_statements
  for delete to authenticated
  using (public.current_user_role() = 'ADMIN');

-- ── Views ────────────────────────────────────────────────────────────────
-- Header/summary row per statement, powering the For Billing / Billed / Paid
-- sub-tabs. truck_rate is masked the same way v_route_plan_trucks masks it
-- (ADMIN/LOGISTICS_OFFICER only) since it's the same underlying column.
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
  coalesce(li.total_amount, 0) as total_amount
from trucking_billing_statements s
join route_plan_trucks t on t.id = s.route_plan_truck_id
left join route_plans rp on rp.id = t.route_plan_id
left join (
  select route_plan_truck_id, count(*) as item_count, sum(qty_box) as total_boxes, sum(i.amount) as total_amount
  from route_plan_invoices rpi
  join invoices i on i.id = rpi.invoice_id
  where rpi.superseded_at is null
  group by route_plan_truck_id
) li on li.route_plan_truck_id = t.id;

grant select on v_trucking_billing_statements to authenticated;

-- Line items (one row per invoice/receipt on the truck) for the printable
-- Billing Statement + Delivery Report and the Excel export. No masking
-- needed: invoice amounts are already broadly readable (see v_billing).
create or replace view v_trucking_billing_statement_items
with (security_invoker = true) as
select
  s.id as statement_id,
  rpi.id as route_plan_invoice_id,
  i.id as invoice_id,
  i.document_no,
  i.category,
  i.company_name_raw,
  i.branch_address,
  i.amount as declared_value,
  rpi.qty_box,
  i.actual_delivery_date,
  i.posting_date
from trucking_billing_statements s
join route_plan_trucks t on t.id = s.route_plan_truck_id
join route_plan_invoices rpi on rpi.route_plan_truck_id = t.id and rpi.superseded_at is null
join invoices i on i.id = rpi.invoice_id
order by i.actual_delivery_date, i.document_no;

grant select on v_trucking_billing_statement_items to authenticated;

-- Route plan trucks not yet on a statement, within a date range -- powers
-- the "Generate" picker (mirrors the Transmittals generate-tab pattern).
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
  coalesce(li.total_amount, 0) as total_amount
from route_plan_trucks t
join route_plans rp on rp.id = t.route_plan_id
left join trucking_billing_statements s on s.route_plan_truck_id = t.id
left join (
  select route_plan_truck_id, count(*) as item_count, sum(qty_box) as total_boxes, sum(i.amount) as total_amount
  from route_plan_invoices rpi
  join invoices i on i.id = rpi.invoice_id
  where rpi.superseded_at is null
  group by route_plan_truck_id
) li on li.route_plan_truck_id = t.id
where s.id is null;

grant select on v_trucking_billing_candidates to authenticated;

-- ============================================================================
-- Transmittals
-- ============================================================================
-- Once an invoice has an Actual Delivery Date (set from Route Plan, see
-- 0011_delivery_date_sync.sql), it becomes eligible to be included in a
-- Transmittal: a printable batch form listing every invoice delivered on a
-- given date, generated separately per category (Consignment / Outright /
-- Flo-Mercury) since each has its own printed layout.
--
-- transmittals       - one header row per generated batch (per category, per
--                       delivery date). transmittal_no is auto-assigned by
--                       category using its own sequence (CONS-0001, OUT-0001,
--                       MERC-0001, ...).
-- transmittal_items  - the invoices included in a transmittal. Carries a
--                       manual `remarks` field (Outright/Mercury only, in the
--                       UI) that is independent from invoices.remarks.
-- invoices.transmittal_id - denormalized back-pointer, kept in sync by
--                       trigger, so "not yet transmitted" invoices for a
--                       given category + delivery date can be queried
--                       directly without an anti-join.
-- ============================================================================

create type transmittal_status as enum ('PENDING', 'TRANSMITTED');

-- Per-category numbering sequences (kept separate so each category has its
-- own clean running count, e.g. CONS-0001, OUT-0001, MERC-0001).
create sequence transmittal_seq_consignment;
create sequence transmittal_seq_outright;
create sequence transmittal_seq_mercury;

create table transmittals (
  id uuid primary key default gen_random_uuid(),
  transmittal_no text unique,
  category invoice_category not null,
  delivery_date date not null,
  date_transmitted timestamptz not null default now(),
  status transmittal_status not null default 'PENDING',
  created_by uuid references user_profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index idx_transmittals_category on transmittals(category);
create index idx_transmittals_delivery_date on transmittals(delivery_date);

-- Assigns transmittal_no from the category-specific sequence on insert.
-- SECURITY DEFINER so the calling role doesn't need direct USAGE grants on
-- the sequences (matches the enforce_*_edit trigger pattern already used
-- elsewhere in this project for privilege-widening trigger logic).
create or replace function public.set_transmittal_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq bigint;
  v_prefix text;
begin
  if new.transmittal_no is not null then
    return new;
  end if;

  case new.category
    when 'CONSIGNMENT' then
      v_prefix := 'CONS';
      v_seq := nextval('transmittal_seq_consignment');
    when 'OUTRIGHT' then
      v_prefix := 'OUT';
      v_seq := nextval('transmittal_seq_outright');
    when 'MERCURY_DRUG' then
      v_prefix := 'MERC';
      v_seq := nextval('transmittal_seq_mercury');
    else
      raise exception 'Unknown invoice category for transmittal numbering: %', new.category;
  end case;

  new.transmittal_no := v_prefix || '-' || lpad(v_seq::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists trg_set_transmittal_no on transmittals;
create trigger trg_set_transmittal_no
  before insert on transmittals
  for each row execute function public.set_transmittal_no();

drop trigger if exists trg_transmittals_touch on transmittals;
create trigger trg_transmittals_touch
  before update on transmittals
  for each row execute function public.touch_updated_at();

create table transmittal_items (
  id uuid primary key default gen_random_uuid(),
  transmittal_id uuid not null references transmittals(id) on delete cascade,
  invoice_id uuid not null references invoices(id) unique,
  remarks text,
  created_at timestamptz default now()
);
create index idx_transmittal_items_transmittal_id on transmittal_items(transmittal_id);

alter table invoices
  add column if not exists transmittal_id uuid references transmittals(id) on delete set null;
create index if not exists idx_invoices_transmittal_id on invoices(transmittal_id);

-- Keeps invoices.transmittal_id in sync whenever an invoice is added to or
-- removed from a transmittal. SECURITY DEFINER so it isn't blocked by the
-- "invoices update" RLS policy (ADMIN/JMD_PLANNER only) -- the same reasoning
-- as sync_invoice_delivery_date() in 0011.
create or replace function public.sync_invoice_transmittal_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update invoices set transmittal_id = new.transmittal_id where id = new.invoice_id;
    return new;
  elsif tg_op = 'DELETE' then
    update invoices
    set transmittal_id = null
    where id = old.invoice_id and transmittal_id is not distinct from old.transmittal_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_sync_invoice_transmittal_id on transmittal_items;
create trigger trg_sync_invoice_transmittal_id
  after insert or delete on transmittal_items
  for each row execute function public.sync_invoice_transmittal_id();

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table transmittals enable row level security;
alter table transmittal_items enable row level security;
revoke all on transmittals, transmittal_items from anon;

create policy "transmittals select" on transmittals for select to authenticated using (true);
create policy "transmittals insert" on transmittals for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE','JMD_PLANNER'));
create policy "transmittals update" on transmittals for update to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE'))
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE'));
create policy "transmittals delete" on transmittals for delete to authenticated
  using (public.current_user_role() = 'ADMIN');

create policy "transmittal_items select" on transmittal_items for select to authenticated using (true);
create policy "transmittal_items insert" on transmittal_items for insert to authenticated
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE','JMD_PLANNER'));
create policy "transmittal_items update" on transmittal_items for update to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE','JMD_PLANNER'))
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER','LOGISTICS_ASSOCIATE','JMD_PLANNER'));
create policy "transmittal_items delete" on transmittal_items for delete to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER'));

-- ── Views ────────────────────────────────────────────────────────────────
-- security_invoker: these simply respect the underlying tables' RLS, which
-- already allow SELECT to any authenticated user -- no column masking
-- needed here (unlike v_route_plan_trucks/v_truck_cts).
create or replace view v_transmittals
with (security_invoker = true) as
select
  t.id,
  t.transmittal_no,
  t.category,
  t.delivery_date,
  t.date_transmitted,
  t.status,
  t.created_by,
  t.created_at,
  t.updated_at,
  coalesce(count(ti.id), 0) as item_count,
  coalesce(sum(i.amount), 0) as amount
from transmittals t
left join transmittal_items ti on ti.transmittal_id = t.id
left join invoices i on i.id = ti.invoice_id
group by t.id;

grant select on v_transmittals to authenticated;

-- Line-item detail (invoice fields joined in) for the printable transmittal
-- form and the generate-preview table.
create or replace view v_transmittal_items
with (security_invoker = true) as
select
  ti.id,
  ti.transmittal_id,
  ti.invoice_id,
  ti.remarks,
  i.document_no,
  i.category,
  i.actual_delivery_date,
  i.billing_period,
  i.posting_date,
  i.company_name_raw,
  i.branch_address,
  i.amount
from transmittal_items ti
join invoices i on i.id = ti.invoice_id;

grant select on v_transmittal_items to authenticated;

-- ============================================================================
-- VAS (Value Added Service) module: schema, tables, triggers, views, RLS.
-- ============================================================================
-- VAS is a separate department from Mondial/Mercury. Sales (Mondial) sends
-- VAS a memo: a list of Kit No. + Qty to bundle/kit (e.g. "Buy 1 Take 1").
-- VAS defines a BOM per Kit No. (which component products go into one
-- finished bundle), logs production batches against a memo line, deducts
-- component stock and credits finished-bundle stock, logs day-to-day
-- consumable usage (tape, etc. -- deliberately NOT part of the BOM math,
-- see user decision below), and finally endorses/transfers finished bundles
-- to the warehouse (partial or full).
--
-- Design decisions from conversation with the user:
--   - Entirely separate from Mercury's `flo` schema and item master -- own
--     item list, own stock, own roles (VAS_MANAGER / VAS_OFFICER, added in
--     migration 0091).
--   - Memo No., Kit No., Batch No. are all free-text, user-entered codes
--     (exactly what's written on the physical memo/batch sheet) -- not
--     auto-generated sequences.
--   - BOM only lists the "main" products being bundled. Consumables (tape,
--     etc.) are tracked separately via a simple day-based usage log, not
--     multiplied into the per-kit BOM math.
--   - Stock-in for raw components/consumables is manual encoding (no PO/
--     receiving workflow yet).
--   - Finished-bundle stock is credited automatically when production qty
--     is logged, then moved out via a Warehouse Transfer record (supports
--     partial, multiple transfers per batch).
--   - No cached running-balance column on vas.items (unlike flo.items --
--     that table's current_stock cache has needed several backfill/
--     reconciliation migrations, see 0074/0075/0077). Balance is always
--     derived live from vas.stock_movements via vas.v_stock_balance.
-- ============================================================================

create schema if not exists vas;

grant usage on schema vas to authenticated;
revoke all on schema vas from anon;

-- ── Item master ──────────────────────────────────────────────────────────
-- One list for everything VAS stocks: the raw products being bundled
-- (COMPONENT), consumables used during kitting (CONSUMABLE, e.g. tape --
-- intentionally not part of any BOM), and the resulting bundles themselves
-- (FINISHED_GOOD).
create table vas.items (
  id uuid primary key default gen_random_uuid(),
  item_code text not null unique,
  item_description text not null,
  item_type text not null check (item_type in ('COMPONENT', 'CONSUMABLE', 'FINISHED_GOOD')),
  uom text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── Kit / BOM master ─────────────────────────────────────────────────────
-- One row per Kit No. (the code written on Sales' memo). Defines which
-- finished-good item it produces.
create table vas.kit_boms (
  id uuid primary key default gen_random_uuid(),
  kit_no text not null unique,
  finished_item_id uuid not null references vas.items(id),
  description text,
  is_active boolean not null default true,
  created_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now()
);

-- The "recipe": which COMPONENT items (and how many of each) go into one
-- unit of a given kit. Deliberately excludes CONSUMABLE items -- see header.
create table vas.kit_bom_components (
  id uuid primary key default gen_random_uuid(),
  kit_bom_id uuid not null references vas.kit_boms(id) on delete cascade,
  component_item_id uuid not null references vas.items(id),
  qty_per_kit numeric not null check (qty_per_kit > 0),
  created_at timestamptz not null default now(),
  unique (kit_bom_id, component_item_id)
);

create or replace function vas.validate_kit_bom_finished_item()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from vas.items where id = new.finished_item_id and item_type = 'FINISHED_GOOD'
  ) then
    raise exception 'kit_boms.finished_item_id must reference a FINISHED_GOOD item';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_kit_bom_finished_item on vas.kit_boms;
create trigger trg_validate_kit_bom_finished_item
  before insert or update of finished_item_id on vas.kit_boms
  for each row execute function vas.validate_kit_bom_finished_item();

create or replace function vas.validate_kit_bom_component_item()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from vas.items where id = new.component_item_id and item_type = 'COMPONENT'
  ) then
    raise exception 'kit_bom_components.component_item_id must reference a COMPONENT item';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_kit_bom_component_item on vas.kit_bom_components;
create trigger trg_validate_kit_bom_component_item
  before insert or update of component_item_id on vas.kit_bom_components
  for each row execute function vas.validate_kit_bom_component_item();

-- ── Memo (the order from Sales/Mondial) ─────────────────────────────────
create table vas.memos (
  id uuid primary key default gen_random_uuid(),
  memo_no text not null unique,
  memo_date date not null,
  client_name text not null,
  requested_by text,
  status text not null default 'OPEN' check (status in ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  created_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now()
);

create table vas.memo_items (
  id uuid primary key default gen_random_uuid(),
  memo_id uuid not null references vas.memos(id) on delete cascade,
  kit_bom_id uuid not null references vas.kit_boms(id),
  qty_requested numeric not null check (qty_requested > 0),
  created_at timestamptz not null default now()
);

-- ── Production batches ───────────────────────────────────────────────────
-- One row per kitting run (typically one per day, e.g. "Batch 1 - Nov 18"),
-- against a specific memo line. qty_produced can be edited as the batch
-- progresses -- the trigger below only moves stock by the delta each time,
-- so edits never double-count.
create table vas.production_batches (
  id uuid primary key default gen_random_uuid(),
  batch_no text not null unique,
  batch_date date not null,
  memo_item_id uuid not null references vas.memo_items(id),
  manpower_count integer,
  qty_produced numeric not null default 0 check (qty_produced >= 0),
  status text not null default 'IN_PROGRESS' check (status in ('IN_PROGRESS', 'COMPLETED')),
  remarks text,
  created_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Stock ledger (single source of truth for all VAS stock balances) ───────
create table vas.stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references vas.items(id),
  movement_type text not null check (
    movement_type in ('STOCK_IN', 'CONSUMED', 'PRODUCED', 'TRANSFERRED_OUT', 'CONSUMABLE_USED', 'CORRECTION')
  ),
  -- Signed: positive increases the item's balance, negative decreases it.
  qty numeric not null,
  reference_type text not null,
  reference_id uuid,
  movement_date date not null,
  remarks text,
  created_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now()
);

create index idx_vas_stock_movements_item on vas.stock_movements(item_id);
create index idx_vas_stock_movements_date on vas.stock_movements(movement_date);

-- Live balance per item -- no cached column, always derived.
create or replace view vas.v_stock_balance
with (security_invoker = false) as
select
  i.id as item_id,
  i.item_code,
  i.item_description,
  i.item_type,
  i.uom,
  coalesce(sum(sm.qty), 0) as balance_qty
from vas.items i
left join vas.stock_movements sm on sm.item_id = i.id
group by i.id, i.item_code, i.item_description, i.item_type, i.uom;

-- Auto-deduct BOM components and credit the finished good whenever a
-- batch's qty_produced changes (insert = delta from 0; update = delta from
-- the previous value), keyed off the batch's own batch_date.
create or replace function vas.record_batch_production()
returns trigger
language plpgsql
security definer
set search_path = vas, public
as $$
declare
  v_delta numeric;
  v_kit_bom_id uuid;
  v_finished_item_id uuid;
begin
  v_delta := new.qty_produced - coalesce(old.qty_produced, 0);
  if v_delta = 0 then
    return new;
  end if;

  select mi.kit_bom_id into v_kit_bom_id
  from vas.memo_items mi where mi.id = new.memo_item_id;

  select kb.finished_item_id into v_finished_item_id
  from vas.kit_boms kb where kb.id = v_kit_bom_id;

  insert into vas.stock_movements (item_id, movement_type, qty, reference_type, reference_id, movement_date, remarks, created_by)
  select
    c.component_item_id,
    'CONSUMED',
    -1 * c.qty_per_kit * v_delta,
    'BATCH_CONSUMPTION',
    new.id,
    new.batch_date,
    'Batch ' || new.batch_no,
    new.created_by
  from vas.kit_bom_components c
  where c.kit_bom_id = v_kit_bom_id;

  insert into vas.stock_movements (item_id, movement_type, qty, reference_type, reference_id, movement_date, remarks, created_by)
  values (
    v_finished_item_id, 'PRODUCED', v_delta, 'BATCH_OUTPUT', new.id, new.batch_date,
    'Batch ' || new.batch_no, new.created_by
  );

  return new;
end;
$$;

drop trigger if exists trg_record_batch_production on vas.production_batches;
create trigger trg_record_batch_production
  after insert or update of qty_produced on vas.production_batches
  for each row execute function vas.record_batch_production();

drop trigger if exists trg_production_batches_updated_at on vas.production_batches;
create or replace function vas.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger trg_production_batches_updated_at
  before update on vas.production_batches
  for each row execute function vas.set_updated_at();

-- Running production progress per memo line: target vs. cumulative output.
-- The UI/report derives "today" vs "previous" vs "balance" by filtering/
-- comparing against a chosen date, same pattern as other reports in this app.
create or replace view vas.v_production_progress
with (security_invoker = false) as
select
  pb.id as batch_id,
  pb.batch_no,
  pb.batch_date,
  pb.manpower_count,
  pb.qty_produced,
  pb.status,
  pb.remarks,
  mi.id as memo_item_id,
  mi.qty_requested as target_qty,
  kb.id as kit_bom_id,
  kb.kit_no,
  kb.description as kit_description,
  kb.finished_item_id,
  m.id as memo_id,
  m.memo_no,
  m.client_name,
  sum(pb.qty_produced) over (
    partition by mi.id order by pb.batch_date, pb.created_at
  ) as cumulative_qty_to_date
from vas.production_batches pb
join vas.memo_items mi on mi.id = pb.memo_item_id
join vas.kit_boms kb on kb.id = mi.kit_bom_id
join vas.memos m on m.id = mi.memo_id;

-- ── Warehouse transfer / endorsement ────────────────────────────────────
-- Supports partial transfers -- multiple rows can exist against one batch
-- (or, loosely, against the same finished item across batches) until the
-- full produced qty has been endorsed to the warehouse.
create table vas.warehouse_transfers (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references vas.production_batches(id),
  transfer_date date not null,
  qty_transferred numeric not null check (qty_transferred > 0),
  endorsed_by text,
  received_by text,
  remarks text,
  created_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now()
);

create or replace function vas.record_warehouse_transfer()
returns trigger
language plpgsql
security definer
set search_path = vas, public
as $$
declare
  v_finished_item_id uuid;
begin
  select kb.finished_item_id into v_finished_item_id
  from vas.production_batches pb
  join vas.memo_items mi on mi.id = pb.memo_item_id
  join vas.kit_boms kb on kb.id = mi.kit_bom_id
  where pb.id = new.batch_id;

  insert into vas.stock_movements (item_id, movement_type, qty, reference_type, reference_id, movement_date, remarks, created_by)
  values (
    v_finished_item_id, 'TRANSFERRED_OUT', -1 * new.qty_transferred, 'WAREHOUSE_TRANSFER', new.id, new.transfer_date,
    'Transfer to warehouse', new.created_by
  );

  return new;
end;
$$;

drop trigger if exists trg_record_warehouse_transfer on vas.warehouse_transfers;
create trigger trg_record_warehouse_transfer
  after insert on vas.warehouse_transfers
  for each row execute function vas.record_warehouse_transfer();

-- ============================================================================
-- Grants + RLS
-- ============================================================================
-- Table-level grants first -- Postgres checks these before RLS ever runs
-- (same lesson as migration 0040 for the flo schema).
grant select, insert, update, delete on all tables in schema vas to authenticated;
alter default privileges in schema vas grant select, insert, update, delete on tables to authenticated;
grant select on vas.v_stock_balance, vas.v_production_progress to authenticated;

alter table vas.items enable row level security;
alter table vas.kit_boms enable row level security;
alter table vas.kit_bom_components enable row level security;
alter table vas.memos enable row level security;
alter table vas.memo_items enable row level security;
alter table vas.production_batches enable row level security;
alter table vas.stock_movements enable row level security;
alter table vas.warehouse_transfers enable row level security;

revoke all on
  vas.items, vas.kit_boms, vas.kit_bom_components, vas.memos, vas.memo_items,
  vas.production_batches, vas.stock_movements, vas.warehouse_transfers
  from anon;

-- Same policy shape on every table: ADMIN/VAS_MANAGER/VAS_OFFICER can
-- select/insert/update; delete is ADMIN/VAS_MANAGER only (VAS_OFFICER can
-- encode and edit, never delete, per explicit user decision).
do $$
declare
  t text;
begin
  foreach t in array array[
    'items', 'kit_boms', 'kit_bom_components', 'memos', 'memo_items',
    'production_batches', 'stock_movements', 'warehouse_transfers'
  ]
  loop
    execute format(
      'create policy "%1$s select" on vas.%1$s for select to authenticated using (public.current_user_role() in (''ADMIN'',''VAS_MANAGER'',''VAS_OFFICER''));',
      t
    );
    execute format(
      'create policy "%1$s insert" on vas.%1$s for insert to authenticated with check (public.current_user_role() in (''ADMIN'',''VAS_MANAGER'',''VAS_OFFICER''));',
      t
    );
    execute format(
      'create policy "%1$s update" on vas.%1$s for update to authenticated using (public.current_user_role() in (''ADMIN'',''VAS_MANAGER'',''VAS_OFFICER'')) with check (public.current_user_role() in (''ADMIN'',''VAS_MANAGER'',''VAS_OFFICER''));',
      t
    );
    execute format(
      'create policy "%1$s delete" on vas.%1$s for delete to authenticated using (public.current_user_role() in (''ADMIN'',''VAS_MANAGER''));',
      t
    );
  end loop;
end;
$$;

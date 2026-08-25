-- ============================================================================
-- flo (Mercury): reconstruct missing stock-effect triggers + backfill
-- ============================================================================
-- Bug report: "sa mercury naman na tab, yung in and out ng mga item ndi
-- maayos, parang walang naa out" -- the Stock Card Report / Inventory pages
-- never show items going OUT (and, on inspection, IN wasn't reliable
-- either).
--
-- Root cause, confirmed by direct inspection of the live database: the
-- `flo` schema (Mercury module) is not tracked anywhere in this repo's
-- migrations -- it was built and evolved entirely via ad-hoc changes in the
-- Supabase SQL Editor (see 0052's header comment for the same observation
-- re: RLS). At some point, whatever database automation used to (a) credit
-- items.current_stock + log a flo.stock_movements row when a stock receipt
-- line was added, and (b) debit items.current_stock + log a
-- flo.stock_movements row when a delivery/pickup was dispatched, was lost.
-- Confirmed via pg_trigger: there is currently NOT ONE non-internal trigger
-- anywhere in the flo schema related to stock at all (only 2 non-internal
-- triggers exist total, both for client/branch auto-linking).
--
-- Evidence this used to work, then stopped: flo.stock_movements already has
-- 175 historical rows, the most recent dated 2026-07-23 -- over a month
-- with zero new rows despite deliveries continuing daily. Concretely, as of
-- this migration:
--   - 62 delivery_headers sitting at status='Delivered', transaction_type=
--     'Delivery', stock_deducted=false (should have been debited)
--   - 50 delivery_headers sitting at status='Delivered', transaction_type=
--     'Pickup', stock_deducted=false (should have been credited -- a Pickup
--     brings stock back INTO the warehouse from a store)
--   -  3 delivery_headers currently 'In-Transit', stock_deducted=false
--   - 107 delivery_headers still 'Pending', stock_deducted=false -- this
--     part is correct as-is (nothing should be deducted until dispatch)
--
-- Historical sign/label convention recovered from the 175 existing
-- stock_movements rows (this migration's triggers replicate it exactly, so
-- old and new rows read identically in the Stock Card Report / v_stock_
-- movement_ledger):
--   movement_type='Receiving',  reference_type='stock_receipt_lines', qty>0 -- normal stock receipt
--   movement_type='Receiving',  reference_type='stock_receipt_lines', qty<0 -- receipt line reduced/deleted (reversal)
--   movement_type='Delivery',   reference_type='delivery_lines',      qty<0 -- normal delivery dispatch (stock out)
--   movement_type='Delivery',   reference_type='delivery_lines',      qty>0 -- dispatch undone (reversal, back to Pending/Cancelled)
--   movement_type='Pickup',     reference_type='delivery_lines',      qty>0 -- pickup dispatch (stock IN -- picked up from a store)
--   movement_type='Correction', reference_type='manual_correction' or
--                                'stock_receipt_lines'                     -- manual admin fix, untouched by this migration
--
-- stock_receipt_lines / stock_movements were already fully consistent (8
-- receipt lines, 14 movement rows covering them incl. corrections) -- no
-- backfill needed on the receiving side, only the trigger going forward.
--
-- Note: `delivery_line_batches` (FEFO batch tracking) and a
-- `qty_remaining` column on stock_receipt_lines are referenced in code
-- comments and lib/mercury/types.ts, but neither actually exists in the
-- live database -- that FEFO layer was apparently never built. Out of
-- scope here; this migration only restores the current_stock +
-- stock_movements ledger mechanism the rest of the app (Inventory page,
-- Stock Card Report, get_inventory_report RPC) actually reads.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Stock receiving (IN): stock_receipt_lines insert / qty or item change /
--    delete. Unconditional -- receiving always affects stock, no gating
--    status to check (unlike deliveries).
-- ----------------------------------------------------------------------------
create or replace function flo.trg_stock_receipt_line_effect()
returns trigger
language plpgsql
security definer
set search_path = flo, public
as $$
begin
  if tg_op = 'DELETE' then
    if old.item_id is not null then
      update flo.items set current_stock = current_stock - old.qty, updated_at = now() where id = old.item_id;
      insert into flo.stock_movements (item_id, movement_type, qty, reference_type, reference_id)
      values (old.item_id, 'Receiving', -old.qty, 'stock_receipt_lines', old.id);
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.item_id is not null then
      update flo.items set current_stock = current_stock + new.qty, updated_at = now() where id = new.item_id;
      insert into flo.stock_movements (item_id, movement_type, qty, reference_type, reference_id)
      values (new.item_id, 'Receiving', new.qty, 'stock_receipt_lines', new.id);
    end if;
    return new;
  end if;

  -- tg_op = 'UPDATE'
  if new.item_id is not distinct from old.item_id then
    if new.item_id is not null and new.qty <> old.qty then
      update flo.items set current_stock = current_stock + (new.qty - old.qty), updated_at = now() where id = new.item_id;
      insert into flo.stock_movements (item_id, movement_type, qty, reference_type, reference_id)
      values (new.item_id, 'Receiving', new.qty - old.qty, 'stock_receipt_lines', new.id);
    end if;
  else
    if old.item_id is not null then
      update flo.items set current_stock = current_stock - old.qty, updated_at = now() where id = old.item_id;
      insert into flo.stock_movements (item_id, movement_type, qty, reference_type, reference_id)
      values (old.item_id, 'Receiving', -old.qty, 'stock_receipt_lines', old.id);
    end if;
    if new.item_id is not null then
      update flo.items set current_stock = current_stock + new.qty, updated_at = now() where id = new.item_id;
      insert into flo.stock_movements (item_id, movement_type, qty, reference_type, reference_id)
      values (new.item_id, 'Receiving', new.qty, 'stock_receipt_lines', new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stock_receipt_line_effect on flo.stock_receipt_lines;
create trigger trg_stock_receipt_line_effect
after insert or delete or update of qty, item_id on flo.stock_receipt_lines
for each row execute function flo.trg_stock_receipt_line_effect();

-- ----------------------------------------------------------------------------
-- 2. Delivery/pickup dispatch (OUT for Delivery, IN for Pickup): fires when
--    delivery_headers.status crosses into/out of an "already left the
--    warehouse" state. BEFORE trigger so it can set NEW.stock_deducted
--    directly (no extra UPDATE statement, no recursion risk).
-- ----------------------------------------------------------------------------
create or replace function flo.trg_delivery_header_stock_effect()
returns trigger
language plpgsql
security definer
set search_path = flo, public
as $$
declare
  was_deducted boolean;
  should_deduct boolean;
  sign_mult numeric;
  rec record;
begin
  should_deduct := new.status in ('In-Transit', 'Delivered', 'Delivered-Late', 'Returned');
  was_deducted := false;
  if tg_op = 'UPDATE' then
    was_deducted := coalesce(old.stock_deducted, false);
  end if;

  if should_deduct and not was_deducted then
    sign_mult := case when new.transaction_type = 'Pickup' then 1 else -1 end;
    for rec in select id, item_id, qty from flo.delivery_lines where delivery_header_id = new.id loop
      if rec.item_id is not null then
        update flo.items set current_stock = current_stock + (sign_mult * rec.qty), updated_at = now() where id = rec.item_id;
        insert into flo.stock_movements (item_id, movement_type, qty, reference_type, reference_id)
        values (rec.item_id, new.transaction_type, sign_mult * rec.qty, 'delivery_lines', rec.id);
      end if;
    end loop;
    new.stock_deducted := true;

  elsif not should_deduct and was_deducted then
    sign_mult := case when new.transaction_type = 'Pickup' then -1 else 1 end;
    for rec in select id, item_id, qty from flo.delivery_lines where delivery_header_id = new.id loop
      if rec.item_id is not null then
        update flo.items set current_stock = current_stock + (sign_mult * rec.qty), updated_at = now() where id = rec.item_id;
        insert into flo.stock_movements (item_id, movement_type, qty, reference_type, reference_id)
        values (rec.item_id, new.transaction_type, sign_mult * rec.qty, 'delivery_lines', rec.id);
      end if;
    end loop;
    new.stock_deducted := false;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_delivery_header_stock_effect on flo.delivery_headers;
create trigger trg_delivery_header_stock_effect
before insert or update of status on flo.delivery_headers
for each row execute function flo.trg_delivery_header_stock_effect();

-- ----------------------------------------------------------------------------
-- 3. Delivery line insert / qty or item change / delete, when the parent
--    header is ALREADY in a deducted state (e.g. a line is added or
--    corrected after dispatch). Mirrors the intent documented in
--    deliveries/[id]/page.tsx: "if the delivery is already In-Transit, the
--    existing stock-effect trigger picks this up automatically."
-- ----------------------------------------------------------------------------
create or replace function flo.trg_delivery_line_stock_effect()
returns trigger
language plpgsql
security definer
set search_path = flo, public
as $$
declare
  hdr record;
  sign_mult numeric;
begin
  if tg_op = 'DELETE' then
    select stock_deducted, transaction_type into hdr from flo.delivery_headers where id = old.delivery_header_id;
    if hdr.stock_deducted and old.item_id is not null then
      sign_mult := case when hdr.transaction_type = 'Pickup' then -1 else 1 end;
      update flo.items set current_stock = current_stock + (sign_mult * old.qty), updated_at = now() where id = old.item_id;
      insert into flo.stock_movements (item_id, movement_type, qty, reference_type, reference_id)
      values (old.item_id, hdr.transaction_type, sign_mult * old.qty, 'delivery_lines', old.id);
    end if;
    return old;
  end if;

  select stock_deducted, transaction_type into hdr from flo.delivery_headers where id = new.delivery_header_id;
  if not coalesce(hdr.stock_deducted, false) then
    return new;
  end if;
  sign_mult := case when hdr.transaction_type = 'Pickup' then 1 else -1 end;

  if tg_op = 'INSERT' then
    if new.item_id is not null then
      update flo.items set current_stock = current_stock + (sign_mult * new.qty), updated_at = now() where id = new.item_id;
      insert into flo.stock_movements (item_id, movement_type, qty, reference_type, reference_id)
      values (new.item_id, hdr.transaction_type, sign_mult * new.qty, 'delivery_lines', new.id);
    end if;
    return new;
  end if;

  -- tg_op = 'UPDATE'
  if new.item_id is not distinct from old.item_id then
    if new.item_id is not null and new.qty <> old.qty then
      update flo.items set current_stock = current_stock + (sign_mult * (new.qty - old.qty)), updated_at = now() where id = new.item_id;
      insert into flo.stock_movements (item_id, movement_type, qty, reference_type, reference_id)
      values (new.item_id, hdr.transaction_type, sign_mult * (new.qty - old.qty), 'delivery_lines', new.id);
    end if;
  else
    if old.item_id is not null then
      update flo.items set current_stock = current_stock - (sign_mult * old.qty), updated_at = now() where id = old.item_id;
      insert into flo.stock_movements (item_id, movement_type, qty, reference_type, reference_id)
      values (old.item_id, hdr.transaction_type, -sign_mult * old.qty, 'delivery_lines', old.id);
    end if;
    if new.item_id is not null then
      update flo.items set current_stock = current_stock + (sign_mult * new.qty), updated_at = now() where id = new.item_id;
      insert into flo.stock_movements (item_id, movement_type, qty, reference_type, reference_id)
      values (new.item_id, hdr.transaction_type, sign_mult * new.qty, 'delivery_lines', new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_delivery_line_stock_effect on flo.delivery_lines;
create trigger trg_delivery_line_stock_effect
after insert or delete or update of qty, item_id on flo.delivery_lines
for each row execute function flo.trg_delivery_line_stock_effect();

-- ----------------------------------------------------------------------------
-- 4. Backfill: apply the missed effect (and set stock_deducted = true) for
--    every delivery_header that's already in an "out of warehouse" status
--    but was never debited/credited, per the audit above (62 + 50 + 3 =
--    115 rows). Movement rows are backdated to dispatched_at (falling back
--    to date_of_delivery, then created_at) so the Stock Card Report reads
--    them in the right month/date instead of all landing "today".
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
  sign_mult numeric;
  effective_date timestamptz;
begin
  for r in
    select dh.id, dh.transaction_type, dh.dispatched_at, dh.date_of_delivery, dh.created_at
    from flo.delivery_headers dh
    where dh.status in ('In-Transit', 'Delivered', 'Delivered-Late', 'Returned')
      and dh.stock_deducted = false
  loop
    sign_mult := case when r.transaction_type = 'Pickup' then 1 else -1 end;
    effective_date := coalesce(r.dispatched_at, r.date_of_delivery::timestamptz, r.created_at);

    insert into flo.stock_movements (item_id, movement_type, qty, reference_type, reference_id, created_at)
    select dl.item_id, r.transaction_type, sign_mult * dl.qty, 'delivery_lines', dl.id, effective_date
    from flo.delivery_lines dl
    where dl.delivery_header_id = r.id and dl.item_id is not null;

    update flo.items i
    set current_stock = current_stock + (sign_mult * dl_sum.total_qty), updated_at = now()
    from (
      select item_id, sum(qty) as total_qty
      from flo.delivery_lines
      where delivery_header_id = r.id and item_id is not null
      group by item_id
    ) dl_sum
    where i.id = dl_sum.item_id;

    update flo.delivery_headers set stock_deducted = true where id = r.id;
  end loop;
end $$;

-- 0074_reconcile_stock_on_delivery_outcome.sql
--
-- Bug: stock is deducted at dispatch based on the invoiced qty (`dl.qty`),
-- but delivery_lines.qty_delivered / qty_returned can be corrected *after*
-- dispatch (e.g. staff mark a line "Delivered" which auto-fills
-- qty_delivered = qty, then later correct qty_delivered down to 0 because it
-- turned out to be a full bad order / non-delivery). Nothing ever watched
-- those columns, so the original full-qty deduction was never reversed.
--
-- Confirmed live for SI# 43388 (Cleanse line: qty=10, qty_delivered=0,
-- qty_returned=0, yet fully deducted) and system-wide: 15 delivery_lines
-- rows (110 units of Cleanse) + 1 row (2 units of INDOMIE NDL 5x85g) have
-- qty_delivered + qty_returned < qty while stock_deducted = true. This is a
-- major contributor to the Healthwellness/Adesteck Cleanse negative stock.
--
-- Fix: whenever qty_delivered/qty_returned change after dispatch, treat any
-- portion that is neither delivered nor recorded as returned as never
-- having left stock for good, and add it back. Also backfill the shortfall
-- that already exists today from corrections made before this trigger
-- existed.

begin;

create or replace function flo.trg_delivery_line_stock_effect()
returns trigger
language plpgsql
security definer
set search_path to 'flo', 'public'
as $function$
declare
  hdr record;
  sign_mult numeric;
  old_shortfall numeric;
  new_shortfall numeric;
  shortfall_delta numeric;
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

    -- NEW: reconcile stock when the recorded outcome (qty_delivered /
    -- qty_returned) changes after dispatch. Anything not actually delivered
    -- and not recorded as returned is added back to stock.
    if new.item_id is not null and (
      coalesce(new.qty_delivered, 0) <> coalesce(old.qty_delivered, 0)
      or coalesce(new.qty_returned, 0) <> coalesce(old.qty_returned, 0)
    ) then
      old_shortfall := old.qty - coalesce(old.qty_delivered, 0) - coalesce(old.qty_returned, 0);
      new_shortfall := new.qty - coalesce(new.qty_delivered, 0) - coalesce(new.qty_returned, 0);
      shortfall_delta := new_shortfall - old_shortfall;
      if shortfall_delta <> 0 then
        update flo.items set current_stock = current_stock + (-sign_mult * shortfall_delta), updated_at = now() where id = new.item_id;
        insert into flo.stock_movements (item_id, movement_type, qty, reference_type, reference_id)
        values (new.item_id, 'Correction', -sign_mult * shortfall_delta, 'delivery_lines', new.id);
      end if;
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
$function$;

drop trigger if exists trg_delivery_line_stock_effect on flo.delivery_lines;
create trigger trg_delivery_line_stock_effect
  after insert or delete or update of qty, item_id, qty_delivered, qty_returned
  on flo.delivery_lines
  for each row execute function flo.trg_delivery_line_stock_effect();

-- One-time backfill: restore stock for lines where a shortfall already
-- exists today (corrected before this trigger existed, so never reconciled).
with shortfalls as (
  select
    dl.item_id,
    dh.transaction_type,
    (dl.qty - coalesce(dl.qty_delivered, 0) - coalesce(dl.qty_returned, 0)) as shortfall
  from flo.delivery_lines dl
  join flo.delivery_headers dh on dh.id = dl.delivery_header_id
  where dh.stock_deducted = true
    and dl.item_id is not null
    and (dl.qty - coalesce(dl.qty_delivered, 0) - coalesce(dl.qty_returned, 0)) <> 0
),
item_totals as (
  select item_id,
         sum(case when transaction_type = 'Pickup' then -shortfall else shortfall end) as total_shortfall
  from shortfalls
  group by item_id
)
update flo.items i
set current_stock = i.current_stock + t.total_shortfall,
    updated_at = now()
from item_totals t
where t.item_id = i.id;

insert into flo.stock_movements (item_id, movement_type, qty, reference_type, reference_id)
select
  dl.item_id,
  'Correction',
  case when dh.transaction_type = 'Pickup'
       then -(dl.qty - coalesce(dl.qty_delivered, 0) - coalesce(dl.qty_returned, 0))
       else (dl.qty - coalesce(dl.qty_delivered, 0) - coalesce(dl.qty_returned, 0))
  end,
  'delivery_lines',
  dl.id
from flo.delivery_lines dl
join flo.delivery_headers dh on dh.id = dl.delivery_header_id
where dh.stock_deducted = true
  and dl.item_id is not null
  and (dl.qty - coalesce(dl.qty_delivered, 0) - coalesce(dl.qty_returned, 0)) <> 0;

commit;

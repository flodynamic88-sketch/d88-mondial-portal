-- Migration 0073: fix flo.trg_delivery_header_stock_effect() to treat dispatched_at
-- (not just status) as the true signal that stock has left the warehouse.
--
-- Context: the Mercury "For Dispatch" page (app/(app)/mercury/dispatch/page.tsx)
-- sets delivery_headers.dispatched_at when warehouse staff physically pull stock,
-- but it never touches delivery_headers.status. Migration 0072's trigger only
-- watched `status` and only fired on updates of `status`, so deliveries marked
-- dispatched while still "Pending" never had their stock deducted. User feedback:
-- "dpat yung stock out kasama yung mga na dispatch ndi lang yung mga nadelivered."
--
-- Fix:
--   1. should_deduct now considers dispatched_at is not null OR status in
--      ('In-Transit','Delivered','Delivered-Late') as "stock is out", while
--      status in ('Cancelled','Returned') always means "stock is not out"
--      (goods never left / came back), overriding a dispatched_at timestamp.
--   2. Trigger now fires on update of status OR dispatched_at, not just status.
--   3. Backfill any delivery_headers rows currently understated (dispatched
--      but stock_deducted = false).

create or replace function flo.trg_delivery_header_stock_effect()
returns trigger
language plpgsql
security definer
set search_path = flo, public
as $func$
declare
  was_deducted boolean;
  should_deduct boolean;
  sign_mult numeric;
  rec record;
begin
  should_deduct := (new.dispatched_at is not null
                      or new.status in ('In-Transit', 'Delivered', 'Delivered-Late'))
                    and coalesce(new.status, '') not in ('Cancelled', 'Returned');

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
$func$;

drop trigger if exists trg_delivery_header_stock_effect on flo.delivery_headers;
create trigger trg_delivery_header_stock_effect
before insert or update of status, dispatched_at on flo.delivery_headers
for each row execute function flo.trg_delivery_header_stock_effect();

-- Backfill: deliveries that are effectively "stock out" per the corrected logic
-- (dispatched, or advanced status, and not cancelled/returned) but were never
-- deducted because the old trigger only watched `status`.
do $do$
declare
  rec record;
  sign_mult numeric;
begin
  for rec in
    select h.id, h.transaction_type
    from flo.delivery_headers h
    where coalesce(h.stock_deducted, false) = false
      and (h.dispatched_at is not null or h.status in ('In-Transit', 'Delivered', 'Delivered-Late'))
      and coalesce(h.status, '') not in ('Cancelled', 'Returned')
  loop
    sign_mult := case when rec.transaction_type = 'Pickup' then 1 else -1 end;
    update flo.items i
    set current_stock = i.current_stock + (sign_mult * dl.qty), updated_at = now()
    from flo.delivery_lines dl
    where dl.delivery_header_id = rec.id and dl.item_id = i.id;

    insert into flo.stock_movements (item_id, movement_type, qty, reference_type, reference_id, created_at)
    select dl.item_id, rec.transaction_type, sign_mult * dl.qty, 'delivery_lines', dl.id, now()
    from flo.delivery_lines dl
    where dl.delivery_header_id = rec.id and dl.item_id is not null;

    update flo.delivery_headers set stock_deducted = true where id = rec.id;
  end loop;
end;
$do$;

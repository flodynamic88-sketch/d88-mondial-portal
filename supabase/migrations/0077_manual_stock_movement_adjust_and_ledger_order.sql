-- 0077_manual_stock_movement_adjust_and_ledger_order.sql
--
-- Two related requests from the user on the Mercury Stock Card Report
-- (Stock Movement History):
--
--   1. "dpat pwede mag manual adjust sa stock movement history like iedit
--      yung stock in and out pwede din delete ng row kung mali yung out ng
--      system" -- there needs to be a way to manually edit a movement's
--      qty (IN/OUT) or delete a wrong movement row outright, from the UI.
--
--   2. "tapos sa pag series ng stock in and out dpat as per date series
--      ndi halo halo" -- the IN/OUT rows need to display in real
--      chronological (document date) order, not insertion order, which
--      currently looks jumbled whenever a backdated correction is added
--      after the fact.
--
-- Part A: safe manual adjustment.
--   None of the existing flo.stock_movements-related triggers (migration
--   0072) react to UPDATE or DELETE on flo.stock_movements itself -- every
--   existing code path only ever INSERTs new rows into it (including
--   corrections, e.g. migration 0075). So it's safe to add a new trigger
--   that keeps flo.items.current_stock in sync whenever a stock_movements
--   row's qty is edited or the row is deleted directly, without any risk
--   of double-counting against the existing automation. RLS already
--   allows ADMIN/FLO_ASSOCIATE full CRUD on this table (migration 0052's
--   stock_movements_admin_only policy covers all commands), so no RLS
--   change is needed -- only this trigger, to keep the aggregate balance
--   correct when a row changes.
--
-- Part B: chronological ledger order.
--   flo.v_stock_movement_ledger's running_balance window function was
--   `... ORDER BY sm.created_at, sm.id ...` -- i.e. insertion order, not
--   the real document/movement date. A backdated correction (created
--   today but dated to fix a shortfall from weeks ago) would insert at
--   the END of the running balance sequence instead of where it actually
--   belongs date-wise, which is exactly the "halo-halo" symptom reported.
--   Fixed by computing document_date in a CTE first, then ordering the
--   running-balance window (and the row order itself) by
--   (document_date, created_at, movement_id) instead. Column list and
--   every CASE expression are otherwise unchanged from the live view.
begin;

-- ============================================================================
-- Part A: manual edit/delete support for flo.stock_movements
-- ============================================================================
create or replace function flo.trg_stock_movement_manual_adjust()
returns trigger
language plpgsql
security definer
set search_path = flo, public
as $function$
begin
  if tg_op = 'DELETE' then
    if old.item_id is not null then
      update flo.items
      set current_stock = current_stock - old.qty,
          updated_at = now()
      where id = old.item_id;
    end if;
    return old;
  end if;

  -- tg_op = 'UPDATE' (of qty and/or item_id)
  if new.item_id is not distinct from old.item_id then
    if new.item_id is not null and new.qty <> old.qty then
      update flo.items
      set current_stock = current_stock + (new.qty - old.qty),
          updated_at = now()
      where id = new.item_id;
    end if;
  else
    if old.item_id is not null then
      update flo.items
      set current_stock = current_stock - old.qty,
          updated_at = now()
      where id = old.item_id;
    end if;
    if new.item_id is not null then
      update flo.items
      set current_stock = current_stock + new.qty,
          updated_at = now()
      where id = new.item_id;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_stock_movement_manual_adjust on flo.stock_movements;
create trigger trg_stock_movement_manual_adjust
after update of qty, item_id or delete on flo.stock_movements
for each row execute function flo.trg_stock_movement_manual_adjust();

-- ============================================================================
-- Part B: flo.v_stock_movement_ledger, ordered by real document date
-- ============================================================================
create or replace view flo.v_stock_movement_ledger as
with base as (
  select
    sm.id as movement_id,
    sm.item_id,
    i.item_code,
    i.item_description,
    i.unit,
    i.client_id,
    c.client_code,
    c.client_name,
    sm.movement_type,
    sm.qty,
    case when sm.qty > 0::numeric then 'IN'::text else 'OUT'::text end as direction,
    abs(sm.qty) as abs_qty,
    sm.reference_type,
    sm.reference_id,
    sm.created_at,
    (sm.created_at at time zone 'Asia/Manila'::text)::date as movement_date,
    case sm.movement_type
      when 'Receiving'::text then sr.invoice_number
      when 'Delivery'::text then dh.invoice_number
      when 'Pickup'::text then dh.invoice_number
      when 'Correction'::text then 'Correction'::text
      else null::text
    end as document_number,
    case sm.movement_type
      when 'Receiving'::text then sr.date_received
      when 'Delivery'::text then coalesce(dh.date_of_delivery, sm.created_at::date)
      when 'Pickup'::text then coalesce(dh.date_of_delivery, sm.created_at::date)
      else (sm.created_at at time zone 'Asia/Manila'::text)::date
    end as document_date,
    case
      when sm.movement_type = 'Receiving'::text then coalesce(nullif(sr.notes, ''::text), 'Stock Receiving'::text)
      when sm.movement_type = 'Delivery'::text and sm.qty < 0::numeric then 'Delivery to '::text || coalesce(b.branch_name, c.client_name, 'client'::text)
      when sm.movement_type = 'Delivery'::text and sm.qty > 0::numeric then 'Delivery reversal (returned to stock)'::text
      when sm.movement_type = 'Pickup'::text and sm.qty > 0::numeric then 'Pick-up received from '::text || coalesce(c.client_name, 'client'::text)
      when sm.movement_type = 'Pickup'::text and sm.qty < 0::numeric then 'Pick-up reversal'::text
      when sm.movement_type = 'Correction'::text and sm.qty < 0::numeric then 'Manual correction / pull-out'::text
      when sm.movement_type = 'Correction'::text and sm.qty > 0::numeric then 'Manual correction / adjustment in'::text
      else sm.movement_type
    end as party_or_reason,
    case sm.movement_type
      when 'Receiving'::text then srl.expiration_date
      when 'Delivery'::text then dl.expiration_date
      when 'Pickup'::text then dl.expiration_date
      else null::date
    end as expiration_date
  from flo.stock_movements sm
    join flo.items i on i.id = sm.item_id
    left join flo.clients c on c.id = i.client_id
    left join flo.delivery_lines dl on sm.reference_type = 'delivery_lines'::text and dl.id = sm.reference_id
    left join flo.delivery_headers dh on dh.id = dl.delivery_header_id
    left join flo.branches b on b.id = dh.branch_id
    left join flo.stock_receipt_lines srl on sm.reference_type = 'stock_receipt_lines'::text and srl.id = sm.reference_id
    left join flo.stock_receipts sr on sr.id = srl.receipt_id
)
-- Column order below intentionally matches the live view's existing
-- column order exactly (movement_id .. movement_date, THEN
-- running_balance, THEN document_number .. expiration_date) --
-- `create or replace view` cannot reorder or rename existing columns,
-- only append new ones, and running_balance was already positioned
-- before document_number/document_date/party_or_reason/expiration_date
-- in the live view (those 4 were appended later via ad-hoc ALTER).
-- Only the window function's ORDER BY changes here.
select
  led.movement_id,
  led.item_id,
  led.item_code,
  led.item_description,
  led.unit,
  led.client_id,
  led.client_code,
  led.client_name,
  led.movement_type,
  led.qty,
  led.direction,
  led.abs_qty,
  led.reference_type,
  led.reference_id,
  led.created_at,
  led.movement_date,
  sum(led.qty) over (
    partition by led.item_id
    order by led.document_date, led.created_at, led.movement_id
    rows between unbounded preceding and current row
  ) as running_balance,
  led.document_number,
  led.document_date,
  led.party_or_reason,
  led.expiration_date
from base led;

commit;

-- 0078_manual_add_stock_movement.sql
--
-- Follow-up to migration 0077. User request: "dpat pwede din mag add ng
-- new entry sa baba" -- there should also be a way to add a brand-new
-- manual stock movement entry (not just edit/delete existing ones) from
-- the Stock Card Report / Stock Movement History UI.
--
-- Every existing write path into flo.stock_movements (migration 0072's
-- receiving/delivery/pickup triggers, migration 0075's backfill) always
-- pairs the INSERT with an explicit flo.items.current_stock update in the
-- same function -- there is no generic INSERT trigger on stock_movements
-- itself. A bare client-side insert would leave current_stock stale, and
-- two separate client calls (insert, then a separate update) would race
-- and can't express an atomic `current_stock = current_stock + x`
-- expression update via the Supabase JS client anyway. So, following the
-- same convention, this adds a single security definer RPC that performs
-- both writes atomically server-side.
--
-- The new row is always movement_type = 'Correction', exactly like the
-- manual corrections already supported by flo.v_stock_movement_ledger
-- (migration 0075/0077) -- so document_number = 'Correction',
-- document_date/movement_date fall back to created_at's date, and
-- party_or_reason is already derived correctly from the qty sign by the
-- view's existing CASE logic. No view change needed.
--
-- reference_type/reference_id on flo.stock_movements are both NOT NULL
-- with no default (confirmed live via information_schema.columns after
-- this function's first live test run failed with "null value in column
-- reference_type ... violates not-null constraint") -- there is no bare
-- Correction row with null reference_type/reference_id in production.
-- Existing manual corrections instead tag reference_type =
-- 'manual_correction' with an arbitrary reference_id uuid (there's no FK
-- on reference_id -- flo.v_stock_movement_ledger only left-joins it
-- against delivery_lines/stock_receipt_lines by reference_type, so any
-- other reference_type value including this one simply matches neither
-- join and all the joined columns stay null, same end result as if it
-- were nullable). This function follows that exact existing convention.
--
-- created_at is set explicitly from the caller's chosen date (noon
-- Asia/Manila, to avoid UTC-conversion date-shift at midnight) rather than
-- left as now(), so a backdated entry sorts into its correct chronological
-- position under 0077's `order by (document_date, created_at, movement_id)`
-- running-balance window, instead of always landing at the very end.
begin;

create or replace function flo.add_manual_stock_movement(
  p_item_id uuid,
  p_qty numeric,
  p_movement_date date
)
returns flo.stock_movements
language plpgsql
security definer
set search_path = flo, public
as $function$
declare
  v_row flo.stock_movements;
begin
  if not public.is_mondial_admin_or_flo_associate() then
    raise exception 'Not authorized to add manual stock movements';
  end if;

  if p_item_id is null then
    raise exception 'p_item_id is required';
  end if;

  if p_qty is null or p_qty = 0 then
    raise exception 'p_qty must be a non-zero number';
  end if;

  if p_movement_date is null then
    raise exception 'p_movement_date is required';
  end if;

  insert into flo.stock_movements (
    item_id, movement_type, qty, reference_type, reference_id, created_at
  )
  values (
    p_item_id,
    'Correction',
    p_qty,
    'manual_correction',
    gen_random_uuid(),
    (p_movement_date::text || ' 12:00:00')::timestamp at time zone 'Asia/Manila'
  )
  returning * into v_row;

  update flo.items
  set current_stock = current_stock + p_qty,
      updated_at = now()
  where id = p_item_id;

  return v_row;
end;
$function$;

grant execute on function flo.add_manual_stock_movement(uuid, numeric, date) to authenticated;

commit;

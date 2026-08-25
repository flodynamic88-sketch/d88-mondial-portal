-- 0075_reconcile_stock_movement_ledger.sql
--
-- Bug: migration 0074's generic backfill block (meant to insert a
-- per-delivery_line 'Correction' stock_movements row for every shortfall
-- that existed at the time, restoring flo.items.current_stock) never
-- actually executed against production. Confirmed live: only a manual,
-- ad hoc, ITEM-LEVEL lump correction was ever applied -- exactly 2 rows,
-- tagged reference_type = 'backfill_0074' with reference_id = the item's
-- own id (not a delivery_line id):
--   +110  Cleanse            (item 0e2db62b-bde9-4076-80ba-e2d78ba85daf)
--   +2    INDOMIE NDL 5x85g  (item d2e07a76-28ea-40e9-8d4e-2980224d7a29)
--
-- Symptom (user report, "SI#43389 shows a stock-out in the Stock Card
-- Report even though it's naka 0, hindi dapat siya kasama"): the per-item
-- Stock Card Report is built from flo.stock_movements, so it still shows
-- the ORIGINAL full-qty "Delivery" deduction for each of the 15 Cleanse
-- lines + 1 Indomie line individually, with no offsetting correction tied
-- to that specific delivery_line -- even though the item's aggregate
-- current_stock was already made whole by the lump correction. So
-- invoices like 43389 (qty_delivered=0, fully unresolved) still render as
-- a stock-out per-invoice in the report.
--
-- Additionally, live data shows 2 more shortfalls appeared *after* that
-- lump fix ran, never corrected at all:
--   SI#43396: Cleanse, qty=2, qty_delivered=0            -> shortfall +2
--   SI#43464: Cleanse, qty=3, qty_delivered=6             -> shortfall -3
--   SI#43464: item 669641a0-265a-4e63-8d74-3ca0a847dbdf,
--             qty=5, qty_delivered=6                      -> shortfall -1
--
-- Fix:
--   1. Reverse the 2 lump item-level corrections (tagged
--      'backfill_0074_reversal'), netting them to zero.
--   2. Insert a proper per-delivery_line 'Correction' stock_movements row
--      for every line with an unresolved shortfall (stock_deducted = true,
--      qty <> qty_delivered + qty_returned, and no existing per-line
--      Correction yet), and apply the net per-item current_stock delta.
--      This exactly re-creates +110 / +2 for the original 16 lines
--      (netting step 1's reversal back to zero, but now attributed to the
--      correct invoices) and additionally applies the real, never-before-
--      corrected deltas for SI#43396 and SI#43464.

begin;

-- Step 1: reverse the old lump, item-level corrections.
insert into flo.stock_movements (item_id, movement_type, qty, reference_type, reference_id)
select item_id, 'Correction', -qty, 'backfill_0074_reversal', reference_id
from flo.stock_movements
where reference_type = 'backfill_0074';

-- Step 2: apply the correct per-line corrections for every currently
-- unresolved shortfall (the original 16 lines the lump fix was meant to
-- cover, plus the 2 new lines that appeared since).
with shortfalls as (
  select
    dl.id as line_id,
    dl.item_id,
    dh.transaction_type,
    (dl.qty - coalesce(dl.qty_delivered, 0) - coalesce(dl.qty_returned, 0)) as shortfall
  from flo.delivery_lines dl
  join flo.delivery_headers dh on dh.id = dl.delivery_header_id
  where dh.stock_deducted = true
    and dl.item_id is not null
    and (dl.qty - coalesce(dl.qty_delivered, 0) - coalesce(dl.qty_returned, 0)) <> 0
    and not exists (
      select 1 from flo.stock_movements sm
      where sm.reference_type = 'delivery_lines'
        and sm.reference_id = dl.id
        and sm.movement_type = 'Correction'
    )
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
  s.item_id,
  'Correction',
  case when s.transaction_type = 'Pickup' then -s.shortfall else s.shortfall end,
  'delivery_lines',
  s.line_id
from (
  select
    dl.id as line_id,
    dl.item_id,
    dh.transaction_type,
    (dl.qty - coalesce(dl.qty_delivered, 0) - coalesce(dl.qty_returned, 0)) as shortfall
  from flo.delivery_lines dl
  join flo.delivery_headers dh on dh.id = dl.delivery_header_id
  where dh.stock_deducted = true
    and dl.item_id is not null
    and (dl.qty - coalesce(dl.qty_delivered, 0) - coalesce(dl.qty_returned, 0)) <> 0
    and not exists (
      select 1 from flo.stock_movements sm
      where sm.reference_type = 'delivery_lines'
        and sm.reference_id = dl.id
        and sm.movement_type = 'Correction'
    )
) s;

commit;

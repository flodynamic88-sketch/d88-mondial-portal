-- 0076_reverse_accidental_dispatch_43416_43417_43446.sql
--
-- Bug: SI#43416, 43417, and 43446 showed as stocked-out / dispatched in the
-- Mercury dispatch views even though they never actually left the warehouse.
-- Confirmed live: all 3 delivery_headers rows had status = 'Pending' (never
-- advanced) but dispatched_at was non-null and stock_deducted = true --
-- consistent with an accidental bulk "Mark as Dispatched" click on the For
-- Dispatch page (app/(app)/mercury/dispatch/page.tsx) that set dispatched_at
-- without the deliveries actually being pulled from stock.
--
-- Since migration 0073, flo.trg_delivery_header_stock_effect() treats
-- dispatched_at is not null as "stock is out" regardless of status, so these
-- 3 rows had their delivery_lines' full qty deducted from flo.items and
-- logged as 'Delivery' movements in flo.stock_movements, even though status
-- never left 'Pending'.
--
-- Fix: clear dispatched_at on these 3 delivery_headers. The existing
-- trigger (fires on update of dispatched_at) recomputes should_deduct as
-- false (dispatched_at now null, status still 'Pending'), sees
-- was_deducted = true, and automatically reverses the deduction: adds the
-- qty back to flo.items.current_stock and inserts offsetting 'Delivery'
-- stock_movements rows for each line, then sets stock_deducted = false.
--
-- Verified live: all 6 affected delivery_lines (2 for 43416, 3 for 43417,
-- 1 for 43446) now have a reversing +qty 'Delivery' movement matching the
-- original -qty deduction, netting to zero; flo.items.current_stock for the
-- 3 items involved (item_code 4700000, 4700001, 4700002) landed at sane
-- positive values after the reversal.

begin;

update flo.delivery_headers
set dispatched_at = null
where invoice_number in ('43416', '43417', '43446');

commit;

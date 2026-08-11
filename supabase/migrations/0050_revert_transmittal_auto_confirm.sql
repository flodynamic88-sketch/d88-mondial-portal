-- Revert 0049's auto-confirm-via-transmittal behavior.
--
-- 0049 made an invoice qualify for v_final_billing via EITHER a manual
-- mondial_confirmations.confirmed = true row, OR simply having a
-- transmittal_id set. User feedback: this is wrong -- being batched into a
-- Transmittal does NOT mean Mondial's Invoice Department has actually
-- confirmed receipt. Mondial must still click "Confirm Received" on the
-- Mondial Confirmation page for every invoice, regardless of transmittal
-- status.
--
-- This migration only rewrites v_final_billing back to requiring the
-- manual mondial_confirmations.confirmed = true path (same shape as before
-- 0049: a real join to mondial_confirmations, not a literal true). v_billing
-- is left untouched -- i.transmittal_id stays exposed there since it's still
-- useful, harmless, informational context for downstream pages (e.g. so the
-- UI can show whether an invoice has been transmitted yet, without that
-- fact affecting billing/confirmation status).

drop view if exists v_final_billing;

create view v_final_billing as
select b.*, mc.confirmed, mc.confirmed_at
from v_billing b
join mondial_confirmations mc on mc.invoice_id = b.invoice_id
where mc.confirmed = true;

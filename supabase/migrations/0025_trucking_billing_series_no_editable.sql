-- ============================================================================
-- Trucking Billing -- Editable Series # (SOA #)
-- ============================================================================
-- Series # on JMD's own billing sheet is the SOA (Statement of Account) #
-- for the whole coverage period (e.g. "MND-0726-040" for the July 14-20,
-- 2026 batch) -- every truck-day sheet generated for that period shares the
-- exact same Series #, confirmed by inspecting all 21 sheets in the sample
-- workbook. It is not a per-truck auto-incrementing sequence, so the
-- 'TB-0001'-style generated column this table started with doesn't match
-- reality.
--
-- series_no is converted from a generated column to a plain, editable text
-- column: the user types the SOA # once when generating statements for a
-- period (applied to every truck picked in that Generate batch), instead of
-- re-typing it truck by truck. DROP EXPRESSION keeps each row's current
-- stored value ('TB-0001', 'TB-0002', ...) intact -- only future edits
-- change it.
-- ============================================================================

alter table trucking_billing_statements
  alter column series_no drop expression if exists;

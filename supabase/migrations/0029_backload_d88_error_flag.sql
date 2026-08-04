-- ============================================================================
-- Backload "D88 Error" tag
-- ============================================================================
-- Some backloads happen because of D88's own mistake (not Mondial's), e.g.
-- wrong truck assigned, encoding error, missed the truck load, etc. Those
-- reasons should be selectable/typeable the same way regular Backload and
-- "Charge to Mondial" reasons are, but tagged separately so they're never
-- mistaken for a Mondial-fault reason and never trigger the double-invoice
-- billing added in 0028.
--
-- Deliberately NOT a new reason_type enum value: D88 Error backloads still
-- need every existing BACKLOAD behavior for free -- excluded from the
-- truck's CTS invoice total (0010), eligible for "Reschedule for
-- Redelivery" (TruckCard.tsx), counted in the Backload stat/count
-- (v_fulfillment_summary, Deliveries page). Adding a new enum value would
-- mean re-auditing every `dr.type = 'BACKLOAD'` check across the app for no
-- behavioral gain -- this is purely a reporting subcategory of Backload.
--
-- is_d88_error and chargeable_to_mondial are mutually exclusive in the UI
-- (a backload is either nobody's fault, D88's fault, or Mondial's fault) but
-- left as two independent booleans rather than a single enum column so a
-- future third category doesn't require another migration.
-- ============================================================================

alter table delivery_reasons
  add column if not exists is_d88_error boolean not null default false;

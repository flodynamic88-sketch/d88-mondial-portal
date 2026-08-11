-- ============================================================================
-- Flo Associate: new role, full coverage of the Mercury module except Billing
-- ============================================================================
-- FLO_ASSOCIATE is a Mondial-level role whose entire access is the Mercury
-- module (app/(app)/mercury/**). Within Mercury it gets the same read/write
-- coverage as an ADMIN across deliveries, purchase orders, warehouse/
-- inventory, store visits, incident reports, and master data -- except the
-- Billing section (/mercury/billing, /mercury/booklet-summary), which stays
-- ADMIN-only both in the UI and at the RLS layer.
--
-- This migration only adds the enum value. The RLS grant that actually gives
-- FLO_ASSOCIATE write access to the flo schema is a separate migration
-- (0052) -- Postgres won't let a new enum value be referenced in the same
-- transaction it's added in, same reason JMD_ADMIN/FLO_PRINCIPAL were split
-- across migrations.
-- ============================================================================

alter type user_role add value if not exists 'FLO_ASSOCIATE';

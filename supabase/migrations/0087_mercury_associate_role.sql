-- ============================================================================
-- Mercury Associate: new role, VIEW-ONLY across the Mercury module, Billing
-- and Booklet Summary excluded entirely.
-- ============================================================================
-- MERCURY_ASSOCIATE is a Mondial-level role whose entire access is the
-- Mercury module (app/(app)/mercury/**), same as FLO_ASSOCIATE -- except
-- MERCURY_ASSOCIATE can only ever read: no add/edit/delete anywhere in
-- Mercury, and (like FLO_ASSOCIATE) no access at all -- not even view -- to
-- Billing or Booklet Summary. It also has no access to any print/export
-- route (app/mercury/**, the standalone print-route tree, which this role is
-- deliberately never added to).
--
-- This migration only adds the enum value. The RLS grant that actually gives
-- MERCURY_ASSOCIATE SELECT-only access to the flo schema is a separate
-- migration (0088) -- Postgres won't let a new enum value be referenced in
-- the same transaction it's added in, same reason FLO_ASSOCIATE/JMD_ADMIN/
-- FLO_PRINCIPAL were split across migrations.
-- ============================================================================

alter type user_role add value if not exists 'MERCURY_ASSOCIATE';

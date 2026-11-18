-- ============================================================================
-- VAS (Value Added Service): two new roles for the new VAS module.
-- ============================================================================
-- VAS is a separate department from Mondial/Mercury -- they bundle/kit promo
-- items (e.g. "Buy 1 Take 1") on request from Sales (a memo listing Kit No.
-- + Qty), then produce and turn the finished bundles over to the warehouse.
-- The module lives in its own `vas` Postgres schema (same separation
-- pattern as Mercury's `flo` schema), set up in migration 0092.
--
--   VAS_MANAGER - full access across the whole VAS module: create, edit,
--                 delete, same as ADMIN but scoped to `vas`.
--   VAS_OFFICER - can encode (create/edit) memos, kits/BOM, production
--                 batches, stock receiving, consumable usage, and warehouse
--                 transfers -- but cannot delete anything.
--
-- This migration only adds the enum values. The schema/tables/RLS that
-- reference them is a separate migration (0092) -- Postgres won't let a new
-- enum value be referenced in the same transaction it's added in, same
-- reason FLO_ASSOCIATE/JMD_ADMIN/MERCURY_ASSOCIATE/MERCURY_MERCHANDISER
-- were split across migrations.
-- ============================================================================

alter type user_role add value if not exists 'VAS_MANAGER';
alter type user_role add value if not exists 'VAS_OFFICER';

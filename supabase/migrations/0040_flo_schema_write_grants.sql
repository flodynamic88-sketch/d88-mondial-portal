-- The Mercury module (app/(app)/mercury/**) reads and writes the separate
-- `flo` Postgres schema via `.schema("flo").from(tableName)` (see
-- lib/mercury/supabase/client.ts and components/mercury/MercuryCrudTable.tsx).
-- That schema isn't tracked by this repo's own migrations (it was set up
-- directly in Supabase), but this fix belongs here so it isn't lost.
--
-- Audit: every one of the 40 tables in `flo` only had SELECT granted to the
-- `authenticated` role -- no INSERT/UPDATE/DELETE anywhere in the schema.
-- Row Level Security is already enabled on 22 of those tables with policies
-- like `branches_admin_only` (USING/WITH CHECK is_mondial_admin()) that are
-- clearly meant to be the real gate on who can write -- but Postgres checks
-- the table-level GRANT before RLS ever runs, so every save/edit/delete in
-- the whole Mercury portal failed with "permission denied for table X"
-- regardless of role. (Existing rows, e.g. the 377 branches, came from a
-- direct SQL import, not the app -- so this bug was never exercised until
-- now.) This grants the missing privileges schema-wide and sets a default
-- so any table added to `flo` later doesn't repeat the same gap.
grant insert, update, delete on all tables in schema flo to authenticated;
alter default privileges in schema flo grant insert, update, delete on tables to authenticated;

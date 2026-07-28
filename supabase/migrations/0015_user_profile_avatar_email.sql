-- ============================================================================
-- User profile picture + contact email
-- ============================================================================
-- avatar_url: the profile picture, stored as a base64 data URL directly in
-- the row -- same approach already used for the Dynamic88 logo in
-- app_settings (see lib/appSettings.ts), so no Supabase Storage bucket/RLS
-- setup is needed.
-- email: a real, human contact email address for the account, distinct from
-- auth.users.email which is a synthetic "<username>@d88-mondial.internal"
-- address used only so username/password login can ride on Supabase Auth's
-- email-based system (see lib/authUsername.ts). This is what report
-- recipients / notifications should use.
-- Both fields are managed from User Management (ADMIN-only), same as
-- username/full_name/role -- no new RLS policy needed since
-- "profiles writable by admin" (0003_user_management.sql) already covers
-- all columns via `for all`.
-- ============================================================================

alter table user_profiles
  add column if not exists avatar_url text,
  add column if not exists email text;

-- ============================================================================
-- Invoicing Team role
-- ============================================================================
-- New role: access limited to Mondial Confirmation (full access) and
-- Transmittals (view-only). Postgres requires new enum values to be
-- committed in their own transaction before they can be referenced by any
-- policy/function, so this is a standalone migration -- see
-- 0018_invoicing_team_role_policies.sql for the policy changes that use it.
-- ============================================================================

alter type user_role add value if not exists 'INVOICING_TEAM';

-- ============================================================================
-- LOGISTICS_OFFICER: full Mercury module access (including Billing and
-- Booklet Summary), per explicit request to open Mercury to the whole role.
-- ============================================================================
-- Context: migration 0052 opened the `flo` schema (Mercury module) to
-- FLO_ASSOCIATE via is_mondial_admin_or_flo_associate(), which 21 of the 22
-- flo-schema admin_only RLS policies were rewired to use. FLO_ASSOCIATE was
-- deliberately left out of the 22nd, booklet_invoice_status, as the
-- database-layer half of excluding it from Mercury's Billing section.
--
-- The LOGISTICS_OFFICER request came with no such carve-out (full Mercury
-- access, Billing included), so it needs coverage of all 22 tables. Rather
-- than rename is_mondial_admin_or_flo_associate() (already wired to 21
-- policies) or loosen is_mondial_admin() (the ADMIN-only gate this same
-- table, and others, rely on elsewhere), this migration:
--   1. Extends is_mondial_admin_or_flo_associate()'s role check to also
--      include LOGISTICS_OFFICER -- flows automatically to all 21 policies
--      already wired to it, no need to touch each one again.
--   2. Adds a narrow, single-purpose function for the one remaining table,
--      booklet_invoice_status, so every other caller of is_mondial_admin()
--      (ADMIN-only access elsewhere) is completely unaffected.
--
-- UI/route guards enforcing the same access: components/Sidebar.tsx (nav
-- entry), app/(app)/mercury/layout.tsx (server-side role guard).
-- ============================================================================

create or replace function public.is_mondial_admin_or_flo_associate()
returns boolean
language sql
stable
security definer
as $function$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role in ('ADMIN', 'FLO_ASSOCIATE', 'LOGISTICS_OFFICER')
  );
$function$;

create or replace function public.is_mondial_admin_or_logistics_officer()
returns boolean
language sql
stable
security definer
as $function$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role in ('ADMIN', 'LOGISTICS_OFFICER')
  );
$function$;

-- booklet_invoice_status is the one flo-schema table 0052 deliberately kept
-- ADMIN-only (FLO_ASSOCIATE's Billing exclusion). LOGISTICS_OFFICER gets
-- full access, so it's opened up here via the narrow function above --
-- is_mondial_admin() itself stays untouched for any other caller.
alter policy booklet_invoice_status_admin_only on flo.booklet_invoice_status
  using (is_mondial_admin_or_logistics_officer()) with check (is_mondial_admin_or_logistics_officer());

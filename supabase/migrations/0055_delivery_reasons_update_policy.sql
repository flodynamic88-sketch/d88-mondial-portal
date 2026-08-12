-- ============================================================================
-- Fix: "Charge to Mondial" / "D88 Error" checkbox does nothing, even for Admin
-- ============================================================================
-- Root cause: 0003_user_management.sql enabled RLS on delivery_reasons and
-- added SELECT + INSERT policies, but never added an UPDATE policy. With RLS
-- enabled and no UPDATE policy present, Postgres denies ALL updates by
-- default -- for every role, including ADMIN. TruckCard.tsx's
-- handleToggleReasonFlag() calls delivery_reasons.update(...) but never
-- checks the returned error, so the click silently no-ops instead of
-- surfacing a failure: the checkbox looks clickable but the flag never
-- persists.
--
-- Fix: add an UPDATE policy mirroring the existing INSERT policy's role
-- check (ADMIN or LOGISTICS_ASSOCIATE -- same as canAddCustomReason in
-- TruckCard.tsx), scoped to using()+with check() so only the toggle fields
-- get written by users allowed to write them.
-- ============================================================================

create policy "delivery_reasons update" on delivery_reasons for update to authenticated
  using (public.current_user_role() in ('ADMIN','LOGISTICS_ASSOCIATE'))
  with check (public.current_user_role() in ('ADMIN','LOGISTICS_ASSOCIATE'));

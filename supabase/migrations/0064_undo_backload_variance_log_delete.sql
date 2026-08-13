-- ============================================================================
-- Widen delivery_variance_logs DELETE policy for the new "Undo Backload"
-- action in TruckCard.tsx
-- ============================================================================
-- Today, when a Logistics Associate mistakenly declares an assigned invoice
-- as a Backload (and, in most cases, goes on to click "Reschedule for
-- Redelivery"), there is no clean way to undo it -- picking "Clear Issue"
-- from the reason dropdown only blanks route_plan_invoices.reason_id, it
-- doesn't un-supersede the row or clean up the delivery_variance_logs entry
-- that was auto-created for it (see lib/varianceLog.ts / ensureVarianceLog).
--
-- TruckCard.tsx's new "Undo Backload" button fixes this by clearing both
-- route_plan_invoices.reason_id and .superseded_at on the row, then deleting
-- its auto-linked delivery_variance_logs row outright (cascades to that
-- log's delivery_variance_log_items via the existing FK).
--
-- 0007_delivery_variance_log.sql restricted delivery_variance_logs DELETE to
-- ADMIN only. This widens it to the same role set that can already reschedule
-- or remove an assigned invoice (route_plan_invoices' own delete/update
-- policies -- see canUnassignInvoice in TruckCard.tsx): ADMIN, JMD_PLANNER,
-- LOGISTICS_OFFICER. delivery_variance_log_items DELETE is unchanged --
-- cascade from the header delete doesn't go through RLS.
-- ============================================================================

drop policy if exists "delivery_variance_logs delete" on delivery_variance_logs;

create policy "delivery_variance_logs delete" on delivery_variance_logs
  for delete to authenticated
  using (public.current_user_role() in ('ADMIN', 'JMD_PLANNER', 'LOGISTICS_OFFICER'));

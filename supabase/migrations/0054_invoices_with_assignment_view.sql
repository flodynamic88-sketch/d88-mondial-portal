-- ============================================================================
-- Fix: "Recently Encoded" failing to load (400 Bad Request)
-- ============================================================================
-- RecentInvoicesTable.tsx's "Not Yet in Route Plan" / "In-Transit" sub-tabs
-- were filtering client-side: fetch every currently-assigned invoice ID from
-- route_plan_invoices, then send a `not.in.(id1,id2,...)` / `in.(id1,id2,...)`
-- filter back to PostgREST with the whole ID list embedded in the request
-- URL. As the business has grown, that ID list grew large enough that the
-- generated URL exceeds the API gateway's max URL length, so every such
-- request now fails with 400 -- which RecentInvoicesTable.tsx surfaces as
-- "Could not load recent invoices. Connect a Supabase project to see live
-- data." Confirmed via Supabase Edge Logs: GET /rest/v1/invoices with a
-- `not.in.(...)` filter listing ~500 UUIDs returning 400, repeatedly.
--
-- Fix: move the "is this invoice currently assigned to a route plan" check
-- into the database via an EXISTS subquery exposed as a computed column, so
-- the filter travels as a plain `is_assigned=eq.true/false` instead of a
-- giant ID list. No masking needed (invoices are already broadly readable),
-- so this follows the same security_invoker=true pattern as v_transmittals /
-- v_delivery_variance_logs.
-- ============================================================================

create or replace view v_invoices_with_assignment
with (security_invoker = true) as
select
  i.*,
  exists (
    select 1
    from route_plan_invoices rpi
    where rpi.invoice_id = i.id
      and rpi.superseded_at is null
  ) as is_assigned
from invoices i;

grant select on v_invoices_with_assignment to authenticated;

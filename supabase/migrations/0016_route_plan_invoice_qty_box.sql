-- ============================================================================
-- Qty per box on route plan invoice assignments
-- ============================================================================
-- qty_box: number of boxes for this invoice as loaded onto the truck. Entered
-- when assigning/managing an invoice on a route plan truck, and shown on the
-- printable per-truck itinerary alongside document no., store, and amount.
-- No RLS policy change needed -- route_plan_invoices is already covered by
-- the existing "route plan invoices writable by ..." policies from
-- 0001_init.sql / 0008_route_plan_delete_policies.sql.
-- ============================================================================

alter table route_plan_invoices
  add column if not exists qty_box integer;

-- ============================================================================
-- Trucking Billing: show backloaded invoices on the original truck's report,
-- and flag the eventual redelivery on the new truck's report
-- ============================================================================
-- Business need (user report, 2026-08-13): when an invoice gets backloaded,
-- it should still show up on the Delivery Report / Billing Statement of the
-- truck/date it was backloaded on -- tagged "BACKLOAD" next to its document
-- number -- instead of silently disappearing the moment it's rescheduled.
-- Then once it's actually delivered on a later truck, that truck's own
-- Delivery Report should tag the same invoice "REDELIVER" so it's obvious at
-- a glance that this document was previously backloaded elsewhere.
--
-- Today, v_trucking_billing_statement_items (0044) only ever selects
-- route_plan_invoices rows where superseded_at is null -- so the moment
-- TruckCard's "Reschedule for Redelivery" action sets superseded_at (0010),
-- that invoice vanishes from the ORIGINAL truck's line items entirely, and
-- the NEW truck's row carries no trace it was ever backloaded.
--
-- This rebuilds the view to:
--   1. Also include a truck's own superseded rows, but ONLY when the reason
--      recorded on that row is Backload-type (dr.type = 'BACKLOAD') -- a
--      plain reassignment with no backload reason isn't "kept visible",
--      same as today.
--   2. Add `is_backload`: true for exactly those kept-for-history superseded
--      rows -- this is what the original truck's report tags.
--   3. Add `is_redeliver`: true for a truck's own ACTIVE (non-superseded)
--      row when some OTHER (superseded) route_plan_invoices row exists for
--      the same invoice_id with a Backload reason -- i.e. this is where that
--      earlier backload actually got delivered. Mirrors the existing
--      TruckCard.tsx `redeliveredInvoiceIds` check (Route Plan side), just
--      expressed as a view column so the printed/exported reports can use it
--      too.
--
-- v_trucking_billing_statements' own item_count/total_boxes/total_amount
-- aggregate subquery is untouched -- it still counts only superseded_at is
-- null rows, so a truck's billed totals and % CTS are unaffected; the app
-- layer additionally excludes is_backload rows from the printed/exported
-- declared-value and boxes totals (see truckingBillingPrint.ts and
-- exportTruckingBillingExcel.ts), since a backloaded invoice was never
-- actually carried by that truck.
-- ============================================================================

create or replace view v_trucking_billing_statement_items
with (security_invoker = true) as
select
  s.id as statement_id,
  rpi.id as route_plan_invoice_id,
  i.id as invoice_id,
  i.document_no,
  i.category,
  i.company_name_raw,
  i.branch_address,
  i.amount as declared_value,
  rpi.qty_box,
  i.actual_delivery_date,
  i.posting_date,
  rpi.drop_no,
  (rpi.superseded_at is not null and dr.type = 'BACKLOAD') as is_backload,
  (
    rpi.superseded_at is null
    and exists (
      select 1
      from route_plan_invoices rpi2
      join delivery_reasons dr2 on dr2.id = rpi2.reason_id
      where rpi2.invoice_id = rpi.invoice_id
        and rpi2.id <> rpi.id
        and rpi2.superseded_at is not null
        and dr2.type = 'BACKLOAD'
    )
  ) as is_redeliver
from trucking_billing_statements s
join route_plan_trucks t on t.id = s.route_plan_truck_id
join route_plan_trucks t2 on (t2.id = t.id or t2.main_truck_id = t.id)
join route_plan_invoices rpi on rpi.route_plan_truck_id = t2.id
left join delivery_reasons dr on dr.id = rpi.reason_id
join invoices i on i.id = rpi.invoice_id
where rpi.superseded_at is null
   or (rpi.superseded_at is not null and dr.type = 'BACKLOAD')
order by rpi.drop_no nulls last, rpi.created_at;

grant select on v_trucking_billing_statement_items to authenticated;

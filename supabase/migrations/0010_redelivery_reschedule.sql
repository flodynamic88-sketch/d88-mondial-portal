-- ============================================================================
-- Reschedule for Redelivery: let a backloaded invoice keep its history on the
-- original truck while (a) being excluded from that truck's CTS % and
-- (b) becoming assignable again to a new truck/date for the actual redelivery.
-- ============================================================================
-- Previously, route_plan_invoices.invoice_id had a plain UNIQUE constraint,
-- so an invoice could only ever be assigned to one truck, period. If it was
-- backloaded (missed the store's delivery cutoff), the only way to send it
-- out again was to delete the assignment row -- which erased the record of
-- it ever having been on the original truck.
--
-- This migration adds a "superseded_at" flag. Setting it (instead of
-- deleting the row) marks that assignment as no longer the "live" one for
-- that invoice, while leaving it in place forever under its original truck
-- for history. The UNIQUE constraint is replaced with a partial unique index
-- that only applies to non-superseded rows, so the same invoice can get a
-- brand-new row (via Document Lookup) once superseded.
-- ============================================================================

alter table route_plan_invoices
  add column if not exists superseded_at timestamptz;

alter table route_plan_invoices
  drop constraint if exists route_plan_invoices_invoice_id_key;

create unique index if not exists route_plan_invoices_invoice_id_active_key
  on route_plan_invoices (invoice_id)
  where superseded_at is null;

-- ----------------------------------------------------------------------------
-- Exclude backloaded invoices from CTS: a backloaded invoice was never
-- actually delivered by the truck it was originally assigned to, so its
-- amount shouldn't count against that truck's CTS %. This applies as soon as
-- a Backload reason is set on the row -- independent of superseded_at, since
-- an invoice can be flagged Backload before it's been rescheduled anywhere.
-- ----------------------------------------------------------------------------
create or replace view v_truck_cts
with (security_invoker = false) as
select
  t.id as truck_id,
  t.route_plan_id,
  t.plate_number,
  case when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER')
    then t.truck_rate else null end as truck_rate,
  case when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER')
    then sum(i.amount) filter (where dr.type is distinct from 'BACKLOAD')
    else null end as total_invoice_amount,
  case when public.current_user_role() in ('ADMIN','LOGISTICS_OFFICER')
    then round(
      100.0 * t.truck_rate / nullif(sum(i.amount) filter (where dr.type is distinct from 'BACKLOAD'), 0),
      2
    )
    else null end as cts_pct,
  (
    round(
      100.0 * t.truck_rate / nullif(sum(i.amount) filter (where dr.type is distinct from 'BACKLOAD'), 0),
      2
    ) <= 5
  ) as cts_pass
from route_plan_trucks t
join route_plan_invoices rpi on rpi.route_plan_truck_id = t.id
join invoices i on i.id = rpi.invoice_id
left join delivery_reasons dr on dr.id = rpi.reason_id
group by t.id, t.route_plan_id, t.plate_number, t.truck_rate;

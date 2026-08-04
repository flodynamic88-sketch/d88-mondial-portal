-- ============================================================================
-- Sync Route Plan date -> invoice Plan Date
-- ============================================================================
-- Previously, invoices.plan_date (Encode Invoices) was only ever set manually
-- by staff, with no link to Route Plan -- so an invoice could get assigned to
-- a truck on one Route Plan date while its Plan Date in Encode Invoices still
-- showed a different (or blank) date, out of sync with where it actually got
-- routed.
--
-- Fix: whenever an invoice gets assigned to a truck within a Route Plan (a
-- row inserted into route_plan_invoices, regardless of which UI path did it
-- -- Document Lookup, Recently Encoded's "Assign to Route Plan", or the
-- Route Plan board itself), automatically set invoices.plan_date to that
-- Route Plan's route_date. Also re-fires if route_plan_truck_id is ever
-- changed on an existing row (not currently done anywhere in the app, but
-- kept for correctness if a future feature reassigns a truck).
--
-- Mirrors the existing sync_invoice_delivery_date() trigger pattern (see
-- 0011_delivery_date_sync.sql) -- SECURITY DEFINER so it isn't blocked by the
-- "invoices update" RLS policy (ADMIN/JMD_PLANNER only), since the roles that
-- actually assign invoices to trucks (Logistics Associate, etc.) don't have
-- that permission.
-- ============================================================================

create or replace function public.sync_invoice_plan_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_route_date date;
begin
  select rp.route_date into v_route_date
  from route_plan_trucks t
  join route_plans rp on rp.id = t.route_plan_id
  where t.id = new.route_plan_truck_id;

  if v_route_date is not null then
    update invoices set plan_date = v_route_date where id = new.invoice_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_invoice_plan_date on route_plan_invoices;
create trigger trg_sync_invoice_plan_date
  after insert or update of route_plan_truck_id on route_plan_invoices
  for each row execute function public.sync_invoice_plan_date();

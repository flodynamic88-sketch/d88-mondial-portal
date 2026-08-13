-- ============================================================================
-- Auto-sync route_plan_invoices.service_rate_pct when an invoice's
-- category/zone/is_dc changes (e.g. toggling "DC" in Encode Invoices)
-- ============================================================================
-- route_plan_invoices.service_rate_pct is a snapshot taken from fee_rates at
-- assignment time (see 0001_init.sql). If the invoice's zone/is_dc/category
-- changes afterward -- most commonly someone ticking the "DC" checkbox in
-- Encode Invoices/Recently Encoded -- the snapshot goes stale, and today the
-- only way to refresh it is the manual "Use X%" button in the Route Plan's
-- Assigned Invoices table (TruckCard.tsx).
--
-- This trigger keeps that snapshot in sync automatically, so the manual
-- click is no longer required. It replicates TruckCard.tsx's
-- expectedRateFor() matching rule exactly:
--   - MERCURY_DRUG matches by category only (flat rate, zone ignored).
--   - every other category matches by category + zone + is_dc.
-- If no fee_rates row matches (e.g. FLO_PRINCIPAL, which is priced from its
-- own principal/rate tables, not fee_rates), the existing service_rate_pct
-- is left untouched -- same as expectedRateFor() returning null and the
-- "Use X%" button simply not appearing.
--
-- The "Use X%" button itself is left in place as a manual override/visual
-- confirmation; it becomes a no-op in the common case since this trigger
-- already keeps the rate current.
-- ============================================================================

create or replace function public.sync_route_plan_invoice_rate() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_rate numeric(5,2);
begin
  if new.category = 'MERCURY_DRUG' then
    select rate_pct into v_rate from fee_rates where category = 'MERCURY_DRUG' limit 1;
  else
    select rate_pct into v_rate from fee_rates
      where category = new.category and zone = new.zone and is_dc = new.is_dc
      limit 1;
  end if;

  if v_rate is not null then
    update route_plan_invoices
      set service_rate_pct = v_rate
      where invoice_id = new.id
        and service_rate_pct is distinct from v_rate;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_route_plan_invoice_rate on invoices;

create trigger trg_sync_route_plan_invoice_rate
  after update of category, zone, is_dc on invoices
  for each row
  when (
    new.category is distinct from old.category
    or new.zone is distinct from old.zone
    or new.is_dc is distinct from old.is_dc
  )
  execute function public.sync_route_plan_invoice_rate();

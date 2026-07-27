-- ============================================================================
-- Sync Route Plan delivery date -> invoice
-- ============================================================================
-- Previously, "Mark Delivered" in Route Plan only stamped
-- route_plan_invoices.delivered_at with whatever timestamp the button was
-- clicked at, and separately tried to set invoices.status = 'DELIVERED'
-- directly from the client -- which the "invoices update" RLS policy
-- (ADMIN/JMD_PLANNER only) silently blocked for Logistics Associates, the
-- role that actually does this in practice.
--
-- Now TruckCard lets the Logistics Associate type/pick the actual delivery
-- date (not just "now"), and this trigger is the single source of truth that
-- keeps invoices.actual_delivery_date and invoices.status in sync with it,
-- running as SECURITY DEFINER so it isn't blocked by the invoices RLS policy
-- (matching the existing pattern used by enforce_truck_rate_edit,
-- enforce_service_rate_edit, etc. in 0003_user_management.sql).
-- ============================================================================

create or replace function public.sync_invoice_delivery_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.delivered_at is distinct from old.delivered_at then
    update invoices
    set
      actual_delivery_date = case
        when new.delivered_at is null then null
        else (new.delivered_at at time zone 'UTC')::date
      end,
      status = case
        when new.delivered_at is not null then 'DELIVERED'
        else 'PENDING'
      end
    where id = new.invoice_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_invoice_delivery_date on route_plan_invoices;
create trigger trg_sync_invoice_delivery_date
  after update on route_plan_invoices
  for each row execute function public.sync_invoice_delivery_date();

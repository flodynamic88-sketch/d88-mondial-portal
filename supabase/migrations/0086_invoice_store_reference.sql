-- ============================================================================
-- Store reference list: distinct stores per invoice category (Consignment,
-- Outright, Mercury Drug / "Flo Mercury"), for a lookup page so store name +
-- address is on record ("para may data tayo") without digging through
-- Encode Invoices.
-- ============================================================================
-- invoices already has "invoices select" = to authenticated using (true) (see
-- migration 0003), so every authenticated role can already read every
-- invoice's company_name_raw/branch_address today via Encode Invoices /
-- Recently Encoded. This view exposes nothing new -- it just deduplicates
-- (category, store name, address) into a flat reference list, same
-- security_invoker=true pattern as v_invoices_with_assignment (0054) /
-- v_transmittals.
--
-- FLO_PRINCIPAL is deliberately excluded: those are non-Mondial clients
-- billed on a separate system (see migration 0047), not one of the three
-- categories this reference list was requested for.
-- ============================================================================

create or replace view v_invoice_store_reference
with (security_invoker = true) as
select distinct
  category,
  company_name_raw as store_name,
  branch_address
from invoices
where category in ('CONSIGNMENT', 'OUTRIGHT', 'MERCURY_DRUG')
  and company_name_raw is not null
order by category, company_name_raw, branch_address;

grant select on v_invoice_store_reference to authenticated;

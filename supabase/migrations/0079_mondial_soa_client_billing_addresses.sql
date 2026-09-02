-- 0079_mondial_soa_client_billing_addresses.sql
--
-- User request: a new printable "Statement of Account" (Mondial88 Trading
-- Corporation format) generated from the Mercury Billing page, for exactly
-- three sub-clients: Adesteck Marketing Corporation (C-0003), Rodzon
-- Marketing Corporation (C-0002), and Healthwellnesslifestyle Inc.
-- (C-0004). The template shows the client's own mailing address under
-- their name (mirroring how the existing Dynamic88-branded SOA/Billing
-- Statement pages already render `client.billing_address` --
-- see app/mercury/billing/soa/page.tsx and .../statement/page.tsx).
--
-- These flo.clients rows had no billing_address set (flo schema tables were
-- created directly in Supabase, not via this repo's migrations -- see
-- migration 0040's note), so this fills it in with the exact addresses the
-- user supplied, one update per client_code. Stored with embedded newlines
-- and rendered with `whiteSpace: "pre-line"` on the new soa-mondial page so
-- each address line prints on its own line, matching the physical sample.
--
-- Only touches these 3 rows -- no other flo.clients columns or rows are
-- affected.
begin;

update flo.clients
set billing_address = '169-C 7th Street Fortune Village 5 Parada 1442 City of Valenzuela
NCR, Third District Philippines'
where client_code = 'C-0003';

update flo.clients
set billing_address = '2451 Lakandula St., Zone 08 Barangay 65 Pasay City
NCR, Fourth District, Philippines 1300
Trunkline: (+632) 8844-8001'
where client_code = 'C-0002';

update flo.clients
set billing_address = 'San Miguel Avenue Ortigas Center San Antonio 1600
City of Pasig NCR, Second District Philippines
Tel No.: +632 470-1495'
where client_code = 'C-0004';

commit;

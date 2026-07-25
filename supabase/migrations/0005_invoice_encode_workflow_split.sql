-- Splits invoice data entry into two stages:
--   1. Initial encode (Encode Invoices page): Document #, Retail Chain,
--      Branch/Store Address, Amount, Posting Date, Month (billing period),
--      Remarks.
--   2. Later routing edit (Recently Encoded, editable per category): Zone,
--      DC, Plan Date, Transmittal Date — filled in once the invoice is
--      being scheduled for delivery, ahead of Route Plan assignment.
--
-- Zone was previously required at insert time; it's now set later, so it
-- has to become nullable. (is_dc/plan_date/transmittal_received_date were
-- already nullable with sensible defaults, so no change needed for them.)

alter table invoices
  alter column zone drop not null;

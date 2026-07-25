-- Adds a manually-entered "Actual Delivery Date" field to invoices, editable
-- from Recently Encoded alongside Plan Date and Transmittal Date. This is
-- distinct from route_plan_invoices.delivered_at (auto-set when a truck is
-- marked delivered in Route Plan) -- it lets the encoding team record the
-- real delivery date directly on the invoice itself.

alter table invoices
  add column if not exists actual_delivery_date date;

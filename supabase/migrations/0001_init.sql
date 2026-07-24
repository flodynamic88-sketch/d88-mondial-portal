-- Enums
create type invoice_category as enum ('CONSIGNMENT','OUTRIGHT','MERCURY_DRUG');
create type zone_type as enum ('NCR','FAR_NORTH_SOUTH','VIZMIN');
create type invoice_status as enum ('PENDING','DISPATCHED','DELIVERED','CANCELLED');
create type reason_type as enum ('DISCREPANCY','BACKLOAD');

-- Reference: canonical company/retail-chain/account names (for autocomplete + consistency)
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz default now()
);

-- Reference: branch/store addresses (for autocomplete)
create table branch_addresses (
  id uuid primary key default gen_random_uuid(),
  address text not null unique,
  company_id uuid references companies(id),
  created_at timestamptz default now()
);

-- Reference: fee rate table
create table fee_rates (
  id uuid primary key default gen_random_uuid(),
  category invoice_category not null,
  zone zone_type, -- null = flat rate regardless of zone (used for MERCURY_DRUG)
  is_dc boolean not null default false,
  rate_pct numeric(5,2) not null,
  unique (category, zone, is_dc)
);

insert into fee_rates (category, zone, is_dc, rate_pct) values
  ('CONSIGNMENT','NCR',false,5.00),
  ('CONSIGNMENT','NCR',true,3.00),
  ('CONSIGNMENT','FAR_NORTH_SOUTH',false,8.00),
  ('CONSIGNMENT','FAR_NORTH_SOUTH',true,5.00),
  ('CONSIGNMENT','VIZMIN',false,10.00),
  ('OUTRIGHT','NCR',false,5.00),
  ('OUTRIGHT','NCR',true,3.00),
  ('OUTRIGHT','FAR_NORTH_SOUTH',false,8.00),
  ('OUTRIGHT','FAR_NORTH_SOUTH',true,5.00),
  ('OUTRIGHT','VIZMIN',false,10.00),
  ('MERCURY_DRUG', null, false, 10.00);

-- Reference: discrepancy/backload reasons (editable lookup, seed with common ones)
create table delivery_reasons (
  id uuid primary key default gen_random_uuid(),
  type reason_type not null,
  label text not null,
  unique (type, label)
);
insert into delivery_reasons (type, label) values
  ('DISCREPANCY','Wrong/Incomplete Address'),
  ('DISCREPANCY','Store Refused Delivery'),
  ('DISCREPANCY','Item Damaged'),
  ('DISCREPANCY','Incomplete Documents'),
  ('DISCREPANCY','Store Closed'),
  ('DISCREPANCY','Quantity Mismatch'),
  ('BACKLOAD','No Time to Deliver'),
  ('BACKLOAD','Vehicle Breakdown'),
  ('BACKLOAD','Store Not Yet Open'),
  ('BACKLOAD','Customer Requested Reschedule'),
  ('BACKLOAD','Route Overload');

-- Main invoices table (unified across Consignment/Outright/Mercury Drug)
create table invoices (
  id uuid primary key default gen_random_uuid(),
  document_no text not null unique,
  category invoice_category not null,
  zone zone_type not null,
  is_dc boolean not null default false,
  company_id uuid references companies(id),
  company_name_raw text, -- fallback free text if not yet linked to companies table
  branch_address text,
  amount numeric(14,2) not null,
  plan_date date,
  posting_date date,
  transmittal_received_date date,
  billing_period date,
  remarks text,
  status invoice_status not null default 'PENDING',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index idx_invoices_document_no on invoices(document_no);
create index idx_invoices_category on invoices(category);
create index idx_invoices_status on invoices(status);

-- Route plans (one per delivery run/day)
create table route_plans (
  id uuid primary key default gen_random_uuid(),
  route_date date not null,
  label text,
  created_by text,
  created_at timestamptz default now()
);

-- Trucks within a route plan (supports convoy trucks linked to a main truck)
create table route_plan_trucks (
  id uuid primary key default gen_random_uuid(),
  route_plan_id uuid references route_plans(id) on delete cascade,
  plate_number text,
  carrier text,
  truck_rate numeric(14,2), -- used for CTS calc
  is_convoy boolean not null default false,
  main_truck_id uuid references route_plan_trucks(id),
  dispatched_at timestamptz,
  created_at timestamptz default now()
);

-- Invoices assigned to a truck within a route plan
create table route_plan_invoices (
  id uuid primary key default gen_random_uuid(),
  route_plan_truck_id uuid references route_plan_trucks(id) on delete cascade,
  invoice_id uuid references invoices(id) unique,
  service_rate_pct numeric(5,2), -- snapshot from fee_rates at assignment time
  delivered_at timestamptz,
  reason_id uuid references delivery_reasons(id),
  created_at timestamptz default now()
);

-- Mondial invoice department confirmation (per invoice)
create table mondial_confirmations (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id) unique,
  confirmed boolean not null default false,
  confirmed_at timestamptz,
  confirmed_by text,
  created_at timestamptz default now()
);

-- View: fulfillment rate (delivered vs backload/discrepancy) across all assigned invoices
create view v_fulfillment_summary as
select
  count(*) filter (where rpi.delivered_at is not null and dr.type is null) as delivered_count,
  count(*) filter (where dr.type = 'DISCREPANCY') as discrepancy_count,
  count(*) filter (where dr.type = 'BACKLOAD') as backload_count,
  count(*) as total_assigned,
  round(
    100.0 * count(*) filter (where rpi.delivered_at is not null and dr.type is null) / nullif(count(*),0)
  , 2) as fulfillment_rate_pct
from route_plan_invoices rpi
left join delivery_reasons dr on dr.id = rpi.reason_id;

-- View: CTS per truck = truck_rate / sum(invoice amount on that truck) * 100
create view v_truck_cts as
select
  t.id as truck_id,
  t.route_plan_id,
  t.plate_number,
  t.truck_rate,
  sum(i.amount) as total_invoice_amount,
  round(100.0 * t.truck_rate / nullif(sum(i.amount),0), 2) as cts_pct
from route_plan_trucks t
join route_plan_invoices rpi on rpi.route_plan_truck_id = t.id
join invoices i on i.id = rpi.invoice_id
group by t.id, t.route_plan_id, t.plate_number, t.truck_rate;

-- View: billing (delivered invoices with computed service fee)
create view v_billing as
select
  i.id as invoice_id,
  i.document_no,
  i.category,
  i.zone,
  i.is_dc,
  i.amount,
  rpi.delivered_at,
  rpi.service_rate_pct,
  round(i.amount * rpi.service_rate_pct / 100.0, 2) as service_fee
from invoices i
join route_plan_invoices rpi on rpi.invoice_id = i.id
where rpi.delivered_at is not null;

-- View: final billing (only Mondial-confirmed invoices)
create view v_final_billing as
select b.*, mc.confirmed, mc.confirmed_at
from v_billing b
join mondial_confirmations mc on mc.invoice_id = b.invoice_id
where mc.confirmed = true;

// TypeScript types mirroring supabase/migrations/0001_init.sql
// Keep field names in sync with the SQL schema exactly.

export type InvoiceCategory = "CONSIGNMENT" | "OUTRIGHT" | "MERCURY_DRUG" | "FLO_PRINCIPAL";
export type ZoneType = "NCR" | "FAR_NORTH_SOUTH" | "VIZMIN";
export type InvoiceStatus = "PENDING" | "DISPATCHED" | "DELIVERED" | "CANCELLED";
export type ReasonType = "DISCREPANCY" | "BACKLOAD";
export type ReturnedStatus = "RETURNED" | "NOT_RETURNED" | "PARTIAL";
export type TransmittalStatus = "PENDING" | "TRANSMITTED";
export type TruckingBillingStatus = "FOR_BILLING" | "BILLED" | "PAID";
export type UserRole =
  | "ADMIN"
  | "LOGISTICS_OFFICER"
  | "JMD_PLANNER"
  | "MONDIAL_TEAM"
  | "LOGISTICS_ASSOCIATE"
  | "GENERAL_MANAGER"
  | "INVOICING_TEAM"
  | "JMD_ADMIN";

export interface UserProfile {
  id: string;
  username: string;
  full_name: string | null;
  role: UserRole;
  created_at: string | null;
  avatar_url: string | null;
  email: string | null;
}

export interface Company {
  id: string;
  name: string;
  created_at: string | null;
}

export interface BranchAddress {
  id: string;
  address: string;
  company_id: string | null;
  created_at: string | null;
}

export interface FeeRate {
  id: string;
  category: InvoiceCategory;
  zone: ZoneType | null;
  is_dc: boolean;
  rate_pct: number;
}

/** A client other than Mondial (e.g. Adesteck, Rodzon, Healthwellness) whose
 *  invoices are billed on a separate system. See migration 0047. */
export interface Principal {
  id: string;
  name: string;
  created_at: string | null;
}

/** Flat service rate for a FLO_PRINCIPAL invoice -- looked up by
 *  (principal_id, is_dc) instead of the zone-based fee_rates. */
export interface PrincipalRate {
  id: string;
  principal_id: string;
  is_dc: boolean;
  rate_pct: number;
}

export interface DeliveryReason {
  id: string;
  type: ReasonType;
  label: string;
  /** Backload only: this reason is Mondial's fault -- automatically produces
   *  a second billable line (the wasted attempt) in v_billing once the
   *  invoice is rescheduled for redelivery. See migration 0028. */
  chargeable_to_mondial: boolean;
  /** Backload only: this reason is D88's own mistake (not Mondial's, not
   *  billable twice) -- purely a reporting subcategory. See migration 0029. */
  is_d88_error: boolean;
}

export interface Invoice {
  id: string;
  document_no: string;
  /** Generated column: replace(document_no, '-', '_') -- normalizes the
   *  inconsistent '_'/'-' separator so ordering is always lowest -> highest
   *  numerically. Sort key only -- display document_no as-is. See migration 0030. */
  document_no_sort: string;
  category: InvoiceCategory;
  zone: ZoneType | null;
  is_dc: boolean;
  company_id: string | null;
  company_name_raw: string | null;
  branch_address: string | null;
  amount: number;
  plan_date: string | null;
  actual_delivery_date: string | null;
  posting_date: string | null;
  transmittal_received_date: string | null;
  billing_period: string | null;
  remarks: string | null;
  status: InvoiceStatus;
  transmittal_id: string | null;
  /** FLO_PRINCIPAL only -- which principal this invoice belongs to (drives
   *  its service rate via principal_rates instead of zone-based fee_rates).
   *  Null for the 3 Mondial categories. See migration 0047. */
  principal_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface RoutePlan {
  id: string;
  route_date: string;
  label: string | null;
  created_by: string | null;
  created_at: string | null;
  prepared_by: string | null;
  checked_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

export interface RoutePlanTruck {
  id: string;
  route_plan_id: string | null;
  plate_number: string | null;
  carrier: string | null;
  /** Auto-derived from destination + convoy status once destination is set (see trucking_rates). Masked to null for roles other than ADMIN/LOGISTICS_OFFICER. */
  truck_rate: number | null;
  is_convoy: boolean;
  main_truck_id: string | null;
  dispatched_at: string | null;
  created_at: string | null;
  driver_name: string | null;
  helper1_name: string | null;
  helper2_name: string | null;
  /** Delivery destination town/city; drives the automatic truck_rate lookup against trucking_rates. */
  destination: string | null;
  /** Editable contact number shown on the per-day Delivery Route report. Update restricted to ADMIN/JMD_PLANNER/LOGISTICS_OFFICER via RLS. */
  contact_number: string | null;
  /** When true, truck_rate is a manually-negotiated one-off amount and the destination-based rate card lookup is skipped. ADMIN/LOGISTICS_OFFICER only. */
  is_negotiated_rate: boolean;
  /** Looked up from trucking_rates.area via destination. View-only; masked to ADMIN/LOGISTICS_OFFICER/LOGISTICS_ASSOCIATE. */
  area?: string | null;
}

export interface TruckingRate {
  id: string;
  destination: string;
  area: string;
  /** Masked to null for roles other than ADMIN/LOGISTICS_OFFICER. */
  rate: number | null;
  /** Masked to null for roles other than ADMIN/LOGISTICS_OFFICER. */
  convoy_rate: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface RoutePlanInvoice {
  id: string;
  route_plan_truck_id: string | null;
  invoice_id: string | null;
  service_rate_pct: number | null;
  delivered_at: string | null;
  reason_id: string | null;
  created_at: string | null;
  /**
   * Set when this assignment has been rescheduled for redelivery elsewhere.
   * The row is kept (never deleted) so the original truck retains history,
   * but a superseded row no longer blocks the invoice from being assigned to
   * a new truck/date, and its amount is excluded from CTS once Backload is set.
   */
  superseded_at: string | null;
  /** Number of boxes for this invoice as loaded onto the truck. */
  qty_box: number | null;
  /** Manual drop/stop sequence number (1st drop, 2nd drop, ...) for this invoice on this truck. Null = no manual sequence set. */
  drop_no: number | null;
}

export interface MondialConfirmation {
  id: string;
  invoice_id: string | null;
  confirmed: boolean;
  confirmed_at: string | null;
  confirmed_by: string | null;
  created_at: string | null;
}

export interface DeliveryVarianceLog {
  id: string;
  series_seq: number;
  series_no: string;
  invoice_id: string | null;
  route_plan_invoice_id: string | null;
  reason_id: string | null;
  log_date: string;
  prepared_by: string | null;
  checked_by: string | null;
  received_by_1: string | null;
  received_by_2: string | null;
  remarks: string | null;
  /** Optional lump-sum total for BACKLOAD logs when the receipt isn't
   *  itemized -- when set, this overrides the sum of delivery_variance_log_items
   *  as the log's total (see v_delivery_variance_logs.total_amount). */
  backload_total_amount: number | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface DeliveryVarianceLogItem {
  id: string;
  log_id: string;
  item_description: string;
  qty: number;
  unit: string | null;
  unit_price: number;
  amount: number;
  returned_status: ReturnedStatus;
  remarks: string | null;
  created_at: string | null;
}

export interface AppSetting {
  key: string;
  value: string | null;
  updated_at: string | null;
}

export interface Transmittal {
  id: string;
  transmittal_no: string | null;
  category: InvoiceCategory;
  delivery_date: string;
  date_transmitted: string;
  status: TransmittalStatus;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface TransmittalItem {
  id: string;
  transmittal_id: string;
  invoice_id: string;
  remarks: string | null;
  created_at: string | null;
}

export interface TruckingBillingStatement {
  id: string;
  route_plan_truck_id: string;
  series_seq: number;
  series_no: string;
  waybill_no: string | null;
  /** Waybill # of the paired convoy truck, when this truck has one (see has_convoy on the view). */
  convoy_waybill_no: string | null;
  /** Vendor-supplied delivery zone/area for the whole truck (e.g. "PARANAQUE"). */
  area: string | null;
  /** Vendor-supplied vehicle classification (e.g. "4W", "6W"). */
  truck_type: string | null;
  status: TruckingBillingStatus;
  billed_at: string | null;
  paid_at: string | null;
  prepared_by: string | null;
  approved_by: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// Views

export interface VFulfillmentSummary {
  delivered_count: number;
  discrepancy_count: number;
  backload_count: number;
  total_assigned: number;
  fulfillment_rate_pct: number | null;
}

export interface VTruckCts {
  truck_id: string;
  route_plan_id: string | null;
  plate_number: string | null;
  truck_rate: number | null;
  total_invoice_amount: number | null;
  cts_pct: number | null;
  /** true = passing (<=5%), false = over threshold (flag red), null = no data yet */
  cts_pass: boolean | null;
}

export interface VBilling {
  invoice_id: string;
  document_no: string;
  category: InvoiceCategory;
  zone: ZoneType;
  is_dc: boolean;
  amount: number;
  company_name: string | null;
  branch_address: string | null;
  plan_date: string | null;
  posting_date: string | null;
  transmittal_received_date: string | null;
  /** Set once this invoice has been batched into a printed Transmittal --
   *  see migration 0012. Non-null here auto-confirms the row for Final
   *  Billing purposes (alongside the existing manual mondial_confirmations
   *  path) -- see migration 0049. */
  transmittal_id: string | null;
  billing_period: string | null;
  delivered_at: string | null;
  service_rate_pct: number | null;
  service_fee: number | null;
  /** true = this line is the automatic "failed attempt" charge for a
   *  Backload reason flagged chargeable_to_mondial -- a second, separate
   *  billable line for the same document_no alongside its normal delivered
   *  line. See migration 0028. */
  is_mondial_fault_charge: boolean;
  /** The Backload reason's own label (e.g. "Wrong Contact Info Given") when
   *  is_mondial_fault_charge is true -- explains why this document_no is
   *  billed a second time. Always null on the normal branch. See migration
   *  0039. */
  reason_label: string | null;
}

export interface VFinalBilling extends VBilling {
  confirmed: boolean;
  confirmed_at: string | null;
}

export interface VDeliveryVarianceLog {
  id: string;
  series_no: string;
  invoice_id: string | null;
  document_no: string | null;
  retail_chain: string | null;
  branch_address: string | null;
  category: InvoiceCategory | null;
  route_plan_invoice_id: string | null;
  reason_id: string | null;
  reason_type: ReasonType | null;
  reason_label: string | null;
  log_date: string;
  prepared_by: string | null;
  checked_by: string | null;
  received_by_1: string | null;
  received_by_2: string | null;
  remarks: string | null;
  created_at: string | null;
  updated_at: string | null;
  item_count: number;
  total_amount: number;
  /** Route plan this variance traces back to, via route_plan_invoice_id ->
   *  route_plan_trucks -> route_plans. Null for manually-created logs with
   *  no route plan link (see handleCreateLog in delivery-variance/page.tsx). */
  route_plan_id: string | null;
  /** The route plan's route_date -- the actual day the discrepancy/backload
   *  occurred (matches log_date for auto-linked rows going forward). */
  route_date: string | null;
  /** e.g. "Truck 2" or "Truck 2 · Convoy 1" -- same numbering as the Route
   *  Plan board (RoutePlanBoard.tsx), reproduced server-side via window
   *  functions in v_delivery_variance_logs. Null for manually-created logs. */
  truck_label: string | null;
  /** Optional lump-sum total for BACKLOAD logs when the receipt isn't
   *  itemized. When set, total_amount above reflects this value instead of
   *  the sum of items. */
  backload_total_amount: number | null;
  /** Set via a checkbox in the UI once the printed form has been filed --
   *  moves the row from the "Active" sub-tab to the "Printed" sub-tab. */
  printed: boolean;
}

export interface VDeliveryVarianceReasonSummary {
  reason_id: string;
  reason_type: ReasonType;
  reason_label: string;
  log_count: number;
}

export interface VTransmittal {
  id: string;
  transmittal_no: string | null;
  category: InvoiceCategory;
  delivery_date: string;
  date_transmitted: string;
  status: TransmittalStatus;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  item_count: number;
  amount: number;
  first_document_no: string | null;
  last_document_no: string | null;
}

export interface VTransmittalItem {
  id: string;
  transmittal_id: string;
  invoice_id: string;
  remarks: string | null;
  document_no: string;
  document_no_sort: string;
  category: InvoiceCategory;
  actual_delivery_date: string | null;
  billing_period: string | null;
  posting_date: string | null;
  company_name_raw: string | null;
  branch_address: string | null;
  amount: number;
}

export interface VTruckingBillingStatement {
  id: string;
  route_plan_truck_id: string;
  series_no: string;
  waybill_no: string | null;
  status: TruckingBillingStatus;
  billed_at: string | null;
  paid_at: string | null;
  prepared_by: string | null;
  approved_by: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  plate_number: string | null;
  carrier: string | null;
  driver_name: string | null;
  helper1_name: string | null;
  helper2_name: string | null;
  /** Masked to null for roles other than ADMIN/LOGISTICS_OFFICER. */
  truck_rate: number | null;
  route_plan_id: string | null;
  route_date: string | null;
  route_plan_label: string | null;
  item_count: number;
  total_boxes: number;
  total_amount: number;
  /** Vendor-supplied delivery zone/area for the whole truck (e.g. "PARANAQUE"). */
  area: string | null;
  /** Vendor-supplied vehicle classification (e.g. "4W", "6W"). */
  truck_type: string | null;
  /** Waybill # of the paired convoy truck, when has_convoy is true. */
  convoy_waybill_no: string | null;
  /** True when a route_plan_trucks row exists with main_truck_id = this truck's id. */
  has_convoy: boolean;
  /** Delivery destination town/city of the truck (see route_plan_trucks.destination). */
  destination: string | null;
  /** True when truck_rate is a manually-negotiated one-off amount (destination rate card lookup was skipped). */
  is_negotiated_rate: boolean;
  /** Manual override for the Delivery Report's merged Boxes total. Null = total_boxes is the live-computed sum. */
  total_boxes_override: number | null;
  /** The truck's own route_plan_trucks.created_at -- same field RoutePlanBoard uses to derive "Truck 1, 2, 3" order. Used to sort the Excel export's sheets. */
  truck_created_at: string | null;
}

export interface VTruckingBillingStatementItem {
  statement_id: string;
  route_plan_invoice_id: string;
  invoice_id: string;
  document_no: string;
  category: InvoiceCategory;
  company_name_raw: string | null;
  branch_address: string | null;
  declared_value: number;
  qty_box: number | null;
  actual_delivery_date: string | null;
  posting_date: string | null;
  /** Manual drop/stop sequence number this item's order now follows (nulls sort last). */
  drop_no: number | null;
}

export interface VTruckingBillingCandidate {
  route_plan_truck_id: string;
  plate_number: string | null;
  carrier: string | null;
  driver_name: string | null;
  /** Masked to null for roles other than ADMIN/LOGISTICS_OFFICER. */
  truck_rate: number | null;
  route_plan_id: string;
  route_date: string;
  route_plan_label: string | null;
  item_count: number;
  total_boxes: number;
  total_amount: number;
  /** True when a route_plan_trucks row exists with main_truck_id = this truck's id. */
  has_convoy: boolean;
  /** Delivery destination town/city of the truck (see route_plan_trucks.destination). */
  destination: string | null;
  /** Looked up from trucking_rates.area via destination. Masked to ADMIN/LOGISTICS_OFFICER/LOGISTICS_ASSOCIATE. */
  area: string | null;
  /** True when truck_rate is a manually-negotiated one-off amount (destination rate card lookup was skipped). */
  is_negotiated_rate: boolean;
}

export interface Database {
  public: {
    Tables: {
      companies: {
        Row: Company;
        Insert: Partial<Company> & { name: string };
        Update: Partial<Company>;
        Relationships: [];
      };
      branch_addresses: {
        Row: BranchAddress;
        Insert: Partial<BranchAddress> & { address: string };
        Update: Partial<BranchAddress>;
        Relationships: [];
      };
      fee_rates: {
        Row: FeeRate;
        Insert: Partial<FeeRate>;
        Update: Partial<FeeRate>;
        Relationships: [];
      };
      principals: {
        Row: Principal;
        Insert: Partial<Principal> & { name: string };
        Update: Partial<Principal>;
        Relationships: [];
      };
      principal_rates: {
        Row: PrincipalRate;
        Insert: Partial<PrincipalRate> & { principal_id: string; rate_pct: number };
        Update: Partial<PrincipalRate>;
        Relationships: [];
      };
      delivery_reasons: {
        Row: DeliveryReason;
        Insert: Partial<DeliveryReason>;
        Update: Partial<DeliveryReason>;
        Relationships: [];
      };
      invoices: {
        Row: Invoice;
        Insert: Partial<Invoice> & {
          document_no: string;
          category: InvoiceCategory;
          zone: ZoneType;
          amount: number;
        };
        Update: Partial<Invoice>;
        Relationships: [];
      };
      route_plans: {
        Row: RoutePlan;
        Insert: Partial<RoutePlan> & { route_date: string };
        Update: Partial<RoutePlan>;
        Relationships: [];
      };
      route_plan_trucks: {
        Row: RoutePlanTruck;
        Insert: Partial<RoutePlanTruck>;
        Update: Partial<RoutePlanTruck>;
        Relationships: [];
      };
      route_plan_invoices: {
        Row: RoutePlanInvoice;
        Insert: Partial<RoutePlanInvoice>;
        Update: Partial<RoutePlanInvoice>;
        Relationships: [];
      };
      mondial_confirmations: {
        Row: MondialConfirmation;
        Insert: Partial<MondialConfirmation>;
        Update: Partial<MondialConfirmation>;
        Relationships: [];
      };
      delivery_variance_logs: {
        Row: DeliveryVarianceLog;
        Insert: Partial<DeliveryVarianceLog>;
        Update: Partial<DeliveryVarianceLog>;
        Relationships: [];
      };
      delivery_variance_log_items: {
        Row: DeliveryVarianceLogItem;
        Insert: Partial<DeliveryVarianceLogItem> & { log_id: string; item_description: string };
        Update: Partial<DeliveryVarianceLogItem>;
        Relationships: [];
      };
      app_settings: {
        Row: AppSetting;
        Insert: Partial<AppSetting> & { key: string };
        Update: Partial<AppSetting>;
        Relationships: [];
      };
      user_profiles: {
        Row: UserProfile;
        Insert: Partial<UserProfile> & { id: string; username: string; role: UserRole };
        Update: Partial<UserProfile>;
        Relationships: [];
      };
      transmittals: {
        Row: Transmittal;
        Insert: Partial<Transmittal> & { category: InvoiceCategory; delivery_date: string };
        Update: Partial<Transmittal>;
        Relationships: [];
      };
      transmittal_items: {
        Row: TransmittalItem;
        Insert: Partial<TransmittalItem> & { transmittal_id: string; invoice_id: string };
        Update: Partial<TransmittalItem>;
        Relationships: [];
      };
      trucking_billing_statements: {
        Row: TruckingBillingStatement;
        Insert: Partial<TruckingBillingStatement> & { route_plan_truck_id: string };
        Update: Partial<TruckingBillingStatement>;
        Relationships: [];
      };
      trucking_rates: {
        Row: TruckingRate;
        Insert: Partial<TruckingRate> & { destination: string; area: string; rate: number; convoy_rate: number };
        Update: Partial<TruckingRate>;
        Relationships: [];
      };
    };
    Views: {
      v_fulfillment_summary: { Row: VFulfillmentSummary; Relationships: [] };
      v_truck_cts: { Row: VTruckCts; Relationships: [] };
      v_billing: { Row: VBilling; Relationships: [] };
      v_final_billing: { Row: VFinalBilling; Relationships: [] };
      v_route_plan_trucks: { Row: RoutePlanTruck; Relationships: [] };
      v_delivery_variance_logs: { Row: VDeliveryVarianceLog; Relationships: [] };
      v_delivery_variance_reason_summary: { Row: VDeliveryVarianceReasonSummary; Relationships: [] };
      v_transmittals: { Row: VTransmittal; Relationships: [] };
      v_transmittal_items: { Row: VTransmittalItem; Relationships: [] };
      v_trucking_billing_statements: { Row: VTruckingBillingStatement; Relationships: [] };
      v_trucking_billing_statement_items: { Row: VTruckingBillingStatementItem; Relationships: [] };
      v_trucking_billing_candidates: { Row: VTruckingBillingCandidate; Relationships: [] };
      v_trucking_rates: { Row: TruckingRate; Relationships: [] };
    };
    Functions: Record<string, never>;
  };
}

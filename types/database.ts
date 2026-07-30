// TypeScript types mirroring supabase/migrations/0001_init.sql
// Keep field names in sync with the SQL schema exactly.

export type InvoiceCategory = "CONSIGNMENT" | "OUTRIGHT" | "MERCURY_DRUG";
export type ZoneType = "NCR" | "FAR_NORTH_SOUTH" | "VIZMIN";
export type InvoiceStatus = "PENDING" | "DISPATCHED" | "DELIVERED" | "CANCELLED";
export type ReasonType = "DISCREPANCY" | "BACKLOAD";
export type ReturnedStatus = "RETURNED" | "NOT_RETURNED" | "PARTIAL";
export type TransmittalStatus = "PENDING" | "TRANSMITTED";
export type UserRole =
  | "ADMIN"
  | "LOGISTICS_OFFICER"
  | "JMD_PLANNER"
  | "MONDIAL_TEAM"
  | "LOGISTICS_ASSOCIATE"
  | "GENERAL_MANAGER";

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

export interface DeliveryReason {
  id: string;
  type: ReasonType;
  label: string;
}

export interface Invoice {
  id: string;
  document_no: string;
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
  truck_rate: number | null;
  is_convoy: boolean;
  main_truck_id: string | null;
  dispatched_at: string | null;
  created_at: string | null;
  driver_name: string | null;
  helper1_name: string | null;
  helper2_name: string | null;
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
  billing_period: string | null;
  delivered_at: string | null;
  service_rate_pct: number | null;
  service_fee: number | null;
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
  category: InvoiceCategory;
  actual_delivery_date: string | null;
  billing_period: string | null;
  posting_date: string | null;
  company_name_raw: string | null;
  branch_address: string | null;
  amount: number;
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
    };
    Functions: Record<string, never>;
  };
}

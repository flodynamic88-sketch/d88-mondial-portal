// TypeScript types mirroring supabase/migrations/0001_init.sql
// Keep field names in sync with the SQL schema exactly.

export type InvoiceCategory = "CONSIGNMENT" | "OUTRIGHT" | "MERCURY_DRUG";
export type ZoneType = "NCR" | "FAR_NORTH_SOUTH" | "VIZMIN";
export type InvoiceStatus = "PENDING" | "DISPATCHED" | "DELIVERED" | "CANCELLED";
export type ReasonType = "DISCREPANCY" | "BACKLOAD";

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
  zone: ZoneType;
  is_dc: boolean;
  company_id: string | null;
  company_name_raw: string | null;
  branch_address: string | null;
  amount: number;
  plan_date: string | null;
  posting_date: string | null;
  transmittal_received_date: string | null;
  billing_period: string | null;
  remarks: string | null;
  status: InvoiceStatus;
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
}

export interface RoutePlanInvoice {
  id: string;
  route_plan_truck_id: string | null;
  invoice_id: string | null;
  service_rate_pct: number | null;
  delivered_at: string | null;
  reason_id: string | null;
  created_at: string | null;
}

export interface MondialConfirmation {
  id: string;
  invoice_id: string | null;
  confirmed: boolean;
  confirmed_at: string | null;
  confirmed_by: string | null;
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
}

export interface VBilling {
  invoice_id: string;
  document_no: string;
  category: InvoiceCategory;
  zone: ZoneType;
  is_dc: boolean;
  amount: number;
  delivered_at: string | null;
  service_rate_pct: number | null;
  service_fee: number | null;
}

export interface VFinalBilling extends VBilling {
  confirmed: boolean;
  confirmed_at: string | null;
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
    };
    Views: {
      v_fulfillment_summary: { Row: VFulfillmentSummary; Relationships: [] };
      v_truck_cts: { Row: VTruckCts; Relationships: [] };
      v_billing: { Row: VBilling; Relationships: [] };
      v_final_billing: { Row: VFinalBilling; Relationships: [] };
    };
    Functions: Record<string, never>;
  };
}

export type UserRole = "admin" | "encoder" | "logistics_officer" | "general_manager";

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  encoder: "Encoder",
  logistics_officer: "Logistics Officer",
  general_manager: "General Manager",
};

export const ROLE_OPTIONS: { value: UserRole; label: string }[] = (
  Object.keys(ROLE_LABELS) as UserRole[]
).map((value) => ({ value, label: ROLE_LABELS[value] }));

// Roles that can encode/edit deliveries (mirrors the is_active_user() RLS rule)
export const CAN_EDIT_DELIVERIES: UserRole[] = ["admin", "encoder", "logistics_officer"];

// Roles that can view (but not edit) Master Data sections
export const CAN_VIEW_MASTER_DATA: UserRole[] = ["admin", "general_manager"];

export interface Profile {
  id: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  client_code: string;
  client_name: string;
  /** Mercury Drug vendor/supplier code for this client (e.g. Mondial:
   * 61526, Adesteck: 12526, Rodzon: 82518, Healthwellness: 42189) --
   * shown on the Store Visit form and Inventory Count Sheet. */
  vendor_code: string | null;
  contact_person: string | null;
  contact_no: string | null;
  email: string | null;
  delivery_address: string | null;
  billing_address: string | null;
  payment_terms: string | null;
  credit_limit: number | null;
  status: string;
  date_onboarded: string | null;
  invoice_template: string | null;
  /** % of invoice amount charged as service fee, e.g. 10.00 = 10% */
  service_rate: number | null;
  /** True for clients whose stock we physically warehouse (e.g. Rodzon) —
   * enables the Warehouse Inventory module for their items. */
  manages_inventory: boolean;
  /** First invoice number of this client's pre-printed invoice booklet
   * series (e.g. Rodzon: 716551, HealthWellness/HWL: 43351). Null = this
   * client doesn't use numbered booklets — Booklet Summary hides them. */
  invoice_booklet_start: number | null;
  /** How many invoice numbers per physical booklet. Defaults to 50. */
  invoice_booklet_size: number;
  created_at: string;
  updated_at: string;
}

/** A manually-recorded "Cancelled" mark for a booklet invoice number that
 * has no matching delivery_headers row (voided/spoiled slip, or simply not
 * yet used). See migration_034_invoice_booklets.sql. */
export interface BookletInvoiceStatus {
  id: string;
  client_id: string;
  invoice_number: number;
  status: "Cancelled";
  created_by: string | null;
  created_at: string;
}

export interface Branch {
  id: string;
  branch_code: string;
  retail_chain: string | null;
  branch_name: string;
  delivery_address: string | null;
  /** Full legal/registered name of the buyer this branch belongs to, printed
   * as the invoice's "Sold To" line (e.g. "MERCURY DRUG CORPORATION"). Kept
   * separate from retail_chain (used for filtering/reports) since reports
   * need a short consistent chain name while the invoice needs the exact
   * registered legal name. Falls back to retail_chain if left blank. */
  registered_name: string | null;
  /** Buyer's TIN, printed on the invoice's "Sold To" block. */
  tin: string | null;
  /** Buyer's registered business address for invoicing/BIR purposes — this
   * is usually the head office address (constant across all of that buyer's
   * branches), NOT the specific delivery_address of this branch. Falls back
   * to delivery_address if left blank. */
  registered_business_address: string | null;
  region: string | null;
  province: string | null;
  city_municipality: string | null;
  barangay: string | null;
  contact_person: string | null;
  contact_no: string | null;
  email: string | null;
  receiving_hours: string | null;
  cutoff_time: string | null;
  max_truck_size: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientBranchLink {
  id: string;
  client_id: string;
  branch_id: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  clients?: Pick<Client, "id" | "client_code" | "client_name">;
  branches?: Pick<Branch, "id" | "branch_code" | "branch_name">;
}

export interface Item {
  id: string;
  client_id: string | null;
  item_code: string;
  item_description: string;
  category: string | null;
  unit: string | null;
  unit_price: number;
  reorder_pt: number | null;
  status: string;
  notes: string | null;
  /** Running warehouse stock balance — only meaningful for items belonging
   * to a client with manages_inventory = true. */
  current_stock: number;
  /** Optional second code for this item. If set, the invoice print page
   * shows this instead of item_code (e.g. Rodzon items use their own
   * in-house item_code internally, but the printed invoice should show
   * Mercury's item code instead). */
  mercury_item_code: string | null;
  created_at: string;
  updated_at: string;
  clients?: Pick<Client, "id" | "client_code" | "client_name">;
}

export interface LookupValue {
  id: string;
  category: string;
  value: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const LOOKUP_CATEGORIES = [
  "delivery_status",
  "billing_status",
  "person_in_charge",
  "carrier_provider",
  "payment_terms",
  "unit_of_measure",
  "item_category",
  "priority_level",
  "quick_remark",
  "carrier_truck",
  "return_reason",
  "return_status",
  "driver",
  "helper",
  "sign_copy_status",
  "yes_no",
  "dispatch_status",
  "truck_code",
  "plate_number",
  "vehicle_type",
  "retail_chain",
] as const;

export type LookupCategory = (typeof LOOKUP_CATEGORIES)[number];

export const LOOKUP_CATEGORY_LABELS: Record<LookupCategory, string> = {
  delivery_status: "Delivery Status",
  billing_status: "Billing Status",
  person_in_charge: "Person In-Charge",
  carrier_provider: "3PL / Trucking Providers",
  payment_terms: "Payment Terms",
  unit_of_measure: "Unit of Measure",
  item_category: "Item Category",
  priority_level: "Priority Level",
  quick_remark: "Quick Remarks",
  carrier_truck: "Carrier / Truck",
  return_reason: "Return Reason",
  return_status: "Return Status",
  driver: "Driver",
  helper: "Helper",
  sign_copy_status: "Sign-Copy Status",
  yes_no: "Yes / No",
  dispatch_status: "Dispatch Status",
  truck_code: "Truck Code",
  plate_number: "Plate #",
  vehicle_type: "Type (Vehicle)",
  retail_chain: "Retail Chain",
};

export interface DeliveryHeader {
  id: string;
  po_number: string | null;
  /** Links this delivery back to the Purchase Order it was created from, if any. */
  po_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  client_id: string | null;
  branch_id: string | null;
  posting_date: string | null;
  date_of_delivery: string | null;
  status: string;
  priority: string | null;
  remarks: string | null;
  truck_carrier: string | null;
  return_status: string | null;
  date_returned: string | null;
  /** Unpaid / For Checking / Partially Paid / Paid / Disputed */
  billing_status: string;
  /** 'Delivery' (normal) or 'Pickup' (fixed 5% pick-up fee, billed separately) */
  transaction_type: string;
  /** True while this delivery's line items have had warehouse stock
   * deducted (set automatically when status becomes "In-Transit", and
   * cleared automatically if status later moves away from it again). */
  stock_deducted: boolean;
  /** Timestamp set when warehouse staff explicitly click "Mark as
   * Dispatched" on the For Dispatch tab, once they've physically pulled the
   * stock for this delivery. Null means it still needs to be picked. Purely
   * a warehouse-picking checkpoint — independent of `status`/`stock_deducted`. */
  dispatched_at: string | null;
  /** Optional per-delivery override of the client's default service_rate
   * (e.g. HWL: 13 for NCR, 17 for Far North/Far South). Null = fall back to
   * clients.service_rate, same as before this existed. */
  service_rate_override: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  clients?: Pick<
    Client,
    | "id"
    | "client_code"
    | "client_name"
    | "billing_address"
    | "payment_terms"
    | "invoice_template"
    | "service_rate"
    | "manages_inventory"
  >;
  branches?: Pick<
    Branch,
    | "id"
    | "branch_code"
    | "branch_name"
    | "delivery_address"
    | "retail_chain"
    | "registered_name"
    | "tin"
    | "registered_business_address"
  >;
}

/** Shape returned by the v_delivery_headers_full view (flat columns, used
 * by the Deliveries list and Billing pages). */
export interface DeliveryHeaderFull {
  id: string;
  po_number: string | null;
  po_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  client_id: string | null;
  branch_id: string | null;
  posting_date: string | null;
  date_of_delivery: string | null;
  status: string;
  priority: string | null;
  billing_status: string;
  transaction_type: string;
  client_code?: string;
  client_name?: string;
  /** Effective rate actually used for this delivery's fee — the per-delivery
   * service_rate_override if set, else the client's own default service_rate. */
  service_rate?: number | null;
  /** Raw per-delivery override value, if one was set (null = using client default). */
  service_rate_override?: number | null;
  branch_code?: string;
  branch_name?: string;
  branch_delivery_address?: string;
  days_variance?: number | null;
  total_amount?: number;
  total_net_amount?: number;
  service_fee_amount?: number;
}

export interface DeliveryLine {
  id: string;
  delivery_header_id: string;
  item_id: string | null;
  item_description: string;
  qty: number;
  unit_price: number;
  amount: number;
  qty_delivered: number | null;
  qty_returned: number | null;
  net_accepted_qty: number | null;
  net_amount: number | null;
  return_reason: string | null;
  /** Directly-entered expiration date for this line (encoder types it in
   * when adding the item) — always available regardless of whether the
   * item's client uses the Warehouse/FEFO batch-tracking module. Takes
   * priority over the FEFO-derived delivery_line_batches below when
   * printing/displaying, since it's an explicit, confirmed value. */
  expiration_date: string | null;
  created_at: string;
  updated_at: string;
  items?: Pick<Item, "id" | "item_code" | "item_description" | "unit_price" | "unit" | "mercury_item_code">;
  /** Which warehouse batch(es) this line's stock was drawn from, earliest
   * expiration date first (FEFO) — populated automatically by the database
   * the moment stock is actually deducted for this line. */
  delivery_line_batches?: Pick<DeliveryLineBatch, "id" | "qty" | "expiration_date">[];
}

/** Records exactly which Stock Receipt batch(es) a Delivery line's qty was
 * drawn from, and that batch's expiration date — assigned automatically
 * (First-Expired-First-Out) the moment stock is deducted for a delivery. A
 * single delivery line can span more than one batch/expiration date if one
 * batch alone isn't enough to cover its qty. */
export interface DeliveryLineBatch {
  id: string;
  delivery_line_id: string;
  stock_receipt_line_id: string | null;
  qty: number;
  expiration_date: string | null;
  created_at: string;
}

export interface DashboardKpis {
  current_year: number;
  total_net_delivered_this_year: number;
  active_clients: number;
  active_branches: number;
  pending_deliveries: number;
  in_transit_deliveries: number;
  late_deliveries: number;
  returned_deliveries: number;
}

export interface MonthlyTrendRow {
  sales_year: number;
  sales_month_num: number;
  month_label: string;
  total_net_amount: number;
  delivery_count: number;
}

export interface MonthlySalesByClientRow {
  sales_month: string;
  sales_year: number;
  sales_month_num: number;
  client_id: string;
  client_code: string;
  client_name: string;
  delivery_count: number;
  total_qty: number;
  total_amount: number;
  total_net_qty: number;
  total_net_amount: number;
}

export interface BranchSalesRow {
  branch_id: string;
  branch_code: string;
  branch_name: string;
  retail_chain: string | null;
  sales_year: number;
  sales_month_num: number;
  delivery_count: number;
  total_qty: number;
  total_amount: number;
  total_net_qty: number;
  total_net_amount: number;
}

export interface BranchPerformanceRow {
  branch_id: string;
  branch_code: string;
  branch_name: string;
  retail_chain: string | null;
  sales_year?: number | null;
  sales_month_num?: number | null;
  client_id: string | null;
  client_code: string | null;
  client_name: string | null;
  total_deliveries: number;
  on_time_deliveries: number;
  late_deliveries: number;
  cancelled_deliveries: number;
  returned_deliveries: number;
  avg_days_variance: number | null;
  total_qty: number;
  total_qty_returned: number;
  total_net_amount: number;
  return_rate_pct: number;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  client_id: string | null;
  branch_id: string | null;
  po_date: string | null;
  /** 'Open' (not yet used) | 'Used' (already consumed by a delivery) | 'Cancelled' */
  status: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PoLine {
  id: string;
  po_id: string;
  item_id: string | null;
  item_description: string;
  qty: number;
  unit_price: number;
  amount: number;
  created_at: string;
  updated_at: string;
  items?: Pick<Item, "id" | "item_code" | "item_description" | "unit_price" | "unit">;
}

/** Shape returned by the v_purchase_orders_full view (header + names + totals),
 * used by the Purchase Orders list page. */
export interface PurchaseOrderFull {
  id: string;
  po_number: string;
  client_id: string | null;
  branch_id: string | null;
  po_date: string | null;
  status: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  client_code?: string;
  client_name?: string;
  branch_code?: string;
  branch_name?: string;
  total_amount?: number;
  line_count?: number;
}

/** A request WE send TO a client (acting as our supplier in this
 * direction) asking them to prepare a given quantity of items for us to
 * pick up. Not linked to Purchase Orders or Pick-ups — those stay
 * separate; once the goods are actually picked up, that gets encoded on
 * the existing New Pick-up page. */
export interface StockRequest {
  id: string;
  request_number: string;
  client_id: string | null;
  request_date: string | null;
  /** Free text — can hold "ASAP" as well as an actual date. */
  delivery_date_requested: string | null;
  /** e.g. "Monday to Friday - 9:00AM to 4:00PM" */
  delivery_schedule_note: string | null;
  /** 'Open' | 'Fulfilled' | 'Cancelled' */
  status: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockRequestLine {
  id: string;
  request_id: string;
  item_id: string | null;
  item_description: string;
  qty: number;
  unit: string | null;
  created_at: string;
  updated_at: string;
  items?: Pick<Item, "id" | "item_code" | "item_description" | "unit">;
}

/** Shape returned by the v_stock_requests_full view (header + client name +
 * line count), used by the Stock Requests list page. */
export interface StockRequestFull {
  id: string;
  request_number: string;
  client_id: string | null;
  request_date: string | null;
  delivery_date_requested: string | null;
  delivery_schedule_note: string | null;
  status: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  client_code?: string;
  client_name?: string;
  line_count?: number;
}

export interface YearViewRow {
  sales_year: number;
  delivery_count: number;
  active_clients: number;
  active_branches: number;
  total_qty: number;
  total_amount: number;
  total_net_qty: number;
  total_net_amount: number;
}

export interface StockReceipt {
  id: string;
  client_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  date_received: string | null;
  notes: string | null;
  /** Public Vercel Blob URLs -- photo evidence of stock condition on arrival. */
  attachment_urls: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockReceiptLine {
  id: string;
  receipt_id: string;
  item_id: string | null;
  item_description: string;
  qty: number;
  /** Snapshot of the item's unit of measure at time of entry. */
  unit: string | null;
  /** Editable per line — pre-filled from the item's Unit Price when
   * selected, but can be overridden (supplier's invoice price may
   * differ from the item's selling price). */
  unit_price: number;
  /** qty * unit_price, computed automatically. */
  amount: number;
  /** Optional — expiration date of this specific batch/line. Since a single
   * delivery of one item can arrive with multiple expiration dates, split
   * the qty across multiple lines (one per expiration date) instead of a
   * single line per item. */
  expiration_date: string | null;
  /** How much of this batch's original qty is still unconsumed by
   * Deliveries — used internally by FEFO stock deduction, not
   * shown/edited directly in the UI. */
  qty_remaining: number;
  created_at: string;
  updated_at: string;
  items?: Pick<Item, "id" | "item_code" | "item_description" | "unit">;
}

/** Shape returned by the v_stock_receipts_full view (header + client name +
 * totals), used by the Stock Receiving list page. */
export interface StockReceiptFull {
  id: string;
  client_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  date_received: string | null;
  notes: string | null;
  attachment_urls?: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  client_code?: string;
  client_name?: string;
  total_qty?: number;
  total_amount?: number;
  line_count?: number;
}

/** Shape returned by the v_inventory_status view, used by the Inventory
 * status page. */
export interface InventoryStatusRow {
  item_id: string;
  item_code: string;
  item_description: string;
  category: string | null;
  unit: string | null;
  client_id: string;
  client_code: string;
  client_name: string;
  current_stock: number;
  unit_price: number;
  /** current_stock * unit_price */
  stock_value: number;
  reorder_pt: number | null;
  is_low_stock: boolean;
}

/** Shape returned by the v_sales_report view (same as DeliveryHeaderFull,
 * plus report_date) — used by the client-facing Monthly Sales Report. */
export interface SalesReportRow extends DeliveryHeaderFull {
  /** coalesce(date_of_delivery, posting_date, invoice_date) — "which month
   * does this delivery belong to" for reporting purposes, so
   * Pending/In-Transit deliveries (no date_of_delivery yet) still show up
   * in the month they were posted, instead of disappearing from the
   * report entirely until delivered. */
  report_date: string | null;
}

/** Shape returned by the get_inventory_report(client_id, date_from, date_to)
 * SQL function — used by the client-facing Monthly Inventory Report. */
export interface InventoryReportRow {
  item_id: string;
  item_code: string;
  item_description: string;
  category: string | null;
  unit: string | null;
  unit_price: number;
  reorder_pt: number | null;
  /** Total stock_movements qty before the report period started. */
  beginning_balance: number;
  /** Sum of stock IN during the report period. */
  stock_in: number;
  /** Sum of stock OUT during the report period (positive number). */
  stock_out: number;
  /** Total stock_movements qty as of the end of the report period —
   * beginning_balance + stock_in - stock_out. */
  ending_balance: number;
}

/** Shape returned by the v_stock_movement_history view — one row per
 * stock_movements entry, joined to its item and client, with a simple
 * IN/OUT direction derived from the sign of qty. Powers the Stock
 * Movement History monitoring page and its printable monthly report. */
export interface StockMovementRow {
  movement_id: string;
  item_id: string;
  item_code: string;
  item_description: string;
  unit: string | null;
  client_id: string | null;
  client_code: string | null;
  client_name: string | null;
  movement_type: string;
  /** Signed quantity — positive for stock in, negative for stock out. */
  qty: number;
  direction: "IN" | "OUT";
  /** abs(qty), for display. */
  abs_qty: number;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
  /** created_at converted to Asia/Manila date, for daily/monthly grouping. */
  movement_date: string;
  /** Running balance for this item across ALL movements, oldest to newest — latest row always equals items.current_stock. */
  running_balance: number;
  /** Real document number (invoice #, etc.) resolved from the source Receiving/Delivery/Pickup record, if any. */
  document_number: string | null;
  /** Real document date (date received / date of delivery), falling back to movement_date. */
  document_date: string | null;
  /** Human-readable party/reason string, e.g. "Delivery to Branch X" or "Manual correction / pull-out". */
  party_or_reason: string | null;
  /** Expiration date of the batch involved in this movement — from stock_receipt_lines
   * for Receiving, or delivery_lines for Delivery/Pickup. Null for Correction. */
  expiration_date: string | null;
}

/** Shape returned by the v_items_delivered_summary view (migration_039) —
 * one row per client + item + delivery month, used by the Items Delivered
 * Summary report to trace how many units of an item were delivered to a
 * client in a given month. */
export interface ItemsDeliveredSummaryRow {
  client_id: string;
  client_code: string;
  client_name: string;
  item_id: string;
  item_code: string;
  item_description: string;
  delivery_year: number;
  delivery_month_num: number;
  /** e.g. "July 2026" */
  delivery_month_label: string;
  /** Number of distinct delivery headers contributing to this row. */
  delivery_count: number;
  /** Sum of delivery_lines.qty_delivered for this client/item/month. */
  total_qty_delivered: number;
  /** Sum of delivery_lines.qty_returned for this client/item/month. */
  total_qty_returned: number;
  /** total_qty_delivered - total_qty_returned. */
  total_net_qty_delivered: number;
}

// =====================================================================
// Incident Reports (IR) — migration_029
// =====================================================================

export const IR_CLASSIFICATIONS = [
  "Wrong Count",
  "Discrepancy",
  "Loss",
  "Damage",
  "Insubordination",
  "Wrong Picking",
  "Other",
] as const;

export type IrClassification = (typeof IR_CLASSIFICATIONS)[number];

export const IR_STATUSES = ["Open", "Under Review", "Resolved", "Closed"] as const;

export type IrStatus = (typeof IR_STATUSES)[number];

export interface IncidentReport {
  id: string;
  ir_number: string;

  incident_date: string;
  date_reported: string;

  classification: IrClassification;
  /** Only used/shown when classification === 'Other'. */
  other_classification: string | null;

  client_id: string | null;
  branch_id: string | null;
  /** Free-text fallback for incidents not tied to a specific client/branch. */
  location: string | null;

  employee_name: string;
  employee_position: string | null;
  /** Who filed/encoded this IR (supervisor, dispatcher, etc.) — free text. */
  reported_by: string | null;

  description: string;
  employee_explanation: string | null;
  immediate_action_taken: string | null;
  corrective_action: string | null;
  preventive_action: string | null;

  status: IrStatus;

  employee_acknowledged: boolean;
  employee_signed_date: string | null;

  reviewed_by: string | null;
  reviewed_date: string | null;
  manager_notes: string | null;

  created_by: string | null;
  created_at: string;
  updated_at: string;

  clients?: Pick<Client, "id" | "client_code" | "client_name"> | null;
  branches?: Pick<Branch, "id" | "branch_name" | "retail_chain"> | null;
}

export interface IncidentReportAttachment {
  id: string;
  incident_report_id: string;
  file_name: string;
  file_path: string;
  uploaded_for: string | null;
  uploaded_by: string | null;
  created_at: string;
}

// =====================================================================
// Bad Orders — migration_033 (Mercury backload monitoring)
// =====================================================================

export const BAD_ORDER_STATUSES = [
  "Stored in Warehouse",
  "Returned to Client/Principal",
  "Disposed",
] as const;

export type BadOrderStatus = (typeof BAD_ORDER_STATUSES)[number];

// 2026-07-16: split from a single flat `BadOrder` (one item per BO#) into
// a header + lines shape, mirroring StockReceipt/StockReceiptLine, so one
// BO# can now cover multiple items ("+ Add Line").
export interface BadOrderHeader {
  id: string;
  bo_number: string;

  date_backload: string;

  client_id: string | null;
  branch_id: string | null;

  status: BadOrderStatus;

  notes: string | null;

  /** Public Vercel Blob URLs -- photo evidence of the damaged/bad order items. */
  attachment_urls: string[];

  created_by: string | null;
  created_at: string;
  updated_at: string;

  clients?: Pick<Client, "id" | "client_code" | "client_name"> | null;
  branches?: Pick<Branch, "id" | "branch_code" | "branch_name" | "retail_chain"> | null;
}

export interface BadOrderLine {
  id: string;
  bad_order_header_id: string;

  item_id: string | null;

  /** Snapshot of the item's code (prefers Mercury Item Code) and
   * description at the time of encoding. */
  item_code: string;
  item_description: string;

  qty: number;
  unit: string | null;
  unit_price: number | null;
  /** qty * unit_price, computed automatically. */
  amount: number;

  /** Optional -- if the same item has multiple expiration dates in one
   * BO, split it across multiple lines (one per date). */
  expiration_date: string | null;

  created_at: string;
  updated_at: string;

  items?: Pick<Item, "id" | "item_code" | "item_description" | "unit"> | null;
}

/** Shape returned by v_bad_order_headers_full, used by the Bad Orders
 * monitoring list page (header + client/branch names + line rollups). */
export interface BadOrderHeaderFull {
  id: string;
  bo_number: string;
  date_backload: string;
  client_id: string | null;
  branch_id: string | null;
  status: BadOrderStatus;
  notes: string | null;
  attachment_urls?: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  client_code?: string | null;
  client_name?: string | null;
  branch_code?: string | null;
  branch_name?: string | null;
  line_count?: number;
  total_qty?: number;
  total_amount?: number;
}

// 2026-07-30: Sales Coordinator Store Visit / Field Inventory Monitoring.
// Header + lines shape (mirrors BadOrderHeader/BadOrderLine): one visit to
// a Mercury Drug (or any) branch, with an on-shelf/on-hand Qty per SKU
// across ALL clients handled at that branch. Submitted either from the
// authenticated portal, or from the standalone no-login mobile HTML form
// (deployed to Netlify) via the submit_store_visit() RPC.
export type StoreVisitSubmittedVia = "portal" | "mobile_form";

export interface StoreVisitHeader {
  id: string;

  sales_coordinator_name: string;
  visit_date: string;
  time_in: string | null;

  branch_id: string | null;

  /** Snapshot of branch details at time of visit -- lets the public form
   * submit even for a branch not yet in branch_id, or with corrected
   * on-site details. */
  branch_code: string | null;
  branch_name: string | null;
  address: string | null;
  store_hours: string | null;
  contact_no: string | null;

  submitted_via: StoreVisitSubmittedVia;

  notes: string | null;

  created_by: string | null;
  created_at: string;
  updated_at: string;

  branches?: Pick<Branch, "id" | "branch_code" | "branch_name"> | null;
}

export interface StoreVisitLine {
  id: string;
  store_visit_header_id: string;

  client_id: string | null;
  item_id: string | null;

  /** Snapshot of client/item identifiers at time of visit, so historical
   * records still read correctly even if the catalog changes later. */
  client_code: string | null;
  client_name: string | null;
  item_code: string | null;
  item_description: string | null;

  qty: number;

  created_at: string;
  updated_at: string;

  clients?: Pick<Client, "id" | "client_code" | "client_name"> | null;
  items?: Pick<Item, "id" | "item_code" | "item_description" | "unit"> | null;
}

/** Shape returned by v_store_visit_headers_full, used by the Store Visits
 * monitoring list page (header + current branch name/code + line rollups). */
export interface StoreVisitHeaderFull {
  id: string;
  sales_coordinator_name: string;
  visit_date: string;
  time_in: string | null;
  branch_id: string | null;
  branch_code: string | null;
  branch_name: string | null;
  address: string | null;
  store_hours: string | null;
  contact_no: string | null;
  submitted_via: StoreVisitSubmittedVia;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  branch_code_current?: string | null;
  branch_name_current?: string | null;
  line_count?: number;
  total_qty?: number;
}

/** Shape returned by v_store_visit_lines_full -- line flattened with its
 * full header/branch info, for the per-client Stock Monitoring page (the
 * app groups these by client_id to show that client's inventory movement
 * across every branch visited, over time). */
export interface StoreVisitLineFull {
  id: string;
  store_visit_header_id: string;
  client_id: string | null;
  item_id: string | null;
  client_code: string | null;
  client_name: string | null;
  item_code: string | null;
  item_description: string | null;
  qty: number;
  created_at: string;
  sales_coordinator_name: string;
  visit_date: string;
  time_in: string | null;
  branch_id: string | null;
  branch_code: string | null;
  branch_name: string | null;
  address: string | null;
  store_hours: string | null;
  contact_no: string | null;
  submitted_via: StoreVisitSubmittedVia;
}

/** Payload shape for the public.get_store_visit_form_data() RPC, used by
 * the standalone mobile HTML form to render its Branch dropdown and the
 * flat list of all Clients' SKUs. */
export interface StoreVisitFormBranch {
  id: string;
  branch_code: string | null;
  branch_name: string;
  address: string | null;
  store_hours: string | null;
  contact_no: string | null;
}

export interface StoreVisitFormItem {
  id: string;
  client_id: string;
  client_code: string | null;
  client_name: string;
  item_code: string | null;
  item_description: string;
}

export interface StoreVisitFormData {
  branches: StoreVisitFormBranch[];
  items: StoreVisitFormItem[];
}

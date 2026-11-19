// TypeScript types mirroring supabase/migrations/0092_vas_module.sql
// Keep field names in sync with the SQL schema exactly.
//
// VAS lives in its own `vas` Postgres schema (same separation pattern as
// Mercury's `flo` schema) -- NOT described by the main `public`-only
// `Database` type in types/database.ts. Every query from VAS pages must
// target the schema explicitly via `.schema("vas").from("table_name")`,
// using the untyped clients in lib/vas/supabase/.
//
// `role` on user_profiles is shared with the rest of the app (VAS_MANAGER /
// VAS_OFFICER live in the same public.user_role enum, see types/database.ts
// UserRole) -- unlike Mercury's own separate flo.employees-style role system.

export type VasItemType = "COMPONENT" | "CONSUMABLE" | "FINISHED_GOOD";
export type VasMemoStatus = "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type VasBatchStatus = "IN_PROGRESS" | "COMPLETED";
export type VasMovementType =
  | "STOCK_IN"
  | "CONSUMED"
  | "PRODUCED"
  | "TRANSFERRED_OUT"
  | "CONSUMABLE_USED"
  | "CORRECTION";

export interface VasItem {
  id: string;
  item_code: string;
  item_description: string;
  item_type: VasItemType;
  uom: string | null;
  is_active: boolean;
  /** Cost per unit (component/consumable), used to compute material and
   *  consumable cost per batch on vas.v_production_progress. */
  unit_cost: number;
  created_at: string;
}

export interface VasKitBom {
  id: string;
  kit_no: string;
  finished_item_id: string;
  description: string | null;
  is_active: boolean;
  /** Amount charged to the client per finished unit of this kit -- drives
   *  Revenue (and Profit) on vas.v_production_progress. */
  selling_price_per_unit: number;
  created_by: string | null;
  created_at: string;
}

export interface VasKitBomComponent {
  id: string;
  kit_bom_id: string;
  component_item_id: string;
  qty_per_kit: number;
  created_at: string;
}

export interface VasMemo {
  id: string;
  memo_no: string;
  memo_date: string;
  client_name: string;
  requested_by: string | null;
  status: VasMemoStatus;
  created_by: string | null;
  created_at: string;
}

export interface VasMemoItem {
  id: string;
  memo_id: string;
  kit_bom_id: string;
  qty_requested: number;
  created_at: string;
}

export interface VasProductionBatch {
  id: string;
  batch_no: string;
  batch_date: string;
  memo_item_id: string;
  manpower_count: number | null;
  /** Rate per person per day, e.g. 700. Defaults to 700 on new rows. */
  rate_per_manpower_day: number;
  /** Number of days this batch's manpower worked. Defaults to 1. */
  manpower_days: number;
  /** Generated column: manpower_count x rate_per_manpower_day x manpower_days.
   *  Read-only -- never sent on insert/update, Postgres computes it.
   *  Factored into total_cost/profit on vas.v_production_progress. */
  manpower_cost: number;
  qty_produced: number;
  status: VasBatchStatus;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface VasStockMovement {
  id: string;
  item_id: string;
  movement_type: VasMovementType;
  /** Signed: positive increases the item's balance, negative decreases it. */
  qty: number;
  reference_type: string;
  reference_id: string | null;
  movement_date: string;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
}

export interface VasWarehouseTransfer {
  id: string;
  batch_id: string;
  transfer_date: string;
  qty_transferred: number;
  endorsed_by: string | null;
  received_by: string | null;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
}

// ── Views ────────────────────────────────────────────────────────────────

/** vas.v_stock_balance -- live balance per item, never cached. */
export interface VasStockBalance {
  item_id: string;
  item_code: string;
  item_description: string;
  item_type: VasItemType;
  uom: string | null;
  balance_qty: number;
}

/** vas.v_production_progress -- one row per batch, with running cumulative
 *  output per memo line (window function), for deriving today/previous/
 *  balance on the Daily Bundle Production Report. */
export interface VasProductionProgress {
  batch_id: string;
  batch_no: string;
  batch_date: string;
  manpower_count: number | null;
  manpower_cost: number;
  qty_produced: number;
  status: VasBatchStatus;
  remarks: string | null;
  memo_item_id: string;
  target_qty: number;
  kit_bom_id: string;
  kit_no: string;
  kit_description: string | null;
  finished_item_id: string;
  selling_price_per_unit: number;
  memo_id: string;
  memo_no: string;
  client_name: string;
  cumulative_qty_to_date: number;
  /** This batch's own material cost (BOM components x unit_cost x qty_produced). */
  material_cost: number;
  /** Consumables allocated specifically to this batch (CONSUMABLE_ALLOCATION movements x unit_cost). */
  consumable_cost: number;
  /** material_cost + consumable_cost + manpower_cost for this batch. */
  total_cost: number;
  /** selling_price_per_unit x qty_produced for this batch. */
  revenue: number;
  /** revenue - total_cost for this batch. */
  profit: number;
  /** Running material_cost across all batches on this memo line, as of this batch_date. */
  cumulative_material_cost: number;
  /** Running consumable_cost across all batches on this memo line, as of this batch_date. */
  cumulative_consumable_cost: number;
  /** Running manpower_cost across all batches on this memo line, as of this batch_date. */
  cumulative_manpower_cost: number;
  /** Running total_cost across all batches on this memo line, as of this batch_date. */
  cumulative_total_cost: number;
  /** Running revenue across all batches on this memo line, as of this batch_date. */
  cumulative_revenue: number;
  /** Running profit across all batches on this memo line, as of this batch_date. */
  cumulative_profit: number;
}

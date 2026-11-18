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
  created_at: string;
}

export interface VasKitBom {
  id: string;
  kit_no: string;
  finished_item_id: string;
  description: string | null;
  is_active: boolean;
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
  qty_produced: number;
  status: VasBatchStatus;
  remarks: string | null;
  memo_item_id: string;
  target_qty: number;
  kit_bom_id: string;
  kit_no: string;
  kit_description: string | null;
  finished_item_id: string;
  memo_id: string;
  memo_no: string;
  client_name: string;
  cumulative_qty_to_date: number;
}

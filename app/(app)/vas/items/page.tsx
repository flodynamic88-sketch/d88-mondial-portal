"use client";

import RequireRole from "@/components/RequireRole";
import VasCrudTable, { VasCrudColumn } from "@/components/vas/VasCrudTable";
import { useAuth } from "@/components/AuthProvider";
import type { VasItem } from "@/lib/vas/types";

const ITEM_TYPE_OPTIONS = ["COMPONENT", "CONSUMABLE", "FINISHED_GOOD"];

const columns: VasCrudColumn<VasItem>[] = [
  { key: "item_code", label: "Item Code", required: true },
  { key: "item_description", label: "Item Description", required: true },
  { key: "item_type", label: "Item Type", type: "select", options: ITEM_TYPE_OPTIONS, required: true },
  { key: "uom", label: "UOM" },
  { key: "unit_cost", label: "Unit Cost", type: "number" },
  { key: "is_active", label: "Active", type: "boolean" },
];

const emptyRow: Omit<VasItem, "id"> = {
  item_code: "",
  item_description: "",
  item_type: "COMPONENT",
  uom: null,
  unit_cost: 0,
  is_active: true,
  created_at: "",
};

export default function VasItemsPage() {
  const profile = useAuth();
  const canDelete = profile?.role === "ADMIN" || profile?.role === "VAS_MANAGER";

  return (
    <RequireRole roles={["ADMIN", "VAS_MANAGER", "VAS_OFFICER"]}>
      <div className="space-y-2">
        <p className="text-sm text-gray-500">
          Master list of everything VAS stocks: the raw products being bundled (Component), consumables
          used during kitting (Consumable, e.g. tape), and the resulting bundles themselves (Finished
          Good). Set Unit Cost on Components/Consumables so the Production page can compute material
          and consumable cost per batch.
        </p>
        <VasCrudTable
          tableName="items"
          title="VAS Item Master"
          columns={columns}
          defaultOrder="item_code"
          emptyRow={emptyRow}
          searchPlaceholder="Search item code or description…"
          canDelete={canDelete}
        />
      </div>
    </RequireRole>
  );
}

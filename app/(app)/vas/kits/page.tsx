"use client";

import { useEffect, useMemo, useState } from "react";
import RequireRole from "@/components/RequireRole";
import VasCrudTable, { VasCrudColumn } from "@/components/vas/VasCrudTable";
import { useAuth } from "@/components/AuthProvider";
import { createClient } from "@/lib/vas/supabase/client";
import type { VasItem, VasKitBom, VasKitBomComponent } from "@/lib/vas/types";

const emptyKit: Omit<VasKitBom, "id"> = {
  kit_no: "",
  finished_item_id: "",
  description: null,
  is_active: true,
  created_by: null,
  created_at: "",
};

function BomEditor({
  kit,
  items,
  canDelete,
  onClose,
}: {
  kit: VasKitBom;
  items: VasItem[];
  canDelete: boolean;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<VasKitBomComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newComponentId, setNewComponentId] = useState("");
  const [newQty, setNewQty] = useState("");

  const componentOptions = items.filter((i) => i.item_type === "COMPONENT");
  const itemLabel = (id: string) => {
    const it = items.find((i) => i.id === id);
    return it ? `${it.item_code} — ${it.item_description}` : id;
  };

  async function load() {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .schema("vas")
      .from("kit_bom_components")
      .select("*")
      .eq("kit_bom_id", kit.id)
      .order("created_at", { ascending: true });
    if (error) setError(error.message);
    setLines((data as VasKitBomComponent[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit.id]);

  async function addLine() {
    if (!newComponentId || !newQty) return;
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.schema("vas").from("kit_bom_components").insert({
      kit_bom_id: kit.id,
      component_item_id: newComponentId,
      qty_per_kit: Number(newQty),
    });
    if (error) {
      setError(error.message);
      return;
    }
    setNewComponentId("");
    setNewQty("");
    load();
  }

  async function updateQty(lineId: string, qty: string) {
    const supabase = createClient();
    const { error } = await supabase
      .schema("vas")
      .from("kit_bom_components")
      .update({ qty_per_kit: Number(qty) })
      .eq("id", lineId);
    if (error) setError(error.message);
    load();
  }

  async function removeLine(lineId: string) {
    if (!canDelete) return;
    if (!confirm("Remove this component from the BOM?")) return;
    const supabase = createClient();
    const { error } = await supabase.schema("vas").from("kit_bom_components").delete().eq("id", lineId);
    if (error) setError(error.message);
    load();
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">
          BOM for Kit {kit.kit_no} — {itemLabel(kit.finished_item_id)}
        </h2>
        <button className="btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Only the main/basic product(s) being bundled go here — consumables like tape are tracked
        separately via the Stock Ledger's day-based usage log, not multiplied into this BOM.
      </p>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <table className="table-base">
          <thead>
            <tr>
              <th>Component Item</th>
              <th>Qty per Kit</th>
              {canDelete && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <td>{itemLabel(line.component_item_id)}</td>
                <td className="w-28">
                  <input
                    className="input"
                    type="number"
                    defaultValue={line.qty_per_kit}
                    onBlur={(e) => {
                      if (Number(e.target.value) !== line.qty_per_kit) updateQty(line.id, e.target.value);
                    }}
                  />
                </td>
                {canDelete && (
                  <td>
                    <button
                      className="text-red-600 hover:underline text-xs font-medium"
                      onClick={() => removeLine(line.id)}
                    >
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={3} className="text-sm text-gray-400">
                  No components added yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
        <div>
          <label className="label">Add Component</label>
          <select className="input w-64" value={newComponentId} onChange={(e) => setNewComponentId(e.target.value)}>
            <option value="">— Select Component —</option>
            {componentOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.item_code} — {opt.item_description}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Qty per Kit</label>
          <input
            className="input w-28"
            type="number"
            value={newQty}
            onChange={(e) => setNewQty(e.target.value)}
          />
        </div>
        <button className="btn-primary" onClick={addLine}>
          + Add
        </button>
      </div>
    </div>
  );
}

export default function VasKitsPage() {
  const profile = useAuth();
  const canDelete = profile?.role === "ADMIN" || profile?.role === "VAS_MANAGER";
  const [items, setItems] = useState<VasItem[]>([]);
  const [selectedKit, setSelectedKit] = useState<VasKitBom | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .schema("vas")
      .from("items")
      .select("*")
      .order("item_code")
      .then(({ data }) => setItems((data as VasItem[]) || []));
  }, [refreshKey]);

  const finishedGoodOptions = useMemo(
    () =>
      items
        .filter((i) => i.item_type === "FINISHED_GOOD")
        .map((i) => ({ value: i.id, label: `${i.item_code} — ${i.item_description}` })),
    [items]
  );

  const columns: VasCrudColumn<VasKitBom>[] = [
    { key: "kit_no", label: "Kit No.", required: true },
    { key: "finished_item_id", label: "Finished Bundle", type: "fk", fkOptions: finishedGoodOptions, required: true },
    { key: "description", label: "Description" },
    { key: "is_active", label: "Active", type: "boolean" },
  ];

  return (
    <RequireRole roles={["ADMIN", "VAS_MANAGER", "VAS_OFFICER"]}>
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          One row per Kit No. (exactly as written on Sales&apos; memo). Set up the finished bundle item
          first in Item Master (as a Finished Good), then define its BOM — which Component item(s) and
          how many of each go into one unit.
        </p>
        <VasCrudTable
          tableName="kit_boms"
          title="VAS Kit / BOM"
          columns={columns}
          defaultOrder="kit_no"
          emptyRow={emptyKit}
          searchPlaceholder="Search kit no. or description…"
          canDelete={canDelete}
          refreshKey={refreshKey}
          onAfterSave={() => setRefreshKey((k) => k + 1)}
          renderExtraAction={(row) => (
            <button
              className="text-brand-dark hover:underline text-xs font-medium"
              onClick={() => setSelectedKit(row)}
            >
              BOM
            </button>
          )}
        />
        {selectedKit && (
          <BomEditor kit={selectedKit} items={items} canDelete={canDelete} onClose={() => setSelectedKit(null)} />
        )}
      </div>
    </RequireRole>
  );
}

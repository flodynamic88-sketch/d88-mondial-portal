"use client";

import { useEffect, useMemo, useState } from "react";
import RequireRole from "@/components/RequireRole";
import VasCrudTable, { VasCrudColumn } from "@/components/vas/VasCrudTable";
import { useAuth } from "@/components/AuthProvider";
import { createClient } from "@/lib/vas/supabase/client";
import type { VasKitBom, VasMemo, VasMemoItem } from "@/lib/vas/types";

const MEMO_STATUS_OPTIONS = ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

const emptyMemo: Omit<VasMemo, "id"> = {
  memo_no: "",
  memo_date: "",
  client_name: "",
  requested_by: null,
  status: "OPEN",
  created_by: null,
  created_at: "",
};

function MemoItemsEditor({
  memo,
  kits,
  canDelete,
  onClose,
}: {
  memo: VasMemo;
  kits: VasKitBom[];
  canDelete: boolean;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<VasMemoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newKitId, setNewKitId] = useState("");
  const [newQty, setNewQty] = useState("");

  const kitLabel = (id: string) => {
    const k = kits.find((k) => k.id === id);
    return k ? `${k.kit_no}${k.description ? " — " + k.description : ""}` : id;
  };

  async function load() {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .schema("vas")
      .from("memo_items")
      .select("*")
      .eq("memo_id", memo.id)
      .order("created_at", { ascending: true });
    if (error) setError(error.message);
    setLines((data as VasMemoItem[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memo.id]);

  async function addLine() {
    if (!newKitId || !newQty) return;
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.schema("vas").from("memo_items").insert({
      memo_id: memo.id,
      kit_bom_id: newKitId,
      qty_requested: Number(newQty),
    });
    if (error) {
      setError(error.message);
      return;
    }
    setNewKitId("");
    setNewQty("");
    load();
  }

  async function updateQty(lineId: string, qty: string) {
    const supabase = createClient();
    const { error } = await supabase
      .schema("vas")
      .from("memo_items")
      .update({ qty_requested: Number(qty) })
      .eq("id", lineId);
    if (error) setError(error.message);
    load();
  }

  async function removeLine(lineId: string) {
    if (!canDelete) return;
    if (!confirm("Remove this kit line from the memo?")) return;
    const supabase = createClient();
    const { error } = await supabase.schema("vas").from("memo_items").delete().eq("id", lineId);
    if (error) setError(error.message);
    load();
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">
          Kit Lines for Memo {memo.memo_no} — {memo.client_name}
        </h2>
        <button className="btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>

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
              <th>Kit No.</th>
              <th>Qty Requested</th>
              {canDelete && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <td>{kitLabel(line.kit_bom_id)}</td>
                <td className="w-28">
                  <input
                    className="input"
                    type="number"
                    defaultValue={line.qty_requested}
                    onBlur={(e) => {
                      if (Number(e.target.value) !== line.qty_requested) updateQty(line.id, e.target.value);
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
                  No kit lines added yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
        <div>
          <label className="label">Add Kit</label>
          <select className="input w-64" value={newKitId} onChange={(e) => setNewKitId(e.target.value)}>
            <option value="">— Select Kit No. —</option>
            {kits.map((k) => (
              <option key={k.id} value={k.id}>
                {k.kit_no}
                {k.description ? ` — ${k.description}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Qty Requested</label>
          <input className="input w-28" type="number" value={newQty} onChange={(e) => setNewQty(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={addLine}>
          + Add
        </button>
      </div>
    </div>
  );
}

export default function VasMemosPage() {
  const profile = useAuth();
  const canDelete = profile?.role === "ADMIN" || profile?.role === "VAS_MANAGER";
  const [kits, setKits] = useState<VasKitBom[]>([]);
  const [selectedMemo, setSelectedMemo] = useState<VasMemo | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .schema("vas")
      .from("kit_boms")
      .select("*")
      .eq("is_active", true)
      .order("kit_no")
      .then(({ data }) => setKits((data as VasKitBom[]) || []));
  }, [refreshKey]);

  const columns: VasCrudColumn<VasMemo>[] = useMemo(
    () => [
      { key: "memo_no", label: "Memo No.", required: true },
      { key: "memo_date", label: "Memo Date", type: "date", required: true },
      { key: "client_name", label: "Client", required: true },
      { key: "requested_by", label: "Requested By" },
      { key: "status", label: "Status", type: "select", options: MEMO_STATUS_OPTIONS },
    ],
    []
  );

  return (
    <RequireRole roles={["ADMIN", "VAS_MANAGER", "VAS_OFFICER"]}>
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Encode the memo exactly as written on the physical paper from Mondial Sales — Memo No. is
          free text, not auto-generated. Then add each Kit No. + Qty requested as a line under it.
        </p>
        <VasCrudTable
          tableName="memos"
          title="VAS Memos"
          columns={columns}
          defaultOrder="memo_date"
          ascending={false}
          emptyRow={emptyMemo}
          searchPlaceholder="Search memo no. or client…"
          canDelete={canDelete}
          refreshKey={refreshKey}
          onAfterSave={() => setRefreshKey((k) => k + 1)}
          renderExtraAction={(row) => (
            <button
              className="text-brand-dark hover:underline text-xs font-medium"
              onClick={() => setSelectedMemo(row)}
            >
              Kit Lines
            </button>
          )}
        />
        {selectedMemo && (
          <MemoItemsEditor memo={selectedMemo} kits={kits} canDelete={canDelete} onClose={() => setSelectedMemo(null)} />
        )}
      </div>
    </RequireRole>
  );
}

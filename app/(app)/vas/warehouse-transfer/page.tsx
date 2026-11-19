"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import RequireRole from "@/components/RequireRole";
import { useAuth } from "@/components/AuthProvider";
import { createClient } from "@/lib/vas/supabase/client";
import type { VasItem, VasProductionProgress, VasWarehouseTransfer } from "@/lib/vas/types";

export default function VasWarehouseTransferPage() {
  const profile = useAuth();
  const canAdd = profile?.role === "ADMIN" || profile?.role === "VAS_MANAGER" || profile?.role === "VAS_OFFICER";
  // Deleting a transfer now also reverses its automatic TRANSFERRED_OUT
  // stock movement (vas.cleanup_transfer_stock_movements delete trigger,
  // see migration 0094), so this can follow the same ADMIN/VAS_MANAGER-only
  // delete rule used everywhere else in VAS.
  const canDelete = profile?.role === "ADMIN" || profile?.role === "VAS_MANAGER";

  const [items, setItems] = useState<VasItem[]>([]);
  const [progress, setProgress] = useState<VasProductionProgress[]>([]);
  const [transfers, setTransfers] = useState<VasWarehouseTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [batchId, setBatchId] = useState("");
  const [qty, setQty] = useState("");
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endorsedBy, setEndorsedBy] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [remarks, setRemarks] = useState("");

  async function load() {
    setLoading(true);
    const supabase = createClient();
    const [itemsRes, progressRes, transfersRes] = await Promise.all([
      supabase.schema("vas").from("items").select("*"),
      supabase.schema("vas").from("v_production_progress").select("*").order("batch_date", { ascending: false }),
      supabase
        .schema("vas")
        .from("warehouse_transfers")
        .select("*")
        .order("transfer_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    setItems((itemsRes.data as VasItem[]) || []);
    setProgress((progressRes.data as VasProductionProgress[]) || []);
    setTransfers((transfersRes.data as VasWarehouseTransfer[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const itemLabel = (id: string) => {
    const it = items.find((i) => i.id === id);
    return it ? `${it.item_code} — ${it.item_description}` : id;
  };

  // How much has already been transferred against each batch, so a batch can
  // be transferred to the Warehouse in partial, day-by-day amounts without
  // ever double-sending the same finished qty.
  const transferredByBatch = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of transfers) {
      map.set(t.batch_id, (map.get(t.batch_id) || 0) + Number(t.qty_transferred));
    }
    return map;
  }, [transfers]);

  const batchRows = useMemo(
    () =>
      progress.map((p) => {
        const transferred = transferredByBatch.get(p.batch_id) || 0;
        const balance = Math.max(p.qty_produced - transferred, 0);
        return { ...p, transferred, balance };
      }),
    [progress, transferredByBatch]
  );

  const selectedBatch = batchRows.find((b) => b.batch_id === batchId) || null;

  async function handleAddTransfer() {
    setError(null);
    if (!batchId || !qty || !transferDate) {
      setError("Please fill in Batch, Qty, and Date.");
      return;
    }
    const qtyNum = Number(qty);
    if (qtyNum <= 0) {
      setError("Qty Transferred must be greater than zero.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.schema("vas").from("warehouse_transfers").insert({
      batch_id: batchId,
      transfer_date: transferDate,
      qty_transferred: qtyNum,
      endorsed_by: endorsedBy || null,
      received_by: receivedBy || null,
      remarks: remarks || null,
    });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setBatchId("");
    setQty("");
    setEndorsedBy("");
    setReceivedBy("");
    setRemarks("");
    load();
  }

  async function handleDeleteTransfer(id: string) {
    if (!canDelete) return;
    if (!confirm("Delete this transfer? This cannot be undone.")) return;
    const supabase = createClient();
    const { error } = await supabase.schema("vas").from("warehouse_transfers").delete().eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  return (
    <RequireRole roles={["ADMIN", "VAS_MANAGER", "VAS_OFFICER"]}>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">VAS Warehouse Transfer</h1>
          <p className="text-sm text-gray-500">
            Endorse finished bundles from VAS&apos;s own stock to the Warehouse. A transfer can cover the
            full produced qty of a batch or just part of it (e.g. per day) — repeat as needed until the
            balance reaches zero. Each transfer prints a receiving slip for the Warehouse to sign.
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <div className="card overflow-x-auto">
          <div className="border-b border-gray-100 p-4">
            <h2 className="text-sm font-semibold text-gray-700">Batches Available for Transfer</h2>
          </div>
          {loading ? (
            <div className="p-6 text-sm text-gray-400">Loading…</div>
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>Batch No.</th>
                  <th>Batch Date</th>
                  <th>TSP No.</th>
                  <th>Kit No.</th>
                  <th>Qty Produced</th>
                  <th>Already Transferred</th>
                  <th>Balance to Transfer</th>
                </tr>
              </thead>
              <tbody>
                {batchRows.map((b) => (
                  <tr key={b.batch_id}>
                    <td>{b.batch_no}</td>
                    <td>{b.batch_date}</td>
                    <td>{b.memo_no}</td>
                    <td>{b.kit_no}</td>
                    <td>{b.qty_produced}</td>
                    <td>{b.transferred}</td>
                    <td className={b.balance > 0 ? "text-green-700 font-medium" : "text-gray-400"}>
                      {b.balance}
                    </td>
                  </tr>
                ))}
                {batchRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-sm text-gray-400">
                      No production batches logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {canAdd && (
          <div className="card p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">Add Warehouse Transfer</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2 lg:col-span-2">
                <label className="label">Batch</label>
                <select className="input" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                  <option value="">— Select Batch —</option>
                  {batchRows.map((b) => (
                    <option key={b.batch_id} value={b.batch_id}>
                      {b.memo_no} · Batch {b.batch_no} · Kit {b.kit_no} (balance {b.balance})
                    </option>
                  ))}
                </select>
                {selectedBatch && (
                  <p className="mt-1 text-xs text-gray-400">
                    {itemLabel(selectedBatch.finished_item_id)} — produced {selectedBatch.qty_produced}, already
                    transferred {selectedBatch.transferred}
                  </p>
                )}
              </div>
              <div>
                <label className="label">Qty Transferred</label>
                <input className="input" type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div>
                <label className="label">Transfer Date</label>
                <input
                  className="input"
                  type="date"
                  value={transferDate}
                  onChange={(e) => setTransferDate(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Endorsed By (VAS)</label>
                <input className="input" value={endorsedBy} onChange={(e) => setEndorsedBy(e.target.value)} />
              </div>
              <div>
                <label className="label">Received By (Warehouse)</label>
                <input className="input" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />
              </div>
              <div className="sm:col-span-2 lg:col-span-2">
                <label className="label">Remarks</label>
                <input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </div>
            </div>
            <button className="btn-primary" onClick={handleAddTransfer} disabled={saving}>
              {saving ? "Saving…" : "+ Add Transfer"}
            </button>
          </div>
        )}

        <div className="card overflow-x-auto">
          <div className="border-b border-gray-100 p-4">
            <h2 className="text-sm font-semibold text-gray-700">Transfer History (latest 200)</h2>
          </div>
          <table className="table-base">
            <thead>
              <tr>
                <th>Date</th>
                <th>TSP No.</th>
                <th>Batch</th>
                <th>Qty Transferred</th>
                <th>Endorsed By</th>
                <th>Received By</th>
                <th>Remarks</th>
                <th>Slip</th>
                {canDelete && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => {
                const batch = progress.find((p) => p.batch_id === t.batch_id);
                return (
                  <tr key={t.id}>
                    <td>{t.transfer_date}</td>
                    <td>{batch?.memo_no ?? ""}</td>
                    <td>{batch ? `${batch.batch_no} · Kit ${batch.kit_no}` : t.batch_id}</td>
                    <td>{t.qty_transferred}</td>
                    <td>{t.endorsed_by ?? ""}</td>
                    <td>{t.received_by ?? ""}</td>
                    <td>{t.remarks ?? ""}</td>
                    <td>
                      <Link
                        href={`/vas/warehouse-transfer/print?id=${t.id}`}
                        className="text-brand-dark hover:underline text-xs font-medium"
                      >
                        Print
                      </Link>
                    </td>
                    {canDelete && (
                      <td>
                        <button
                          className="text-red-600 hover:underline text-xs font-medium"
                          onClick={() => handleDeleteTransfer(t.id)}
                        >
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {transfers.length === 0 && (
                <tr>
                  <td colSpan={canDelete ? 9 : 8} className="text-sm text-gray-400">
                    No transfers yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </RequireRole>
  );
}

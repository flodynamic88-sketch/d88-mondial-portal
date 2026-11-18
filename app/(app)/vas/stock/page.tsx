"use client";

import { useEffect, useMemo, useState } from "react";
import RequireRole from "@/components/RequireRole";
import { useAuth } from "@/components/AuthProvider";
import { createClient } from "@/lib/vas/supabase/client";
import type { VasItem, VasStockBalance, VasStockMovement } from "@/lib/vas/types";

// Manual stock-in and day-based consumable usage logging. CONSUMED/PRODUCED/
// TRANSFERRED_OUT movement types are posted automatically by database
// triggers (production batches, warehouse transfers) -- only STOCK_IN,
// CONSUMABLE_USED, and CORRECTION are ever entered here by hand.
const MANUAL_MOVEMENT_TYPES = ["STOCK_IN", "CONSUMABLE_USED", "CORRECTION"] as const;

export default function VasStockPage() {
  const profile = useAuth();
  const canDelete = profile?.role === "ADMIN" || profile?.role === "VAS_MANAGER";

  const [items, setItems] = useState<VasItem[]>([]);
  const [balances, setBalances] = useState<VasStockBalance[]>([]);
  const [movements, setMovements] = useState<VasStockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [itemId, setItemId] = useState("");
  const [movementType, setMovementType] = useState<(typeof MANUAL_MOVEMENT_TYPES)[number]>("STOCK_IN");
  const [qty, setQty] = useState("");
  const [movementDate, setMovementDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState("");

  async function load() {
    setLoading(true);
    const supabase = createClient();
    const [itemsRes, balanceRes, movementsRes] = await Promise.all([
      supabase.schema("vas").from("items").select("*").order("item_code"),
      supabase.schema("vas").from("v_stock_balance").select("*").order("item_code"),
      supabase
        .schema("vas")
        .from("stock_movements")
        .select("*")
        .order("movement_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    setItems((itemsRes.data as VasItem[]) || []);
    setBalances((balanceRes.data as VasStockBalance[]) || []);
    setMovements((movementsRes.data as VasStockMovement[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const itemLabel = (id: string) => {
    const it = items.find((i) => i.id === id);
    return it ? `${it.item_code} — ${it.item_description}` : id;
  };

  async function handleAddMovement() {
    setError(null);
    if (!itemId || !qty || !movementDate) {
      setError("Please fill in Item, Qty, and Date.");
      return;
    }
    const absQty = Math.abs(Number(qty));
    let signedQty = absQty;
    if (movementType === "CONSUMABLE_USED") signedQty = -absQty;
    if (movementType === "CORRECTION") signedQty = Number(qty); // can be + or -

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.schema("vas").from("stock_movements").insert({
      item_id: itemId,
      movement_type: movementType,
      qty: signedQty,
      reference_type: "MANUAL",
      movement_date: movementDate,
      remarks: remarks || null,
    });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setItemId("");
    setQty("");
    setRemarks("");
    load();
  }

  async function handleDeleteMovement(id: string) {
    if (!canDelete) return;
    if (!confirm("Delete this stock movement entry? This cannot be undone.")) return;
    const supabase = createClient();
    const { error } = await supabase.schema("vas").from("stock_movements").delete().eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  const nonFinishedItems = useMemo(() => items.filter((i) => i.item_type !== "FINISHED_GOOD"), [items]);

  return (
    <RequireRole roles={["ADMIN", "VAS_MANAGER", "VAS_OFFICER"]}>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">VAS Stock Ledger</h1>
          <p className="text-sm text-gray-500">
            Balances are always derived live from every movement below — there is no cached running
            total to drift out of sync. Component/consumable stock-in and day-based consumable usage
            are entered manually here; finished-bundle stock moves automatically from Production and
            Warehouse Transfer.
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <div className="card overflow-x-auto">
          <div className="border-b border-gray-100 p-4">
            <h2 className="text-sm font-semibold text-gray-700">Current Stock Balance</h2>
          </div>
          {loading ? (
            <div className="p-6 text-sm text-gray-400">Loading…</div>
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>Item Code</th>
                  <th>Description</th>
                  <th>Type</th>
                  <th>UOM</th>
                  <th>Balance Qty</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((b) => (
                  <tr key={b.item_id}>
                    <td>{b.item_code}</td>
                    <td>{b.item_description}</td>
                    <td>{b.item_type}</td>
                    <td>{b.uom ?? ""}</td>
                    <td className={b.balance_qty < 0 ? "text-red-600 font-medium" : ""}>{b.balance_qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Add Stock Movement</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label">Item</label>
              <select className="input" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                <option value="">— Select Item —</option>
                {nonFinishedItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.item_code} — {i.item_description}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Movement Type</label>
              <select
                className="input"
                value={movementType}
                onChange={(e) => setMovementType(e.target.value as (typeof MANUAL_MOVEMENT_TYPES)[number])}
              >
                <option value="STOCK_IN">Stock In (receiving)</option>
                <option value="CONSUMABLE_USED">Consumable Used (day-based)</option>
                <option value="CORRECTION">Correction</option>
              </select>
            </div>
            <div>
              <label className="label">Qty</label>
              <input className="input" type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div>
              <label className="label">Date</label>
              <input
                className="input"
                type="date"
                value={movementDate}
                onChange={(e) => setMovementDate(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <label className="label">Remarks</label>
              <input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
          </div>
          <button className="btn-primary" onClick={handleAddMovement} disabled={saving}>
            {saving ? "Saving…" : "+ Add Movement"}
          </button>
        </div>

        <div className="card overflow-x-auto">
          <div className="border-b border-gray-100 p-4">
            <h2 className="text-sm font-semibold text-gray-700">Recent Movements (latest 200)</h2>
          </div>
          <table className="table-base">
            <thead>
              <tr>
                <th>Date</th>
                <th>Item</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Reference</th>
                <th>Remarks</th>
                {canDelete && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td>{m.movement_date}</td>
                  <td>{itemLabel(m.item_id)}</td>
                  <td>{m.movement_type}</td>
                  <td className={m.qty < 0 ? "text-red-600" : "text-green-700"}>{m.qty}</td>
                  <td>{m.reference_type}</td>
                  <td>{m.remarks ?? ""}</td>
                  {canDelete && (
                    <td>
                      {m.reference_type === "MANUAL" && (
                        <button
                          className="text-red-600 hover:underline text-xs font-medium"
                          onClick={() => handleDeleteMovement(m.id)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {movements.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-sm text-gray-400">
                    No movements yet.
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

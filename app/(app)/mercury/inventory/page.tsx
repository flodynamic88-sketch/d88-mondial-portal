"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, InventoryStatusRow } from "@/lib/mercury/types";

const STOCK_TABS = [
  { value: "", label: "All" },
  { value: "low", label: "Low / Negative Stock" },
];

function peso(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(n || 0);
}

export default function InventoryPage() {
  const [rows, setRows] = useState<InventoryStatusRow[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [clientId, setClientId] = useState("");
  const [stockFilter, setStockFilter] = useState("");
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    let query = supabase
      .schema("flo").from("v_inventory_status")
      .select("*")
      .order("item_code");
    if (clientId) query = query.eq("client_id", clientId);
    if (stockFilter === "low") query = query.eq("is_low_stock", true);

    const { data, error } = await query;
    if (error) setError(error.message);
    setRows((data as InventoryStatusRow[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    const supabase = createClient();
    supabase
      .schema("flo").from("clients")
      .select("*")
      .eq("manages_inventory", true)
      .order("client_code")
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setClients((data as Client[]) || []);
      });
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, stockFilter]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.item_code.toLowerCase().includes(q) ||
        r.item_description.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const lowStockCount = useMemo(() => rows.filter((r) => r.is_low_stock).length, [rows]);
  const totalValue = useMemo(
    () => filtered.reduce((sum, r) => sum + (r.stock_value || 0), 0),
    [filtered]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500">
            {filtered.length} item(s) &middot; {lowStockCount} low / negative stock &middot; Total
            Value: {peso(totalValue)}
          </p>
        </div>
        <Link href="/mercury/inventory/receiving" className="btn-primary">
          Stock Receiving
        </Link>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {STOCK_TABS.map((tab) => {
          const active = stockFilter === tab.value;
          return (
            <button
              key={tab.value || "all"}
              type="button"
              onClick={() => setStockFilter(tab.value)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-gray-900 border-gray-900 text-white shadow-sm"
                  : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="card p-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label">Client</label>
          <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">All</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.client_code} — {c.client_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Search</label>
          <input
            className="input"
            placeholder="Item code or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">
            No inventory items found. Turn on &quot;Manages Inventory&quot; for a client on the
            Clients page to start tracking their warehouse stock.
          </div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Item Code</th>
                <th>Description</th>
                <th>Client</th>
                <th>Category</th>
                <th>Unit</th>
                <th>Current Stock</th>
                <th>Unit Price</th>
                <th>Value</th>
                <th>Reorder Point</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.item_id} className="hover:bg-gray-50">
                  <td>{r.item_code}</td>
                  <td>{r.item_description}</td>
                  <td>{r.client_name}</td>
                  <td>{r.category || "—"}</td>
                  <td>{r.unit || "—"}</td>
                  <td className={r.current_stock < 0 ? "font-semibold text-red-600" : ""}>
                    {r.current_stock}
                  </td>
                  <td>{peso(r.unit_price)}</td>
                  <td>{peso(r.stock_value)}</td>
                  <td>{r.reorder_pt ?? "—"}</td>
                  <td>
                    {r.is_low_stock ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        {r.current_stock < 0 ? "Negative Stock" : "Low Stock"}
                      </span>
                    ) : (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        OK
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

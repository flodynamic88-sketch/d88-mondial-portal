"use client";

/**
 * Per-Client Stock Monitoring — tabbed by client.
 *
 * Pick a client tab, then see that client's on-shelf/on-hand inventory as
 * observed by Sales Coordinators during Store Visits, across every Mercury
 * (or other) branch visited, over time. Backed by v_store_visit_lines_full
 * (flattened line + header + branch info) filtered to client_id.
 *
 * Two views for the selected client:
 *  - Latest Qty per Branch/Item (snapshot) — the most recent visit's count
 *    for each Branch + Item combination, for a quick "what's on shelf now"
 *    read.
 *  - Full History — every counted line, most recent first, so movement
 *    over time per branch/item is visible.
 */

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, StoreVisitLineFull } from "@/lib/mercury/types";

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
}

export default function StoreVisitMonitoringPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [rows, setRows] = useState<StoreVisitLineFull[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [branchFilter, setBranchFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const [view, setView] = useState<"latest" | "history">("latest");

  useEffect(() => {
    const supabase = createClient();
    supabase
      .schema("flo").from("clients")
      .select("*")
      .order("client_code")
      .then(({ data }) => {
        const list = (data as Client[]) || [];
        setClients(list);
        if (list.length && !clientId) setClientId(list[0].id);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    supabase
      .schema("flo").from("v_store_visit_lines_full")
      .select("*")
      .eq("client_id", clientId)
      .order("visit_date", { ascending: false })
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setRows((data as StoreVisitLineFull[]) || []);
        setLoading(false);
      });
  }, [clientId]);

  const branchOptions = useMemo(() => {
    const seen = new Map<string, string>();
    rows.forEach((r) => {
      const key = r.branch_id || r.branch_name || "";
      if (key && !seen.has(key)) seen.set(key, r.branch_name || r.branch_code || key);
    });
    return Array.from(seen.entries());
  }, [rows]);

  const itemOptions = useMemo(() => {
    const seen = new Map<string, string>();
    rows.forEach((r) => {
      const key = r.item_id || r.item_code || "";
      if (key && !seen.has(key))
        seen.set(key, `${r.item_code || ""} — ${r.item_description || ""}`.trim());
    });
    return Array.from(seen.entries());
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (branchFilter && (r.branch_id || r.branch_name) !== branchFilter) {
        if (r.branch_id !== branchFilter && r.branch_name !== branchFilter) return false;
      }
      if (itemFilter && r.item_id !== itemFilter && r.item_code !== itemFilter) return false;
      return true;
    });
  }, [rows, branchFilter, itemFilter]);

  // Latest snapshot: most recent line per Branch + Item combination
  // (rows already sorted most-recent-first, so first occurrence wins).
  const latestSnapshot = useMemo(() => {
    const map = new Map<string, StoreVisitLineFull>();
    filtered.forEach((r) => {
      const key = `${r.branch_id || r.branch_name || ""}::${r.item_id || r.item_code || ""}`;
      if (!map.has(key)) map.set(key, r);
    });
    return Array.from(map.values()).sort((a, b) => {
      const bn = (a.branch_name || "").localeCompare(b.branch_name || "");
      if (bn !== 0) return bn;
      return (a.item_description || "").localeCompare(b.item_description || "");
    });
  }, [filtered]);

  const selectedClient = clients.find((c) => c.id === clientId);
  const totalQtyLatest = latestSnapshot.reduce((s, r) => s + (r.qty || 0), 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Stock Monitoring (Per Client)</h1>
        <p className="text-sm text-gray-500">
          On-shelf / on-hand inventory as observed by Sales Coordinators during Store Visits, per
          client, across every branch visited.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2 overflow-x-auto pb-1">
        {clients.map((c) => {
          const active = c.id === clientId;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setClientId(c.id);
                setBranchFilter("");
                setItemFilter("");
              }}
              className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-gray-900 border-gray-900 text-white shadow-sm"
                  : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {c.client_code} — {c.client_name}
            </button>
          );
        })}
      </div>

      {selectedClient && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-gray-500">
              {latestSnapshot.length} branch/item combination(s) &middot; {totalQtyLatest} total qty
              (latest count)
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setView("latest")}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                  view === "latest"
                    ? "bg-gray-900 border-gray-900 text-white"
                    : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
                }`}
              >
                Latest Snapshot
              </button>
              <button
                type="button"
                onClick={() => setView("history")}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                  view === "history"
                    ? "bg-gray-900 border-gray-900 text-white"
                    : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
                }`}
              >
                Full History
              </button>
            </div>
          </div>

          <div className="card p-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Branch</label>
              <select
                className="input"
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
              >
                <option value="">All Branches</option>
                {branchOptions.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Item</label>
              <select
                className="input"
                value={itemFilter}
                onChange={(e) => setItemFilter(e.target.value)}
              >
                <option value="">All Items</option>
                {itemOptions.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="card overflow-x-auto">
            {loading ? (
              <div className="p-6 text-sm text-gray-400">Loading…</div>
            ) : view === "latest" ? (
              latestSnapshot.length === 0 ? (
                <div className="p-6 text-sm text-gray-400">
                  No store visit records yet for this client.
                </div>
              ) : (
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Branch</th>
                      <th>Item Code</th>
                      <th>Item Description</th>
                      <th className="text-right">Qty</th>
                      <th>Last Counted</th>
                      <th>Sales Coordinator</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestSnapshot.map((r) => (
                      <tr key={r.id}>
                        <td>{r.branch_name || "—"}</td>
                        <td>{r.item_code || "—"}</td>
                        <td>{r.item_description || "—"}</td>
                        <td className="text-right">{r.qty}</td>
                        <td>{formatDate(r.visit_date)}</td>
                        <td>{r.sales_coordinator_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : filtered.length === 0 ? (
              <div className="p-6 text-sm text-gray-400">
                No store visit records yet for this client.
              </div>
            ) : (
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Visit Date</th>
                    <th>Branch</th>
                    <th>Item Code</th>
                    <th>Item Description</th>
                    <th className="text-right">Qty</th>
                    <th>Sales Coordinator</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id}>
                      <td>{formatDate(r.visit_date)}</td>
                      <td>{r.branch_name || "—"}</td>
                      <td>{r.item_code || "—"}</td>
                      <td>{r.item_description || "—"}</td>
                      <td className="text-right">{r.qty}</td>
                      <td>{r.sales_coordinator_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {clients.length === 0 && (
        <div className="p-6 text-sm text-gray-400">No clients found.</div>
      )}
    </div>
  );
}

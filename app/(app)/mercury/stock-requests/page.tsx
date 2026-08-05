"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, StockRequestFull } from "@/lib/mercury/types";
import { useRole } from "@/lib/mercury/RoleContext";

function statusBadgeClass(status: string) {
  switch (status) {
    case "Open":
      return "bg-blue-100 text-blue-700";
    case "Fulfilled":
      return "bg-green-100 text-green-700";
    case "Cancelled":
      return "bg-gray-100 text-gray-500";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "Open", label: "Open" },
  { value: "Fulfilled", label: "Fulfilled" },
  { value: "Cancelled", label: "Cancelled" },
];

export default function StockRequestsPage() {
  const role = useRole();
  const canEncode = role !== "general_manager";

  const [rows, setRows] = useState<StockRequestFull[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState("");
  const [clientId, setClientId] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    let query = supabase
      .schema("flo").from("v_stock_requests_full")
      .select("*")
      .order("request_date", { ascending: false });
    if (status) query = query.eq("status", status);
    if (clientId) query = query.eq("client_id", clientId);

    let countsQuery = supabase.schema("flo").from("v_stock_requests_full").select("status");
    if (clientId) countsQuery = countsQuery.eq("client_id", clientId);

    const [{ data, error }, { data: countRows, error: countErr }] = await Promise.all([
      query,
      countsQuery,
    ]);
    if (error) setError(error.message);
    if (countErr) setError(countErr.message);
    setRows((data as StockRequestFull[]) || []);

    const counts: Record<string, number> = {};
    (countRows || []).forEach((r: { status: string }) => {
      counts[r.status] = (counts[r.status] || 0) + 1;
    });
    counts[""] = (countRows || []).length;
    setStatusCounts(counts);

    setLoading(false);
  }

  useEffect(() => {
    const supabase = createClient();
    supabase
      .schema("flo").from("clients")
      .select("*")
      .order("client_code")
      .then(({ data }) => setClients((data as Client[]) || []));
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, clientId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Stock Requests</h1>
          <p className="text-sm text-gray-500">
            {rows.length} record(s) &middot; Requests we send to a client asking them to prepare
            stock for us to pick up.
          </p>
        </div>
        {canEncode && (
          <Link href="/mercury/stock-requests/new" className="btn-primary">
            + New Stock Request
          </Link>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => {
          const active = status === tab.value;
          return (
            <button
              key={tab.value || "all"}
              type="button"
              onClick={() => setStatus(tab.value)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-gray-900 border-gray-900 text-white shadow-sm"
                  : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {tab.label}
              <span className={`ml-1.5 text-xs ${active ? "text-white/70" : "text-gray-400"}`}>
                {statusCounts[tab.value] ?? 0}
              </span>
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
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">No stock requests found.</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Request #</th>
                <th>Request Date</th>
                <th>Client (Supplier)</th>
                <th>Status</th>
                <th>Lines</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td>{r.request_number}</td>
                  <td>{r.request_date || "—"}</td>
                  <td>{r.client_name || "—"}</td>
                  <td>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(
                        r.status
                      )}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td>{r.line_count ?? 0}</td>
                  <td className="space-x-3 whitespace-nowrap">
                    <Link
                      href={`/mercury/stock-requests/${r.id}`}
                      className="text-brand-dark hover:underline text-xs font-medium"
                    >
                      View
                    </Link>
                    <Link
                      href={`/mercury/stock-requests/${r.id}/print`}
                      className="text-brand-dark hover:underline text-xs font-medium"
                    >
                      Print
                    </Link>
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

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/mercury/supabase/client";
import type { BadOrderHeaderFull, Client } from "@/lib/mercury/types";
import { BAD_ORDER_STATUSES } from "@/lib/mercury/types";

function peso(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(n || 0);
}

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "Stored in Warehouse":
      return "bg-blue-100 text-blue-700";
    case "Returned to Client/Principal":
      return "bg-amber-100 text-amber-700";
    case "Disposed":
      return "bg-gray-200 text-gray-600";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

const STATUS_TABS = [{ value: "", label: "All" }, ...BAD_ORDER_STATUSES.map((s) => ({ value: s, label: s }))];

export default function BadOrdersPage() {
  const [rows, setRows] = useState<BadOrderHeaderFull[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState("");
  const [clientId, setClientId] = useState("");
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    let query = supabase
      .schema("flo").from("v_bad_order_headers_full")
      .select("*")
      .order("date_backload", { ascending: false })
      .order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    if (clientId) query = query.eq("client_id", clientId);

    const countsQuery = supabase.schema("flo").from("bad_order_headers").select("status");

    const [{ data, error }, { data: countRows, error: countErr }] = await Promise.all([
      query,
      countsQuery,
    ]);
    if (error) setError(error.message);
    if (countErr) setError(countErr.message);
    setRows((data as BadOrderHeaderFull[]) || []);

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

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.bo_number.toLowerCase().includes(q) ||
      (r.client_name || "").toLowerCase().includes(q) ||
      (r.branch_name || "").toLowerCase().includes(q)
    );
  });

  const totalAmount = filtered.reduce((s, r) => s + (r.total_amount || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Bad Orders</h1>
          <p className="text-sm text-gray-500">
            {filtered.length} record(s) &middot; {peso(totalAmount)} total &middot; Monitor backload
            items due to bad orders from Mercury (or any client).
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/mercury/reports/bad-order-report" className="btn-secondary">
            Monthly Report
          </Link>
          <Link href="/mercury/bad-orders/new" className="btn-primary">
            + New Bad Order
          </Link>
        </div>
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
        <div className="sm:col-span-1 lg:col-span-2">
          <label className="label">Search</label>
          <input
            className="input"
            placeholder="BO #, client, branch…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">No bad order records found.</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>BO #</th>
                <th>Date Backload</th>
                <th>Client / Branch</th>
                <th className="text-right">Lines</th>
                <th className="text-right">Total Qty</th>
                <th className="text-right">Total Amount</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td>{r.bo_number}</td>
                  <td>{formatDate(r.date_backload)}</td>
                  <td>{r.branch_name || r.client_name || "—"}</td>
                  <td className="text-right">{r.line_count ?? 0}</td>
                  <td className="text-right">{r.total_qty ?? 0}</td>
                  <td className="text-right">{peso(r.total_amount)}</td>
                  <td>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(
                        r.status
                      )}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">
                    <Link
                      href={`/mercury/bad-orders/${r.id}`}
                      className="text-brand-dark hover:underline text-xs font-medium"
                    >
                      View
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

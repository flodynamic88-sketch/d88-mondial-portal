"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, DeliveryHeaderFull } from "@/lib/mercury/types";
import { useRole } from "@/lib/mercury/RoleContext";
import { deliveryStatusBadgeClass, transactionTypeBadgeClass } from "@/lib/mercury/statusColors";

function peso(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(n || 0);
}

// Before a delivery is actually delivered, qty_delivered is still 0, so
// total_net_amount (based on qty delivered/returned) is 0 too — that made
// Pending / In-Transit rows show ₱0.00 in the table even though the order
// has a real amount. Show the ordered amount (total_amount) for those
// statuses, and the actual net (delivered - returned) amount once the
// delivery has been completed / has a final outcome.
function displayAmount(r: DeliveryHeaderFull): number | null | undefined {
  if (r.status === "Pending" || r.status === "In-Transit") {
    return r.total_amount;
  }
  return r.total_net_amount;
}

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "Pending", label: "Pending" },
  { value: "In-Transit", label: "In-Transit" },
  { value: "Delivered", label: "Delivered" },
  { value: "Delivered-Late", label: "Delivered-Late" },
  { value: "Cancelled", label: "Cancelled" },
  { value: "Returned", label: "Returned" },
];

export default function DeliveriesPage() {
  const role = useRole();
  const canEncode = role !== "general_manager";
  const [rows, setRows] = useState<DeliveryHeaderFull[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState("");
  const [clientId, setClientId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [transactionType, setTransactionType] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    let query = supabase
      .schema("flo").from("v_delivery_headers_full")
      .select("*")
      .order("invoice_date", { ascending: false });

    if (status) query = query.eq("status", status);
    if (clientId) query = query.eq("client_id", clientId);
    if (dateFrom) query = query.gte("invoice_date", dateFrom);
    if (dateTo) query = query.lte("invoice_date", dateTo);
    if (transactionType) query = query.eq("transaction_type", transactionType);

    // Counts per status use the same filters EXCEPT status, so the tabs
    // always reflect how many records fall under each bucket for the
    // currently selected Client/Date/Type filters.
    let countsQuery = supabase.schema("flo").from("v_delivery_headers_full").select("status");
    if (clientId) countsQuery = countsQuery.eq("client_id", clientId);
    if (dateFrom) countsQuery = countsQuery.gte("invoice_date", dateFrom);
    if (dateTo) countsQuery = countsQuery.lte("invoice_date", dateTo);
    if (transactionType) countsQuery = countsQuery.eq("transaction_type", transactionType);

    const [{ data, error }, { data: countRows, error: countErr }] = await Promise.all([
      query,
      countsQuery,
    ]);
    if (error) setError(error.message);
    if (countErr) setError(countErr.message);
    setRows((data as DeliveryHeaderFull[]) || []);

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
  }, [status, clientId, dateFrom, dateTo, transactionType]);

  const totalNet = useMemo(
    () => rows.reduce((sum, r) => sum + (displayAmount(r) || 0), 0),
    [rows]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Deliveries</h1>
          <p className="text-sm text-gray-500">
            {rows.length} record(s) &middot; Total Amount: {peso(totalNet)}
          </p>
        </div>
        {canEncode && (
          <div className="flex gap-2">
            <Link href="/mercury/deliveries/new" className="btn-primary">
              + New Delivery
            </Link>
            <Link href="/mercury/deliveries/pickup" className="btn-secondary">
              + New Pick-up
            </Link>
          </div>
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
        <div>
          <label className="label">Date From</label>
          <input
            type="date"
            className="input"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Date To</label>
          <input
            type="date"
            className="input"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Type</label>
          <select
            className="input"
            value={transactionType}
            onChange={(e) => setTransactionType(e.target.value)}
          >
            <option value="">All</option>
            <option value="Delivery">Delivery</option>
            <option value="Pickup">Pickup</option>
          </select>
        </div>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">No deliveries found.</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Invoice Date</th>
                <th>PO #</th>
                <th>Invoice #</th>
                <th>Client</th>
                <th>Branch</th>
                <th>Type</th>
                <th>Status</th>
                <th>Delivery Date</th>
                <th>Priority</th>
                <th>Amount</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td>{r.invoice_date}</td>
                  <td>{r.po_number}</td>
                  <td>{r.invoice_number}</td>
                  <td>{r.client_name}</td>
                  <td>{r.branch_name || "—"}</td>
                  <td>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${transactionTypeBadgeClass(
                        r.transaction_type
                      )}`}
                    >
                      {r.transaction_type}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${deliveryStatusBadgeClass(
                        r.status
                      )}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td>{r.date_of_delivery || "—"}</td>
                  <td>{r.priority}</td>
                  <td>{peso(displayAmount(r))}</td>
                  <td className="space-x-2">
                    <Link
                      href={`/mercury/deliveries/${r.id}`}
                      className="text-brand-dark hover:underline text-xs font-medium"
                    >
                      View
                    </Link>
                    <Link
                      href={`/mercury/deliveries/${r.id}/print`}
                      className="text-gray-600 hover:underline text-xs font-medium"
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

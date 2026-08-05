"use client";

/**
 * 2026-07-13: For Dispatch tab.
 *
 * Warehouse staff pick which Pending ("For Delivery") or In-Transit
 * deliveries they're about to pull stock for, then generate a single
 * printable picking summary that aggregates total qty per item (with
 * expiration date) across every delivery they selected — so they know
 * exactly how much of each item to retrieve, without manually adding up
 * quantities across several separate invoices.
 *
 * 2026-07-13, follow-up: once staff have actually pulled the stock, they
 * click "Mark as Dispatched" (a separate, deliberate action from just
 * printing the summary) so the delivery drops off the "For Dispatch" view —
 * otherwise the same invoices would keep cluttering the picking list run
 * after run. Already-dispatched ones are still viewable under the
 * "Dispatched" view toggle in case staff need to double check or the status
 * needs correcting. `dispatched_at` lives on delivery_headers (not the
 * v_delivery_headers_full view), so it's fetched as a separate small query
 * and merged in JS, keeping this page independent of the view's column list.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, DeliveryHeaderFull } from "@/lib/mercury/types";
import { deliveryStatusBadgeClass, transactionTypeBadgeClass } from "@/lib/mercury/statusColors";

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "Pending", label: "Pending" },
  { value: "In-Transit", label: "In-Transit" },
];

function formatDateTime(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DispatchPage() {
  const router = useRouter();
  const [rows, setRows] = useState<DeliveryHeaderFull[]>([]);
  const [dispatchedAt, setDispatchedAt] = useState<Map<string, string>>(new Map());
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);

  const [view, setView] = useState<"pending" | "dispatched">("pending");
  const [status, setStatus] = useState("");
  const [clientId, setClientId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    let query = supabase
      .schema("flo").from("v_delivery_headers_full")
      .select("*")
      .in("status", ["Pending", "In-Transit"])
      .order("invoice_date", { ascending: true });

    if (status) query = query.eq("status", status);
    if (clientId) query = query.eq("client_id", clientId);

    const { data, error } = await query;
    if (error) {
      setError(error.message);
      setRows([]);
      setLoading(false);
      return;
    }
    const rowsData = (data as DeliveryHeaderFull[]) || [];
    setRows(rowsData);

    if (rowsData.length > 0) {
      const { data: dispatchRows, error: dispatchErr } = await supabase
        .schema("flo").from("delivery_headers")
        .select("id, dispatched_at")
        .in(
          "id",
          rowsData.map((r) => r.id)
        );
      if (!dispatchErr && dispatchRows) {
        const map = new Map<string, string>();
        for (const d of dispatchRows as { id: string; dispatched_at: string | null }[]) {
          if (d.dispatched_at) map.set(d.id, d.dispatched_at);
        }
        setDispatchedAt(map);
      }
    } else {
      setDispatchedAt(new Map());
    }

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

  const visibleRows = useMemo(
    () =>
      rows.filter((r) => (view === "pending" ? !dispatchedAt.has(r.id) : dispatchedAt.has(r.id))),
    [rows, dispatchedAt, view]
  );

  // Dropping a row that's no longer visible (e.g. filters/view changed) keeps
  // the selection set from silently holding stale ids.
  useEffect(() => {
    setSelected((prev) => {
      const visibleIds = new Set(visibleRows.map((r) => r.id));
      const next = new Set(Array.from(prev).filter((id) => visibleIds.has(id)));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows]);

  const allSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.id));

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleRows.map((r) => r.id)));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedCount = selected.size;

  function generateSummary() {
    if (selectedCount === 0) return;
    const ids = Array.from(selected).join(",");
    router.push(`/mercury/dispatch/print?ids=${encodeURIComponent(ids)}`);
  }

  async function markDispatched() {
    if (selectedCount === 0) return;
    if (!confirm(`Mark ${selectedCount} delivery(ies) as dispatched? They'll drop off this list.`))
      return;
    setMarking(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .schema("flo").from("delivery_headers")
      .update({ dispatched_at: new Date().toISOString() })
      .in("id", Array.from(selected));
    setMarking(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSelected(new Set());
    load();
  }

  async function unDispatch() {
    if (selectedCount === 0) return;
    if (
      !confirm(
        `Un-dispatch ${selectedCount} delivery(ies)? They'll move back to the "For Dispatch" list.`
      )
    )
      return;
    setMarking(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .schema("flo").from("delivery_headers")
      .update({ dispatched_at: null })
      .in("id", Array.from(selected));
    setMarking(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSelected(new Set());
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">For Dispatch</h1>
          <p className="text-sm text-gray-500">
            Select the deliveries you&apos;re about to pull stock for, generate a picking summary,
            then mark them dispatched once the stock is actually pulled.
          </p>
        </div>
        {view === "pending" && (
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={selectedCount === 0 || marking}
              onClick={markDispatched}
            >
              {marking ? "Marking…" : `Mark as Dispatched${selectedCount > 0 ? ` (${selectedCount})` : ""}`}
            </button>
            <button
              type="button"
              className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={selectedCount === 0}
              onClick={generateSummary}
            >
              Generate Picking Summary{selectedCount > 0 ? ` (${selectedCount})` : ""}
            </button>
          </div>
        )}
        {view === "dispatched" && (
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={selectedCount === 0 || marking}
              onClick={unDispatch}
            >
              {marking ? "Reversing…" : `Un-dispatch${selectedCount > 0 ? ` (${selectedCount})` : ""}`}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(
          [
            { value: "pending", label: "For Dispatch" },
            { value: "dispatched", label: "Dispatched" },
          ] as const
        ).map((tab) => {
          const active = view === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setView(tab.value)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-brand-dark border-brand-dark text-white shadow-sm"
                  : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

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
        ) : visibleRows.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">
            {view === "pending"
              ? "No pending or in-transit deliveries found."
              : "No dispatched deliveries found."}
          </div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                {(view === "pending" || view === "dispatched") && (
                  <th className="w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all"
                    />
                  </th>
                )}
                <th>Invoice Date</th>
                <th>PO #</th>
                <th>Invoice #</th>
                <th>Client</th>
                <th>Branch</th>
                <th>Type</th>
                <th>Status</th>
                <th>Priority</th>
                {view === "dispatched" && <th>Dispatched At</th>}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => (
                <tr
                  key={r.id}
                  className={`hover:bg-gray-50 cursor-pointer ${
                    selected.has(r.id) ? "bg-brand-light/40" : ""
                  }`}
                  onClick={() => toggleOne(r.id)}
                >
                  {(view === "pending" || view === "dispatched") && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggleOne(r.id)}
                        aria-label={`Select ${r.invoice_number}`}
                      />
                    </td>
                  )}
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
                  <td>{r.priority}</td>
                  {view === "dispatched" && <td>{formatDateTime(dispatchedAt.get(r.id))}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-400">
        Need to check or print a single invoice instead? Go to{" "}
        <Link href="/mercury/deliveries" className="text-brand-dark hover:underline">
          Deliveries
        </Link>
        .
      </p>
    </div>
  );
}

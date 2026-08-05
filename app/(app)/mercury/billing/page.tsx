"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, DeliveryHeaderFull } from "@/lib/mercury/types";
import { useRole } from "@/lib/mercury/RoleContext";
import {
  billingStatusBadgeClass,
  deliveryStatusBadgeClass,
  transactionTypeBadgeClass,
} from "@/lib/mercury/statusColors";

const DELIVERED_STATUSES = ["Delivered", "Delivered-Late"];
const BILLING_STATUS_OPTIONS = ["Unpaid", "Billed", "For Checking", "Partially Paid", "Paid", "Disputed"];
// Statuses that a "Generate Billing Statement" click should NOT downgrade —
// if an invoice is already further along than "Billed", leave it as-is.
const DO_NOT_DOWNGRADE_TO_BILLED = ["Partially Paid", "Paid", "Disputed"];

function peso(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(n || 0);
}

// Sort invoices in ascending numeric order (lowest to highest Invoice #) so
// the billing series stays sunod-sunod / maayos, regardless of Invoice
// Date. Falls back to plain string compare for non-numeric invoice numbers.
function invoiceNumberValue(v: string | null | undefined): number | null {
  if (!v) return null;
  const digits = v.replace(/\D/g, "");
  if (!digits) return null;
  return parseInt(digits, 10);
}

function compareByInvoiceNumber(a: { invoice_number: string | null }, b: { invoice_number: string | null }) {
  const na = invoiceNumberValue(a.invoice_number);
  const nb = invoiceNumberValue(b.invoice_number);
  if (na !== null && nb !== null && na !== nb) return na - nb;
  return (a.invoice_number || "").localeCompare(b.invoice_number || "");
}

export default function BillingPage() {
  const role = useRole();
  const router = useRouter();
  const readOnly = role === "general_manager";

  const [rows, setRows] = useState<DeliveryHeaderFull[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [clientId, setClientId] = useState("");
  const [billingStatus, setBillingStatus] = useState("Unpaid");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [transactionType, setTransactionType] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("For Checking");

  async function load() {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    const supabase = createClient();

    let query = supabase
      .schema("flo").from("v_delivery_headers_full")
      .select("*")
      .in("status", DELIVERED_STATUSES);

    if (clientId) query = query.eq("client_id", clientId);
    if (billingStatus) query = query.eq("billing_status", billingStatus);
    if (dateFrom) query = query.gte("invoice_date", dateFrom);
    if (dateTo) query = query.lte("invoice_date", dateTo);
    if (transactionType) query = query.eq("transaction_type", transactionType);

    const { data, error } = await query;
    if (error) setError(error.message);
    // Invoice series should read lowest-to-highest, not by Invoice Date.
    const sorted = ((data as DeliveryHeaderFull[]) || []).slice().sort(compareByInvoiceNumber);
    setRows(sorted);
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
  }, [clientId, billingStatus, dateFrom, dateTo, transactionType]);

  const totalNet = useMemo(() => rows.reduce((s, r) => s + (r.total_net_amount || 0), 0), [rows]);
  const totalFee = useMemo(() => rows.reduce((s, r) => s + (r.service_fee_amount || 0), 0), [rows]);

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const selectedNet = useMemo(
    () => selectedRows.reduce((s, r) => s + (r.total_net_amount || 0), 0),
    [selectedRows]
  );
  const selectedFee = useMemo(
    () => selectedRows.reduce((s, r) => s + (r.service_fee_amount || 0), 0),
    [selectedRows]
  );
  const selectedClientIds = useMemo(
    () => Array.from(new Set(selectedRows.map((r) => r.client_id).filter(Boolean))),
    [selectedRows]
  );
  const selectedTypes = useMemo(
    () => Array.from(new Set(selectedRows.map((r) => r.transaction_type).filter(Boolean))),
    [selectedRows]
  );

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.id)));
    }
  }

  async function handleBulkSetStatus() {
    if (readOnly || selected.size === 0) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .schema("flo").from("delivery_headers")
      .update({ billing_status: bulkStatus })
      .in("id", Array.from(selected));
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  async function handlePrintStatement() {
    if (selected.size === 0) return;
    if (selectedClientIds.length > 1) {
      setError("Isang client lang ang pwede sa bawat billing statement. Pumili ng mga invoice na iisang client lang.");
      return;
    }
    if (selectedTypes.length > 1) {
      setError(
        "Hiwalay ang Delivery at Pickup fee sa billing — pumili ng mga invoice na iisang Type lang (Delivery o Pickup) kada statement."
      );
      return;
    }
    const ids = Array.from(selected);

    // Auto-mark the invoices as "Billed" so it's clear a statement has
    // already been generated for them (skip ones already further along,
    // e.g. Paid/Disputed/Partially Paid, so we don't downgrade those).
    const idsToMarkBilled = selectedRows
      .filter((r) => !DO_NOT_DOWNGRADE_TO_BILLED.includes(r.billing_status))
      .map((r) => r.id);

    if (!readOnly && idsToMarkBilled.length > 0) {
      const supabase = createClient();
      const { error } = await supabase
        .schema("flo").from("delivery_headers")
        .update({ billing_status: "Billed" })
        .in("id", idsToMarkBilled);
      if (error) {
        setError(error.message);
        return;
      }
    }

    router.push(`/mercury/billing/statement?ids=${ids.join(",")}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Billing</h1>
          <p className="text-sm text-gray-500">
            {rows.length} delivered invoice(s) &middot; Total Net: {peso(totalNet)} &middot; Total Service Fee:{" "}
            {peso(totalFee)}
            {readOnly && <span className="ml-2 text-gray-400">&middot; View only</span>}
          </p>
        </div>
        {clientId && (
          <button
            className="btn-secondary"
            onClick={() => router.push(`/mercury/billing/soa?clientId=${clientId}`)}
          >
            Generate SOA (Statement of Account)
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="card p-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label">Client</label>
          <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">All</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.client_code} — {c.client_name}
                {c.service_rate != null ? ` (${c.service_rate}%)` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Billing Status</label>
          <select
            className="input"
            value={billingStatus}
            onChange={(e) => setBillingStatus(e.target.value)}
          >
            <option value="">All</option>
            {BILLING_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Invoice Date From</label>
          <input
            type="date"
            className="input"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Invoice Date To</label>
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

      {!readOnly && (
        <div className="card p-4 flex flex-wrap items-center gap-3">
          <span className="text-sm text-gray-600">
            {selected.size} selected &middot; Net: {peso(selectedNet)} &middot; Service Fee:{" "}
            {peso(selectedFee)}
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <select
              className="input w-auto"
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
            >
              {BILLING_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              className="btn-secondary"
              onClick={handleBulkSetStatus}
              disabled={selected.size === 0 || saving}
            >
              {saving ? "Saving…" : "Set Status"}
            </button>
            <button
              className="btn-primary"
              onClick={handlePrintStatement}
              disabled={selected.size === 0}
            >
              Generate Billing Statement
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">No delivered invoices found for these filters.</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                {!readOnly && (
                  <th>
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && selected.size === rows.length}
                      onChange={toggleAll}
                    />
                  </th>
                )}
                <th>Invoice Date</th>
                <th>Invoice #</th>
                <th>PO #</th>
                <th>Client</th>
                <th>Branch</th>
                <th>Type</th>
                <th>Status</th>
                <th>Delivery Date</th>
                <th>Net Amount</th>
                <th>Rate</th>
                <th>Service Fee</th>
                <th>Billing Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  {!readOnly && (
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggleRow(r.id)}
                      />
                    </td>
                  )}
                  <td>{r.invoice_date}</td>
                  <td>{r.invoice_number}</td>
                  <td>{r.po_number}</td>
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
                  <td>{peso(r.total_net_amount)}</td>
                  <td>
                    {r.transaction_type === "Pickup"
                      ? "5% (Pickup)"
                      : r.service_rate != null
                      ? `${r.service_rate}%`
                      : "—"}
                  </td>
                  <td>{peso(r.service_fee_amount)}</td>
                  <td>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${billingStatusBadgeClass(
                        r.billing_status
                      )}`}
                    >
                      {r.billing_status}
                    </span>
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

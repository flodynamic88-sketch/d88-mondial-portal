"use client";

/**
 * Statement of Account (SOA) — per-client outstanding balance.
 *
 * Lists ALL of a client's delivered invoices whose billing_status is not
 * yet "Paid" (Unpaid / Billed / For Checking / Partially Paid / Disputed),
 * regardless of which ones were included in any one Billing Statement, so
 * there's always a single running view of what a client still owes.
 * Admin/Encoder/Logistics can tick off invoices the client has since paid
 * and mark them Paid right here — once marked, they drop off this list.
 * Opened via /billing/soa?clientId=xxx
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, DeliveryHeaderFull, UserRole } from "@/lib/mercury/types";
import { billingStatusBadgeClass, transactionTypeBadgeClass } from "@/lib/mercury/statusColors";

const DELIVERED_STATUSES = ["Delivered", "Delivered-Late"];

function peso(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(n || 0);
}

function formatDate(d: string | null | undefined) {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
}

// Sort invoices in ascending numeric order (lowest to highest Invoice #) so
// the billing series stays sunod-sunod / maayos, regardless of Invoice Date.
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

function StatementOfAccountContent() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("clientId") || "";

  const [rows, setRows] = useState<DeliveryHeaderFull[]>([]);
  const [client, setClient] = useState<Client | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const readOnly = role === "general_manager";

  async function load() {
    if (!clientId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setSelected(new Set());
    const supabase = createClient();

    const { data: clientData } = await supabase
      .schema("flo").from("clients")
      .select("*")
      .eq("id", clientId)
      .single();
    setClient((clientData as Client) || null);

    const { data, error } = await supabase
      .schema("flo").from("v_delivery_headers_full")
      .select("*")
      .eq("client_id", clientId)
      .in("status", DELIVERED_STATUSES)
      .neq("billing_status", "Paid");
    if (error) setError(error.message);
    setRows(((data as DeliveryHeaderFull[]) || []).slice().sort(compareByInvoiceNumber));
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    async function loadRole() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.schema("flo").from("profiles").select("role").eq("id", user.id).single();
      if (data) setRole((data as { role: UserRole }).role);
    }
    loadRole();
  }, []);

  const totalOutstanding = useMemo(
    () => rows.reduce((s, r) => s + (r.service_fee_amount || 0), 0),
    [rows]
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
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  }

  async function handleMarkPaid() {
    if (readOnly || selected.size === 0) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .schema("flo").from("delivery_headers")
      .update({ billing_status: "Paid" })
      .in("id", Array.from(selected));
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  if (!clientId) return <div className="p-8 text-sm text-red-600">Walang napiling client.</div>;
  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>;

  return (
    <div>
      <style jsx global>{`
        @page {
          size: 8.5in 11in;
          margin: 0.5in;
        }
        body {
          background: white !important;
        }
        @media print {
          .print-toolbar {
            display: none !important;
          }
        }
      `}</style>

      <div className="print-toolbar flex justify-center gap-2 py-4">
        {!readOnly && (
          <button
            className="btn-secondary"
            onClick={handleMarkPaid}
            disabled={selected.size === 0 || saving}
          >
            {saving ? "Saving…" : `Mark Selected as Paid (${selected.size})`}
          </button>
        )}
        <button className="btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      {error && (
        <div className="print-toolbar max-w-3xl mx-auto rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-2">
          {error}
        </div>
      )}

      <div className="max-w-3xl mx-auto bg-white p-8 text-sm text-gray-900">
        <div className="flex items-center justify-between border-b border-gray-300 pb-4 mb-6">
          <div className="flex items-center gap-3">
            <img src="/logo-full.png" alt="Dynamic88" className="h-10 w-auto" />
            <div>
              <div className="text-lg font-bold">Dynamic88 Solutions — FLO Division</div>
              <div className="text-xs text-gray-500">Statement of Account</div>
            </div>
          </div>
          <div className="text-right text-xs text-gray-500">
            <div>As Of: {formatDate(new Date().toISOString())}</div>
          </div>
        </div>

        <div className="mb-6">
          <div className="font-semibold">Client:</div>
          <div>{client?.client_name}</div>
          {client?.billing_address && <div className="text-xs text-gray-500">{client.billing_address}</div>}
          <div className="text-xs text-gray-500 mt-1">
            Service Rate: {client?.service_rate != null ? `${client.service_rate}%` : "—"} of invoice amount
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="text-sm text-gray-500 py-6 text-center">
            Walang outstanding balance — fully paid na ang lahat ng invoices ng client na ito.
          </div>
        ) : (
          <>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-400">
                  {!readOnly && (
                    <th className="py-1 print:hidden">
                      <input
                        type="checkbox"
                        checked={rows.length > 0 && selected.size === rows.length}
                        onChange={toggleAll}
                      />
                    </th>
                  )}
                  <th className="py-1">Invoice Date</th>
                  <th className="py-1">Invoice #</th>
                  <th className="py-1">PO #</th>
                  <th className="py-1">Type</th>
                  <th className="py-1 text-right">Net Amount</th>
                  <th className="py-1 text-right">Rate</th>
                  <th className="py-1 text-right">Service Fee</th>
                  <th className="py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-200">
                    {!readOnly && (
                      <td className="py-1 print:hidden">
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleRow(r.id)}
                        />
                      </td>
                    )}
                    <td className="py-1">{formatDate(r.invoice_date)}</td>
                    <td className="py-1">{r.invoice_number}</td>
                    <td className="py-1">{r.po_number}</td>
                    <td className="py-1">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${transactionTypeBadgeClass(
                          r.transaction_type
                        )}`}
                      >
                        {r.transaction_type}
                      </span>
                    </td>
                    <td className="py-1 text-right">{peso(r.total_net_amount)}</td>
                    <td className="py-1 text-right">
                      {r.transaction_type === "Pickup"
                        ? "5% (Pickup)"
                        : r.service_rate != null
                        ? `${r.service_rate}%`
                        : "—"}
                    </td>
                    <td className="py-1 text-right">{peso(r.service_fee_amount)}</td>
                    <td className="py-1">
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

            <div className="mt-4 flex justify-end">
              <div className="w-64 space-y-1">
                <div className="flex justify-between font-bold text-base border-t border-gray-400 pt-1">
                  <span>TOTAL OUTSTANDING BALANCE:</span>
                  <span>{peso(totalOutstanding)}</span>
                </div>
              </div>
            </div>
          </>
        )}

        <div className="mt-16 grid grid-cols-2 gap-8 text-xs">
          <div className="flex flex-col justify-end">
            <div className="font-medium">Reymar Gapud</div>
            <div className="border-t border-gray-400 pt-1 mt-1">Prepared By — Logistics Manager</div>
          </div>
          <div className="flex flex-col justify-end">
            <div>&nbsp;</div>
            <div className="border-t border-gray-400 pt-1 mt-1">Received By / Date</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StatementOfAccountPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading…</div>}>
      <StatementOfAccountContent />
    </Suspense>
  );
}

"use client";

/**
 * Monthly Sales Report — polished, client-facing print page.
 *
 * Opened via /reports/sales-report/print?clientId=xxx&year=2026&month=7
 *
 * Shows EVERY delivery belonging to that client for the selected month
 * (Pending, In-Transit, Delivered, Returned, etc. — not just Delivered),
 * keyed on v_sales_report.report_date (= date_of_delivery, falling back to
 * posting_date/invoice_date for anything not yet delivered so it doesn't
 * disappear from the report). Also breaks down billing/payment status so
 * the client can see exactly how much they've paid vs. how much is still
 * outstanding. Placed outside the (app) layout group, following the same
 * @page / print-toolbar pattern used by the SOA and Billing Statement
 * print pages.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, SalesReportRow } from "@/lib/mercury/types";
import {
  billingStatusBadgeClass,
  deliveryStatusBadgeClass,
  transactionTypeBadgeClass,
} from "@/lib/mercury/statusColors";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const PAID_STATUS = "Paid";

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

function lastDayOfMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function SalesReportContent() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("clientId") || "";
  const year = Number(searchParams.get("year")) || new Date().getFullYear();
  const month = Number(searchParams.get("month")) || new Date().getMonth() + 1;

  const [client, setClient] = useState<Client | null>(null);
  const [rows, setRows] = useState<SalesReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const dateFrom = `${year}-${String(month).padStart(2, "0")}-01`;
  const dateTo = `${year}-${String(month).padStart(2, "0")}-${String(
    lastDayOfMonth(year, month)
  ).padStart(2, "0")}`;

  useEffect(() => {
    async function load() {
      if (!clientId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      const supabase = createClient();

      const { data: clientData } = await supabase
        .schema("flo").from("clients")
        .select("*")
        .eq("id", clientId)
        .single();
      setClient((clientData as Client) || null);

      const { data, error } = await supabase
        .schema("flo").from("v_sales_report")
        .select("*")
        .eq("client_id", clientId)
        .gte("report_date", dateFrom)
        .lte("report_date", dateTo)
        .order("report_date", { ascending: true });

      if (error) setError(error.message);
      setRows((data as SalesReportRow[]) || []);
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, dateFrom, dateTo]);

  const totals = useMemo(() => {
    const totalNet = rows.reduce((s, r) => s + (r.total_net_amount || 0), 0);
    const totalFee = rows.reduce((s, r) => s + (r.service_fee_amount || 0), 0);
    const paid = rows
      .filter((r) => r.billing_status === PAID_STATUS)
      .reduce((s, r) => s + (r.service_fee_amount || 0), 0);
    const outstanding = totalFee - paid;

    const byStatus: Record<string, { count: number; netAmount: number }> = {};
    for (const r of rows) {
      const key = r.status || "Unknown";
      if (!byStatus[key]) byStatus[key] = { count: 0, netAmount: 0 };
      byStatus[key].count += 1;
      byStatus[key].netAmount += r.total_net_amount || 0;
    }

    const byBilling: Record<string, { count: number; amount: number }> = {};
    for (const r of rows) {
      const key = r.billing_status || "Unknown";
      if (!byBilling[key]) byBilling[key] = { count: 0, amount: 0 };
      byBilling[key].count += 1;
      byBilling[key].amount += r.service_fee_amount || 0;
    }

    return { totalNet, totalFee, paid, outstanding, byStatus, byBilling };
  }, [rows]);

  if (!clientId) return <div className="p-8 text-sm text-red-600">Walang napiling client.</div>;
  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>;

  return (
    <div>
      <style jsx global>{`
        @page {
          size: 8.5in 13in;
          margin: 0.5in;
        }
        body {
          background: white !important;
        }
        @media print {
          .print-toolbar {
            display: none !important;
          }
          .report-card {
            break-inside: avoid;
          }
        }
      `}</style>

      <div className="print-toolbar flex justify-center gap-2 py-4">
        <button className="btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      {error && (
        <div className="print-toolbar max-w-4xl mx-auto rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-2">
          {error}
        </div>
      )}

      <div className="max-w-4xl mx-auto bg-white p-8 text-sm text-gray-900">
        {/* Letterhead */}
        <div className="flex items-center justify-between border-b-2 border-gray-800 pb-4 mb-6">
          <div className="flex items-center gap-3">
            <img src="/logo-full.png" alt="Dynamic88" className="h-9 w-auto" />
            <div>
              <div className="text-xl font-bold tracking-tight">Dynamic88 Solutions</div>
              <div className="text-xs text-gray-500 uppercase tracking-wider">FLO Division</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-gray-800">Monthly Sales Report</div>
            <div className="text-xs text-gray-500">
              Generated: {formatDate(new Date().toISOString())}
            </div>
          </div>
        </div>

        {/* Client + period */}
        <div className="flex items-center justify-between mb-6 rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-400">Client</div>
            <div className="font-semibold text-base">{client?.client_name}</div>
            {client?.billing_address && (
              <div className="text-xs text-gray-500">{client.billing_address}</div>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-gray-400">Period Covered</div>
            <div className="font-semibold text-base">
              {MONTHS[month - 1]} {year}
            </div>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="text-sm text-gray-500 py-10 text-center">
            Walang naitalang delivery para sa client na ito sa buwang ito.
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-3 mb-6">
              <div className="report-card rounded-lg border border-gray-200 p-3">
                <div className="text-xs text-gray-400 uppercase tracking-wide">Deliveries</div>
                <div className="text-2xl font-bold text-gray-800">{rows.length}</div>
              </div>
              <div className="report-card rounded-lg border border-gray-200 p-3">
                <div className="text-xs text-gray-400 uppercase tracking-wide">Total Net Amount</div>
                <div className="text-2xl font-bold text-gray-800">{peso(totals.totalNet)}</div>
              </div>
              <div className="report-card rounded-lg border border-green-200 bg-green-50 p-3">
                <div className="text-xs text-green-700 uppercase tracking-wide">Paid</div>
                <div className="text-2xl font-bold text-green-700">{peso(totals.paid)}</div>
              </div>
              <div className="report-card rounded-lg border border-red-200 bg-red-50 p-3">
                <div className="text-xs text-red-700 uppercase tracking-wide">Outstanding</div>
                <div className="text-2xl font-bold text-red-700">{peso(totals.outstanding)}</div>
              </div>
            </div>

            {/* Status breakdown */}
            <div className="report-card mb-6">
              <div className="font-semibold text-gray-800 mb-2">Delivery Status Breakdown</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(totals.byStatus).map(([status, v]) => (
                  <div
                    key={status}
                    className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-1.5"
                  >
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${deliveryStatusBadgeClass(
                        status
                      )}`}
                    >
                      {status}
                    </span>
                    <span className="text-xs text-gray-600">
                      {v.count} &middot; {peso(v.netAmount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Billing / payment breakdown */}
            <div className="report-card mb-6">
              <div className="font-semibold text-gray-800 mb-2">Billing / Payment Status</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(totals.byBilling).map(([status, v]) => (
                  <div
                    key={status}
                    className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-1.5"
                  >
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${billingStatusBadgeClass(
                        status
                      )}`}
                    >
                      {status}
                    </span>
                    <span className="text-xs text-gray-600">
                      {v.count} &middot; {peso(v.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Detailed table */}
            <div className="font-semibold text-gray-800 mb-2">Transaction Details</div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-gray-400">
                  <th className="py-1.5">Date</th>
                  <th className="py-1.5">Invoice #</th>
                  <th className="py-1.5">PO #</th>
                  <th className="py-1.5">Branch</th>
                  <th className="py-1.5">Type</th>
                  <th className="py-1.5">Status</th>
                  <th className="py-1.5 text-right">Net Amount</th>
                  <th className="py-1.5 text-right">Rate</th>
                  <th className="py-1.5 text-right">Service Fee</th>
                  <th className="py-1.5">Billing</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100">
                    <td className="py-1.5">{formatDate(r.report_date)}</td>
                    <td className="py-1.5">{r.invoice_number || "—"}</td>
                    <td className="py-1.5">{r.po_number || "—"}</td>
                    <td className="py-1.5">{r.branch_name || "—"}</td>
                    <td className="py-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${transactionTypeBadgeClass(
                          r.transaction_type
                        )}`}
                      >
                        {r.transaction_type}
                      </span>
                    </td>
                    <td className="py-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${deliveryStatusBadgeClass(
                          r.status
                        )}`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="py-1.5 text-right">{peso(r.total_net_amount)}</td>
                    <td className="py-1.5 text-right">
                      {r.transaction_type === "Pickup"
                        ? "5%"
                        : r.service_rate != null
                        ? `${r.service_rate}%`
                        : "—"}
                    </td>
                    <td className="py-1.5 text-right">{peso(r.service_fee_amount)}</td>
                    <td className="py-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${billingStatusBadgeClass(
                          r.billing_status
                        )}`}
                      >
                        {r.billing_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-400 font-semibold">
                  <td colSpan={6} className="py-2 text-right">
                    Totals:
                  </td>
                  <td className="py-2 text-right">{peso(totals.totalNet)}</td>
                  <td></td>
                  <td className="py-2 text-right">{peso(totals.totalFee)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
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

export default function SalesReportPrintPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading…</div>}>
      <SalesReportContent />
    </Suspense>
  );
}

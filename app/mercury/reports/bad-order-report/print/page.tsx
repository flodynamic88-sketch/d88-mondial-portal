"use client";

/**
 * Bad Order Monthly Report — polished, client-facing print page.
 *
 * Opened via /reports/bad-order-report/print?clientId=xxx&year=2026&month=7
 *
 * Lists every Bad Order line for that client whose header Date Backload
 * falls in the selected month, with a status breakdown (Stored in
 * Warehouse / Returned to Client-Principal / Disposed, counted per BO#)
 * and a grand total amount. Placed outside the (app) layout group,
 * following the same @page / print-toolbar pattern used by the Sales
 * Report / Inventory Report client-facing print pages.
 *
 * 2026-07-16: updated for the header + multiple lines restructure — a
 * single BO# can now cover multiple items, so this page queries
 * bad_order_headers with nested bad_order_lines and flattens to one
 * table row per line (repeating the BO#/date/branch on each of its
 * lines), same convention as Stock Receiving's per-line report tables.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { BadOrderHeader, BadOrderLine, Client } from "@/lib/mercury/types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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

interface HeaderRow extends BadOrderHeader {
  branches?: { id: string; branch_code: string; branch_name: string; retail_chain: string | null } | null;
  bad_order_lines?: BadOrderLine[];
}

interface FlatRow {
  header: HeaderRow;
  line: BadOrderLine;
}

function BadOrderReportContent() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("clientId") || "";
  const year = Number(searchParams.get("year")) || new Date().getFullYear();
  const month = Number(searchParams.get("month")) || new Date().getMonth() + 1;

  const [client, setClient] = useState<Client | null>(null);
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
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
        .schema("flo").from("bad_order_headers")
        .select("*, branches(id, branch_code, branch_name, retail_chain), bad_order_lines(*)")
        .eq("client_id", clientId)
        .gte("date_backload", dateFrom)
        .lte("date_backload", dateTo)
        .order("date_backload", { ascending: true });

      if (error) setError(error.message);
      setHeaders((data as unknown as HeaderRow[]) || []);
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, dateFrom, dateTo]);

  const flatRows: FlatRow[] = useMemo(() => {
    const out: FlatRow[] = [];
    headers.forEach((h) => {
      (h.bad_order_lines || []).forEach((l) => out.push({ header: h, line: l }));
    });
    return out;
  }, [headers]);

  const totals = useMemo(() => {
    const totalAmount = flatRows.reduce((s, r) => s + (r.line.amount || 0), 0);
    const totalQty = flatRows.reduce((s, r) => s + (r.line.qty || 0), 0);

    const byStatus: Record<string, { count: number; amount: number }> = {};
    for (const h of headers) {
      const key = h.status || "Unknown";
      if (!byStatus[key]) byStatus[key] = { count: 0, amount: 0 };
      byStatus[key].count += 1;
      byStatus[key].amount += (h.bad_order_lines || []).reduce((s, l) => s + (l.amount || 0), 0);
    }

    return { totalAmount, totalQty, byStatus };
  }, [flatRows, headers]);

  if (!clientId) return <div className="p-8 text-sm text-red-600">Walang napiling client.</div>;
  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>;

  return (
    <div>
      <style jsx global>{`
        @page {
          /* 2026-07-15: landscape (13in x 8.5in, swapped from the
          portrait Sales Report convention) so the item table has room
          to breathe and doesn't look squeezed. */
          size: 13in 8.5in;
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
        <div className="print-toolbar max-w-6xl mx-auto rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-2">
          {error}
        </div>
      )}

      <div className="max-w-6xl mx-auto bg-white p-8 text-sm text-gray-900">
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
            <div className="text-lg font-bold text-gray-800">Bad Order Monthly Report</div>
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

        {flatRows.length === 0 ? (
          <div className="text-sm text-gray-500 py-10 text-center">
            Walang naitalang bad order para sa client na ito sa buwang ito.
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="report-card rounded-lg border border-gray-200 p-3">
                <div className="text-xs text-gray-400 uppercase tracking-wide">BO# / Lines</div>
                <div className="text-2xl font-bold text-gray-800">
                  {headers.length} / {flatRows.length}
                </div>
              </div>
              <div className="report-card rounded-lg border border-gray-200 p-3">
                <div className="text-xs text-gray-400 uppercase tracking-wide">Total Qty</div>
                <div className="text-2xl font-bold text-gray-800">{totals.totalQty}</div>
              </div>
              <div className="report-card rounded-lg border border-gray-200 p-3">
                <div className="text-xs text-gray-400 uppercase tracking-wide">Total Amount</div>
                <div className="text-2xl font-bold text-gray-800">{peso(totals.totalAmount)}</div>
              </div>
            </div>

            {/* Status breakdown */}
            <div className="report-card mb-6">
              <div className="font-semibold text-gray-800 mb-2">Status Breakdown</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(totals.byStatus).map(([status, v]) => (
                  <div
                    key={status}
                    className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-1.5"
                  >
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(
                        status
                      )}`}
                    >
                      {status}
                    </span>
                    <span className="text-xs text-gray-600">
                      {v.count} BO# &middot; {peso(v.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Detailed table */}
            {/* 2026-07-15: client said the table looked cramped/"dikit-dikit"
            -- the cells had no horizontal padding at all so columns ran
            into each other. Added px-3 padding + light column dividers +
            nowrap headers, and bumped the font up now that the page is
            landscape and has the room. */}
            <div className="font-semibold text-gray-800 mb-2">Bad Order Details</div>
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-gray-400">
                  <th className="py-2 px-4 whitespace-nowrap border-r border-gray-200">BO #</th>
                  <th className="py-2 px-4 whitespace-nowrap border-r border-gray-200">Date Backload</th>
                  <th className="py-2 px-4 border-r border-gray-200">Branch</th>
                  <th className="py-2 px-4 whitespace-nowrap border-r border-gray-200">Item Code</th>
                  <th className="py-2 px-4 border-r border-gray-200">Item Description</th>
                  <th className="py-2 px-4 text-right border-r border-gray-200">Qty</th>
                  <th className="py-2 px-4 border-r border-gray-200">Unit</th>
                  <th className="py-2 pl-4 pr-8 text-right whitespace-nowrap border-r border-gray-200">
                    Amount
                  </th>
                  <th className="py-2 pl-8 pr-4 whitespace-nowrap border-r border-gray-200">Expiration</th>
                  <th className="py-2 px-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {flatRows.map(({ header, line }) => (
                  <tr key={line.id} className="border-b border-gray-100">
                    <td className="py-2 px-4 whitespace-nowrap border-r border-gray-100">
                      {header.bo_number}
                    </td>
                    <td className="py-2 px-4 whitespace-nowrap border-r border-gray-100">
                      {formatDate(header.date_backload)}
                    </td>
                    <td className="py-2 px-4 border-r border-gray-100">
                      {header.branches?.branch_name || "—"}
                    </td>
                    <td className="py-2 px-4 whitespace-nowrap border-r border-gray-100">
                      {line.item_code}
                    </td>
                    <td className="py-2 px-4 border-r border-gray-100">{line.item_description}</td>
                    <td className="py-2 px-4 text-right border-r border-gray-100">{line.qty}</td>
                    <td className="py-2 px-4 border-r border-gray-100">{line.unit || "—"}</td>
                    <td className="py-2 pl-4 pr-8 text-right whitespace-nowrap border-r border-gray-100">
                      {peso(line.amount)}
                    </td>
                    <td className="py-2 pl-8 pr-4 whitespace-nowrap border-r border-gray-100">
                      {formatDate(line.expiration_date)}
                    </td>
                    <td className="py-2 px-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(
                          header.status
                        )}`}
                      >
                        {header.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-400 font-semibold">
                  <td colSpan={5} className="py-2 px-4 text-right">
                    Totals:
                  </td>
                  <td className="py-2 px-4 text-right">{totals.totalQty}</td>
                  <td></td>
                  <td className="py-2 pl-4 pr-8 text-right">{peso(totals.totalAmount)}</td>
                  <td></td>
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

export default function BadOrderReportPrintPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading…</div>}>
      <BadOrderReportContent />
    </Suspense>
  );
}

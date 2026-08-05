"use client";

/**
 * Monthly Inventory Report — polished, client-facing print page.
 *
 * Opened via /reports/inventory-report/print?clientId=xxx&year=2026&month=7
 *
 * Calls the get_inventory_report(client_id, date_from, date_to) SQL
 * function, which derives Beginning Balance, Stock In, Stock Out, and
 * Ending Balance per item entirely from the stock_movements audit ledger
 * -- correct for any month, not just "this month so far". Placed outside
 * the (app) layout group, following the same @page / print-toolbar
 * pattern used by the other print pages in the app.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, InventoryReportRow } from "@/lib/mercury/types";

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

function qty(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(n || 0);
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

function InventoryReportContent() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("clientId") || "";
  const year = Number(searchParams.get("year")) || new Date().getFullYear();
  const month = Number(searchParams.get("month")) || new Date().getMonth() + 1;

  const [client, setClient] = useState<Client | null>(null);
  const [rows, setRows] = useState<InventoryReportRow[]>([]);
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

      const { data, error } = await supabase.schema("flo").rpc("get_inventory_report", {
        p_client_id: clientId,
        p_date_from: dateFrom,
        p_date_to: dateTo,
      });

      if (error) setError(error.message);
      setRows((data as InventoryReportRow[]) || []);
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, dateFrom, dateTo]);

  const totals = useMemo(() => {
    const beginning = rows.reduce((s, r) => s + (r.beginning_balance || 0), 0);
    const stockIn = rows.reduce((s, r) => s + (r.stock_in || 0), 0);
    const stockOut = rows.reduce((s, r) => s + (r.stock_out || 0), 0);
    const ending = rows.reduce((s, r) => s + (r.ending_balance || 0), 0);
    const endingValue = rows.reduce(
      (s, r) => s + (r.ending_balance || 0) * (r.unit_price || 0),
      0
    );
    const lowStockCount = rows.filter(
      (r) => r.reorder_pt != null && r.ending_balance <= r.reorder_pt
    ).length;
    return { beginning, stockIn, stockOut, ending, endingValue, lowStockCount };
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
              <div className="text-xs text-gray-500 uppercase tracking-wider">FLO Division — Warehouse</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-gray-800">Monthly Inventory Report</div>
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
            {client?.delivery_address && (
              <div className="text-xs text-gray-500">{client.delivery_address}</div>
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
            Walang naka-warehouse na item para sa client na ito.
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-3 mb-6">
              <div className="report-card rounded-lg border border-gray-200 p-3">
                <div className="text-xs text-gray-400 uppercase tracking-wide">Beginning Balance</div>
                <div className="text-2xl font-bold text-gray-800">{qty(totals.beginning)}</div>
              </div>
              <div className="report-card rounded-lg border border-green-200 bg-green-50 p-3">
                <div className="text-xs text-green-700 uppercase tracking-wide">Stock In</div>
                <div className="text-2xl font-bold text-green-700">+{qty(totals.stockIn)}</div>
              </div>
              <div className="report-card rounded-lg border border-red-200 bg-red-50 p-3">
                <div className="text-xs text-red-700 uppercase tracking-wide">Stock Out</div>
                <div className="text-2xl font-bold text-red-700">-{qty(totals.stockOut)}</div>
              </div>
              <div className="report-card rounded-lg border border-brand/30 bg-brand-light p-3">
                <div className="text-xs text-brand-dark uppercase tracking-wide">Actual Stock on Hand</div>
                <div className="text-2xl font-bold text-brand-dark">{qty(totals.ending)}</div>
              </div>
            </div>

            <div className="report-card mb-6 flex flex-wrap items-center justify-between rounded-lg border border-gray-200 px-4 py-2 text-xs text-gray-600">
              <div>
                Estimated Inventory Value (Ending): <span className="font-semibold text-gray-800">{peso(totals.endingValue)}</span>
              </div>
              {totals.lowStockCount > 0 && (
                <div className="text-orange-600 font-medium">
                  {totals.lowStockCount} item(s) at or below reorder point
                </div>
              )}
            </div>

            {/* Detailed table */}
            <div className="font-semibold text-gray-800 mb-2">Item-Level Detail</div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-gray-400">
                  <th className="py-1.5">Item Code</th>
                  <th className="py-1.5">Description</th>
                  <th className="py-1.5">Category</th>
                  <th className="py-1.5">Unit</th>
                  <th className="py-1.5 text-right">Beginning</th>
                  <th className="py-1.5 text-right">Stock In</th>
                  <th className="py-1.5 text-right">Stock Out</th>
                  <th className="py-1.5 text-right">Ending / On Hand</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isLow = r.reorder_pt != null && r.ending_balance <= r.reorder_pt;
                  return (
                    <tr key={r.item_id} className="border-b border-gray-100">
                      <td className="py-1.5">{r.item_code}</td>
                      <td className="py-1.5">{r.item_description}</td>
                      <td className="py-1.5">{r.category || "—"}</td>
                      <td className="py-1.5">{r.unit || "—"}</td>
                      <td className="py-1.5 text-right">{qty(r.beginning_balance)}</td>
                      <td className="py-1.5 text-right text-green-700">
                        {r.stock_in > 0 ? `+${qty(r.stock_in)}` : "—"}
                      </td>
                      <td className="py-1.5 text-right text-red-700">
                        {r.stock_out > 0 ? `-${qty(r.stock_out)}` : "—"}
                      </td>
                      <td className="py-1.5 text-right font-semibold">
                        {qty(r.ending_balance)}
                        {isLow && (
                          <span className="ml-1 rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-medium text-orange-700">
                            LOW
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-400 font-semibold">
                  <td colSpan={4} className="py-2 text-right">
                    Totals:
                  </td>
                  <td className="py-2 text-right">{qty(totals.beginning)}</td>
                  <td className="py-2 text-right text-green-700">+{qty(totals.stockIn)}</td>
                  <td className="py-2 text-right text-red-700">-{qty(totals.stockOut)}</td>
                  <td className="py-2 text-right">{qty(totals.ending)}</td>
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

export default function InventoryReportPrintPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading…</div>}>
      <InventoryReportContent />
    </Suspense>
  );
}

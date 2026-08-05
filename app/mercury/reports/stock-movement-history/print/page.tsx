"use client";

/**
 * Monthly Stock Card Report — polished, client-facing print page.
 *
 * Opened via /reports/stock-movement-history/print?clientId=xxx&year=2026&month=7
 * (itemId optional, to scope the report to one item).
 *
 * Reads get_inventory_report (migration_027) for beginning/ending balances
 * per item, and v_stock_movement_ledger (migration_027) for the detailed,
 * chronological IN/OUT ledger with real document numbers/dates and a
 * running balance — rendered as one classic stock-card block per item:
 * Beginning Inventory, then each movement, then Ending Inventory. Placed
 * outside the (app) layout group, following the same @page / print-toolbar
 * pattern used by the other print pages in the app.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, InventoryReportRow, StockMovementRow } from "@/lib/mercury/types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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

function StockMovementHistoryContent() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("clientId") || "";
  const itemId = searchParams.get("itemId") || "";
  const year = Number(searchParams.get("year")) || new Date().getFullYear();
  const month = Number(searchParams.get("month")) || new Date().getMonth() + 1;

  const [client, setClient] = useState<Client | null>(null);
  const [reportRows, setReportRows] = useState<InventoryReportRow[]>([]);
  const [ledgerRows, setLedgerRows] = useState<StockMovementRow[]>([]);
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

      const [reportRes, ledgerRes] = await Promise.all([
        supabase.schema("flo").rpc("get_inventory_report", {
          p_client_id: clientId,
          p_date_from: dateFrom,
          p_date_to: dateTo,
        }),
        supabase
          .schema("flo").from("v_stock_movement_ledger")
          .select("*")
          .eq("client_id", clientId)
          .gte("movement_date", dateFrom)
          .lte("movement_date", dateTo)
          .order("item_code", { ascending: true })
          .order("created_at", { ascending: true }),
      ]);

      if (reportRes.error) setError(reportRes.error.message);
      else if (ledgerRes.error) setError(ledgerRes.error.message);

      let report = (reportRes.data as InventoryReportRow[]) || [];
      let ledger = (ledgerRes.data as StockMovementRow[]) || [];
      if (itemId) {
        report = report.filter((r) => r.item_id === itemId);
        ledger = ledger.filter((r) => r.item_id === itemId);
      }
      setReportRows(report);
      setLedgerRows(ledger);
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, itemId, dateFrom, dateTo]);

  const ledgerByItem = useMemo(() => {
    const map = new Map<string, StockMovementRow[]>();
    for (const r of ledgerRows) {
      const arr = map.get(r.item_id) || [];
      arr.push(r);
      map.set(r.item_id, arr);
    }
    return map;
  }, [ledgerRows]);

  const totals = useMemo(() => {
    const totalIn = reportRows.reduce((s, r) => s + (r.stock_in || 0), 0);
    const totalOut = reportRows.reduce((s, r) => s + (r.stock_out || 0), 0);
    return { totalIn, totalOut, net: totalIn - totalOut, itemCount: reportRows.length };
  }, [reportRows]);

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
            <div className="text-lg font-bold text-gray-800">Stock Card Report</div>
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

        {reportRows.length === 0 ? (
          <div className="text-sm text-gray-500 py-10 text-center">
            Walang item para sa client na ito sa buwang ito.
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-3 mb-6">
              <div className="report-card rounded-lg border border-green-200 bg-green-50 p-3">
                <div className="text-xs text-green-700 uppercase tracking-wide">Total Stock In</div>
                <div className="text-2xl font-bold text-green-700">+{qty(totals.totalIn)}</div>
              </div>
              <div className="report-card rounded-lg border border-red-200 bg-red-50 p-3">
                <div className="text-xs text-red-700 uppercase tracking-wide">Total Stock Out</div>
                <div className="text-2xl font-bold text-red-700">-{qty(totals.totalOut)}</div>
              </div>
              <div className="report-card rounded-lg border border-brand/30 bg-brand-light p-3">
                <div className="text-xs text-brand-dark uppercase tracking-wide">Net Change</div>
                <div className="text-2xl font-bold text-brand-dark">
                  {totals.net >= 0 ? "+" : ""}
                  {qty(totals.net)}
                </div>
              </div>
              <div className="report-card rounded-lg border border-gray-200 p-3">
                <div className="text-xs text-gray-400 uppercase tracking-wide">Items</div>
                <div className="text-2xl font-bold text-gray-800">{totals.itemCount}</div>
              </div>
            </div>

            {/* Stock cards, one per item */}
            <div className="space-y-6">
              {reportRows.map((item) => {
                const movements = ledgerByItem.get(item.item_id) || [];
                const isLow = item.reorder_pt != null && item.ending_balance <= item.reorder_pt;
                return (
                  <div key={item.item_id} className="report-card">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="font-semibold text-gray-800">
                        {item.item_code} — {item.item_description}
                        <span className="text-gray-400 font-normal"> ({item.unit || "—"})</span>
                      </div>
                      {isLow && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                          LOW STOCK
                        </span>
                      )}
                    </div>
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-gray-400">
                          <th className="py-1.5">Date</th>
                          <th className="py-1.5">Document #</th>
                          <th className="py-1.5">Details</th>
                          <th className="py-1.5">Expiration</th>
                          <th className="py-1.5 text-right">Stock In</th>
                          <th className="py-1.5 text-right">Stock Out</th>
                          <th className="py-1.5 text-right">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-gray-100 bg-gray-50 font-medium">
                          <td colSpan={6} className="py-1.5">
                            Beginning Inventory
                          </td>
                          <td className="py-1.5 text-right">{qty(item.beginning_balance)}</td>
                        </tr>
                        {movements.map((r) => (
                          <tr key={r.movement_id} className="border-b border-gray-100">
                            <td className="py-1.5">{formatDate(r.document_date || r.movement_date)}</td>
                            <td className="py-1.5">{r.document_number || "—"}</td>
                            <td className="py-1.5">{r.party_or_reason || r.movement_type}</td>
                            <td className="py-1.5">{r.expiration_date ? formatDate(r.expiration_date) : "—"}</td>
                            <td className="py-1.5 text-right text-green-700">
                              {r.direction === "IN" ? `+${qty(r.abs_qty)}` : "—"}
                            </td>
                            <td className="py-1.5 text-right text-red-700">
                              {r.direction === "OUT" ? `-${qty(r.abs_qty)}` : "—"}
                            </td>
                            <td className="py-1.5 text-right">{qty(r.running_balance)}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-gray-400 bg-gray-50 font-semibold">
                          <td colSpan={6} className="py-1.5">
                            Ending Inventory
                          </td>
                          <td className="py-1.5 text-right">{qty(item.ending_balance)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                );
              })}
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

export default function StockMovementHistoryPrintPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading…</div>}>
      <StockMovementHistoryContent />
    </Suspense>
  );
}

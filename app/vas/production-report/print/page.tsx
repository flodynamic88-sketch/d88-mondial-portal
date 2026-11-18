"use client";

/**
 * Print-only Daily Bundle Production Report.
 *
 * Reached from the date picker + "Print Daily Report" button on
 * app/(app)/vas/production/page.tsx (?date=YYYY-MM-DD). For every kit line
 * that had at least one production batch logged on that date, shows Target
 * Qty, Qty Completed Today, Qty Completed Previously, Total to Date, and
 * Balance Remaining -- signed by the VAS Officer (Prepared By) and VAS
 * Manager (Checked By) for their filing.
 *
 * Deliberately placed OUTSIDE the (app) route group -- same convention as
 * app/mercury/dispatch/print and app/vas/warehouse-transfer/print -- so the
 * shared app shell never renders on the printed page.
 *
 * "Qty Completed Previously" / "Total to Date" are derived from
 * vas.v_production_progress's cumulative_qty_to_date, which is already a
 * running total per kit line ordered by batch_date (then created_at) --
 * since production qty only ever accumulates, the highest cumulative value
 * among a line's rows dated on/before the report date IS that line's total
 * as of that date, with no need for a separate created_at tiebreaker.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/vas/supabase/client";
import type { VasItem, VasProductionProgress } from "@/lib/vas/types";

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
}

interface ReportRow {
  memoItemId: string;
  memoNo: string;
  clientName: string;
  kitNo: string;
  bundleLabel: string;
  target: number;
  today: number;
  previous: number;
  totalToDate: number;
  balance: number;
}

function ProductionReportPrintContent() {
  const searchParams = useSearchParams();
  const date = searchParams.get("date") || new Date().toISOString().slice(0, 10);

  const [progress, setProgress] = useState<VasProductionProgress[]>([]);
  const [items, setItems] = useState<VasItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const [progressRes, itemsRes] = await Promise.all([
        supabase.schema("vas").from("v_production_progress").select("*"),
        supabase.schema("vas").from("items").select("*"),
      ]);
      if (progressRes.error) setError(progressRes.error.message);
      setProgress((progressRes.data as VasProductionProgress[]) || []);
      setItems((itemsRes.data as VasItem[]) || []);
      setLoading(false);
    }
    load();
  }, []);

  const itemLabel = (id: string) => {
    const it = items.find((i) => i.id === id);
    return it ? `${it.item_code} — ${it.item_description}` : id;
  };

  const rows: ReportRow[] = useMemo(() => {
    const byLine = new Map<string, VasProductionProgress[]>();
    for (const p of progress) {
      const arr = byLine.get(p.memo_item_id) || [];
      arr.push(p);
      byLine.set(p.memo_item_id, arr);
    }
    const result: ReportRow[] = [];
    for (const [memoItemId, lineRows] of byLine.entries()) {
      const today = lineRows
        .filter((r) => r.batch_date === date)
        .reduce((s, r) => s + Number(r.qty_produced), 0);
      if (today <= 0) continue; // only lines with activity on the report date
      const totalToDate = lineRows
        .filter((r) => r.batch_date <= date)
        .reduce((max, r) => Math.max(max, Number(r.cumulative_qty_to_date)), 0);
      const previous = Math.max(totalToDate - today, 0);
      const first = lineRows[0];
      result.push({
        memoItemId,
        memoNo: first.memo_no,
        clientName: first.client_name,
        kitNo: first.kit_no,
        bundleLabel: itemLabel(first.finished_item_id),
        target: Number(first.target_qty),
        today,
        previous,
        totalToDate,
        balance: Math.max(Number(first.target_qty) - totalToDate, 0),
      });
    }
    return result.sort((a, b) => (a.memoNo === b.memoNo ? a.kitNo.localeCompare(b.kitNo) : a.memoNo.localeCompare(b.memoNo)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, items, date]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          today: acc.today + r.today,
          previous: acc.previous + r.previous,
          totalToDate: acc.totalToDate + r.totalToDate,
          balance: acc.balance + r.balance,
        }),
        { today: 0, previous: 0, totalToDate: 0, balance: 0 }
      ),
    [rows]
  );

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
          .avoid-break {
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
        <div className="print-toolbar max-w-3xl mx-auto mb-4 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="max-w-3xl mx-auto bg-white text-gray-900">
        <div className="h-2 bg-brand" />

        <div className="p-8">
          {/* Letterhead */}
          <div className="flex items-start justify-between gap-6 pb-5 mb-6 border-b border-gray-200">
            <div className="flex items-start gap-3">
              <img src="/logo-icon.png" alt="Dynamic88" className="h-12 w-12 shrink-0" />
              <div>
                <div className="text-xl font-bold text-brand-dark">Dynamic88 Solutions</div>
                <div className="text-xs font-medium text-gray-500 mt-0.5">
                  VAS Division — Value Added Service
                </div>
                <div className="text-xs text-gray-500 mt-1 max-w-xs">
                  M2 Southwood Industrial Park Governor&apos;s Drive Brgy. Mabuhay Carmona, Cavite
                </div>
              </div>
            </div>
            <div className="shrink-0 rounded-lg border border-brand-light bg-brand-light px-5 py-3 text-right">
              <div className="text-lg font-bold tracking-wide text-brand-dark">
                DAILY BUNDLE PRODUCTION REPORT
              </div>
              <div className="text-[11px] font-semibold uppercase text-gray-500 mt-1">
                Report Date
              </div>
              <div className="text-base font-semibold text-gray-900">{formatDate(date)}</div>
            </div>
          </div>

          {/* Table */}
          <table className="w-full text-left border-collapse mb-2 text-sm">
            <thead>
              <tr className="bg-brand-light text-brand-dark">
                <th className="py-2 px-3 rounded-l-md font-semibold text-xs uppercase">Memo No.</th>
                <th className="py-2 px-3 font-semibold text-xs uppercase">Bundle (Kit)</th>
                <th className="py-2 px-3 text-right font-semibold text-xs uppercase">Target Qty</th>
                <th className="py-2 px-3 text-right font-semibold text-xs uppercase">Completed Today</th>
                <th className="py-2 px-3 text-right font-semibold text-xs uppercase">Completed Previously</th>
                <th className="py-2 px-3 text-right font-semibold text-xs uppercase">Total to Date</th>
                <th className="py-2 px-3 text-right font-semibold text-xs uppercase rounded-r-md">
                  Balance Remaining
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.memoItemId} className={idx % 2 === 1 ? "bg-gray-50" : ""}>
                  <td className="py-2 px-3 border-b border-gray-100">
                    {r.memoNo}
                    <div className="text-[10px] text-gray-400">{r.clientName}</div>
                  </td>
                  <td className="py-2 px-3 border-b border-gray-100">
                    Kit {r.kitNo}
                    <div className="text-[10px] text-gray-400">{r.bundleLabel}</div>
                  </td>
                  <td className="py-2 px-3 border-b border-gray-100 text-right">{r.target}</td>
                  <td className="py-2 px-3 border-b border-gray-100 text-right font-semibold text-green-700">
                    {r.today}
                  </td>
                  <td className="py-2 px-3 border-b border-gray-100 text-right">{r.previous}</td>
                  <td className="py-2 px-3 border-b border-gray-100 text-right font-semibold">
                    {r.totalToDate}
                  </td>
                  <td className="py-2 px-3 border-b border-gray-100 text-right">
                    {r.balance}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 px-3 text-center text-gray-400">
                    No production logged for this date.
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t border-gray-200">
                  <td colSpan={2} className="py-2 px-3 text-right text-[10px] font-semibold uppercase text-gray-400">
                    Total
                  </td>
                  <td></td>
                  <td className="py-2 px-3 text-right font-semibold">{totals.today}</td>
                  <td className="py-2 px-3 text-right font-semibold">{totals.previous}</td>
                  <td className="py-2 px-3 text-right font-semibold">{totals.totalToDate}</td>
                  <td className="py-2 px-3 text-right font-semibold">{totals.balance}</td>
                </tr>
              </tfoot>
            )}
          </table>

          {/* Signature block */}
          <div className="mt-12 grid grid-cols-2 gap-8 text-xs">
            <div className="flex flex-col justify-end">
              <div>&nbsp;</div>
              <div className="border-t border-gray-300 pt-1 mt-1 text-gray-500">
                Prepared By (VAS Officer) / Date
              </div>
            </div>
            <div className="flex flex-col justify-end">
              <div>&nbsp;</div>
              <div className="border-t border-gray-300 pt-1 mt-1 text-gray-500">
                Checked By (VAS Manager) / Date
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProductionReportPrintPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading…</div>}>
      <ProductionReportPrintContent />
    </Suspense>
  );
}

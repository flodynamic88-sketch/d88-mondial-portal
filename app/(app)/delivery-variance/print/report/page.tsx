"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getAppSetting, LOGO_SETTING_KEY } from "@/lib/appSettings";
import type { VDeliveryVarianceLog } from "@/types/database";

function formatMoney(value: number) {
  return (value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function PrintDeliveryVarianceReportPage() {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-gray-400">Loading…</p>}>
      <ReportContent />
    </Suspense>
  );
}

function ReportContent() {
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  const [logs, setLogs] = useState<VDeliveryVarianceLog[]>([]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const supabase = createClient();
        let query = supabase
          .from("v_delivery_variance_logs")
          .select("*")
          .order("log_date", { ascending: true });
        if (from) query = query.gte("log_date", from);
        if (to) query = query.lte("log_date", to);

        const [{ data, error }, logo] = await Promise.all([
          query,
          getAppSetting(LOGO_SETTING_KEY),
        ]);

        if (error) {
          setErrorMsg("Could not load the report.");
          return;
        }
        setLogs((data ?? []) as VDeliveryVarianceLog[]);
        setLogoUrl(logo);
      } catch {
        setErrorMsg("Could not load the report.");
      } finally {
        setLoading(false);
      }
    })();
  }, [from, to]);

  const reasonBreakdown = useMemo(() => {
    const map = new Map<string, { label: string; type: string; count: number }>();
    logs.forEach((l) => {
      if (!l.reason_id || !l.reason_label) return;
      const existing = map.get(l.reason_id);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(l.reason_id, {
          label: l.reason_label,
          type: l.reason_type ?? "",
          count: 1,
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [logs]);

  const totals = useMemo(() => {
    const discrepancy = logs.filter((l) => l.reason_type === "DISCREPANCY").length;
    const backload = logs.filter((l) => l.reason_type === "BACKLOAD").length;
    const totalAmount = logs.reduce((sum, l) => sum + (l.total_amount ?? 0), 0);
    return { count: logs.length, discrepancy, backload, totalAmount };
  }, [logs]);

  if (loading) {
    return <p className="p-8 text-sm text-gray-400">Loading…</p>;
  }

  return (
    <div>
      <div className="no-print mb-4 flex justify-end">
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div className="printable-area mx-auto max-w-4xl rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-800">
        <div className="flex items-center justify-between border-b border-gray-300 pb-4">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Dynamic88 logo" className="h-14 w-auto" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-brand-600 text-lg font-bold text-white">
                D88
              </div>
            )}
            <div>
              <p className="text-base font-bold text-gray-900">Dynamic88 Solutions</p>
              <p className="text-xs text-gray-500">Mondial Portal — Delivery Variance Log Report</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-gray-500">Period Covered</p>
            <p className="font-semibold">
              {from ? new Date(from).toLocaleDateString() : "…"} –{" "}
              {to ? new Date(to).toLocaleDateString() : "…"}
            </p>
          </div>
        </div>

        {errorMsg && <p className="mt-4 text-sm text-red-600">{errorMsg}</p>}

        <div className="mt-4 grid grid-cols-4 gap-4 text-center">
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-2xl font-bold text-brand-700">{totals.count}</p>
            <p className="text-xs text-gray-500">Total Logs</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-2xl font-bold text-amber-600">{totals.discrepancy}</p>
            <p className="text-xs text-gray-500">Discrepancies</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-2xl font-bold text-red-600">{totals.backload}</p>
            <p className="text-xs text-gray-500">Backloads</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-2xl font-bold text-gray-800">{formatMoney(totals.totalAmount)}</p>
            <p className="text-xs text-gray-500">Total Variance Amount</p>
          </div>
        </div>

        {reasonBreakdown.length > 0 && (
          <div className="mt-6">
            <p className="text-xs uppercase tracking-wide text-gray-500">
              Reason Breakdown (most frequent first)
            </p>
            <table className="mt-2 w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-t border-gray-300 bg-gray-50 text-left uppercase text-gray-500">
                  <th className="py-1.5 pl-2">Reason</th>
                  <th className="py-1.5">Type</th>
                  <th className="py-1.5 pr-2">Occurrences</th>
                </tr>
              </thead>
              <tbody>
                {reasonBreakdown.map((r) => (
                  <tr key={r.label} className="border-b border-gray-200">
                    <td className="py-1.5 pl-2">{r.label}</td>
                    <td className="py-1.5">{r.type.replace("_", " ")}</td>
                    <td className="py-1.5 pr-2">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6">
          <p className="text-xs uppercase tracking-wide text-gray-500">Logs</p>
          <table className="mt-2 w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-t border-gray-300 bg-gray-50 text-left uppercase text-gray-500">
                <th className="py-1.5 pl-2">Series #</th>
                <th className="py-1.5">Document No.</th>
                <th className="py-1.5">Retail Chain</th>
                <th className="py-1.5">Reason</th>
                <th className="py-1.5">Backload/Discrepancy Date</th>
                <th className="py-1.5">Items</th>
                <th className="py-1.5 pr-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-gray-200">
                  <td className="py-1.5 pl-2">{l.series_no}</td>
                  <td className="py-1.5">{l.document_no ?? "—"}</td>
                  <td className="py-1.5">{l.retail_chain ?? "—"}</td>
                  <td className="py-1.5">{l.reason_label ?? "—"}</td>
                  <td className="py-1.5">
                    {l.log_date ? new Date(l.log_date).toLocaleDateString() : "—"}
                  </td>
                  <td className="py-1.5">{l.item_count}</td>
                  <td className="py-1.5 pr-2">{formatMoney(l.total_amount)}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-3 text-center text-gray-400">
                    No delivery variance logs in this date range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-x-8 gap-y-10">
          <div>
            <div className="border-t border-gray-400 pt-1">
              <p className="text-xs text-gray-500">Prepared By</p>
            </div>
          </div>
          <div>
            <div className="border-t border-gray-400 pt-1">
              <p className="text-xs text-gray-500">Checked By</p>
            </div>
          </div>
          <div>
            <div className="border-t border-gray-400 pt-1">
              <p className="text-xs text-gray-500">Received By</p>
            </div>
          </div>
          <div>
            <div className="border-t border-gray-400 pt-1">
              <p className="text-xs text-gray-500">Received By</p>
            </div>
          </div>
        </div>

        <p className="mt-8 text-center text-[10px] text-gray-400">
          Generated {new Date().toLocaleString()} · Dynamic88 Solutions
        </p>
      </div>
    </div>
  );
}

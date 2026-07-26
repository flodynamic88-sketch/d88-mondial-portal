"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getAppSetting, LOGO_SETTING_KEY } from "@/lib/appSettings";
import type { VDeliveryVarianceLog, DeliveryVarianceLogItem } from "@/types/database";

function formatMoney(value: number) {
  return (value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const RETURNED_STATUS_LABELS: Record<string, string> = {
  RETURNED: "Returned",
  NOT_RETURNED: "Not Returned",
  PARTIAL: "Partial",
};

export default function PrintDeliveryVarianceLogPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";

  const [log, setLog] = useState<VDeliveryVarianceLog | null>(null);
  const [items, setItems] = useState<DeliveryVarianceLogItem[]>([]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const supabase = createClient();
        const [{ data: logData, error: logErr }, { data: itemData }, logo] = await Promise.all([
          supabase.from("v_delivery_variance_logs").select("*").eq("id", id).maybeSingle(),
          supabase
            .from("delivery_variance_log_items")
            .select("*")
            .eq("log_id", id)
            .order("created_at", { ascending: true }),
          getAppSetting(LOGO_SETTING_KEY),
        ]);

        if (logErr || !logData) {
          setErrorMsg("Could not load this delivery variance log.");
          return;
        }

        setLog(logData as VDeliveryVarianceLog);
        setItems((itemData ?? []) as DeliveryVarianceLogItem[]);
        setLogoUrl(logo);
      } catch {
        setErrorMsg("Could not load this delivery variance log.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const totalAmount = items.reduce((sum, item) => sum + (item.amount ?? 0), 0);

  if (loading) {
    return <p className="p-8 text-sm text-gray-400">Loading…</p>;
  }

  if (errorMsg || !log) {
    return <p className="p-8 text-sm text-gray-400">{errorMsg ?? "Log not found."}</p>;
  }

  return (
    <div>
      <div className="no-print mb-4 flex justify-end">
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div className="printable-area mx-auto max-w-3xl rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-800">
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
              <p className="text-xs text-gray-500">Mondial Portal — Delivery Variance Log</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-gray-500">Series No.</p>
            <p className="text-lg font-bold text-brand-700">{log.series_no}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Document No.</p>
            <p className="font-medium">{log.document_no ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Log Date</p>
            <p className="font-medium">
              {log.log_date ? new Date(log.log_date).toLocaleDateString() : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Retail Chain</p>
            <p className="font-medium">{log.retail_chain ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">
              {log.reason_type === "BACKLOAD" ? "Backload Reason" : "Discrepancy Reason"}
            </p>
            <p className="font-medium">{log.reason_label ?? "—"}</p>
          </div>
          <div className="col-span-2">
            <p className="text-xs uppercase tracking-wide text-gray-500">Store/Branch Address</p>
            <p className="font-medium">{log.branch_address ?? "—"}</p>
          </div>
        </div>

        <table className="mt-6 w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-t border-gray-300 bg-gray-50 text-left uppercase text-gray-500">
              <th className="py-2 pl-2">Item Description</th>
              <th className="py-2">Qty</th>
              <th className="py-2">Unit</th>
              <th className="py-2">Unit Price</th>
              <th className="py-2">Amount</th>
              <th className="py-2">Returned Status</th>
              <th className="py-2 pr-2">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-gray-200">
                <td className="py-2 pl-2">{item.item_description}</td>
                <td className="py-2">{item.qty}</td>
                <td className="py-2">{item.unit ?? "—"}</td>
                <td className="py-2">{formatMoney(item.unit_price)}</td>
                <td className="py-2">{formatMoney(item.amount)}</td>
                <td className="py-2">
                  {RETURNED_STATUS_LABELS[item.returned_status] ?? item.returned_status}
                </td>
                <td className="py-2 pr-2">{item.remarks ?? "—"}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="py-3 text-center text-gray-400">
                  No items recorded.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="py-2 pl-2 text-right font-semibold">
                Total
              </td>
              <td colSpan={3} className="py-2 font-semibold">
                {formatMoney(totalAmount)}
              </td>
            </tr>
          </tfoot>
        </table>

        {log.remarks && (
          <div className="mt-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Overall Remarks</p>
            <p className="mt-1">{log.remarks}</p>
          </div>
        )}

        <div className="mt-12 grid grid-cols-2 gap-x-8 gap-y-10">
          <div>
            <div className="border-t border-gray-400 pt-1">
              <p className="font-medium">{log.prepared_by || " "}</p>
              <p className="text-xs text-gray-500">Prepared By</p>
            </div>
          </div>
          <div>
            <div className="border-t border-gray-400 pt-1">
              <p className="font-medium">{log.checked_by || " "}</p>
              <p className="text-xs text-gray-500">Checked By</p>
            </div>
          </div>
          <div>
            <div className="border-t border-gray-400 pt-1">
              <p className="font-medium">{log.received_by_1 || " "}</p>
              <p className="text-xs text-gray-500">Received By</p>
            </div>
          </div>
          <div>
            <div className="border-t border-gray-400 pt-1">
              <p className="font-medium">{log.received_by_2 || " "}</p>
              <p className="text-xs text-gray-500">Received By</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

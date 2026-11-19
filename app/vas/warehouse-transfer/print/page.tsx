"use client";

/**
 * Print-only Warehouse Transfer / Receiving Slip.
 *
 * Reached from the "Slip" link on app/(app)/vas/warehouse-transfer/page.tsx
 * for a single transfer row (?id=<warehouse_transfers.id>). Handed to the
 * Warehouse at the moment finished bundles are physically endorsed to them,
 * for them to sign as proof of receipt.
 *
 * Deliberately placed OUTSIDE the (app) route group -- same convention as
 * app/mercury/dispatch/print, app/deliveries/[id]/print, and
 * app/stock-requests/[id]/print -- so the shared app shell never renders on
 * the printed page.
 *
 * Each related record (batch -> memo item -> kit BOM -> memo / finished
 * item) is fetched as its own step rather than one deep PostgREST embed --
 * same lesson noted on the Dispatch print page: a schema-cache hiccup on any
 * one relationship in a single embedded query would otherwise fail the
 * whole fetch instead of just that one field.
 */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/vas/supabase/client";
import type { VasItem, VasKitBom, VasMemo, VasMemoItem, VasProductionBatch, VasWarehouseTransfer } from "@/lib/vas/types";

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
}

function WarehouseTransferPrintContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") || "";

  const [transfer, setTransfer] = useState<VasWarehouseTransfer | null>(null);
  const [batch, setBatch] = useState<VasProductionBatch | null>(null);
  const [memoItem, setMemoItem] = useState<VasMemoItem | null>(null);
  const [kit, setKit] = useState<VasKitBom | null>(null);
  const [memo, setMemo] = useState<VasMemo | null>(null);
  const [finishedItem, setFinishedItem] = useState<VasItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    const supabase = createClient();
    async function load() {
      const { data: t, error: tErr } = await supabase
        .schema("vas").from("warehouse_transfers").select("*").eq("id", id).maybeSingle();
      if (tErr) {
        setError(tErr.message);
        setLoading(false);
        return;
      }
      setTransfer(t as VasWarehouseTransfer);
      if (!t) {
        setLoading(false);
        return;
      }

      const { data: b } = await supabase
        .schema("vas").from("production_batches").select("*").eq("id", t.batch_id).maybeSingle();
      setBatch((b as VasProductionBatch) || null);
      if (!b) {
        setLoading(false);
        return;
      }

      const { data: mi } = await supabase
        .schema("vas").from("memo_items").select("*").eq("id", b.memo_item_id).maybeSingle();
      setMemoItem((mi as VasMemoItem) || null);
      if (!mi) {
        setLoading(false);
        return;
      }

      const [kitRes, memoRes] = await Promise.all([
        supabase.schema("vas").from("kit_boms").select("*").eq("id", mi.kit_bom_id).maybeSingle(),
        supabase.schema("vas").from("memos").select("*").eq("id", mi.memo_id).maybeSingle(),
      ]);
      const k = (kitRes.data as VasKitBom) || null;
      setKit(k);
      setMemo((memoRes.data as VasMemo) || null);

      if (k) {
        const { data: fi } = await supabase
          .schema("vas").from("items").select("*").eq("id", k.finished_item_id).maybeSingle();
        setFinishedItem((fi as VasItem) || null);
      }

      setLoading(false);
    }
    load();
  }, [id]);

  if (!id) {
    return <div className="p-8 text-sm text-red-600">No transfer selected.</div>;
  }
  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>;
  if (!transfer) return <div className="p-8 text-sm text-red-600">Transfer not found.</div>;

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
                WAREHOUSE TRANSFER SLIP
              </div>
              <div className="text-[11px] font-semibold uppercase text-gray-500 mt-1">
                Date Printed
              </div>
              <div className="text-base font-semibold text-gray-900">
                {formatDate(new Date().toISOString())}
              </div>
            </div>
          </div>

          {/* Transfer details */}
          <div className="mb-6 rounded-md border border-gray-200 p-4">
            <div className="text-[11px] font-semibold uppercase text-gray-400 mb-2">Transfer Details</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-gray-500">Transfer Date</span>
                <span className="font-medium">{formatDate(transfer.transfer_date)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-gray-500">Batch No.</span>
                <span className="font-medium">{batch?.batch_no ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-gray-500">TSP No.</span>
                <span className="font-medium">{memo?.memo_no ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-gray-500">Client</span>
                <span className="font-medium">{memo?.client_name ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-gray-500">Kit No.</span>
                <span className="font-medium">{kit?.kit_no ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-gray-500">UOM</span>
                <span className="font-medium">{finishedItem?.uom ?? "—"}</span>
              </div>
            </div>
          </div>

          {/* Item / qty */}
          <div className="mb-6">
            <div className="text-[11px] font-semibold uppercase text-gray-400 mb-2">Finished Bundle Transferred</div>
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-brand-light text-brand-dark">
                  <th className="py-2 px-3 rounded-l-md font-semibold text-xs uppercase">Item Code</th>
                  <th className="py-2 px-3 font-semibold text-xs uppercase">Description</th>
                  <th className="py-2 px-3 text-right font-semibold text-xs uppercase rounded-r-md">
                    Qty Transferred
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-2 px-3 border-b border-gray-100">{finishedItem?.item_code ?? "—"}</td>
                  <td className="py-2 px-3 border-b border-gray-100">{finishedItem?.item_description ?? "—"}</td>
                  <td className="py-2 px-3 border-b border-gray-100 text-right font-semibold">
                    {transfer.qty_transferred}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {transfer.remarks && (
            <div className="mb-6 text-sm">
              <span className="text-[11px] font-semibold uppercase text-gray-400 mr-2">Remarks</span>
              {transfer.remarks}
            </div>
          )}

          {/* Signature block */}
          <div className="mt-12 grid grid-cols-2 gap-8 text-xs">
            <div className="flex flex-col justify-end">
              <div className="text-sm font-medium text-gray-800">{transfer.endorsed_by || " "}</div>
              <div className="border-t border-gray-300 pt-1 mt-1 text-gray-500">
                Endorsed By (VAS) / Date
              </div>
            </div>
            <div className="flex flex-col justify-end">
              <div className="text-sm font-medium text-gray-800">{transfer.received_by || " "}</div>
              <div className="border-t border-gray-300 pt-1 mt-1 text-gray-500">
                Received By (Warehouse) / Date
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WarehouseTransferPrintPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading…</div>}>
      <WarehouseTransferPrintContent />
    </Suspense>
  );
}

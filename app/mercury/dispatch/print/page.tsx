"use client";

/**
 * Print-only Dispatch Picking Summary.
 *
 * Reached from the "For Dispatch" tab (app/(app)/dispatch/page.tsx) after
 * warehouse staff select one or more Pending/In-Transit deliveries and click
 * "Generate Picking Summary". The selected delivery ids arrive via the
 * ?ids=id1,id2,id3 query string.
 *
 * This is a pure per-item aggregate (not a per-delivery/branch breakdown, per
 * the client's explicit preference): every line across every selected
 * delivery is grouped by item + expiration date and summed, so staff can see
 * at a glance the total qty of each item/batch they need to pull from stock.
 *
 * Deliberately placed OUTSIDE the (app) route group — same as
 * app/deliveries/[id]/print and app/stock-requests/[id]/print — so the
 * shared app shell never renders on the printed page.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
}

interface DeliveryLineForSummary {
  id: string;
  delivery_header_id: string;
  item_id: string | null;
  item_description: string;
  qty: number;
  expiration_date: string | null;
  items?: {
    id: string;
    item_code: string;
    mercury_item_code: string | null;
    item_description: string;
    unit: string | null;
  } | null;
  delivery_line_batches?: { id: string; qty: number; expiration_date: string | null }[];
}

interface DeliveryHeaderMini {
  id: string;
  invoice_number: string | null;
  po_number: string | null;
  status: string;
  client_name?: string;
  branch_name?: string;
}

interface SummaryRow {
  key: string;
  itemCode: string;
  description: string;
  unit: string | null;
  totalQty: number;
  expirationDate: string | null;
}

function DispatchPrintContent() {
  const searchParams = useSearchParams();
  const idsParam = searchParams.get("ids") || "";
  const ids = useMemo(
    () => idsParam.split(",").map((s) => s.trim()).filter(Boolean),
    [idsParam]
  );

  const [headers, setHeaders] = useState<DeliveryHeaderMini[]>([]);
  const [lines, setLines] = useState<DeliveryLineForSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ids.length === 0) {
      setLoading(false);
      return;
    }
    const supabase = createClient();
    async function load() {
      // delivery_line_batches is deliberately fetched as its OWN query and
      // merged in JS below, instead of being embedded directly in the
      // delivery_lines select — embedding it here would mean a PostgREST
      // schema-cache hiccup on that one relationship silently fails the
      // WHOLE delivery_lines fetch, making every item look like it has no
      // qty at all (the exact bug already hit once before on the Delivery
      // detail page — see the comment there).
      const [headersRes, linesRes] = await Promise.all([
        supabase
          .schema("flo").from("v_delivery_headers_full")
          .select("id, invoice_number, po_number, status, client_name, branch_name")
          .in("id", ids),
        supabase
          .schema("flo").from("delivery_lines")
          .select(
            "id, delivery_header_id, item_id, item_description, qty, expiration_date, items(id, item_code, mercury_item_code, item_description, unit)"
          )
          .in("delivery_header_id", ids),
      ]);

      const firstError = headersRes.error || linesRes.error;
      if (firstError) setError(firstError.message);

      setHeaders((headersRes.data as unknown as DeliveryHeaderMini[]) || []);
      const lineRows = (linesRes.data as unknown as DeliveryLineForSummary[]) || [];

      if (lineRows.length > 0) {
        const { data: batchesData, error: batchesErr } = await supabase
          .schema("flo").from("delivery_line_batches")
          .select("id, delivery_line_id, qty, expiration_date")
          .in(
            "delivery_line_id",
            lineRows.map((l) => l.id)
          );
        // A batches-fetch problem is non-fatal — it only means expiration
        // dates fall back to the FEFO preview / are blank; it must never
        // blank out the qty rows themselves.
        if (!batchesErr && batchesData) {
          const byLine = new Map<string, typeof batchesData>();
          for (const b of batchesData) {
            const arr = byLine.get(b.delivery_line_id) || [];
            arr.push(b);
            byLine.set(b.delivery_line_id, arr);
          }
          for (const l of lineRows) {
            l.delivery_line_batches =
              (byLine.get(l.id) as unknown as DeliveryLineForSummary["delivery_line_batches"]) || [];
          }
        }
      }

      setLines(lineRows);
      setLoading(false);
    }
    load();
  }, [ids]);

  const summary = useMemo(() => {
    const map = new Map<string, SummaryRow>();
    for (const l of lines) {
      // Prefer the line's own (manually entered / FEFO auto-filled)
      // expiration date — it's the explicit, confirmed value. Fall back to
      // whatever batch(es) the DB has already assigned, if any.
      const expiration =
        l.expiration_date || l.delivery_line_batches?.[0]?.expiration_date || null;
      const itemCode = l.items?.mercury_item_code || l.items?.item_code || "—";
      const description = l.item_description || l.items?.item_description || "";
      const key = `${l.item_id || description}::${expiration || ""}`;
      const existing = map.get(key);
      if (existing) {
        existing.totalQty += l.qty || 0;
      } else {
        map.set(key, {
          key,
          itemCode,
          description,
          unit: l.items?.unit || null,
          totalQty: l.qty || 0,
          expirationDate: expiration,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.itemCode !== b.itemCode) return a.itemCode.localeCompare(b.itemCode);
      const ad = a.expirationDate || "9999-12-31";
      const bd = b.expirationDate || "9999-12-31";
      return ad.localeCompare(bd);
    });
  }, [lines]);

  const totalQtyAll = useMemo(
    () => summary.reduce((s, r) => s + r.totalQty, 0),
    [summary]
  );

  // Per-invoice breakdown — same lines, grouped by delivery instead of
  // collapsed across all of them, so staff can still cross-check against a
  // single invoice/PO if needed, on top of the overall pull total below.
  const linesByDelivery = useMemo(() => {
    const map = new Map<string, DeliveryLineForSummary[]>();
    for (const l of lines) {
      const arr = map.get(l.delivery_header_id) || [];
      arr.push(l);
      map.set(l.delivery_header_id, arr);
    }
    return map;
  }, [lines]);

  function lineExpiration(l: DeliveryLineForSummary) {
    return l.expiration_date || l.delivery_line_batches?.[0]?.expiration_date || null;
  }

  if (ids.length === 0) {
    return <div className="p-8 text-sm text-red-600">No deliveries selected.</div>;
  }
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
                  FLO Division — Flexible Logistics Operations
                </div>
                <div className="text-xs text-gray-500 mt-1 max-w-xs">
                  M2 Southwood Industrial Park Governor&apos;s Drive Brgy. Mabuhay Carmona, Cavite
                </div>
              </div>
            </div>
            <div className="shrink-0 rounded-lg border border-brand-light bg-brand-light px-5 py-3 text-right">
              <div className="text-lg font-bold tracking-wide text-brand-dark">
                DISPATCH PICKING SUMMARY
              </div>
              <div className="text-[11px] font-semibold uppercase text-gray-500 mt-1">
                Date Printed
              </div>
              <div className="text-base font-semibold text-gray-900">
                {formatDate(new Date().toISOString())}
              </div>
            </div>
          </div>

          {/* Covered deliveries */}
          <div className="mb-6 rounded-md border border-gray-200 p-4">
            <div className="text-[11px] font-semibold uppercase text-gray-400 mb-2">
              Deliveries Covered ({headers.length})
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {headers.map((h) => (
                <div key={h.id} className="flex justify-between gap-2">
                  <span className="font-medium">
                    {h.invoice_number || h.po_number || h.id.slice(0, 8)}
                  </span>
                  <span className="text-gray-500 text-right">
                    {h.client_name}
                    {h.branch_name ? ` — ${h.branch_name}` : ""} ({h.status})
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Itemized breakdown per invoice — same line items as the overall
              total below, but grouped per delivery so staff have a per-invoice
              reference on top of the combined pull quantity. */}
          <div className="mb-6">
            <div className="text-[11px] font-semibold uppercase text-gray-400 mb-2">
              Itemized by Invoice
            </div>
            <div className="space-y-3">
              {headers.map((h) => {
                const hLines = (linesByDelivery.get(h.id) || [])
                  .slice()
                  .sort((a, b) => {
                    const ac = a.items?.mercury_item_code || a.items?.item_code || "";
                    const bc = b.items?.mercury_item_code || b.items?.item_code || "";
                    return ac.localeCompare(bc);
                  });
                const hTotal = hLines.reduce((s, l) => s + (l.qty || 0), 0);
                return (
                  <div key={h.id} className="avoid-break rounded-md border border-gray-200 overflow-hidden">
                    <div className="flex items-center justify-between bg-gray-50 px-3 py-1.5 text-xs">
                      <span className="font-semibold text-gray-800">
                        {h.invoice_number || h.po_number || h.id.slice(0, 8)}
                      </span>
                      <span className="text-gray-500">
                        {h.client_name}
                        {h.branch_name ? ` — ${h.branch_name}` : ""} · {h.status}
                      </span>
                    </div>
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-gray-200 text-gray-500">
                          <th className="py-1 px-3 font-semibold uppercase text-[10px]">Item Code</th>
                          <th className="py-1 px-3 font-semibold uppercase text-[10px]">Description</th>
                          <th className="py-1 px-3 text-right font-semibold uppercase text-[10px]">
                            Qty
                          </th>
                          <th className="py-1 px-3 font-semibold uppercase text-[10px]">Unit</th>
                          <th className="py-1 px-3 font-semibold uppercase text-[10px]">
                            Expiration
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {hLines.map((l) => (
                          <tr key={l.id} className="border-b border-gray-100 last:border-b-0">
                            <td className="py-1 px-3">
                              {l.items?.mercury_item_code || l.items?.item_code || "—"}
                            </td>
                            <td className="py-1 px-3">
                              {l.item_description || l.items?.item_description || ""}
                            </td>
                            <td className="py-1 px-3 text-right font-medium">{l.qty}</td>
                            <td className="py-1 px-3">{l.items?.unit || "—"}</td>
                            <td className="py-1 px-3">{formatDate(lineExpiration(l))}</td>
                          </tr>
                        ))}
                        {hLines.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-2 px-3 text-center text-gray-400">
                              No line items.
                            </td>
                          </tr>
                        )}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-gray-200">
                          <td
                            colSpan={2}
                            className="py-1 px-3 text-right text-[10px] font-semibold uppercase text-gray-400"
                          >
                            Subtotal
                          </td>
                          <td className="py-1 px-3 text-right font-semibold">{hTotal}</td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Overall total — same items collapsed/summed across every
              selected invoice, for the combined stock-pull quantity. */}
          <div className="text-[11px] font-semibold uppercase text-gray-400 mb-2">
            Overall Total (All Invoices Combined)
          </div>
          <table className="w-full text-left border-collapse mb-2 text-sm">
            <thead>
              <tr className="bg-brand-light text-brand-dark">
                <th className="py-2 px-3 rounded-l-md font-semibold text-xs uppercase">Item Code</th>
                <th className="py-2 px-3 font-semibold text-xs uppercase">Description</th>
                <th className="py-2 px-3 text-right font-semibold text-xs uppercase">Total Qty</th>
                <th className="py-2 px-3 font-semibold text-xs uppercase">Unit</th>
                <th className="py-2 px-3 rounded-r-md font-semibold text-xs uppercase">
                  Expiration Date
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.map((r, idx) => (
                <tr key={r.key} className={idx % 2 === 1 ? "bg-gray-50" : ""}>
                  <td className="py-2 px-3 border-b border-gray-100">{r.itemCode}</td>
                  <td className="py-2 px-3 border-b border-gray-100">{r.description}</td>
                  <td className="py-2 px-3 border-b border-gray-100 text-right font-semibold">
                    {r.totalQty}
                  </td>
                  <td className="py-2 px-3 border-b border-gray-100">{r.unit || "—"}</td>
                  <td className="py-2 px-3 border-b border-gray-100">
                    {formatDate(r.expirationDate)}
                  </td>
                </tr>
              ))}
              {summary.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 px-3 text-center text-gray-400">
                    No line items found for the selected deliveries.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="flex justify-end pr-3 mb-6">
            <div className="text-sm">
              <span className="text-xs font-semibold uppercase text-gray-400 mr-3">
                Total Qty (All Items)
              </span>
              <span className="font-semibold">{totalQtyAll}</span>
            </div>
          </div>

          {/* Signature block */}
          <div className="mt-12 grid grid-cols-2 gap-8 text-xs">
            <div className="flex flex-col justify-end">
              <div>&nbsp;</div>
              <div className="border-t border-gray-300 pt-1 mt-1 text-gray-500">
                Pulled By / Date
              </div>
            </div>
            <div className="flex flex-col justify-end">
              <div>&nbsp;</div>
              <div className="border-t border-gray-300 pt-1 mt-1 text-gray-500">
                Checked By / Date
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DispatchPrintPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading…</div>}>
      <DispatchPrintContent />
    </Suspense>
  );
}

"use client";

/**
 * Print-only Purchase Order route for the Stock Requests module.
 *
 * This is a request WE send TO a client (the client acts as our supplier in
 * this direction) asking them to prepare a given quantity of items for us to
 * pick up. It carries no pricing. Internally this feature is called "Stock
 * Requests" (routes, DB tables), but the printed document itself is titled
 * "PURCHASE ORDER" with the request number used as the document's series
 * number, matching the paper form the company already uses when requesting
 * stock from clients.
 *
 * Deliberately placed OUTSIDE the (app) route group — same as
 * app/deliveries/[id]/print and app/billing/soa|statement — so the shared
 * app shell (topbar, sidebar, logout button) never renders on the printed
 * page.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { StockRequestLine } from "@/lib/mercury/types";

function formatDate(d: string | null | undefined) {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
}

interface RequestHeaderJoined {
  id: string;
  request_number: string;
  request_date: string | null;
  delivery_date_requested: string | null;
  delivery_schedule_note: string | null;
  status: string;
  notes: string | null;
  clients?: { id: string; client_code: string; client_name: string; billing_address?: string | null } | null;
}

export default function PrintStockRequestPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [header, setHeader] = useState<RequestHeaderJoined | null>(null);
  const [lines, setLines] = useState<StockRequestLine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const [headerRes, linesRes] = await Promise.all([
        supabase
          .schema("flo").from("stock_requests")
          .select("*, clients(id, client_code, client_name, billing_address)")
          .eq("id", id)
          .single(),
        supabase
          .schema("flo").from("stock_request_lines")
          .select("*, items(id, item_code, item_description, unit)")
          .eq("request_id", id)
          .order("created_at"),
      ]);
      setHeader((headerRes.data as unknown as RequestHeaderJoined) || null);
      setLines((linesRes.data as unknown as StockRequestLine[]) || []);
      setLoading(false);
    }
    load();
  }, [id]);

  const totalQty = useMemo(() => lines.reduce((s, l) => s + (l.qty || 0), 0), [lines]);

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>;
  if (!header) return <div className="p-8 text-sm text-red-600">Purchase Order not found.</div>;

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
        <button className="btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div className="max-w-3xl mx-auto bg-white text-gray-900">
        {/* Accent bar */}
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
              <div className="text-lg font-bold tracking-wide text-brand-dark">PURCHASE ORDER</div>
              <div className="text-[11px] font-semibold uppercase text-gray-500 mt-1">Series No.</div>
              <div className="text-base font-semibold text-gray-900">{header.request_number}</div>
            </div>
          </div>

          {/* Supplier + Order details */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="rounded-md border border-gray-200 p-4">
              <div className="text-[11px] font-semibold uppercase text-gray-400 mb-1">Supplier</div>
              <div className="font-semibold text-gray-900">{header.clients?.client_name}</div>
              {header.clients?.billing_address && (
                <div className="text-xs text-gray-500 mt-0.5">{header.clients.billing_address}</div>
              )}
            </div>
            <div className="rounded-md border border-gray-200 p-4 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-[11px] font-semibold uppercase text-gray-400 self-center">Date</span>
                <span className="font-medium">{formatDate(header.request_date)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[11px] font-semibold uppercase text-gray-400 self-center">
                  Delivery Date Requested
                </span>
                <span className="font-medium">{header.delivery_date_requested || "—"}</span>
              </div>
              {header.delivery_schedule_note && (
                <div className="flex justify-between text-sm gap-3">
                  <span className="text-[11px] font-semibold uppercase text-gray-400 self-center whitespace-nowrap">
                    Delivery Schedule
                  </span>
                  <span className="font-medium text-right">{header.delivery_schedule_note}</span>
                </div>
              )}
            </div>
          </div>

          {/* Item table */}
          <table className="w-full text-left border-collapse mb-2 text-sm">
            <thead>
              <tr className="bg-brand-light text-brand-dark">
                <th className="py-2 px-3 rounded-l-md font-semibold text-xs uppercase">Item Code</th>
                <th className="py-2 px-3 font-semibold text-xs uppercase">Particular</th>
                <th className="py-2 px-3 text-right font-semibold text-xs uppercase">Qty</th>
                <th className="py-2 px-3 rounded-r-md font-semibold text-xs uppercase">Unit</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={l.id} className={idx % 2 === 1 ? "bg-gray-50" : ""}>
                  <td className="py-2 px-3 border-b border-gray-100">{l.items?.item_code || "—"}</td>
                  <td className="py-2 px-3 border-b border-gray-100">{l.item_description}</td>
                  <td className="py-2 px-3 border-b border-gray-100 text-right">{l.qty}</td>
                  <td className="py-2 px-3 border-b border-gray-100">{l.unit || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end pr-3 mb-6">
            <div className="text-sm">
              <span className="text-xs font-semibold uppercase text-gray-400 mr-3">Total Qty</span>
              <span className="font-semibold">{totalQty}</span>
            </div>
          </div>

          {header.notes && (
            <div className="mb-6 rounded-md border border-gray-200 p-4">
              <div className="text-[11px] font-semibold uppercase text-gray-400 mb-1">Notes</div>
              <div className="text-sm">{header.notes}</div>
            </div>
          )}

          {/* Signature block */}
          <div className="mt-12 grid grid-cols-2 gap-8 text-xs">
            <div className="flex flex-col justify-end">
              <div className="font-medium text-sm">Reymar Gapud</div>
              <div className="border-t border-gray-300 pt-1 mt-1 text-gray-500">
                Prepared By — Logistics Manager
              </div>
            </div>
            <div className="flex flex-col justify-end">
              <div>&nbsp;</div>
              <div className="border-t border-gray-300 pt-1 mt-1 text-gray-500">Received By / Date</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

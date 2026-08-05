"use client";

/**
 * Inventory Count Sheet -- printable, clean/simple blank tally sheet.
 *
 * Opened via /store-visits/count-sheet/print?branchName=xxx&date=2026-07-31
 *
 * 2026-07-31: combined ALL active clients onto a SINGLE Letter-size sheet
 * (8.5in x 11in, 0.5in margins) instead of one sheet per client, per
 * request to save even more on printing. The shared visit info (Store /
 * Branch, Date, Sales Coordinator, Time In/Out) and the reminder note are
 * printed ONCE at the top; each client then gets its own compact card
 * (client name + item table) laid out in a 2-column grid so the 4 current
 * clients fit as 2 rows x 2 columns on one page. Item catalog is pulled
 * live from Supabase so it always reflects the current active items,
 * instead of being hardcoded.
 *
 * The Qty column is intentionally left blank for hand-writing during the
 * store visit -- write "0" if a SKU has zero stock on the shelf rather
 * than leaving the row blank, so the count can later be encoded as an
 * explicit zero (matching the mobile form / submit_store_visit fix that
 * now records zero-qty lines instead of silently dropping them).
 */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, Item } from "@/lib/mercury/types";

function formatDate(d: string | null | undefined) {
  if (!d) return "";
  const dt = new Date(`${d}T00:00:00`);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
}

function CountSheetContent() {
  const searchParams = useSearchParams();
  const branchName = searchParams.get("branchName") || "";
  const visitDate = searchParams.get("date") || "";

  const [clients, setClients] = useState<Client[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [{ data: clientRows }, { data: itemRows }] = await Promise.all([
        supabase.schema("flo").from("clients").select("*").eq("status", "Active").order("client_code"),
        supabase.schema("flo").from("items").select("*").eq("status", "Active").order("item_code"),
      ]);
      setClients((clientRows as Client[]) || []);
      setItems((itemRows as Item[]) || []);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>;

  const clientsWithItems = clients.filter(
    (c) => items.filter((i) => i.client_id === c.id).length > 0
  );

  return (
    <div>
      <style jsx global>{`
        @page {
          size: 8.5in 11in;
          margin: 0.4in;
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

      <div className="max-w-4xl mx-auto bg-white p-6 text-gray-900" style={{ fontSize: "10.5px" }}>
        {/* Letterhead */}
        <div className="flex items-center justify-between border-b-2 border-gray-800 pb-2 mb-3">
          <div className="flex items-center gap-2">
            <img src="/logo-full.png" alt="Dynamic88" className="h-7 w-auto" />
            <div>
              <div className="text-base font-bold tracking-tight leading-tight">
                Dynamic88 Solutions
              </div>
              <div className="text-[9px] text-gray-500 uppercase tracking-wider leading-tight">
                FLO Division — Field Inventory Monitoring
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold text-gray-800 leading-tight">
              Inventory Count Sheet
            </div>
            <div className="text-[9px] text-gray-500">All Clients — Combined</div>
          </div>
        </div>

        {/* Shared visit info -- once for the whole store visit */}
        <div className="grid grid-cols-4 gap-x-4 gap-y-1.5 mb-2 text-[10px]">
          <div className="flex items-baseline gap-1 col-span-2">
            <span className="text-[8.5px] uppercase tracking-wide text-gray-400 whitespace-nowrap">
              Store / Branch:
            </span>
            <span className="flex-1 border-b border-gray-400 pb-0.5 font-medium">
              {branchName || " "}
            </span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-[8.5px] uppercase tracking-wide text-gray-400 whitespace-nowrap">
              Date:
            </span>
            <span className="flex-1 border-b border-gray-400 pb-0.5 font-medium">
              {formatDate(visitDate) || " "}
            </span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-[8.5px] uppercase tracking-wide text-gray-400 whitespace-nowrap">
              Time In / Out:
            </span>
            <span className="flex-1 border-b border-gray-400 pb-0.5">&nbsp;</span>
          </div>
          <div className="flex items-baseline gap-1 col-span-4">
            <span className="text-[8.5px] uppercase tracking-wide text-gray-400 whitespace-nowrap">
              Sales Coordinator:
            </span>
            <span className="flex-1 border-b border-gray-400 pb-0.5">&nbsp;</span>
          </div>
        </div>

        <div className="rounded bg-amber-50 border border-amber-200 px-2 py-1 text-[9px] text-amber-800 mb-3">
          Isulat ang aktwal na bilang kada item. Kung walang stock, isulat ang <strong>0</strong>{" "}
          -- huwag lang iiwanang blangko.
        </div>

        {/* Per-client cards, 2 columns so 4 clients = 2x2 grid on one sheet */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {clientsWithItems.map((client) => {
            const clientItems = items.filter((i) => i.client_id === client.id);
            return (
              <div key={client.id} className="border border-gray-300 rounded-md p-2">
                <div className="flex items-baseline justify-between border-b border-gray-300 pb-1 mb-1">
                  <div className="text-[10.5px] font-bold text-gray-800">
                    {client.client_name}
                  </div>
                  {client.vendor_code && (
                    <div className="text-[8.5px] text-gray-500">
                      Vendor Code: <span className="font-semibold text-gray-700">{client.vendor_code}</span>
                    </div>
                  )}
                </div>
                <table className="w-full text-left border-collapse text-[9.5px]">
                  <thead>
                    <tr className="border-b border-gray-600">
                      <th className="py-1 pr-1 w-[18%]">Code</th>
                      <th className="py-1 pr-1">Description</th>
                      <th className="py-1 pr-1 w-[12%]">Unit</th>
                      <th className="py-1 pl-1 w-[20%] text-center">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientItems.map((item) => (
                      <tr key={item.id} className="border-b border-gray-200">
                        <td className="py-1 pr-1 align-top">{item.item_code}</td>
                        <td className="py-1 pr-1 align-top">{item.item_description}</td>
                        <td className="py-1 pr-1 align-top">{item.unit || "—"}</td>
                        <td className="py-1 pl-1 align-top">
                          <div className="border-b border-gray-400 h-4 w-full" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>

        {clientsWithItems.length === 0 && (
          <div className="p-8 text-sm text-gray-500 text-center">
            Walang active na item na nakatalaga sa kahit anong client.
          </div>
        )}

        {/* Shared signature block -- once for the whole visit */}
        <div className="mt-6 grid grid-cols-2 gap-8 text-[9.5px]">
          <div className="flex flex-col justify-end">
            <div>&nbsp;</div>
            <div className="border-t border-gray-400 pt-1 mt-1">
              Signature over Printed Name — Sales Coordinator
            </div>
          </div>
          <div className="flex flex-col justify-end">
            <div>&nbsp;</div>
            <div className="border-t border-gray-400 pt-1 mt-1">
              Signature over Printed Name — Store Personnel (optional)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CountSheetPrintPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading…</div>}>
      <CountSheetContent />
    </Suspense>
  );
}

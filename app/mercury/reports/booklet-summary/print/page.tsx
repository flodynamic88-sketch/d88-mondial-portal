"use client";

/**
 * Booklet Summary — printable report.
 *
 * Opened via /reports/booklet-summary/print?clientId=xxx&start=43351&end=43400
 *
 * Clean, print-only table for one booklet's 50 invoice numbers — Invoice #,
 * Invoice Date, PO#, Branch, Address, Amount of Invoice — meant to be
 * printed and physically attached to the booklet once all slips are used.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { BookletInvoiceStatus, Client, DeliveryHeaderFull } from "@/lib/mercury/types";

function peso(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(n || 0);
}

function formatDate(d: string | null | undefined) {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
}

function parseInvoiceNumber(v: string | null | undefined): number | null {
  if (!v) return null;
  const digits = v.replace(/\D/g, "");
  if (!digits) return null;
  return parseInt(digits, 10);
}

function BookletSummaryPrintContent() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("clientId") || "";
  const start = parseInt(searchParams.get("start") || "", 10);
  const end = parseInt(searchParams.get("end") || "", 10);

  const [client, setClient] = useState<Client | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryHeaderFull[]>([]);
  const [cancelled, setCancelled] = useState<BookletInvoiceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!clientId || isNaN(start) || isNaN(end)) {
        setLoading(false);
        return;
      }
      const supabase = createClient();
      const [{ data: clientData, error: clientErr }, { data: dData, error: dErr }, { data: cData, error: cErr }] =
        await Promise.all([
          supabase.schema("flo").from("clients").select("*").eq("id", clientId).single(),
          supabase.schema("flo").from("v_delivery_headers_full").select("*").eq("client_id", clientId),
          supabase.schema("flo").from("booklet_invoice_status").select("*").eq("client_id", clientId),
        ]);
      if (clientErr) setError(clientErr.message);
      if (dErr) setError(dErr.message);
      if (cErr) setError(cErr.message);
      setClient((clientData as Client) || null);
      setDeliveries((dData as DeliveryHeaderFull[]) || []);
      setCancelled((cData as BookletInvoiceStatus[]) || []);
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, start, end]);

  const deliveryByNumber = useMemo(() => {
    const map = new Map<number, DeliveryHeaderFull>();
    for (const d of deliveries) {
      const n = parseInvoiceNumber(d.invoice_number);
      if (n != null) map.set(n, d);
    }
    return map;
  }, [deliveries]);

  const cancelledByNumber = useMemo(() => {
    const map = new Map<number, BookletInvoiceStatus>();
    for (const c of cancelled) map.set(c.invoice_number, c);
    return map;
  }, [cancelled]);

  const slips = useMemo(() => {
    if (isNaN(start) || isNaN(end)) return [];
    const list: number[] = [];
    for (let n = start; n <= end; n++) list.push(n);
    return list;
  }, [start, end]);

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>;
  if (error) return <div className="p-8 text-sm text-red-600">{error}</div>;
  if (slips.length === 0) return <div className="p-8 text-sm text-red-600">No booklet range specified.</div>;

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

      <div className="max-w-3xl mx-auto bg-white p-8 text-sm text-gray-900">
        <div className="flex items-center justify-between border-b border-gray-300 pb-4 mb-6">
          <div className="flex items-center gap-3">
            <img src="/logo-full.png" alt="Dynamic88" className="h-10 w-auto" />
            <div>
              <div className="text-lg font-bold">Dynamic88 Solutions — FLO Division</div>
              <div className="text-xs text-gray-500">Invoice Booklet Summary</div>
            </div>
          </div>
          <div className="text-right text-xs text-gray-500">
            <div>{client?.client_name}</div>
            <div>
              Booklet Range: {start} – {end}
            </div>
          </div>
        </div>

        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-gray-400">
              <th className="py-1">Invoice #</th>
              <th className="py-1">Invoice Date</th>
              <th className="py-1">PO#</th>
              <th className="py-1">Branch</th>
              <th className="py-1">Address</th>
              <th className="py-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {slips.map((n) => {
              const d = deliveryByNumber.get(n);
              const c = cancelledByNumber.get(n);
              return (
                <tr key={n} className="border-b border-gray-200">
                  <td className="py-1 font-medium">{n}</td>
                  {d ? (
                    <>
                      <td className="py-1">{formatDate(d.invoice_date)}</td>
                      <td className="py-1">{d.po_number}</td>
                      <td className="py-1">{d.branch_name}</td>
                      <td className="py-1">{d.branch_delivery_address}</td>
                      <td className="py-1 text-right">{peso(d.total_amount)}</td>
                    </>
                  ) : c ? (
                    <td className="py-1 text-gray-500 italic" colSpan={5}>
                      Cancelled
                    </td>
                  ) : (
                    <td className="py-1 text-gray-300" colSpan={5}>
                      &nbsp;
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-16 grid grid-cols-2 gap-8 text-xs">
          <div className="flex flex-col justify-end">
            <div className="font-medium">Reymar Gapud</div>
            <div className="border-t border-gray-400 pt-1 mt-1">Prepared By — Logistics Manager</div>
          </div>
          <div className="flex flex-col justify-end">
            <div>&nbsp;</div>
            <div className="border-t border-gray-400 pt-1 mt-1">Reconciled By / Date</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BookletSummaryPrintPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading…</div>}>
      <BookletSummaryPrintContent />
    </Suspense>
  );
}

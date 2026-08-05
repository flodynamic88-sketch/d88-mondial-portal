"use client";

/**
 * Print-only Billing Statement.
 *
 * Lists the delivered invoices selected on the Billing page for ONE client,
 * with the per-invoice service fee (invoice net amount x client's service
 * rate %) and a grand total. Opened via /billing/statement?ids=a,b,c
 */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, DeliveryHeaderFull } from "@/lib/mercury/types";

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

// Sort invoices in ascending numeric order (lowest to highest Invoice #) so
// the billing series stays sunod-sunod / maayos, regardless of Invoice Date.
function invoiceNumberValue(v: string | null | undefined): number | null {
  if (!v) return null;
  const digits = v.replace(/\D/g, "");
  if (!digits) return null;
  return parseInt(digits, 10);
}

function compareByInvoiceNumber(a: { invoice_number: string | null }, b: { invoice_number: string | null }) {
  const na = invoiceNumberValue(a.invoice_number);
  const nb = invoiceNumberValue(b.invoice_number);
  if (na !== null && nb !== null && na !== nb) return na - nb;
  return (a.invoice_number || "").localeCompare(b.invoice_number || "");
}

function BillingStatementContent() {
  const searchParams = useSearchParams();
  const idsParam = searchParams.get("ids") || "";
  const ids = idsParam.split(",").filter(Boolean);

  const [rows, setRows] = useState<DeliveryHeaderFull[]>([]);
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (ids.length === 0) {
        setLoading(false);
        return;
      }
      const supabase = createClient();
      const { data, error } = await supabase
        .schema("flo").from("v_delivery_headers_full")
        .select("*")
        .in("id", ids);
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      const list = ((data as DeliveryHeaderFull[]) || []).slice().sort(compareByInvoiceNumber);
      setRows(list);
      const clientId = list[0]?.client_id;
      if (clientId) {
        const { data: clientData } = await supabase
          .schema("flo").from("clients")
          .select("*")
          .eq("id", clientId)
          .single();
        setClient((clientData as Client) || null);
      }
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsParam]);

  const totalNet = rows.reduce((s, r) => s + (r.total_net_amount || 0), 0);
  const totalFee = rows.reduce((s, r) => s + (r.service_fee_amount || 0), 0);

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>;
  if (error) return <div className="p-8 text-sm text-red-600">{error}</div>;
  if (rows.length === 0) return <div className="p-8 text-sm text-red-600">No invoices found.</div>;

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
              <div className="text-2xl font-bold tracking-wide">BILLING STATEMENT</div>
              <div className="text-xs text-gray-500">
                {rows[0]?.transaction_type === "Pickup" ? "Pick-up Fee" : rows[0]?.transaction_type || ""}
              </div>
            </div>
          </div>
          <div className="text-right text-xs text-gray-500">
            <div>Statement Date: {formatDate(new Date().toISOString())}</div>
          </div>
        </div>

        <div className="mb-6">
          <div className="font-semibold">Bill To:</div>
          <div>{client?.client_name || rows[0]?.client_name}</div>
          {client?.billing_address && <div className="text-xs text-gray-500">{client.billing_address}</div>}
          <div className="text-xs text-gray-500 mt-1">
            {rows[0]?.transaction_type === "Pickup"
              ? "Pick-up Fee Rate: 5% of invoice amount"
              : `Service Rate: ${client?.service_rate != null ? `${client.service_rate}%` : "—"} of invoice amount`}
          </div>
        </div>

        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-400">
              <th className="py-1">Invoice Date</th>
              <th className="py-1">Invoice #</th>
              <th className="py-1">PO #</th>
              <th className="py-1">Delivery Date</th>
              <th className="py-1 text-right">Net Amount</th>
              <th className="py-1 text-right">Rate</th>
              <th className="py-1 text-right">Service Fee</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-gray-200">
                <td className="py-1">{formatDate(r.invoice_date)}</td>
                <td className="py-1">{r.invoice_number}</td>
                <td className="py-1">{r.po_number}</td>
                <td className="py-1">{formatDate(r.date_of_delivery)}</td>
                <td className="py-1 text-right">{peso(r.total_net_amount)}</td>
                <td className="py-1 text-right">
                  {r.transaction_type === "Pickup"
                    ? "5% (Pickup)"
                    : r.service_rate != null
                    ? `${r.service_rate}%`
                    : "—"}
                </td>
                <td className="py-1 text-right">{peso(r.service_fee_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <div className="w-64 space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-600">Total Net Amount:</span>
              <span>{peso(totalNet)}</span>
            </div>
            <div className="flex justify-between font-bold text-base border-t border-gray-400 pt-1">
              <span>TOTAL SERVICE FEE DUE:</span>
              <span>{peso(totalFee)}</span>
            </div>
          </div>
        </div>

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

export default function BillingStatementPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading…</div>}>
      <BillingStatementContent />
    </Suspense>
  );
}

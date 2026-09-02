"use client";

/**
 * Statement of Account — Mondial88 Trading Corporation format.
 *
 * Mirrors the physical SOA template the finance team already uses on paper
 * (Mondial88 letterhead, client name + address, DELIVERY DATE / INVOICE NO. /
 * BRANCH / P.O NO. / AMOUNT / REMARKS table, Total Amount, blank Prepared
 * By / Noted By signature lines). Only for the 3 sub-clients billed this
 * way: Adesteck Marketing Corporation (C-0003), Rodzon Marketing
 * Corporation (C-0002), Healthwellnesslifestyle Inc. (C-0004) -- see
 * migration 0079 for their billing_address values.
 *
 * Prints the SPECIFIC batch of invoices selected on the Billing page (same
 * "selected checkbox rows -> ids param" pattern as the existing
 * /mercury/billing/statement page), not a running unpaid balance -- that's
 * what the existing Dynamic88-branded /mercury/billing/soa page is for.
 *
 * Opened via /mercury/billing/soa-mondial?ids=a,b,c
 *
 * The Remarks column is intentionally left blank per row (user request --
 * no auto-filled codes/notes). The Statement Date defaults to today but is
 * editable via a date picker in the (non-printing) toolbar before printing,
 * per user request ("kung kailan ni-generate, pwede ring pili sa
 * calendar"). Prepared By / Noted By are blank signature lines with no
 * printed name or position -- filled in by hand after printing.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, DeliveryHeaderFull } from "@/lib/mercury/types";

const ALLOWED_CLIENT_CODES = ["C-0002", "C-0003", "C-0004"];

function peso(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(n || 0);
}

// Sample template shows dates as "7/16/2026" (no leading zeros) -- en-US's
// default numeric date format matches that exactly.
function formatShortDate(d: string | null | undefined) {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US");
}

function formatLongDate(iso: string) {
  const dt = new Date(`${iso}T00:00:00`);
  if (isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function todayIso() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function compareByDeliveryDate(a: DeliveryHeaderFull, b: DeliveryHeaderFull) {
  const da = a.date_of_delivery || "";
  const db = b.date_of_delivery || "";
  if (da !== db) return da.localeCompare(db);
  return (a.invoice_number || "").localeCompare(b.invoice_number || "");
}

// Simple infinity-mark glyph standing in for the physical letterhead's
// printed logo (no Mondial88 logo image asset exists in this repo).
function InfinityMark() {
  return (
    <svg viewBox="0 0 64 32" className="h-7 w-14" aria-hidden="true">
      <path
        d="M16 8c-6.6 0-12 5.4-12 12s5.4 12 12 12c5 0 8.6-2.8 11-6.4l5-7.2c2.4-3.6 6-6.4 11-6.4 6.6 0 12 5.4 12 12s-5.4 12-12 12c-5 0-8.6-2.8-11-6.4l-5-7.2C24.6 10.8 21 8 16 8z"
        fill="none"
        stroke="#8a6d3b"
        strokeWidth="3.2"
      />
    </svg>
  );
}

function MondialSoaContent() {
  const searchParams = useSearchParams();
  const idsParam = searchParams.get("ids") || "";
  const ids = idsParam.split(",").filter(Boolean);

  const [rows, setRows] = useState<DeliveryHeaderFull[]>([]);
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [soaDate, setSoaDate] = useState(todayIso());

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
      const list = ((data as DeliveryHeaderFull[]) || []).slice().sort(compareByDeliveryDate);
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

  const totalAmount = useMemo(
    () => rows.reduce((s, r) => s + (r.total_net_amount || 0), 0),
    [rows]
  );

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>;
  if (error) return <div className="p-8 text-sm text-red-600">{error}</div>;
  if (rows.length === 0) return <div className="p-8 text-sm text-red-600">No invoices found.</div>;
  if (!client || !ALLOWED_CLIENT_CODES.includes(client.client_code)) {
    return (
      <div className="p-8 text-sm text-red-600">
        Available lang ang Statement of Account (Mondial88 format) na ito para kina Adesteck,
        Rodzon Marketing, at Healthwellnesslifestyle.
      </div>
    );
  }

  return (
    <div>
      <style jsx global>{`
        @page {
          size: 8.5in 11in;
          margin: 0.6in;
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

      <div className="print-toolbar flex flex-wrap items-center justify-center gap-3 py-4">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          Statement Date:
          <input
            type="date"
            className="input w-auto"
            value={soaDate}
            onChange={(e) => setSoaDate(e.target.value)}
          />
        </label>
        <button className="btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      {error && (
        <div className="print-toolbar max-w-3xl mx-auto rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-2">
          {error}
        </div>
      )}

      <div className="max-w-3xl mx-auto bg-white p-10 text-sm text-gray-900">
        {/* Letterhead */}
        <div className="flex flex-col items-center border-b-2 border-gray-800 pb-3 text-center">
          <div className="flex items-center gap-2">
            <InfinityMark />
            <div className="text-xl font-bold text-gray-900">Mondial88 Trading Corporation</div>
          </div>
          <div className="text-xs text-gray-600 mt-1">Alegria Building</div>
          <div className="text-xs text-gray-600">2229 Don Chino Roces Ave. Makati City</div>
          <div className="text-xs text-gray-600">TelNo. 8403374 - Telefax No.8403390</div>
        </div>

        <div className="mt-4 flex justify-end text-sm">{formatLongDate(soaDate)}</div>

        <div className="mt-4 font-bold uppercase">{client.client_name}</div>
        {client.billing_address && (
          <div className="text-xs text-gray-600 whitespace-pre-line">{client.billing_address}</div>
        )}

        <div className="mt-6 text-center text-lg font-bold uppercase tracking-wide">
          Statement of Account
        </div>

        <table className="w-full mt-4 text-left border-collapse text-xs">
          <thead>
            <tr className="border-b-2 border-gray-800">
              <th className="py-1 pr-2 font-semibold">Delivery Date</th>
              <th className="py-1 pr-2 font-semibold">Invoice No.</th>
              <th className="py-1 pr-2 font-semibold">Branch</th>
              <th className="py-1 pr-2 font-semibold">P.O No.</th>
              <th className="py-1 pr-2 text-right font-semibold">Amount</th>
              <th className="py-1 font-semibold">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-gray-200">
                <td className="py-1 pr-2 whitespace-nowrap">{formatShortDate(r.date_of_delivery)}</td>
                <td className="py-1 pr-2">{r.invoice_number}</td>
                <td className="py-1 pr-2">{r.branch_name || "—"}</td>
                <td className="py-1 pr-2">{r.po_number || "—"}</td>
                <td className="py-1 pr-2 text-right whitespace-nowrap">{peso(r.total_net_amount)}</td>
                <td className="py-1">&nbsp;</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <div className="w-64 space-y-1">
            <div className="flex justify-between font-bold text-base border-t-2 border-gray-800 pt-1">
              <span>Total Amount:</span>
              <span>{peso(totalAmount)}</span>
            </div>
          </div>
        </div>

        <div className="mt-20 grid grid-cols-2 gap-8 text-xs">
          <div>
            <div>Prepared By:</div>
            <div className="border-b border-gray-800 h-12 mt-8"></div>
          </div>
          <div>
            <div>Noted By:</div>
            <div className="border-b border-gray-800 h-12 mt-8"></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MondialSoaPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading…</div>}>
      <MondialSoaContent />
    </Suspense>
  );
}

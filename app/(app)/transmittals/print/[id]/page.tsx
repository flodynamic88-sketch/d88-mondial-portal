"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getAppSetting, LOGO_SETTING_KEY } from "@/lib/appSettings";
import { dateToMonthValue } from "@/lib/dateHelpers";
import type { VTransmittal, VTransmittalItem, InvoiceCategory } from "@/types/database";

const CATEGORY_LABELS: Record<InvoiceCategory, string> = {
  CONSIGNMENT: "Consignment",
  OUTRIGHT: "Outright",
  MERCURY_DRUG: "Flo-Mercury",
};

// Both column sets always come out to 7 columns:
//  Consignment: Document #, Actual Delivery Date, Month of Invoice, Posting
//               Date, Retail Chain, Branch/Store Address, Amount
//  Outright/Mercury: Actual Delivery Date, Month of Invoice, Document #,
//               Retail Chain, Branch/Store Address, Amount, Remarks
const COLSPAN = 7;

function formatMoney(value: number | null | undefined) {
  return (value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMonthLabel(dateValue: string | null): string {
  const monthValue = dateToMonthValue(dateValue);
  if (!monthValue) return "—";
  const [y, m] = monthValue.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export default function PrintTransmittalPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";

  const [transmittal, setTransmittal] = useState<VTransmittal | null>(null);
  const [items, setItems] = useState<VTransmittalItem[]>([]);
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
        const [{ data: header, error: headerErr }, { data: lineItems }, logo] = await Promise.all([
          supabase.from("v_transmittals").select("*").eq("id", id).maybeSingle(),
          supabase
            .from("v_transmittal_items")
            .select("*")
            .eq("transmittal_id", id)
            .order("document_no", { ascending: true }),
          getAppSetting(LOGO_SETTING_KEY),
        ]);
        if (headerErr || !header) {
          setErrorMsg("Could not load this transmittal.");
          return;
        }
        setTransmittal(header as VTransmittal);
        setItems((lineItems ?? []) as VTransmittalItem[]);
        setLogoUrl(logo);
      } catch {
        setErrorMsg("Could not load this transmittal.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const totalAmount = useMemo(() => items.reduce((sum, i) => sum + (i.amount ?? 0), 0), [items]);

  if (loading) {
    return <p className="p-8 text-sm text-gray-400">Loading…</p>;
  }
  if (errorMsg || !transmittal) {
    return <p className="p-8 text-sm text-red-600">{errorMsg ?? "Transmittal not found."}</p>;
  }

  const isConsignment = transmittal.category === "CONSIGNMENT";
  const showRemarks = !isConsignment;
  const categoryLabel = CATEGORY_LABELS[transmittal.category];

  return (
    <div>
      {/* Landscape gives the 7-column table more room to breathe than the
          browser's default portrait page -- scoped to this page only via
          @page, so other printable reports (Delivery Variance Log, etc.)
          keep their normal portrait orientation. */}
      <style>{`
        @media print {
          @page {
            size: landscape;
          }
        }
      `}</style>

      <div className="no-print mb-4 flex justify-end">
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div className="printable-area mx-auto max-w-5xl rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-800">
        <div className="flex items-center justify-between border-b-2 border-brand-600 pb-4">
          <div className="flex items-center gap-4">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Dynamic88 logo" className="h-16 w-auto" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-brand-600 text-xl font-bold text-white">
                D88
              </div>
            )}
            <div>
              <p className="text-lg font-bold tracking-tight text-gray-900">
                Dynamic88 Solutions
              </p>
              <p className="text-xs text-gray-500">Mondial Portal — Transmittal Form</p>
            </div>
          </div>
          <div className="text-right">
            <span className="inline-block rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-700">
              {categoryLabel}
            </span>
            <p className="mt-2 text-2xl font-bold text-gray-900">
              {transmittal.transmittal_no ?? "—"}
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-4 text-center">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Delivery Date</p>
            <p className="mt-1 font-semibold">
              {new Date(transmittal.delivery_date).toLocaleDateString()}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Date Transmitted</p>
            <p className="mt-1 font-semibold">
              {new Date(transmittal.date_transmitted).toLocaleDateString()}
            </p>
          </div>
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
            <p className="text-xs uppercase tracking-wide text-brand-600">Total Amount</p>
            <p className="mt-1 font-bold text-brand-700">{formatMoney(totalAmount)}</p>
          </div>
        </div>

        <div className="mt-6">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-t border-gray-300 bg-gray-50 text-left uppercase text-gray-500">
                <th className="py-1.5 pl-2">Document #</th>
                <th className="py-1.5">Actual Delivery Date</th>
                <th className="py-1.5">Month of Invoice</th>
                {isConsignment && <th className="py-1.5">Posting Date</th>}
                <th className="py-1.5">Retail Chain</th>
                <th className="py-1.5">Branch/Store Address</th>
                <th className="py-1.5 pr-2">Amount</th>
                {showRemarks && <th className="py-1.5 pr-2">Remarks</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-gray-200">
                  <td className="py-1.5 pl-2 font-medium">{item.document_no}</td>
                  <td className="py-1.5">
                    {item.actual_delivery_date
                      ? new Date(item.actual_delivery_date).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="py-1.5">{formatMonthLabel(item.billing_period)}</td>
                  {isConsignment && (
                    <td className="py-1.5">
                      {item.posting_date ? new Date(item.posting_date).toLocaleDateString() : "—"}
                    </td>
                  )}
                  <td className="py-1.5">
                    {transmittal.category === "MERCURY_DRUG"
                      ? "Mercury Drug Corporation"
                      : item.company_name_raw ?? "—"}
                  </td>
                  <td className="py-1.5">{item.branch_address ?? "—"}</td>
                  <td className="py-1.5 pr-2">{formatMoney(item.amount)}</td>
                  {showRemarks && <td className="py-1.5 pr-2">{item.remarks ?? "—"}</td>}
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={COLSPAN} className="py-3 text-center text-gray-400">
                    No invoices in this transmittal.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="mt-2 flex justify-end border-t border-gray-300 pt-2 text-sm font-semibold">
            <span className="mr-4 text-gray-500">Total</span>
            <span>{formatMoney(totalAmount)}</span>
          </div>
        </div>

        <div className="mt-12 grid grid-cols-3 gap-x-8 gap-y-10">
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
              <p className="text-xs text-gray-500">Received By — Invoice Department</p>
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

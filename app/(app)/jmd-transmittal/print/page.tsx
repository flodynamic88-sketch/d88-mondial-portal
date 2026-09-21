"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getAppSetting, LOGO_SETTING_KEY } from "@/lib/appSettings";
import { dateToMonthValue } from "@/lib/dateHelpers";
import type { Invoice, InvoiceCategory, Principal } from "@/types/database";

const CATEGORY_LABELS: Record<InvoiceCategory, string> = {
  CONSIGNMENT: "Consignment",
  OUTRIGHT: "Outright",
  MERCURY_DRUG: "Flo-Mercury",
  FLO_PRINCIPAL: "FLO-Principal",
};

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

export default function PrintJmdTransmittalPage() {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-gray-400">Loading…</p>}>
      <PrintContent />
    </Suspense>
  );
}

function PrintContent() {
  const searchParams = useSearchParams();
  const idsParam = searchParams.get("ids") ?? "";
  const ids = useMemo(
    () => idsParam.split(",").map((s) => s.trim()).filter(Boolean),
    [idsParam]
  );

  const [items, setItems] = useState<Invoice[]>([]);
  const [principals, setPrincipals] = useState<Principal[]>([]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (ids.length === 0) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const supabase = createClient();
        const [{ data, error }, { data: principalRows }, logo] = await Promise.all([
          supabase
            .from("invoices")
            .select("*")
            .in("id", ids)
            .order("document_no_sort", { ascending: true }),
          supabase.from("principals").select("*"),
          getAppSetting(LOGO_SETTING_KEY),
        ]);
        if (error) {
          setErrorMsg("Could not load these invoices.");
          return;
        }
        setItems((data ?? []) as Invoice[]);
        setPrincipals((principalRows ?? []) as Principal[]);
        setLogoUrl(logo);
      } catch {
        setErrorMsg("Could not load these invoices.");
      } finally {
        setLoading(false);
      }
    })();
  }, [ids]);

  const totalAmount = useMemo(() => items.reduce((sum, i) => sum + (i.amount ?? 0), 0), [items]);

  const category: InvoiceCategory | null = items[0]?.category ?? null;
  const isMixedCategory = items.length > 0 && items.some((i) => i.category !== category);

  function retailChainLabel(inv: Invoice) {
    if (inv.category === "MERCURY_DRUG") return "Mercury Drug Corporation";
    if (inv.category === "FLO_PRINCIPAL") {
      return principals.find((p) => p.id === inv.principal_id)?.name ?? "—";
    }
    return inv.company_name_raw ?? "—";
  }

  if (loading) {
    return <p className="p-8 text-sm text-gray-400">Loading…</p>;
  }
  if (ids.length === 0) {
    return <p className="p-8 text-sm text-red-600">No invoices were selected for this transmittal.</p>;
  }

  return (
    <div>
      {/* Landscape gives the wider table more room, scoped to this page only. */}
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
            <p className="text-3xl font-bold tracking-wide text-gray-900">TRANSMITTAL TO JMD</p>
          </div>
          <div className="text-right">
            {category && (
              <span className="inline-block rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-700">
                {isMixedCategory ? "Mixed Categories" : CATEGORY_LABELS[category]}
              </span>
            )}
            <p className="mt-2 text-lg font-semibold text-gray-900">
              {new Date().toLocaleDateString()}
            </p>
          </div>
        </div>

        {errorMsg && <p className="mt-4 text-sm text-red-600">{errorMsg}</p>}

        <div className="mt-5 grid grid-cols-2 gap-4 text-center">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Documents Forwarded</p>
            <p className="mt-1 font-semibold">{items.length}</p>
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
                <th className="py-1.5">{isMixedCategory ? "Category" : "Retail Chain / Principal"}</th>
                <th className="py-1.5">Branch/Store Address</th>
                <th className="py-1.5">Month of Invoice</th>
                <th className="py-1.5">Posting Date</th>
                <th className="py-1.5 pr-2">Amount</th>
                <th className="py-1.5 pr-2">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-gray-200">
                  <td className="py-1.5 pl-2 font-medium">{item.document_no}</td>
                  <td className="py-1.5">
                    {isMixedCategory
                      ? `${CATEGORY_LABELS[item.category]} — ${retailChainLabel(item)}`
                      : retailChainLabel(item)}
                  </td>
                  <td className="py-1.5">{item.branch_address ?? "—"}</td>
                  <td className="py-1.5">{formatMonthLabel(item.billing_period)}</td>
                  <td className="py-1.5">
                    {item.posting_date ? new Date(item.posting_date).toLocaleDateString() : "—"}
                  </td>
                  <td className="py-1.5 pr-2">{formatMoney(item.amount)}</td>
                  <td className="py-1.5 pr-2">{item.remarks ?? "—"}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-3 text-center text-gray-400">
                    No invoices found for this transmittal.
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
              <p className="text-xs text-gray-500">Received By — JMD</p>
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

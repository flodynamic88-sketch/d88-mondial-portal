"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import RequireRole from "@/components/RequireRole";
import { exportToExcel } from "@/lib/exportExcel";
import type { InvoiceCategory, VBilling } from "@/types/database";

const TABS: { value: InvoiceCategory; label: string }[] = [
  { value: "CONSIGNMENT", label: "Consignment" },
  { value: "OUTRIGHT", label: "Outright" },
  { value: "MERCURY_DRUG", label: "Mercury Drug" },
];

function formatMoney(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function BillingTable({ category }: { category: InvoiceCategory }) {
  const [rows, setRows] = useState<VBilling[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErrorMsg(null);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("v_billing")
          .select("*")
          .eq("category", category)
          .order("delivered_at", { ascending: true });

        if (cancelled) return;

        if (error) {
          setErrorMsg("Could not load billing data. Connect a Supabase project to see live data.");
          setRows([]);
        } else {
          setRows(data ?? []);
        }
      } catch {
        if (!cancelled) {
          setErrorMsg("Could not load billing data. Connect a Supabase project to see live data.");
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [category]);

  const totalAmount = rows.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  const totalFee = rows.reduce((sum, r) => sum + (r.service_fee ?? 0), 0);

  function handleExport() {
    exportToExcel(`billing-${category.toLowerCase()}`, [
      {
        name: category.replace("_", " "),
        rows: rows.map((row) => ({
          "Document No.": row.document_no,
          Zone: row.zone,
          DC: row.is_dc ? "Yes" : "No",
          Amount: row.amount,
          "Rate %": row.service_rate_pct ?? "",
          "Service Fee": row.service_fee ?? 0,
          Delivered: row.delivered_at ? new Date(row.delivered_at).toLocaleDateString() : "",
        })),
      },
    ]);
  }

  return (
    <div className="card mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-800">
          Delivered Invoices — {category.replace("_", " ")}
        </h2>
        {rows.length > 0 && (
          <button
            type="button"
            className="tab-button tab-button-inactive"
            onClick={handleExport}
          >
            Export to Excel
          </button>
        )}
      </div>

      {loading && <p className="mt-3 text-sm text-gray-400">Loading…</p>}
      {!loading && errorMsg && <p className="mt-3 text-sm text-gray-400">{errorMsg}</p>}
      {!loading && !errorMsg && rows.length === 0 && (
        <p className="mt-3 text-sm text-gray-400">No delivered invoices in this category yet.</p>
      )}

      {!loading && !errorMsg && rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                <th className="py-2 pr-4">Document No.</th>
                <th className="py-2 pr-4">Zone</th>
                <th className="py-2 pr-4">DC</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Rate %</th>
                <th className="py-2 pr-4">Service Fee</th>
                <th className="py-2 pr-4">Delivered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.invoice_id}>
                  <td className="py-2 pr-4 font-medium text-gray-800">{row.document_no}</td>
                  <td className="py-2 pr-4">{row.zone}</td>
                  <td className="py-2 pr-4">{row.is_dc ? "Yes" : "No"}</td>
                  <td className="py-2 pr-4">{formatMoney(row.amount)}</td>
                  <td className="py-2 pr-4">{row.service_rate_pct ?? "—"}</td>
                  <td className="py-2 pr-4">{formatMoney(row.service_fee ?? 0)}</td>
                  <td className="py-2 pr-4">
                    {row.delivered_at ? new Date(row.delivered_at).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 font-semibold text-gray-800">
                <td className="py-2 pr-4" colSpan={3}>
                  Grand Total
                </td>
                <td className="py-2 pr-4">{formatMoney(totalAmount)}</td>
                <td className="py-2 pr-4"></td>
                <td className="py-2 pr-4">{formatMoney(totalFee)}</td>
                <td className="py-2 pr-4"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

export default function BillingPage() {
  const [activeTab, setActiveTab] = useState<InvoiceCategory>("CONSIGNMENT");

  return (
    <RequireRole roles={["ADMIN", "GENERAL_MANAGER"]}>
    <div>
      <div className="page-header border-b-0 pb-0">
        <div>
          <h1 className="page-title">Billing</h1>
          <p className="page-subtitle">
            Computed service fees for delivered invoices, ordered by delivery date.
          </p>
        </div>
      </div>

      <div className="mt-6 flex gap-2 border-b border-gray-200 pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setActiveTab(tab.value)}
            className={`tab-button ${
              activeTab === tab.value ? "tab-button-active" : "tab-button-inactive"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <BillingTable key={activeTab} category={activeTab} />
    </div>
    </RequireRole>
  );
}

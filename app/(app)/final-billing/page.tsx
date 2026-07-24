"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import RequireRole from "@/components/RequireRole";
import { exportToExcel } from "@/lib/exportExcel";
import type { InvoiceCategory, VFinalBilling, ZoneType } from "@/types/database";

const ZONE_LABELS: Record<ZoneType, string> = {
  NCR: "NCR",
  FAR_NORTH_SOUTH: "Far North / South",
  VIZMIN: "VisMin",
};

function formatMoney(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "—";
}

function formatMonth(value: string | null) {
  return value
    ? new Date(value).toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : "—";
}

// Every row that reaches v_final_billing has already been confirmed by the
// Mondial Team, so the Remarks column is always the same fixed note.
const CONFIRMED_REMARKS = "Validated from Invoicing";

interface ReportColumn {
  header: string;
  render: (row: VFinalBilling) => string;
}

const CONSIGNMENT_COLUMNS: ReportColumn[] = [
  { header: "Indicator", render: (r) => ZONE_LABELS[r.zone] },
  { header: "CD #", render: (r) => r.document_no },
  { header: "Plan Date", render: (r) => formatDate(r.plan_date) },
  { header: "Delivery Date", render: (r) => formatDate(r.delivered_at) },
  { header: "Month", render: (r) => formatMonth(r.billing_period) },
  { header: "Posting Date", render: (r) => formatDate(r.posting_date) },
  { header: "Retail Chain", render: (r) => r.company_name ?? "—" },
  { header: "Branch/Store Address", render: (r) => r.branch_address ?? "—" },
  { header: "Amount", render: (r) => formatMoney(r.amount) },
  { header: "Transmittal Forward Date", render: (r) => formatDate(r.transmittal_received_date) },
  { header: "Remarks", render: () => CONFIRMED_REMARKS },
];

const OUTRIGHT_COLUMNS: ReportColumn[] = [
  { header: "Indicator", render: (r) => ZONE_LABELS[r.zone] },
  { header: "Plan Del. Date", render: (r) => formatDate(r.plan_date) },
  { header: "Delivery Date", render: (r) => formatDate(r.delivered_at) },
  { header: "Month", render: (r) => formatMonth(r.billing_period) },
  { header: "Invoice No.", render: (r) => r.document_no },
  { header: "Account", render: (r) => r.company_name ?? "—" },
  { header: "Branch/Store Address", render: (r) => r.branch_address ?? "—" },
  { header: "Amount", render: (r) => formatMoney(r.amount) },
  { header: "Transmittal Forward Date", render: (r) => formatDate(r.transmittal_received_date) },
  { header: "Remarks", render: () => CONFIRMED_REMARKS },
];

const MERCURY_COLUMNS: ReportColumn[] = [
  { header: "Indicator", render: (r) => ZONE_LABELS[r.zone] },
  { header: "Invoice No.", render: (r) => r.document_no },
  { header: "Plan Date", render: (r) => formatDate(r.plan_date) },
  { header: "Delivery Date", render: (r) => formatDate(r.delivered_at) },
  { header: "Month", render: (r) => formatMonth(r.billing_period) },
  { header: "Posting Date", render: (r) => formatDate(r.posting_date) },
  { header: "Retail Chain", render: (r) => r.company_name ?? "—" },
  { header: "Branch/Store Address", render: (r) => r.branch_address ?? "—" },
  { header: "Amount", render: (r) => formatMoney(r.amount) },
  { header: "Transmittal Forward Date", render: (r) => formatDate(r.transmittal_received_date) },
  { header: "Remarks", render: () => CONFIRMED_REMARKS },
];

const CATEGORY_CONFIG: { value: InvoiceCategory; label: string; columns: ReportColumn[] }[] = [
  { value: "CONSIGNMENT", label: "Consignment", columns: CONSIGNMENT_COLUMNS },
  { value: "OUTRIGHT", label: "Outright", columns: OUTRIGHT_COLUMNS },
  { value: "MERCURY_DRUG", label: "FLO-Mercury", columns: MERCURY_COLUMNS },
];

export default function FinalBillingPage() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [rows, setRows] = useState<VFinalBilling[]>([]);
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (!startDate || !endDate) {
      setErrorMsg("Please select both a start date and an end date.");
      return;
    }
    if (startDate > endDate) {
      setErrorMsg("Start date must be on or before the end date.");
      return;
    }

    setGenerating(true);
    setHasGenerated(true);
    try {
      const supabase = createClient();
      const rangeStart = `${startDate}T00:00:00`;
      const rangeEnd = `${endDate}T23:59:59.999`;

      const { data, error } = await supabase
        .from("v_final_billing")
        .select("*")
        .gte("delivered_at", rangeStart)
        .lte("delivered_at", rangeEnd)
        .order("delivered_at", { ascending: true });

      if (error) {
        setErrorMsg("Could not generate final billing. Connect a Supabase project to see live data.");
        setRows([]);
      } else {
        setRows(data ?? []);
      }
    } catch {
      setErrorMsg("Could not generate final billing. Connect a Supabase project to see live data.");
      setRows([]);
    } finally {
      setGenerating(false);
    }
  }

  const grandTotalAmount = rows.reduce((sum, r) => sum + (r.amount ?? 0), 0);

  function handleExport() {
    const sheets: { name: string; rows: Record<string, unknown>[] }[] = CATEGORY_CONFIG.map(
      (cat) => {
        const catRows = rows.filter((r) => r.category === cat.value);
        return {
          name: cat.label,
          rows: catRows.map((row) => {
            const record: Record<string, unknown> = {};
            cat.columns.forEach((col) => {
              record[col.header] = col.render(row);
            });
            return record;
          }),
        };
      }
    ).filter((sheet) => sheet.rows.length > 0);

    sheets.push({
      name: "Summary",
      rows: [
        {
          "Delivery Period": `${startDate} to ${endDate}`,
          "Grand Total Amount": grandTotalAmount,
        },
      ],
    });

    exportToExcel(`final-billing-${startDate}_to_${endDate}`, sheets);
  }

  return (
    <RequireRole roles={["ADMIN", "LOGISTICS_OFFICER", "GENERAL_MANAGER"]}>
    <div>
      <div className="page-header border-b-0 pb-0">
        <div>
          <h1 className="page-title">Final Billing</h1>
          <p className="page-subtitle">
            Generate the Mondial-confirmed billing statement for a delivery period.
          </p>
        </div>
      </div>

      <form onSubmit={handleGenerate} className="card mt-6 flex flex-wrap items-end gap-4">
        <div>
          <label className="label">Delivery Period — Start</label>
          <input
            type="date"
            className="input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Delivery Period — End</label>
          <input
            type="date"
            className="input"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="btn-primary" disabled={generating}>
          {generating ? "Generating…" : "Generate"}
        </button>
      </form>

      {errorMsg && <p className="mt-4 text-sm text-red-600">{errorMsg}</p>}

      {hasGenerated && !generating && !errorMsg && (
        <div className="card mt-6">
          <div className="relative border-b border-gray-200 pb-4 text-center">
            {rows.length > 0 && (
              <button
                type="button"
                className="tab-button tab-button-inactive absolute right-0 top-0"
                onClick={handleExport}
              >
                Export to Excel
              </button>
            )}
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Billing Statement
            </p>
            <h2 className="mt-1 text-xl font-bold text-gray-800">
              Mondial88 Trading Corporation
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Delivery Period: {startDate} to {endDate}
            </p>
          </div>

          {rows.length === 0 && (
            <p className="mt-4 text-sm text-gray-400">
              No confirmed, delivered invoices found in this delivery period.
            </p>
          )}

          {rows.length > 0 && (
            <div className="mt-4 space-y-8">
              {CATEGORY_CONFIG.map((cat) => {
                const catRows = rows.filter((r) => r.category === cat.value);
                if (catRows.length === 0) return null;

                const subtotalAmount = catRows.reduce((sum, r) => sum + (r.amount ?? 0), 0);
                const amountColIndex = cat.columns.findIndex((c) => c.header === "Amount");

                return (
                  <div key={cat.value}>
                    <h3 className="text-sm font-semibold text-gray-700">{cat.label}</h3>
                    <div className="mt-2 overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead>
                          <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                            {cat.columns.map((col) => (
                              <th key={col.header} className="whitespace-nowrap py-2 pr-4">
                                {col.header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {catRows.map((row) => (
                            <tr key={row.invoice_id}>
                              {cat.columns.map((col, idx) => (
                                <td
                                  key={col.header}
                                  className={`whitespace-nowrap py-2 pr-4 ${
                                    idx === 0 ? "font-medium text-gray-800" : ""
                                  }`}
                                >
                                  {col.render(row)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-gray-300 font-semibold text-gray-800">
                            <td className="py-2 pr-4" colSpan={amountColIndex}>
                              Subtotal — {cat.label}
                            </td>
                            <td className="py-2 pr-4">{formatMoney(subtotalAmount)}</td>
                            <td
                              className="py-2 pr-4"
                              colSpan={cat.columns.length - amountColIndex - 1}
                            ></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                );
              })}

              <div className="flex flex-col items-end gap-1 border-t-2 border-gray-300 pt-4">
                <p className="text-lg font-bold text-brand-700">
                  Grand Total Amount: {formatMoney(grandTotalAmount)}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
    </RequireRole>
  );
}

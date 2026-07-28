"use client";

import { Fragment, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import RequireRole from "@/components/RequireRole";
import { useAuth } from "@/components/AuthProvider";
import { exportToExcel } from "@/lib/exportExcel";
import { getAppSetting, setAppSetting, FINAL_BILLING_REPORT_EMAIL_KEY } from "@/lib/appSettings";
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

// ── Fulfillment Fee dashboard ────────────────────────────────────────────
// Fulfillment Fee = Total Invoice Amount x Service Rate, and the rate
// depends on both the zone AND whether it's a DC (Distribution Center)
// account -- DC accounts get a different (lower) rate than regular
// accounts in the same zone. So each category is broken down per zone,
// with DC split out as its own line, matching how fee_rates actually
// prices things (see 0001_init.sql).
const ZONE_ORDER: ZoneType[] = ["NCR", "FAR_NORTH_SOUTH", "VIZMIN"];

interface FeeGroup {
  key: string;
  label: string;
  totalAmount: number;
  totalFee: number;
  ratePct: number | null;
}

function summarizeFeeRows(groupRows: VFinalBilling[], label: string, key: string): FeeGroup {
  const totalAmount = groupRows.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  const totalFee = groupRows.reduce((sum, r) => sum + (r.service_fee ?? 0), 0);
  const ratePct =
    groupRows[0]?.service_rate_pct ?? (totalAmount > 0 ? (totalFee / totalAmount) * 100 : null);
  return { key, label, totalAmount, totalFee, ratePct };
}

function buildFeeGroups(catRows: VFinalBilling[], category: InvoiceCategory): FeeGroup[] {
  if (catRows.length === 0) return [];

  if (category === "MERCURY_DRUG") {
    return [summarizeFeeRows(catRows, "All Zones (Flat Rate)", "MERCURY_DRUG")];
  }

  const groups: FeeGroup[] = [];
  ZONE_ORDER.forEach((zone) => {
    [false, true].forEach((isDc) => {
      const groupRows = catRows.filter((r) => r.zone === zone && r.is_dc === isDc);
      if (groupRows.length === 0) return;
      groups.push(
        summarizeFeeRows(
          groupRows,
          isDc ? `${ZONE_LABELS[zone]} — DC` : ZONE_LABELS[zone],
          `${zone}-${isDc}`
        )
      );
    });
  });
  return groups;
}

export default function FinalBillingPage() {
  const profile = useAuth();
  const canEditReportEmail = profile?.role === "ADMIN";

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [rows, setRows] = useState<VFinalBilling[]>([]);
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);

  // Recipient email for auto-sent reports (see RESEND_API_KEY note in
  // app/api/reports/final-billing/send/route.ts). Stored in app_settings the
  // same way the Dynamic88 logo is, so no extra table is needed.
  const [reportEmail, setReportEmail] = useState("");
  const [editingReportEmail, setEditingReportEmail] = useState(false);
  const [savingReportEmail, setSavingReportEmail] = useState(false);
  const [sendStatus, setSendStatus] = useState<string | null>(null);

  useEffect(() => {
    getAppSetting(FINAL_BILLING_REPORT_EMAIL_KEY).then((v) => setReportEmail(v ?? ""));
  }, []);

  async function handleSaveReportEmail() {
    setSavingReportEmail(true);
    try {
      await setAppSetting(FINAL_BILLING_REPORT_EMAIL_KEY, reportEmail.trim() || null);
      setEditingReportEmail(false);
    } finally {
      setSavingReportEmail(false);
    }
  }

  // Auto-emails the just-generated report to the configured recipient (see
  // handleSaveReportEmail above). Silently does nothing if no recipient is
  // set yet -- this isn't an error, just an unconfigured feature.
  async function sendReportEmail(generatedRows: VFinalBilling[]) {
    if (!reportEmail.trim()) return;

    const categorySummaries = CATEGORY_CONFIG.flatMap((cat) => {
      const catRows = generatedRows.filter((r) => r.category === cat.value);
      return buildFeeGroups(catRows, cat.value).map((g) => ({
        label: `${cat.label} — ${g.label}`,
        totalAmount: g.totalAmount,
        totalFee: g.totalFee,
      }));
    });
    const grandTotal = generatedRows.reduce((sum, r) => sum + (r.amount ?? 0), 0);
    const grandFee = categorySummaries.reduce((sum, g) => sum + g.totalFee, 0);

    try {
      const res = await fetch("/api/reports/final-billing/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: reportEmail.trim(),
          startDate,
          endDate,
          grandTotalAmount: grandTotal,
          grandTotalFee: grandFee,
          categorySummaries,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setSendStatus(body.error ?? "Failed to email the report.");
        return;
      }
      setSendStatus(`Report emailed to ${body.sentTo}.`);
    } catch {
      setSendStatus("Could not email the report.");
    }
  }

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
    setSendStatus(null);
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
        const generatedRows = data ?? [];
        setRows(generatedRows);
        if (generatedRows.length > 0) {
          await sendReportEmail(generatedRows);
        }
      }
    } catch {
      setErrorMsg("Could not generate final billing. Connect a Supabase project to see live data.");
      setRows([]);
    } finally {
      setGenerating(false);
    }
  }

  const grandTotalAmount = rows.reduce((sum, r) => sum + (r.amount ?? 0), 0);

  const feeCategories = CATEGORY_CONFIG.map((cat) => {
    const catRows = rows.filter((r) => r.category === cat.value);
    const groups = buildFeeGroups(catRows, cat.value);
    const subtotalAmount = groups.reduce((sum, g) => sum + g.totalAmount, 0);
    const subtotalFee = groups.reduce((sum, g) => sum + g.totalFee, 0);
    return { ...cat, groups, subtotalAmount, subtotalFee };
  }).filter((cat) => cat.groups.length > 0);

  const grandTotalFee = feeCategories.reduce((sum, cat) => sum + cat.subtotalFee, 0);

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

      <div className="card mt-4 flex flex-wrap items-center gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Auto-email recipient
        </p>
        {editingReportEmail ? (
          <>
            <input
              type="email"
              className="input max-w-xs"
              placeholder="name@example.com"
              value={reportEmail}
              onChange={(e) => setReportEmail(e.target.value)}
            />
            <button
              type="button"
              className="btn-primary"
              disabled={savingReportEmail}
              onClick={handleSaveReportEmail}
            >
              {savingReportEmail ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="tab-button tab-button-inactive"
              onClick={() => setEditingReportEmail(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <span className="text-sm text-gray-700">{reportEmail || "Not configured"}</span>
            {canEditReportEmail && (
              <button
                type="button"
                className="tab-button tab-button-inactive"
                onClick={() => setEditingReportEmail(true)}
              >
                Edit
              </button>
            )}
          </>
        )}
        <p className="w-full text-xs text-gray-400">
          When a report is generated with results, a summary is automatically emailed to this
          address.
        </p>
      </div>

      {errorMsg && <p className="mt-4 text-sm text-red-600">{errorMsg}</p>}
      {sendStatus && <p className="mt-2 text-sm text-gray-500">{sendStatus}</p>}

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
              <div>
                <h3 className="text-sm font-semibold text-gray-700">Fulfillment Fee Summary</h3>
                <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-gray-100 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                        <th className="px-3 py-2">Category</th>
                        <th className="px-3 py-2">Indicator</th>
                        <th className="px-3 py-2 text-right">Total Invoice Amt</th>
                        <th className="px-3 py-2 text-right">Rate</th>
                        <th className="px-3 py-2 text-right">Fulfillment Fee</th>
                      </tr>
                    </thead>
                    <tbody>
                      {feeCategories.map((cat) => {
                        const isMercury = cat.value === "MERCURY_DRUG";
                        return (
                          <Fragment key={cat.value}>
                            {cat.groups.map((g, idx) => (
                              <tr key={g.key} className="border-t border-gray-100">
                                {idx === 0 && (
                                  <td
                                    rowSpan={cat.groups.length}
                                    className={`px-3 py-2 align-top font-semibold ${
                                      isMercury ? "bg-amber-50 text-amber-800" : "bg-slate-800 text-white"
                                    }`}
                                  >
                                    {cat.label}
                                  </td>
                                )}
                                <td className="px-3 py-2 text-gray-700">{g.label}</td>
                                <td className="px-3 py-2 text-right text-gray-700">
                                  {formatMoney(g.totalAmount)}
                                </td>
                                <td className="px-3 py-2 text-right text-gray-700">
                                  {g.ratePct != null ? `${g.ratePct.toFixed(2)}%` : "—"}
                                </td>
                                <td className="px-3 py-2 text-right font-medium text-gray-800">
                                  {formatMoney(g.totalFee)}
                                </td>
                              </tr>
                            ))}
                            <tr className={isMercury ? "bg-amber-500 text-white" : "bg-slate-800 text-white"}>
                              <td className="px-3 py-2 font-semibold" colSpan={2}>
                                Subtotal — {cat.label}
                              </td>
                              <td className="px-3 py-2 text-right font-semibold">
                                {formatMoney(cat.subtotalAmount)}
                              </td>
                              <td className="px-3 py-2"></td>
                              <td className="px-3 py-2 text-right font-semibold">
                                {formatMoney(cat.subtotalFee)}
                              </td>
                            </tr>
                          </Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-900 text-base font-bold text-amber-300">
                        <td className="px-3 py-3" colSpan={4}>
                          Grand Total Fulfillment Fee
                        </td>
                        <td className="px-3 py-3 text-right">{formatMoney(grandTotalFee)}</td>
                      </tr>
                      <tr className="bg-gray-100 text-sm font-semibold text-gray-700">
                        <td className="px-3 py-2" colSpan={4}>
                          Total Invoice Amount (Billing Period)
                        </td>
                        <td className="px-3 py-2 text-right">{formatMoney(grandTotalAmount)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

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

"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import RequireRole from "@/components/RequireRole";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/Toast";
import { exportFinalBillingExcel } from "@/lib/exportFinalBillingExcel";
import { getAppSetting, setAppSetting, FINAL_BILLING_REPORT_EMAIL_KEY } from "@/lib/appSettings";
import type { InvoiceCategory, VFinalBilling, VMondialBillingStatement, ZoneType } from "@/types/database";

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
// Mondial Team, so the Remarks column is normally this fixed note -- except
// for the automatic "Charge to Mondial" backload line (see migration 0028 +
// 0039), where it explains why this document_no is billed a second time.
const CONFIRMED_REMARKS = "Validated from Invoicing";
function remarksFor(row: VFinalBilling): string {
  if (row.is_mondial_fault_charge) {
    return `Charged to Mondial — backload: ${row.reason_label ?? "reason not set"}`;
  }
  return CONFIRMED_REMARKS;
}

interface ReportColumn {
  header: string;
  render: (row: VFinalBilling) => string;
}

// Same "Zone — DC" phrasing as the Fulfillment Fee Summary groups below, so
// a DC row reads the same way in both the summary and the detail breakdown.
function zoneIndicatorLabel(r: VFinalBilling): string {
  return r.is_dc ? `${ZONE_LABELS[r.zone]} — DC` : ZONE_LABELS[r.zone];
}

const CONSIGNMENT_COLUMNS: ReportColumn[] = [
  { header: "Indicator", render: zoneIndicatorLabel },
  { header: "CD #", render: (r) => r.document_no },
  { header: "Plan Date", render: (r) => formatDate(r.plan_date) },
  { header: "Delivery Date", render: (r) => formatDate(r.delivered_at) },
  { header: "Month", render: (r) => formatMonth(r.billing_period) },
  { header: "Posting Date", render: (r) => formatDate(r.posting_date) },
  { header: "Retail Chain", render: (r) => r.company_name ?? "—" },
  { header: "Branch/Store Address", render: (r) => r.branch_address ?? "—" },
  { header: "Amount", render: (r) => formatMoney(r.amount) },
  // The Mondial Team's actual "Confirm Received" click date -- not the
  // separate transmittal_received_date field -- is what should read as the
  // Transmittal Forward Date here, since that's the date that matters for
  // this billing statement.
  { header: "Transmittal Forward Date", render: (r) => formatDate(r.confirmed_at) },
  { header: "Remarks", render: remarksFor },
];

const OUTRIGHT_COLUMNS: ReportColumn[] = [
  { header: "Indicator", render: zoneIndicatorLabel },
  { header: "Plan Del. Date", render: (r) => formatDate(r.plan_date) },
  { header: "Delivery Date", render: (r) => formatDate(r.delivered_at) },
  { header: "Month", render: (r) => formatMonth(r.billing_period) },
  { header: "Invoice No.", render: (r) => r.document_no },
  { header: "Account", render: (r) => r.company_name ?? "—" },
  { header: "Branch/Store Address", render: (r) => r.branch_address ?? "—" },
  { header: "Amount", render: (r) => formatMoney(r.amount) },
  { header: "Transmittal Forward Date", render: (r) => formatDate(r.confirmed_at) },
  { header: "Remarks", render: remarksFor },
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
  { header: "Transmittal Forward Date", render: (r) => formatDate(r.confirmed_at) },
  { header: "Remarks", render: remarksFor },
];

const CATEGORY_CONFIG: {
  value: InvoiceCategory;
  label: string;
  columns: ReportColumn[];
  // Consignment and Outright breakdown rows are grouped the same way as the
  // Fulfillment Fee Summary above them (zone, non-DC before DC) so the two
  // sections read consistently. Mercury is a flat rate regardless of
  // zone/DC, so its detail rows are left in delivery-date order.
  groupByZone?: boolean;
}[] = [
  { value: "CONSIGNMENT", label: "Consignment", columns: CONSIGNMENT_COLUMNS, groupByZone: true },
  { value: "OUTRIGHT", label: "Outright", columns: OUTRIGHT_COLUMNS, groupByZone: true },
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

function zoneSortIndex(zone: ZoneType): number {
  const idx = ZONE_ORDER.indexOf(zone);
  return idx === -1 ? ZONE_ORDER.length : idx;
}

/**
 * Orders the invoice breakdown the same way buildFeeGroups buckets the
 * Fulfillment Fee Summary above it: NCR, then NCR — DC, then Far North /
 * South, then Far North / South — DC, etc. per ZONE_ORDER. Array.sort is
 * stable, so rows keep their existing delivered_at order within each
 * zone+DC bucket.
 */
function sortRowsByZoneAndDc(catRows: VFinalBilling[]): VFinalBilling[] {
  return [...catRows].sort((a, b) => {
    const zoneDiff = zoneSortIndex(a.zone) - zoneSortIndex(b.zone);
    if (zoneDiff !== 0) return zoneDiff;
    if (a.is_dc !== b.is_dc) return a.is_dc ? 1 : -1;
    return 0;
  });
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

// Shared by both the "For Billing" preview and a specific SOA's detail view
// on the "Billed" tab -- same Fulfillment Fee Summary + per-category
// breakdown, just fed a different set of rows.
function buildReportData(rows: VFinalBilling[]) {
  const feeCategories = CATEGORY_CONFIG.map((cat) => {
    const catRows = rows.filter((r) => r.category === cat.value);
    const groups = buildFeeGroups(catRows, cat.value);
    const subtotalAmount = groups.reduce((sum, g) => sum + g.totalAmount, 0);
    const subtotalFee = groups.reduce((sum, g) => sum + g.totalFee, 0);
    return { ...cat, groups, subtotalAmount, subtotalFee };
  }).filter((cat) => cat.groups.length > 0);

  const grandTotalAmount = rows.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  const grandTotalFee = feeCategories.reduce((sum, cat) => sum + cat.subtotalFee, 0);

  return { feeCategories, grandTotalAmount, grandTotalFee };
}

async function exportBillingReport(
  rows: VFinalBilling[],
  startDate: string,
  endDate: string
) {
  const { feeCategories, grandTotalAmount, grandTotalFee } = buildReportData(rows);

  const exportFeeCategories = feeCategories.map((cat) => ({
    label: cat.label,
    isMercury: cat.value === "MERCURY_DRUG",
    groups: cat.groups.map((g) => ({
      label: g.label,
      totalAmount: g.totalAmount,
      ratePct: g.ratePct,
      totalFee: g.totalFee,
    })),
    subtotalAmount: cat.subtotalAmount,
    subtotalFee: cat.subtotalFee,
  }));

  const detailSections = CATEGORY_CONFIG.map((cat) => {
    const rawCatRows = rows.filter((r) => r.category === cat.value);
    const catRows = cat.groupByZone ? sortRowsByZoneAndDc(rawCatRows) : rawCatRows;
    const amountColIndex = cat.columns.findIndex((c) => c.header === "Amount");
    const subtotalAmount = catRows.reduce((sum, r) => sum + (r.amount ?? 0), 0);
    return {
      label: cat.label,
      columnHeaders: cat.columns.map((c) => c.header),
      amountColIndex,
      rows: catRows.map((row) => cat.columns.map((col) => col.render(row))),
      subtotalAmount,
    };
  }).filter((section) => section.rows.length > 0);

  await exportFinalBillingExcel({
    startDate,
    endDate,
    feeCategories: exportFeeCategories,
    grandTotalFee,
    grandTotalAmount,
    detailSections,
  });
}

// ── Shared report body (Fulfillment Fee Summary + per-category breakdown) ──
function BillingReportView({
  rows,
  periodLabel,
  onExport,
}: {
  rows: VFinalBilling[];
  periodLabel: string;
  onExport: () => void;
}) {
  const { feeCategories, grandTotalAmount, grandTotalFee } = buildReportData(rows);

  return (
    <div className="card mt-4">
      <div className="relative border-b border-gray-200 pb-4 text-center">
        {rows.length > 0 && (
          <button
            type="button"
            className="tab-button tab-button-inactive absolute right-0 top-0"
            onClick={onExport}
          >
            Export to Excel
          </button>
        )}
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Billing Statement
        </p>
        <h2 className="mt-1 text-xl font-bold text-gray-800">Mondial88 Trading Corporation</h2>
        <p className="mt-1 text-sm text-gray-500">{periodLabel}</p>
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
            const rawCatRows = rows.filter((r) => r.category === cat.value);
            if (rawCatRows.length === 0) return null;
            const catRows = cat.groupByZone ? sortRowsByZoneAndDc(rawCatRows) : rawCatRows;

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
                        <td className="py-2 pr-4" colSpan={cat.columns.length - amountColIndex - 1}></td>
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
  );
}

type TabKey = "FOR_BILLING" | "BILLED";

const TABS: { value: TabKey; label: string }[] = [
  { value: "FOR_BILLING", label: "For Billing" },
  { value: "BILLED", label: "Billed" },
];

export default function FinalBillingPage() {
  const [tab, setTab] = useState<TabKey>("FOR_BILLING");

  return (
    <RequireRole roles={["ADMIN", "GENERAL_MANAGER"]}>
      <div>
        <div className="page-header border-b-0 pb-0">
          <div>
            <h1 className="page-title">Final Billing</h1>
            <p className="page-subtitle">
              Generate the Mondial-confirmed billing statement for a delivery period, then track
              every generated SOA under Billed.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              className={
                tab === t.value ? "tab-button tab-button-active" : "tab-button tab-button-inactive"
              }
              onClick={() => setTab(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "FOR_BILLING" ? <ForBillingTab /> : <BilledTab />}
      </div>
    </RequireRole>
  );
}

function ForBillingTab() {
  const profile = useAuth();
  const { showToast } = useToast();
  const canEditReportEmail = profile?.role === "ADMIN";

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [rows, setRows] = useState<VFinalBilling[]>([]);
  const [searching, setSearching] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

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

    const { feeCategories, grandTotalAmount, grandTotalFee } = buildReportData(generatedRows);
    const categorySummaries = feeCategories.flatMap((cat) =>
      cat.groups.map((g) => ({
        label: `${cat.label} — ${g.label}`,
        totalAmount: g.totalAmount,
        totalFee: g.totalFee,
      }))
    );

    try {
      const res = await fetch("/api/reports/final-billing/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: reportEmail.trim(),
          startDate,
          endDate,
          grandTotalAmount,
          grandTotalFee,
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

  // Non-destructive: shows what's currently pending (not yet on any SOA) in
  // this period, exactly like the old single-step Generate used to, minus
  // the commit. See handleConfirmGenerate below for the actual commit step.
  async function handleSearch(e: React.FormEvent) {
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

    setSearching(true);
    setHasSearched(true);
    setSendStatus(null);
    try {
      const supabase = createClient();
      const rangeStart = `${startDate}T00:00:00`;
      const rangeEnd = `${endDate}T23:59:59.999`;

      const { data, error } = await supabase
        .from("v_final_billing")
        .select("*")
        .is("billing_statement_id", null)
        .gte("delivered_at", rangeStart)
        .lte("delivered_at", rangeEnd)
        .order("delivered_at", { ascending: true });

      if (error) {
        setErrorMsg("Could not load pending invoices. Connect a Supabase project to see live data.");
        setRows([]);
      } else {
        setRows(data ?? []);
      }
    } catch {
      setErrorMsg("Could not load pending invoices. Connect a Supabase project to see live data.");
      setRows([]);
    } finally {
      setSearching(false);
    }
  }

  // The actual commit: creates one mondial_billing_statements row (the SOA)
  // and stamps billing_statement_id on every matched invoice via the
  // SECURITY DEFINER RPC (see migration 0070 -- GENERAL_MANAGER can reach
  // this page but isn't covered by the invoices UPDATE policy, so this can't
  // be a plain client-side update). Once committed, these rows disappear
  // from this tab and reappear under Billed.
  async function handleConfirmGenerate() {
    if (rows.length === 0) return;
    const periodLabel = `${startDate} to ${endDate}`;
    if (
      !confirm(
        `Generate one billing statement (SOA) for ${rows.length} invoice(s) in the ${periodLabel} period? This cannot be undone from here -- these invoices will move to the Billed tab.`
      )
    ) {
      return;
    }

    setGenerating(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("generate_mondial_billing_statement", {
        p_period_start: startDate,
        p_period_end: endDate,
      });
      if (error) {
        showToast(`Failed to generate billing statement: ${error.message}`, "error");
        return;
      }

      let seriesLabel = "";
      if (data) {
        const { data: stmt } = await supabase
          .from("v_mondial_billing_statements")
          .select("series_no")
          .eq("id", data)
          .maybeSingle();
        seriesLabel = stmt?.series_no ? ` (${stmt.series_no})` : "";
      }

      showToast(`Billing statement generated${seriesLabel}. See the Billed tab.`, "success");
      await sendReportEmail(rows);
      setRows([]);
      setHasSearched(false);
    } catch {
      showToast("Could not generate the billing statement.", "error");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSearch} className="card mt-4 flex flex-wrap items-end gap-4">
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
        <button type="submit" className="btn-primary" disabled={searching}>
          {searching ? "Searching…" : "Search"}
        </button>
        <p className="w-full text-xs text-gray-400">
          Shows confirmed, delivered invoices in this period that have not yet been billed to
          Mondial. Search first to review, then confirm below to generate the SOA.
        </p>
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
          When a billing statement is generated, a summary is automatically emailed to this
          address.
        </p>
      </div>

      {errorMsg && <p className="mt-4 text-sm text-red-600">{errorMsg}</p>}
      {sendStatus && <p className="mt-2 text-sm text-gray-500">{sendStatus}</p>}

      {hasSearched && !searching && !errorMsg && (
        <>
          {rows.length > 0 && (
            <div className="card mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-600">
                {rows.length} invoice(s) pending for {startDate} to {endDate}.
              </p>
              <button
                type="button"
                className="btn-primary"
                onClick={handleConfirmGenerate}
                disabled={generating}
              >
                {generating ? "Generating…" : "Confirm & Generate SOA"}
              </button>
            </div>
          )}
          <BillingReportView
            rows={rows}
            periodLabel={`Delivery Period: ${startDate} to ${endDate}`}
            onExport={() => exportBillingReport(rows, startDate, endDate)}
          />
        </>
      )}
    </>
  );
}

function BilledTab() {
  const [statements, setStatements] = useState<VMondialBillingStatement[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailRows, setDetailRows] = useState<Record<string, VFinalBilling[]>>({});
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("v_mondial_billing_statements")
        .select("*")
        .order("generated_at", { ascending: false });
      if (error) {
        setErrorMsg("Could not load billing statements. Connect a Supabase project to see live data.");
        setStatements([]);
      } else {
        setStatements(data ?? []);
      }
    } catch {
      setErrorMsg("Could not load billing statements. Connect a Supabase project to see live data.");
      setStatements([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleExpand(stmt: VMondialBillingStatement) {
    if (expandedId === stmt.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(stmt.id);
    if (detailRows[stmt.id]) return;

    setLoadingDetailId(stmt.id);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("v_final_billing")
        .select("*")
        .eq("billing_statement_id", stmt.id)
        .order("delivered_at", { ascending: true });
      if (!error) {
        setDetailRows((prev) => ({ ...prev, [stmt.id]: data ?? [] }));
      }
    } finally {
      setLoadingDetailId(null);
    }
  }

  return (
    <div className="card mt-4">
      <h2 className="text-sm font-semibold text-gray-700">Billed SOAs</h2>
      <p className="text-xs text-gray-400">
        Every generated Mondial billing statement, one row per Generate click on the For Billing
        tab. Click a row to see its full breakdown.
      </p>

      {loading && <p className="mt-3 text-sm text-gray-400">Loading…</p>}
      {!loading && errorMsg && <p className="mt-3 text-sm text-gray-400">{errorMsg}</p>}
      {!loading && !errorMsg && statements.length === 0 && (
        <p className="mt-3 text-sm text-gray-400">No billing statements generated yet.</p>
      )}

      {!loading && !errorMsg && statements.length > 0 && (
        <div className="mt-3 table-scroll-container">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                <th className="py-2 pr-4"></th>
                <th className="py-2 pr-4">SOA #</th>
                <th className="py-2 pr-4">Billing Period</th>
                <th className="py-2 pr-4 text-right">Invoices</th>
                <th className="py-2 pr-4 text-right">Total Amount</th>
                <th className="py-2 pr-4 text-right">Fulfillment Fee</th>
                <th className="py-2 pr-4">Generated By</th>
                <th className="py-2 pr-4">Generated At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {statements.map((stmt) => (
                <Fragment key={stmt.id}>
                  <tr
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => toggleExpand(stmt)}
                  >
                    <td className="py-2 pl-4 pr-2 text-gray-500">
                      {expandedId === stmt.id ? "▾" : "▸"}
                    </td>
                    <td className="py-2 pr-4 font-medium text-gray-800">{stmt.series_no}</td>
                    <td className="py-2 pr-4">
                      {formatDate(stmt.period_start)} – {formatDate(stmt.period_end)}
                    </td>
                    <td className="py-2 pr-4 text-right">{stmt.line_count}</td>
                    <td className="py-2 pr-4 text-right">{formatMoney(stmt.total_amount)}</td>
                    <td className="py-2 pr-4 text-right">{formatMoney(stmt.total_fee)}</td>
                    <td className="py-2 pr-4">{stmt.generated_by_name ?? "—"}</td>
                    <td className="py-2 pr-4">{formatDate(stmt.generated_at)}</td>
                  </tr>
                  {expandedId === stmt.id && (
                    <tr>
                      <td colSpan={8} className="bg-gray-50/50 p-4">
                        {loadingDetailId === stmt.id && (
                          <p className="text-sm text-gray-400">Loading…</p>
                        )}
                        {loadingDetailId !== stmt.id && (
                          <BillingReportView
                            rows={detailRows[stmt.id] ?? []}
                            periodLabel={`${stmt.series_no} — ${formatDate(stmt.period_start)} to ${formatDate(
                              stmt.period_end
                            )}`}
                            onExport={() =>
                              exportBillingReport(
                                detailRows[stmt.id] ?? [],
                                stmt.period_start,
                                stmt.period_end
                              )
                            }
                          />
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

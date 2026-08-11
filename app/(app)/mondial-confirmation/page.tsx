"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import RequireRole from "@/components/RequireRole";
import { exportToExcel } from "@/lib/exportExcel";
import type { VBilling, MondialConfirmation, InvoiceCategory } from "@/types/database";

interface MergedRow extends VBilling {
  confirmed: boolean;
  confirmed_at: string | null;
}

const TABS: { value: InvoiceCategory; label: string }[] = [
  { value: "CONSIGNMENT", label: "Consignment" },
  { value: "OUTRIGHT", label: "Outright" },
  { value: "MERCURY_DRUG", label: "FLO-Mercury" },
];

function formatMoney(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function MondialConfirmationPage() {
  const [activeTab, setActiveTab] = useState<InvoiceCategory>("CONSIGNMENT");
  const [confirmedBy, setConfirmedBy] = useState("");
  const [rows, setRows] = useState<MergedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const supabase = createClient();
      const [
        { data: billing, error: billingErr },
        { data: confirmations, error: confirmErr },
      ] = await Promise.all([
        supabase.from("v_billing").select("*").order("delivered_at", { ascending: true }),
        supabase.from("mondial_confirmations").select("*"),
      ]);

      if (billingErr || confirmErr) {
        setErrorMsg("Could not load billing data. Connect a Supabase project to see live data.");
        setRows([]);
        return;
      }

      const confirmByInvoice = new Map<string, MondialConfirmation>();
      (confirmations ?? []).forEach((c) => {
        if (c.invoice_id) confirmByInvoice.set(c.invoice_id, c);
      });

      const merged: MergedRow[] = (billing ?? []).map((b) => {
        const c = confirmByInvoice.get(b.invoice_id);
        return {
          ...b,
          confirmed: c?.confirmed ?? false,
          confirmed_at: c?.confirmed_at ?? null,
        };
      });

      setRows(merged);
    } catch {
      setErrorMsg("Could not load billing data. Connect a Supabase project to see live data.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleToggle(row: MergedRow) {
    setBusyId(row.invoice_id);
    setActionError(null);
    try {
      const supabase = createClient();
      const nextConfirmed = !row.confirmed;
      const { error } = await supabase.from("mondial_confirmations").upsert(
        {
          invoice_id: row.invoice_id,
          confirmed: nextConfirmed,
          confirmed_at: nextConfirmed ? new Date().toISOString() : null,
          confirmed_by: confirmedBy.trim() || null,
        },
        { onConflict: "invoice_id" }
      );

      if (error) {
        setActionError(`Failed to update confirmation: ${error.message}`);
        return;
      }
      await load();
    } catch {
      setActionError("Could not update confirmation. Make sure a Supabase project is connected.");
    } finally {
      setBusyId(null);
    }
  }

  // Unconfirmed rows first so Mondial can see what's left to confirm without
  // scrolling past everything already done; within each group keep the
  // original delivered_at ascending order from the query.
  const visibleRows = rows
    .filter((row) => row.category === activeTab)
    .sort((a, b) => {
      if (a.confirmed !== b.confirmed) return a.confirmed ? 1 : -1;
      return 0;
    });

  function handleExport() {
    exportToExcel(`mondial-confirmation-${activeTab.toLowerCase()}`, [
      {
        name: activeTab.replace("_", " "),
        rows: visibleRows.map((row) => ({
          "Document No.": row.document_no,
          Amount: row.amount,
          "Service Fee": row.service_fee ?? 0,
          Delivered: row.delivered_at ? new Date(row.delivered_at).toLocaleDateString() : "",
          Status: row.confirmed ? "Confirmed" : "Unconfirmed",
          Remarks: row.is_mondial_fault_charge
            ? `Charged to Mondial — backload: ${row.reason_label ?? "reason not set"}`
            : "",
        })),
      },
    ]);
  }

  return (
    <RequireRole roles={["ADMIN", "MONDIAL_TEAM", "INVOICING_TEAM"]}>
    <div>
      <div className="page-header border-b-0 pb-0">
        <div>
          <h1 className="page-title">Mondial Confirmation</h1>
          <p className="page-subtitle">
            Let Mondial&apos;s invoice department confirm delivered invoices before final billing.
          </p>
        </div>
      </div>

      <div className="card mt-6">
        <label className="label" htmlFor="confirmedBy">
          Confirmed by (name)
        </label>
        <input
          id="confirmedBy"
          type="text"
          className="input max-w-xs"
          placeholder="e.g. Juan Dela Cruz"
          value={confirmedBy}
          onChange={(e) => setConfirmedBy(e.target.value)}
        />
        <p className="mt-1 text-xs text-gray-400">
          Used as the confirmer name for actions you take on this page.
        </p>
      </div>

      {actionError && <p className="mt-4 text-sm text-red-600">{actionError}</p>}

      <div className="card mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-800">Delivered Invoices</h2>
          {visibleRows.length > 0 && (
            <button
              type="button"
              className="tab-button tab-button-inactive"
              onClick={handleExport}
            >
              Export to Excel
            </button>
          )}
        </div>

        <div className="mt-3 flex gap-2 border-b border-gray-200 pb-2">
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

        {loading && <p className="mt-3 text-sm text-gray-400">Loading…</p>}
        {!loading && errorMsg && <p className="mt-3 text-sm text-gray-400">{errorMsg}</p>}
        {!loading && !errorMsg && visibleRows.length === 0 && (
          <p className="mt-3 text-sm text-gray-400">No delivered invoices yet.</p>
        )}
        {!loading && !errorMsg && visibleRows.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                  <th className="py-2 pr-4">Document No.</th>
                  <th className="py-2 pr-4">Amount</th>
                  <th className="py-2 pr-4">Service Fee</th>
                  <th className="py-2 pr-4">Delivered</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Remarks</th>
                  <th className="py-2 pr-4">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleRows.map((row) => (
                  <tr key={row.invoice_id} className={row.confirmed ? "bg-green-50" : undefined}>
                    <td className="py-2 pr-4 font-medium text-gray-800">{row.document_no}</td>
                    <td className="py-2 pr-4">{formatMoney(row.amount)}</td>
                    <td className="py-2 pr-4">{formatMoney(row.service_fee ?? 0)}</td>
                    <td className="py-2 pr-4">
                      {row.delivered_at ? new Date(row.delivered_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="py-2 pr-4">
                      {row.confirmed ? (
                        <span className="badge-success">Confirmed</span>
                      ) : (
                        <span className="text-gray-400">Unconfirmed</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {row.is_mondial_fault_charge ? (
                        <span className="badge-warning">
                          Charged to Mondial — backload: {row.reason_label ?? "reason not set"}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <button
                        type="button"
                        className={row.confirmed ? "tab-button tab-button-inactive" : "btn-primary"}
                        onClick={() => handleToggle(row)}
                        disabled={busyId === row.invoice_id}
                      >
                        {busyId === row.invoice_id
                          ? "Saving…"
                          : row.confirmed
                            ? "Un-confirm"
                            : "Confirm Received"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </RequireRole>
  );
}

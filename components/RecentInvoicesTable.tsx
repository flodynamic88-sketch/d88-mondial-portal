"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { exportToExcel } from "@/lib/exportExcel";
import { findOrCreateBranchAddress, findOrCreateCompany } from "@/lib/invoiceHelpers";
import type { Invoice, InvoiceCategory, ZoneType } from "@/types/database";

interface RecentInvoicesTableProps {
  refreshKey: number;
}

const TABS: { value: InvoiceCategory; label: string }[] = [
  { value: "CONSIGNMENT", label: "Consignment" },
  { value: "OUTRIGHT", label: "Outright" },
  { value: "MERCURY_DRUG", label: "Mercury Drug" },
];

const ZONE_OPTIONS: { value: ZoneType; label: string }[] = [
  { value: "NCR", label: "NCR" },
  { value: "FAR_NORTH_SOUTH", label: "Far North / South" },
  { value: "VIZMIN", label: "VisMin" },
];

function formatMoney(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function RecentInvoicesTable({ refreshKey }: RecentInvoicesTableProps) {
  const [activeTab, setActiveTab] = useState<InvoiceCategory>("CONSIGNMENT");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [companyOptions, setCompanyOptions] = useState<string[]>([]);
  const [branchOptions, setBranchOptions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErrorMsg(null);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("invoices")
          .select("*")
          .eq("category", activeTab)
          .order("created_at", { ascending: false })
          .limit(20);

        if (cancelled) return;

        if (error) {
          setErrorMsg(
            "Could not load recent invoices. Connect a Supabase project to see live data."
          );
          setInvoices([]);
        } else {
          setInvoices(data ?? []);
        }
      } catch {
        if (!cancelled) {
          setErrorMsg(
            "Could not load recent invoices. Connect a Supabase project to see live data."
          );
          setInvoices([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [activeTab, refreshKey]);

  useEffect(() => {
    async function loadOptions() {
      try {
        const supabase = createClient();
        const [{ data: companies }, { data: branches }] = await Promise.all([
          supabase.from("companies").select("name").order("name").limit(500),
          supabase.from("branch_addresses").select("address").order("address").limit(500),
        ]);
        setCompanyOptions((companies ?? []).map((c) => c.name));
        setBranchOptions((branches ?? []).map((b) => b.address));
      } catch {
        // Non-fatal: datalist suggestions just won't be populated.
      }
    }
    loadOptions();
  }, []);

  function updateLocal(id: string, patch: Partial<Invoice>) {
    setInvoices((prev) => prev.map((inv) => (inv.id === id ? { ...inv, ...patch } : inv)));
  }

  async function saveField(id: string, patch: Record<string, unknown>) {
    setSavingId(id);
    setRowErrors((prev) => ({ ...prev, [id]: "" }));
    try {
      const supabase = createClient();
      const { error } = await supabase.from("invoices").update(patch).eq("id", id);
      if (error) {
        setRowErrors((prev) => ({ ...prev, [id]: error.message }));
      }
    } catch {
      setRowErrors((prev) => ({ ...prev, [id]: "Could not save. Check your connection." }));
    } finally {
      setSavingId(null);
    }
  }

  // Immediate-commit fields (select/checkbox): update local state + save together.
  function handleImmediateChange(inv: Invoice, patch: Partial<Invoice>) {
    updateLocal(inv.id, patch);
    saveField(inv.id, patch as Record<string, unknown>);
  }

  // Text/number/date fields: keep local state responsive while typing, and
  // only save on blur so we're not firing a request per keystroke.
  function handleTextChange<K extends keyof Invoice>(inv: Invoice, key: K, value: string) {
    updateLocal(inv.id, { [key]: value } as unknown as Partial<Invoice>);
  }

  async function handleTextBlur<K extends keyof Invoice>(inv: Invoice, key: K) {
    const current = invoices.find((r) => r.id === inv.id);
    if (!current) return;
    await saveField(inv.id, { [key]: current[key] ?? null });
  }

  async function handleCompanyBlur(inv: Invoice) {
    const current = invoices.find((r) => r.id === inv.id);
    if (!current) return;
    const nameTrimmed = (current.company_name_raw ?? "").trim();
    const companyId = nameTrimmed ? await findOrCreateCompany(nameTrimmed) : null;
    updateLocal(inv.id, { company_id: companyId });
    await saveField(inv.id, { company_name_raw: nameTrimmed || null, company_id: companyId });
  }

  async function handleBranchBlur(inv: Invoice) {
    const current = invoices.find((r) => r.id === inv.id);
    if (!current) return;
    const addressTrimmed = (current.branch_address ?? "").trim();
    if (addressTrimmed) {
      await findOrCreateBranchAddress(addressTrimmed, current.company_id);
    }
    await saveField(inv.id, { branch_address: addressTrimmed || null });
  }

  async function handleDelete(inv: Invoice) {
    const confirmed = window.confirm(
      `Sigurado ka bang gusto mong i-delete ang invoice ${inv.document_no}? Hindi na ito mababawi.`
    );
    if (!confirmed) return;

    setDeletingId(inv.id);
    setDeleteError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("invoices").delete().eq("id", inv.id);

      if (error) {
        if (error.code === "23503") {
          setDeleteError(
            `Hindi pwedeng i-delete ang ${inv.document_no} kasi naka-assign na ito sa isang route plan/truck. Alisin muna ito sa route plan bago i-delete.`
          );
        } else {
          setDeleteError(`Failed to delete ${inv.document_no}: ${error.message}`);
        }
        return;
      }

      setInvoices((prev) => prev.filter((row) => row.id !== inv.id));
    } catch {
      setDeleteError("Could not delete invoice. Make sure a Supabase project is connected.");
    } finally {
      setDeletingId(null);
    }
  }

  function handleExport() {
    exportToExcel(`recent-invoices-${activeTab.toLowerCase()}`, [
      {
        name: activeTab.replace("_", " "),
        rows: invoices.map((inv) => ({
          "Document No.": inv.document_no,
          Zone: inv.zone ?? "",
          DC: inv.is_dc ? "Yes" : "No",
          "Retail Chain / Account": inv.company_name_raw ?? "",
          "Branch/Store": inv.branch_address ?? "",
          Amount: inv.amount,
          "Posting Date": inv.posting_date ?? "",
          "Plan Date": inv.plan_date ?? "",
          "Transmittal Date": inv.transmittal_received_date ?? "",
          Month: inv.billing_period ?? "",
          Remarks: inv.remarks ?? "",
          Status: inv.status,
        })),
      },
    ]);
  }

  return (
    <div className="card mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-800">Recently Encoded</h2>
        {invoices.length > 0 && (
          <button type="button" className="tab-button tab-button-inactive" onClick={handleExport}>
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
      {!loading && !errorMsg && invoices.length === 0 && (
        <p className="mt-3 text-sm text-gray-400">No invoices encoded yet.</p>
      )}
      {deleteError && <p className="mt-3 text-sm text-red-600">{deleteError}</p>}

      {!loading && !errorMsg && invoices.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                <th className="py-2 pr-2 min-w-[130px]">Document No.</th>
                <th className="py-2 pr-2 min-w-[130px]">Zone</th>
                <th className="py-2 pr-2">DC</th>
                <th className="py-2 pr-2 min-w-[170px]">Retail Chain / Account</th>
                <th className="py-2 pr-2 min-w-[180px]">Branch/Store Address</th>
                <th className="py-2 pr-2 min-w-[110px]">Amount</th>
                <th className="py-2 pr-2 min-w-[140px]">Posting Date</th>
                <th className="py-2 pr-2 min-w-[140px]">Plan Date</th>
                <th className="py-2 pr-2 min-w-[140px]">Transmittal Date</th>
                <th className="py-2 pr-2 min-w-[140px]">Month</th>
                <th className="py-2 pr-2 min-w-[160px]">Remarks</th>
                <th className="py-2 pr-2">Status</th>
                <th className="py-2 pr-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="py-1 pr-2">
                    <input
                      type="text"
                      className="input"
                      value={inv.document_no}
                      onChange={(e) => handleTextChange(inv, "document_no", e.target.value)}
                      onBlur={() => handleTextBlur(inv, "document_no")}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <select
                      className="input"
                      value={inv.zone ?? ""}
                      onChange={(e) =>
                        handleImmediateChange(inv, {
                          zone: (e.target.value || null) as ZoneType | null,
                        })
                      }
                    >
                      <option value="">Not set</option>
                      {ZONE_OPTIONS.map((z) => (
                        <option key={z.value} value={z.value}>
                          {z.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2 text-center">
                    <input
                      type="checkbox"
                      checked={inv.is_dc}
                      onChange={(e) => handleImmediateChange(inv, { is_dc: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="text"
                      list="recent-company-options"
                      className="input"
                      value={inv.company_name_raw ?? ""}
                      onChange={(e) => handleTextChange(inv, "company_name_raw", e.target.value)}
                      onBlur={() => handleCompanyBlur(inv)}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="text"
                      list="recent-branch-options"
                      className="input"
                      value={inv.branch_address ?? ""}
                      onChange={(e) => handleTextChange(inv, "branch_address", e.target.value)}
                      onBlur={() => handleBranchBlur(inv)}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="input"
                      value={inv.amount}
                      onChange={(e) => handleTextChange(inv, "amount", e.target.value)}
                      onBlur={async () => {
                        const current = invoices.find((r) => r.id === inv.id);
                        if (!current) return;
                        const num = Number(current.amount);
                        if (!Number.isNaN(num)) await saveField(inv.id, { amount: num });
                      }}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="date"
                      className="input"
                      value={inv.posting_date ?? ""}
                      onChange={(e) => handleTextChange(inv, "posting_date", e.target.value)}
                      onBlur={() => handleTextBlur(inv, "posting_date")}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="date"
                      className="input"
                      value={inv.plan_date ?? ""}
                      onChange={(e) => handleTextChange(inv, "plan_date", e.target.value)}
                      onBlur={() => handleTextBlur(inv, "plan_date")}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="date"
                      className="input"
                      value={inv.transmittal_received_date ?? ""}
                      onChange={(e) =>
                        handleTextChange(inv, "transmittal_received_date", e.target.value)
                      }
                      onBlur={() => handleTextBlur(inv, "transmittal_received_date")}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="date"
                      className="input"
                      value={inv.billing_period ?? ""}
                      onChange={(e) => handleTextChange(inv, "billing_period", e.target.value)}
                      onBlur={() => handleTextBlur(inv, "billing_period")}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="text"
                      className="input"
                      value={inv.remarks ?? ""}
                      onChange={(e) => handleTextChange(inv, "remarks", e.target.value)}
                      onBlur={() => handleTextBlur(inv, "remarks")}
                    />
                  </td>
                  <td className="py-2 pr-2 whitespace-nowrap">
                    {inv.status}
                    {savingId === inv.id && (
                      <span className="ml-1 text-xs text-gray-400">saving…</span>
                    )}
                    {rowErrors[inv.id] && (
                      <p className="text-xs text-red-600">{rowErrors[inv.id]}</p>
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    <button
                      type="button"
                      className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                      onClick={() => handleDelete(inv)}
                      disabled={deletingId === inv.id}
                    >
                      {deletingId === inv.id ? "Deleting…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <datalist id="recent-company-options">
        {companyOptions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="recent-branch-options">
        {branchOptions.map((address) => (
          <option key={address} value={address} />
        ))}
      </datalist>

      <p className="mt-3 text-xs text-gray-400">
        Amount: {formatMoney(invoices.reduce((sum, r) => sum + (r.amount ?? 0), 0))} total shown
        above.
      </p>
    </div>
  );
}

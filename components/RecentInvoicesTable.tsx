"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { exportToExcel } from "@/lib/exportExcel";
import { findOrCreateBranchAddress, findOrCreateCompany } from "@/lib/invoiceHelpers";
import { dateToMonthValue, monthValueToDate } from "@/lib/dateHelpers";
import type { Invoice, InvoiceCategory, ZoneType } from "@/types/database";

interface RecentInvoicesTableProps {
  refreshKey: number;
  readOnly?: boolean;
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

function statusBadgeClass(status: Invoice["status"]) {
  switch (status) {
    case "DELIVERED":
      return "badge-success";
    case "CANCELLED":
      return "badge-danger";
    case "DISPATCHED":
      return "badge-info";
    default:
      return "badge-neutral";
  }
}

const PAGE_SIZE = 20;

export default function RecentInvoicesTable({ refreshKey, readOnly = false }: RecentInvoicesTableProps) {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<InvoiceCategory>("CONSIGNMENT");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [companyOptions, setCompanyOptions] = useState<string[]>([]);
  const [branchOptions, setBranchOptions] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [hasMore, setHasMore] = useState(false);

  // Debounce the search box so we're not firing a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErrorMsg(null);
      try {
        const supabase = createClient();
        let query = supabase
          .from("invoices")
          .select("*")
          .eq("category", activeTab);
        if (search) {
          query = query.or(
            `document_no.ilike.%${search}%,company_name_raw.ilike.%${search}%,branch_address.ilike.%${search}%`
          );
        }
        const { data, error } = await query
          .order("created_at", { ascending: false })
          .range(0, PAGE_SIZE - 1);

        if (cancelled) return;

        if (error) {
          setErrorMsg(
            "Could not load recent invoices. Connect a Supabase project to see live data."
          );
          setInvoices([]);
          setHasMore(false);
        } else {
          setInvoices(data ?? []);
          setHasMore((data ?? []).length === PAGE_SIZE);
        }
      } catch {
        if (!cancelled) {
          setErrorMsg(
            "Could not load recent invoices. Connect a Supabase project to see live data."
          );
          setInvoices([]);
          setHasMore(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [activeTab, refreshKey, search]);

  async function handleLoadMore() {
    setLoadingMore(true);
    try {
      const supabase = createClient();
      let query = supabase.from("invoices").select("*").eq("category", activeTab);
      if (search) {
        query = query.or(
          `document_no.ilike.%${search}%,company_name_raw.ilike.%${search}%,branch_address.ilike.%${search}%`
        );
      }
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .range(invoices.length, invoices.length + PAGE_SIZE - 1);
      if (!error) {
        setInvoices((prev) => [...prev, ...(data ?? [])]);
        setHasMore((data ?? []).length === PAGE_SIZE);
      }
    } finally {
      setLoadingMore(false);
    }
  }

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

  // Month is entered as "YYYY-MM" (no day), but stored as a full date
  // (first of month), so it gets its own change/blur handlers.
  function handleMonthChange(inv: Invoice, value: string) {
    updateLocal(inv.id, { billing_period: value } as unknown as Partial<Invoice>);
  }

  async function handleMonthBlur(inv: Invoice) {
    const current = invoices.find((r) => r.id === inv.id);
    if (!current) return;
    const dateValue = monthValueToDate(dateToMonthValue(current.billing_period));
    updateLocal(inv.id, { billing_period: dateValue });
    await saveField(inv.id, { billing_period: dateValue });
  }

  // Plan Date / Posting Date / Transmittal Date: native <input type="date">
  // fires onChange with an *empty* value while a segment is mid-edit (e.g.
  // clicking in to change just the day of an already-set date briefly
  // clears it before the new digits are typed). Previously these inputs were
  // controlled straight off `invoices` state, so that transient empty value
  // got echoed back into the input (looked like the date "disappeared") and
  // then saved for real on blur -- silently wiping a date the user was only
  // trying to edit, not clear. Making the input uncontrolled (defaultValue +
  // a key that only changes once the *committed* value changes) keeps
  // in-progress typing entirely in the DOM; we only read/save the final
  // value once the field is actually blurred.
  async function handleDateFieldBlur<K extends keyof Invoice>(
    inv: Invoice,
    key: K,
    value: string
  ) {
    const nextValue = (value || null) as Invoice[K];
    updateLocal(inv.id, { [key]: nextValue } as unknown as Partial<Invoice>);
    await saveField(inv.id, { [key]: nextValue });
  }

  // Actual Delivery Date can be set here directly for invoices that never go
  // through a Route Plan truck (e.g. hand-delivered / walk-in documents).
  // Mirrors the sync_invoice_delivery_date trigger's semantics (see
  // 0011_delivery_date_sync.sql) so status stays consistent whichever path
  // set the delivery date, and so the invoice becomes eligible for
  // Transmittal generation (which only checks invoices.actual_delivery_date,
  // not whether the invoice was ever assigned to a Route Plan).
  async function handleDeliveryDateBlur(inv: Invoice, value: string) {
    const nextValue = value || null;
    const status = nextValue ? "DELIVERED" : inv.status === "DELIVERED" ? "PENDING" : inv.status;
    updateLocal(inv.id, { actual_delivery_date: nextValue, status });
    await saveField(inv.id, { actual_delivery_date: nextValue, status });
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
      `Are you sure you want to delete invoice ${inv.document_no}? This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingId(inv.id);
    setDeleteError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("invoices").delete().eq("id", inv.id);

      if (error) {
        if (error.code === "23503") {
          // Postgres includes the blocking table name in `details`, e.g.
          // `Key (id)=(...) is still referenced from table "transmittal_items".`
          // Route plan assignment is NOT the only thing that can block a
          // delete -- an invoice that's already been included in a
          // transmittal is blocked too, and there's currently no UI to
          // remove a single invoice from a transmittal (only deleting the
          // whole transmittal frees it). Report the real cause instead of
          // always blaming "route plan/truck".
          const details = error.details ?? "";
          let msg: string;
          if (inv.transmittal_id || details.includes("transmittal_items")) {
            msg = `Cannot delete ${inv.document_no} because it has already been included in a transmittal. The only way to free it is to delete that entire transmittal (Admin > Transmittals) -- there's no way to remove a single invoice from a transmittal yet.`;
          } else if (details.includes("route_plan_invoices")) {
            msg = `Cannot delete ${inv.document_no} because it's still linked to a route plan/truck (possibly a superseded/rescheduled assignment, not just the current one). Remove it from the route plan first before deleting.`;
          } else {
            msg = `Cannot delete ${inv.document_no} because other records still reference it${
              details ? ` (${details})` : ""
            }. Remove those first.`;
          }
          setDeleteError(msg);
          showToast(msg, "error");
        } else {
          const msg = `Failed to delete ${inv.document_no}: ${error.message}`;
          setDeleteError(msg);
          showToast(msg, "error");
        }
        return;
      }

      showToast(`Deleted invoice ${inv.document_no}.`, "success");
      setInvoices((prev) => prev.filter((row) => row.id !== inv.id));
    } catch {
      setDeleteError("Could not delete invoice. Make sure a Supabase project is connected.");
      showToast("Could not delete invoice.", "error");
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
          "Actual Delivery Date": inv.actual_delivery_date ?? "",
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

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-2">
        <div className="flex gap-2">
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
        <input
          type="text"
          className="input-sm max-w-[220px]"
          placeholder="Search doc #, retail chain, branch…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      {loading && <p className="mt-3 text-sm text-gray-400">Loading…</p>}
      {!loading && errorMsg && <p className="mt-3 text-sm text-gray-400">{errorMsg}</p>}
      {!loading && !errorMsg && invoices.length === 0 && (
        <p className="mt-3 text-sm text-gray-400">
          {search ? `No invoices match "${search}".` : "No invoices encoded yet."}
        </p>
      )}
      {deleteError && <p className="mt-3 text-sm text-red-600">{deleteError}</p>}

      {!loading && !errorMsg && invoices.length > 0 && (
        <div className="mt-3 table-scroll-container">
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase text-gray-500">
                <th className="py-1.5 pr-1.5 min-w-[105px]">Document No.</th>
                <th className="py-1.5 pr-1.5 min-w-[95px]">Zone</th>
                <th className="py-1.5 pr-1.5">DC</th>
                <th className="py-1.5 pr-1.5 min-w-[135px]">Retail Chain / Account</th>
                <th className="py-1.5 pr-1.5 min-w-[140px]">Branch/Store Address</th>
                <th className="py-1.5 pr-1.5 min-w-[85px]">Amount</th>
                <th className="py-1.5 pr-1.5 min-w-[105px]">Posting Date</th>
                <th className="py-1.5 pr-1.5 min-w-[105px] bg-blue-50">Plan Date</th>
                <th className="py-1.5 pr-1.5 min-w-[115px] bg-amber-50">Actual Delivery Date</th>
                <th className="py-1.5 pr-1.5 min-w-[105px] bg-emerald-50">Transmittal Date</th>
                <th className="py-1.5 pr-1.5 min-w-[95px]">Month</th>
                <th className="py-1.5 pr-1.5 min-w-[115px]">Remarks</th>
                <th className="py-1.5 pr-1.5">Status</th>
                <th className="py-1.5 pr-1.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="py-0.5 pr-1.5">
                    <input
                      type="text"
                      className="input-sm"
                      value={inv.document_no}
                      onChange={(e) => handleTextChange(inv, "document_no", e.target.value)}
                      onBlur={() => handleTextBlur(inv, "document_no")}
                      disabled={readOnly}
                    />
                  </td>
                  <td className="py-0.5 pr-1.5">
                    <select
                      className="input-sm"
                      value={inv.zone ?? ""}
                      onChange={(e) =>
                        handleImmediateChange(inv, {
                          zone: (e.target.value || null) as ZoneType | null,
                        })
                      }
                      disabled={readOnly}
                    >
                      <option value="">Not set</option>
                      {ZONE_OPTIONS.map((z) => (
                        <option key={z.value} value={z.value}>
                          {z.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-0.5 pr-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={inv.is_dc}
                      onChange={(e) => handleImmediateChange(inv, { is_dc: e.target.checked })}
                      className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      disabled={readOnly}
                    />
                  </td>
                  <td className="py-0.5 pr-1.5">
                    <input
                      type="text"
                      list="recent-company-options"
                      className="input-sm"
                      value={inv.company_name_raw ?? ""}
                      onChange={(e) => handleTextChange(inv, "company_name_raw", e.target.value)}
                      onBlur={() => handleCompanyBlur(inv)}
                      disabled={readOnly}
                    />
                  </td>
                  <td className="py-0.5 pr-1.5">
                    <input
                      type="text"
                      list="recent-branch-options"
                      className="input-sm"
                      value={inv.branch_address ?? ""}
                      onChange={(e) => handleTextChange(inv, "branch_address", e.target.value)}
                      onBlur={() => handleBranchBlur(inv)}
                      disabled={readOnly}
                    />
                  </td>
                  <td className="py-0.5 pr-1.5">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="input-sm"
                      value={inv.amount}
                      onChange={(e) => handleTextChange(inv, "amount", e.target.value)}
                      onBlur={async () => {
                        const current = invoices.find((r) => r.id === inv.id);
                        if (!current) return;
                        const num = Number(current.amount);
                        if (!Number.isNaN(num)) await saveField(inv.id, { amount: num });
                      }}
                      disabled={readOnly}
                    />
                  </td>
                  <td className="py-0.5 pr-1.5">
                    <input
                      type="date"
                      className="input-sm"
                      defaultValue={inv.posting_date ?? ""}
                      key={`${inv.id}-posting_date-${inv.posting_date ?? ""}`}
                      onBlur={(e) => handleDateFieldBlur(inv, "posting_date", e.target.value)}
                      disabled={readOnly}
                    />
                  </td>
                  <td className="py-0.5 pr-1.5 bg-blue-50/60">
                    <input
                      type="date"
                      className="input-sm"
                      defaultValue={inv.plan_date ?? ""}
                      key={`${inv.id}-plan_date-${inv.plan_date ?? ""}`}
                      onBlur={(e) => handleDateFieldBlur(inv, "plan_date", e.target.value)}
                      disabled={readOnly}
                    />
                  </td>
                  <td className="py-0.5 pr-1.5 bg-amber-50/60">
                    <input
                      type="date"
                      className="input-sm"
                      defaultValue={inv.actual_delivery_date ?? ""}
                      key={`${inv.id}-actual_delivery_date-${inv.actual_delivery_date ?? ""}`}
                      onBlur={(e) => handleDeliveryDateBlur(inv, e.target.value)}
                      disabled={readOnly}
                    />
                  </td>
                  <td className="py-0.5 pr-1.5 bg-emerald-50/60">
                    <input
                      type="date"
                      className="input-sm"
                      defaultValue={inv.transmittal_received_date ?? ""}
                      key={`${inv.id}-transmittal_received_date-${inv.transmittal_received_date ?? ""}`}
                      onBlur={(e) =>
                        handleDateFieldBlur(inv, "transmittal_received_date", e.target.value)
                      }
                      disabled={readOnly}
                    />
                  </td>
                  <td className="py-0.5 pr-1.5">
                    <input
                      type="month"
                      className="input-sm"
                      value={dateToMonthValue(inv.billing_period)}
                      onChange={(e) => handleMonthChange(inv, e.target.value)}
                      onBlur={() => handleMonthBlur(inv)}
                      disabled={readOnly}
                    />
                  </td>
                  <td className="py-0.5 pr-1.5">
                    <input
                      type="text"
                      className="input-sm"
                      value={inv.remarks ?? ""}
                      onChange={(e) => handleTextChange(inv, "remarks", e.target.value)}
                      onBlur={() => handleTextBlur(inv, "remarks")}
                      disabled={readOnly}
                    />
                  </td>
                  <td className="py-1.5 pr-1.5 whitespace-nowrap">
                    <span className={statusBadgeClass(inv.status)}>{inv.status}</span>
                    {savingId === inv.id && (
                      <span className="ml-1 text-[11px] text-gray-400">saving…</span>
                    )}
                    {rowErrors[inv.id] && (
                      <p className="text-[11px] text-red-600">{rowErrors[inv.id]}</p>
                    )}
                  </td>
                  <td className="py-1.5 pr-1.5">
                    {!readOnly && (
                      <button
                        type="button"
                        className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                        onClick={() => handleDelete(inv)}
                        disabled={deletingId === inv.id}
                      >
                        {deletingId === inv.id ? "Deleting…" : "Delete"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !errorMsg && hasMore && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            className="tab-button tab-button-inactive"
            onClick={handleLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
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

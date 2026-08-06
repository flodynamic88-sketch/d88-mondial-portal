"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import RequireRole from "@/components/RequireRole";
import { useAuth } from "@/components/AuthProvider";
import { exportToExcel } from "@/lib/exportExcel";
import { getAppSetting, setAppSetting, LOGO_SETTING_KEY } from "@/lib/appSettings";
import type {
  VDeliveryVarianceLog,
  VDeliveryVarianceReasonSummary,
  DeliveryVarianceLogItem,
  DeliveryReason,
  ReturnedStatus,
  Invoice,
} from "@/types/database";

const RETURNED_STATUS_OPTIONS: { value: ReturnedStatus; label: string }[] = [
  { value: "NOT_RETURNED", label: "Not Returned" },
  { value: "RETURNED", label: "Returned" },
  { value: "PARTIAL", label: "Partial" },
];

function formatMoney(value: number) {
  return (value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

const emptyNewItem = {
  item_description: "",
  qty: "",
  unit: "",
  unit_price: "",
  returned_status: "NOT_RETURNED" as ReturnedStatus,
  remarks: "",
};

export default function DeliveryVarianceLogPage() {
  const profile = useAuth();
  const role = profile?.role;
  const canEdit = role === "ADMIN" || role === "LOGISTICS_ASSOCIATE" || role === "LOGISTICS_OFFICER";
  const canDeleteLog = role === "ADMIN";
  const canManageLogo = role === "ADMIN";

  const [logs, setLogs] = useState<VDeliveryVarianceLog[]>([]);
  const [reasonSummary, setReasonSummary] = useState<VDeliveryVarianceReasonSummary[]>([]);
  const [deliveryReasons, setDeliveryReasons] = useState<DeliveryReason[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState(firstOfMonthStr());
  const [dateTo, setDateTo] = useState(todayStr());
  const [search, setSearch] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<DeliveryVarianceLogItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [editLogDate, setEditLogDate] = useState("");
  const [editReasonId, setEditReasonId] = useState("");
  const [editPreparedBy, setEditPreparedBy] = useState("");
  const [editCheckedBy, setEditCheckedBy] = useState("");
  const [editReceivedBy1, setEditReceivedBy1] = useState("");
  const [editReceivedBy2, setEditReceivedBy2] = useState("");
  const [editRemarks, setEditRemarks] = useState("");
  const [savingHeader, setSavingHeader] = useState(false);

  const [newItem, setNewItem] = useState(emptyNewItem);
  const [savingItem, setSavingItem] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [docQuery, setDocQuery] = useState("");
  const [docSearching, setDocSearching] = useState(false);
  const [docInvoice, setDocInvoice] = useState<Invoice | null>(null);
  const [docNotFound, setDocNotFound] = useState(false);
  const [createReasonId, setCreateReasonId] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoSaving, setLogoSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const supabase = createClient();
      const [
        { data: logData, error: logErr },
        { data: summaryData },
        { data: reasonData },
      ] = await Promise.all([
        supabase
          .from("v_delivery_variance_logs")
          .select("*")
          .order("log_date", { ascending: false })
          .order("series_no", { ascending: false }),
        supabase.from("v_delivery_variance_reason_summary").select("*"),
        supabase.from("delivery_reasons").select("*").order("label", { ascending: true }),
      ]);

      if (logErr) {
        setErrorMsg(
          "Could not load delivery variance logs. Connect a Supabase project to see live data."
        );
        setLogs([]);
        return;
      }

      setLogs((logData ?? []) as VDeliveryVarianceLog[]);
      setReasonSummary((summaryData ?? []) as VDeliveryVarianceReasonSummary[]);
      setDeliveryReasons((reasonData ?? []) as DeliveryReason[]);
    } catch {
      setErrorMsg(
        "Could not load delivery variance logs. Connect a Supabase project to see live data."
      );
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    getAppSetting(LOGO_SETTING_KEY).then(setLogoUrl);
  }, []);

  const filteredLogs = useMemo(() => {
    const inRange = logs.filter((l) => l.log_date >= dateFrom && l.log_date <= dateTo);
    const q = search.trim().toLowerCase();
    if (!q) return inRange;
    return inRange.filter((l) =>
      [l.series_no, l.document_no, l.retail_chain, l.branch_address]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q))
    );
  }, [logs, dateFrom, dateTo, search]);

  const summary = useMemo(() => {
    const discrepancy = filteredLogs.filter((l) => l.reason_type === "DISCREPANCY").length;
    const backload = filteredLogs.filter((l) => l.reason_type === "BACKLOAD").length;
    const totalAmount = filteredLogs.reduce((sum, l) => sum + (l.total_amount ?? 0), 0);
    return { total: filteredLogs.length, discrepancy, backload, totalAmount };
  }, [filteredLogs]);

  const topReason = reasonSummary[0];

  async function loadItems(logId: string) {
    setItemsLoading(true);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("delivery_variance_log_items")
        .select("*")
        .eq("log_id", logId)
        .order("created_at", { ascending: true });
      setItems((data ?? []) as DeliveryVarianceLogItem[]);
    } finally {
      setItemsLoading(false);
    }
  }

  function openLog(log: VDeliveryVarianceLog) {
    setSelectedId(log.id);
    setEditLogDate(log.log_date);
    setEditReasonId(log.reason_id ?? "");
    setEditPreparedBy(log.prepared_by ?? "");
    setEditCheckedBy(log.checked_by ?? "");
    setEditReceivedBy1(log.received_by_1 ?? "");
    setEditReceivedBy2(log.received_by_2 ?? "");
    setEditRemarks(log.remarks ?? "");
    setNewItem(emptyNewItem);
    setActionError(null);
    loadItems(log.id);
  }

  function closePanel() {
    setSelectedId(null);
    setItems([]);
  }

  const selectedLog = logs.find((l) => l.id === selectedId) ?? null;

  async function handleSaveHeader() {
    if (!selectedId) return;
    setSavingHeader(true);
    setActionError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("delivery_variance_logs")
        .update({
          log_date: editLogDate,
          reason_id: editReasonId || null,
          prepared_by: editPreparedBy.trim() || null,
          checked_by: editCheckedBy.trim() || null,
          received_by_1: editReceivedBy1.trim() || null,
          received_by_2: editReceivedBy2.trim() || null,
          remarks: editRemarks.trim() || null,
        })
        .eq("id", selectedId);
      if (error) {
        setActionError(`Failed to save: ${error.message}`);
        return;
      }
      await load();
    } catch {
      setActionError("Could not save. Make sure a Supabase project is connected.");
    } finally {
      setSavingHeader(false);
    }
  }

  async function handleAddItem() {
    if (!selectedId) return;
    const desc = newItem.item_description.trim();
    if (!desc) {
      setActionError("Enter an item description before adding.");
      return;
    }
    setSavingItem(true);
    setActionError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("delivery_variance_log_items").insert({
        log_id: selectedId,
        item_description: desc,
        qty: Number(newItem.qty || 0),
        unit: newItem.unit.trim() || null,
        unit_price: Number(newItem.unit_price || 0),
        returned_status: newItem.returned_status,
        remarks: newItem.remarks.trim() || null,
      });
      if (error) {
        setActionError(`Failed to add item: ${error.message}`);
        return;
      }
      setNewItem(emptyNewItem);
      await loadItems(selectedId);
      await load();
    } catch {
      setActionError("Could not add item. Make sure a Supabase project is connected.");
    } finally {
      setSavingItem(false);
    }
  }

  async function handleUpdateItem(itemId: string, patch: Partial<DeliveryVarianceLogItem>) {
    setActionError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("delivery_variance_log_items")
        .update(patch)
        .eq("id", itemId);
      if (error) {
        setActionError(`Failed to update item: ${error.message}`);
        return;
      }
      if (selectedId) {
        await loadItems(selectedId);
        await load();
      }
    } catch {
      setActionError("Could not update item. Make sure a Supabase project is connected.");
    }
  }

  async function handleDeleteItem(itemId: string) {
    if (!confirm("Remove this item from the log?")) return;
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("delivery_variance_log_items")
        .delete()
        .eq("id", itemId);
      if (error) {
        setActionError(`Failed to remove item: ${error.message}`);
        return;
      }
      if (selectedId) {
        await loadItems(selectedId);
        await load();
      }
    } catch {
      setActionError("Could not remove item. Make sure a Supabase project is connected.");
    }
  }

  async function handleDeleteLog() {
    if (!selectedId) return;
    if (!confirm("Delete this delivery variance log and all its items? This cannot be undone.")) {
      return;
    }
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("delivery_variance_logs")
        .delete()
        .eq("id", selectedId);
      if (error) {
        setActionError(`Failed to delete: ${error.message}`);
        return;
      }
      closePanel();
      await load();
    } catch {
      setActionError("Could not delete. Make sure a Supabase project is connected.");
    }
  }

  async function handleDocLookup(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = docQuery.trim();
    if (!trimmed) return;
    setDocSearching(true);
    setDocNotFound(false);
    setDocInvoice(null);
    setCreateError(null);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("invoices")
        .select("*")
        .ilike("document_no", trimmed)
        .maybeSingle();
      if (!data) {
        setDocNotFound(true);
        return;
      }
      setDocInvoice(data as Invoice);
    } catch {
      setCreateError("Could not look up the document number.");
    } finally {
      setDocSearching(false);
    }
  }

  async function handleCreateLog() {
    if (!docInvoice) return;
    if (!createReasonId) {
      setCreateError("Select a discrepancy/backload reason.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const supabase = createClient();
      const { data: newRow, error } = await supabase
        .from("delivery_variance_logs")
        .insert({
          invoice_id: docInvoice.id,
          reason_id: createReasonId,
          log_date: todayStr(),
        })
        .select("id")
        .single();
      if (error) {
        setCreateError(`Failed to create log: ${error.message}`);
        return;
      }
      setShowCreate(false);
      setDocQuery("");
      setDocInvoice(null);
      setCreateReasonId("");
      await load();
      if (newRow?.id) {
        const { data: fullRow } = await supabase
          .from("v_delivery_variance_logs")
          .select("*")
          .eq("id", newRow.id)
          .maybeSingle();
        if (fullRow) openLog(fullRow as VDeliveryVarianceLog);
      }
    } catch {
      setCreateError("Could not create log. Make sure a Supabase project is connected.");
    } finally {
      setCreating(false);
    }
  }

  function handleLogoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setLogoSaving(true);
      const ok = await setAppSetting(LOGO_SETTING_KEY, dataUrl);
      if (ok) setLogoUrl(dataUrl);
      setLogoSaving(false);
    };
    reader.readAsDataURL(file);
  }

  async function handleRemoveLogo() {
    setLogoSaving(true);
    const ok = await setAppSetting(LOGO_SETTING_KEY, null);
    if (ok) setLogoUrl(null);
    setLogoSaving(false);
  }

  function handleExport() {
    exportToExcel(`delivery-variance-log-${dateFrom}_to_${dateTo}`, [
      {
        name: "Delivery Variance Log",
        rows: filteredLogs.map((l) => ({
          "Series #": l.series_no,
          "Document No.": l.document_no ?? "",
          "Retail Chain": l.retail_chain ?? "",
          "Store/Branch Address": l.branch_address ?? "",
          Truck: l.truck_label ?? "",
          "Reason Type": l.reason_type ?? "",
          Reason: l.reason_label ?? "",
          "Log Date": l.log_date ? new Date(l.log_date).toLocaleDateString() : "",
          Items: l.item_count,
          "Total Amount": l.total_amount,
          "Prepared By": l.prepared_by ?? "",
          "Checked By": l.checked_by ?? "",
        })),
      },
    ]);
  }

  return (
    <RequireRole
      roles={["ADMIN", "LOGISTICS_OFFICER", "LOGISTICS_ASSOCIATE", "GENERAL_MANAGER"]}
    >
      <div>
        <div className="page-header border-b-0 pb-0">
          <div>
            <h1 className="page-title">Delivery Variance Log</h1>
            <p className="page-subtitle">
              Track discrepancies and backloads reported during delivery, linked automatically
              from Route Plan.
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card">
            <p className="text-sm font-medium text-gray-500">Logs in range</p>
            <p className="mt-2 text-3xl font-bold text-brand-700">{summary.total}</p>
          </div>
          <div className="card">
            <p className="text-sm font-medium text-gray-500">Discrepancies</p>
            <p className="mt-2 text-3xl font-bold text-amber-600">{summary.discrepancy}</p>
          </div>
          <div className="card">
            <p className="text-sm font-medium text-gray-500">Backloads</p>
            <p className="mt-2 text-3xl font-bold text-red-600">{summary.backload}</p>
          </div>
          <div className="card">
            <p className="text-sm font-medium text-gray-500">Most Frequent Reason</p>
            <p className="mt-2 text-lg font-bold text-gray-800">
              {topReason ? topReason.reason_label : "—"}
            </p>
            {topReason && (
              <p className="text-xs text-gray-400">
                {topReason.reason_type.replace("_", " ")} · {topReason.log_count} occurrence
                {topReason.log_count === 1 ? "" : "s"}
              </p>
            )}
          </div>
        </div>

        {canManageLogo && (
          <div className="card mt-6">
            <h2 className="text-sm font-semibold text-gray-800">
              Dynamic88 Logo (sidebar &amp; printable forms)
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Dynamic88 logo" className="h-14 w-auto rounded border border-gray-200 bg-white p-1" />
              ) : (
                <span className="text-sm text-gray-400">No logo uploaded yet.</span>
              )}
              <label className="tab-button tab-button-inactive cursor-pointer">
                {logoSaving ? "Saving…" : "Upload Logo"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoFileChange}
                  disabled={logoSaving}
                />
              </label>
              {logoUrl && (
                <button
                  type="button"
                  className="tab-button tab-button-inactive"
                  onClick={handleRemoveLogo}
                  disabled={logoSaving}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        )}

        <div className="card mt-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label" htmlFor="dateFrom">
                  From
                </label>
                <input
                  id="dateFrom"
                  type="date"
                  className="input"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="dateTo">
                  To
                </label>
                <input
                  id="dateTo"
                  type="date"
                  className="input"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="varianceSearch">
                  Search
                </label>
                <input
                  id="varianceSearch"
                  type="text"
                  className="input max-w-[220px]"
                  placeholder="Series #, doc #, retail chain…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <button
                  type="button"
                  className="tab-button tab-button-inactive"
                  onClick={() => setShowCreate((v) => !v)}
                >
                  + New Log
                </button>
              )}
              {filteredLogs.length > 0 && (
                <button type="button" className="tab-button tab-button-inactive" onClick={handleExport}>
                  Export to Excel
                </button>
              )}
              <Link
                href={`/delivery-variance/print/report?from=${dateFrom}&to=${dateTo}`}
                target="_blank"
                className="tab-button tab-button-inactive"
              >
                Print Report
              </Link>
            </div>
          </div>

          {showCreate && (
            <div className="mt-4 rounded-md border border-dashed border-gray-300 p-3">
              <form onSubmit={handleDocLookup} className="flex flex-wrap items-end gap-2">
                <div className="min-w-[200px] flex-1">
                  <label className="label" htmlFor="docQuery">
                    Document Lookup
                  </label>
                  <input
                    id="docQuery"
                    type="text"
                    className="input"
                    placeholder="e.g. CD_00123"
                    value={docQuery}
                    onChange={(e) => setDocQuery(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn-primary" disabled={docSearching}>
                  {docSearching ? "Searching…" : "Look Up"}
                </button>
              </form>
              {docNotFound && (
                <p className="mt-2 text-sm text-gray-500">No invoice found with that document number.</p>
              )}
              {docInvoice && (
                <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm">
                  <p className="font-medium text-gray-800">{docInvoice.document_no}</p>
                  <p className="text-gray-600">{docInvoice.company_name_raw ?? "—"}</p>
                  <p className="text-gray-500">{docInvoice.branch_address ?? "—"}</p>
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <div>
                      <label className="label" htmlFor="createReasonId">
                        Reason
                      </label>
                      <select
                        id="createReasonId"
                        className="input"
                        value={createReasonId}
                        onChange={(e) => setCreateReasonId(e.target.value)}
                      >
                        <option value="">Select reason…</option>
                        <optgroup label="Discrepancy">
                          {deliveryReasons
                            .filter((r) => r.type === "DISCREPANCY")
                            .map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.label}
                              </option>
                            ))}
                        </optgroup>
                        <optgroup label="Backload">
                          {deliveryReasons
                            .filter((r) => r.type === "BACKLOAD")
                            .map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.label}
                              </option>
                            ))}
                        </optgroup>
                      </select>
                    </div>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleCreateLog}
                      disabled={creating}
                    >
                      {creating ? "Creating…" : "Create Log"}
                    </button>
                  </div>
                </div>
              )}
              {createError && <p className="mt-2 text-sm text-red-600">{createError}</p>}
            </div>
          )}

          <h2 className="mt-6 text-lg font-semibold text-gray-800">Logs</h2>
          {loading && <p className="mt-3 text-sm text-gray-400">Loading…</p>}
          {!loading && errorMsg && <p className="mt-3 text-sm text-gray-400">{errorMsg}</p>}
          {!loading && !errorMsg && filteredLogs.length === 0 && (
            <p className="mt-3 text-sm text-gray-400">
              {search
                ? `No delivery variance logs match "${search}" in this date range.`
                : "No delivery variance logs in this date range."}
            </p>
          )}
          {!loading && !errorMsg && filteredLogs.length > 0 && (
            <div className="mt-3 table-scroll-container">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                    <th className="py-2 pr-4">Series #</th>
                    <th className="py-2 pr-4">Document No.</th>
                    <th className="py-2 pr-4">Retail Chain</th>
                    <th className="py-2 pr-4">Store/Branch Address</th>
                    <th className="py-2 pr-4">Truck</th>
                    <th className="py-2 pr-4">Reason</th>
                    <th className="py-2 pr-4">Log Date</th>
                    <th className="py-2 pr-4">Items</th>
                    <th className="py-2 pr-4">Total</th>
                    <th className="py-2 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredLogs.map((log) => (
                    <tr key={log.id} className={selectedId === log.id ? "bg-brand-50" : undefined}>
                      <td className="py-2 pr-4 font-medium text-gray-800">{log.series_no}</td>
                      <td className="py-2 pr-4">{log.document_no ?? "—"}</td>
                      <td className="py-2 pr-4">{log.retail_chain ?? "—"}</td>
                      <td className="py-2 pr-4">{log.branch_address ?? "—"}</td>
                      <td className="py-2 pr-4">
                        {log.route_plan_id ? (
                          <Link
                            href={`/route-plan?planId=${log.route_plan_id}`}
                            className="text-brand-600 underline hover:text-brand-700"
                            title={log.route_date ? `Route plan for ${log.route_date}` : undefined}
                          >
                            {log.truck_label ?? "Route Plan"}
                          </Link>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {log.reason_label ? (
                          <span
                            className={
                              log.reason_type === "BACKLOAD" ? "badge-danger" : "badge-warning"
                            }
                          >
                            {log.reason_label}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {log.log_date ? new Date(log.log_date).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-2 pr-4">{log.item_count}</td>
                      <td className="py-2 pr-4">{formatMoney(log.total_amount)}</td>
                      <td className="py-2 pr-4">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="tab-button tab-button-inactive"
                            onClick={() => openLog(log)}
                          >
                            {selectedId === log.id ? "Selected" : "Open"}
                          </button>
                          <Link
                            href={`/delivery-variance/print/${log.id}`}
                            target="_blank"
                            className="tab-button tab-button-inactive"
                          >
                            Print
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selectedLog && (
          <div className="card mt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-gray-800">
                {selectedLog.series_no} — {selectedLog.document_no ?? "No document linked"}
              </h2>
              <div className="flex gap-2">
                <Link
                  href={`/delivery-variance/print/${selectedLog.id}`}
                  target="_blank"
                  className="tab-button tab-button-inactive"
                >
                  Print
                </Link>
                {canDeleteLog && (
                  <button
                    type="button"
                    className="tab-button tab-button-inactive text-red-600"
                    onClick={handleDeleteLog}
                  >
                    Delete Log
                  </button>
                )}
                <button
                  type="button"
                  className="tab-button tab-button-inactive"
                  onClick={closePanel}
                >
                  Close
                </button>
              </div>
            </div>

            {actionError && <p className="mt-2 text-sm text-red-600">{actionError}</p>}

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="label" htmlFor="editLogDate">
                  Log Date
                </label>
                <input
                  id="editLogDate"
                  type="date"
                  className="input"
                  value={editLogDate}
                  onChange={(e) => setEditLogDate(e.target.value)}
                  disabled={!canEdit}
                />
              </div>
              <div>
                <label className="label" htmlFor="editReasonId">
                  Reason
                </label>
                <select
                  id="editReasonId"
                  className="input"
                  value={editReasonId}
                  onChange={(e) => setEditReasonId(e.target.value)}
                  disabled={!canEdit}
                >
                  <option value="">No reason set</option>
                  <optgroup label="Discrepancy">
                    {deliveryReasons
                      .filter((r) => r.type === "DISCREPANCY")
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Backload">
                    {deliveryReasons
                      .filter((r) => r.type === "BACKLOAD")
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                  </optgroup>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="editPreparedBy">
                  Prepared By
                </label>
                <input
                  id="editPreparedBy"
                  type="text"
                  className="input"
                  value={editPreparedBy}
                  onChange={(e) => setEditPreparedBy(e.target.value)}
                  disabled={!canEdit}
                />
              </div>
              <div>
                <label className="label" htmlFor="editCheckedBy">
                  Checked By
                </label>
                <input
                  id="editCheckedBy"
                  type="text"
                  className="input"
                  value={editCheckedBy}
                  onChange={(e) => setEditCheckedBy(e.target.value)}
                  disabled={!canEdit}
                />
              </div>
              <div>
                <label className="label" htmlFor="editReceivedBy1">
                  Received By (1)
                </label>
                <input
                  id="editReceivedBy1"
                  type="text"
                  className="input"
                  value={editReceivedBy1}
                  onChange={(e) => setEditReceivedBy1(e.target.value)}
                  disabled={!canEdit}
                />
              </div>
              <div>
                <label className="label" htmlFor="editReceivedBy2">
                  Received By (2)
                </label>
                <input
                  id="editReceivedBy2"
                  type="text"
                  className="input"
                  value={editReceivedBy2}
                  onChange={(e) => setEditReceivedBy2(e.target.value)}
                  disabled={!canEdit}
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="label" htmlFor="editRemarks">
                  Remarks
                </label>
                <textarea
                  id="editRemarks"
                  className="input"
                  rows={2}
                  value={editRemarks}
                  onChange={(e) => setEditRemarks(e.target.value)}
                  disabled={!canEdit}
                />
              </div>
            </div>

            {canEdit && (
              <button
                type="button"
                className="btn-primary mt-3"
                onClick={handleSaveHeader}
                disabled={savingHeader}
              >
                {savingHeader ? "Saving…" : "Save Details"}
              </button>
            )}

            <div className="mt-6">
              <h3 className="text-sm font-semibold text-gray-700">Items</h3>
              {itemsLoading && <p className="mt-2 text-sm text-gray-400">Loading…</p>}
              {!itemsLoading && (
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead>
                      <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                        <th className="py-2 pr-4">Item Description</th>
                        <th className="py-2 pr-4">Qty</th>
                        <th className="py-2 pr-4">Unit</th>
                        <th className="py-2 pr-4">Unit Price</th>
                        <th className="py-2 pr-4">Amount</th>
                        <th className="py-2 pr-4">Returned Status</th>
                        <th className="py-2 pr-4">Remarks</th>
                        {canEdit && <th className="py-2 pr-4">Actions</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {items.map((item) => (
                        <tr key={item.id}>
                          <td className="py-2 pr-4">
                            <input
                              type="text"
                              className="input"
                              defaultValue={item.item_description}
                              onBlur={(e) =>
                                e.target.value.trim() !== item.item_description &&
                                handleUpdateItem(item.id, {
                                  item_description: e.target.value.trim(),
                                })
                              }
                              disabled={!canEdit}
                            />
                          </td>
                          <td className="py-2 pr-4">
                            <input
                              type="number"
                              step="0.01"
                              className="input w-20"
                              defaultValue={item.qty}
                              onBlur={(e) =>
                                Number(e.target.value) !== item.qty &&
                                handleUpdateItem(item.id, { qty: Number(e.target.value || 0) })
                              }
                              disabled={!canEdit}
                            />
                          </td>
                          <td className="py-2 pr-4">
                            <input
                              type="text"
                              className="input w-20"
                              defaultValue={item.unit ?? ""}
                              onBlur={(e) =>
                                e.target.value.trim() !== (item.unit ?? "") &&
                                handleUpdateItem(item.id, { unit: e.target.value.trim() || null })
                              }
                              disabled={!canEdit}
                            />
                          </td>
                          <td className="py-2 pr-4">
                            <input
                              type="number"
                              step="0.01"
                              className="input w-24"
                              defaultValue={item.unit_price}
                              onBlur={(e) =>
                                Number(e.target.value) !== item.unit_price &&
                                handleUpdateItem(item.id, {
                                  unit_price: Number(e.target.value || 0),
                                })
                              }
                              disabled={!canEdit}
                            />
                          </td>
                          <td className="py-2 pr-4">{formatMoney(item.amount)}</td>
                          <td className="py-2 pr-4">
                            <select
                              className="input"
                              value={item.returned_status}
                              onChange={(e) =>
                                handleUpdateItem(item.id, {
                                  returned_status: e.target.value as ReturnedStatus,
                                })
                              }
                              disabled={!canEdit}
                            >
                              {RETURNED_STATUS_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 pr-4">
                            <input
                              type="text"
                              className="input"
                              defaultValue={item.remarks ?? ""}
                              onBlur={(e) =>
                                e.target.value.trim() !== (item.remarks ?? "") &&
                                handleUpdateItem(item.id, {
                                  remarks: e.target.value.trim() || null,
                                })
                              }
                              disabled={!canEdit}
                            />
                          </td>
                          {canEdit && (
                            <td className="py-2 pr-4">
                              <button
                                type="button"
                                className="tab-button tab-button-inactive text-red-600"
                                onClick={() => handleDeleteItem(item.id)}
                              >
                                Remove
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                      {items.length === 0 && (
                        <tr>
                          <td
                            colSpan={canEdit ? 8 : 7}
                            className="py-3 text-sm text-gray-400"
                          >
                            No items recorded yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {canEdit && (
                <div className="mt-4 flex flex-wrap items-end gap-2 rounded-md border border-dashed border-gray-300 p-3">
                  <div className="min-w-[180px] flex-1">
                    <label className="label">Item Description</label>
                    <input
                      type="text"
                      className="input"
                      value={newItem.item_description}
                      onChange={(e) =>
                        setNewItem({ ...newItem, item_description: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="label">Qty</label>
                    <input
                      type="number"
                      step="0.01"
                      className="input w-20"
                      value={newItem.qty}
                      onChange={(e) => setNewItem({ ...newItem, qty: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Unit</label>
                    <input
                      type="text"
                      className="input w-20"
                      value={newItem.unit}
                      onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Unit Price</label>
                    <input
                      type="number"
                      step="0.01"
                      className="input w-24"
                      value={newItem.unit_price}
                      onChange={(e) => setNewItem({ ...newItem, unit_price: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Returned Status</label>
                    <select
                      className="input"
                      value={newItem.returned_status}
                      onChange={(e) =>
                        setNewItem({
                          ...newItem,
                          returned_status: e.target.value as ReturnedStatus,
                        })
                      }
                    >
                      {RETURNED_STATUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-[140px] flex-1">
                    <label className="label">Remarks</label>
                    <input
                      type="text"
                      className="input"
                      value={newItem.remarks}
                      onChange={(e) => setNewItem({ ...newItem, remarks: e.target.value })}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleAddItem}
                    disabled={savingItem}
                  >
                    {savingItem ? "Adding…" : "+ Add Item"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </RequireRole>
  );
}

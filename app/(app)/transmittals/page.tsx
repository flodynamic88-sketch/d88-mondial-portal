"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import RequireRole from "@/components/RequireRole";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/Toast";
import { dateToMonthValue } from "@/lib/dateHelpers";
import type { Invoice, InvoiceCategory, TransmittalStatus, VTransmittal } from "@/types/database";

const CATEGORIES: { value: InvoiceCategory; label: string }[] = [
  { value: "CONSIGNMENT", label: "Consignment" },
  { value: "OUTRIGHT", label: "Outright" },
  { value: "MERCURY_DRUG", label: "Flo-Mercury" },
];

const STATUS_OPTIONS: { value: TransmittalStatus; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "TRANSMITTED", label: "Transmitted to Invoice Dept" },
];

function formatMoney(value: number | null | undefined) {
  return (value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatMonthLabel(dateValue: string | null): string {
  const monthValue = dateToMonthValue(dateValue);
  if (!monthValue) return "—";
  const [y, m] = monthValue.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

// Staff recognize invoices by their own CD_/PSI-/BR_ document number, not the
// internal CONS-0001 style transmittal_no -- so batches lead with this range
// (first-last document_no in the batch, ascending) instead.
//
// document_ranges (from v_transmittals, migration 0056) is grouped per document-
// number prefix -- prefer it over a plain first/last span, which can straddle
// multiple prefixes (e.g. "BR_0013335 – PSI-0065812") in a way that falsely
// looks like every number in between was transmitted.
function formatDocRange(t: { document_ranges?: string | null; first_document_no: string | null; last_document_no: string | null }): string {
  if (t.document_ranges) return t.document_ranges;
  const { first_document_no: first, last_document_no: last } = t;
  if (!first && !last) return "—";
  if (!first) return last as string;
  if (!last || first === last) return first;
  return `${first} – ${last}`;
}

type TabKey = InvoiceCategory | "SUMMARY";

export default function TransmittalsPage() {
  const profile = useAuth();
  const role = profile?.role;
  const canGenerate = role === "ADMIN" || role === "LOGISTICS_ASSOCIATE";
  const canUpdateStatus = role === "ADMIN" || role === "LOGISTICS_ASSOCIATE";
  // Matches the "transmittals delete" RLS policy (ADMIN only) -- deleting a
  // transmittal cascades to its transmittal_items and, via
  // invoices.transmittal_id's ON DELETE SET NULL, automatically frees its
  // invoices to be picked up again by a new transmittal.
  const canDelete = role === "ADMIN";

  const [tab, setTab] = useState<TabKey>("CONSIGNMENT");

  return (
    <RequireRole
      roles={["ADMIN", "LOGISTICS_ASSOCIATE", "GENERAL_MANAGER", "INVOICING_TEAM"]}
    >
      <div>
        <div className="page-header border-b-0 pb-0">
          <div>
            <h1 className="page-title">Transmittals</h1>
            <p className="page-subtitle">
              Generate printable transmittal batches per category for invoices with a delivery
              date, and track their status to the Invoice Department.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              className={
                tab === c.value ? "tab-button tab-button-active" : "tab-button tab-button-inactive"
              }
              onClick={() => setTab(c.value)}
            >
              {c.label}
            </button>
          ))}
          <button
            type="button"
            className={
              tab === "SUMMARY" ? "tab-button tab-button-active" : "tab-button tab-button-inactive"
            }
            onClick={() => setTab("SUMMARY")}
          >
            Summary
          </button>
        </div>

        {tab !== "SUMMARY" ? (
          <GenerateTab category={tab} canGenerate={canGenerate} canDelete={canDelete} />
        ) : (
          <SummaryTab canUpdateStatus={canUpdateStatus} canDelete={canDelete} />
        )}
      </div>
    </RequireRole>
  );
}

function GenerateTab({
  category,
  canGenerate,
  canDelete,
}: {
  category: InvoiceCategory;
  canGenerate: boolean;
  canDelete: boolean;
}) {
  const { showToast } = useToast();
  const label = CATEGORIES.find((c) => c.value === category)?.label ?? category;
  const showRemarks = category !== "CONSIGNMENT";

  const [deliveryDate, setDeliveryDate] = useState(todayStr());
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // All delivered-but-not-yet-transmitted invoices for this category across
  // EVERY delivery date, not just the one picked above -- so Logistics can
  // see at a glance what's still waiting on a transmittal batch, even for
  // older dates they've already moved past.
  const [allPending, setAllPending] = useState<Invoice[]>([]);
  const [allPendingLoading, setAllPendingLoading] = useState(true);
  const [showAllPending, setShowAllPending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [recent, setRecent] = useState<VTransmittal[]>([]);
  const [docQuery, setDocQuery] = useState("");
  const [docSearching, setDocSearching] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const supabase = createClient();
      // "Delivered" is defined by having an Actual Delivery Date set (matching
      // the convention used everywhere else in the app -- Route Plan's sync
      // trigger and Encode Invoices both set this alongside status, but some
      // older/imported rows only ever got actual_delivery_date populated
      // directly, so status alone can't be relied on as the sole signal).
      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .eq("category", category)
        .eq("actual_delivery_date", deliveryDate)
        .is("transmittal_id", null)
        .order("document_no_sort", { ascending: true });
      if (error) {
        setErrorMsg(
          "Could not load invoices for this date. Connect a Supabase project to see live data."
        );
        setInvoices([]);
        return;
      }
      const rows = (data ?? []) as Invoice[];
      setInvoices(rows);
      setChecked(new Set(rows.map((r) => r.id)));
      setRemarks({});
    } catch {
      setErrorMsg(
        "Could not load invoices for this date. Connect a Supabase project to see live data."
      );
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [category, deliveryDate]);

  const loadAllPending = useCallback(async () => {
    setAllPendingLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .eq("category", category)
        .not("actual_delivery_date", "is", null)
        .is("transmittal_id", null)
        .order("actual_delivery_date", { ascending: true });
      if (error) {
        setAllPending([]);
        return;
      }
      setAllPending((data ?? []) as Invoice[]);
    } catch {
      setAllPending([]);
    } finally {
      setAllPendingLoading(false);
    }
  }, [category]);

  const loadRecent = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("v_transmittals")
        .select("*")
        .eq("category", category)
        .order("date_transmitted", { ascending: false })
        .limit(8);
      setRecent((data ?? []) as VTransmittal[]);
    } catch {
      setRecent([]);
    }
  }, [category]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  useEffect(() => {
    loadAllPending();
  }, [loadAllPending]);

  // Group the all-dates pending list by actual_delivery_date so it reads as
  // a scannable log of "what's still waiting, by day" instead of one flat
  // list -- and let clicking a date jump the date-scoped table above to it.
  const pendingByDate = useMemo(() => {
    const groups = new Map<string, Invoice[]>();
    allPending.forEach((inv) => {
      const key = inv.actual_delivery_date ?? "unknown";
      const list = groups.get(key);
      if (list) list.push(inv);
      else groups.set(key, [inv]);
    });
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [allPending]);
  const allPendingAmount = useMemo(
    () => allPending.reduce((sum, i) => sum + (i.amount ?? 0), 0),
    [allPending]
  );

  const selectedAmount = useMemo(
    () => invoices.filter((i) => checked.has(i.id)).reduce((sum, i) => sum + (i.amount ?? 0), 0),
    [invoices, checked]
  );

  // Deleting a transmittal cascades to its transmittal_items and, via
  // invoices.transmittal_id's ON DELETE SET NULL, frees its invoices to be
  // picked up again -- so also refresh the auto-list in case a freed invoice
  // matches the currently-selected category + delivery date.
  async function handleDeleteTransmittal(t: VTransmittal) {
    const confirmed = window.confirm(
      `Delete transmittal ${formatDocRange(t)} (${
        t.transmittal_no ?? "no #"
      })? Its invoices will become available again to include in a new transmittal. This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingId(t.id);
    setDeleteError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("transmittals").delete().eq("id", t.id);
      if (error) {
        const msg = `Failed to delete transmittal: ${error.message}`;
        setDeleteError(msg);
        showToast(msg, "error");
        return;
      }
      showToast("Transmittal deleted.", "success");
      await Promise.all([load(), loadRecent(), loadAllPending()]);
    } catch {
      setDeleteError("Could not delete the transmittal. Make sure a Supabase project is connected.");
      showToast("Could not delete the transmittal.", "error");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDateTransmittedChange(id: string, value: string) {
    if (!value) return;
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("transmittals")
        .update({ date_transmitted: value })
        .eq("id", id);
      if (!error) {
        showToast("Transmittal date updated.", "success");
        await loadRecent();
      } else {
        showToast("Failed to update transmittal date.", "error");
      }
    } catch {
      showToast("Failed to update transmittal date.", "error");
    }
  }

  function toggleRow(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Lets staff pull in an invoice by its own document number regardless of
  // whether its Actual Delivery Date matches the date above -- covers the case
  // where two invoices share a delivery date but didn't end up in the same
  // transmittal batch. Only invoices that are already DELIVERED (i.e. have an
  // Actual Delivery Date, set either via Route Plan's Mark Delivered or
  // directly on Encode Invoices) are eligible -- a transmittal can't include
  // something that hasn't actually been delivered yet, so this does NOT
  // auto-stamp a delivery date the way the date-filtered list above does.
  async function handleAddByDocument(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = docQuery.trim();
    if (!trimmed) return;

    setDocSearching(true);
    setDocError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .ilike("document_no", trimmed)
        .maybeSingle();

      if (error) {
        setDocError("Could not look up that document number.");
        return;
      }
      if (!data) {
        setDocError(`No invoice found with document number "${trimmed}".`);
        return;
      }

      const found = data as Invoice;
      if (found.category !== category) {
        setDocError(
          `${found.document_no} is a ${found.category.replace("_", " ")} invoice — it can't be added to a ${label} transmittal.`
        );
        return;
      }
      if (found.transmittal_id) {
        setDocError(`${found.document_no} has already been transmitted.`);
        return;
      }
      if (!found.actual_delivery_date) {
        setDocError(
          `${found.document_no} hasn't been delivered yet. Mark it Delivered in Route Plan, or set its Actual Delivery Date in Encode Invoices, before adding it to a transmittal.`
        );
        return;
      }

      setInvoices((prev) => {
        if (prev.some((i) => i.id === found.id)) return prev;
        return [...prev, found].sort((a, b) => a.document_no_sort.localeCompare(b.document_no_sort));
      });
      setChecked((prev) => new Set(prev).add(found.id));
      setDocQuery("");
    } catch {
      setDocError("Could not look up that document number. Make sure a Supabase project is connected.");
    } finally {
      setDocSearching(false);
    }
  }

  async function handleGenerate() {
    const ids = invoices.filter((i) => checked.has(i.id)).map((i) => i.id);
    if (ids.length === 0) {
      setGenError("Select at least one invoice to include.");
      return;
    }
    setGenerating(true);
    setGenError(null);
    try {
      const supabase = createClient();
      const { data: newTransmittal, error } = await supabase
        .from("transmittals")
        .insert({ category, delivery_date: deliveryDate })
        .select("*")
        .single();
      if (error || !newTransmittal) {
        const msg = `Failed to create transmittal: ${error?.message ?? "unknown error"}`;
        setGenError(msg);
        showToast(msg, "error");
        return;
      }
      const itemsPayload = ids.map((id) => ({
        transmittal_id: newTransmittal.id,
        invoice_id: id,
        remarks: showRemarks ? remarks[id]?.trim() || null : null,
      }));
      const { error: itemsErr } = await supabase.from("transmittal_items").insert(itemsPayload);
      if (itemsErr) {
        const msg = `Transmittal created but failed to attach invoices: ${itemsErr.message}`;
        setGenError(msg);
        showToast(msg, "error");
        return;
      }
      showToast(`${label} transmittal generated.`, "success");
      window.open(`/transmittals/print/${newTransmittal.id}`, "_blank");
      await load();
      await loadRecent();
      await loadAllPending();
    } catch {
      setGenError("Could not generate the transmittal. Make sure a Supabase project is connected.");
      showToast("Could not generate the transmittal.", "error");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="card mt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <label className="label" htmlFor="deliveryDate">
            Delivery Date
          </label>
          <input
            id="deliveryDate"
            type="date"
            className="input"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
          />
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-gray-500">Selected Amount</p>
          <p className="text-xl font-bold text-brand-700">{formatMoney(selectedAmount)}</p>
        </div>
      </div>

      <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-3">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setShowAllPending((v) => !v)}
        >
          <span className="text-sm font-semibold text-amber-800">
            {showAllPending ? "▾" : "▸"} All Delivered, Not Yet Transmitted — Any Date (
            {allPendingLoading ? "…" : allPending.length})
          </span>
          {!allPendingLoading && allPending.length > 0 && (
            <span className="text-xs font-medium text-amber-700">
              {formatMoney(allPendingAmount)}
            </span>
          )}
        </button>
        <p className="mt-1 text-xs text-amber-700">
          Every {label.toLowerCase()} invoice that has a delivery date but has never been included
          in a transmittal, across every date — not just the one selected below. Use this to catch
          older delivered invoices that got missed.
        </p>
        {showAllPending && (
          <div className="mt-3">
            {allPendingLoading && <p className="text-sm text-amber-700">Loading…</p>}
            {!allPendingLoading && allPending.length === 0 && (
              <p className="text-sm text-amber-700">
                Nothing pending — every delivered {label.toLowerCase()} invoice has a transmittal.
              </p>
            )}
            {!allPendingLoading && pendingByDate.length > 0 && (
              <div className="max-h-64 overflow-y-auto rounded-md border border-amber-200 bg-white">
                <table className="min-w-full divide-y divide-amber-100 text-sm">
                  <thead className="sticky top-0 bg-amber-50">
                    <tr className="text-left text-xs font-semibold uppercase text-amber-700">
                      <th className="py-1.5 pl-3 pr-4">Delivery Date</th>
                      <th className="py-1.5 pr-4">Document #s</th>
                      <th className="py-1.5 pr-4">Count</th>
                      <th className="py-1.5 pr-3">Amount</th>
                      <th className="py-1.5 pr-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-50">
                    {pendingByDate.map(([date, invs]) => (
                      <tr key={date}>
                        <td className="py-1.5 pl-3 pr-4 font-medium text-gray-800">
                          {date === "unknown" ? "—" : new Date(date).toLocaleDateString()}
                        </td>
                        <td className="py-1.5 pr-4 text-gray-600">
                          {invs
                            .map((i) => i.document_no)
                            .slice(0, 3)
                            .join(", ")}
                          {invs.length > 3 ? ` +${invs.length - 3} more` : ""}
                        </td>
                        <td className="py-1.5 pr-4">{invs.length}</td>
                        <td className="py-1.5 pr-3">
                          {formatMoney(invs.reduce((sum, i) => sum + (i.amount ?? 0), 0))}
                        </td>
                        <td className="py-1.5 pr-3">
                          {date !== "unknown" && (
                            <button
                              type="button"
                              className="text-xs font-medium text-brand-600 underline hover:text-brand-700"
                              onClick={() => {
                                setDeliveryDate(date);
                                setShowAllPending(false);
                              }}
                            >
                              Go to date
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <h2 className="mt-6 text-lg font-semibold text-gray-800">
        {label} — Invoices Delivered on {new Date(deliveryDate).toLocaleDateString()}
      </h2>
      <p className="text-xs text-gray-400">
        Shows every {label.toLowerCase()} invoice with this Actual Delivery Date that hasn&apos;t
        been transmitted yet — whether it went through a Route Plan truck or had its delivery date
        set directly on Encode Invoices.
      </p>

      {canGenerate ? (
        <>
          <form
            onSubmit={handleAddByDocument}
            className="mt-4 flex flex-wrap items-end gap-2 rounded-md border border-dashed border-gray-300 p-3"
          >
            <div className="min-w-[220px] flex-1">
              <label className="label" htmlFor={`add-doc-${category}`}>
                Add by Document #
              </label>
              <input
                id={`add-doc-${category}`}
                type="text"
                className="input"
                placeholder="e.g. CD_00123, PSI-00456, BR_00789"
                value={docQuery}
                onChange={(e) => setDocQuery(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-primary" disabled={docSearching}>
              {docSearching ? "Searching…" : "Add"}
            </button>
          </form>
          {docError && <p className="mt-2 text-sm text-red-600">{docError}</p>}
          <p className="mt-1 text-xs text-gray-400">
            Missed from the list above? Add an already-delivered {label.toLowerCase()} invoice
            here by its own document number. Invoices that aren&apos;t Delivered yet won&apos;t be
            found — mark them Delivered in Route Plan or set their Actual Delivery Date in Encode
            Invoices first.
          </p>
        </>
      ) : (
        <p className="mt-4 text-xs text-gray-400">View-only access — generating transmittals is handled by Logistics.</p>
      )}

      {loading && <p className="mt-3 text-sm text-gray-400">Loading…</p>}
      {!loading && errorMsg && <p className="mt-3 text-sm text-gray-400">{errorMsg}</p>}
      {!loading && !errorMsg && invoices.length === 0 && (
        <p className="mt-3 text-sm text-gray-400">
          No un-transmitted {label.toLowerCase()} invoices with this delivery date.
        </p>
      )}
      {!loading && !errorMsg && invoices.length > 0 && (
        <div className="mt-3 table-scroll-container">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                <th className="py-2 pr-4">Include</th>
                <th className="py-2 pr-4">Document #</th>
                <th className="py-2 pr-4">Retail Chain</th>
                <th className="py-2 pr-4">Branch/Store Address</th>
                <th className="py-2 pr-4">Month of Invoice</th>
                <th className="py-2 pr-4">Posting Date</th>
                <th className="py-2 pr-4">Amount</th>
                {showRemarks && <th className="py-2 pr-4">Remarks</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="py-2 pr-4">
                    <input
                      type="checkbox"
                      checked={checked.has(inv.id)}
                      onChange={() => toggleRow(inv.id)}
                      disabled={!canGenerate}
                    />
                  </td>
                  <td className="py-2 pr-4 font-medium text-gray-800">{inv.document_no}</td>
                  <td className="py-2 pr-4">
                    {category === "MERCURY_DRUG"
                      ? "Mercury Drug Corporation"
                      : inv.company_name_raw ?? "—"}
                  </td>
                  <td className="py-2 pr-4">{inv.branch_address ?? "—"}</td>
                  <td className="py-2 pr-4">{formatMonthLabel(inv.billing_period)}</td>
                  <td className="py-2 pr-4">
                    {inv.posting_date ? new Date(inv.posting_date).toLocaleDateString() : "—"}
                  </td>
                  <td className="py-2 pr-4">{formatMoney(inv.amount)}</td>
                  {showRemarks && (
                    <td className="py-2 pr-4">
                      <input
                        type="text"
                        className="input input-sm"
                        value={remarks[inv.id] ?? ""}
                        onChange={(e) =>
                          setRemarks((prev) => ({ ...prev, [inv.id]: e.target.value }))
                        }
                        disabled={!canGenerate}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {genError && <p className="mt-3 text-sm text-red-600">{genError}</p>}

      {canGenerate && !loading && !errorMsg && invoices.length > 0 && (
        <button
          type="button"
          className="btn-primary mt-4"
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? "Generating…" : `Generate ${label} Transmittal`}
        </button>
      )}

      <div className="mt-8">
        <h3 className="text-sm font-semibold text-gray-700">Recently Generated ({label})</h3>
        {deleteError && <p className="mt-2 text-sm text-red-600">{deleteError}</p>}
        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-gray-400">
            No transmittals generated yet for this category.
          </p>
        ) : (
          <div className="mt-2 table-scroll-container">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                  <th className="py-2 pr-4">Document #s</th>
                  <th className="py-2 pr-4">Transmittal #</th>
                  <th className="py-2 pr-4">Delivery Date</th>
                  <th className="py-2 pr-4">Date Transmitted</th>
                  <th className="py-2 pr-4">Items</th>
                  <th className="py-2 pr-4">Amount</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recent.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2 pr-4 font-medium text-gray-800">
                      {formatDocRange(t)}
                    </td>
                    <td className="py-2 pr-4 text-gray-500">{t.transmittal_no ?? "—"}</td>
                    <td className="py-2 pr-4">{new Date(t.delivery_date).toLocaleDateString()}</td>
                    <td className="py-2 pr-4">
                      {canGenerate ? (
                        <input
                          type="date"
                          className="input input-sm"
                          value={new Date(t.date_transmitted).toISOString().slice(0, 10)}
                          onChange={(e) => handleDateTransmittedChange(t.id, e.target.value)}
                        />
                      ) : (
                        new Date(t.date_transmitted).toLocaleDateString()
                      )}
                    </td>
                    <td className="py-2 pr-4">{t.item_count}</td>
                    <td className="py-2 pr-4">{formatMoney(t.amount)}</td>
                    <td className="py-2 pr-4">
                      {t.status === "TRANSMITTED" ? (
                        <span className="badge-success">Transmitted</span>
                      ) : (
                        <span className="badge-warning">Pending</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/transmittals/print/${t.id}`}
                          target="_blank"
                          className="tab-button tab-button-inactive"
                        >
                          Print
                        </Link>
                        {canDelete && (
                          <button
                            type="button"
                            className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                            onClick={() => handleDeleteTransmittal(t)}
                            disabled={deletingId === t.id}
                          >
                            {deletingId === t.id ? "Deleting…" : "Delete"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryTab({
  canUpdateStatus,
  canDelete,
}: {
  canUpdateStatus: boolean;
  canDelete: boolean;
}) {
  const { showToast } = useToast();
  const [category, setCategory] = useState<InvoiceCategory>("CONSIGNMENT");
  const [rows, setRows] = useState<VTransmittal[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("v_transmittals")
        .select("*")
        .eq("category", category)
        .order("date_transmitted", { ascending: false });
      if (error) {
        setErrorMsg(
          "Could not load the transmittal summary. Connect a Supabase project to see live data."
        );
        setRows([]);
        return;
      }
      setRows((data ?? []) as VTransmittal[]);
    } catch {
      setErrorMsg(
        "Could not load the transmittal summary. Connect a Supabase project to see live data."
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleStatusChange(id: string, status: TransmittalStatus) {
    try {
      const supabase = createClient();
      const { error } = await supabase.from("transmittals").update({ status }).eq("id", id);
      if (!error) {
        showToast("Transmittal status updated.", "success");
        await load();
      } else {
        showToast("Failed to update transmittal status.", "error");
      }
    } catch {
      // Row keeps its last-known status until the next reload.
      showToast("Failed to update transmittal status.", "error");
    }
  }

  async function handleDateTransmittedChange(id: string, value: string) {
    if (!value) return;
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("transmittals")
        .update({ date_transmitted: value })
        .eq("id", id);
      if (!error) {
        showToast("Transmittal date updated.", "success");
        await load();
      } else {
        showToast("Failed to update transmittal date.", "error");
      }
    } catch {
      showToast("Failed to update transmittal date.", "error");
    }
  }

  async function handleDeleteTransmittal(t: VTransmittal) {
    const confirmed = window.confirm(
      `Delete transmittal ${formatDocRange(t)} (${
        t.transmittal_no ?? "no #"
      })? Its invoices will become available again to include in a new transmittal. This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingId(t.id);
    setDeleteError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("transmittals").delete().eq("id", t.id);
      if (error) {
        const msg = `Failed to delete transmittal: ${error.message}`;
        setDeleteError(msg);
        showToast(msg, "error");
        return;
      }
      showToast("Transmittal deleted.", "success");
      await load();
    } catch {
      setDeleteError("Could not delete the transmittal. Make sure a Supabase project is connected.");
      showToast("Could not delete the transmittal.", "error");
    } finally {
      setDeletingId(null);
    }
  }

  const totalAmount = useMemo(() => rows.reduce((sum, r) => sum + (r.amount ?? 0), 0), [rows]);
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((t) =>
      [t.transmittal_no, t.first_document_no, t.last_document_no, t.document_ranges]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q))
    );
  }, [rows, search]);

  return (
    <div className="card mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              className={
                category === c.value ? "tab-button tab-button-active" : "tab-button tab-button-inactive"
              }
              onClick={() => setCategory(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          className="input max-w-[240px]"
          placeholder="Search transmittal # or document #…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-800">
          {CATEGORIES.find((c) => c.value === category)?.label} Transmittal Summary
        </h2>
        <p className="text-sm text-gray-500">
          Total: <span className="font-semibold text-gray-800">{formatMoney(totalAmount)}</span>
        </p>
      </div>

      {loading && <p className="mt-3 text-sm text-gray-400">Loading…</p>}
      {!loading && errorMsg && <p className="mt-3 text-sm text-gray-400">{errorMsg}</p>}
      {!loading && !errorMsg && rows.length === 0 && (
        <p className="mt-3 text-sm text-gray-400">
          No transmittals generated yet for this category.
        </p>
      )}
      {!loading && !errorMsg && rows.length > 0 && filteredRows.length === 0 && (
        <p className="mt-3 text-sm text-gray-400">No transmittals match &quot;{search}&quot;.</p>
      )}
      {!loading && !errorMsg && filteredRows.length > 0 && (
        <div className="mt-3 table-scroll-container">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                <th className="py-2 pr-4">Document #s</th>
                <th className="py-2 pr-4">Transmittal #</th>
                <th className="py-2 pr-4">Date Transmitted</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRows.map((t) => (
                <tr key={t.id}>
                  <td className="py-2 pr-4 font-medium text-gray-800">
                    {formatDocRange(t)}
                  </td>
                  <td className="py-2 pr-4 text-gray-500">{t.transmittal_no ?? "—"}</td>
                  <td className="py-2 pr-4">
                    {canUpdateStatus ? (
                      <input
                        type="date"
                        className="input input-sm"
                        value={new Date(t.date_transmitted).toISOString().slice(0, 10)}
                        onChange={(e) => handleDateTransmittedChange(t.id, e.target.value)}
                      />
                    ) : (
                      new Date(t.date_transmitted).toLocaleDateString()
                    )}
                  </td>
                  <td className="py-2 pr-4">{formatMoney(t.amount)}</td>
                  <td className="py-2 pr-4">
                    <select
                      className="input input-sm"
                      value={t.status}
                      onChange={(e) => handleStatusChange(t.id, e.target.value as TransmittalStatus)}
                      disabled={!canUpdateStatus}
                    >
                      {STATUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/transmittals/print/${t.id}`}
                        target="_blank"
                        className="tab-button tab-button-inactive"
                      >
                        Print
                      </Link>
                      {canDelete && (
                        <button
                          type="button"
                          className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                          onClick={() => handleDeleteTransmittal(t)}
                          disabled={deletingId === t.id}
                        >
                          {deletingId === t.id ? "Deleting…" : "Delete"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {deleteError && <p className="mt-3 text-sm text-red-600">{deleteError}</p>}
    </div>
  );
}

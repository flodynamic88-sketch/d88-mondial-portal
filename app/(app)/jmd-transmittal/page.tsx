"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import RequireRole from "@/components/RequireRole";
import { createClient } from "@/lib/supabase/client";
import { dateToMonthValue } from "@/lib/dateHelpers";
import type { Invoice, InvoiceCategory, Principal } from "@/types/database";

/**
 * JMD Transmittal -- a proof-of-handoff document for the invoices D88
 * forwards to JMD (the outside trucking/logistics contractor) before those
 * invoices are released to JMD for delivery. Requested so Logistics has
 * something JMD signs to acknowledge exactly which documents were handed
 * over, mirroring the existing internal Transmittals feature (which does
 * the same thing for the Invoice Department) but pointed at JMD instead.
 *
 * Deliberately NOT persisted like transmittals/transmittal_items -- this is
 * a one-time "check the boxes, print" flow with no saved batch record, no
 * transmittal_id stamped on the invoice, and no history/status tracking.
 * Any currently-encoded invoice can be selected any number of times.
 *
 * Access matches Encode Invoices' edit roles (ADMIN/LOGISTICS_OFFICER/
 * LOGISTICS_ASSOCIATE) -- the people who actually hand documents to JMD --
 * not JMD's own roles, which only get view access to Encode Invoices.
 */

const TABS: { value: InvoiceCategory; label: string }[] = [
  { value: "CONSIGNMENT", label: "Consignment" },
  { value: "OUTRIGHT", label: "Outright" },
  { value: "MERCURY_DRUG", label: "Mercury Drug" },
  { value: "FLO_PRINCIPAL", label: "FLO-Principal" },
];

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

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

const PAGE_SIZE = 50;

export default function JmdTransmittalPage() {
  const [tab, setTab] = useState<InvoiceCategory>("CONSIGNMENT");

  return (
    <RequireRole roles={["ADMIN", "LOGISTICS_OFFICER", "LOGISTICS_ASSOCIATE"]}>
      <div>
        <div className="page-header border-b-0 pb-0">
          <div>
            <h1 className="page-title">JMD Transmittal</h1>
            <p className="page-subtitle">
              Check off the invoices being forwarded to JMD, then print a transmittal for JMD to
              sign as proof of receipt before you release those invoices to them.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              className={tab === t.value ? "tab-button tab-button-active" : "tab-button tab-button-inactive"}
              onClick={() => setTab(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <SelectTab key={tab} category={tab} />
      </div>
    </RequireRole>
  );
}

function SelectTab({ category }: { category: InvoiceCategory }) {
  const label = TABS.find((t) => t.value === category)?.label ?? category;

  const [encodedDate, setEncodedDate] = useState(todayStr());
  const [allDates, setAllDates] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [principalOptions, setPrincipalOptions] = useState<Principal[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const buildQuery = useCallback(() => {
    const supabase = createClient();
    let query = supabase.from("invoices").select("*").eq("category", category);
    if (!allDates && encodedDate) {
      // "Encoded on" -- created_at is a timestamp, so match the calendar day
      // by range rather than equality.
      const start = `${encodedDate}T00:00:00`;
      const end = `${encodedDate}T23:59:59.999`;
      query = query.gte("created_at", start).lte("created_at", end);
    }
    if (search) {
      query = query.or(
        `document_no.ilike.%${search}%,company_name_raw.ilike.%${search}%,branch_address.ilike.%${search}%`
      );
    }
    return query.order("document_no_sort", { ascending: true });
  }, [category, allDates, encodedDate, search]);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const { data, error } = await buildQuery().range(0, PAGE_SIZE - 1);
      if (error) {
        setErrorMsg("Could not load invoices. Connect a Supabase project to see live data.");
        setInvoices([]);
        setHasMore(false);
        return;
      }
      const rows = (data ?? []) as Invoice[];
      setInvoices(rows);
      setHasMore(rows.length === PAGE_SIZE);
      setChecked(new Set());
    } catch {
      setErrorMsg("Could not load invoices. Connect a Supabase project to see live data.");
      setInvoices([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    async function loadPrincipals() {
      try {
        const supabase = createClient();
        const { data } = await supabase.from("principals").select("*").order("name");
        setPrincipalOptions((data ?? []) as Principal[]);
      } catch {
        setPrincipalOptions([]);
      }
    }
    if (category === "FLO_PRINCIPAL") loadPrincipals();
  }, [category]);

  async function handleLoadMore() {
    setLoadingMore(true);
    try {
      const { data, error } = await buildQuery().range(invoices.length, invoices.length + PAGE_SIZE - 1);
      if (!error) {
        const rows = (data ?? []) as Invoice[];
        setInvoices((prev) => [...prev, ...rows]);
        setHasMore(rows.length === PAGE_SIZE);
      }
    } finally {
      setLoadingMore(false);
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

  function selectAllShown() {
    setChecked(new Set(invoices.map((i) => i.id)));
  }

  function clearSelection() {
    setChecked(new Set());
  }

  function retailChainLabel(inv: Invoice) {
    if (category === "MERCURY_DRUG") return "Mercury Drug Corporation";
    if (category === "FLO_PRINCIPAL") {
      return principalOptions.find((p) => p.id === inv.principal_id)?.name ?? "—";
    }
    return inv.company_name_raw ?? "—";
  }

  const selectedAmount = useMemo(
    () => invoices.filter((i) => checked.has(i.id)).reduce((sum, i) => sum + (i.amount ?? 0), 0),
    [invoices, checked]
  );

  function handlePrint() {
    if (checked.size === 0) return;
    const ids = Array.from(checked).join(",");
    window.open(`/jmd-transmittal/print?ids=${encodeURIComponent(ids)}`, "_blank");
  }

  return (
    <div className="card mt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="encodedDate">
              Encoded On
            </label>
            <input
              id="encodedDate"
              type="date"
              className="input"
              value={encodedDate}
              onChange={(e) => setEncodedDate(e.target.value)}
              disabled={allDates}
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={allDates}
              onChange={(e) => setAllDates(e.target.checked)}
            />
            All dates
          </label>
          <div className="min-w-[220px]">
            <label className="label" htmlFor={`search-${category}`}>
              Search
            </label>
            <input
              id={`search-${category}`}
              type="text"
              className="input"
              placeholder="Doc #, retail chain, branch…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-gray-500">Selected Amount</p>
          <p className="text-xl font-bold text-brand-700">{formatMoney(selectedAmount)}</p>
        </div>
      </div>

      <h2 className="mt-6 text-lg font-semibold text-gray-800">{label} Invoices</h2>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="tab-button tab-button-inactive" onClick={selectAllShown} disabled={invoices.length === 0}>
          Select All Shown
        </button>
        <button type="button" className="tab-button tab-button-inactive" onClick={clearSelection} disabled={checked.size === 0}>
          Clear Selection
        </button>
      </div>

      {loading && <p className="mt-3 text-sm text-gray-400">Loading…</p>}
      {!loading && errorMsg && <p className="mt-3 text-sm text-gray-400">{errorMsg}</p>}
      {!loading && !errorMsg && invoices.length === 0 && (
        <p className="mt-3 text-sm text-gray-400">
          No {label.toLowerCase()} invoices {allDates ? "found" : `encoded on ${new Date(encodedDate).toLocaleDateString()}`}.
        </p>
      )}
      {!loading && !errorMsg && invoices.length > 0 && (
        <div className="mt-3 table-scroll-container">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                <th className="py-2 pr-4">Include</th>
                <th className="py-2 pr-4">Document #</th>
                <th className="py-2 pr-4">{category === "FLO_PRINCIPAL" ? "Principal" : "Retail Chain"}</th>
                <th className="py-2 pr-4">Branch/Store Address</th>
                <th className="py-2 pr-4">Month of Invoice</th>
                <th className="py-2 pr-4">Posting Date</th>
                <th className="py-2 pr-4">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="py-2 pr-4">
                    <input type="checkbox" checked={checked.has(inv.id)} onChange={() => toggleRow(inv.id)} />
                  </td>
                  <td className="py-2 pr-4 font-medium text-gray-800">{inv.document_no}</td>
                  <td className="py-2 pr-4">{retailChainLabel(inv)}</td>
                  <td className="py-2 pr-4">{inv.branch_address ?? "—"}</td>
                  <td className="py-2 pr-4">{formatMonthLabel(inv.billing_period)}</td>
                  <td className="py-2 pr-4">
                    {inv.posting_date ? new Date(inv.posting_date).toLocaleDateString() : "—"}
                  </td>
                  <td className="py-2 pr-4">{formatMoney(inv.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !errorMsg && hasMore && (
        <div className="mt-3 flex justify-center">
          <button type="button" className="tab-button tab-button-inactive" onClick={handleLoadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}

      <button
        type="button"
        className="btn-primary mt-6"
        onClick={handlePrint}
        disabled={checked.size === 0}
      >
        Print Transmittal ({checked.size})
      </button>
    </div>
  );
}

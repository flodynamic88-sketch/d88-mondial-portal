"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import RequireRole from "@/components/RequireRole";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/Toast";
import { exportTruckingBillingExcel } from "@/lib/exportTruckingBillingExcel";
import type {
  TruckingBillingStatus,
  TruckingRate,
  VTruckingBillingCandidate,
  VTruckingBillingStatement,
} from "@/types/database";

const VAT_RATE = 0.12;

function formatMoney(value: number | null | undefined) {
  return (value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString() : "—";
}

function startOfWeekStr() {
  const now = new Date();
  const day = now.getDay(); // 0 = Sun
  const diff = day === 0 ? 6 : day - 1; // back to Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  return monday.toISOString().slice(0, 10);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

type TabKey = "GENERATE" | "FOR_BILLING" | "BILLED" | "PAID" | "RATES";

const STATUS_TABS: { value: TabKey; label: string; status?: TruckingBillingStatus }[] = [
  { value: "GENERATE", label: "Generate" },
  { value: "FOR_BILLING", label: "For Billing", status: "FOR_BILLING" },
  { value: "BILLED", label: "Billed", status: "BILLED" },
  { value: "PAID", label: "Paid", status: "PAID" },
  { value: "RATES", label: "Trucking Rates" },
];

export default function TruckingBillingPage() {
  const profile = useAuth();
  const role = profile?.role;
  const canManage =
    role === "ADMIN" || role === "LOGISTICS_OFFICER" || role === "GENERAL_MANAGER";
  const canSeeRate = role === "ADMIN" || role === "LOGISTICS_OFFICER";
  const canDelete = role === "ADMIN";

  const [tab, setTab] = useState<TabKey>("GENERATE");

  return (
    <RequireRole roles={["ADMIN", "LOGISTICS_OFFICER", "GENERAL_MANAGER"]}>
      <div>
        <div className="page-header border-b-0 pb-0">
          <div>
            <h1 className="page-title">Trucking Billing</h1>
            <p className="page-subtitle">
              Daily trucking expense derived from Route Plan, generated per date period so it can
              be cross-checked against JMD Industrial Trading&apos;s own billing submission.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {STATUS_TABS.map((t) => (
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

        {tab === "GENERATE" ? (
          <GenerateTab canManage={canManage} canSeeRate={canSeeRate} />
        ) : tab === "RATES" ? (
          <RatesTab canManageRates={canSeeRate} />
        ) : (
          <StatusTab
            status={STATUS_TABS.find((t) => t.value === tab)!.status!}
            canManage={canManage}
            canSeeRate={canSeeRate}
            canDelete={canDelete}
          />
        )}
      </div>
    </RequireRole>
  );
}

function GenerateTab({
  canManage,
  canSeeRate,
}: {
  canManage: boolean;
  canSeeRate: boolean;
}) {
  const { showToast } = useToast();
  const [startDate, setStartDate] = useState(startOfWeekStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [seriesNo, setSeriesNo] = useState("");
  const [candidates, setCandidates] = useState<VTruckingBillingCandidate[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("v_trucking_billing_candidates")
        .select("*")
        .gte("route_date", startDate)
        .lte("route_date", endDate)
        .order("route_date", { ascending: true });
      if (error) {
        setErrorMsg(
          "Could not load Route Plan trucks for this period. Connect a Supabase project to see live data."
        );
        setCandidates([]);
        return;
      }
      const rows = (data ?? []) as VTruckingBillingCandidate[];
      setCandidates(rows);
      setChecked(new Set(rows.map((r) => r.route_plan_truck_id)));
    } catch {
      setErrorMsg(
        "Could not load Route Plan trucks for this period. Connect a Supabase project to see live data."
      );
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  function toggleRow(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selected = useMemo(
    () => candidates.filter((c) => checked.has(c.route_plan_truck_id)),
    [candidates, checked]
  );
  const subtotal = useMemo(
    () => selected.reduce((sum, c) => sum + (c.truck_rate ?? 0), 0),
    [selected]
  );
  const vat = subtotal * VAT_RATE;
  const total = subtotal + vat;

  async function handleGenerate() {
    const ids = selected.map((c) => c.route_plan_truck_id);
    if (ids.length === 0) {
      showToast("Select at least one truck to include.", "error");
      return;
    }
    setGenerating(true);
    try {
      const supabase = createClient();
      const payload = ids.map((route_plan_truck_id) => ({
        route_plan_truck_id,
        series_no: seriesNo.trim() || null,
      }));
      const { error } = await supabase
        .from("trucking_billing_statements")
        .upsert(payload, { onConflict: "route_plan_truck_id", ignoreDuplicates: true });
      if (error) {
        showToast(`Failed to generate statements: ${error.message}`, "error");
        return;
      }
      showToast(`${ids.length} billing statement(s) generated. See the For Billing tab.`, "success");
      await load();
    } catch {
      showToast("Could not generate statements. Make sure a Supabase project is connected.", "error");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="card mt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="startDate">
              From
            </label>
            <input
              id="startDate"
              type="date"
              className="input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="endDate">
              To
            </label>
            <input
              id="endDate"
              type="date"
              className="input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="seriesNo">
              Series # (SOA #)
            </label>
            <input
              id="seriesNo"
              type="text"
              className="input"
              placeholder="e.g. MND-0726-040"
              value={seriesNo}
              onChange={(e) => setSeriesNo(e.target.value)}
              disabled={!canManage}
            />
          </div>
        </div>
        {canSeeRate && (
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-gray-500">
              Selected Subtotal + 12% VAT
            </p>
            <p className="text-xl font-bold text-brand-700">{formatMoney(total)}</p>
            <p className="text-xs text-gray-400">
              Subtotal {formatMoney(subtotal)} + VAT {formatMoney(vat)}
            </p>
          </div>
        )}
      </div>

      <h2 className="mt-6 text-lg font-semibold text-gray-800">
        Route Plan Trucks — {new Date(startDate).toLocaleDateString()} to{" "}
        {new Date(endDate).toLocaleDateString()}
      </h2>
      <p className="text-xs text-gray-400">
        Match this range to whatever period JMD&apos;s billing submission covers. Only trucks not
        yet on a billing statement are listed. Waybill/delivery-report line items, retail-chain
        accounts, and rate are all pulled automatically from Route Plan — nothing to re-type here.
        Series # is JMD&apos;s SOA # for the whole coverage period — type it once here and every
        truck generated below will share it (editable per-row afterward if you need to fix one).
      </p>

      {!canManage && (
        <p className="mt-4 text-xs text-gray-400">
          View-only access — generating billing statements is handled by Logistics/Invoicing.
        </p>
      )}

      {loading && <p className="mt-3 text-sm text-gray-400">Loading…</p>}
      {!loading && errorMsg && <p className="mt-3 text-sm text-gray-400">{errorMsg}</p>}
      {!loading && !errorMsg && candidates.length === 0 && (
        <p className="mt-3 text-sm text-gray-400">
          No un-billed Route Plan trucks in this period.
        </p>
      )}
      {!loading && !errorMsg && candidates.length > 0 && (
        <div className="mt-3 table-scroll-container">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                <th className="py-2 pr-4">Include</th>
                <th className="py-2 pr-4">Route Date</th>
                <th className="py-2 pr-4">Plate #</th>
                <th className="py-2 pr-4">Carrier</th>
                <th className="py-2 pr-4">Driver</th>
                <th className="py-2 pr-4 text-right">Items</th>
                <th className="py-2 pr-4 text-right">Boxes</th>
                <th className="py-2 pr-4 text-right">Invoice Amount</th>
                {canSeeRate && <th className="py-2 pr-4 text-right">Truck Rate</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {candidates.map((c) => (
                <tr key={c.route_plan_truck_id}>
                  <td className="py-2 pr-4">
                    <input
                      type="checkbox"
                      checked={checked.has(c.route_plan_truck_id)}
                      onChange={() => toggleRow(c.route_plan_truck_id)}
                      disabled={!canManage}
                    />
                  </td>
                  <td className="py-2 pr-4">{formatDate(c.route_date)}</td>
                  <td className="py-2 pr-4 font-medium text-gray-800">{c.plate_number ?? "—"}</td>
                  <td className="py-2 pr-4">{c.carrier ?? "—"}</td>
                  <td className="py-2 pr-4">{c.driver_name ?? "—"}</td>
                  <td className="py-2 pr-4 text-right">{c.item_count}</td>
                  <td className="py-2 pr-4 text-right">{c.total_boxes}</td>
                  <td className="py-2 pr-4 text-right">{formatMoney(c.total_amount)}</td>
                  {canSeeRate && (
                    <td className="py-2 pr-4 text-right">{formatMoney(c.truck_rate)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && !loading && !errorMsg && candidates.length > 0 && (
        <button
          type="button"
          className="btn-primary mt-4"
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating
            ? "Generating…"
            : `Generate Billing Statement(s) for ${selected.length} Truck(s)`}
        </button>
      )}
    </div>
  );
}

function StatusTab({
  status,
  canManage,
  canSeeRate,
  canDelete,
}: {
  status: TruckingBillingStatus;
  canManage: boolean;
  canSeeRate: boolean;
  canDelete: boolean;
}) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<VTruckingBillingStatement[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const label = STATUS_TABS.find((t) => t.status === status)?.label ?? status;

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("v_trucking_billing_statements")
        .select("*")
        .eq("status", status)
        .order("route_date", { ascending: false });
      if (error) {
        setErrorMsg(
          "Could not load billing statements. Connect a Supabase project to see live data."
        );
        setRows([]);
        return;
      }
      setRows((data ?? []) as VTruckingBillingStatement[]);
    } catch {
      setErrorMsg(
        "Could not load billing statements. Connect a Supabase project to see live data."
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.series_no, r.waybill_no, r.plate_number, r.carrier]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q))
    );
  }, [rows, search]);

  const subtotal = useMemo(
    () => filteredRows.reduce((sum, r) => sum + (r.truck_rate ?? 0), 0),
    [filteredRows]
  );
  const vat = subtotal * VAT_RATE;
  const total = subtotal + vat;

  async function handleStatusChange(row: VTruckingBillingStatement, next: TruckingBillingStatus) {
    setSavingId(row.id);
    try {
      const supabase = createClient();
      const patch: Record<string, unknown> = { status: next };
      if (next === "BILLED" && !row.billed_at) patch.billed_at = new Date().toISOString();
      if (next === "PAID" && !row.paid_at) patch.paid_at = new Date().toISOString();
      const { error } = await supabase
        .from("trucking_billing_statements")
        .update(patch)
        .eq("id", row.id);
      if (error) {
        showToast("Failed to update status.", "error");
        return;
      }
      showToast("Billing statement status updated.", "success");
      await load();
    } catch {
      showToast("Failed to update status.", "error");
    } finally {
      setSavingId(null);
    }
  }

  async function handleSeriesNoChange(row: VTruckingBillingStatement, seriesNo: string) {
    try {
      const supabase = createClient();
      await supabase
        .from("trucking_billing_statements")
        .update({ series_no: seriesNo.trim() || null })
        .eq("id", row.id);
    } catch {
      // Best-effort inline save; next full reload will show the last-saved value.
    }
  }

  async function handleWaybillChange(row: VTruckingBillingStatement, waybillNo: string) {
    try {
      const supabase = createClient();
      await supabase
        .from("trucking_billing_statements")
        .update({ waybill_no: waybillNo.trim() || null })
        .eq("id", row.id);
    } catch {
      // Best-effort inline save; next full reload will show the last-saved value.
    }
  }

  // One row per ACTUAL convoy sub-truck on this main truck (see migration
  // 0058) -- each convoy sub-truck shares this statement's single rate, so
  // its waybill # is entered here instead of generating a separate statement
  // for it. Print/export join every convoy's waybill # with " / ".
  async function handleConvoyWaybillChange(
    row: VTruckingBillingStatement,
    routePlanTruckId: string,
    convoyWaybillNo: string
  ) {
    try {
      const supabase = createClient();
      await supabase.from("trucking_billing_convoy_waybills").upsert(
        {
          statement_id: row.id,
          route_plan_truck_id: routePlanTruckId,
          waybill_no: convoyWaybillNo.trim() || null,
        },
        { onConflict: "statement_id,route_plan_truck_id" }
      );
    } catch {
      // Best-effort inline save; next full reload will show the last-saved value.
    }
  }

  async function handleTruckTypeChange(row: VTruckingBillingStatement, truckType: string) {
    try {
      const supabase = createClient();
      await supabase
        .from("trucking_billing_statements")
        .update({ truck_type: truckType.trim() || null })
        .eq("id", row.id);
    } catch {
      // Best-effort inline save; next full reload will show the last-saved value.
    }
  }

  async function handleDelete(row: VTruckingBillingStatement) {
    const confirmed = window.confirm(
      `Delete billing statement ${row.series_no} for ${row.plate_number ?? "this truck"}? It will become available again in Generate. This cannot be undone.`
    );
    if (!confirmed) return;
    try {
      const supabase = createClient();
      const { error } = await supabase.from("trucking_billing_statements").delete().eq("id", row.id);
      if (error) {
        showToast(`Failed to delete: ${error.message}`, "error");
        return;
      }
      showToast("Billing statement deleted.", "success");
      await load();
    } catch {
      showToast("Failed to delete billing statement.", "error");
    }
  }

  async function handleExport() {
    if (filteredRows.length === 0) return;
    setExporting(true);
    try {
      await exportTruckingBillingExcel(filteredRows.map((r) => r.id));
    } catch {
      showToast("Could not build the Excel export.", "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="card mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-800">{label} — Trucking Billing</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            className="input max-w-[220px]"
            placeholder="Search series #, waybill #, plate…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            type="button"
            className="tab-button tab-button-inactive"
            onClick={handleExport}
            disabled={exporting || filteredRows.length === 0}
          >
            {exporting ? "Exporting…" : "Export Excel"}
          </button>
        </div>
      </div>

      {canSeeRate && (
        <p className="mt-2 text-sm text-gray-500">
          Subtotal <span className="font-semibold text-gray-800">{formatMoney(subtotal)}</span> +
          12% VAT <span className="font-semibold text-gray-800">{formatMoney(vat)}</span> = Total{" "}
          <span className="font-semibold text-gray-800">{formatMoney(total)}</span>
        </p>
      )}

      {loading && <p className="mt-3 text-sm text-gray-400">Loading…</p>}
      {!loading && errorMsg && <p className="mt-3 text-sm text-gray-400">{errorMsg}</p>}
      {!loading && !errorMsg && rows.length === 0 && (
        <p className="mt-3 text-sm text-gray-400">No {label.toLowerCase()} statements yet.</p>
      )}
      {!loading && !errorMsg && rows.length > 0 && filteredRows.length === 0 && (
        <p className="mt-3 text-sm text-gray-400">No statements match &quot;{search}&quot;.</p>
      )}
      {!loading && !errorMsg && filteredRows.length > 0 && (
        <div className="mt-3 table-scroll-container">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                <th className="py-2 pr-4">Series #</th>
                <th className="py-2 pr-4">Waybill #</th>
                <th className="py-2 pr-4">Area</th>
                <th className="py-2 pr-4">Truck Type</th>
                <th className="py-2 pr-4">Route Date</th>
                <th className="py-2 pr-4">Plate #</th>
                <th className="py-2 pr-4">Carrier</th>
                <th className="py-2 pr-4 text-right">Boxes</th>
                {canSeeRate && <th className="py-2 pr-4 text-right">Rate</th>}
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-4">
                    <input
                      type="text"
                      className="input input-sm"
                      defaultValue={r.series_no ?? ""}
                      placeholder="e.g. MND-0726-040"
                      onBlur={(e) => handleSeriesNoChange(r, e.target.value)}
                      disabled={!canManage}
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <input
                      type="text"
                      className="input input-sm"
                      defaultValue={r.waybill_no ?? ""}
                      placeholder="e.g. JMD 26-0674"
                      onBlur={(e) => handleWaybillChange(r, e.target.value)}
                      disabled={!canManage}
                    />
                    {(r.convoys ?? []).map((c) => (
                      <input
                        key={c.route_plan_truck_id}
                        type="text"
                        className="input input-sm mt-1"
                        defaultValue={c.waybill_no ?? ""}
                        placeholder={`Convoy waybill # (${c.plate_number ?? "convoy"})`}
                        onBlur={(e) =>
                          handleConvoyWaybillChange(r, c.route_plan_truck_id, e.target.value)
                        }
                        disabled={!canManage}
                      />
                    ))}
                  </td>
                  <td className="py-2 pr-4 text-gray-700">
                    {r.area ?? "—"}
                  </td>
                  <td className="py-2 pr-4">
                    <select
                      className="input input-sm"
                      value={r.truck_type ?? ""}
                      onChange={(e) => handleTruckTypeChange(r, e.target.value)}
                      disabled={!canManage}
                    >
                      <option value="">—</option>
                      <option value="4W">4W</option>
                      <option value="6W">6W</option>
                    </select>
                  </td>
                  <td className="py-2 pr-4">{formatDate(r.route_date)}</td>
                  <td className="py-2 pr-4 font-medium text-gray-800">{r.plate_number ?? "—"}</td>
                  <td className="py-2 pr-4">{r.carrier ?? "—"}</td>
                  <td className="py-2 pr-4 text-right">{r.total_boxes}</td>
                  {canSeeRate && (
                    <td className="py-2 pr-4 text-right">{formatMoney(r.truck_rate)}</td>
                  )}
                  <td className="py-2 pr-4">
                    <select
                      className="input input-sm"
                      value={r.status}
                      onChange={(e) =>
                        handleStatusChange(r, e.target.value as TruckingBillingStatus)
                      }
                      disabled={!canManage || savingId === r.id}
                    >
                      <option value="FOR_BILLING">For Billing</option>
                      <option value="BILLED">Billed</option>
                      <option value="PAID">Paid</option>
                    </select>
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/trucking-billing/print/${r.id}/billing-statement`}
                        target="_blank"
                        className="tab-button tab-button-inactive"
                      >
                        Billing Statement
                      </Link>
                      <Link
                        href={`/trucking-billing/print/${r.id}/delivery-report`}
                        target="_blank"
                        className="tab-button tab-button-inactive"
                      >
                        Delivery Report
                      </Link>
                      {canDelete && (
                        <button
                          type="button"
                          className="text-xs font-medium text-red-600 hover:text-red-800"
                          onClick={() => handleDelete(r)}
                        >
                          Delete
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
  );
}

interface RateDraft {
  destination: string;
  area: string;
  rate: string;
  convoy_rate: string;
}

const EMPTY_RATE_DRAFT: RateDraft = { destination: "", area: "", rate: "", convoy_rate: "" };

function RatesTab({ canManageRates }: { canManageRates: boolean }) {
  const { showToast } = useToast();
  const [rates, setRates] = useState<TruckingRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newRate, setNewRate] = useState<RateDraft>(EMPTY_RATE_DRAFT);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<RateDraft>(EMPTY_RATE_DRAFT);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("v_trucking_rates")
        .select("*")
        .order("area", { ascending: true })
        .order("destination", { ascending: true });
      if (error) {
        setErrorMsg("Could not load trucking rates. Connect a Supabase project to see live data.");
        setRates([]);
        return;
      }
      setRates((data ?? []) as TruckingRate[]);
    } catch {
      setErrorMsg("Could not load trucking rates. Connect a Supabase project to see live data.");
      setRates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rates;
    return rates.filter((r) =>
      [r.destination, r.area].filter(Boolean).some((v) => (v as string).toLowerCase().includes(q))
    );
  }, [rates, search]);

  function parseMoney(value: string): number | null {
    if (!value.trim()) return null;
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }

  async function handleAdd() {
    if (!newRate.destination.trim() || !newRate.area.trim()) {
      showToast("Destination and Area are required.", "error");
      return;
    }
    const rate = parseMoney(newRate.rate);
    const convoyRate = parseMoney(newRate.convoy_rate);
    if (rate === null || convoyRate === null) {
      showToast("Rate and Convoy Rate must be valid numbers.", "error");
      return;
    }
    setAdding(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("trucking_rates").insert({
        destination: newRate.destination.trim().toUpperCase(),
        area: newRate.area.trim().toUpperCase(),
        rate,
        convoy_rate: convoyRate,
      });
      if (error) {
        showToast(`Failed to add rate: ${error.message}`, "error");
        return;
      }
      showToast("Destination rate added.", "success");
      setNewRate(EMPTY_RATE_DRAFT);
      await load();
    } catch {
      showToast("Could not add rate. Make sure a Supabase project is connected.", "error");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(r: TruckingRate) {
    setEditingId(r.id);
    setEditDraft({
      destination: r.destination,
      area: r.area,
      rate: r.rate !== null && r.rate !== undefined ? String(r.rate) : "",
      convoy_rate:
        r.convoy_rate !== null && r.convoy_rate !== undefined ? String(r.convoy_rate) : "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(EMPTY_RATE_DRAFT);
  }

  async function handleSaveEdit(id: string) {
    if (!editDraft.destination.trim() || !editDraft.area.trim()) {
      showToast("Destination and Area are required.", "error");
      return;
    }
    const rate = parseMoney(editDraft.rate);
    const convoyRate = parseMoney(editDraft.convoy_rate);
    if (rate === null || convoyRate === null) {
      showToast("Rate and Convoy Rate must be valid numbers.", "error");
      return;
    }
    setSavingId(id);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("trucking_rates")
        .update({
          destination: editDraft.destination.trim().toUpperCase(),
          area: editDraft.area.trim().toUpperCase(),
          rate,
          convoy_rate: convoyRate,
        })
        .eq("id", id);
      if (error) {
        showToast(`Failed to update rate: ${error.message}`, "error");
        return;
      }
      showToast("Destination rate updated.", "success");
      setEditingId(null);
      await load();
    } catch {
      showToast("Could not update rate. Make sure a Supabase project is connected.", "error");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDeleteRate(r: TruckingRate) {
    const confirmed = window.confirm(
      `Delete the trucking rate for ${r.destination}? Trucks already routed there keep their last computed rate, but new trucks won't auto-fill until this destination is re-added. This cannot be undone.`
    );
    if (!confirmed) return;
    try {
      const supabase = createClient();
      const { error } = await supabase.from("trucking_rates").delete().eq("id", r.id);
      if (error) {
        showToast(`Failed to delete rate: ${error.message}`, "error");
        return;
      }
      showToast("Destination rate deleted.", "success");
      await load();
    } catch {
      showToast("Could not delete rate.", "error");
    }
  }

  return (
    <div className="card mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">Trucking Rates</h2>
          <p className="text-xs text-gray-400">
            Per-destination rate table. Route Plan trucks pick a Destination and their Truck Rate
            fills in automatically from here — convoy trucks use the Convoy Rate instead of a
            second charge.
          </p>
        </div>
        <input
          type="text"
          className="input max-w-[220px]"
          placeholder="Search destination, area…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {!canManageRates && (
        <p className="mt-4 text-xs text-gray-400">
          View-only access — rate figures and edits are restricted to Admin/Logistics Officer.
        </p>
      )}

      {canManageRates && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-5 sm:items-end">
          <div>
            <label className="label">Destination</label>
            <input
              className="input"
              value={newRate.destination}
              onChange={(e) => setNewRate((d) => ({ ...d, destination: e.target.value }))}
              placeholder="e.g. MEYCAUAYAN"
            />
          </div>
          <div>
            <label className="label">Area</label>
            <input
              className="input"
              value={newRate.area}
              onChange={(e) => setNewRate((d) => ({ ...d, area: e.target.value }))}
              placeholder="e.g. BULACAN"
            />
          </div>
          <div>
            <label className="label">Rate</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="input no-spinner"
              value={newRate.rate}
              onChange={(e) => setNewRate((d) => ({ ...d, rate: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Convoy Rate</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="input no-spinner"
              value={newRate.convoy_rate}
              onChange={(e) => setNewRate((d) => ({ ...d, convoy_rate: e.target.value }))}
            />
          </div>
          <button type="button" className="btn-primary" onClick={handleAdd} disabled={adding}>
            {adding ? "Adding…" : "Add Destination"}
          </button>
        </div>
      )}

      {loading && <p className="mt-3 text-sm text-gray-400">Loading…</p>}
      {!loading && errorMsg && <p className="mt-3 text-sm text-gray-400">{errorMsg}</p>}
      {!loading && !errorMsg && filteredRates.length === 0 && (
        <p className="mt-3 text-sm text-gray-400">
          {search ? `No destinations match "${search}".` : "No trucking rates yet."}
        </p>
      )}
      {!loading && !errorMsg && filteredRates.length > 0 && (
        <div className="mt-3 table-scroll-container">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                <th className="py-2 pr-4">Destination</th>
                <th className="py-2 pr-4">Area</th>
                {canManageRates && <th className="py-2 pr-4 text-right">Rate</th>}
                {canManageRates && <th className="py-2 pr-4 text-right">Convoy Rate</th>}
                {canManageRates && <th className="py-2 pr-4">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRates.map((r) => {
                const isEditing = editingId === r.id;
                return (
                  <tr key={r.id}>
                    <td className="py-2 pr-4 font-medium text-gray-800">
                      {isEditing ? (
                        <input
                          className="input input-sm"
                          value={editDraft.destination}
                          onChange={(e) =>
                            setEditDraft((d) => ({ ...d, destination: e.target.value }))
                          }
                        />
                      ) : (
                        r.destination
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {isEditing ? (
                        <input
                          className="input input-sm"
                          value={editDraft.area}
                          onChange={(e) => setEditDraft((d) => ({ ...d, area: e.target.value }))}
                        />
                      ) : (
                        r.area
                      )}
                    </td>
                    {canManageRates && (
                      <td className="py-2 pr-4 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="input input-sm no-spinner text-right"
                            value={editDraft.rate}
                            onChange={(e) => setEditDraft((d) => ({ ...d, rate: e.target.value }))}
                          />
                        ) : (
                          formatMoney(r.rate)
                        )}
                      </td>
                    )}
                    {canManageRates && (
                      <td className="py-2 pr-4 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="input input-sm no-spinner text-right"
                            value={editDraft.convoy_rate}
                            onChange={(e) =>
                              setEditDraft((d) => ({ ...d, convoy_rate: e.target.value }))
                            }
                          />
                        ) : (
                          formatMoney(r.convoy_rate)
                        )}
                      </td>
                    )}
                    {canManageRates && (
                      <td className="py-2 pr-4">
                        <div className="flex flex-wrap gap-2">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                className="text-xs font-medium text-green-600 hover:text-green-800 disabled:opacity-50"
                                onClick={() => handleSaveEdit(r.id)}
                                disabled={savingId === r.id}
                              >
                                {savingId === r.id ? "…" : "Save"}
                              </button>
                              <button
                                type="button"
                                className="text-xs font-medium text-gray-500 hover:text-gray-700"
                                onClick={cancelEdit}
                                disabled={savingId === r.id}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="text-xs font-medium text-blue-600 hover:text-blue-800"
                                onClick={() => startEdit(r)}
                                disabled={editingId !== null}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="text-xs font-medium text-red-600 hover:text-red-800"
                                onClick={() => handleDeleteRate(r)}
                                disabled={editingId !== null}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

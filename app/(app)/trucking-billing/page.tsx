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

type TabKey = "GENERATE" | "FOR_BILLING" | "BILLED" | "PAID";

const STATUS_TABS: { value: TabKey; label: string; status?: TruckingBillingStatus }[] = [
  { value: "GENERATE", label: "Generate" },
  { value: "FOR_BILLING", label: "For Billing", status: "FOR_BILLING" },
  { value: "BILLED", label: "Billed", status: "BILLED" },
  { value: "PAID", label: "Paid", status: "PAID" },
];

export default function TruckingBillingPage() {
  const profile = useAuth();
  const role = profile?.role;
  const canManage =
    role === "ADMIN" ||
    role === "LOGISTICS_OFFICER" ||
    role === "GENERAL_MANAGER" ||
    role === "INVOICING_TEAM";
  const canSeeRate = role === "ADMIN" || role === "LOGISTICS_OFFICER";
  const canDelete = role === "ADMIN";

  const [tab, setTab] = useState<TabKey>("GENERATE");

  return (
    <RequireRole roles={["ADMIN", "LOGISTICS_OFFICER", "GENERAL_MANAGER", "INVOICING_TEAM"]}>
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
      const payload = ids.map((route_plan_truck_id) => ({ route_plan_truck_id }));
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

  async function handleAreaChange(row: VTruckingBillingStatement, area: string) {
    try {
      const supabase = createClient();
      await supabase
        .from("trucking_billing_statements")
        .update({ area: area.trim() || null })
        .eq("id", row.id);
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
                  <td className="py-2 pr-4 text-gray-500">{r.series_no}</td>
                  <td className="py-2 pr-4">
                    <input
                      type="text"
                      className="input input-sm"
                      defaultValue={r.waybill_no ?? ""}
                      placeholder="e.g. JMD 26-0674"
                      onBlur={(e) => handleWaybillChange(r, e.target.value)}
                      disabled={!canManage}
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <input
                      type="text"
                      className="input input-sm"
                      defaultValue={r.area ?? ""}
                      placeholder="e.g. PARANAQUE"
                      onBlur={(e) => handleAreaChange(r, e.target.value)}
                      disabled={!canManage}
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <input
                      type="text"
                      className="input input-sm"
                      defaultValue={r.truck_type ?? ""}
                      placeholder="e.g. 4W"
                      onBlur={(e) => handleTruckTypeChange(r, e.target.value)}
                      disabled={!canManage}
                    />
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
                        href={`/trucking-billing/print/${r.id}`}
                        target="_blank"
                        className="tab-button tab-button-inactive"
                      >
                        Print
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

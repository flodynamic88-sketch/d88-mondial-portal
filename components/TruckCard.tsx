"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import DocumentLookup from "@/components/DocumentLookup";
import AddTruckForm from "@/components/AddTruckForm";
import { useAuth } from "@/components/AuthProvider";
import { findOrCreateDeliveryReason } from "@/lib/invoiceHelpers";
import { ensureVarianceLog } from "@/lib/varianceLog";
import type {
  RoutePlanTruck,
  RoutePlanInvoice,
  Invoice,
  DeliveryReason,
  ReasonType,
  VTruckCts,
  FeeRate,
} from "@/types/database";

/** Human-readable zone label matching the fee schedule (NCR / NCR (DC) / etc). */
function zoneLabel(invoice: Invoice | null): string {
  if (!invoice) return "—";
  if (invoice.category === "MERCURY_DRUG") return "Flat rate";
  if (!invoice.zone) return "No zone set";
  const base =
    invoice.zone === "NCR" ? "NCR" : invoice.zone === "FAR_NORTH_SOUTH" ? "Far South/North" : "VizMin";
  return invoice.is_dc ? `${base} (DC)` : base;
}

const CUSTOM_DISCREPANCY = "__custom_discrepancy__";
const CUSTOM_BACKLOAD = "__custom_backload__";

/** Slices an ISO timestamp down to the yyyy-mm-dd a <input type="date"> expects. */
function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

interface AssignedInvoiceRow extends RoutePlanInvoice {
  invoice: Invoice | null;
}

interface TruckCardProps {
  truck: RoutePlanTruck;
  /** Display label for this truck, e.g. "Truck 1" or "Truck 1 · Convoy 1". */
  truckLabel: string;
  convoys: RoutePlanTruck[];
  deliveryReasons: DeliveryReason[];
  routePlanId: string;
  onRefreshTrucks: () => void;
  isConvoy?: boolean;
  /** Id of the truck whose details row is currently open, shared across the whole table. */
  expandedTruckId: string | null;
  onToggleExpand: (id: string) => void;
}

export default function TruckCard({
  truck,
  truckLabel,
  convoys,
  deliveryReasons,
  routePlanId,
  onRefreshTrucks,
  isConvoy = false,
  expandedTruckId,
  onToggleExpand,
}: TruckCardProps) {
  const profile = useAuth();
  const role = profile?.role;
  // Matches the server-side RLS/trigger rules in 0003_user_management.sql —
  // the UI hides actions the backend would reject, but the DB is still the
  // real enforcement point.
  const canSeeTruckRate = role === "ADMIN" || role === "LOGISTICS_OFFICER";
  const canDispatch = role === "ADMIN" || role === "JMD_PLANNER" || role === "LOGISTICS_OFFICER";
  const canUpdateDelivery =
    role === "ADMIN" || role === "LOGISTICS_OFFICER" || role === "LOGISTICS_ASSOCIATE";
  const canAddCustomReason = role === "ADMIN" || role === "LOGISTICS_ASSOCIATE";
  const canAddConvoy = role === "ADMIN" || role === "JMD_PLANNER" || role === "LOGISTICS_OFFICER";
  // Matches the route_plan_trucks/route_plan_invoices DELETE RLS policies.
  const canManageTruck = canAddConvoy;
  const canUnassignInvoice = role === "ADMIN" || role === "JMD_PLANNER";

  const [rows, setRows] = useState<AssignedInvoiceRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [cts, setCts] = useState<VTruckCts | null>(null);
  const [feeRates, setFeeRates] = useState<FeeRate[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dispatching, setDispatching] = useState(false);
  const [showAddConvoy, setShowAddConvoy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingTruck, setDeletingTruck] = useState(false);
  const [removingRowId, setRemovingRowId] = useState<string | null>(null);
  const [customEntry, setCustomEntry] = useState<{
    rowId: string;
    type: ReasonType;
    text: string;
  } | null>(null);
  const [savingCustom, setSavingCustom] = useState(false);

  const loadAssigned = useCallback(async () => {
    setLoadingRows(true);
    setRowsError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("route_plan_invoices")
        .select("*, invoice:invoices(*)")
        .eq("route_plan_truck_id", truck.id)
        .order("created_at", { ascending: true });

      if (error) {
        setRowsError("Could not load assigned invoices.");
        setRows([]);
      } else {
        setRows((data ?? []) as unknown as AssignedInvoiceRow[]);
      }

      const { data: ctsData } = await supabase
        .from("v_truck_cts")
        .select("*")
        .eq("truck_id", truck.id)
        .maybeSingle();
      setCts(ctsData ?? null);

      const { data: feeRateData } = await supabase.from("fee_rates").select("*");
      setFeeRates((feeRateData ?? []) as FeeRate[]);
    } catch {
      setRowsError(
        "Could not load assigned invoices. Connect a Supabase project to see live data."
      );
      setRows([]);
    } finally {
      setLoadingRows(false);
    }
  }, [truck.id]);

  useEffect(() => {
    loadAssigned();
  }, [loadAssigned, refreshKey]);

  async function handleDispatch() {
    setDispatching(true);
    setActionError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("route_plan_trucks")
        .update({ dispatched_at: new Date().toISOString() })
        .eq("id", truck.id);
      if (error) {
        setActionError("Failed to mark truck as dispatched.");
      } else {
        onRefreshTrucks();
      }
    } catch {
      setActionError("Could not dispatch truck. Make sure a Supabase project is connected.");
    } finally {
      setDispatching(false);
    }
  }

  async function handleDeleteTruck() {
    const confirmed = window.confirm(
      `Remove ${truckLabel}${
        truck.plate_number ? ` (${truck.plate_number})` : ""
      } from this route plan? Any assigned invoices will be unassigned. This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingTruck(true);
    setActionError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("route_plan_trucks").delete().eq("id", truck.id);
      if (error) {
        if (error.code === "23503") {
          setActionError(
            "Cannot remove this truck because it still has convoy trucks linked to it. Remove those convoy trucks first."
          );
        } else {
          setActionError(`Failed to remove truck: ${error.message}`);
        }
        return;
      }
      onRefreshTrucks();
    } catch {
      setActionError("Could not remove truck. Make sure a Supabase project is connected.");
    } finally {
      setDeletingTruck(false);
    }
  }

  async function handleRescheduleForRedelivery(row: AssignedInvoiceRow) {
    const confirmed = window.confirm(
      `Mark invoice ${row.invoice?.document_no ?? ""} as subject for redelivery? It will stay on this truck for history and no longer count toward this truck's CTS, and can be assigned to a new truck/date via Document Lookup.`
    );
    if (!confirmed) return;

    setRemovingRowId(row.id);
    setActionError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("route_plan_invoices")
        .update({ superseded_at: new Date().toISOString() })
        .eq("id", row.id);
      if (error) {
        setActionError("Failed to reschedule invoice for redelivery.");
        return;
      }
      setRefreshKey((k) => k + 1);
    } catch {
      setActionError(
        "Could not reschedule invoice for redelivery. Make sure a Supabase project is connected."
      );
    } finally {
      setRemovingRowId(null);
    }
  }

  async function handleRemoveAssignedInvoice(row: AssignedInvoiceRow) {
    const confirmed = window.confirm(
      `Unassign invoice ${row.invoice?.document_no ?? ""} from this truck? It will become available to assign again.`
    );
    if (!confirmed) return;

    setRemovingRowId(row.id);
    setActionError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("route_plan_invoices").delete().eq("id", row.id);
      if (error) {
        setActionError("Failed to unassign invoice.");
        return;
      }
      setRefreshKey((k) => k + 1);
    } catch {
      setActionError("Could not unassign invoice. Make sure a Supabase project is connected.");
    } finally {
      setRemovingRowId(null);
    }
  }

  /** Looks up the fee-schedule rate that matches this invoice's zone/DC/category. */
  function expectedRateFor(invoice: Invoice | null): number | null {
    if (!invoice) return null;
    const match =
      invoice.category === "MERCURY_DRUG"
        ? feeRates.find((r) => r.category === "MERCURY_DRUG")
        : feeRates.find(
            (r) =>
              r.category === invoice.category &&
              r.zone === invoice.zone &&
              r.is_dc === invoice.is_dc
          );
    return match?.rate_pct ?? null;
  }

  async function handleRateChange(rowId: string, value: string) {
    const trimmed = value.trim();
    if (trimmed === "") return;
    const num = Number(trimmed);
    if (Number.isNaN(num)) return;
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("route_plan_invoices")
        .update({ service_rate_pct: num })
        .eq("id", rowId);
      if (error) {
        setActionError("Failed to update service rate.");
      } else {
        setRefreshKey((k) => k + 1);
      }
    } catch {
      setActionError("Could not update service rate. Make sure a Supabase project is connected.");
    }
  }

  async function handleQtyBoxChange(rowId: string, value: string) {
    const trimmed = value.trim();
    const num = trimmed === "" ? null : Number(trimmed);
    if (num !== null && Number.isNaN(num)) return;
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("route_plan_invoices")
        .update({ qty_box: num })
        .eq("id", rowId);
      if (error) {
        setActionError("Failed to update qty per box.");
      } else {
        setRefreshKey((k) => k + 1);
      }
    } catch {
      setActionError("Could not update qty per box. Make sure a Supabase project is connected.");
    }
  }

  async function handleDeliveryDateChange(row: AssignedInvoiceRow, value: string) {
    setActionError(null);
    try {
      const supabase = createClient();
      // Store as UTC midnight for the picked date so the sync trigger's
      // `(delivered_at at time zone 'UTC')::date` cast lands on the exact
      // date the Logistics Associate chose, regardless of local timezone.
      const isoValue = value ? `${value}T00:00:00.000Z` : null;
      const { error } = await supabase
        .from("route_plan_invoices")
        .update({ delivered_at: isoValue })
        .eq("id", row.id);

      if (error) {
        setActionError("Failed to update delivery date.");
        return;
      }

      // invoices.actual_delivery_date and invoices.status are kept in sync by
      // the sync_invoice_delivery_date trigger (see
      // 0011_delivery_date_sync.sql), which runs as SECURITY DEFINER so it
      // isn't blocked by the ADMIN/JMD_PLANNER-only "invoices update" RLS
      // policy that would otherwise silently reject this for a Logistics
      // Associate.
      setRefreshKey((k) => k + 1);
    } catch {
      setActionError(
        "Could not update delivery date. Make sure a Supabase project is connected."
      );
    }
  }

  async function handleReasonChange(rowId: string, reasonId: string) {
    setActionError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("route_plan_invoices")
        .update({ reason_id: reasonId || null })
        .eq("id", rowId);

      if (error) {
        setActionError("Failed to save the reported issue.");
        return;
      }

      // Auto-link to the Delivery Variance Log: whenever a Discrepancy or
      // Backload reason is set, make sure a variance log header exists for
      // this assigned invoice so the details (items, etc.) can be filled in
      // from the Delivery Variance Log page.
      if (reasonId) {
        const invoiceId = rows.find((r) => r.id === rowId)?.invoice_id ?? null;
        await ensureVarianceLog(rowId, invoiceId, reasonId);
      }

      setRefreshKey((k) => k + 1);
    } catch {
      setActionError("Could not save the reported issue. Make sure a Supabase project is connected.");
    }
  }

  function handleReasonSelect(rowId: string, value: string) {
    if (value === CUSTOM_DISCREPANCY) {
      setCustomEntry({ rowId, type: "DISCREPANCY", text: "" });
      return;
    }
    if (value === CUSTOM_BACKLOAD) {
      setCustomEntry({ rowId, type: "BACKLOAD", text: "" });
      return;
    }
    setCustomEntry(null);
    handleReasonChange(rowId, value);
  }

  async function handleSaveCustomReason() {
    if (!customEntry) return;
    const text = customEntry.text.trim();
    if (!text) {
      setActionError("Type a reason before saving.");
      return;
    }
    setSavingCustom(true);
    setActionError(null);
    try {
      const reasonId = await findOrCreateDeliveryReason(customEntry.type, text);
      if (!reasonId) {
        setActionError("Failed to save the custom reason.");
        return;
      }
      await handleReasonChange(customEntry.rowId, reasonId);
      setCustomEntry(null);
    } finally {
      setSavingCustom(false);
    }
  }

  const discrepancyReasons = deliveryReasons.filter((r) => r.type === "DISCREPANCY");
  const backloadReasons = deliveryReasons.filter((r) => r.type === "BACKLOAD");
  const expanded = expandedTruckId === truck.id;

  return (
    <>
      <tr className={`border-t border-gray-100 align-top ${isConvoy ? "bg-gray-50/60" : ""}`}>
        <td className="py-2 pl-4 pr-3">
          <button
            type="button"
            onClick={() => onToggleExpand(truck.id)}
            className="mr-1 text-gray-400 hover:text-gray-600"
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? "▾" : "▸"}
          </button>
          <span className={isConvoy ? "text-sm text-gray-700" : "text-sm font-semibold text-gray-800"}>
            {truckLabel}
          </span>
          {truck.plate_number && (
            <p className="pl-4 text-xs text-gray-500">{truck.plate_number}</p>
          )}
        </td>
        <td className="py-2 pr-3 text-xs text-gray-700">{truck.carrier ?? "—"}</td>
        <td className="py-2 pr-3 text-xs text-gray-700">{truck.driver_name ?? "—"}</td>
        <td className="py-2 pr-3 text-xs text-gray-700">
          {[truck.helper1_name, truck.helper2_name].filter(Boolean).join(", ") || "—"}
        </td>
        <td className="py-2 pr-3 text-xs text-gray-700">
          {isConvoy ? (
            <span className="text-gray-400">Included in main</span>
          ) : canSeeTruckRate ? (
            (truck.truck_rate ?? 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })
          ) : (
            "—"
          )}
        </td>
        <td className="py-2 pr-3">
          {cts ? (
            <span
              className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                cts.cts_pass === null || cts.cts_pass === undefined
                  ? "bg-gray-100 text-gray-500"
                  : cts.cts_pass
                    ? "bg-green-50 text-green-700"
                    : "bg-red-50 text-red-700"
              }`}
            >
              {canSeeTruckRate && cts.cts_pct !== null && cts.cts_pct !== undefined
                ? `${cts.cts_pct}% · `
                : ""}
              {cts.cts_pass === null || cts.cts_pass === undefined
                ? "No data"
                : cts.cts_pass
                  ? "Pass"
                  : "Not Pass"}
            </span>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
        </td>
        <td className="py-2 pr-3">
          {truck.dispatched_at ? (
            <span className="whitespace-nowrap text-xs font-medium text-green-600">
              Dispatched {new Date(truck.dispatched_at).toLocaleDateString()}
            </span>
          ) : canDispatch ? (
            <button
              type="button"
              className="btn-primary px-2 py-1 text-xs"
              onClick={handleDispatch}
              disabled={dispatching}
            >
              {dispatching ? "…" : "Dispatch"}
            </button>
          ) : (
            <span className="text-xs text-gray-400">Not yet</span>
          )}
        </td>
        <td className="py-2 pl-3 pr-4">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/route-plan/print/${truck.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="tab-button tab-button-inactive whitespace-nowrap text-xs"
              title="Open a printable itinerary for this truck"
            >
              Print
            </a>
            {canManageTruck && (
              <button
                type="button"
                className="whitespace-nowrap text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                onClick={handleDeleteTruck}
                disabled={deletingTruck}
                title="Remove this truck from the route plan"
              >
                {deletingTruck ? "…" : "Remove"}
              </button>
            )}
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-gray-50/50">
          <td colSpan={8} className="px-4 pb-4 pt-1">
            {(role === "ADMIN" || role === "JMD_PLANNER") && (
              <div className="mb-3">
                <DocumentLookup
                  routePlanTruckId={truck.id}
                  onAssigned={() => setRefreshKey((k) => k + 1)}
                />
              </div>
            )}

            {actionError && <p className="mb-2 text-sm text-red-600">{actionError}</p>}

            <div>
              <h3 className="text-sm font-semibold text-gray-700">Assigned Invoices</h3>
              {loadingRows && <p className="mt-2 text-sm text-gray-400">Loading…</p>}
        {!loadingRows && rowsError && <p className="mt-2 text-sm text-gray-400">{rowsError}</p>}
        {!loadingRows && !rowsError && rows.length === 0 && (
          <p className="mt-2 text-sm text-gray-400">No invoices assigned yet.</p>
        )}
        {!loadingRows && !rowsError && rows.length > 0 && (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                  <th className="py-2 pr-4">Document No.</th>
                  <th className="py-2 pr-4">Company / Branch</th>
                  <th className="py-2 pr-4">Qty/Box</th>
                  <th className="py-2 pr-4">Amount</th>
                  <th className="py-2 pr-4">Rate %</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2 pr-4 font-medium text-gray-800">
                      {row.invoice?.document_no ?? "—"}
                    </td>
                    <td className="py-2 pr-4">
                      <p>{row.invoice?.company_name_raw ?? "—"}</p>
                      <p className="text-xs text-gray-400">{row.invoice?.branch_address ?? "—"}</p>
                    </td>
                    <td className="py-2 pr-4">
                      <input
                        type="number"
                        step="1"
                        min="0"
                        className="input no-spinner w-20 text-center"
                        defaultValue={row.qty_box ?? ""}
                        onBlur={(e) => handleQtyBoxChange(row.id, e.target.value)}
                      />
                    </td>
                    <td className="py-2 pr-4">
                      {(row.invoice?.amount ?? 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="py-2 pr-4">
                      {canSeeTruckRate ? (
                        <div className="flex w-28 flex-col items-center gap-0.5">
                          <div className="flex items-center gap-1">
                            <input
                              key={`${row.id}-${row.service_rate_pct ?? "empty"}`}
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              className="input no-spinner w-20 text-center"
                              defaultValue={row.service_rate_pct ?? ""}
                              onBlur={(e) => handleRateChange(row.id, e.target.value)}
                            />
                            <span className="text-xs text-gray-400">%</span>
                          </div>
                          <span className="max-w-full whitespace-normal break-words text-center text-[10px] leading-tight text-gray-400">
                            {zoneLabel(row.invoice)}
                            {expectedRateFor(row.invoice) !== null &&
                              expectedRateFor(row.invoice) !== row.service_rate_pct && (
                                <>
                                  {" · "}
                                  <button
                                    type="button"
                                    className="text-brand-600 underline hover:text-brand-700"
                                    onClick={() =>
                                      handleRateChange(row.id, String(expectedRateFor(row.invoice)))
                                    }
                                  >
                                    Use {expectedRateFor(row.invoice)}%
                                  </button>
                                </>
                              )}
                          </span>
                        </div>
                      ) : (
                        <span className="text-gray-400">
                          {row.service_rate_pct !== null && row.service_rate_pct !== undefined
                            ? `${row.service_rate_pct}%`
                            : "—"}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-col gap-1">
                        {row.delivered_at && (
                          <span className="text-green-600">
                            Delivered {toDateInputValue(row.delivered_at)}
                          </span>
                        )}
                        {row.reason_id && (
                          <span className="text-amber-600">
                            {deliveryReasons.find((r) => r.id === row.reason_id)?.label ??
                              "Issue reported"}
                          </span>
                        )}
                        {row.superseded_at && (
                          <span className="w-fit rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
                            Subject for Redelivery
                          </span>
                        )}
                        {!row.delivered_at && !row.reason_id && !row.superseded_at && (
                          <span className="text-gray-400">Pending</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-4">
                      {row.superseded_at ? (
                        <p className="text-xs text-gray-400">
                          Rescheduled {new Date(row.superseded_at).toLocaleDateString()} — kept
                          here for history. Look up this document on the new date's Route Plan to
                          assign it for redelivery.
                        </p>
                      ) : (
                      <div className="flex flex-col flex-wrap gap-1 sm:flex-row sm:items-center">
                        {canUpdateDelivery ? (
                          <>
                        <input
                          type="date"
                          className="input"
                          value={toDateInputValue(row.delivered_at)}
                          onChange={(e) => handleDeliveryDateChange(row, e.target.value)}
                        />
                        <select
                          className="input"
                          value={
                            customEntry?.rowId === row.id ? "" : row.reason_id ?? ""
                          }
                          onChange={(e) => handleReasonSelect(row.id, e.target.value)}
                        >
                          <option value="">
                            {row.reason_id ? "Clear Issue" : "Report Issue…"}
                          </option>
                          <optgroup label="Discrepancy">
                            {discrepancyReasons.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.label}
                              </option>
                            ))}
                            {canAddCustomReason && (
                              <option value={CUSTOM_DISCREPANCY}>+ Type new reason…</option>
                            )}
                          </optgroup>
                          <optgroup label="Backload">
                            {backloadReasons.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.label}
                              </option>
                            ))}
                            {canAddCustomReason && (
                              <option value={CUSTOM_BACKLOAD}>+ Type new reason…</option>
                            )}
                          </optgroup>
                        </select>
                          </>
                        ) : (
                          <span className="text-xs text-gray-400">View only</span>
                        )}
                        {canUnassignInvoice &&
                          deliveryReasons.find((r) => r.id === row.reason_id)?.type ===
                            "BACKLOAD" && (
                            <button
                              type="button"
                              className="text-xs font-medium text-purple-600 hover:text-purple-800 disabled:opacity-50"
                              onClick={() => handleRescheduleForRedelivery(row)}
                              disabled={removingRowId === row.id}
                              title="Keep this invoice's history on this truck, exclude it from CTS, and free it up to assign to a new truck/date"
                            >
                              {removingRowId === row.id ? "Saving…" : "Reschedule for Redelivery"}
                            </button>
                          )}
                        {canUnassignInvoice && (
                          <button
                            type="button"
                            className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                            onClick={() => handleRemoveAssignedInvoice(row)}
                            disabled={removingRowId === row.id}
                            title="Unassign this invoice from the truck"
                          >
                            {removingRowId === row.id ? "Removing…" : "Remove"}
                          </button>
                        )}
                        {canUpdateDelivery && customEntry?.rowId === row.id && (
                          <div className="flex w-full items-center gap-1 sm:w-auto">
                            <input
                              type="text"
                              className="input w-full min-w-[12rem] flex-none sm:w-48"
                              autoFocus
                              placeholder={
                                customEntry.type === "DISCREPANCY"
                                  ? "New discrepancy reason"
                                  : "New backload reason"
                              }
                              value={customEntry.text}
                              onChange={(e) =>
                                setCustomEntry({ ...customEntry, text: e.target.value })
                              }
                            />
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={handleSaveCustomReason}
                              disabled={savingCustom}
                            >
                              {savingCustom ? "Saving…" : "Save"}
                            </button>
                            <button
                              type="button"
                              className="tab-button tab-button-inactive"
                              onClick={() => setCustomEntry(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
            </div>

            {!isConvoy && canAddConvoy && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                {showAddConvoy ? (
                  <AddTruckForm
                    routePlanId={routePlanId}
                    mainTruckId={truck.id}
                    onCreated={() => {
                      setShowAddConvoy(false);
                      onRefreshTrucks();
                    }}
                    onCancel={() => setShowAddConvoy(false)}
                  />
                ) : (
                  <button
                    type="button"
                    className="tab-button tab-button-inactive"
                    onClick={() => setShowAddConvoy(true)}
                  >
                    + Add Convoy Truck
                  </button>
                )}
              </div>
            )}
          </td>
        </tr>
      )}

      {!isConvoy &&
        convoys.map((c, convoyIndex) => (
          <TruckCard
            key={c.id}
            truck={c}
            truckLabel={`${truckLabel} · Convoy ${convoyIndex + 1}`}
            convoys={[]}
            deliveryReasons={deliveryReasons}
            routePlanId={routePlanId}
            onRefreshTrucks={onRefreshTrucks}
            isConvoy
            expandedTruckId={expandedTruckId}
            onToggleExpand={onToggleExpand}
          />
        ))}
    </>
  );
}

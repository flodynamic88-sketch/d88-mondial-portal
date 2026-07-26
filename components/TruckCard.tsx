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
} from "@/types/database";

const CUSTOM_DISCREPANCY = "__custom_discrepancy__";
const CUSTOM_BACKLOAD = "__custom_backload__";

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
}

export default function TruckCard({
  truck,
  truckLabel,
  convoys,
  deliveryReasons,
  routePlanId,
  onRefreshTrucks,
  isConvoy = false,
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

  async function handleMarkDelivered(row: AssignedInvoiceRow) {
    setActionError(null);
    try {
      const supabase = createClient();
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("route_plan_invoices")
        .update({ delivered_at: nowIso })
        .eq("id", row.id);

      if (error) {
        setActionError("Failed to mark invoice as delivered.");
        return;
      }

      if (row.invoice_id) {
        await supabase.from("invoices").update({ status: "DELIVERED" }).eq("id", row.invoice_id);
      }
      setRefreshKey((k) => k + 1);
    } catch {
      setActionError(
        "Could not mark invoice delivered. Make sure a Supabase project is connected."
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

  return (
    <div className={`card ${isConvoy ? "ml-4 border-l-4 border-l-brand-200 sm:ml-10" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-800">
            {truckLabel}
            {truck.plate_number && (
              <span className="ml-2 font-normal text-gray-500">({truck.plate_number})</span>
            )}
          </p>
          <p className="text-xs text-gray-500">{truck.carrier ?? "No carrier specified"}</p>
          {isConvoy ? (
            <p className="text-xs text-gray-400">Rate included in the main truck's rate</p>
          ) : (
            <p className="text-xs text-gray-500">
              Truck Rate:{" "}
              {canSeeTruckRate
                ? (truck.truck_rate ?? 0).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : "—"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {cts && (
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                cts.cts_pass === null || cts.cts_pass === undefined
                  ? "bg-gray-100 text-gray-500"
                  : cts.cts_pass
                    ? "bg-green-50 text-green-700"
                    : "bg-red-50 text-red-700"
              }`}
            >
              CTS: {canSeeTruckRate && cts.cts_pct !== null && cts.cts_pct !== undefined
                ? `${cts.cts_pct}% · `
                : ""}
              {cts.cts_pass === null || cts.cts_pass === undefined
                ? "No data"
                : cts.cts_pass
                  ? "Pass"
                  : "Not Pass"}
            </span>
          )}
          {truck.dispatched_at ? (
            <span className="text-xs font-medium text-green-600">
              Dispatched on {new Date(truck.dispatched_at).toLocaleString()}
            </span>
          ) : canDispatch ? (
            <button
              type="button"
              className="btn-primary"
              onClick={handleDispatch}
              disabled={dispatching}
            >
              {dispatching ? "Dispatching…" : "Dispatch"}
            </button>
          ) : (
            <span className="text-xs text-gray-400">Not yet dispatched</span>
          )}
          {canManageTruck && (
            <button
              type="button"
              className="tab-button border border-red-200 bg-white text-xs text-red-600 hover:bg-red-50"
              onClick={handleDeleteTruck}
              disabled={deletingTruck}
              title="Remove this truck from the route plan"
            >
              {deletingTruck ? "Removing…" : "Remove Truck"}
            </button>
          )}
        </div>
      </div>

      {(role === "ADMIN" || role === "JMD_PLANNER") && (
        <div className="mt-4">
          <DocumentLookup
            routePlanTruckId={truck.id}
            onAssigned={() => setRefreshKey((k) => k + 1)}
          />
        </div>
      )}

      {actionError && <p className="mt-2 text-sm text-red-600">{actionError}</p>}

      <div className="mt-4">
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
                      {(row.invoice?.amount ?? 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="py-2 pr-4">
                      {canSeeTruckRate ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="input w-20"
                          defaultValue={row.service_rate_pct ?? ""}
                          onBlur={(e) => handleRateChange(row.id, e.target.value)}
                        />
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
                            Delivered {new Date(row.delivered_at).toLocaleDateString()}
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
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center">
                        {canUpdateDelivery ? (
                          <>
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => handleMarkDelivered(row)}
                          disabled={Boolean(row.delivered_at)}
                        >
                          Mark Delivered
                        </button>
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
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              className="input"
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

      {!isConvoy && convoys.length > 0 && (
        <div className="mt-4 space-y-4">
          {convoys.map((c, convoyIndex) => (
            <TruckCard
              key={c.id}
              truck={c}
              truckLabel={`${truckLabel} · Convoy ${convoyIndex + 1}`}
              convoys={[]}
              deliveryReasons={deliveryReasons}
              routePlanId={routePlanId}
              onRefreshTrucks={onRefreshTrucks}
              isConvoy
            />
          ))}
        </div>
      )}
    </div>
  );
}

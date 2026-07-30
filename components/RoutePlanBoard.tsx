"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import TruckCard from "@/components/TruckCard";
import AddTruckForm from "@/components/AddTruckForm";
import { useAuth } from "@/components/AuthProvider";
import { exportToExcel } from "@/lib/exportExcel";
import type {
  RoutePlan,
  RoutePlanTruck,
  RoutePlanInvoice,
  Invoice,
  DeliveryReason,
} from "@/types/database";

interface ExportInvoiceRow extends RoutePlanInvoice {
  invoice: Invoice | null;
}

export default function RoutePlanBoard() {
  const profile = useAuth();
  const canManagePlans = profile?.role === "ADMIN" || profile?.role === "JMD_PLANNER";

  const [routePlans, setRoutePlans] = useState<RoutePlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [routeDateInput, setRouteDateInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [preparedByInput, setPreparedByInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [checkedByInput, setCheckedByInput] = useState("");
  const [approvedByInput, setApprovedByInput] = useState("");
  const [savingSignoff, setSavingSignoff] = useState(false);
  const [signoffError, setSignoffError] = useState<string | null>(null);

  const [editingHeader, setEditingHeader] = useState(false);
  const [editRouteDate, setEditRouteDate] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editPreparedBy, setEditPreparedBy] = useState("");
  const [savingHeader, setSavingHeader] = useState(false);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [deletingPlan, setDeletingPlan] = useState(false);

  const [trucks, setTrucks] = useState<RoutePlanTruck[]>([]);
  const [loadingTrucks, setLoadingTrucks] = useState(false);
  const [trucksError, setTrucksError] = useState<string | null>(null);

  const [deliveryReasons, setDeliveryReasons] = useState<DeliveryReason[]>([]);

  const [exportingPlan, setExportingPlan] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [expandedTruckId, setExpandedTruckId] = useState<string | null>(null);
  const toggleExpandTruck = useCallback((id: string) => {
    setExpandedTruckId((prev) => (prev === id ? null : id));
  }, []);

  const loadRoutePlans = useCallback(async (selectAfter?: string) => {
    setLoadingPlans(true);
    setPlansError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("route_plans")
        .select("*")
        .order("route_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        setPlansError("Could not load route plans. Connect a Supabase project to see live data.");
        setRoutePlans([]);
        return;
      }

      const plans = data ?? [];
      setRoutePlans(plans);
      if (selectAfter) {
        setSelectedId(selectAfter);
      } else {
        setSelectedId((prev) => prev ?? (plans.length > 0 ? plans[0].id : null));
      }
    } catch {
      setPlansError("Could not load route plans. Connect a Supabase project to see live data.");
      setRoutePlans([]);
    } finally {
      setLoadingPlans(false);
    }
  }, []);

  useEffect(() => {
    loadRoutePlans();
  }, [loadRoutePlans]);

  useEffect(() => {
    async function loadReasons() {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from("delivery_reasons")
          .select("*")
          .order("type", { ascending: true })
          .order("label", { ascending: true });
        setDeliveryReasons(data ?? []);
      } catch {
        setDeliveryReasons([]);
      }
    }
    loadReasons();
  }, []);

  const loadTrucks = useCallback(async () => {
    if (!selectedId) {
      setTrucks([]);
      return;
    }
    setLoadingTrucks(true);
    setTrucksError(null);
    try {
      const supabase = createClient();
      // Read through the masked view (not the raw table) so truck_rate comes
      // back null for roles other than Admin/Logistics Officer, matching the
      // server-side RLS grants (raw table SELECT no longer includes truck_rate).
      const { data, error } = await supabase
        .from("v_route_plan_trucks")
        .select("*")
        .eq("route_plan_id", selectedId)
        .order("created_at", { ascending: true });

      if (error) {
        setTrucksError("Could not load trucks for this route plan.");
        setTrucks([]);
      } else {
        setTrucks(data ?? []);
      }
    } catch {
      setTrucksError("Could not load trucks. Connect a Supabase project to see live data.");
      setTrucks([]);
    } finally {
      setLoadingTrucks(false);
    }
  }, [selectedId]);

  useEffect(() => {
    loadTrucks();
  }, [loadTrucks]);

  const selectedPlanForSync = routePlans.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    setCheckedByInput(selectedPlanForSync?.checked_by ?? "");
    // Approval is Admin-only, so the Approved By name is always the current
    // Admin's own name -- never a pick-list. Auto-fill it for the logged-in
    // Admin so approving a plan is just one click.
    setApprovedByInput(
      selectedPlanForSync?.approved_by ??
        (profile?.role === "ADMIN" ? profile.full_name || profile.username : "")
    );
    setSignoffError(null);
  }, [selectedPlanForSync, profile]);

  useEffect(() => {
    setEditingHeader(false);
    setEditRouteDate(selectedPlanForSync?.route_date ?? "");
    setEditLabel(selectedPlanForSync?.label ?? "");
    setEditPreparedBy(selectedPlanForSync?.prepared_by ?? "");
    setHeaderError(null);
  }, [selectedPlanForSync]);

  async function handleSaveHeader() {
    if (!selectedId) return;
    if (!editRouteDate) {
      setHeaderError("Route date is required.");
      return;
    }
    setSavingHeader(true);
    setHeaderError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("route_plans")
        .update({
          route_date: editRouteDate,
          label: editLabel.trim() || null,
          prepared_by: editPreparedBy.trim() || null,
        })
        .eq("id", selectedId);
      if (error) {
        setHeaderError(`Failed to save: ${error.message}`);
        return;
      }
      setEditingHeader(false);
      await loadRoutePlans(selectedId);
    } catch {
      setHeaderError("Could not save. Make sure a Supabase project is connected.");
    } finally {
      setSavingHeader(false);
    }
  }

  async function handleSaveSignoff() {
    if (!selectedId) return;
    setSavingSignoff(true);
    setSignoffError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("route_plans")
        .update({
          checked_by: checkedByInput.trim() || null,
          approved_by: approvedByInput.trim() || null,
        })
        .eq("id", selectedId);
      if (error) {
        setSignoffError(`Failed to save: ${error.message}`);
      } else {
        await loadRoutePlans(selectedId);
      }
    } catch {
      setSignoffError("Could not save. Make sure a Supabase project is connected.");
    } finally {
      setSavingSignoff(false);
    }
  }

  async function handleApprove() {
    if (!selectedId) return;
    setSavingSignoff(true);
    setSignoffError(null);
    try {
      const supabase = createClient();
      const trimmedApprover = approvedByInput.trim();
      if (!trimmedApprover) {
        setSignoffError("Enter the Approved By name before approving.");
        return;
      }
      const { error } = await supabase
        .from("route_plans")
        .update({
          checked_by: checkedByInput.trim() || null,
          approved_by: trimmedApprover,
          approved_at: new Date().toISOString(),
        })
        .eq("id", selectedId);
      if (error) {
        setSignoffError(`Failed to approve: ${error.message}`);
      } else {
        await loadRoutePlans(selectedId);
      }
    } catch {
      setSignoffError("Could not approve. Make sure a Supabase project is connected.");
    } finally {
      setSavingSignoff(false);
    }
  }

  async function handleDeleteRoutePlan() {
    if (!selectedId) return;
    const plan = routePlans.find((p) => p.id === selectedId);
    const confirmed = window.confirm(
      `Delete the route plan for ${plan?.route_date ?? "this date"}${
        plan?.label ? ` (${plan.label})` : ""
      }? This removes all trucks and invoice assignments under it (assigned invoices themselves are not deleted, just unassigned). This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingPlan(true);
    setHeaderError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("route_plans").delete().eq("id", selectedId);
      if (error) {
        setHeaderError(`Failed to delete: ${error.message}`);
        return;
      }
      setSelectedId(null);
      await loadRoutePlans();
    } catch {
      setHeaderError("Could not delete. Make sure a Supabase project is connected.");
    } finally {
      setDeletingPlan(false);
    }
  }

  async function handleCreateRoutePlan(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);

    if (!routeDateInput) {
      setCreateError("Route date is required.");
      return;
    }

    setCreating(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("route_plans")
        .insert({
          route_date: routeDateInput,
          label: labelInput.trim() || null,
          prepared_by: preparedByInput.trim() || null,
        })
        .select("*")
        .single();

      if (error) {
        setCreateError(`Failed to create route plan: ${error.message}`);
        return;
      }

      setRouteDateInput("");
      setLabelInput("");
      setPreparedByInput("");
      if (data) {
        await loadRoutePlans(data.id);
      } else {
        await loadRoutePlans();
      }
    } catch {
      setCreateError("Could not create route plan. Make sure a Supabase project is connected.");
    } finally {
      setCreating(false);
    }
  }

  const mainTrucks = trucks.filter((t) => !t.main_truck_id);
  const convoysByMain = trucks.reduce<Record<string, RoutePlanTruck[]>>((acc, t) => {
    if (t.main_truck_id) {
      acc[t.main_truck_id] = acc[t.main_truck_id] ? [...acc[t.main_truck_id], t] : [t];
    }
    return acc;
  }, {});

  const truckLabelById: Record<string, string> = {};
  mainTrucks.forEach((truck, index) => {
    truckLabelById[truck.id] = `Truck ${index + 1}`;
    (convoysByMain[truck.id] ?? []).forEach((convoy, convoyIndex) => {
      truckLabelById[convoy.id] = `Truck ${index + 1} · Convoy ${convoyIndex + 1}`;
    });
  });

  const selectedPlan = routePlans.find((p) => p.id === selectedId) ?? null;

  async function handleExportRoutePlan() {
    if (!selectedPlan || trucks.length === 0) return;
    setExportingPlan(true);
    setExportError(null);
    try {
      const supabase = createClient();
      const truckIds = trucks.map((t) => t.id);
      const { data, error } = await supabase
        .from("route_plan_invoices")
        .select("*, invoice:invoices(*)")
        .in("route_plan_truck_id", truckIds)
        .is("superseded_at", null)
        .order("created_at", { ascending: true });

      if (error) {
        setExportError("Failed to export route plan.");
        return;
      }

      const rows = (data ?? []) as unknown as ExportInvoiceRow[];
      const trucksById = Object.fromEntries(trucks.map((t) => [t.id, t]));

      exportToExcel(`route-plan-${selectedPlan.route_date}`, [
        {
          name: "Route Plan",
          rows: rows.map((row) => {
            const truck = row.route_plan_truck_id ? trucksById[row.route_plan_truck_id] : null;
            return {
              Truck: truck ? truckLabelById[truck.id] ?? "" : "",
              "Plate Number": truck?.plate_number ?? "",
              Carrier: truck?.carrier ?? "",
              Driver: truck?.driver_name ?? "",
              "Helper 1": truck?.helper1_name ?? "",
              "Helper 2": truck?.helper2_name ?? "",
              "Document No.": row.invoice?.document_no ?? "",
              "Company / Store": row.invoice?.company_name_raw ?? "",
              "Branch Address": row.invoice?.branch_address ?? "",
              "Qty/Box": row.qty_box ?? "",
              Amount: row.invoice?.amount ?? 0,
              "Rate %": row.service_rate_pct ?? "",
              "Delivered On": row.delivered_at
                ? new Date(row.delivered_at).toLocaleDateString()
                : "",
            };
          }),
        },
      ]);
    } catch {
      setExportError("Could not export route plan. Make sure a Supabase project is connected.");
    } finally {
      setExportingPlan(false);
    }
  }

  return (
    <div>
      <div className="page-header border-b-0 pb-0">
        <div>
          <h1 className="page-title">Route Plan</h1>
          <p className="page-subtitle">
            Build daily route plans, assign trucks and convoys, and load invoices onto each run.
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-4">
        <div className="card lg:col-span-1">
          <h2 className="text-sm font-semibold text-gray-700">Create Route Plan</h2>
          <form onSubmit={handleCreateRoutePlan} className="mt-3 space-y-3">
            <div>
              <label className="label">Route Date</label>
              <input
                type="date"
                className="input"
                value={routeDateInput}
                onChange={(e) => setRouteDateInput(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Label (optional)</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. NCR Morning Run"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Prepared By (optional)</label>
              <select
                className="input"
                value={preparedByInput}
                onChange={(e) => setPreparedByInput(e.target.value)}
              >
                <option value="">Select preparer</option>
                <option value="Johannes Paulous Ventura">Johannes Paulous Ventura</option>
                <option value="Junnel Rosel">Junnel Rosel</option>
              </select>
            </div>
            {createError && <p className="text-sm text-red-600">{createError}</p>}
            <button type="submit" className="btn-primary w-full" disabled={creating}>
              {creating ? "Creating…" : "Create Route Plan"}
            </button>
          </form>

          <div className="mt-6">
            <h2 className="text-sm font-semibold text-gray-700">Existing Route Plans</h2>
            <div className="mt-2 max-h-96 space-y-1 overflow-y-auto">
              {loadingPlans && <p className="text-sm text-gray-400">Loading…</p>}
              {!loadingPlans && plansError && (
                <p className="text-sm text-gray-400">{plansError}</p>
              )}
              {!loadingPlans && !plansError && routePlans.length === 0 && (
                <p className="text-sm text-gray-400">No route plans yet.</p>
              )}
              {!loadingPlans &&
                !plansError &&
                routePlans.map((plan) => (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => setSelectedId(plan.id)}
                    className={`block w-full rounded-md px-3 py-2 text-left text-sm ${
                      selectedId === plan.id
                        ? "bg-brand-50 text-brand-700"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    <span className="font-medium">{plan.route_date}</span>
                    {plan.label && <span className="text-gray-500"> — {plan.label}</span>}
                  </button>
                ))}
            </div>
          </div>
        </div>

        <div className="space-y-4 lg:col-span-3">
          {!selectedPlan && (
            <div className="card flex flex-col items-center justify-center py-16 text-center text-sm text-gray-500">
              Select or create a route plan to manage trucks.
            </div>
          )}

          {selectedPlan && (
            <>
              <div className="card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {editingHeader ? (
                    <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <label className="label">Route Date</label>
                        <input
                          type="date"
                          className="input"
                          value={editRouteDate}
                          onChange={(e) => setEditRouteDate(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="label">Label</label>
                        <input
                          type="text"
                          className="input"
                          placeholder="e.g. NCR Morning Run"
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="label">Prepared By</label>
                        <select
                          className="input"
                          value={editPreparedBy}
                          onChange={(e) => setEditPreparedBy(e.target.value)}
                        >
                          <option value="">Select preparer</option>
                          <option value="Johannes Paulous Ventura">Johannes Paulous Ventura</option>
                          <option value="Junnel Rosel">Junnel Rosel</option>
                        </select>
                      </div>
                    </div>
                  ) : (
                    <h2 className="text-sm font-semibold text-gray-700">
                      {selectedPlan.route_date}
                      {selectedPlan.label && ` — ${selectedPlan.label}`}
                    </h2>
                  )}

                  <div className="flex items-center gap-2">
                    {!editingHeader && (
                      <button
                        type="button"
                        className="tab-button tab-button-inactive"
                        onClick={handleExportRoutePlan}
                        disabled={exportingPlan || trucks.length === 0}
                        title="Export this route plan's trucks and invoices to Excel"
                      >
                        {exportingPlan ? "Exporting…" : "Export to Excel"}
                      </button>
                    )}
                    {editingHeader ? (
                      <>
                        <button
                          type="button"
                          className="tab-button tab-button-inactive"
                          onClick={() => setEditingHeader(false)}
                          disabled={savingHeader}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={handleSaveHeader}
                          disabled={savingHeader}
                        >
                          {savingHeader ? "Saving…" : "Save"}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="tab-button tab-button-inactive"
                          onClick={() => setEditingHeader(true)}
                        >
                          Edit
                        </button>
                        {canManagePlans && (
                          <button
                            type="button"
                            className="tab-button border border-red-200 bg-white text-red-600 hover:bg-red-50"
                            onClick={handleDeleteRoutePlan}
                            disabled={deletingPlan}
                          >
                            {deletingPlan ? "Deleting…" : "Delete Route Plan"}
                          </button>
                        )}
                      </>
                    )}
                    {selectedPlan.approved_at ? (
                      <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
                        Approved by {selectedPlan.approved_by} on{" "}
                        {new Date(selectedPlan.approved_at).toLocaleDateString()}
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                        Not yet approved — excluded from Billing
                      </span>
                    )}
                  </div>
                </div>

                {headerError && <p className="mt-2 text-sm text-red-600">{headerError}</p>}
                {exportError && <p className="mt-2 text-sm text-red-600">{exportError}</p>}

                {!editingHeader && selectedPlan.prepared_by && (
                  <p className="mt-1 text-xs text-gray-500">
                    Prepared by {selectedPlan.prepared_by}
                  </p>
                )}

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label">Checked By</label>
                    <select
                      className="input"
                      value={checkedByInput}
                      onChange={(e) => setCheckedByInput(e.target.value)}
                      disabled={Boolean(selectedPlan.approved_at)}
                    >
                      <option value="">Select</option>
                      <option value="Emmanuel Miagao">Emmanuel Miagao</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Approved By</label>
                    <p className="input flex items-center bg-gray-50 text-gray-700">
                      {approvedByInput || "Admin approval required"}
                    </p>
                  </div>
                </div>

                {signoffError && <p className="mt-2 text-sm text-red-600">{signoffError}</p>}

                {!selectedPlan.approved_at && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="tab-button tab-button-inactive"
                      onClick={handleSaveSignoff}
                      disabled={savingSignoff}
                    >
                      {savingSignoff ? "Saving…" : "Save"}
                    </button>
                    {profile?.role === "ADMIN" && (
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={handleApprove}
                        disabled={savingSignoff}
                      >
                        {savingSignoff ? "Approving…" : "Approve"}
                      </button>
                    )}
                  </div>
                )}

                <div className="mt-4">
                  <p className="label mb-2">Add Truck</p>
                  <AddTruckForm routePlanId={selectedPlan.id} onCreated={loadTrucks} />
                </div>
              </div>

              {loadingTrucks && <p className="text-sm text-gray-400">Loading trucks…</p>}
              {!loadingTrucks && trucksError && (
                <p className="text-sm text-gray-400">{trucksError}</p>
              )}
              {!loadingTrucks && !trucksError && mainTrucks.length === 0 && (
                <div className="card text-sm text-gray-500">
                  No trucks added to this route plan yet.
                </div>
              )}

              {!loadingTrucks && !trucksError && mainTrucks.length > 0 && (
                <div className="card overflow-x-auto p-0">
                  <table className="min-w-full divide-y divide-gray-100 text-sm">
                    <thead>
                      <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                        <th className="py-2 pl-4 pr-3">Truck</th>
                        <th className="py-2 pr-3">Carrier</th>
                        <th className="py-2 pr-3">Driver</th>
                        <th className="py-2 pr-3">Helpers</th>
                        <th className="py-2 pr-3">Rate</th>
                        <th className="py-2 pr-3">CTS</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2 pl-3 pr-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mainTrucks.map((truck, index) => (
                        <TruckCard
                          key={truck.id}
                          truck={truck}
                          truckLabel={`Truck ${index + 1}`}
                          convoys={convoysByMain[truck.id] ?? []}
                          deliveryReasons={deliveryReasons}
                          routePlanId={selectedPlan.id}
                          onRefreshTrucks={loadTrucks}
                          expandedTruckId={expandedTruckId}
                          onToggleExpand={toggleExpandTruck}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

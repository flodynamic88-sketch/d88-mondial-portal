"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import TruckCard from "@/components/TruckCard";
import AddTruckForm from "@/components/AddTruckForm";
import type { RoutePlan, RoutePlanTruck, DeliveryReason } from "@/types/database";

export default function RoutePlanBoard() {
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

  const [trucks, setTrucks] = useState<RoutePlanTruck[]>([]);
  const [loadingTrucks, setLoadingTrucks] = useState(false);
  const [trucksError, setTrucksError] = useState<string | null>(null);

  const [deliveryReasons, setDeliveryReasons] = useState<DeliveryReason[]>([]);

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
    setApprovedByInput(selectedPlanForSync?.approved_by ?? "");
    setSignoffError(null);
  }, [selectedPlanForSync]);

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

  const selectedPlan = routePlans.find((p) => p.id === selectedId) ?? null;

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
              <input
                type="text"
                className="input"
                placeholder="Name of preparer"
                value={preparedByInput}
                onChange={(e) => setPreparedByInput(e.target.value)}
              />
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
                  <h2 className="text-sm font-semibold text-gray-700">
                    {selectedPlan.route_date}
                    {selectedPlan.label && ` — ${selectedPlan.label}`}
                  </h2>
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

                {selectedPlan.prepared_by && (
                  <p className="mt-1 text-xs text-gray-500">
                    Prepared by {selectedPlan.prepared_by}
                  </p>
                )}

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label">Checked By</label>
                    <input
                      type="text"
                      className="input"
                      value={checkedByInput}
                      onChange={(e) => setCheckedByInput(e.target.value)}
                      disabled={Boolean(selectedPlan.approved_at)}
                    />
                  </div>
                  <div>
                    <label className="label">Approved By</label>
                    <input
                      type="text"
                      className="input"
                      value={approvedByInput}
                      onChange={(e) => setApprovedByInput(e.target.value)}
                      disabled={Boolean(selectedPlan.approved_at)}
                    />
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
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleApprove}
                      disabled={savingSignoff}
                    >
                      {savingSignoff ? "Approving…" : "Approve"}
                    </button>
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

              {!loadingTrucks &&
                !trucksError &&
                mainTrucks.map((truck) => (
                  <TruckCard
                    key={truck.id}
                    truck={truck}
                    convoys={convoysByMain[truck.id] ?? []}
                    deliveryReasons={deliveryReasons}
                    routePlanId={selectedPlan.id}
                    onRefreshTrucks={loadTrucks}
                  />
                ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

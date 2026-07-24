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
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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
      const { data, error } = await supabase
        .from("route_plan_trucks")
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
        .insert({ route_date: routeDateInput, label: labelInput.trim() || null })
        .select("*")
        .single();

      if (error) {
        setCreateError(`Failed to create route plan: ${error.message}`);
        return;
      }

      setRouteDateInput("");
      setLabelInput("");
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
      <h1 className="text-2xl font-semibold text-gray-800">Route Plan</h1>
      <p className="mt-1 text-sm text-gray-500">
        Build daily route plans, assign trucks and convoys, and load invoices onto each run.
      </p>

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
                <h2 className="text-sm font-semibold text-gray-700">
                  {selectedPlan.route_date}
                  {selectedPlan.label && ` — ${selectedPlan.label}`}
                </h2>
                <div className="mt-3">
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

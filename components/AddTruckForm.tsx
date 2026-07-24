"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/AuthProvider";

interface AddTruckFormProps {
  routePlanId: string;
  /** When provided, the new truck is created as a convoy truck under this main truck. */
  mainTruckId?: string;
  onCreated: () => void;
  onCancel?: () => void;
}

export default function AddTruckForm({
  routePlanId,
  mainTruckId,
  onCreated,
  onCancel,
}: AddTruckFormProps) {
  const profile = useAuth();
  const canSetTruckRate = profile?.role === "ADMIN" || profile?.role === "LOGISTICS_OFFICER";

  const [plateNumber, setPlateNumber] = useState("");
  const [carrier, setCarrier] = useState("");
  const [truckRate, setTruckRate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!plateNumber.trim()) {
      setError("Plate number is required.");
      return;
    }

    let rateNumber: number | null = null;
    if (truckRate.trim()) {
      rateNumber = Number(truckRate);
      if (Number.isNaN(rateNumber)) {
        setError("Truck rate must be a valid number.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error: insertError } = await supabase.from("route_plan_trucks").insert({
        route_plan_id: routePlanId,
        plate_number: plateNumber.trim(),
        carrier: carrier.trim() || null,
        truck_rate: rateNumber,
        is_convoy: Boolean(mainTruckId),
        main_truck_id: mainTruckId ?? null,
      });

      if (insertError) {
        setError(`Failed to add truck: ${insertError.message}`);
        return;
      }

      setPlateNumber("");
      setCarrier("");
      setTruckRate("");
      onCreated();
    } catch {
      setError("Could not add truck. Make sure a Supabase project is connected.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
      <div>
        <label className="label">Plate Number</label>
        <input
          className="input"
          value={plateNumber}
          onChange={(e) => setPlateNumber(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="label">Carrier</label>
        <input className="input" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
      </div>
      {canSetTruckRate && (
        <div>
          <label className="label">Truck Rate</label>
          <input
            type="number"
            step="0.01"
            min="0"
            className="input"
            value={truckRate}
            onChange={(e) => setTruckRate(e.target.value)}
          />
        </div>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Adding…" : mainTruckId ? "Add Convoy Truck" : "Add Truck"}
        </button>
        {onCancel && (
          <button
            type="button"
            className="tab-button tab-button-inactive"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-600 sm:col-span-4">{error}</p>}
    </form>
  );
}

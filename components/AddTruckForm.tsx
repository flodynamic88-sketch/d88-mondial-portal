"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/AuthProvider";

interface AddTruckFormProps {
  routePlanId: string;
  /** When provided, the new truck is created as a convoy truck under this main truck. */
  mainTruckId?: string;
  onCreated: () => void;
  onCancel?: () => void;
}

interface DestinationOption {
  destination: string;
  area: string;
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
  const [destination, setDestination] = useState("");
  const [destinations, setDestinations] = useState<DestinationOption[]>([]);
  const [truckRate, setTruckRate] = useState("");
  const [isNegotiatedRate, setIsNegotiatedRate] = useState(false);
  const [driverName, setDriverName] = useState("");
  const [helper1Name, setHelper1Name] = useState("");
  const [helper2Name, setHelper2Name] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Convoy trucks never need their own destination/rate, and only
    // Admin/Logistics Officer are allowed to set a destination at all (see
    // enforce_truck_rate_edit() in 0034_destination_officer_admin_only.sql)
    // -- skip the fetch for everyone else so a JMD Planner never sees a
    // field they can't use.
    if (mainTruckId || !canSetTruckRate) return;
    const supabase = createClient();
    supabase
      .from("v_trucking_rates")
      .select("destination, area")
      .then(({ data }) => {
        if (data) {
          setDestinations(
            [...data].sort((a, b) => a.area.localeCompare(b.area) || a.destination.localeCompare(b.destination))
          );
        }
      });
  }, [mainTruckId, canSetTruckRate]);

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
        // Destination can only be set by Admin/Logistics Officer -- see
        // enforce_truck_rate_edit() in 0034_destination_officer_admin_only.sql.
        // Other roles never render the picker below, so `destination` stays
        // "" and this resolves to null, which the trigger always allows.
        destination: canSetTruckRate ? destination.trim() || null : null,
        truck_rate: rateNumber,
        // Negotiated rate: skips the destination-based rate card lookup so
        // the manually-typed truck_rate above is used as-is -- see
        // enforce_truck_rate_edit() in 0040_negotiated_truck_rate.sql.
        is_negotiated_rate: canSetTruckRate ? isNegotiatedRate : false,
        is_convoy: Boolean(mainTruckId),
        main_truck_id: mainTruckId ?? null,
        driver_name: driverName.trim() || null,
        helper1_name: helper1Name.trim() || null,
        helper2_name: helper2Name.trim() || null,
      });

      if (insertError) {
        setError(`Failed to add truck: ${insertError.message}`);
        return;
      }

      setPlateNumber("");
      setCarrier("");
      setDestination("");
      setTruckRate("");
      setIsNegotiatedRate(false);
      setDriverName("");
      setHelper1Name("");
      setHelper2Name("");
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
        <label className="label">Carrier</label>
        <input className="input" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
      </div>
      <div>
        <label className="label">Plate Number</label>
        <input
          className="input"
          value={plateNumber}
          onChange={(e) => setPlateNumber(e.target.value)}
          required
        />
      </div>
      {/* Destination is Admin/Logistics Officer only (see
          enforce_truck_rate_edit() in 0034_destination_officer_admin_only.sql)
          -- hidden entirely for other roles (e.g. JMD Planner) so it's never
          a required or even visible field blocking truck/route creation.
          It can always be added later by an Officer/Admin via the Truck
          Details edit row. */}
      {!mainTruckId && canSetTruckRate && (
        <div>
          <label className="label">Destination</label>
          <select
            className="input"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          >
            <option value="">— Select —</option>
            {destinations.map((d) => (
              <option key={d.destination} value={d.destination}>
                {d.destination} ({d.area})
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">
            Truck rate is set automatically based on destination. Can also be
            set later if not known yet.
          </p>
          <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={isNegotiatedRate}
              onChange={(e) => setIsNegotiatedRate(e.target.checked)}
            />
            Negotiated rate (override the rate card)
          </label>
        </div>
      )}
      {canSetTruckRate && !mainTruckId && (!destination || isNegotiatedRate) && (
        <div>
          <label className="label">
            {isNegotiatedRate ? "Truck Rate (negotiated)" : "Truck Rate (no destination set)"}
          </label>
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
      {Boolean(mainTruckId) && (
        <p className="text-xs text-gray-400 sm:col-span-1">
          No separate rate needed — a convoy truck is covered by the main truck's rate.
        </p>
      )}
      <div>
        <label className="label">Driver</label>
        <input
          className="input"
          value={driverName}
          onChange={(e) => setDriverName(e.target.value)}
        />
      </div>
      <div>
        <label className="label">Helper 1</label>
        <input
          className="input"
          value={helper1Name}
          onChange={(e) => setHelper1Name(e.target.value)}
        />
      </div>
      <div>
        <label className="label">Helper 2</label>
        <input
          className="input"
          value={helper2Name}
          onChange={(e) => setHelper2Name(e.target.value)}
        />
      </div>
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

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { getAppSetting, LOGO_SETTING_KEY } from "@/lib/appSettings";
import type { RoutePlan, RoutePlanTruck, RoutePlanInvoice, Invoice } from "@/types/database";

interface StopRow extends RoutePlanInvoice {
  invoice: Invoice | null;
}

export default function PrintDayDeliveryRoutePage() {
  const params = useParams();
  const planId = typeof params?.planId === "string" ? params.planId : "";
  const profile = useAuth();
  const canEditContact =
    profile?.role === "ADMIN" ||
    profile?.role === "JMD_PLANNER" ||
    profile?.role === "LOGISTICS_OFFICER";

  const [routePlan, setRoutePlan] = useState<RoutePlan | null>(null);
  const [trucks, setTrucks] = useState<RoutePlanTruck[]>([]);
  const [stopsByTruck, setStopsByTruck] = useState<Record<string, StopRow[]>>({});
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Local editable copy of each truck's contact number, keyed by truck id --
  // pre-filled from the DB, changes saved on blur so it's editable before
  // the report is captured as a PNG.
  const [contactDrafts, setContactDrafts] = useState<Record<string, string>>({});
  const [savingContact, setSavingContact] = useState<Record<string, boolean>>({});

  const reportRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!planId) return;
    (async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const supabase = createClient();
        const [{ data: planData, error: planErr }, { data: truckRows, error: truckErr }, logo] =
          await Promise.all([
            supabase.from("route_plans").select("*").eq("id", planId).maybeSingle(),
            supabase
              .from("v_route_plan_trucks")
              .select("*")
              .eq("route_plan_id", planId)
              .order("created_at", { ascending: true }),
            getAppSetting(LOGO_SETTING_KEY),
          ]);

        if (planErr || !planData) {
          setErrorMsg("Could not load this route plan.");
          return;
        }
        setRoutePlan(planData as RoutePlan);
        setLogoUrl(logo);

        const allTrucks = (truckRows ?? []) as RoutePlanTruck[];
        setTrucks(allTrucks);
        setContactDrafts(
          Object.fromEntries(allTrucks.map((t) => [t.id, t.contact_number ?? ""]))
        );

        if (allTrucks.length > 0) {
          const truckIds = allTrucks.map((t) => t.id);
          const { data: stopRows } = await supabase
            .from("route_plan_invoices")
            .select("*, invoice:invoices(*)")
            .in("route_plan_truck_id", truckIds)
            .is("superseded_at", null)
            .order("drop_no", { ascending: true, nullsFirst: false })
            .order("created_at", { ascending: true });

          const grouped: Record<string, StopRow[]> = {};
          ((stopRows ?? []) as unknown as StopRow[]).forEach((row) => {
            if (!row.route_plan_truck_id) return;
            grouped[row.route_plan_truck_id] = grouped[row.route_plan_truck_id]
              ? [...grouped[row.route_plan_truck_id], row]
              : [row];
          });
          setStopsByTruck(grouped);
        }
      } catch {
        setErrorMsg("Could not load this route plan's delivery report.");
      } finally {
        setLoading(false);
      }
    })();
  }, [planId]);

  const mainTrucks = useMemo(() => trucks.filter((t) => !t.main_truck_id), [trucks]);
  const convoysByMain = useMemo(
    () =>
      trucks.reduce<Record<string, RoutePlanTruck[]>>((acc, t) => {
        if (t.main_truck_id) {
          acc[t.main_truck_id] = acc[t.main_truck_id] ? [...acc[t.main_truck_id], t] : [t];
        }
        return acc;
      }, {}),
    [trucks]
  );
  const truckLabelById = useMemo(() => {
    const labels: Record<string, string> = {};
    mainTrucks.forEach((truck, index) => {
      labels[truck.id] = `Truck ${index + 1}`;
      (convoysByMain[truck.id] ?? []).forEach((convoy, convoyIndex) => {
        labels[convoy.id] = `Truck ${index + 1} · Convoy ${convoyIndex + 1}`;
      });
    });
    return labels;
  }, [mainTrucks, convoysByMain]);

  // Order: each main truck immediately followed by its convoy(s), matching
  // the numbering shown on the Route Plan board.
  const orderedTrucks = useMemo(() => {
    const out: RoutePlanTruck[] = [];
    mainTrucks.forEach((truck) => {
      out.push(truck);
      (convoysByMain[truck.id] ?? []).forEach((convoy) => out.push(convoy));
    });
    return out;
  }, [mainTrucks, convoysByMain]);

  // Group a truck's stops by drop_no so invoices sharing a drop (e.g. 4
  // receipts under Drop #1) print together, with the store name/address
  // shown once per group, mirroring the Drop-card grouping already shown
  // on-screen in Route Plan. When drop_no isn't set (trucks that never used
  // the manual drop-number feature), fall back to grouping consecutive
  // stops by store identity (company + delivery address) so two different
  // stores never merge just because both lack a drop number. stopsByTruck
  // rows arrive pre-sorted by drop_no (nulls last) then created_at, so a
  // single pass preserves that order.
  function groupStopsByDrop(stops: StopRow[]) {
    const groups: { key: string; dropNo: number | null; rows: StopRow[] }[] = [];
    for (const stop of stops) {
      const address = stop.delivery_address || stop.invoice?.branch_address || "";
      const key =
        stop.drop_no !== null && stop.drop_no !== undefined
          ? `drop:${stop.drop_no}`
          : `store:${stop.invoice?.company_name_raw ?? ""}|${address}`;
      const last = groups[groups.length - 1];
      if (last && last.key === key) {
        last.rows.push(stop);
      } else {
        groups.push({ key, dropNo: stop.drop_no ?? null, rows: [stop] });
      }
    }
    return groups;
  }

  async function handleContactBlur(truckId: string) {
    if (!canEditContact) return;
    const truck = trucks.find((t) => t.id === truckId);
    const value = (contactDrafts[truckId] ?? "").trim();
    if (truck && (truck.contact_number ?? "") === value) return;

    setSavingContact((prev) => ({ ...prev, [truckId]: true }));
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("route_plan_trucks")
        .update({ contact_number: value || null })
        .eq("id", truckId);
      if (!error) {
        setTrucks((prev) =>
          prev.map((t) => (t.id === truckId ? { ...t, contact_number: value || null } : t))
        );
      }
    } finally {
      setSavingContact((prev) => ({ ...prev, [truckId]: false }));
    }
  }

  async function handleDownloadPng() {
    if (!reportRef.current) return;
    setDownloading(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
      });
      const dateLabel = routePlan?.route_date ?? "delivery-route";
      const link = document.createElement("a");
      link.download = `delivery-route-${dateLabel}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch {
      setErrorMsg("Could not generate the PNG. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return <p className="p-8 text-sm text-gray-400">Loading…</p>;
  }
  if (errorMsg && !routePlan) {
    return <p className="p-8 text-sm text-red-600">{errorMsg}</p>;
  }
  if (!routePlan) {
    return <p className="p-8 text-sm text-red-600">Route plan not found.</p>;
  }

  const formattedDate = new Date(routePlan.route_date).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="pb-16">
      <div className="no-print mx-auto mb-4 flex max-w-4xl items-center justify-between">
        <p className="text-sm text-gray-500">
          {orderedTrucks.length} truck{orderedTrucks.length === 1 ? "" : "s"} on this day's route
        </p>
        <button
          type="button"
          className="btn-primary"
          onClick={handleDownloadPng}
          disabled={downloading || orderedTrucks.length === 0}
        >
          {downloading ? "Generating PNG…" : "Download as PNG"}
        </button>
      </div>
      {errorMsg && <p className="no-print mx-auto mb-4 max-w-4xl text-sm text-red-600">{errorMsg}</p>}

      <div
        ref={reportRef}
        className="printable-area mx-auto max-w-4xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-panel"
      >
        {/* Header */}
        <div className="border-b-2 border-brand-600 bg-white px-8 py-7">
          <div className="flex items-center justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gray-400">
                Dynamic88 Solutions
              </p>
              <h1 className="mt-1 text-3xl font-extrabold uppercase leading-tight tracking-tight text-brand-800">
                Delivery Itinerary
              </h1>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                Date
              </p>
              <p className="mt-1 text-xl font-bold leading-tight text-gray-900">{formattedDate}</p>
              {routePlan.label && (
                <p className="mt-0.5 text-sm text-gray-500">{routePlan.label}</p>
              )}
            </div>
          </div>
        </div>

        {/* Truck sections */}
        <div className="space-y-6 bg-gray-50 px-8 py-7">
          {orderedTrucks.length === 0 && (
            <p className="py-10 text-center text-sm text-gray-400">
              No trucks on this route plan yet.
            </p>
          )}

          {orderedTrucks.map((truck) => {
            const stops = stopsByTruck[truck.id] ?? [];
            const helpers = [truck.helper1_name, truck.helper2_name].filter(Boolean).join(" / ");
            const truckDetails = [truck.carrier, truck.plate_number].filter(Boolean).join(" · ");

            return (
              <div
                key={truck.id}
                className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-card"
              >
                <div className="flex items-center justify-between border-b border-gray-100 bg-brand-50/70 px-5 py-3">
                  <span className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
                    {truckLabelById[truck.id] ?? "Truck"}
                  </span>
                  <span className="text-xs font-medium text-gray-400">
                    {stops.length} stop{stops.length === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                      Truck Details
                    </p>
                    <p className="mt-1 text-sm font-semibold text-gray-900">
                      {truckDetails || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                      Driver
                    </p>
                    <p className="mt-1 text-sm font-semibold text-gray-900">
                      {truck.driver_name ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                      Helper1 / Helper2
                    </p>
                    <p className="mt-1 text-sm font-semibold text-gray-900">{helpers || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                      Contact #
                    </p>
                    {canEditContact ? (
                      <input
                        type="text"
                        value={contactDrafts[truck.id] ?? ""}
                        onChange={(e) =>
                          setContactDrafts((prev) => ({ ...prev, [truck.id]: e.target.value }))
                        }
                        onBlur={() => handleContactBlur(truck.id)}
                        placeholder="09xx-xxx-xxxx"
                        className="no-print-border mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-sm font-semibold text-gray-900 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                        disabled={savingContact[truck.id]}
                      />
                    ) : (
                      <p className="mt-1 text-sm font-semibold text-gray-900">
                        {truck.contact_number ?? "—"}
                      </p>
                    )}
                  </div>
                </div>

                <div className="border-t border-gray-100 px-5 py-4">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    Stores
                  </p>
                  <div className="space-y-2">
                    {groupStopsByDrop(stops).map((group) => {
                      const firstStop = group.rows[0];
                      const storeName = firstStop?.invoice?.company_name_raw ?? "—";
                      const address =
                        firstStop?.delivery_address || firstStop?.invoice?.branch_address || "—";
                      return (
                        <div key={group.key} className="rounded-md border border-gray-100 p-2">
                          <div className="mb-1.5 flex items-start justify-between gap-3">
                            <div>
                              {group.dropNo !== null && (
                                <p className="text-[9px] font-semibold uppercase tracking-wide text-brand-600">
                                  Drop {group.dropNo}
                                </p>
                              )}
                              <p className="text-sm font-medium text-gray-900">{storeName}</p>
                              <p className="text-[11px] text-gray-500">{address}</p>
                              {firstStop?.merchandiser_name_snapshot && (
                                <p className="text-[10px] font-medium text-brand-600">
                                  Merchandiser: {firstStop.merchandiser_name_snapshot}
                                  {firstStop.merchandiser_contact_snapshot
                                    ? ` · ${firstStop.merchandiser_contact_snapshot}`
                                    : ""}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {group.rows.map((stop) => (
                              <div
                                key={stop.id}
                                className="min-w-[88px] rounded border border-gray-200 bg-gray-50 px-1.5 py-1 text-[10px] leading-tight"
                              >
                                <p className="font-semibold text-gray-800">
                                  {stop.invoice?.document_no ?? "—"}
                                </p>
                                <p className="text-gray-500">{stop.qty_box ?? 0} box</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {stops.length === 0 && (
                      <p className="py-3 text-center text-sm text-gray-400">
                        No stores assigned to this truck yet.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="bg-white px-8 py-4">
          <p className="text-center text-[10px] text-gray-400">
            Generated {new Date().toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}

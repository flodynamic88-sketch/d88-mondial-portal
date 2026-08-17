"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getAppSetting, LOGO_SETTING_KEY } from "@/lib/appSettings";
import type { RoutePlan, RoutePlanTruck, RoutePlanInvoice, Invoice } from "@/types/database";

interface ItineraryRow extends RoutePlanInvoice {
  invoice: Invoice | null;
}

function formatMoney(value: number | null | undefined) {
  return (value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function PrintTruckItineraryPage() {
  const params = useParams();
  const truckId = typeof params?.truckId === "string" ? params.truckId : "";

  const [truck, setTruck] = useState<RoutePlanTruck | null>(null);
  const [routePlan, setRoutePlan] = useState<RoutePlan | null>(null);
  const [convoyLabel, setConvoyLabel] = useState<string | null>(null);
  const [rows, setRows] = useState<ItineraryRow[]>([]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!truckId) return;
    (async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const supabase = createClient();
        const [{ data: truckData, error: truckErr }, { data: invoiceRows }, logo] =
          await Promise.all([
            supabase.from("v_route_plan_trucks").select("*").eq("id", truckId).maybeSingle(),
            supabase
              .from("route_plan_invoices")
              .select("*, invoice:invoices(*)")
              .eq("route_plan_truck_id", truckId)
              .is("superseded_at", null)
              .order("drop_no", { ascending: true, nullsFirst: false })
              .order("created_at", { ascending: true }),
            getAppSetting(LOGO_SETTING_KEY),
          ]);

        if (truckErr || !truckData) {
          setErrorMsg("Could not load this truck.");
          return;
        }
        setTruck(truckData as RoutePlanTruck);
        setRows((invoiceRows ?? []) as unknown as ItineraryRow[]);
        setLogoUrl(logo);

        if (truckData.route_plan_id) {
          const { data: planData } = await supabase
            .from("route_plans")
            .select("*")
            .eq("id", truckData.route_plan_id)
            .maybeSingle();
          setRoutePlan((planData ?? null) as RoutePlan | null);
        }

        if (truckData.main_truck_id) {
          const [{ data: mainTruck }, { data: siblings }] = await Promise.all([
            supabase
              .from("v_route_plan_trucks")
              .select("id")
              .eq("id", truckData.main_truck_id)
              .maybeSingle(),
            supabase
              .from("v_route_plan_trucks")
              .select("id, created_at")
              .eq("main_truck_id", truckData.main_truck_id)
              .order("created_at", { ascending: true }),
          ]);
          if (mainTruck) {
            const idx = (siblings ?? []).findIndex((s) => s.id === truckData.id);
            setConvoyLabel(`Convoy ${idx >= 0 ? idx + 1 : ""}`.trim());
          }
        }
      } catch {
        setErrorMsg("Could not load this truck's itinerary.");
      } finally {
        setLoading(false);
      }
    })();
  }, [truckId]);

  const totalAmount = useMemo(
    () => rows.reduce((sum, r) => sum + (r.invoice?.amount ?? 0), 0),
    [rows]
  );
  const totalBoxes = useMemo(
    () => rows.reduce((sum, r) => sum + (r.qty_box ?? 0), 0),
    [rows]
  );

  // Group rows by drop_no so every invoice sharing a drop (e.g. 4 receipts
  // under Drop #1) prints together, store name and address shown once per
  // group, mirroring the Drop-card grouping already shown on-screen in Route
  // Plan. When drop_no isn't set (trucks that never used the manual
  // drop-number feature), fall back to grouping consecutive rows by store
  // identity (company + delivery address) -- never merge two different
  // stores into one block just because both lack a drop number. Rows arrive
  // pre-sorted by drop_no (nulls last) then created_at, so a single pass
  // preserves that order.
  const dropGroups = useMemo(() => {
    const groups: { key: string; dropNo: number | null; rows: ItineraryRow[] }[] = [];
    for (const row of rows) {
      const address = row.delivery_address || row.invoice?.branch_address || "";
      const key =
        row.drop_no !== null && row.drop_no !== undefined
          ? `drop:${row.drop_no}`
          : `store:${row.invoice?.company_name_raw ?? ""}|${address}`;
      const last = groups[groups.length - 1];
      if (last && last.key === key) {
        last.rows.push(row);
      } else {
        groups.push({ key, dropNo: row.drop_no ?? null, rows: [row] });
      }
    }
    return groups;
  }, [rows]);

  if (loading) {
    return <p className="p-8 text-sm text-gray-400">Loading…</p>;
  }
  if (errorMsg || !truck) {
    return <p className="p-8 text-sm text-red-600">{errorMsg ?? "Truck not found."}</p>;
  }

  const helpers = [truck.helper1_name, truck.helper2_name].filter(Boolean).join(" / ");

  return (
    <div>
      <div className="no-print mb-4 flex justify-end">
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div className="printable-area mx-auto max-w-4xl overflow-hidden rounded-2xl border border-gray-200 bg-white text-sm text-gray-800 shadow-panel">
        <div className="border-b-2 border-brand-600 bg-white px-8 py-7">
          <div className="flex items-center justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gray-400">
                Dynamic88 Solutions
              </p>
              <h1 className="mt-1 text-3xl font-bold uppercase leading-tight tracking-wide text-gray-900">
                Delivery Itinerary
              </h1>
            </div>
            <div className="text-right">
              <span className="inline-block rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-700">
                {convoyLabel ?? "Main Truck"}
              </span>
              <p className="mt-2 text-lg font-bold text-gray-900">
                {routePlan ? new Date(routePlan.route_date).toLocaleDateString() : "—"}
              </p>
              {routePlan?.label && <p className="text-xs text-gray-500">{routePlan.label}</p>}
            </div>
          </div>
        </div>

        <div className="bg-gray-50 px-8 py-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Carrier</p>
              <p className="mt-1 font-semibold">{truck.carrier ?? "—"}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Plate Number</p>
              <p className="mt-1 font-semibold">{truck.plate_number ?? "—"}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Driver</p>
              <p className="mt-1 font-semibold">{truck.driver_name ?? "—"}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Helpers</p>
              <p className="mt-1 font-semibold">{helpers || "—"}</p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {dropGroups.map((group) => {
              const firstRow = group.rows[0];
              const storeName = firstRow?.invoice?.company_name_raw ?? "—";
              const address = firstRow?.delivery_address || firstRow?.invoice?.branch_address || "—";
              return (
                <div key={group.key} className="rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-card">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      {group.dropNo !== null && (
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-600">
                          Drop {group.dropNo}
                        </p>
                      )}
                      <p className="text-sm font-bold text-gray-900">{storeName}</p>
                      <p className="text-[11px] text-gray-500">{address}</p>
                      {firstRow?.merchandiser_name_snapshot && (
                        <p className="text-[11px] font-medium text-brand-600">
                          Merchandiser: {firstRow.merchandiser_name_snapshot}
                          {firstRow.merchandiser_contact_snapshot
                            ? ` · ${firstRow.merchandiser_contact_snapshot}`
                            : ""}
                        </p>
                      )}
                    </div>
                    <p className="shrink-0 whitespace-nowrap text-[10px] text-gray-400">
                      {group.rows.length} invoice{group.rows.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.rows.map((row) => (
                      <div
                        key={row.id}
                        className="min-w-[96px] rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 leading-tight"
                      >
                        <p className="font-semibold text-gray-800">
                          {row.invoice?.document_no ?? "—"}
                        </p>
                        <p className="text-gray-500">{row.qty_box ?? 0} box</p>
                        <p className="font-semibold text-gray-900">
                          {formatMoney(row.invoice?.amount)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {rows.length === 0 && (
              <p className="rounded-lg border border-dashed border-gray-300 bg-white py-6 text-center text-xs text-gray-400">
                No invoices assigned to this truck.
              </p>
            )}

            {rows.length > 0 && (
              <div className="flex items-center justify-end gap-6 border-t-2 border-gray-300 pt-3 text-sm font-semibold text-gray-800">
                <span>
                  Total: {totalBoxes || 0} box{totalBoxes === 1 ? "" : "es"}
                </span>
                <span>{formatMoney(totalAmount)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-gray-100 bg-white px-8 py-6">
          <div className="grid grid-cols-3 gap-x-8 gap-y-10">
            <div>
              <div className="border-t border-gray-400 pt-1">
                <p className="text-xs text-gray-500">Driver's Signature</p>
              </div>
            </div>
            <div>
              <div className="border-t border-gray-400 pt-1">
                <p className="text-xs text-gray-500">Checked By</p>
              </div>
            </div>
            <div>
              <div className="border-t border-gray-400 pt-1">
                <p className="text-xs text-gray-500">Approved By</p>
              </div>
            </div>
          </div>

          <p className="mt-8 text-center text-[10px] text-gray-400">
            Generated {new Date().toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}

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

      <div className="printable-area mx-auto max-w-4xl rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-800">
        <div className="flex items-center justify-between border-b-2 border-brand-600 pb-4">
          <div className="flex items-center gap-4">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Dynamic88 logo" className="h-16 w-auto" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-brand-600 text-xl font-bold text-white">
                D88
              </div>
            )}
            <div>
              <p className="text-lg font-bold tracking-tight text-gray-900">
                Dynamic88 Solutions
              </p>
              <p className="text-xs text-gray-500">Mondial Portal — Delivery Itinerary</p>
            </div>
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

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Carrier</p>
            <p className="mt-1 font-semibold">{truck.carrier ?? "—"}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Plate Number</p>
            <p className="mt-1 font-semibold">{truck.plate_number ?? "—"}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Driver</p>
            <p className="mt-1 font-semibold">{truck.driver_name ?? "—"}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Helpers</p>
            <p className="mt-1 font-semibold">{helpers || "—"}</p>
          </div>
        </div>

        <div className="mt-6">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-t border-gray-300 bg-gray-50 text-left uppercase text-gray-500">
                <th className="py-1.5 pl-2">#</th>
                <th className="py-1.5">Invoice No.</th>
                <th className="py-1.5">Store / Branch</th>
                <th className="py-1.5 text-right">Qty/Box</th>
                <th className="py-1.5 pr-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.id} className="border-b border-gray-200">
                  <td className="py-1.5 pl-2 text-gray-400">{idx + 1}</td>
                  <td className="py-1.5 font-medium">{row.invoice?.document_no ?? "—"}</td>
                  <td className="py-1.5">
                    <p>{row.invoice?.company_name_raw ?? "—"}</p>
                    <p className="text-[10px] text-gray-400">
                      {row.invoice?.branch_address ?? "—"}
                    </p>
                  </td>
                  <td className="py-1.5 text-right">{row.qty_box ?? "—"}</td>
                  <td className="py-1.5 pr-2 text-right">{formatMoney(row.invoice?.amount)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-center text-gray-400">
                    No invoices assigned to this truck.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 font-semibold">
                <td colSpan={3} className="py-2 pl-2 text-right text-gray-500">
                  Total
                </td>
                <td className="py-2 text-right">{totalBoxes || "—"}</td>
                <td className="py-2 pr-2 text-right">{formatMoney(totalAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-12 grid grid-cols-3 gap-x-8 gap-y-10">
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
          Generated {new Date().toLocaleString()} · Dynamic88 Solutions
        </p>
      </div>
    </div>
  );
}

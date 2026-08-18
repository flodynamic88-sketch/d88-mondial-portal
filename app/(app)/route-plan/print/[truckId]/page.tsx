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
  // Planned box count per the route plan (qty_box entered when building the
  // plan) -- shown as a reference figure in the summary table. The "Actual
  // Boxes" column stays blank on print; that's filled in by hand once the
  // truck is actually loaded.
  const totalPlannedBoxes = useMemo(
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
      {/* Portrait, standard margins. Headers repeat on every printed page
          via a native <thead> -- browsers reliably repeat table headers
          across page breaks, unlike a position:fixed div, which only
          reserves space on the first page and can overlap content on the
          rest. Each drop group is its own <tr> with break-inside:avoid,
          which browsers honor far more consistently for table rows than
          for plain divs, so a drop's invoices don't get sliced apart when
          a page break lands in the middle of it. */}
      <style>{`
        @media print {
          @page { size: portrait; margin: 6mm; }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
        }
      `}</style>

      <div className="no-print mb-4 flex justify-end">
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div className="printable-area mx-auto max-w-4xl overflow-hidden rounded-2xl border border-gray-200 bg-white text-sm text-gray-800 shadow-panel print:max-w-none print:overflow-visible print:rounded-none print:border-0 print:shadow-none">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <td className="p-0">
                <div className="border-b-2 border-brand-600 bg-white px-8 py-7 print:px-4 print:py-3">
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
              </td>
            </tr>
          </thead>
          <tbody>
            <tr className="print:break-inside-avoid">
              <td className="p-0">
                <div className="bg-gray-50 px-8 pt-6 print:px-4 print:pt-3">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <p className="text-[10px] uppercase tracking-wide text-gray-500">Carrier</p>
                      <p className="mt-1 text-sm font-semibold">{truck.carrier ?? "—"}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <p className="text-[10px] uppercase tracking-wide text-gray-500">Plate Number</p>
                      <p className="mt-1 text-sm font-semibold">{truck.plate_number ?? "—"}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <p className="text-[10px] uppercase tracking-wide text-gray-500">Driver</p>
                      <p className="mt-1 text-sm font-semibold">{truck.driver_name ?? "—"}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <p className="text-[10px] uppercase tracking-wide text-gray-500">Helpers</p>
                      <p className="mt-1 text-sm font-semibold">{helpers || "—"}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <p className="text-[10px] uppercase tracking-wide text-gray-500">Total Invoices</p>
                      <p className="mt-1 text-sm font-semibold">{rows.length}</p>
                    </div>
                  </div>
                </div>
              </td>
            </tr>

            {/* Summary table -- one row per drop/store, mirroring the
                carrier's own itinerary sheet: Store, Address and Merchandiser
                read straight off the route plan, Planned Boxes is the
                qty_box already entered when the plan was built, and Actual
                Boxes / Cut-Off are left blank for the warehouse crew to fill
                in by hand once the truck is actually loaded. */}
            {rows.length > 0 && (
              <tr className="print:break-inside-avoid">
                <td className="p-0">
                  <div className="bg-gray-50 px-8 pt-4 print:px-4 print:pt-2">
                    <div className="overflow-hidden rounded-xl border border-gray-200 shadow-card">
                      <table className="w-full border-collapse text-[11px]">
                        <thead>
                          <tr className="bg-brand-700 text-white">
                            <th className="w-7 px-2 py-2 text-left font-semibold uppercase tracking-wide">
                              #
                            </th>
                            <th className="px-2 py-2 text-left font-semibold uppercase tracking-wide">
                              Store
                            </th>
                            <th className="px-2 py-2 text-left font-semibold uppercase tracking-wide">
                              Address
                            </th>
                            <th className="px-2 py-2 text-left font-semibold uppercase tracking-wide">
                              Merchandiser
                            </th>
                            <th className="w-20 whitespace-nowrap px-2 py-2 text-center font-semibold uppercase tracking-wide">
                              Planned Boxes
                            </th>
                            <th className="w-20 whitespace-nowrap px-2 py-2 text-center font-semibold uppercase tracking-wide">
                              Actual Boxes
                            </th>
                            <th className="w-16 whitespace-nowrap px-2 py-2 text-center font-semibold uppercase tracking-wide">
                              Cut-Off
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {dropGroups.map((group, idx) => {
                            const firstRow = group.rows[0];
                            const storeName = firstRow?.invoice?.company_name_raw ?? "—";
                            const address =
                              firstRow?.delivery_address || firstRow?.invoice?.branch_address || "—";
                            const merchandiser = firstRow?.merchandiser_name_snapshot
                              ? `${firstRow.merchandiser_name_snapshot}${
                                  firstRow.merchandiser_contact_snapshot
                                    ? ` · ${firstRow.merchandiser_contact_snapshot}`
                                    : ""
                                }`
                              : "—";
                            const plannedBoxes = group.rows.reduce(
                              (sum, r) => sum + (r.qty_box ?? 0),
                              0
                            );
                            return (
                              <tr
                                key={group.key}
                                className={idx % 2 === 1 ? "bg-brand-50/60" : "bg-white"}
                              >
                                <td className="border-t border-gray-200 px-2 py-1.5">
                                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-700 text-[10px] font-bold text-white">
                                    {idx + 1}
                                  </span>
                                </td>
                                <td className="border-t border-gray-200 px-2 py-1.5 font-semibold text-gray-900">
                                  {storeName}
                                </td>
                                <td className="border-t border-gray-200 px-2 py-1.5 text-gray-500">
                                  {address}
                                </td>
                                <td className="border-t border-gray-200 px-2 py-1.5 text-gray-500">
                                  {merchandiser}
                                </td>
                                <td className="border-t border-gray-200 px-2 py-1.5 text-center font-bold text-brand-700">
                                  {plannedBoxes}
                                </td>
                                <td className="border-t border-gray-200 px-2 py-1.5 text-center text-gray-300">
                                  &nbsp;
                                </td>
                                <td className="border-t border-gray-200 px-2 py-1.5 text-center text-gray-300">
                                  &nbsp;
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="bg-brand-700 font-bold text-white">
                            <td
                              colSpan={4}
                              className="border-t-2 border-brand-900 px-2 py-2 text-right text-[10px] uppercase tracking-wide"
                            >
                              Total
                            </td>
                            <td className="border-t-2 border-brand-900 px-2 py-2 text-center">
                              {totalPlannedBoxes}
                            </td>
                            <td
                              colSpan={2}
                              className="border-t-2 border-brand-900 px-2 py-2 text-center text-[10px] font-normal text-brand-100"
                            >
                              {rows.length} invoice{rows.length === 1 ? "" : "s"}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </td>
              </tr>
            )}

            {rows.length > 0 && (
              <tr>
                <td className="p-0">
                  <div className="bg-gray-50 px-8 pt-5 print:px-4 print:pt-3">
                    <span className="inline-block rounded-full bg-brand-700 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                      Consolidated Itemized Invoice Breakdown
                    </span>
                  </div>
                </td>
              </tr>
            )}

            {dropGroups.map((group) => {
              const firstRow = group.rows[0];
              const storeName = firstRow?.invoice?.company_name_raw ?? "—";
              const address = firstRow?.delivery_address || firstRow?.invoice?.branch_address || "—";
              return (
                <tr key={group.key} className="print:break-inside-avoid">
                  <td className="p-0">
                    <div className="bg-gray-50 px-8 pt-3 print:px-4 print:pt-1.5">
                      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white text-xs shadow-card">
                        <div className="flex items-start justify-between gap-3 border-l-4 border-brand-600 bg-brand-50/50 p-3">
                          <div className="flex items-start gap-2">
                            {group.dropNo !== null && (
                              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-700 text-[11px] font-bold text-white">
                                {group.dropNo}
                              </span>
                            )}
                            <div>
                              <p className="text-sm font-bold text-gray-900">{storeName}</p>
                              <p className="text-[11px] text-gray-500">{address}</p>
                            </div>
                          </div>
                          <div className="shrink-0 whitespace-nowrap text-right">
                            <p className="text-[10px] text-gray-400">
                              {group.rows.length} invoice{group.rows.length === 1 ? "" : "s"}
                            </p>
                            {/* Blank on purpose -- filled in by hand once the
                                boxes for this whole drop are counted on the
                                truck, not computed from the planned qty_box. */}
                            <p className="whitespace-nowrap text-[10px] font-bold text-gray-800">
                              Total Box Qty:{" "}
                              <span className="inline-block w-8 border-b border-gray-400">&nbsp;</span>
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 p-3">
                          {group.rows.map((row) => (
                            <div
                              key={row.id}
                              className="min-w-[96px] rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 leading-tight print:break-inside-avoid"
                            >
                              <p className="font-semibold text-gray-800">
                                {row.invoice?.document_no ?? "—"}
                              </p>
                              {/* Left blank on purpose -- the actual box count
                                  gets handwritten in once the truck is loaded,
                                  not printed from the planned qty_box. */}
                              <p className="whitespace-nowrap text-gray-400">
                                Box: <span className="inline-block w-10 border-b border-gray-400">&nbsp;</span>
                              </p>
                              <p className="font-semibold text-gray-900">
                                {formatMoney(row.invoice?.amount)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}

            {rows.length === 0 && (
              <tr>
                <td className="p-0">
                  <div className="bg-gray-50 px-8 pt-3 print:px-4 print:pt-1.5">
                    <p className="rounded-lg border border-dashed border-gray-300 bg-white py-6 text-center text-xs text-gray-400">
                      No invoices assigned to this truck.
                    </p>
                  </div>
                </td>
              </tr>
            )}

            {rows.length > 0 && (
              <tr className="print:break-inside-avoid">
                <td className="p-0">
                  <div className="bg-gray-50 px-8 pb-6 pt-3 print:px-4 print:pb-3 print:pt-1.5">
                    <div className="flex items-center justify-end gap-3 border-t-2 border-brand-700 pt-3">
                      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Total Invoice Amount
                      </span>
                      <span className="text-base font-bold text-brand-700">
                        {formatMoney(totalAmount)}
                      </span>
                    </div>
                  </div>
                </td>
              </tr>
            )}

            <tr className="print:break-inside-avoid">
              <td className="p-0">
                <div className="border-t border-gray-100 bg-white px-8 py-6 print:px-4 print:py-4">
                  <div className="grid grid-cols-3 gap-x-8 gap-y-10 print:gap-y-6">
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
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

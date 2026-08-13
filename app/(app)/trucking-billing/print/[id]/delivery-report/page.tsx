"use client";

import { useParams } from "next/navigation";
import {
  APPROVED_BY_NAME,
  PREPARED_BY_NAME,
  combinedDriverName,
  combinedPlateNumber,
  combinedWaybill,
  formatLongDateNoSpace,
  formatMoney,
  useTruckingBillingPrintData,
} from "@/lib/truckingBillingPrint";

export default function PrintDeliveryReportPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";

  const {
    statement,
    items,
    loading,
    errorMsg,
    totalBoxes,
    totalDeclaredValue,
    deliveryDate,
    updateTotalBoxesOverride,
  } = useTruckingBillingPrintData(id);

  if (loading) {
    return <p className="p-8 text-sm text-gray-400">Loading…</p>;
  }
  if (errorMsg || !statement) {
    return <p className="p-8 text-sm text-red-600">{errorMsg ?? "Billing statement not found."}</p>;
  }

  return (
    <div>
      <div className="no-print mb-4 flex items-center justify-end gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          Boxes total (editable):
          <input
            type="number"
            className="input w-24"
            defaultValue={statement.total_boxes_override ?? totalBoxes}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              updateTotalBoxesOverride(raw === "" ? null : Number(raw));
            }}
          />
        </label>
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div className="printable-area mx-auto max-w-5xl rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-800">
        <div className="border-b-2 border-gray-800 pb-3 text-center">
          <p className="text-lg font-bold uppercase tracking-tight text-gray-900">
            Mondial88 Trading Corporation
          </p>
          <p className="text-xs text-gray-600">Mirax Building</p>
          <p className="text-xs text-gray-600">
            Unit A Ground Floor, 2270 Don Chino Roces Avenue, Makati City, Philippines
          </p>
          <p className="text-xs text-gray-600">Tel. No.: 840-3374-75 | Telefax No.: 840-3390</p>
        </div>

        <p className="mt-4 text-center text-base font-bold uppercase tracking-wide text-gray-900">
          Delivery Report
        </p>
        <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
          <p>
            <span className="font-bold">Waybill No.:</span> {combinedWaybill(statement)}
          </p>
          <p>
            <span className="font-bold">Plate No.:</span> {combinedPlateNumber(statement)}
          </p>
          <p>
            <span className="font-bold">Driver&apos;s Name:</span> {combinedDriverName(statement)}
          </p>
          <p>
            <span className="font-bold">Date:</span> {formatLongDateNoSpace(deliveryDate)}
          </p>
        </div>
        <p className="mt-1 text-sm">
          <span className="font-bold">Truck Type:</span> {statement.truck_type ?? "—"}
        </p>

        <div className="mt-3">
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="border border-gray-400 bg-gray-100 text-center uppercase text-gray-600">
                <th className="border border-gray-400 px-1 py-1">Sched / Area</th>
                <th className="border border-gray-400 px-1 py-1">Inv. / DR / CN</th>
                <th className="border border-gray-400 px-1 py-1">Account Name</th>
                <th className="border border-gray-400 px-1 py-1">Branch</th>
                <th className="border border-gray-400 px-1 py-1">Boxes</th>
                <th className="border border-gray-400 px-1 py-1">Price</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row, idx) => (
                <tr key={row.route_plan_invoice_id ?? idx} className="text-center">
                  {idx === 0 && (
                    <td
                      className="border border-gray-300 px-1 py-1 align-middle font-medium"
                      rowSpan={items.length}
                    >
                      {statement.area ?? "—"}
                    </td>
                  )}
                  <td className="border border-gray-300 px-1 py-1 font-medium">
                    {row.document_no}
                    {row.is_backload && (
                      <span className="ml-1 font-bold text-red-600">(BACKLOAD)</span>
                    )}
                    {row.is_redeliver && (
                      <span className="ml-1 font-bold text-blue-600">(REDELIVER)</span>
                    )}
                  </td>
                  <td className="border border-gray-300 px-1 py-1 text-left">
                    {row.company_name_raw ?? "—"}
                  </td>
                  <td className="border border-gray-300 px-1 py-1 text-left">
                    {row.branch_address ?? "—"}
                  </td>
                  {idx === 0 && (
                    <td
                      className="border border-gray-300 px-1 py-1 align-middle font-bold"
                      rowSpan={items.length}
                    >
                      {totalBoxes || "—"}
                    </td>
                  )}
                  <td className="border border-gray-300 px-1 py-1 text-right">
                    {formatMoney(row.declared_value)}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="border border-gray-300 py-3 text-center text-gray-400">
                    No delivery receipts on this truck.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-400 text-center font-bold">
                <td className="border border-gray-300 px-1 py-1" colSpan={5}>
                  Total
                </td>
                <td className="border border-gray-300 px-1 py-1 text-right">
                  {formatMoney(totalDeclaredValue)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-x-8 gap-y-10">
          <div>
            <p className="font-bold">Prepared By:</p>
            <div className="mt-6 border-t border-gray-400 pt-1">
              <p className="text-sm font-medium">{PREPARED_BY_NAME}</p>
            </div>
          </div>
          <div>
            <p className="font-bold">Approved By:</p>
            <div className="mt-6 border-t border-gray-400 pt-1">
              <p className="text-sm font-medium">{APPROVED_BY_NAME}</p>
            </div>
          </div>
        </div>

        <p className="mt-8 text-center text-[10px] text-gray-400">
          Generated {new Date().toLocaleString()} · Mondial88 Trading Corporation
        </p>
      </div>
    </div>
  );
}

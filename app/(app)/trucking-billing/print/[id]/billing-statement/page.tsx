"use client";

import { useParams } from "next/navigation";
import {
  APPROVED_BY_NAME,
  PREPARED_BY_NAME,
  combinedPlateNumber,
  combinedWaybill,
  formatMMDDYYYY,
  formatMoney,
  useTruckingBillingPrintData,
} from "@/lib/truckingBillingPrint";

export default function PrintBillingStatementPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";

  const {
    statement,
    loading,
    errorMsg,
    totalBoxes,
    totalDeclaredValue,
    ctsFraction,
    accountsLabel,
    deliveryDate,
    forwardedDate,
  } = useTruckingBillingPrintData(id);

  if (loading) {
    return <p className="p-8 text-sm text-gray-400">Loading…</p>;
  }
  if (errorMsg || !statement) {
    return <p className="p-8 text-sm text-red-600">{errorMsg ?? "Billing statement not found."}</p>;
  }

  return (
    <div>
      <div className="no-print mb-4 flex justify-end">
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

        <div className="mt-4 flex items-start justify-between">
          <p className="text-base font-bold uppercase tracking-wide text-gray-900">
            Billing Statement
          </p>
          <p className="text-sm">
            <span className="font-bold">Date:</span> {formatMMDDYYYY(forwardedDate)}
          </p>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
          <p>
            <span className="font-bold">Series No#:</span> {statement.series_no}
          </p>
          <p>
            <span className="font-bold">Trucker:</span> {statement.carrier ?? "—"}
          </p>
          <p>
            <span className="font-bold">Waybill No#:</span> {combinedWaybill(statement)}
          </p>
          <p>
            <span className="font-bold">Plate#:</span> {combinedPlateNumber(statement)}
          </p>
        </div>

        <div className="mt-4">
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="border border-gray-400 bg-gray-100 text-center uppercase text-gray-600">
                <th className="border border-gray-400 px-1 py-1">Transaction Date</th>
                <th className="border border-gray-400 px-1 py-1">Account</th>
                <th className="border border-gray-400 px-1 py-1">Branch Name</th>
                <th className="border border-gray-400 px-1 py-1">Delivery Date</th>
                <th className="border border-gray-400 px-1 py-1">Declared Value</th>
                <th className="border border-gray-400 px-1 py-1">No# Cases</th>
                <th className="border border-gray-400 px-1 py-1">Truck Class.</th>
                <th className="border border-gray-400 px-1 py-1">Unit</th>
                <th className="border border-gray-400 px-1 py-1">Rate</th>
                <th className="border border-gray-400 px-1 py-1">Total Rental</th>
                <th className="border border-gray-400 px-1 py-1">% CTS</th>
              </tr>
            </thead>
            <tbody>
              <tr className="text-center">
                <td className="border border-gray-300 px-1 py-1">{formatMMDDYYYY(forwardedDate)}</td>
                <td className="border border-gray-300 px-1 py-1 text-left">{accountsLabel}</td>
                <td className="border border-gray-300 px-1 py-1">{statement.area ?? "—"}</td>
                <td className="border border-gray-300 px-1 py-1">{formatMMDDYYYY(deliveryDate)}</td>
                <td className="border border-gray-300 px-1 py-1 text-right">
                  {formatMoney(totalDeclaredValue)}
                </td>
                <td className="border border-gray-300 px-1 py-1">{totalBoxes || "—"}</td>
                <td className="border border-gray-300 px-1 py-1">{statement.truck_type ?? "—"}</td>
                <td className="border border-gray-300 px-1 py-1">1</td>
                <td className="border border-gray-300 px-1 py-1 text-right">
                  {statement.truck_rate != null ? formatMoney(statement.truck_rate) : "—"}
                </td>
                <td className="border border-gray-300 px-1 py-1 text-right">
                  {statement.truck_rate != null ? formatMoney(statement.truck_rate) : "—"}
                </td>
                <td className="border border-gray-300 px-1 py-1 text-right">
                  {ctsFraction != null ? `${(ctsFraction * 100).toFixed(2)}%` : "—"}
                </td>
              </tr>
              <tr className="border-t-2 border-gray-400 text-center font-bold">
                <td className="border border-gray-300 px-1 py-1" colSpan={4}>
                  Total
                </td>
                <td className="border border-gray-300 px-1 py-1 text-right">
                  {formatMoney(totalDeclaredValue)}
                </td>
                <td className="border border-gray-300 px-1 py-1" />
                <td className="border border-gray-300 px-1 py-1" />
                <td className="border border-gray-300 px-1 py-1" />
                <td className="border border-gray-300 px-1 py-1 text-right">
                  {statement.truck_rate != null ? formatMoney(statement.truck_rate) : "—"}
                </td>
                <td className="border border-gray-300 px-1 py-1 text-right">
                  {statement.truck_rate != null ? formatMoney(statement.truck_rate) : "—"}
                </td>
                <td className="border border-gray-300 px-1 py-1 text-right">
                  {ctsFraction != null ? `${(ctsFraction * 100).toFixed(2)}%` : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-sm font-bold">
          DATE FORWARDED : {formatMMDDYYYY(forwardedDate)}
        </p>

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

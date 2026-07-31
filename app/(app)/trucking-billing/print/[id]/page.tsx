"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { VTruckingBillingStatement, VTruckingBillingStatementItem } from "@/types/database";

// JMD's own Billing Statement always carries these two signatures --
// there's no per-statement UI to set them (and none is needed), so they're
// shown as fixed constants on every printed statement.
const PREPARED_BY_NAME = "Algene Kianne Bueza";
const APPROVED_BY_NAME = "Mr. Roshan Mirani";

function formatMoney(value: number | null | undefined) {
  return (value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// MM/DD/YYYY, matching the "Date:" / "DATE FORWARDED" fields on JMD's own sheet.
function formatMMDDYYYY(value: string | Date | null | undefined) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

// "JULY 14,2026", matching the Delivery Report's "DATE:" field on JMD's own sheet.
function formatLongDateNoSpace(value: string | Date | null | undefined) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const month = d.toLocaleDateString(undefined, { month: "long" }).toUpperCase();
  return `${month} ${d.getDate()},${d.getFullYear()}`;
}

// When a convoy truck rides along on this truck's single rate, its waybill #
// is joined onto the main truck's with " / " (e.g. "12345 / 67890") so both
// show together on the one shared sheet.
function combinedWaybill(statement: Pick<VTruckingBillingStatement, "waybill_no" | "convoy_waybill_no">) {
  const main = statement.waybill_no ?? "";
  const convoy = statement.convoy_waybill_no?.trim();
  if (!convoy) return main || "—";
  return main ? `${main} / ${convoy}` : convoy;
}

export default function PrintTruckingBillingPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";

  const [statement, setStatement] = useState<VTruckingBillingStatement | null>(null);
  const [items, setItems] = useState<VTruckingBillingStatementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const supabase = createClient();
        const [{ data: s, error: sErr }, { data: itemRows }] = await Promise.all([
          supabase.from("v_trucking_billing_statements").select("*").eq("id", id).maybeSingle(),
          supabase
            .from("v_trucking_billing_statement_items")
            .select("*")
            .eq("statement_id", id),
        ]);

        if (sErr || !s) {
          setErrorMsg("Could not load this billing statement.");
          return;
        }
        setStatement(s as VTruckingBillingStatement);
        setItems((itemRows ?? []) as VTruckingBillingStatementItem[]);
      } catch {
        setErrorMsg("Could not load this billing statement.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const totalBoxes = useMemo(
    () => items.reduce((sum, r) => sum + (r.qty_box ?? 0), 0),
    [items]
  );
  const totalDeclaredValue = useMemo(
    () => items.reduce((sum, r) => sum + (r.declared_value ?? 0), 0),
    [items]
  );
  // Raw fraction (not multiplied by 100) to match JMD's own "% CTS" column,
  // which stores e.g. 0.0401 formatted as a percentage rather than the
  // number 4.01.
  const ctsFraction =
    statement?.truck_rate != null && totalDeclaredValue > 0
      ? statement.truck_rate / totalDeclaredValue
      : null;

  // The accounts on a JMD-format Billing Statement are the retail chains
  // across all receipts on this truck, combined into one line -- distinct
  // company names, comma-joined, matching how the sample sheet lists a
  // single combined "ACCOUNT" per truck-day.
  const accountsLabel = useMemo(() => {
    const names = Array.from(
      new Set(items.map((r) => r.company_name_raw).filter(Boolean) as string[])
    );
    return names.length > 0 ? names.join(", ") : "—";
  }, [items]);

  // "DELIVERY DATE" on the billing summary row / the Delivery Report's own
  // "DATE:" field -- the actual route/delivery date, distinct from the
  // "Date:" header field (when the statement was forwarded for billing).
  const deliveryDate = statement?.route_date ?? null;
  // "Date:" header field / "DATE FORWARDED" line -- when the statement was
  // forwarded for billing. Falls back to today while still unbilled.
  const forwardedDate = statement?.billed_at ?? new Date().toISOString();

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
            <span className="font-bold">Plate#:</span> {statement.plate_number ?? "—"}
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

        <div className="mt-6 border-t border-gray-400 pt-3">
          <p className="text-center text-sm font-bold uppercase tracking-wide text-gray-800">
            Delivery Report
          </p>
          <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
            <p>
              <span className="font-bold">Waybill No.:</span> {combinedWaybill(statement)}
            </p>
            <p>
              <span className="font-bold">Plate No.:</span> {statement.plate_number ?? "—"}
            </p>
            <p>
              <span className="font-bold">Driver&apos;s Name:</span> {statement.driver_name ?? "—"}
            </p>
            <p>
              <span className="font-bold">Date:</span> {formatLongDateNoSpace(deliveryDate)}
            </p>
          </div>
          <p className="mt-1 text-sm">
            <span className="font-bold">Truck Type:</span> {statement.truck_type ?? "—"}
          </p>
        </div>

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
                  <td className="border border-gray-300 px-1 py-1 font-medium">{row.document_no}</td>
                  <td className="border border-gray-300 px-1 py-1 text-left">
                    {row.company_name_raw ?? "—"}
                  </td>
                  <td className="border border-gray-300 px-1 py-1 text-left">
                    {row.branch_address ?? "—"}
                  </td>
                  <td className="border border-gray-300 px-1 py-1">{row.qty_box ?? "—"}</td>
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
                <td className="border border-gray-300 px-1 py-1" colSpan={4}>
                  Total
                </td>
                <td className="border border-gray-300 px-1 py-1">{totalBoxes || "—"}</td>
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

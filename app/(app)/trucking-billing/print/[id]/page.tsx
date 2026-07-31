"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getAppSetting, LOGO_SETTING_KEY } from "@/lib/appSettings";
import type { VTruckingBillingStatement, VTruckingBillingStatementItem } from "@/types/database";

function formatMoney(value: number | null | undefined) {
  return (value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString() : "—";
}

export default function PrintTruckingBillingPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";

  const [statement, setStatement] = useState<VTruckingBillingStatement | null>(null);
  const [items, setItems] = useState<VTruckingBillingStatementItem[]>([]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const supabase = createClient();
        const [{ data: s, error: sErr }, { data: itemRows }, logo] = await Promise.all([
          supabase.from("v_trucking_billing_statements").select("*").eq("id", id).maybeSingle(),
          supabase
            .from("v_trucking_billing_statement_items")
            .select("*")
            .eq("statement_id", id),
          getAppSetting(LOGO_SETTING_KEY),
        ]);

        if (sErr || !s) {
          setErrorMsg("Could not load this billing statement.");
          return;
        }
        setStatement(s as VTruckingBillingStatement);
        setItems((itemRows ?? []) as VTruckingBillingStatementItem[]);
        setLogoUrl(logo);
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
  const ctsPct =
    statement?.truck_rate != null && totalDeclaredValue > 0
      ? Math.round((100 * statement.truck_rate / totalDeclaredValue) * 100) / 100
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
              <p className="text-xs text-gray-500">Trucking Billing Statement</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold uppercase tracking-wide text-gray-900">
              Billing Statement
            </p>
            <p className="mt-1 text-sm text-gray-500">{formatDate(statement.route_date)}</p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Series #</p>
            <p className="mt-1 font-semibold">{statement.series_no}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Waybill #</p>
            <p className="mt-1 font-semibold">{statement.waybill_no ?? "—"}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Trucker</p>
            <p className="mt-1 font-semibold">{statement.carrier ?? "—"}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Plate #</p>
            <p className="mt-1 font-semibold">{statement.plate_number ?? "—"}</p>
          </div>
        </div>

        <div className="mt-6">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-t border-gray-300 bg-gray-50 text-left uppercase text-gray-500">
                <th className="py-1.5 pl-2">Transaction Date</th>
                <th className="py-1.5">Account</th>
                <th className="py-1.5 text-right">Declared Value</th>
                <th className="py-1.5 text-right">No. Cases</th>
                <th className="py-1.5">Unit</th>
                <th className="py-1.5 text-right">Rate</th>
                <th className="py-1.5 text-right">Total Rental</th>
                <th className="py-1.5 pr-2 text-right">% CTS</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-200">
                <td className="py-1.5 pl-2">{formatDate(statement.route_date)}</td>
                <td className="py-1.5">{accountsLabel}</td>
                <td className="py-1.5 text-right">{formatMoney(totalDeclaredValue)}</td>
                <td className="py-1.5 text-right">{totalBoxes || "—"}</td>
                <td className="py-1.5">{statement.plate_number ?? "—"}</td>
                <td className="py-1.5 text-right">
                  {statement.truck_rate != null ? formatMoney(statement.truck_rate) : "—"}
                </td>
                <td className="py-1.5 text-right">
                  {statement.truck_rate != null ? formatMoney(statement.truck_rate) : "—"}
                </td>
                <td className="py-1.5 pr-2 text-right">{ctsPct != null ? `${ctsPct}%` : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-8 border-t border-gray-300 pt-4">
          <p className="text-sm font-bold uppercase tracking-wide text-gray-800">
            Delivery Report
          </p>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Waybill No.</p>
              <p className="mt-1 font-semibold">{statement.waybill_no ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Plate No.</p>
              <p className="mt-1 font-semibold">{statement.plate_number ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Driver&apos;s Name</p>
              <p className="mt-1 font-semibold">{statement.driver_name ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Date</p>
              <p className="mt-1 font-semibold">{formatDate(statement.route_date)}</p>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-t border-gray-300 bg-gray-50 text-left uppercase text-gray-500">
                <th className="py-1.5 pl-2">Inv./DR/CN</th>
                <th className="py-1.5">Account Name</th>
                <th className="py-1.5">Branch</th>
                <th className="py-1.5 text-right">Boxes</th>
                <th className="py-1.5 pr-2 text-right">Price</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row, idx) => (
                <tr key={row.route_plan_invoice_id ?? idx} className="border-b border-gray-200">
                  <td className="py-1.5 pl-2 font-medium">{row.document_no}</td>
                  <td className="py-1.5">{row.company_name_raw ?? "—"}</td>
                  <td className="py-1.5">{row.branch_address ?? "—"}</td>
                  <td className="py-1.5 text-right">{row.qty_box ?? "—"}</td>
                  <td className="py-1.5 pr-2 text-right">{formatMoney(row.declared_value)}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-center text-gray-400">
                    No delivery receipts on this truck.
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
                <td className="py-2 pr-2 text-right">{formatMoney(totalDeclaredValue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-x-8 gap-y-10">
          <div>
            <div className="border-t border-gray-400 pt-1">
              <p className="text-sm font-medium">{statement.prepared_by || " "}</p>
              <p className="text-xs text-gray-500">Prepared By</p>
            </div>
          </div>
          <div>
            <div className="border-t border-gray-400 pt-1">
              <p className="text-sm font-medium">{statement.approved_by || " "}</p>
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

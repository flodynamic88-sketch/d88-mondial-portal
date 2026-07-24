"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { InvoiceCategory, VFinalBilling } from "@/types/database";

const CATEGORY_ORDER: { value: InvoiceCategory; label: string }[] = [
  { value: "CONSIGNMENT", label: "Consignment" },
  { value: "OUTRIGHT", label: "Outright" },
  { value: "MERCURY_DRUG", label: "Mercury Drug" },
];

function formatMoney(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function FinalBillingPage() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [rows, setRows] = useState<VFinalBilling[]>([]);
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (!startDate || !endDate) {
      setErrorMsg("Please select both a start date and an end date.");
      return;
    }
    if (startDate > endDate) {
      setErrorMsg("Start date must be on or before the end date.");
      return;
    }

    setGenerating(true);
    setHasGenerated(true);
    try {
      const supabase = createClient();
      const rangeStart = `${startDate}T00:00:00`;
      const rangeEnd = `${endDate}T23:59:59.999`;

      const { data, error } = await supabase
        .from("v_final_billing")
        .select("*")
        .gte("delivered_at", rangeStart)
        .lte("delivered_at", rangeEnd)
        .order("delivered_at", { ascending: true });

      if (error) {
        setErrorMsg("Could not generate final billing. Connect a Supabase project to see live data.");
        setRows([]);
      } else {
        setRows(data ?? []);
      }
    } catch {
      setErrorMsg("Could not generate final billing. Connect a Supabase project to see live data.");
      setRows([]);
    } finally {
      setGenerating(false);
    }
  }

  const grandTotalAmount = rows.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  const grandTotalFee = rows.reduce((sum, r) => sum + (r.service_fee ?? 0), 0);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-800">Final Billing</h1>
      <p className="mt-1 text-sm text-gray-500">
        Generate the Mondial-confirmed billing statement for a delivery period.
      </p>

      <form onSubmit={handleGenerate} className="card mt-6 flex flex-wrap items-end gap-4">
        <div>
          <label className="label">Delivery Period — Start</label>
          <input
            type="date"
            className="input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Delivery Period — End</label>
          <input
            type="date"
            className="input"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="btn-primary" disabled={generating}>
          {generating ? "Generating…" : "Generate"}
        </button>
      </form>

      {errorMsg && <p className="mt-4 text-sm text-red-600">{errorMsg}</p>}

      {hasGenerated && !generating && !errorMsg && (
        <div className="card mt-6">
          <div className="border-b border-gray-200 pb-4 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Billing Statement
            </p>
            <h2 className="mt-1 text-xl font-bold text-gray-800">
              Mondial88 Trading Corporation
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Delivery Period: {startDate} to {endDate}
            </p>
          </div>

          {rows.length === 0 && (
            <p className="mt-4 text-sm text-gray-400">
              No confirmed, delivered invoices found in this delivery period.
            </p>
          )}

          {rows.length > 0 && (
            <div className="mt-4 space-y-8">
              {CATEGORY_ORDER.map((cat) => {
                const catRows = rows.filter((r) => r.category === cat.value);
                if (catRows.length === 0) return null;

                const subtotalAmount = catRows.reduce((sum, r) => sum + (r.amount ?? 0), 0);
                const subtotalFee = catRows.reduce((sum, r) => sum + (r.service_fee ?? 0), 0);

                return (
                  <div key={cat.value}>
                    <h3 className="text-sm font-semibold text-gray-700">{cat.label}</h3>
                    <div className="mt-2 overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead>
                          <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                            <th className="py-2 pr-4">Document No.</th>
                            <th className="py-2 pr-4">Zone</th>
                            <th className="py-2 pr-4">DC</th>
                            <th className="py-2 pr-4">Amount</th>
                            <th className="py-2 pr-4">Rate %</th>
                            <th className="py-2 pr-4">Service Fee</th>
                            <th className="py-2 pr-4">Delivered</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {catRows.map((row) => (
                            <tr key={row.invoice_id}>
                              <td className="py-2 pr-4 font-medium text-gray-800">
                                {row.document_no}
                              </td>
                              <td className="py-2 pr-4">{row.zone}</td>
                              <td className="py-2 pr-4">{row.is_dc ? "Yes" : "No"}</td>
                              <td className="py-2 pr-4">{formatMoney(row.amount)}</td>
                              <td className="py-2 pr-4">{row.service_rate_pct ?? "—"}</td>
                              <td className="py-2 pr-4">{formatMoney(row.service_fee ?? 0)}</td>
                              <td className="py-2 pr-4">
                                {row.delivered_at
                                  ? new Date(row.delivered_at).toLocaleDateString()
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-gray-300 font-semibold text-gray-800">
                            <td className="py-2 pr-4" colSpan={3}>
                              Subtotal — {cat.label}
                            </td>
                            <td className="py-2 pr-4">{formatMoney(subtotalAmount)}</td>
                            <td className="py-2 pr-4"></td>
                            <td className="py-2 pr-4">{formatMoney(subtotalFee)}</td>
                            <td className="py-2 pr-4"></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                );
              })}

              <div className="flex flex-col items-end gap-1 border-t-2 border-gray-300 pt-4">
                <p className="text-sm text-gray-500">
                  Grand Total Amount:{" "}
                  <span className="font-semibold text-gray-800">
                    {formatMoney(grandTotalAmount)}
                  </span>
                </p>
                <p className="text-lg font-bold text-brand-700">
                  Grand Total Service Fee Due: {formatMoney(grandTotalFee)}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

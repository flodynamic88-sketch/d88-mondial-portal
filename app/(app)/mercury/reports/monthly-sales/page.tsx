"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, MonthlySalesByClientRow } from "@/lib/mercury/types";

function peso(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(n || 0);
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i);

export default function MonthlySalesReportPage() {
  const [rows, setRows] = useState<MonthlySalesByClientRow[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [clientId, setClientId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .schema("flo").from("clients")
      .select("*")
      .order("client_code")
      .then(({ data }) => setClients((data as Client[]) || []));
  }, []);

  useEffect(() => {
    const supabase = createClient();
    setLoading(true);
    let query = supabase
      .schema("flo").from("v_monthly_sales_by_client")
      .select("*")
      .eq("sales_year", year)
      .order("sales_month_num", { ascending: true });
    if (clientId) query = query.eq("client_id", clientId);

    query.then(({ data, error }) => {
      if (error) setError(error.message);
      setRows((data as MonthlySalesByClientRow[]) || []);
      setLoading(false);
    });
  }, [year, clientId]);

  const grandTotal = useMemo(
    () => rows.reduce((s, r) => s + (r.total_net_amount || 0), 0),
    [rows]
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Monthly Sales by Client</h1>
        <p className="text-sm text-gray-500">Mirrors the Monthly_Sales sheet, computed live.</p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="card p-4 flex flex-wrap gap-3">
        <div>
          <label className="label">Year</label>
          <select
            className="input"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Client</label>
          <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">All Clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.client_code} — {c.client_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">No data for the selected filters.</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Month</th>
                <th>Client Code</th>
                <th>Client Name</th>
                <th># Deliveries</th>
                <th>Total Qty</th>
                <th>Gross Amount</th>
                <th>Net Qty</th>
                <th>Net Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx}>
                  <td>{r.sales_month_num}/{r.sales_year}</td>
                  <td>{r.client_code}</td>
                  <td>{r.client_name}</td>
                  <td>{r.delivery_count}</td>
                  <td>{r.total_qty}</td>
                  <td>{peso(r.total_amount)}</td>
                  <td>{r.total_net_qty}</td>
                  <td>{peso(r.total_net_amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold bg-gray-50">
                <td colSpan={7} className="text-right">
                  Grand Total (Net):
                </td>
                <td>{peso(grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}

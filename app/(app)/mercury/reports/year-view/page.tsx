"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { createClient } from "@/lib/mercury/supabase/client";
import type { YearViewRow } from "@/lib/mercury/types";

function peso(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

export default function YearViewReportPage() {
  const [rows, setRows] = useState<YearViewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .schema("flo").from("v_year_view")
      .select("*")
      .order("sales_year", { ascending: true })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setRows((data as YearViewRow[]) || []);
        setLoading(false);
      });
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Year View</h1>
        <p className="text-sm text-gray-500">
          Mirrors the Year_View sheet — yearly rollup of delivery activity.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Net Sales by Year</h2>
        {loading ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-gray-400">No delivery data yet.</div>
        ) : (
          <div style={{ width: "100%", height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="sales_year" fontSize={12} />
                <YAxis tickFormatter={(v) => peso(v)} fontSize={11} />
                <Tooltip formatter={(v: number) => peso(v)} />
                <Bar dataKey="total_net_amount" fill="#5ea5a0" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">No data.</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Year</th>
                <th># Deliveries</th>
                <th>Active Clients</th>
                <th>Active Branches</th>
                <th>Total Qty</th>
                <th>Gross Amount</th>
                <th>Net Qty</th>
                <th>Net Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sales_year}>
                  <td>{r.sales_year}</td>
                  <td>{r.delivery_count}</td>
                  <td>{r.active_clients}</td>
                  <td>{r.active_branches}</td>
                  <td>{r.total_qty}</td>
                  <td>{peso(r.total_amount)}</td>
                  <td>{r.total_net_qty}</td>
                  <td>{peso(r.total_net_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

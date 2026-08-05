"use client";

import { useEffect, useMemo, useState } from "react";
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
import type { BranchSalesRow } from "@/lib/mercury/types";

function peso(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i);

export default function BranchSalesReportPage() {
  const [rows, setRows] = useState<BranchSalesRow[]>([]);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    setLoading(true);
    supabase
      .schema("flo").from("v_branch_sales")
      .select("*")
      .eq("sales_year", year)
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setRows((data as BranchSalesRow[]) || []);
        setLoading(false);
      });
  }, [year]);

  // aggregate per branch across all months of the selected year
  const byBranch = useMemo(() => {
    const map = new Map<string, { branch_name: string; total_net_amount: number }>();
    for (const r of rows) {
      const existing = map.get(r.branch_id) || { branch_name: r.branch_name, total_net_amount: 0 };
      existing.total_net_amount += r.total_net_amount || 0;
      map.set(r.branch_id, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.total_net_amount - a.total_net_amount);
  }, [rows]);

  const top15 = byBranch.slice(0, 15);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Branch Sales</h1>
        <p className="text-sm text-gray-500">Mirrors the Branch_Sales sheet, computed live.</p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="card p-4">
        <label className="label">Year</label>
        <select className="input w-40" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">
          Top 15 Branches by Net Sales ({year})
        </h2>
        {loading ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : top15.length === 0 ? (
          <div className="text-sm text-gray-400">No data for this year.</div>
        ) : (
          <div style={{ width: "100%", height: 400 }}>
            <ResponsiveContainer>
              <BarChart data={top15} layout="vertical" margin={{ left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis type="number" tickFormatter={(v) => peso(v)} fontSize={11} />
                <YAxis type="category" dataKey="branch_name" width={200} fontSize={10} />
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
          <div className="p-6 text-sm text-gray-400">No data for the selected year.</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Month</th>
                <th>Branch Code</th>
                <th>Branch Name</th>
                <th>Retail Chain</th>
                <th># Deliveries</th>
                <th>Total Qty</th>
                <th>Gross Amount</th>
                <th>Net Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx}>
                  <td>{r.sales_month_num}/{r.sales_year}</td>
                  <td>{r.branch_code}</td>
                  <td>{r.branch_name}</td>
                  <td>{r.retail_chain}</td>
                  <td>{r.delivery_count}</td>
                  <td>{r.total_qty}</td>
                  <td>{peso(r.total_amount)}</td>
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

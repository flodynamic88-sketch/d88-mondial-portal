"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/mercury/supabase/client";
import type { BranchPerformanceRow, Client } from "@/lib/mercury/types";

function peso(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(n || 0);
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i);
const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

export default function BranchPerformanceReportPage() {
  const [rows, setRows] = useState<BranchPerformanceRow[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [returnThreshold, setReturnThreshold] = useState<number | "">("");
  const [clientId, setClientId] = useState("");
  const [year, setYear] = useState<number | "">("");
  const [month, setMonth] = useState<number | "">("");

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
    let query = supabase.schema("flo").from("v_branch_performance").select("*").order("total_deliveries", { ascending: false });
    if (clientId) query = query.eq("client_id", clientId);
    if (year) query = query.eq("sales_year", year);
    if (month) query = query.eq("sales_month_num", month);
    query.then(({ data, error }) => {
      if (error) setError(error.message);
      setRows((data as BranchPerformanceRow[]) || []);
      setLoading(false);
    });
  }, [clientId, year, month]);

  // Since a branch can be shared by multiple clients, when "All Clients" is
  // selected we roll the per-branch-per-client rows up into one row per
  // branch so the table still reads as "branch performance overall".
  const displayRows = useMemo(() => {
    if (clientId) return rows;
    const map = new Map<string, BranchPerformanceRow>();
    for (const r of rows) {
      const existing = map.get(r.branch_id);
      if (!existing) {
        map.set(r.branch_id, { ...r, client_id: null, client_code: null, client_name: null });
        continue;
      }
      existing.total_deliveries += r.total_deliveries;
      existing.on_time_deliveries += r.on_time_deliveries;
      existing.late_deliveries += r.late_deliveries;
      existing.cancelled_deliveries += r.cancelled_deliveries;
      existing.returned_deliveries += r.returned_deliveries;
      existing.total_qty += r.total_qty;
      existing.total_qty_returned += r.total_qty_returned;
      existing.total_net_amount += r.total_net_amount;
      existing.return_rate_pct =
        existing.total_qty > 0
          ? Math.round((100 * existing.total_qty_returned) / existing.total_qty * 100) / 100
          : 0;
    }
    return Array.from(map.values());
  }, [rows, clientId]);

  const filtered = useMemo(() => {
    return displayRows.filter((r) => {
      const matchesSearch =
        !search.trim() ||
        r.branch_name.toLowerCase().includes(search.toLowerCase()) ||
        r.branch_code.toLowerCase().includes(search.toLowerCase());
      const matchesThreshold =
        returnThreshold === "" || r.return_rate_pct >= Number(returnThreshold);
      return matchesSearch && matchesThreshold;
    });
  }, [displayRows, search, returnThreshold]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Branch Performance</h1>
        <p className="text-sm text-gray-500">
          Mirrors the Branch_Performance sheet — delivery reliability &amp; return rates,
          computed live. Since one Mercury Drug branch is often shared by several clients,
          filter by client to see that client&apos;s numbers for the branch specifically.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="card p-4 flex flex-wrap gap-3">
        <div>
          <label className="label">Client</label>
          <select className="input w-64" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">— All Clients (rolled up) —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.client_code} — {c.client_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Search Branch</label>
          <input
            className="input w-56"
            placeholder="Branch name or code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Min. Return Rate (%)</label>
          <input
            type="number"
            className="input w-40"
            placeholder="e.g. 5"
            value={returnThreshold}
            onChange={(e) =>
              setReturnThreshold(e.target.value === "" ? "" : Number(e.target.value))
            }
          />
        </div>
        <div>
          <label className="label">Year</label>
          <select
            className="input w-32"
            value={year}
            onChange={(e) => setYear(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">All Years</option>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Month</label>
          <select
            className="input w-40"
            value={month}
            onChange={(e) => setMonth(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">All Months</option>
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">No branches match the current filters.</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Branch Code</th>
                <th>Branch Name</th>
                <th>Retail Chain</th>
                {clientId && <th>Client</th>}
                {clientId && !(year && month) && <th>Period</th>}
                <th>Total Deliveries</th>
                <th>On-Time</th>
                <th>Late</th>
                <th>Cancelled</th>
                <th>Returned</th>
                <th>Avg Days Variance</th>
                <th>Return Rate %</th>
                <th>Net Amount</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, idx) => (
                <tr key={`${r.branch_id}-${r.client_id ?? "all"}-${idx}`} className={r.return_rate_pct >= 10 ? "bg-red-50" : ""}>
                  <td>{r.branch_code}</td>
                  <td>{r.branch_name}</td>
                  <td>{r.retail_chain}</td>
                  {clientId && <td>{r.client_name}</td>}
                  {clientId && !(year && month) && (
                    <td>
                      {r.sales_month_num && r.sales_year
                        ? `${r.sales_month_num}/${r.sales_year}`
                        : "All"}
                    </td>
                  )}
                  <td>{r.total_deliveries}</td>
                  <td>{r.on_time_deliveries}</td>
                  <td>{r.late_deliveries}</td>
                  <td>{r.cancelled_deliveries}</td>
                  <td>{r.returned_deliveries}</td>
                  <td>{r.avg_days_variance != null ? r.avg_days_variance.toFixed(1) : "—"}</td>
                  <td>{r.return_rate_pct}%</td>
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

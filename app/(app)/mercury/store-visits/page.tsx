"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Branch, StoreVisitHeaderFull } from "@/lib/mercury/types";

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
}

function sourceBadgeClass(via: string) {
  return via === "mobile_form" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600";
}

export default function StoreVisitsPage() {
  const [rows, setRows] = useState<StoreVisitHeaderFull[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [branchId, setBranchId] = useState("");
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    let query = supabase
      .schema("flo").from("v_store_visit_headers_full")
      .select("*")
      .order("visit_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (branchId) query = query.eq("branch_id", branchId);

    const { data, error } = await query;
    if (error) setError(error.message);
    setRows((data as StoreVisitHeaderFull[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    const supabase = createClient();
    supabase
      .schema("flo").from("branches")
      .select("*")
      .order("branch_name")
      .then(({ data }) => setBranches((data as Branch[]) || []));
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.sales_coordinator_name.toLowerCase().includes(q) ||
        (r.branch_name || r.branch_name_current || "").toLowerCase().includes(q) ||
        (r.branch_code || r.branch_code_current || "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const totalQty = filtered.reduce((s, r) => s + (r.total_qty || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Store Visits</h1>
          <p className="text-sm text-gray-500">
            {filtered.length} visit(s) &middot; {totalQty} total qty counted &middot; Sales
            Coordinator field inventory checks at Mercury (or any) branches.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/mercury/store-visits/monitoring" className="btn-secondary">
            Per-Client Monitoring
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="card p-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label">Branch</label>
          <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">All</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.branch_code} — {b.branch_name}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-1 lg:col-span-2">
          <label className="label">Search</label>
          <input
            className="input"
            placeholder="Coordinator, branch…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">No store visit records found.</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Visit Date</th>
                <th>Time In</th>
                <th>Sales Coordinator</th>
                <th>Branch</th>
                <th className="text-right">Lines</th>
                <th className="text-right">Total Qty</th>
                <th>Source</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td>{formatDate(r.visit_date)}</td>
                  <td>{r.time_in || "—"}</td>
                  <td>{r.sales_coordinator_name}</td>
                  <td>
                    {(r.branch_code_current || r.branch_code) && (
                      <span className="text-gray-400 mr-1">
                        {r.branch_code_current || r.branch_code}
                      </span>
                    )}
                    {r.branch_name_current || r.branch_name || "—"}
                  </td>
                  <td className="text-right">{r.line_count ?? 0}</td>
                  <td className="text-right">{r.total_qty ?? 0}</td>
                  <td>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${sourceBadgeClass(
                        r.submitted_via
                      )}`}
                    >
                      {r.submitted_via === "mobile_form" ? "Mobile Form" : "Portal"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">
                    <Link
                      href={`/mercury/store-visits/${r.id}`}
                      className="text-brand-dark hover:underline text-xs font-medium"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

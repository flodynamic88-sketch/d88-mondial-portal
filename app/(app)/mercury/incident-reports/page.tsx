"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, IncidentReport, IrClassification } from "@/lib/mercury/types";
import { IR_CLASSIFICATIONS } from "@/lib/mercury/types";

function statusBadgeClass(status: string) {
  switch (status) {
    case "Open":
      return "bg-blue-100 text-blue-700";
    case "Under Review":
      return "bg-amber-100 text-amber-700";
    case "Resolved":
      return "bg-green-100 text-green-700";
    case "Closed":
      return "bg-gray-100 text-gray-500";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "Open", label: "Open" },
  { value: "Under Review", label: "Under Review" },
  { value: "Resolved", label: "Resolved" },
  { value: "Closed", label: "Closed" },
];

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
}

interface IrRow extends IncidentReport {
  clients?: { id: string; client_code: string; client_name: string } | null;
  branches?: { id: string; branch_name: string; retail_chain: string | null } | null;
}

export default function IncidentReportsPage() {
  const [rows, setRows] = useState<IrRow[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState("");
  const [classification, setClassification] = useState<IrClassification | "">("");
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    let query = supabase
      .schema("flo").from("incident_reports")
      .select("*, clients(id, client_code, client_name), branches(id, branch_name, retail_chain)")
      .order("incident_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    if (classification) query = query.eq("classification", classification);

    let countsQuery = supabase.schema("flo").from("incident_reports").select("status");

    const [{ data, error }, { data: countRows, error: countErr }] = await Promise.all([
      query,
      countsQuery,
    ]);
    if (error) setError(error.message);
    if (countErr) setError(countErr.message);
    setRows((data as unknown as IrRow[]) || []);

    const counts: Record<string, number> = {};
    (countRows || []).forEach((r: { status: string }) => {
      counts[r.status] = (counts[r.status] || 0) + 1;
    });
    counts[""] = (countRows || []).length;
    setStatusCounts(counts);

    setLoading(false);
  }

  useEffect(() => {
    const supabase = createClient();
    supabase
      .schema("flo").from("clients")
      .select("*")
      .order("client_code")
      .then(({ data }) => setClients((data as Client[]) || []));
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, classification]);

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.ir_number.toLowerCase().includes(q) ||
      r.employee_name.toLowerCase().includes(q) ||
      (r.clients?.client_name || "").toLowerCase().includes(q) ||
      (r.branches?.branch_name || "").toLowerCase().includes(q) ||
      (r.location || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Incident Reports</h1>
          <p className="text-sm text-gray-500">
            {filtered.length} record(s) &middot; Log, monitor, and print Incident Report (IR) forms
            for wrong count, discrepancy, loss, damage, insubordination, wrong picking, and other
            operational issues.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/mercury/incident-reports/print" className="btn-secondary">
            Print Blank Form
          </Link>
          <Link href="/mercury/incident-reports/new" className="btn-primary">
            + New Incident Report
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => {
          const active = status === tab.value;
          return (
            <button
              key={tab.value || "all"}
              type="button"
              onClick={() => setStatus(tab.value)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-gray-900 border-gray-900 text-white shadow-sm"
                  : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {tab.label}
              <span className={`ml-1.5 text-xs ${active ? "text-white/70" : "text-gray-400"}`}>
                {statusCounts[tab.value] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      <div className="card p-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label">Classification</label>
          <select
            className="input"
            value={classification}
            onChange={(e) => setClassification(e.target.value as IrClassification | "")}
          >
            <option value="">All</option>
            {IR_CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-1 lg:col-span-2">
          <label className="label">Search</label>
          <input
            className="input"
            placeholder="IR #, employee, client, branch, location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">No incident reports found.</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>IR #</th>
                <th>Incident Date</th>
                <th>Classification</th>
                <th>Employee Involved</th>
                <th>Client / Branch</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td>{r.ir_number}</td>
                  <td>{formatDate(r.incident_date)}</td>
                  <td>
                    {r.classification === "Other" ? r.other_classification || "Other" : r.classification}
                  </td>
                  <td>
                    {r.employee_name}
                    {r.employee_position && (
                      <div className="text-xs text-gray-400">{r.employee_position}</div>
                    )}
                  </td>
                  <td>
                    {r.branches?.branch_name || r.clients?.client_name || r.location || "—"}
                  </td>
                  <td>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(
                        r.status
                      )}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="space-x-3 whitespace-nowrap">
                    <Link
                      href={`/mercury/incident-reports/${r.id}`}
                      className="text-brand-dark hover:underline text-xs font-medium"
                    >
                      View
                    </Link>
                    <Link
                      href={`/mercury/incident-reports/${r.id}/print`}
                      className="text-brand-dark hover:underline text-xs font-medium"
                    >
                      Print
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

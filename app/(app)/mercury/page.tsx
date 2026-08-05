"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/mercury/supabase/client";

// 2026-07-15: income (service fees) and net sales should only be
// recognized once a delivery/pick-up is actually confirmed Delivered —
// not the moment an encoder types a target Date of Delivery on a still-
// Pending/In-Transit transaction. Mirrors the same DELIVERED_STATUSES
// convention already used by Billing/SOA.
const DELIVERED_STATUSES = ["Delivered", "Delivered-Late"];

interface DeliveredRow {
  client_id: string | null;
  client_name?: string | null;
  transaction_type: string | null;
  total_net_amount: number | null;
  service_fee_amount: number | null;
  invoice_date?: string | null;
  date_of_delivery?: string | null;
}

function peso(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="card p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold ${accent || "text-gray-900"}`}>
        {value}
      </div>
    </div>
  );
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const NOW = new Date();
const CURRENT_YEAR = NOW.getFullYear();
const CURRENT_MONTH = NOW.getMonth() + 1; // 1-12
const YEARS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i);

interface MonthKpis {
  total_net_delivered: number;
  active_clients: number;
  active_branches: number;
  pending_deliveries: number;
  in_transit_deliveries: number;
  late_deliveries: number;
  returned_deliveries: number;
}

export default function DashboardPage() {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [month, setMonth] = useState(CURRENT_MONTH);

  const [kpis, setKpis] = useState<MonthKpis | null>(null);
  const [deliveredRows, setDeliveredRows] = useState<DeliveredRow[]>([]);
  const [inTransitRows, setInTransitRows] = useState<DeliveredRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isCurrentMonth = year === CURRENT_YEAR && month === CURRENT_MONTH;

  useEffect(() => {
    const supabase = createClient();

    async function load() {
      setLoading(true);
      setError(null);

      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const endDateObj = new Date(year, month, 1); // first day of next month
      const endDate = `${endDateObj.getFullYear()}-${String(endDateObj.getMonth() + 1).padStart(2, "0")}-01`;

      const [
        { data: headers, error: headersErr },
        clientsCountRes,
        branchesCountRes,
        { data: deliveredData, error: deliveredErr },
        { data: inTransitData, error: inTransitErr },
      ] = await Promise.all([
        supabase
          .schema("flo").from("delivery_headers")
          .select("id, status")
          .gte("date_of_delivery", startDate)
          .lt("date_of_delivery", endDate),
        supabase.schema("flo").from("clients").select("*", { count: "exact", head: true }).eq("status", "Active"),
        supabase.schema("flo").from("branches").select("*", { count: "exact", head: true }).eq("status", "Active"),
        // 2026-07-15: Net Sales + Income (Delivery Fee / Pick-up Fee) now
        // only pull rows whose delivery is actually Delivered/Delivered-Late
        // — per Reymar's request, a still-Pending/In-Transit transaction
        // (even one with a Date of Delivery already typed in) should NOT
        // count as sales/income yet. invoice_date is also pulled here so we
        // can compute the Fill Rate KPI (invoice_date vs date_of_delivery).
        supabase
          .schema("flo").from("v_delivery_headers_full")
          .select(
            "client_id, client_name, transaction_type, total_net_amount, service_fee_amount, invoice_date, date_of_delivery"
          )
          .in("status", DELIVERED_STATUSES)
          .gte("date_of_delivery", startDate)
          .lt("date_of_delivery", endDate),
        // 2026-07-17: "Possible Income" — projected income still sitting in
        // In-Transit transactions for the selected month (not yet realized,
        // separate from the Delivered-only Total Income above).
        supabase
          .schema("flo").from("v_delivery_headers_full")
          .select("client_id, client_name, transaction_type, total_net_amount, service_fee_amount")
          .eq("status", "In-Transit")
          .gte("date_of_delivery", startDate)
          .lt("date_of_delivery", endDate),
      ]);

      if (headersErr) setError(headersErr.message);
      if (clientsCountRes.error) setError(clientsCountRes.error.message);
      if (branchesCountRes.error) setError(branchesCountRes.error.message);
      if (deliveredErr) setError(deliveredErr.message);
      if (inTransitErr) setError(inTransitErr.message);

      const headerRows = headers || [];
      const rows = (deliveredData as DeliveredRow[]) || [];

      // Net Delivered = total net amount across Delivered/Delivered-Late
      // transactions (Delivery + Pick-up) — same scope as before, just now
      // gated by status instead of by date alone.
      const totalNetDelivered = rows.reduce((s, r) => s + (r.total_net_amount || 0), 0);

      setKpis({
        total_net_delivered: totalNetDelivered,
        active_clients: clientsCountRes.count || 0,
        active_branches: branchesCountRes.count || 0,
        pending_deliveries: headerRows.filter((h) => h.status === "Pending").length,
        in_transit_deliveries: headerRows.filter((h) => h.status === "In-Transit").length,
        late_deliveries: headerRows.filter((h) => h.status === "Delivered-Late").length,
        returned_deliveries: headerRows.filter((h) => h.status === "Returned").length,
      });
      setDeliveredRows(rows);
      setInTransitRows((inTransitData as DeliveredRow[]) || []);
      setLoading(false);
    }

    load();
  }, [year, month]);

  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;

  // Merge Delivery net sales + Delivery fee income + Pick-up fee income into
  // one per-client list. Source rows are already scoped to
  // Delivered/Delivered-Late transactions only (see load() above).
  const clientRows = useMemo(() => {
    const map = new Map<
      string,
      { client_name: string; netSales: number; deliveryFee: number; pickupFee: number }
    >();
    deliveredRows.forEach((r) => {
      if (!r.client_id) return;
      const existing = map.get(r.client_id) || {
        client_name: r.client_name || "—",
        netSales: 0,
        deliveryFee: 0,
        pickupFee: 0,
      };
      if (r.transaction_type === "Delivery") {
        existing.netSales += r.total_net_amount || 0;
        existing.deliveryFee += r.service_fee_amount || 0;
      } else if (r.transaction_type === "Pickup") {
        existing.pickupFee += r.service_fee_amount || 0;
      }
      map.set(r.client_id, existing);
    });
    return Array.from(map.values()).sort(
      (a, b) =>
        b.netSales + b.deliveryFee + b.pickupFee - (a.netSales + a.deliveryFee + a.pickupFee)
    );
  }, [deliveredRows]);

  const totalIncome = useMemo(
    () => clientRows.reduce((sum, r) => sum + r.deliveryFee + r.pickupFee, 0),
    [clientRows]
  );

  // "Possible Income" — projected service-fee income sitting in In-Transit
  // transactions for the selected month. Not yet realized (only counted
  // once Delivered), shown as a separate, clearly-labeled figure so it
  // never gets mixed into Total Income above.
  const possibleIncome = useMemo(
    () => inTransitRows.reduce((sum, r) => sum + (r.service_fee_amount || 0), 0),
    [inTransitRows]
  );

  // Fill Rate — % of Delivered/Delivered-Late transactions this month that
  // were delivered on the same day they were invoiced (date_of_delivery ===
  // invoice_date). Basis: invoice_date vs date_of_delivery, delivered items
  // only, per Reymar's request.
  const fillRate = useMemo(() => {
    const withDates = deliveredRows.filter((r) => r.invoice_date && r.date_of_delivery);
    if (withDates.length === 0) return null;
    const filledSameDay = withDates.filter((r) => r.invoice_date === r.date_of_delivery).length;
    return (filledSameDay / withDates.length) * 100;
  }, [deliveredRows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">
            Live overview of Mercury Drug delivery operations — {monthLabel}
            {isCurrentMonth ? " (current month)" : ""}.
          </p>
        </div>
        <div className="card p-3 flex gap-2 items-end">
          <div>
            <label className="label">Month</label>
            <select className="input w-40" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTH_NAMES.map((m, idx) => (
                <option key={m} value={idx + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Year</label>
            <select className="input w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          {!isCurrentMonth && (
            <button
              className="btn-secondary text-xs h-[38px]"
              onClick={() => {
                setYear(CURRENT_YEAR);
                setMonth(CURRENT_MONTH);
              }}
            >
              Back to This Month
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label={`Net Delivered (${monthLabel})`}
          value={loading ? "…" : peso(kpis?.total_net_delivered)}
          accent="text-brand-dark"
        />
        <KpiCard
          label={`Total Income (${monthLabel})`}
          value={loading ? "…" : peso(totalIncome)}
          accent="text-emerald-600"
        />
        <KpiCard
          label={`Possible Income — In-Transit (${monthLabel})`}
          value={loading ? "…" : peso(possibleIncome)}
          accent="text-sky-600"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Active Clients" value={String(kpis?.active_clients ?? 0)} />
        <KpiCard label="Active Branches" value={String(kpis?.active_branches ?? 0)} />
        <KpiCard
          label="Pending Deliveries"
          value={loading ? "…" : String(kpis?.pending_deliveries ?? 0)}
          accent="text-amber-600"
        />
        <KpiCard
          label="Fill Rate"
          value={loading ? "…" : fillRate === null ? "—" : `${fillRate.toFixed(1)}%`}
          accent="text-indigo-600"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="In-Transit"
          value={loading ? "…" : String(kpis?.in_transit_deliveries ?? 0)}
        />
        <KpiCard
          label="Delivered Late"
          value={loading ? "…" : String(kpis?.late_deliveries ?? 0)}
          accent="text-orange-600"
        />
        <KpiCard
          label="Returned"
          value={loading ? "…" : String(kpis?.returned_deliveries ?? 0)}
          accent="text-red-600"
        />
      </div>

      <div className="card overflow-x-auto">
        <div className="p-5 pb-0">
          <h2 className="text-sm font-semibold text-gray-700">
            Per-Client Sales — {monthLabel}
          </h2>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        ) : clientRows.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">No client sales data for {monthLabel}.</div>
        ) : (
          <table className="table-base mt-3">
            <thead>
              <tr>
                <th>Client</th>
                <th>Net Sales (Delivery)</th>
                <th>Income — Delivery Fee</th>
                <th>Income — Pick-up Fee</th>
                <th>Total Income</th>
              </tr>
            </thead>
            <tbody>
              {clientRows.map((r) => (
                <tr key={r.client_name} className="hover:bg-gray-50">
                  <td>{r.client_name}</td>
                  <td>{peso(r.netSales)}</td>
                  <td>{r.deliveryFee > 0 ? peso(r.deliveryFee) : "—"}</td>
                  <td>{r.pickupFee > 0 ? peso(r.pickupFee) : "—"}</td>
                  <td className="font-medium text-emerald-700">
                    {peso(r.deliveryFee + r.pickupFee)}
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

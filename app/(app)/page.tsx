import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import BarChart from "@/components/BarChart";
import type { InvoiceCategory } from "@/types/database";

interface Kpi {
  label: string;
  value: string;
  hint?: string;
}

interface VarianceReasonRow {
  reason_label: string;
  reason_type: string;
  log_count: number;
}

interface PendingRoutePlan {
  id: string;
  route_date: string;
  label: string | null;
}

interface TodayTruckStatus {
  total: number;
  dispatched: number;
}

interface TransmittalBacklogRow {
  category: InvoiceCategory;
  label: string;
  count: number;
}

const CATEGORY_LABELS: Record<InvoiceCategory, string> = {
  CONSIGNMENT: "Consignment",
  OUTRIGHT: "Outright",
  MERCURY_DRUG: "Mercury Drug",
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function getTopVarianceReasons(): Promise<VarianceReasonRow[]> {
  try {
    const supabase = createClient();
    const { data } = await supabase
      .from("v_delivery_variance_reason_summary")
      .select("*")
      .order("log_count", { ascending: false })
      .limit(5);
    return (data ?? []) as VarianceReasonRow[];
  } catch {
    return [];
  }
}

async function getKpis(): Promise<Kpi[]> {
  // Best-effort live counts. Falls back to placeholders if Supabase isn't
  // configured yet (no project created) or the query fails for any reason.
  try {
    const supabase = createClient();

    const [{ count: total }, { count: pending }, { count: delivered }] =
      await Promise.all([
        supabase.from("invoices").select("*", { count: "exact", head: true }),
        supabase
          .from("invoices")
          .select("*", { count: "exact", head: true })
          .eq("status", "PENDING"),
        supabase
          .from("invoices")
          .select("*", { count: "exact", head: true })
          .eq("status", "DELIVERED"),
      ]);

    const totalCount = total ?? 0;
    const deliveredCount = delivered ?? 0;
    const fulfillmentRate =
      totalCount > 0 ? ((deliveredCount / totalCount) * 100).toFixed(1) : "0.0";

    return [
      { label: "Total Invoices", value: String(totalCount) },
      { label: "Pending", value: String(pending ?? 0) },
      { label: "Delivered", value: String(deliveredCount) },
      { label: "Fulfillment Rate", value: `${fulfillmentRate}%` },
    ];
  } catch {
    return [
      { label: "Total Invoices", value: "—", hint: "Connect Supabase to see live data" },
      { label: "Pending", value: "—", hint: "Connect Supabase to see live data" },
      { label: "Delivered", value: "—", hint: "Connect Supabase to see live data" },
      { label: "Fulfillment Rate", value: "—", hint: "Connect Supabase to see live data" },
    ];
  }
}

/** Route plans still waiting on Admin approval, soonest date first. */
async function getPendingRoutePlans(): Promise<PendingRoutePlan[]> {
  try {
    const supabase = createClient();
    const { data } = await supabase
      .from("route_plans")
      .select("id, route_date, label")
      .is("approved_at", null)
      .order("route_date", { ascending: true })
      .limit(5);
    return (data ?? []) as PendingRoutePlan[];
  } catch {
    return [];
  }
}

/** Trucks scheduled on today's route plan(s), and how many have dispatched. */
async function getTodayTruckStatus(): Promise<TodayTruckStatus> {
  try {
    const supabase = createClient();
    const { data: plans } = await supabase
      .from("route_plans")
      .select("id")
      .eq("route_date", todayStr());
    const planIds = (plans ?? []).map((p) => p.id as string);
    if (planIds.length === 0) return { total: 0, dispatched: 0 };

    const { data: trucks } = await supabase
      .from("route_plan_trucks")
      .select("id, dispatched_at")
      .in("route_plan_id", planIds);
    const total = trucks?.length ?? 0;
    const dispatched = (trucks ?? []).filter((t) => t.dispatched_at).length;
    return { total, dispatched };
  } catch {
    return { total: 0, dispatched: 0 };
  }
}

/** Delivered invoices per category that haven't been picked up into a transmittal yet. */
async function getTransmittalBacklog(): Promise<TransmittalBacklogRow[]> {
  try {
    const supabase = createClient();
    const categories: InvoiceCategory[] = ["CONSIGNMENT", "OUTRIGHT", "MERCURY_DRUG"];
    const rows = await Promise.all(
      categories.map(async (category) => {
        const { count } = await supabase
          .from("invoices")
          .select("*", { count: "exact", head: true })
          .eq("category", category)
          .not("actual_delivery_date", "is", null)
          .is("transmittal_id", null);
        return { category, label: CATEGORY_LABELS[category], count: count ?? 0 };
      })
    );
    return rows;
  } catch {
    return [];
  }
}

/** CTS pass-rate per route plan date, most recent 7 plans that have truck data. */
async function getCtsTrend(): Promise<{ label: string; value: number }[]> {
  try {
    const supabase = createClient();
    const { data: plans } = await supabase
      .from("route_plans")
      .select("id, route_date")
      .order("route_date", { ascending: false })
      .limit(7);
    const planList = (plans ?? []) as { id: string; route_date: string }[];
    if (planList.length === 0) return [];

    const planIds = planList.map((p) => p.id);
    const { data: trucks } = await supabase
      .from("route_plan_trucks")
      .select("id, route_plan_id")
      .in("route_plan_id", planIds);
    const truckRows = (trucks ?? []) as { id: string; route_plan_id: string }[];
    if (truckRows.length === 0) return [];

    const truckIds = truckRows.map((t) => t.id);
    const { data: ctsRows } = await supabase
      .from("v_truck_cts")
      .select("truck_id, cts_pass")
      .in("truck_id", truckIds);
    const ctsByTruck = new Map(
      ((ctsRows ?? []) as { truck_id: string; cts_pass: boolean | null }[]).map((r) => [
        r.truck_id,
        r.cts_pass,
      ])
    );

    return planList
      .map((plan) => {
        const planTruckIds = truckRows
          .filter((t) => t.route_plan_id === plan.id)
          .map((t) => t.id);
        const relevant = planTruckIds
          .map((id) => ctsByTruck.get(id))
          .filter((v): v is boolean => v !== null && v !== undefined);
        if (relevant.length === 0) return null;
        const passRate = Math.round(
          (relevant.filter(Boolean).length / relevant.length) * 100
        );
        return {
          label: new Date(plan.route_date).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          }),
          value: passRate,
        };
      })
      .filter((row): row is { label: string; value: number } => row !== null)
      .reverse();
  } catch {
    return [];
  }
}

export default async function DashboardPage() {
  const [kpis, topVarianceReasons, pendingRoutePlans, todayTrucks, transmittalBacklog, ctsTrend] =
    await Promise.all([
      getKpis(),
      getTopVarianceReasons(),
      getPendingRoutePlans(),
      getTodayTruckStatus(),
      getTransmittalBacklog(),
      getCtsTrend(),
    ]);
  const topReason = topVarianceReasons[0];
  const totalBacklog = transmittalBacklog.reduce((sum, r) => sum + r.count, 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Overview of Mondial delivery operations.</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="card hover:shadow-card-hover">
            <p className="text-sm font-medium text-gray-500">{kpi.label}</p>
            <p className="mt-2 text-3xl font-bold text-brand-700">{kpi.value}</p>
            {kpi.hint && <p className="mt-1 text-xs text-gray-400">{kpi.hint}</p>}
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">Route Plans Awaiting Approval</h2>
            <Link href="/route-plan" className="text-xs font-medium text-brand-600 hover:text-brand-700">
              Open →
            </Link>
          </div>
          {pendingRoutePlans.length === 0 ? (
            <p className="mt-3 text-sm text-gray-400">Nothing waiting on approval.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm text-gray-600">
              {pendingRoutePlans.map((plan) => (
                <li key={plan.id} className="flex justify-between border-t border-gray-100 pt-1.5 first:border-0 first:pt-0">
                  <span>{plan.label || new Date(plan.route_date).toLocaleDateString()}</span>
                  <span className="badge-neutral">Pending</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-gray-800">Trucks Today</h2>
          {todayTrucks.total === 0 ? (
            <p className="mt-3 text-sm text-gray-400">No trucks scheduled for today.</p>
          ) : (
            <>
              <p className="mt-2 text-3xl font-bold text-brand-700">
                {todayTrucks.dispatched}
                <span className="text-lg font-medium text-gray-400"> / {todayTrucks.total}</span>
              </p>
              <p className="mt-1 text-xs text-gray-400">dispatched so far</p>
            </>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">Transmittal Backlog</h2>
            <Link href="/transmittals" className="text-xs font-medium text-brand-600 hover:text-brand-700">
              Open →
            </Link>
          </div>
          {totalBacklog === 0 ? (
            <p className="mt-3 text-sm text-gray-400">Nothing waiting to be transmitted.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm text-gray-600">
              {transmittalBacklog.map((row) => (
                <li key={row.category} className="flex justify-between border-t border-gray-100 pt-1.5 first:border-0 first:pt-0">
                  <span>{row.label}</span>
                  <span className="font-medium text-gray-800">{row.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-gray-800">CTS Pass Rate — Recent Route Plans</h2>
            <Link href="/deliveries" className="text-sm font-medium text-brand-600 hover:text-brand-700">
              View Deliveries Fulfillment →
            </Link>
          </div>
          <div className="mt-4">
            <BarChart data={ctsTrend} maxValue={100} valueSuffix="%" emptyLabel="No CTS data yet for recent route plans." />
          </div>
        </div>

        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-gray-800">Delivery Variance Log Summary</h2>
            <Link href="/delivery-variance" className="text-sm font-medium text-brand-600 hover:text-brand-700">
              View Delivery Variance Log →
            </Link>
          </div>
          {topReason ? (
            <>
              <p className="mt-3 text-sm text-gray-500">Most frequent reason for returns/backloads</p>
              <p className="mt-1 text-2xl font-bold text-brand-700">{topReason.reason_label}</p>
              <p className="text-xs text-gray-400">
                {topReason.reason_type.replace("_", " ")} · {topReason.log_count} occurrence
                {topReason.log_count === 1 ? "" : "s"}
              </p>
              {topVarianceReasons.length > 1 && (
                <ul className="mt-4 space-y-1 text-sm text-gray-600">
                  {topVarianceReasons.slice(1).map((r) => (
                    <li key={r.reason_label} className="flex justify-between border-t border-gray-100 pt-1">
                      <span>{r.reason_label}</span>
                      <span className="text-gray-400">{r.log_count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-gray-400">No delivery variance logs recorded yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

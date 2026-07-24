"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  VFulfillmentSummary,
  VTruckCts,
  RoutePlanInvoice,
  Invoice,
  DeliveryReason,
  RoutePlanTruck,
  RoutePlan,
} from "@/types/database";

interface IssueRow extends RoutePlanInvoice {
  invoice: Invoice | null;
  reason: DeliveryReason | null;
  truck: (RoutePlanTruck & { route_plan: RoutePlan | null }) | null;
}

interface CtsRow extends VTruckCts {
  route_date: string | null;
}

export default function DeliveriesPage() {
  const [summary, setSummary] = useState<VFulfillmentSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);

  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [loadingIssues, setLoadingIssues] = useState(true);

  const [ctsRows, setCtsRows] = useState<CtsRow[]>([]);
  const [ctsError, setCtsError] = useState<string | null>(null);
  const [loadingCts, setLoadingCts] = useState(true);

  useEffect(() => {
    async function loadSummary() {
      setLoadingSummary(true);
      setSummaryError(null);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("v_fulfillment_summary")
          .select("*")
          .maybeSingle();

        if (error) {
          setSummaryError(
            "Could not load fulfillment summary. Connect a Supabase project to see live data."
          );
          setSummary(null);
        } else {
          setSummary(data ?? null);
        }
      } catch {
        setSummaryError(
          "Could not load fulfillment summary. Connect a Supabase project to see live data."
        );
        setSummary(null);
      } finally {
        setLoadingSummary(false);
      }
    }
    loadSummary();
  }, []);

  useEffect(() => {
    async function loadIssues() {
      setLoadingIssues(true);
      setIssuesError(null);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("route_plan_invoices")
          .select(
            "*, invoice:invoices(*), reason:delivery_reasons(*), truck:route_plan_trucks(*, route_plan:route_plans(*))"
          )
          .not("reason_id", "is", null)
          .order("created_at", { ascending: false });

        if (error) {
          setIssuesError(
            "Could not load delivery issues. Connect a Supabase project to see live data."
          );
          setIssues([]);
        } else {
          setIssues((data ?? []) as unknown as IssueRow[]);
        }
      } catch {
        setIssuesError(
          "Could not load delivery issues. Connect a Supabase project to see live data."
        );
        setIssues([]);
      } finally {
        setLoadingIssues(false);
      }
    }
    loadIssues();
  }, []);

  useEffect(() => {
    async function loadCts() {
      setLoadingCts(true);
      setCtsError(null);
      try {
        const supabase = createClient();
        const [{ data: cts, error: ctsErr }, { data: plans, error: plansErr }] =
          await Promise.all([
            supabase.from("v_truck_cts").select("*"),
            supabase.from("route_plans").select("*"),
          ]);

        if (ctsErr || plansErr) {
          setCtsError("Could not load CTS by truck. Connect a Supabase project to see live data.");
          setCtsRows([]);
          return;
        }

        const dateByPlan = new Map<string, string>();
        (plans ?? []).forEach((p) => {
          dateByPlan.set(p.id, p.route_date);
        });

        const merged: CtsRow[] = (cts ?? []).map((row) => ({
          ...row,
          route_date: row.route_plan_id ? dateByPlan.get(row.route_plan_id) ?? null : null,
        }));

        merged.sort((a, b) => (b.route_date ?? "").localeCompare(a.route_date ?? ""));
        setCtsRows(merged);
      } catch {
        setCtsError("Could not load CTS by truck. Connect a Supabase project to see live data.");
        setCtsRows([]);
      } finally {
        setLoadingCts(false);
      }
    }
    loadCts();
  }, []);

  const discrepancies = issues.filter((row) => row.reason?.type === "DISCREPANCY");
  const backloads = issues.filter((row) => row.reason?.type === "BACKLOAD");

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-800">Deliveries Fulfillment</h1>
      <p className="mt-1 text-sm text-gray-500">
        Track delivered, discrepancy, and backload counts, and cost efficiency per truck.
      </p>

      {summaryError && <p className="mt-4 text-sm text-gray-400">{summaryError}</p>}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card">
          <p className="text-sm font-medium text-gray-500">Delivered</p>
          <p className="mt-2 text-3xl font-bold text-green-600">
            {loadingSummary ? "…" : summary?.delivered_count ?? 0}
          </p>
        </div>
        <div className="card">
          <p className="text-sm font-medium text-gray-500">Discrepancy</p>
          <p className="mt-2 text-3xl font-bold text-amber-600">
            {loadingSummary ? "…" : summary?.discrepancy_count ?? 0}
          </p>
        </div>
        <div className="card">
          <p className="text-sm font-medium text-gray-500">Backload</p>
          <p className="mt-2 text-3xl font-bold text-red-600">
            {loadingSummary ? "…" : summary?.backload_count ?? 0}
          </p>
        </div>
        <div className="card">
          <p className="text-sm font-medium text-gray-500">Fulfillment Rate</p>
          <p className="mt-2 text-3xl font-bold text-brand-700">
            {loadingSummary
              ? "…"
              : summary?.fulfillment_rate_pct !== null &&
                  summary?.fulfillment_rate_pct !== undefined
                ? `${summary.fulfillment_rate_pct}%`
                : "—"}
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-800">Discrepancy Issues</h2>
          {loadingIssues && <p className="mt-3 text-sm text-gray-400">Loading…</p>}
          {!loadingIssues && issuesError && (
            <p className="mt-3 text-sm text-gray-400">{issuesError}</p>
          )}
          {!loadingIssues && !issuesError && discrepancies.length === 0 && (
            <p className="mt-3 text-sm text-gray-400">No discrepancy issues reported.</p>
          )}
          {!loadingIssues && !issuesError && discrepancies.length > 0 && (
            <ul className="mt-3 divide-y divide-gray-100 text-sm">
              {discrepancies.map((row) => (
                <li key={row.id} className="py-2">
                  <p className="font-medium text-gray-800">{row.invoice?.document_no ?? "—"}</p>
                  <p className="text-gray-500">
                    {row.invoice?.company_name_raw ?? "—"} · {row.invoice?.branch_address ?? "—"}
                  </p>
                  <p className="text-gray-500">
                    Amount:{" "}
                    {(row.invoice?.amount ?? 0).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    · Reason: {row.reason?.label ?? "—"}
                  </p>
                  <p className="text-xs text-gray-400">
                    Truck {row.truck?.plate_number ?? "—"} · Route{" "}
                    {row.truck?.route_plan?.route_date ?? "—"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-gray-800">Backload Issues</h2>
          {loadingIssues && <p className="mt-3 text-sm text-gray-400">Loading…</p>}
          {!loadingIssues && issuesError && (
            <p className="mt-3 text-sm text-gray-400">{issuesError}</p>
          )}
          {!loadingIssues && !issuesError && backloads.length === 0 && (
            <p className="mt-3 text-sm text-gray-400">No backload issues reported.</p>
          )}
          {!loadingIssues && !issuesError && backloads.length > 0 && (
            <ul className="mt-3 divide-y divide-gray-100 text-sm">
              {backloads.map((row) => (
                <li key={row.id} className="py-2">
                  <p className="font-medium text-gray-800">{row.invoice?.document_no ?? "—"}</p>
                  <p className="text-gray-500">
                    {row.invoice?.company_name_raw ?? "—"} · {row.invoice?.branch_address ?? "—"}
                  </p>
                  <p className="text-gray-500">
                    Amount:{" "}
                    {(row.invoice?.amount ?? 0).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    · Reason: {row.reason?.label ?? "—"}
                  </p>
                  <p className="text-xs text-gray-400">
                    Truck {row.truck?.plate_number ?? "—"} · Route{" "}
                    {row.truck?.route_plan?.route_date ?? "—"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card mt-6">
        <h2 className="text-lg font-semibold text-gray-800">CTS by Truck</h2>
        {loadingCts && <p className="mt-3 text-sm text-gray-400">Loading…</p>}
        {!loadingCts && ctsError && <p className="mt-3 text-sm text-gray-400">{ctsError}</p>}
        {!loadingCts && !ctsError && ctsRows.length === 0 && (
          <p className="mt-3 text-sm text-gray-400">No trucks with assigned invoices yet.</p>
        )}
        {!loadingCts && !ctsError && ctsRows.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                  <th className="py-2 pr-4">Route Date</th>
                  <th className="py-2 pr-4">Plate #</th>
                  <th className="py-2 pr-4">Truck Rate</th>
                  <th className="py-2 pr-4">Total Invoice Amount</th>
                  <th className="py-2 pr-4">CTS %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ctsRows.map((row) => (
                  <tr key={row.truck_id}>
                    <td className="py-2 pr-4">{row.route_date ?? "—"}</td>
                    <td className="py-2 pr-4 font-medium text-gray-800">
                      {row.plate_number ?? "—"}
                    </td>
                    <td className="py-2 pr-4">
                      {(row.truck_rate ?? 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="py-2 pr-4">
                      {(row.total_invoice_amount ?? 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="py-2 pr-4">
                      {row.cts_pct !== null && row.cts_pct !== undefined ? `${row.cts_pct}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

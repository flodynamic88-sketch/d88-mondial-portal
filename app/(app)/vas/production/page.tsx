"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import RequireRole from "@/components/RequireRole";
import VasCrudTable, { VasCrudColumn } from "@/components/vas/VasCrudTable";
import { useAuth } from "@/components/AuthProvider";
import { createClient } from "@/lib/vas/supabase/client";
import type { VasProductionBatch, VasProductionProgress } from "@/lib/vas/types";

const BATCH_STATUS_OPTIONS = ["IN_PROGRESS", "COMPLETED"];

const emptyBatch: Omit<VasProductionBatch, "id"> = {
  batch_no: "",
  batch_date: "",
  memo_item_id: "",
  manpower_count: null,
  manpower_cost: 0,
  qty_produced: 0,
  status: "IN_PROGRESS",
  remarks: null,
  created_by: null,
  created_at: "",
  updated_at: "",
};

const peso = (n: number) =>
  `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface MemoItemOption {
  id: string;
  qty_requested: number;
  kit_no: string;
  kit_description: string | null;
  memo_no: string;
  client_name: string;
}

export default function VasProductionPage() {
  const profile = useAuth();
  const canDelete = profile?.role === "ADMIN" || profile?.role === "VAS_MANAGER";
  const [memoItemOptions, setMemoItemOptions] = useState<MemoItemOption[]>([]);
  const [progress, setProgress] = useState<VasProductionProgress[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    const supabase = createClient();
    supabase
      .schema("vas")
      .from("memo_items")
      .select("id, qty_requested, kit_boms(kit_no, description), memos(memo_no, client_name)")
      .then(({ data }) => {
        const rows = (data as any[]) || [];
        setMemoItemOptions(
          rows.map((r) => ({
            id: r.id,
            qty_requested: r.qty_requested,
            kit_no: r.kit_boms?.kit_no ?? "?",
            kit_description: r.kit_boms?.description ?? null,
            memo_no: r.memos?.memo_no ?? "?",
            client_name: r.memos?.client_name ?? "",
          }))
        );
      });

    supabase
      .schema("vas")
      .from("v_production_progress")
      .select("*")
      .order("batch_date", { ascending: false })
      .then(({ data }) => setProgress((data as VasProductionProgress[]) || []));
  }, [refreshKey]);

  const memoItemFkOptions = useMemo(
    () =>
      memoItemOptions.map((o) => ({
        value: o.id,
        label: `${o.memo_no} · Kit ${o.kit_no} (target ${o.qty_requested})${o.client_name ? " — " + o.client_name : ""}`,
      })),
    [memoItemOptions]
  );

  const columns: VasCrudColumn<VasProductionBatch>[] = [
    { key: "batch_no", label: "Batch No.", required: true },
    { key: "batch_date", label: "Batch Date", type: "date", required: true },
    { key: "memo_item_id", label: "Memo / Kit Line", type: "fk", fkOptions: memoItemFkOptions, required: true },
    { key: "manpower_count", label: "Manpower", type: "number" },
    { key: "manpower_cost", label: "Manpower Cost", type: "number" },
    { key: "qty_produced", label: "Qty Produced", type: "number", required: true },
    { key: "status", label: "Status", type: "select", options: BATCH_STATUS_OPTIONS },
    { key: "remarks", label: "Remarks", type: "textarea" },
  ];

  // Latest progress row per memo line (window function already gives the
  // running cumulative as of each batch, so the most recent batch_date row
  // per memo_item_id is each line's current standing).
  const latestPerLine = useMemo(() => {
    const byLine = new Map<string, VasProductionProgress>();
    for (const row of progress) {
      const existing = byLine.get(row.memo_item_id);
      if (!existing || row.batch_date > existing.batch_date) byLine.set(row.memo_item_id, row);
    }
    return Array.from(byLine.values());
  }, [progress]);

  return (
    <RequireRole roles={["ADMIN", "VAS_MANAGER", "VAS_OFFICER"]}>
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          One row per kitting run (e.g. &quot;Batch 1 - Nov 18&quot;) against a specific memo/kit line.
          Editing Qty Produced only posts the incremental difference to stock, so correcting a batch
          later never double-counts.
        </p>

        <div className="card flex flex-wrap items-end gap-3 p-4">
          <div>
            <label className="label">Report Date</label>
            <input
              className="input"
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
            />
          </div>
          <Link
            href={`/vas/production-report/print?date=${reportDate}`}
            className="btn-primary"
          >
            Print Daily Report
          </Link>
          <p className="text-xs text-gray-400 max-w-sm">
            Shows every kit line with a batch logged on the selected date — target, completed today,
            completed previously, total to date, and balance remaining.
          </p>
        </div>

        <VasCrudTable
          tableName="production_batches"
          title="VAS Production Batches"
          columns={columns}
          defaultOrder="batch_date"
          ascending={false}
          emptyRow={emptyBatch}
          searchPlaceholder="Search batch no…"
          canDelete={canDelete}
          onAfterSave={() => setRefreshKey((k) => k + 1)}
        />

        <div className="card overflow-x-auto">
          <div className="border-b border-gray-100 p-4">
            <h2 className="text-sm font-semibold text-gray-700">Progress per Kit Line (current standing)</h2>
          </div>
          <table className="table-base">
            <thead>
              <tr>
                <th>TSP No.</th>
                <th>Kit No.</th>
                <th>Target Qty</th>
                <th>Produced to Date</th>
                <th>Balance Remaining</th>
              </tr>
            </thead>
            <tbody>
              {latestPerLine.map((row) => (
                <tr key={row.memo_item_id}>
                  <td>{row.memo_no}</td>
                  <td>{row.kit_no}</td>
                  <td>{row.target_qty}</td>
                  <td>{row.cumulative_qty_to_date}</td>
                  <td>{Math.max(row.target_qty - row.cumulative_qty_to_date, 0)}</td>
                </tr>
              ))}
              {latestPerLine.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-sm text-gray-400">
                    No production logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card overflow-x-auto">
          <div className="border-b border-gray-100 p-4">
            <h2 className="text-sm font-semibold text-gray-700">Cost &amp; Profit per Kit Line (running total)</h2>
            <p className="mt-1 text-xs text-gray-400">
              Total Cost = Material (BOM components × Unit Cost) + Consumables allocated to this line&apos;s
              batches + Manpower Cost. Revenue = Selling Price/Unit × qty produced to date. Set Unit Cost on
              Item Master, Selling Price/Unit on Kit/BOM, and Manpower Cost per batch above for these to
              compute.
            </p>
          </div>
          <table className="table-base">
            <thead>
              <tr>
                <th>TSP No.</th>
                <th>Kit No.</th>
                <th>Material Cost</th>
                <th>Consumable Cost</th>
                <th>Manpower Cost</th>
                <th>Total Cost</th>
                <th>Revenue</th>
                <th>Profit</th>
              </tr>
            </thead>
            <tbody>
              {latestPerLine.map((row) => (
                <tr key={row.memo_item_id}>
                  <td>{row.memo_no}</td>
                  <td>{row.kit_no}</td>
                  <td>{peso(row.cumulative_material_cost ?? 0)}</td>
                  <td>{peso(row.cumulative_consumable_cost ?? 0)}</td>
                  <td>{peso(row.cumulative_manpower_cost ?? 0)}</td>
                  <td className="font-medium">{peso(row.cumulative_total_cost ?? 0)}</td>
                  <td>{peso(row.cumulative_revenue ?? 0)}</td>
                  <td className={(row.cumulative_profit ?? 0) < 0 ? "text-red-600 font-medium" : "text-green-700 font-medium"}>
                    {peso(row.cumulative_profit ?? 0)}
                  </td>
                </tr>
              ))}
              {latestPerLine.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-sm text-gray-400">
                    No production logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </RequireRole>
  );
}

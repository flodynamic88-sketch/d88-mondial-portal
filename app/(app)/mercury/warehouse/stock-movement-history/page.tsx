"use client";

/**
 * Stock Card Report — classic Beginning Inventory / IN / OUT / Ending
 * Inventory ledger, one card per item, for a selected client + month.
 *
 * Reads:
 *   - get_inventory_report(client_id, date_from, date_to) — a stable RPC
 *     function (migration_027) giving beginning_balance / stock_in /
 *     stock_out / ending_balance per item for the period.
 *   - v_stock_movement_ledger (migration_027) — one row per stock
 *     movement, resolved to a real document number, a real document date,
 *     and a human party/reason string, plus a running balance per item
 *     computed across ALL movements ever (so the running balance on the
 *     latest movement always equals items.current_stock).
 *
 * When a specific Client is selected, a "Print Monthly Report" button
 * jumps to the polished, client-ready print page for that client + month
 * — for filing as a hard copy.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, Item, InventoryReportRow, StockMovementRow } from "@/lib/mercury/types";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i);
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function qty(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(n || 0);
}

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export default function StockMovementHistoryPage() {
  const router = useRouter();
  const now = new Date();

  const [clients, setClients] = useState<Client[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [reportRows, setReportRows] = useState<InventoryReportRow[]>([]);
  const [ledgerRows, setLedgerRows] = useState<StockMovementRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [clientId, setClientId] = useState("");
  const [itemId, setItemId] = useState("");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .schema("flo").from("clients")
      .select("*")
      .eq("manages_inventory", true)
      .order("client_code")
      .then(({ data }) => setClients((data as Client[]) || []));
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let query = supabase.schema("flo").from("items").select("*").eq("status", "Active").order("item_code");
    if (clientId) query = query.eq("client_id", clientId);
    query.then(({ data }) => setItems((data as Item[]) || []));
    setItemId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const dateFrom = `${year}-${String(month).padStart(2, "0")}-01`;
  const dateTo = `${year}-${String(month).padStart(2, "0")}-${String(
    lastDayOfMonth(year, month)
  ).padStart(2, "0")}`;

  useEffect(() => {
    if (!clientId) {
      setReportRows([]);
      setLedgerRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createClient();

    Promise.all([
      supabase.schema("flo").rpc("get_inventory_report", {
        p_client_id: clientId,
        p_date_from: dateFrom,
        p_date_to: dateTo,
      }),
      supabase
        .schema("flo").from("v_stock_movement_ledger")
        .select("*")
        .eq("client_id", clientId)
        .gte("movement_date", dateFrom)
        .lte("movement_date", dateTo)
        .order("item_code", { ascending: true })
        .order("created_at", { ascending: true }),
    ]).then(([reportRes, ledgerRes]) => {
      if (reportRes.error) setError(reportRes.error.message);
      else if (ledgerRes.error) setError(ledgerRes.error.message);

      let report = (reportRes.data as InventoryReportRow[]) || [];
      let ledger = (ledgerRes.data as StockMovementRow[]) || [];
      if (itemId) {
        report = report.filter((r) => r.item_id === itemId);
        ledger = ledger.filter((r) => r.item_id === itemId);
      }
      setReportRows(report);
      setLedgerRows(ledger);
      setLoading(false);
    });
  }, [clientId, itemId, dateFrom, dateTo]);

  const ledgerByItem = useMemo(() => {
    const map = new Map<string, StockMovementRow[]>();
    for (const r of ledgerRows) {
      const arr = map.get(r.item_id) || [];
      arr.push(r);
      map.set(r.item_id, arr);
    }
    return map;
  }, [ledgerRows]);

  const totals = useMemo(() => {
    const totalIn = reportRows.reduce((s, r) => s + (r.stock_in || 0), 0);
    const totalOut = reportRows.reduce((s, r) => s + (r.stock_out || 0), 0);
    return { totalIn, totalOut, net: totalIn - totalOut, itemCount: reportRows.length };
  }, [reportRows]);

  function handlePrint() {
    if (!clientId) return;
    const params = new URLSearchParams({ clientId, year: String(year), month: String(month) });
    if (itemId) params.set("itemId", itemId);
    router.push(`/mercury/reports/stock-movement-history/print?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Stock Card Report</h1>
          <p className="text-sm text-gray-500">
            Beginning Inventory → Stock In / Out → Ending Inventory, per item, per month.
          </p>
        </div>
        <button className="btn-primary" onClick={handlePrint} disabled={!clientId}>
          Print Monthly Report
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="card p-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label">Client</label>
          <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">— Pumili ng client —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.client_code} — {c.client_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Item</label>
          <select className="input" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">All items</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.item_code} — {it.item_description}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Month</label>
          <select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, idx) => (
              <option key={m} value={idx + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Year</label>
          <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!clientId ? (
        <div className="text-sm text-gray-400">Pumili ng client para makita ang stock card.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="card p-3">
              <div className="text-xs text-gray-400 uppercase tracking-wide">Total IN</div>
              <div className="text-xl font-bold text-green-700">+{qty(totals.totalIn)}</div>
            </div>
            <div className="card p-3">
              <div className="text-xs text-gray-400 uppercase tracking-wide">Total OUT</div>
              <div className="text-xl font-bold text-red-700">-{qty(totals.totalOut)}</div>
            </div>
            <div className="card p-3">
              <div className="text-xs text-gray-400 uppercase tracking-wide">Net Change</div>
              <div className={`text-xl font-bold ${totals.net >= 0 ? "text-brand-dark" : "text-red-700"}`}>
                {totals.net >= 0 ? "+" : ""}
                {qty(totals.net)}
              </div>
            </div>
            <div className="card p-3">
              <div className="text-xs text-gray-400 uppercase tracking-wide">Items</div>
              <div className="text-xl font-bold text-gray-800">{totals.itemCount}</div>
            </div>
          </div>

          {loading ? (
            <div className="card p-6 text-sm text-gray-400">Loading…</div>
          ) : reportRows.length === 0 ? (
            <div className="card p-6 text-sm text-gray-400">Walang item para sa filter na ito.</div>
          ) : (
            <div className="space-y-4">
              {reportRows.map((item) => {
                const movements = ledgerByItem.get(item.item_id) || [];
                const isLow = item.reorder_pt != null && item.ending_balance <= item.reorder_pt;
                return (
                  <div key={item.item_id} className="card overflow-x-auto">
                    <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-200">
                      <div>
                        <div className="font-semibold text-gray-900">
                          {item.item_code} — {item.item_description}
                        </div>
                        <div className="text-xs text-gray-500">
                          {item.category ? `${item.category} · ` : ""}
                          Unit: {item.unit || "—"}
                        </div>
                      </div>
                      {isLow && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          LOW STOCK
                        </span>
                      )}
                    </div>
                    <table className="table-base">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Document #</th>
                          <th>Details</th>
                          <th>Expiration</th>
                          <th className="text-right">IN</th>
                          <th className="text-right">OUT</th>
                          <th className="text-right">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="bg-gray-50 font-medium">
                          <td colSpan={6}>Beginning Inventory</td>
                          <td className="text-right">{qty(item.beginning_balance)}</td>
                        </tr>
                        {movements.map((r) => (
                          <tr key={r.movement_id} className="hover:bg-gray-50">
                            <td>{formatDate(r.document_date || r.movement_date)}</td>
                            <td>{r.document_number || "—"}</td>
                            <td>{r.party_or_reason || r.movement_type}</td>
                            <td>{r.expiration_date ? formatDate(r.expiration_date) : "—"}</td>
                            <td className="text-right text-green-700">
                              {r.direction === "IN" ? `+${qty(r.abs_qty)}` : ""}
                            </td>
                            <td className="text-right text-red-700">
                              {r.direction === "OUT" ? `-${qty(r.abs_qty)}` : ""}
                            </td>
                            <td className="text-right">{qty(r.running_balance)}</td>
                          </tr>
                        ))}
                        <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                          <td colSpan={6}>Ending Inventory</td>
                          <td className="text-right">{qty(item.ending_balance)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

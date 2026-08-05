"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, Item, ItemsDeliveredSummaryRow } from "@/lib/mercury/types";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i);

export default function ItemsDeliveredSummaryPage() {
  const [rows, setRows] = useState<ItemsDeliveredSummaryRow[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [clientId, setClientId] = useState("");
  const [itemId, setItemId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    let query = supabase.schema("flo").from("items").select("*").order("item_description");
    if (clientId) query = query.eq("client_id", clientId);
    query.then(({ data }) => setItems((data as Item[]) || []));
  }, [clientId]);

  useEffect(() => {
    const supabase = createClient();
    setLoading(true);
    let query = supabase
      .schema("flo").from("v_items_delivered_summary")
      .select("*")
      .eq("delivery_year", year)
      .order("delivery_month_num", { ascending: true })
      .order("client_name", { ascending: true })
      .order("item_description", { ascending: true });
    if (clientId) query = query.eq("client_id", clientId);
    if (itemId) query = query.eq("item_id", itemId);

    query.then(({ data, error }) => {
      if (error) setError(error.message);
      setRows((data as ItemsDeliveredSummaryRow[]) || []);
      setLoading(false);
    });
  }, [year, clientId, itemId]);

  const grandTotal = useMemo(
    () => rows.reduce((s, r) => s + (r.total_net_qty_delivered || 0), 0),
    [rows]
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Items Delivered Summary</h1>
        <p className="text-sm text-gray-500">
          Delivered quantity per item, per client, per month — for tracing how many units were
          delivered in a given month.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="card p-4 flex flex-wrap gap-3">
        <div>
          <label className="label">Year</label>
          <select
            className="input"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Client</label>
          <select
            className="input"
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setItemId("");
            }}
          >
            <option value="">All Clients</option>
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
            <option value="">All Items</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.item_description}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">No data for the selected filters.</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Month</th>
                <th>Client Code</th>
                <th>Client Name</th>
                <th>Item Code</th>
                <th>Item Description</th>
                <th># Deliveries</th>
                <th>Qty Delivered</th>
                <th>Qty Returned</th>
                <th>Net Qty Delivered</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx}>
                  <td>{r.delivery_month_label}</td>
                  <td>{r.client_code}</td>
                  <td>{r.client_name}</td>
                  <td>{r.item_code}</td>
                  <td>{r.item_description}</td>
                  <td>{r.delivery_count}</td>
                  <td>{r.total_qty_delivered}</td>
                  <td>{r.total_qty_returned}</td>
                  <td>{r.total_net_qty_delivered}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold bg-gray-50">
                <td colSpan={8} className="text-right">
                  Grand Total (Net Qty Delivered):
                </td>
                <td>{grandTotal}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, StockReceiptFull } from "@/lib/mercury/types";
import { useRole } from "@/lib/mercury/RoleContext";

function peso(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(n || 0);
}

export default function StockReceivingListPage() {
  const role = useRole();
  const canEncode = role !== "general_manager";

  const [rows, setRows] = useState<StockReceiptFull[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [clientId, setClientId] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    let query = supabase
      .schema("flo").from("v_stock_receipts_full")
      .select("*")
      .order("date_received", { ascending: false });
    if (clientId) query = query.eq("client_id", clientId);

    const { data, error } = await query;
    if (error) setError(error.message);
    setRows((data as StockReceiptFull[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    const supabase = createClient();
    supabase
      .schema("flo").from("clients")
      .select("*")
      .eq("manages_inventory", true)
      .order("client_code")
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setClients((data as Client[]) || []);
      });
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function handleDelete(receiptId: string) {
    if (!canEncode) return;
    if (
      !confirm(
        "Delete this entire stock receipt? This will remove all its lines and reverse the stock they added out of current stock. You can then re-encode it from scratch."
      )
    )
      return;
    setDeletingId(receiptId);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.schema("flo").from("stock_receipts").delete().eq("id", receiptId);
    setDeletingId(null);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Stock Receiving</h1>
          <p className="text-sm text-gray-500">{rows.length} receipt(s)</p>
        </div>
        <div className="flex gap-2">
          <Link href="/mercury/inventory" className="btn-secondary">
            Back to Inventory
          </Link>
          {canEncode && (
            <Link href="/mercury/inventory/receiving/new" className="btn-primary">
              + New Stock Receipt
            </Link>
          )}
        </div>
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
            <option value="">All</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.client_code} — {c.client_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">No stock receipts found.</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Date Received</th>
                <th>Invoice #</th>
                <th>Invoice Date</th>
                <th>Client</th>
                <th>Lines</th>
                <th>Total Qty</th>
                <th>Total Amount</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td>{r.date_received || "—"}</td>
                  <td>{r.invoice_number || "—"}</td>
                  <td>{r.invoice_date || "—"}</td>
                  <td>{r.client_name || "—"}</td>
                  <td>{r.line_count ?? 0}</td>
                  <td>{r.total_qty ?? 0}</td>
                  <td>{peso(r.total_amount)}</td>
                  <td className="space-x-2 whitespace-nowrap">
                    <Link
                      href={`/mercury/inventory/receiving/${r.id}`}
                      className="text-brand-dark hover:underline text-xs font-medium"
                    >
                      View
                    </Link>
                    {canEncode && (
                      <button
                        className="text-red-600 hover:underline text-xs font-medium"
                        onClick={() => handleDelete(r.id)}
                        disabled={deletingId === r.id}
                      >
                        Delete
                      </button>
                    )}
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

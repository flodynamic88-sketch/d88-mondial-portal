"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { StockRequestLine } from "@/lib/mercury/types";
import { useRole } from "@/lib/mercury/RoleContext";

function statusBadgeClass(status: string) {
  switch (status) {
    case "Open":
      return "bg-blue-100 text-blue-700";
    case "Fulfilled":
      return "bg-green-100 text-green-700";
    case "Cancelled":
      return "bg-gray-100 text-gray-500";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

interface RequestHeaderJoined {
  id: string;
  request_number: string;
  client_id: string | null;
  request_date: string | null;
  delivery_date_requested: string | null;
  delivery_schedule_note: string | null;
  status: string;
  notes: string | null;
  clients?: { id: string; client_code: string; client_name: string } | null;
}

export default function StockRequestDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const role = useRole();
  const readOnly = role === "general_manager";

  const [header, setHeader] = useState<RequestHeaderJoined | null>(null);
  const [lines, setLines] = useState<StockRequestLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const [headerRes, linesRes] = await Promise.all([
      supabase
        .schema("flo").from("stock_requests")
        .select("*, clients(id, client_code, client_name)")
        .eq("id", id)
        .single(),
      supabase
        .schema("flo").from("stock_request_lines")
        .select("*, items(id, item_code, item_description, unit)")
        .eq("request_id", id)
        .order("created_at"),
    ]);

    if (headerRes.error) setError(headerRes.error.message);
    setHeader((headerRes.data as unknown as RequestHeaderJoined) || null);
    setLines((linesRes.data as unknown as StockRequestLine[]) || []);

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function updateStatus(newStatus: string, confirmMsg?: string) {
    if (readOnly || !header) return;
    if (confirmMsg && !confirm(confirmMsg)) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .schema("flo").from("stock_requests")
      .update({ status: newStatus })
      .eq("id", id);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  if (loading) return <div className="text-sm text-gray-400">Loading…</div>;
  if (!header) return <div className="text-sm text-red-600">Purchase Order not found.</div>;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            Purchase Order — {header.request_number}
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(
                header.status
              )}`}
            >
              {header.status}
            </span>
          </h1>
          <p className="text-sm text-gray-500">
            {header.clients?.client_name || "—"}
            {readOnly && <span className="ml-2 text-gray-400">&middot; View only</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/mercury/stock-requests/${id}/print`} className="btn-secondary">
            Print
          </Link>
          {!readOnly && header.status === "Open" && (
            <button
              className="btn-secondary"
              onClick={() => updateStatus("Fulfilled", "Mark this request as Fulfilled?")}
              disabled={saving}
            >
              Mark Fulfilled
            </button>
          )}
          {!readOnly && header.status === "Open" && (
            <button
              className="btn-secondary"
              onClick={() => updateStatus("Cancelled", "Cancel this Purchase Order?")}
              disabled={saving}
            >
              Cancel
            </button>
          )}
          {!readOnly && (header.status === "Fulfilled" || header.status === "Cancelled") && (
            <button
              className="btn-secondary"
              onClick={() => updateStatus("Open")}
              disabled={saving}
            >
              Reopen
            </button>
          )}
          <button className="btn-secondary" onClick={() => router.push("/mercury/stock-requests")}>
            Back to List
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Header Info</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label">Client (Supplier)</label>
            <input
              className="input bg-gray-50"
              readOnly
              value={`${header.clients?.client_code || ""} — ${header.clients?.client_name || ""}`}
            />
          </div>
          <div>
            <label className="label">Request Date</label>
            <input className="input bg-gray-50" readOnly value={header.request_date || ""} />
          </div>
          <div>
            <label className="label">Delivery Date Requested</label>
            <input
              className="input bg-gray-50"
              readOnly
              value={header.delivery_date_requested || ""}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className="label">Delivery Schedule Note</label>
            <input
              className="input bg-gray-50"
              readOnly
              value={header.delivery_schedule_note || ""}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className="label">Notes</label>
            <input className="input bg-gray-50" readOnly value={header.notes || ""} />
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Item Lines</h2>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.items?.item_code} — {l.item_description}
                  </td>
                  <td>{l.qty}</td>
                  <td>{l.unit || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

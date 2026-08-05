"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import PhotoAttachments from "@/components/mercury/MercuryPhotoAttachments";
import type { StockReceipt, StockReceiptLine } from "@/lib/mercury/types";
import { useRole } from "@/lib/mercury/RoleContext";

interface ReceiptHeaderJoined extends StockReceipt {
  clients?: { id: string; client_code: string; client_name: string } | null;
}

function peso(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(n || 0);
}

export default function StockReceiptDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const role = useRole();
  const readOnly = role === "general_manager";

  const [header, setHeader] = useState<ReceiptHeaderJoined | null>(null);
  const [lines, setLines] = useState<StockReceiptLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<Partial<StockReceipt>>({});
  const [lineEdits, setLineEdits] = useState<Record<string, Partial<StockReceiptLine>>>({});

  async function load() {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const [headerRes, linesRes] = await Promise.all([
      supabase
        .schema("flo").from("stock_receipts")
        .select("*, clients(id, client_code, client_name)")
        .eq("id", id)
        .single(),
      supabase
        .schema("flo").from("stock_receipt_lines")
        .select("*, items(id, item_code, item_description, unit)")
        .eq("receipt_id", id)
        .order("created_at"),
    ]);

    if (headerRes.error) setError(headerRes.error.message);
    const headerData = (headerRes.data as unknown as ReceiptHeaderJoined) || null;
    setHeader(headerData);
    setForm(headerData || {});
    setLines((linesRes.data as unknown as StockReceiptLine[]) || []);

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const totalQty = lines.reduce((s, l) => s + (l.qty || 0), 0);
  const totalAmount = lines.reduce((s, l) => s + (l.amount || 0), 0);

  async function handleSaveHeader() {
    if (readOnly) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .schema("flo").from("stock_receipts")
      .update({
        invoice_number: form.invoice_number || null,
        invoice_date: form.invoice_date || null,
        date_received: form.date_received || null,
        notes: form.notes || null,
      })
      .eq("id", id);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  async function saveAttachments(urls: string[]) {
    if (readOnly) return;
    const supabase = createClient();
    const { error } = await supabase.schema("flo").from("stock_receipts").update({ attachment_urls: urls }).eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    setForm((prev) => ({ ...prev, attachment_urls: urls }));
    setHeader((prev) => (prev ? { ...prev, attachment_urls: urls } : prev));
  }

  function updateLineEdit(lineId: string, patch: Partial<StockReceiptLine>) {
    setLineEdits((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  }

  async function handleSaveLine(lineId: string) {
    if (readOnly) return;
    const edit = lineEdits[lineId];
    if (!edit) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const line = lines.find((l) => l.id === lineId);
    const { error } = await supabase
      .schema("flo").from("stock_receipt_lines")
      .update({
        qty: edit.qty ?? line?.qty,
        unit_price: edit.unit_price ?? line?.unit_price,
        expiration_date:
          edit.expiration_date !== undefined ? edit.expiration_date || null : line?.expiration_date,
      })
      .eq("id", lineId);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setLineEdits((prev) => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
    load();
  }

  async function handleDeleteLine(lineId: string) {
    if (readOnly) return;
    if (
      !confirm(
        "Remove this line? This will reverse the stock it added back out of current stock."
      )
    )
      return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.schema("flo").from("stock_receipt_lines").delete().eq("id", lineId);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  async function handleDeleteReceipt() {
    if (readOnly) return;
    if (
      !confirm(
        "Delete this entire stock receipt? This will remove all its lines and reverse the stock they added out of current stock. You can then re-encode it from scratch."
      )
    )
      return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.schema("flo").from("stock_receipts").delete().eq("id", id);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/mercury/inventory/receiving");
  }

  if (loading) return <div className="text-sm text-gray-400">Loading…</div>;
  if (!header) return <div className="text-sm text-red-600">Stock receipt not found.</div>;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Stock Receipt — {header.invoice_number || header.id.slice(0, 8)}
          </h1>
          <p className="text-sm text-gray-500">
            {header.clients?.client_name || "—"}
            {readOnly && <span className="ml-2 text-gray-400">&middot; View only</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {!readOnly && (
            <button
              className="btn-secondary text-red-600 border-red-300 hover:bg-red-50"
              onClick={handleDeleteReceipt}
              disabled={saving}
            >
              Delete Receipt
            </button>
          )}
          <button className="btn-secondary" onClick={() => router.push("/mercury/inventory/receiving")}>
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
            <label className="label">Client</label>
            <input
              className="input bg-gray-50"
              readOnly
              value={`${header.clients?.client_code || ""} — ${header.clients?.client_name || ""}`}
            />
          </div>
          <div>
            <label className="label">Invoice Number</label>
            <input
              className="input"
              value={form.invoice_number || ""}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Invoice Date</label>
            <input
              type="date"
              className="input"
              value={form.invoice_date || ""}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, invoice_date: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Date Received</label>
            <input
              type="date"
              className="input"
              value={form.date_received || ""}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, date_received: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className="label">Notes</label>
            <input
              className="input"
              value={form.notes || ""}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className="label">Photos (condition of stock on arrival)</label>
            <PhotoAttachments
              urls={form.attachment_urls || header?.attachment_urls || []}
              pathPrefix={`stock-receipts/${id}`}
              onChange={saveAttachments}
              readOnly={readOnly}
            />
          </div>
        </div>
        {!readOnly && (
          <button className="btn-primary" onClick={handleSaveHeader} disabled={saving}>
            {saving ? "Saving…" : "Save Header"}
          </button>
        )}
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Line Items</h2>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Item</th>
                <th>Unit</th>
                <th>Qty Received</th>
                <th>Unit Price</th>
                <th>Amount</th>
                <th>Expiration Date</th>
                {!readOnly && <th className="w-32"></th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const edit = lineEdits[l.id] || {};
                return (
                  <tr key={l.id}>
                    <td>
                      {l.items?.item_code} — {l.item_description}
                    </td>
                    <td>{l.unit || l.items?.unit || "—"}</td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="input w-24"
                        value={edit.qty ?? l.qty ?? 0}
                        disabled={readOnly}
                        onChange={(e) => updateLineEdit(l.id, { qty: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="input w-28"
                        value={edit.unit_price ?? l.unit_price ?? 0}
                        disabled={readOnly}
                        onChange={(e) =>
                          updateLineEdit(l.id, { unit_price: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td>
                      {peso(
                        Number(edit.qty ?? l.qty ?? 0) * Number(edit.unit_price ?? l.unit_price ?? 0)
                      )}
                    </td>
                    <td>
                      <input
                        type="date"
                        className="input w-36"
                        value={edit.expiration_date ?? l.expiration_date ?? ""}
                        disabled={readOnly}
                        onChange={(e) => updateLineEdit(l.id, { expiration_date: e.target.value })}
                      />
                    </td>
                    {!readOnly && (
                      <td className="space-x-2 whitespace-nowrap">
                        <button
                          className="text-brand-dark hover:underline text-xs font-medium"
                          onClick={() => handleSaveLine(l.id)}
                          disabled={saving || !lineEdits[l.id]}
                        >
                          Save
                        </button>
                        <button
                          className="text-red-600 hover:underline text-xs font-medium"
                          onClick={() => handleDeleteLine(l.id)}
                          disabled={saving}
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="text-right text-sm font-semibold text-gray-800 space-y-1">
          <div>Total Qty Received: {totalQty}</div>
          <div>Total Amount: {peso(totalAmount)}</div>
        </div>
      </div>
    </div>
  );
}

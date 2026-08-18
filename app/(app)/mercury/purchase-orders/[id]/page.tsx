"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { DeliveryHeaderFull, Item, PoLine, PurchaseOrder } from "@/lib/mercury/types";
import { useRole } from "@/lib/mercury/RoleContext";

function peso(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(n || 0);
}

function poStatusBadgeClass(status: string) {
  switch (status) {
    case "Open":
      return "bg-blue-100 text-blue-700";
    case "Used":
      return "bg-green-100 text-green-700";
    case "Cancelled":
      return "bg-gray-100 text-gray-500";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

interface PoHeaderJoined extends PurchaseOrder {
  clients?: { id: string; client_code: string; client_name: string } | null;
  branches?: { id: string; branch_code: string; branch_name: string } | null;
}

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const role = useRole();
  const readOnly = role === "general_manager";

  const [header, setHeader] = useState<PoHeaderJoined | null>(null);
  const [lines, setLines] = useState<PoLine[]>([]);
  const [linkedDelivery, setLinkedDelivery] = useState<DeliveryHeaderFull | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [newLineItemId, setNewLineItemId] = useState("");
  const [newLineQty, setNewLineQty] = useState<number>(1);
  const [newLineUnitPrice, setNewLineUnitPrice] = useState<number>(0);

  // silent=true skips the full-page "Loading…" state — used after adding/
  // removing a line item, where the header/table are already on screen.
  async function load(silent = false) {
    if (!silent) setLoading(true);
    setError(null);
    const supabase = createClient();

    const [headerRes, linesRes, itemsRes] = await Promise.all([
      supabase
        .schema("flo").from("purchase_orders")
        .select("*, clients(id, client_code, client_name), branches(id, branch_code, branch_name)")
        .eq("id", id)
        .single(),
      supabase
        .schema("flo").from("po_lines")
        .select("*, items(id, item_code, item_description, unit_price)")
        .eq("po_id", id)
        .order("created_at"),
      supabase.schema("flo").from("items").select("*").eq("status", "Active").order("item_code").range(0, 9999),
    ]);

    if (headerRes.error) setError(headerRes.error.message);
    const headerData = (headerRes.data as unknown as PoHeaderJoined) || null;
    setHeader(headerData);
    setLines((linesRes.data as unknown as PoLine[]) || []);
    setItems((itemsRes.data as Item[]) || []);

    if (headerData?.status === "Used") {
      const { data: delivery } = await supabase
        .schema("flo").from("v_delivery_headers_full")
        .select("*")
        .eq("po_id", id)
        .maybeSingle();
      setLinkedDelivery((delivery as DeliveryHeaderFull) || null);
    } else {
      setLinkedDelivery(null);
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const totalAmount = useMemo(() => lines.reduce((s, l) => s + (l.amount || 0), 0), [lines]);

  const availableItems = useMemo(() => {
    if (!header?.client_id) return items;
    return items.filter((i) => i.client_id === header.client_id || !i.client_id);
  }, [header, items]);

  async function handleAddLine() {
    if (readOnly || !header || header.status !== "Open" || !newLineItemId || newLineQty <= 0) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const item = availableItems.find((i) => i.id === newLineItemId);
    const { error } = await supabase.schema("flo").from("po_lines").insert({
      po_id: id,
      item_id: newLineItemId,
      item_description: item?.item_description || "",
      qty: newLineQty,
      unit_price: newLineUnitPrice,
    });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setNewLineItemId("");
    setNewLineQty(1);
    setNewLineUnitPrice(0);
    await load(true);
  }

  async function handleRemoveLine(lineId: string) {
    if (readOnly || !header || header.status !== "Open") return;
    if (!confirm("Remove this line item from the P.O.?")) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.schema("flo").from("po_lines").delete().eq("id", lineId);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    await load(true);
  }

  async function handleCancel() {
    if (readOnly || !header) return;
    if (!confirm("Cancel this Purchase Order? It will no longer be available to load into a Delivery.")) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .schema("flo").from("purchase_orders")
      .update({ status: "Cancelled" })
      .eq("id", id);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  async function handleReopen() {
    if (readOnly || !header) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .schema("flo").from("purchase_orders")
      .update({ status: "Open" })
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
            Purchase Order — {header.po_number}
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${poStatusBadgeClass(
                header.status
              )}`}
            >
              {header.status}
            </span>
          </h1>
          <p className="text-sm text-gray-500">
            {header.clients?.client_name || "—"} &middot; {header.branches?.branch_name || "—"}
            {readOnly && <span className="ml-2 text-gray-400">&middot; View only</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {!readOnly && header.status === "Open" && (
            <button className="btn-secondary" onClick={handleCancel} disabled={saving}>
              Cancel P.O.
            </button>
          )}
          {!readOnly && header.status === "Cancelled" && (
            <button className="btn-secondary" onClick={handleReopen} disabled={saving}>
              Reopen P.O.
            </button>
          )}
          <button className="btn-secondary" onClick={() => router.push("/mercury/purchase-orders")}>
            Back to List
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {linkedDelivery && (
        <div className="rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
          This P.O. has been used on delivery{" "}
          <Link href={`/mercury/deliveries/${linkedDelivery.id}`} className="font-medium underline">
            {linkedDelivery.invoice_number || linkedDelivery.id}
          </Link>
          .
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
            <label className="label">Branch</label>
            <input
              className="input bg-gray-50"
              readOnly
              value={
                header.branches
                  ? `${header.branches.branch_code} — ${header.branches.branch_name}`
                  : "—"
              }
            />
          </div>
          <div>
            <label className="label">P.O. Date</label>
            <input className="input bg-gray-50" readOnly value={header.po_date || ""} />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className="label">Notes</label>
            <input className="input bg-gray-50" readOnly value={header.notes || ""} />
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Line Items</h2>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit Price (VAT-incl.)</th>
                <th>Amount</th>
                {!readOnly && header.status === "Open" && <th className="w-16"></th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.items?.item_code} — {l.item_description}
                  </td>
                  <td>{l.qty}</td>
                  <td>{peso(l.unit_price)}</td>
                  <td>{peso(l.amount)}</td>
                  {!readOnly && header.status === "Open" && (
                    <td>
                      <button
                        type="button"
                        className="text-red-600 hover:underline text-xs font-medium"
                        onClick={() => handleRemoveLine(l.id)}
                        disabled={saving}
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-right text-sm font-semibold text-gray-800">
          Total Amount: {peso(totalAmount)}
        </div>
      </div>

      {!readOnly && header.status === "Open" && (
        <div className="card p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Add Line Item</h2>
            <p className="text-xs text-gray-500">
              Add more items to this P.O. while it&apos;s still Open (not yet loaded into a
              Delivery).
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <label className="label">Item</label>
              <select
                className="input"
                value={newLineItemId}
                onChange={(e) => {
                  const itemId = e.target.value;
                  setNewLineItemId(itemId);
                  const item = availableItems.find((i) => i.id === itemId);
                  setNewLineUnitPrice(item?.unit_price || 0);
                }}
              >
                <option value="">— Select Item —</option>
                {availableItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.item_code} — {i.item_description}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-24">
              <label className="label">Qty</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input"
                value={newLineQty}
                onChange={(e) => setNewLineQty(Number(e.target.value))}
              />
            </div>
            <div className="w-32">
              <label className="label">Unit Price</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input"
                value={newLineUnitPrice}
                onChange={(e) => setNewLineUnitPrice(Number(e.target.value))}
              />
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={handleAddLine}
              disabled={saving || !newLineItemId || newLineQty <= 0}
            >
              Add Item
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { DeliveryHeader, DeliveryLine, Item, LookupValue } from "@/lib/mercury/types";
import { useRole } from "@/lib/mercury/RoleContext";
import { deliveryStatusBadgeClass } from "@/lib/mercury/statusColors";

const DELIVERED_STATUSES = ["Delivered", "Delivered-Late"];

function peso(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(n || 0);
}

function formatDate(d: string | null | undefined) {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
}

// Priority for pre-filling the editable Expiration Date input below: (1)
// expiration_date typed in directly on this line — always available,
// regardless of whether the item's client uses the Warehouse module; (2)
// the FEFO warehouse batch(es) this line's stock was actually drawn from —
// only exists once stock is actually deducted (status -> In-Transit/
// Delivered) for a manages_inventory client; (3) a FEFO "preview" — the
// soonest-expiring batch currently available in the warehouse for that
// item. Whatever value pre-fills here can still be edited/overridden by
// the encoder and, once saved, becomes the authoritative expiration_date.
function derivedExpirationDate(line: DeliveryLine, previewExpiry?: Map<string, string>): string {
  if (line.expiration_date) return line.expiration_date;
  const dates = Array.from(
    new Set(
      (line.delivery_line_batches || [])
        .map((b) => b.expiration_date)
        .filter((d): d is string => !!d)
    )
  ).sort();
  if (dates.length > 0) return dates[0];
  const preview = line.item_id ? previewExpiry?.get(line.item_id) : undefined;
  return preview || "";
}

export default function DeliveryDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const role = useRole();
  const readOnly = role === "general_manager";

  const [header, setHeader] = useState<DeliveryHeader | null>(null);
  const [lines, setLines] = useState<DeliveryLine[]>([]);
  const [lookups, setLookups] = useState<LookupValue[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<Partial<DeliveryHeader>>({});
  const [lineEdits, setLineEdits] = useState<Record<string, Partial<DeliveryLine>>>({});
  // FEFO preview: soonest-expiring warehouse batch per item_id, used as a
  // fallback expirationLabel() before stock is actually deducted for a line
  // (see comment above expirationLabel).
  const [previewExpiry, setPreviewExpiry] = useState<Map<string, string>>(new Map());

  // Auto-save for line item edits (Qty Delivered / Qty Returned / Return
  // Reason / Expiration Date): typing in a field debounces a save ~700ms
  // after the user stops, and leaving the field (onBlur) flushes it
  // immediately — no more manual "Save" click needed per line.
  // lineEditsRef always mirrors the latest lineEdits so the debounce timer's
  // callback (which fires later, outside the render that scheduled it) never
  // reads a stale closure of lineEdits.
  const lineEditsRef = useRef<typeof lineEdits>({});
  useEffect(() => {
    lineEditsRef.current = lineEdits;
  }, [lineEdits]);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [savedLineId, setSavedLineId] = useState<string | null>(null);

  // New item-received line being added below (for Pickup invoices whose
  // client has manages_inventory = true — see "Add Item Received" section).
  const [newItemId, setNewItemId] = useState("");
  const [newItemQty, setNewItemQty] = useState<number>(1);

  // New line being added below (for regular Delivery invoices — e.g. the
  // header was created without any items yet — see "Add Line Item" section).
  const [newLineItemId, setNewLineItemId] = useState("");
  const [newLineQty, setNewLineQty] = useState<number>(1);
  const [newLineUnitPrice, setNewLineUnitPrice] = useState<number>(0);
  const [newLineExpirationDate, setNewLineExpirationDate] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const [headerRes, linesRes, lookupsRes, itemsRes] = await Promise.all([
      supabase
        .schema("flo").from("delivery_headers")
        .select(
          "*, clients(id, client_code, client_name, manages_inventory, service_rate), branches(id, branch_code, branch_name, delivery_address)"
        )
        .eq("id", id)
        .single(),
      // Deliberately does NOT embed delivery_line_batches here — that's a
      // separate relationship (added later, in migration_018) and if
      // PostgREST's schema cache ever hiccups on resolving it, embedding it
      // directly in this query would fail the WHOLE delivery_lines fetch,
      // which is exactly what made line items look like they "disappeared"
      // with no visible error before. Batches are fetched separately below
      // and merged in JS instead, so a batches problem can never blank out
      // the line items themselves.
      supabase
        .schema("flo").from("delivery_lines")
        .select("*, items(id, item_code, mercury_item_code, item_description, unit_price)")
        .eq("delivery_header_id", id)
        .order("created_at"),
      supabase
        .schema("flo").from("lookup_values")
        .select("*")
        .in("category", ["delivery_status", "priority_level", "carrier_truck", "return_reason"])
        .eq("is_active", true)
        .order("sort_order"),
      supabase.schema("flo").from("items").select("*").eq("status", "Active").order("item_code").range(0, 9999),
    ]);

    // NOTE: previously only headerRes.error was checked here — if the
    // delivery_lines fetch itself failed for any reason, the code silently
    // fell back to an empty [] with NO error shown, making it look like the
    // line items had "disappeared" when really the fetch never succeeded.
    // Now every one of the 4 fetches is checked so any failure is surfaced
    // instead of being swallowed.
    const firstError = [headerRes, linesRes, lookupsRes, itemsRes].find((r) => r.error)?.error;
    if (firstError) setError(firstError.message);
    setHeader((headerRes.data as unknown as DeliveryHeader) || null);
    setForm((headerRes.data as unknown as DeliveryHeader) || {});

    const lineRows = (linesRes.data as unknown as DeliveryLine[]) || [];
    if (lineRows.length > 0) {
      const { data: batchesData, error: batchesErr } = await supabase
        .schema("flo").from("delivery_line_batches")
        .select("id, delivery_line_id, qty, expiration_date")
        .in(
          "delivery_line_id",
          lineRows.map((l) => l.id)
        );
      // A batches-fetch problem is non-fatal — it only means expiration
      // dates won't show for this load; it must never blank out the line
      // items themselves (that's the actual bug being fixed here).
      if (!batchesErr && batchesData) {
        const byLine = new Map<string, typeof batchesData>();
        for (const b of batchesData) {
          const arr = byLine.get(b.delivery_line_id) || [];
          arr.push(b);
          byLine.set(b.delivery_line_id, arr);
        }
        for (const l of lineRows) {
          l.delivery_line_batches = (byLine.get(l.id) as unknown as DeliveryLine["delivery_line_batches"]) || [];
        }
      }
    }

    // FEFO preview: for lines whose stock hasn't been officially deducted
    // yet (so no delivery_line_batches row exists), look up the soonest-
    // expiring warehouse batch currently available for that item, so the
    // Expiration Date column isn't blank the whole time the delivery is
    // still Pending.
    const itemIds = Array.from(
      new Set(lineRows.map((l) => l.item_id).filter((v): v is string => !!v))
    );
    const preview = new Map<string, string>();
    if (itemIds.length > 0) {
      const { data: previewData } = await supabase
        .schema("flo").from("stock_receipt_lines")
        .select("item_id, expiration_date, qty_remaining")
        .in("item_id", itemIds)
        .gt("qty_remaining", 0)
        .not("expiration_date", "is", null)
        .order("expiration_date", { ascending: true });
      if (previewData) {
        for (const r of previewData as { item_id: string; expiration_date: string }[]) {
          if (!preview.has(r.item_id)) preview.set(r.item_id, r.expiration_date);
        }
      }
    }
    setPreviewExpiry(preview);

    setLines(lineRows);
    setLookups((lookupsRes.data as LookupValue[]) || []);
    setItems((itemsRes.data as Item[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Clear any pending debounced saves on unmount so a save never fires after
  // the user has already navigated away from this page.
  useEffect(() => {
    return () => {
      Object.values(saveTimers.current).forEach((t) => clearTimeout(t));
    };
  }, []);

  const statusOptions = lookups.filter((l) => l.category === "delivery_status");
  const priorityOptions = lookups.filter((l) => l.category === "priority_level");
  const carrierOptions = lookups.filter((l) => l.category === "carrier_truck");
  const returnReasonOptions = lookups.filter((l) => l.category === "return_reason");

  const totalAmount = useMemo(() => lines.reduce((s, l) => s + (l.amount || 0), 0), [lines]);
  const totalNet = useMemo(() => lines.reduce((s, l) => s + (l.net_amount || 0), 0), [lines]);

  // Pickup invoices for a manages_inventory client can have items received
  // added after the fact (e.g. Pickups encoded before this feature existed).
  // These add straight to warehouse stock and are saved with unit_price = 0
  // so they never change the fee already billed on this invoice.
  const tracksInventory =
    header?.transaction_type === "Pickup" && !!header?.clients?.manages_inventory;

  const availableItems = useMemo(() => {
    if (!header?.client_id) return items;
    return items.filter((i) => i.client_id === header.client_id || !i.client_id);
  }, [header, items]);

  async function handleSaveHeader() {
    if (readOnly) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();

    if (form.invoice_number && form.invoice_number.trim()) {
      const { data: dupInvoices } = await supabase
        .schema("flo").from("delivery_headers")
        .select("id")
        .eq("client_id", form.client_id)
        .ilike("invoice_number", form.invoice_number.trim())
        .neq("id", id)
        .limit(1);
      if (dupInvoices && dupInvoices.length > 0) {
        const proceed = confirm(
          `May ibang delivery na sa client na ito na may Invoice # "${form.invoice_number.trim()}". Sigurado ka bang i-save pa rin ito?`
        );
        if (!proceed) {
          setSaving(false);
          return;
        }
      }
    }

    const { error } = await supabase
      .schema("flo").from("delivery_headers")
      .update({
        po_number: form.po_number || null,
        invoice_number: form.invoice_number || null,
        invoice_date: form.invoice_date || null,
        posting_date: form.posting_date || null,
        date_of_delivery: form.date_of_delivery || null,
        status: form.status,
        priority: form.priority,
        service_rate_override:
          form.service_rate_override === null || form.service_rate_override === undefined
            ? null
            : Number(form.service_rate_override),
        remarks: form.remarks || null,
        truck_carrier: form.truck_carrier || null,
        return_status: form.return_status || null,
        date_returned: form.date_returned || null,
      })
      .eq("id", id);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  function updateLineEdit(lineId: string, patch: Partial<DeliveryLine>) {
    setLineEdits((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
    // Debounce: save automatically ~700ms after the user stops typing, so
    // editing Qty/Return Reason/Expiration Date no longer requires clicking
    // Save — it just saves itself.
    if (saveTimers.current[lineId]) clearTimeout(saveTimers.current[lineId]);
    saveTimers.current[lineId] = setTimeout(() => {
      flushLineSave(lineId);
    }, 700);
  }

  // Immediately save whatever is pending for this line (used by both the
  // debounce timer above and onBlur below), reading from lineEditsRef so it
  // always sees the latest edit even when called from a delayed timer.
  function flushLineSave(lineId: string) {
    if (saveTimers.current[lineId]) {
      clearTimeout(saveTimers.current[lineId]);
      delete saveTimers.current[lineId];
    }
    const edit = lineEditsRef.current[lineId];
    if (!edit) return;
    saveLineEdit(lineId, edit);
  }

  async function saveLineEdit(lineId: string, edit: Partial<DeliveryLine>) {
    if (readOnly) return;
    const original = lines.find((l) => l.id === lineId);
    setSavingLineId(lineId);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .schema("flo").from("delivery_lines")
      .update({
        qty_delivered: edit.qty_delivered,
        qty_returned: edit.qty_returned,
        return_reason: edit.return_reason,
        expiration_date:
          edit.expiration_date !== undefined
            ? edit.expiration_date || null
            : original?.expiration_date ?? null,
      })
      .eq("id", lineId);
    setSavingLineId(null);
    if (error) {
      setError(error.message);
      return;
    }
    setLineEdits((prev) => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
    setSavedLineId(lineId);
    setTimeout(() => setSavedLineId((cur) => (cur === lineId ? null : cur)), 1500);
    load();
  }

  async function handleAddItemLine() {
    if (readOnly || !newItemId || newItemQty <= 0) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const item = availableItems.find((i) => i.id === newItemId);
    try {
      const { error } = await supabase.schema("flo").from("delivery_lines").insert({
        delivery_header_id: id,
        item_id: newItemId,
        item_description: item?.item_description || "",
        qty: newItemQty,
        unit_price: 0,
        qty_delivered: newItemQty,
        qty_returned: 0,
      });
      if (error) {
        setError(error.message);
        return;
      }
      setNewItemId("");
      setNewItemQty(1);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong while adding the item.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveItemLine(lineId: string) {
    if (readOnly) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.schema("flo").from("delivery_lines").delete().eq("id", lineId);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  // Add a normal billable line item to a Delivery invoice that was created
  // without any (e.g. only the header was saved, or a line was removed by
  // mistake). Mirrors what the New Delivery page does: qty_delivered /
  // qty_returned start at 0, item_description is snapshotted, and if the
  // delivery is already In-Transit, the existing stock-effect trigger picks
  // this up automatically (deducts current_stock + FEFO) — same as any
  // other line insert.
  async function handleAddDeliveryLine() {
    if (readOnly || !newLineItemId || newLineQty <= 0) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const item = availableItems.find((i) => i.id === newLineItemId);
    try {
      const { error } = await supabase.schema("flo").from("delivery_lines").insert({
        delivery_header_id: id,
        item_id: newLineItemId,
        item_description: item?.item_description || "",
        qty: newLineQty,
        unit_price: newLineUnitPrice,
        qty_delivered: 0,
        qty_returned: 0,
        expiration_date: newLineExpirationDate || null,
      });
      if (error) {
        setError(error.message);
        return;
      }
      setNewLineItemId("");
      setNewLineQty(1);
      setNewLineUnitPrice(0);
      setNewLineExpirationDate("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong while adding the item.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteDelivery() {
    if (readOnly) return;
    if (
      !confirm(
        "Delete this entire delivery? This will remove all its line items and reverse any stock it deducted/added out of current stock. This cannot be undone."
      )
    )
      return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.schema("flo").from("delivery_headers").delete().eq("id", id);
    if (error) {
      setSaving(false);
      setError(error.message);
      return;
    }
    // If this delivery was created via "Load from P.O.", that P.O. was marked
    // status = "Used" at the time (see New Delivery page) so it wouldn't be
    // offered again. Now that the delivery referencing it is gone, put the
    // P.O. back to "Open" so it re-appears in the "Load from P.O." dropdown
    // and can be used again.
    if (header?.po_id) {
      await supabase
        .schema("flo").from("purchase_orders")
        .update({ status: "Open" })
        .eq("id", header.po_id);
    }
    setSaving(false);
    router.push("/mercury/deliveries");
  }

  if (loading) return <div className="text-sm text-gray-400">Loading…</div>;
  if (!header) return <div className="text-sm text-red-600">Delivery not found.</div>;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            Delivery — {header.invoice_number || header.po_number}
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${deliveryStatusBadgeClass(
                header.status
              )}`}
            >
              {header.status}
            </span>
          </h1>
          <p className="text-sm text-gray-500">
            {header.clients?.client_name} &middot; {header.branches?.branch_name}
            {readOnly && <span className="ml-2 text-gray-400">&middot; View only</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/mercury/deliveries/${id}/print`} className="btn-secondary">
            Print Invoice
          </Link>
          {!readOnly && (
            <button
              className="btn-secondary text-red-600 border-red-300 hover:bg-red-50"
              onClick={handleDeleteDelivery}
              disabled={saving}
            >
              Delete Delivery
            </button>
          )}
          <button className="btn-secondary" onClick={() => router.push("/mercury/deliveries")}>
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
            <label className="label">Branch</label>
            <input
              className="input bg-gray-50"
              readOnly
              value={`${header.branches?.branch_code || ""} — ${header.branches?.branch_name || ""}`}
            />
          </div>
          <div>
            <label className="label">Delivery Address</label>
            <input className="input bg-gray-50" readOnly value={header.branches?.delivery_address || ""} />
          </div>
          <div>
            <label className="label">PO #</label>
            <input
              className="input"
              value={form.po_number || ""}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, po_number: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Invoice #</label>
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
            <label className="label">Posting Date</label>
            <input
              type="date"
              className="input"
              value={form.posting_date || ""}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, posting_date: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Date of Delivery</label>
            <input
              type="date"
              className="input"
              value={form.date_of_delivery || ""}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, date_of_delivery: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Status</label>
            <select
              className="input"
              value={form.status || ""}
              disabled={readOnly}
              onChange={(e) => {
                const newStatus = e.target.value;
                const wasDelivered = DELIVERED_STATUSES.includes(form.status || "");
                const willBeDelivered = DELIVERED_STATUSES.includes(newStatus);
                setForm((prev) => {
                  const next = { ...prev, status: newStatus };
                  if (willBeDelivered && !prev.date_of_delivery) {
                    next.date_of_delivery = new Date().toISOString().slice(0, 10);
                  }
                  return next;
                });
                // 2026-07-13: encoders were being forced to retype the same
                // Qty Delivered they already entered as the ordered Qty,
                // every single time a delivery moved to Delivered — pure
                // downtime for the common case (nothing went wrong, full
                // qty was delivered). Now, the first time status flips to
                // Delivered/Delivered-Late, any line still untouched (Qty
                // Delivered and Qty Returned both 0) auto-fills Qty
                // Delivered = the ordered Qty via the same autosave path
                // used for manual edits — still fully editable per line
                // for partial deliveries/returns, and never re-fires once a
                // line already has a value (so re-saving or bouncing
                // between statuses won't wipe out anything already there).
                if (willBeDelivered && !wasDelivered) {
                  lines.forEach((l) => {
                    const currentQtyDelivered = lineEdits[l.id]?.qty_delivered ?? l.qty_delivered ?? 0;
                    const currentQtyReturned = lineEdits[l.id]?.qty_returned ?? l.qty_returned ?? 0;
                    if (currentQtyDelivered === 0 && currentQtyReturned === 0) {
                      updateLineEdit(l.id, { qty_delivered: l.qty, qty_returned: 0 });
                    }
                  });
                }
              }}
            >
              {statusOptions.map((o) => (
                <option key={o.id} value={o.value}>
                  {o.value}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Priority</label>
            <select
              className="input"
              value={form.priority || ""}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
            >
              {priorityOptions.map((o) => (
                <option key={o.id} value={o.value}>
                  {o.value}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Service Rate Override (%)</label>
            <select
              className="input"
              value={form.service_rate_override ?? ""}
              disabled={readOnly}
              onChange={(e) =>
                setForm({
                  ...form,
                  service_rate_override: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            >
              <option value="">
                Use client default
                {header?.clients?.service_rate != null ? ` (${header.clients.service_rate}%)` : ""}
              </option>
              <option value="13">13% (NCR)</option>
              <option value="17">17% (Far North / Far South)</option>
            </select>
          </div>
          <div>
            <label className="label">Truck / Carrier</label>
            <select
              className="input"
              value={form.truck_carrier || ""}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, truck_carrier: e.target.value })}
            >
              <option value="">—</option>
              {carrierOptions.map((o) => (
                <option key={o.id} value={o.value}>
                  {o.value}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Return Status</label>
            <input
              className="input"
              value={form.return_status || ""}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, return_status: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className="label">Remarks</label>
            <input
              className="input"
              value={form.remarks || ""}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
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
                <th>Qty</th>
                <th>Unit Price (VAT-incl.)</th>
                <th>Amount</th>
                <th>Qty Delivered</th>
                <th>Qty Returned</th>
                <th>Net Accepted</th>
                <th>Net Amount</th>
                <th>Return Reason</th>
                <th>Expiration Date</th>
                {!readOnly && <th></th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const edit = lineEdits[l.id] || {};
                return (
                  <tr key={l.id}>
                    <td>
                      {l.items?.mercury_item_code || l.items?.item_code} — {l.item_description}
                    </td>
                    <td>{l.qty}</td>
                    <td>{peso(l.unit_price)}</td>
                    <td>{peso(l.amount)}</td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        className="input w-24"
                        value={edit.qty_delivered ?? l.qty_delivered ?? 0}
                        disabled={readOnly}
                        onChange={(e) =>
                          updateLineEdit(l.id, { qty_delivered: Number(e.target.value) })
                        }
                        onBlur={() => flushLineSave(l.id)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        className="input w-24"
                        value={edit.qty_returned ?? l.qty_returned ?? 0}
                        disabled={readOnly}
                        onChange={(e) =>
                          updateLineEdit(l.id, { qty_returned: Number(e.target.value) })
                        }
                        onBlur={() => flushLineSave(l.id)}
                      />
                    </td>
                    <td>{l.net_accepted_qty}</td>
                    <td>{peso(l.net_amount)}</td>
                    <td>
                      <select
                        className="input"
                        value={edit.return_reason ?? l.return_reason ?? ""}
                        disabled={readOnly}
                        onChange={(e) => updateLineEdit(l.id, { return_reason: e.target.value })}
                        onBlur={() => flushLineSave(l.id)}
                      >
                        <option value="">—</option>
                        {returnReasonOptions.map((o) => (
                          <option key={o.id} value={o.value}>
                            {o.value}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="date"
                        className="input w-36"
                        value={edit.expiration_date ?? derivedExpirationDate(l, previewExpiry)}
                        disabled={readOnly}
                        onChange={(e) => updateLineEdit(l.id, { expiration_date: e.target.value })}
                        onBlur={() => flushLineSave(l.id)}
                      />
                    </td>
                    {!readOnly && (
                      <td className="space-x-2 whitespace-nowrap text-xs">
                        {savingLineId === l.id && (
                          <span className="text-gray-400">Saving…</span>
                        )}
                        {savingLineId !== l.id && savedLineId === l.id && (
                          <span className="text-green-600">Saved ✓</span>
                        )}
                        {l.item_id && (
                          <button
                            type="button"
                            className="text-red-600 hover:underline text-xs font-medium"
                            onClick={() => handleRemoveItemLine(l.id)}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="text-right text-sm space-y-1">
          <div className="text-gray-500">Gross Amount: {peso(totalAmount)}</div>
          <div className="font-semibold text-gray-800">Net Amount: {peso(totalNet)}</div>
        </div>
      </div>

      {header.transaction_type !== "Pickup" && !readOnly && (
        <div className="card p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Add Line Item</h2>
            <p className="text-xs text-gray-500">
              Add a billable item to this invoice (e.g. it was created without any, or a line was
              removed by mistake).
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
                    {i.mercury_item_code || i.item_code} — {i.item_description}
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
            <div className="w-36">
              <label className="label">Expiration Date</label>
              <input
                type="date"
                className="input"
                value={newLineExpirationDate}
                onChange={(e) => setNewLineExpirationDate(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={handleAddDeliveryLine}
              disabled={saving || !newLineItemId || newLineQty <= 0}
            >
              Add Item
            </button>
          </div>
        </div>
      )}

      {tracksInventory && !readOnly && (
        <div className="card p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Add Item Received</h2>
            <p className="text-xs text-gray-500">
              For Pick-ups encoded before item tracking was added — list items actually received
              here so they add to warehouse stock. These are saved at unit_price = 0 and do not
              change the pick-up fee already billed on this invoice.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <label className="label">Item</label>
              <select
                className="input"
                value={newItemId}
                onChange={(e) => setNewItemId(e.target.value)}
              >
                <option value="">— Select Item —</option>
                {availableItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.mercury_item_code || i.item_code}
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
                value={newItemQty}
                onChange={(e) => setNewItemQty(Number(e.target.value))}
              />
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={handleAddItemLine}
              disabled={saving || !newItemId || newItemQty <= 0}
            >
              Add Item
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * New Pick-up Entry — for clients where WE pick up items FROM them instead
 * of delivering to a branch. These are billed separately from normal
 * deliveries, at a fixed 5% pick-up fee on the invoice's total amount
 * (see migration_007_pickup_fee.sql — computed server-side in
 * v_delivery_headers_full.service_fee_amount, same column the Billing page
 * already reads).
 *
 * Creates one delivery_headers row (transaction_type = 'Pickup', status =
 * 'Delivered' right away since there's no separate transit to track) plus
 * one synthetic delivery_lines row (the fee base amount) so the existing
 * Billing / SOA / Billing Statement pages work unchanged.
 *
 * For clients whose stock we physically warehouse (manages_inventory =
 * true), you can also list the actual items received below — those add
 * straight to warehouse stock (see migration_014). They're saved with
 * unit_price = 0, so they never affect the pick-up fee or any billing
 * totals — they're for stock quantity tracking only.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, Item } from "@/lib/mercury/types";
import { useRole } from "@/lib/mercury/RoleContext";

interface ItemLineRow {
  key: string;
  item_id: string;
  item_description: string;
  qty: number;
}

function newItemLine(): ItemLineRow {
  return {
    key: Math.random().toString(36).slice(2),
    item_id: "",
    item_description: "",
    qty: 1,
  };
}

export default function NewPickupPage() {
  const router = useRouter();
  const role = useRole();

  useEffect(() => {
    if (role === "general_manager") {
      router.replace("/mercury/deliveries");
    }
  }, [role, router]);

  const [clients, setClients] = useState<Client[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [clientId, setClientId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [totalAmount, setTotalAmount] = useState<number>(0);
  const [remarks, setRemarks] = useState("");
  const [itemLines, setItemLines] = useState<ItemLineRow[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .schema("flo").from("clients")
      .select("*")
      .eq("status", "Active")
      .order("client_code")
      .then(({ data }) => setClients((data as Client[]) || []));
    supabase
      .schema("flo").from("items")
      .select("*")
      .eq("status", "Active")
      .order("item_code")
      .range(0, 9999)
      .then(({ data }) => setItems((data as Item[]) || []));
  }, []);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === clientId) || null,
    [clientId, clients]
  );

  const tracksInventory = !!selectedClient?.manages_inventory;

  const availableItems = useMemo(() => {
    if (!clientId) return items;
    return items.filter((i) => i.client_id === clientId || !i.client_id);
  }, [clientId, items]);

  function updateItemLine(key: string, patch: Partial<ItemLineRow>) {
    setItemLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function handleItemLineSelect(key: string, itemId: string) {
    const item = availableItems.find((i) => i.id === itemId);
    updateItemLine(key, { item_id: itemId, item_description: item?.item_description || "" });
  }

  function addItemLine() {
    setItemLines((prev) => [...prev, newItemLine()]);
  }

  function removeItemLine(key: string) {
    setItemLines((prev) => prev.filter((l) => l.key !== key));
  }

  const feeAmount = Math.round(totalAmount * 5) / 100;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!clientId) {
      setError("Please select a client.");
      return;
    }
    if (!totalAmount || totalAmount <= 0) {
      setError("Please enter the total amount.");
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (invoiceNumber.trim()) {
      const { data: dupInvoices } = await supabase
        .schema("flo").from("delivery_headers")
        .select("id")
        .eq("client_id", clientId)
        .ilike("invoice_number", invoiceNumber.trim())
        .limit(1);
      if (dupInvoices && dupInvoices.length > 0) {
        const proceed = confirm(
          `May existing delivery na sa client na ito na may Invoice # "${invoiceNumber.trim()}". Sigurado ka bang gusto mo pa ring i-save ito?`
        );
        if (!proceed) {
          setSaving(false);
          return;
        }
      }
    }

    const { data: header, error: headerErr } = await supabase
      .schema("flo").from("delivery_headers")
      .insert({
        invoice_number: invoiceNumber || null,
        invoice_date: invoiceDate || null,
        client_id: clientId,
        branch_id: null,
        posting_date: invoiceDate || null,
        date_of_delivery: invoiceDate || null,
        status: "Delivered",
        transaction_type: "Pickup",
        remarks: remarks || null,
        created_by: user?.id || null,
      })
      .select()
      .single();

    if (headerErr || !header) {
      setError(headerErr?.message || "Failed to save pick-up.");
      setSaving(false);
      return;
    }

    const { error: lineErr } = await supabase.schema("flo").from("delivery_lines").insert({
      delivery_header_id: header.id,
      item_id: null,
      item_description: "Pick-up Fee Base Amount",
      qty: 1,
      unit_price: totalAmount,
      qty_delivered: 1,
      qty_returned: 0,
    });

    if (lineErr) {
      setSaving(false);
      setError(lineErr.message);
      return;
    }

    // Items actually received (inventory-only — unit_price is always 0 so
    // these never affect the pick-up fee or any billing totals). Adding
    // these rows automatically increases the item's warehouse stock.
    const validItemLines = itemLines.filter((l) => l.item_id && l.qty > 0);
    if (validItemLines.length > 0) {
      const itemLineInserts = validItemLines.map((l) => ({
        delivery_header_id: header.id,
        item_id: l.item_id,
        item_description: l.item_description,
        qty: l.qty,
        unit_price: 0,
        qty_delivered: l.qty,
        qty_returned: 0,
      }));
      const { error: itemLinesErr } = await supabase.schema("flo").from("delivery_lines").insert(itemLineInserts);
      if (itemLinesErr) {
        setSaving(false);
        setError(itemLinesErr.message);
        return;
      }
    }

    setSaving(false);
    router.push("/mercury/deliveries");
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">New Pick-up</h1>
        <p className="text-sm text-gray-500">
          Para sa mga client na kami mismo ang pumipick-up ng item — 5% pick-up fee ng total amount,
          binibill nang hiwalay sa regular na delivery.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="card p-5 space-y-4">
        <div>
          <label className="label">
            Client <span className="text-red-500">*</span>
          </label>
          <select
            className="input"
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setItemLines([]);
            }}
            required
          >
            <option value="">— Select Client —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.client_code} — {c.client_name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Invoice #</label>
            <input
              className="input"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Invoice Date</label>
            <input
              type="date"
              className="input"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="label">
            Total Amount (PHP) <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            className="input"
            value={totalAmount || ""}
            onChange={(e) => setTotalAmount(Number(e.target.value))}
            required
          />
        </div>

        <div className="rounded-md bg-teal-50 border border-teal-200 px-3 py-2 text-sm text-teal-800">
          Pick-up Fee (5%):{" "}
          {new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(feeAmount)}
        </div>

        <div>
          <label className="label">Remarks</label>
          <input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>

        {tracksInventory && (
          <div className="space-y-3 rounded-md border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-700">Items Received</h2>
                <p className="text-xs text-gray-500">
                  Optional — list the actual items received for this pick-up. These add directly
                  to warehouse stock and do not affect the pick-up fee above.
                </p>
              </div>
              <button type="button" className="btn-secondary text-xs" onClick={addItemLine}>
                + Add Item
              </button>
            </div>

            {itemLines.length > 0 && (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th className="w-56">Item</th>
                      <th>Description</th>
                      <th className="w-24">Qty</th>
                      <th className="w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemLines.map((line) => (
                      <tr key={line.key}>
                        <td>
                          <select
                            className="input"
                            value={line.item_id}
                            onChange={(e) => handleItemLineSelect(line.key, e.target.value)}
                          >
                            <option value="">— Select Item —</option>
                            {availableItems.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.mercury_item_code || i.item_code}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input className="input bg-gray-50" value={line.item_description} readOnly />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="input"
                            value={line.qty}
                            onChange={(e) =>
                              updateItemLine(line.key, { qty: Number(e.target.value) })
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="text-red-600 hover:underline text-xs font-medium"
                            onClick={() => removeItemLine(line.key)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save Pick-up"}
          </button>
          <button type="button" className="btn-secondary" onClick={() => router.push("/mercury/deliveries")}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

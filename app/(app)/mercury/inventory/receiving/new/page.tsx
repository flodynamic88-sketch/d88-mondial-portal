"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, Item } from "@/lib/mercury/types";
import { useRole } from "@/lib/mercury/RoleContext";

interface LineRow {
  key: string;
  item_id: string;
  item_description: string;
  qty: number;
  unit: string;
  unit_price: number;
  /** Optional. If a single delivery has multiple expiration dates for the
   * same item, split it across multiple lines (one per date) using
   * "+ Add Line" — each line can carry its own expiration date. */
  expiration_date: string;
}

function newLine(): LineRow {
  return {
    key: Math.random().toString(36).slice(2),
    item_id: "",
    item_description: "",
    qty: 1,
    unit: "",
    unit_price: 0,
    expiration_date: "",
  };
}

function peso(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(n || 0);
}

export default function NewStockReceiptPage() {
  const router = useRouter();
  const role = useRole();

  useEffect(() => {
    if (role === "general_manager") {
      router.replace("/mercury/inventory/receiving");
    }
  }, [role, router]);

  const [clients, setClients] = useState<Client[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  const [clientId, setClientId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dateReceived, setDateReceived] = useState("");
  const [notes, setNotes] = useState("");

  const [lines, setLines] = useState<LineRow[]>([newLine()]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const [clientsRes, itemsRes] = await Promise.all([
        supabase
          .schema("flo").from("clients")
          .select("*")
          .eq("status", "Active")
          .eq("manages_inventory", true)
          .order("client_code"),
        supabase.schema("flo").from("items").select("*").eq("status", "Active").order("item_code"),
      ]);
      if (clientsRes.error) setError(clientsRes.error.message);
      else if (itemsRes.error) setError(itemsRes.error.message);
      setClients((clientsRes.data as Client[]) || []);
      setItems((itemsRes.data as Item[]) || []);
    }
    load();
  }, []);

  const availableItems = useMemo(() => {
    if (!clientId) return [];
    return items.filter((i) => i.client_id === clientId);
  }, [clientId, items]);

  function handleClientChange(newClientId: string) {
    setClientId(newClientId);
    setLines([newLine()]);
  }

  function updateLine(key: string, patch: Partial<LineRow>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function handleItemSelect(key: string, itemId: string) {
    const item = availableItems.find((i) => i.id === itemId);
    updateLine(key, {
      item_id: itemId,
      item_description: item?.item_description || "",
      unit: item?.unit || "",
      unit_price: item?.unit_price || 0,
    });
  }

  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  const totalQty = useMemo(() => lines.reduce((sum, l) => sum + Number(l.qty || 0), 0), [lines]);
  const totalAmount = useMemo(
    () => lines.reduce((sum, l) => sum + Number(l.qty || 0) * Number(l.unit_price || 0), 0),
    [lines]
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!clientId) {
      setError("Please select a client.");
      return;
    }
    if (lines.some((l) => !l.item_id)) {
      setError("Please select an item for every line.");
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: receipt, error: receiptErr } = await supabase
      .schema("flo").from("stock_receipts")
      .insert({
        client_id: clientId,
        invoice_number: invoiceNumber || null,
        invoice_date: invoiceDate || null,
        date_received: dateReceived || null,
        notes: notes || null,
        created_by: user?.id || null,
      })
      .select()
      .single();

    if (receiptErr || !receipt) {
      setError(receiptErr?.message || "Failed to create stock receipt.");
      setSaving(false);
      return;
    }

    const lineInserts = lines.map((l) => ({
      receipt_id: receipt.id,
      item_id: l.item_id,
      item_description: l.item_description,
      qty: l.qty,
      unit: l.unit,
      unit_price: l.unit_price,
      expiration_date: l.expiration_date || null,
    }));

    const { error: linesErr } = await supabase.schema("flo").from("stock_receipt_lines").insert(lineInserts);

    setSaving(false);

    if (linesErr) {
      setError(linesErr.message);
      return;
    }

    router.push(`/mercury/inventory/receiving/${receipt.id}`);
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">New Stock Receipt</h1>
        <p className="text-sm text-gray-500">
          Encode incoming stock delivered by the client into the warehouse. Saving will
          automatically add these quantities to the item&apos;s current stock.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Receipt Details</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">
                Client <span className="text-red-500">*</span>
              </label>
              <select
                className="input"
                value={clientId}
                onChange={(e) => handleClientChange(e.target.value)}
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
            <div>
              <label className="label">Invoice Number</label>
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
            <div>
              <label className="label">Date Received</label>
              <input
                type="date"
                className="input"
                value={dateReceived}
                onChange={(e) => setDateReceived(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="label">Notes</label>
              <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">Line Items</h2>
              <p className="text-xs text-gray-400">
                Same item with multiple expiration dates? Use + Add Line to split the qty
                across separate lines, one per expiration date.
              </p>
            </div>
            <button type="button" className="btn-secondary text-xs" onClick={addLine} disabled={!clientId}>
              + Add Line
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-56">Item</th>
                  <th>Description</th>
                  <th className="w-24">Unit</th>
                  <th className="w-28">Qty Received</th>
                  <th className="w-32">Unit Price</th>
                  <th className="w-32">Amount</th>
                  <th className="w-36">Expiration Date</th>
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key}>
                    <td>
                      <select
                        className="input"
                        value={line.item_id}
                        onChange={(e) => handleItemSelect(line.key, e.target.value)}
                        disabled={!clientId}
                      >
                        <option value="">
                          {clientId ? "— Select Item —" : "Select a client first"}
                        </option>
                        {availableItems.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.item_code}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input className="input bg-gray-50" value={line.item_description} readOnly />
                    </td>
                    <td>
                      <input className="input bg-gray-50" value={line.unit} readOnly />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="input"
                        value={line.qty}
                        onChange={(e) => updateLine(line.key, { qty: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="input"
                        value={line.unit_price}
                        onChange={(e) => updateLine(line.key, { unit_price: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        className="input bg-gray-50"
                        readOnly
                        value={peso(Number(line.qty || 0) * Number(line.unit_price || 0))}
                      />
                    </td>
                    <td>
                      <input
                        type="date"
                        className="input"
                        value={line.expiration_date}
                        onChange={(e) => updateLine(line.key, { expiration_date: e.target.value })}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="text-red-600 hover:underline text-xs font-medium"
                        onClick={() => removeLine(line.key)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-right text-sm font-semibold text-gray-700 space-y-1">
            <div>Total Qty Received: {totalQty}</div>
            <div>Total Amount: {peso(totalAmount)}</div>
          </div>
        </div>

        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save Stock Receipt"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => router.push("/mercury/inventory/receiving")}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

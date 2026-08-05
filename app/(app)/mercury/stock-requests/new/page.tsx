"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, Item, StockRequest } from "@/lib/mercury/types";
import { useRole } from "@/lib/mercury/RoleContext";

interface LineRow {
  key: string;
  item_id: string;
  item_description: string;
  unit: string;
  qty: number;
}

function newLine(): LineRow {
  return {
    key: Math.random().toString(36).slice(2),
    item_id: "",
    item_description: "",
    unit: "",
    qty: 1,
  };
}

function nextRequestNumber(existing: StockRequest[]): string {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const prefix = `SR-${y}${m}${d}`;

  const todaysNums = existing
    .map((r) => r.request_number)
    .filter((c) => c.startsWith(prefix))
    .map((c) => {
      const suffix = c.slice(prefix.length).replace(/^-/, "");
      const n = parseInt(suffix, 10);
      return isNaN(n) ? 0 : n;
    });

  const next = (todaysNums.length ? Math.max(...todaysNums) : 0) + 1;
  return `${prefix}-${String(next).padStart(2, "0")}`;
}

export default function NewStockRequestPage() {
  const router = useRouter();
  const role = useRole();

  useEffect(() => {
    if (role === "general_manager") {
      router.replace("/mercury/stock-requests");
    }
  }, [role, router]);

  const [clients, setClients] = useState<Client[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [existingRequests, setExistingRequests] = useState<StockRequest[]>([]);

  const [clientId, setClientId] = useState("");
  const [requestNumber, setRequestNumber] = useState("");
  const [requestDate, setRequestDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [deliveryDateRequested, setDeliveryDateRequested] = useState("ASAP");
  const [deliveryScheduleNote, setDeliveryScheduleNote] = useState("");
  const [notes, setNotes] = useState("");

  const [lines, setLines] = useState<LineRow[]>([newLine()]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const [clientsRes, itemsRes, requestsRes] = await Promise.all([
        supabase.schema("flo").from("clients").select("*").eq("status", "Active").order("client_code").range(0, 9999),
        supabase.schema("flo").from("items").select("*").eq("status", "Active").order("item_code").range(0, 9999),
        supabase.schema("flo").from("stock_requests").select("*"),
      ]);
      setClients((clientsRes.data as Client[]) || []);
      setItems((itemsRes.data as Item[]) || []);
      const reqs = (requestsRes.data as StockRequest[]) || [];
      setExistingRequests(reqs);
      setRequestNumber(nextRequestNumber(reqs));
    }
    load();
  }, []);

  const availableItems = useMemo(() => {
    // Only items belonging to the selected supplier's own catalog — a Stock
    // Request is asking that specific client to prepare items from their
    // own stock, so unrelated/other-client items should never show here.
    if (!clientId) return [];
    return items.filter((i) => i.client_id === clientId);
  }, [clientId, items]);

  function updateLine(key: string, patch: Partial<LineRow>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function handleItemSelect(key: string, itemId: string) {
    const item = availableItems.find((i) => i.id === itemId);
    updateLine(key, {
      item_id: itemId,
      item_description: item?.item_description || "",
      unit: item?.unit || "",
    });
  }

  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!clientId) {
      setError("Please select a client.");
      return;
    }
    if (!requestNumber.trim()) {
      setError("Please provide a request number.");
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

    const { data: req, error: reqErr } = await supabase
      .schema("flo").from("stock_requests")
      .insert({
        request_number: requestNumber.trim(),
        client_id: clientId,
        request_date: requestDate || null,
        delivery_date_requested: deliveryDateRequested || null,
        delivery_schedule_note: deliveryScheduleNote || null,
        status: "Open",
        notes: notes || null,
        created_by: user?.id || null,
      })
      .select()
      .single();

    if (reqErr || !req) {
      setError(reqErr?.message || "Failed to create stock request.");
      setSaving(false);
      return;
    }

    const lineInserts = lines.map((l) => ({
      request_id: req.id,
      item_id: l.item_id,
      item_description: l.item_description,
      qty: l.qty,
      unit: l.unit || null,
    }));

    const { error: linesErr } = await supabase.schema("flo").from("stock_request_lines").insert(lineInserts);

    setSaving(false);

    if (linesErr) {
      setError(linesErr.message);
      return;
    }

    router.push(`/mercury/stock-requests/${req.id}`);
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">New Purchase Order</h1>
        <p className="text-sm text-gray-500">
          Request a client to prepare a given quantity of items for us to pick up. This does not
          carry pricing and is not linked to any Pick-up or Delivery record.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Client (Supplier)</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">
                Client <span className="text-red-500">*</span>
              </label>
              <select
                className="input"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
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
          </div>
        </div>

        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Request Details</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">
                Request Number <span className="text-red-500">*</span>
              </label>
              <input
                className="input"
                value={requestNumber}
                onChange={(e) => setRequestNumber(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Request Date</label>
              <input
                type="date"
                className="input"
                value={requestDate}
                onChange={(e) => setRequestDate(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Delivery Date Requested</label>
              <input
                className="input"
                placeholder="e.g. ASAP or a specific date"
                value={deliveryDateRequested}
                onChange={(e) => setDeliveryDateRequested(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="label">Delivery Schedule Note</label>
              <input
                className="input"
                placeholder="e.g. Monday to Friday - 9:00AM to 4:00PM"
                value={deliveryScheduleNote}
                onChange={(e) => setDeliveryScheduleNote(e.target.value)}
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
            <h2 className="text-sm font-semibold text-gray-700">Item Lines</h2>
            <button type="button" className="btn-secondary text-xs" onClick={addLine}>
              + Add Line
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-56">Item</th>
                  <th>Description</th>
                  <th className="w-24">Qty</th>
                  <th className="w-24">Unit</th>
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
                        className="input"
                        value={line.unit}
                        onChange={(e) => updateLine(line.key, { unit: e.target.value })}
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
        </div>

        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save Purchase Order"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => router.push("/mercury/stock-requests")}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

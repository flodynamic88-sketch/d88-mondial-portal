"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Branch, Client, ClientBranchLink, Item, PurchaseOrder } from "@/lib/mercury/types";
import { useRole } from "@/lib/mercury/RoleContext";

interface LineRow {
  key: string;
  item_id: string;
  item_description: string;
  unit_price: number;
  qty: number;
}

function newLine(): LineRow {
  return {
    key: Math.random().toString(36).slice(2),
    item_id: "",
    item_description: "",
    unit_price: 0,
    qty: 1,
  };
}

function nextPoNumber(existing: PurchaseOrder[]): string {
  const nums = existing
    .map((p) => p.po_number)
    .filter((c) => c.startsWith("PO-"))
    .map((c) => parseInt(c.slice(3), 10))
    .filter((n) => !isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `PO-${String(next).padStart(4, "0")}`;
}

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const role = useRole();

  useEffect(() => {
    if (role === "general_manager") {
      router.replace("/mercury/purchase-orders");
    }
  }, [role, router]);

  const [clients, setClients] = useState<Client[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [links, setLinks] = useState<ClientBranchLink[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [existingPos, setExistingPos] = useState<PurchaseOrder[]>([]);

  const [clientId, setClientId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [notes, setNotes] = useState("");

  const [lines, setLines] = useState<LineRow[]>([newLine()]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const [clientsRes, branchesRes, linksRes, itemsRes, posRes] = await Promise.all([
        supabase.schema("flo").from("clients").select("*").eq("status", "Active").order("client_code").range(0, 9999),
        supabase.schema("flo").from("branches").select("*").order("branch_code").range(0, 9999),
        supabase.schema("flo").from("client_branch_links").select("*").range(0, 9999),
        supabase.schema("flo").from("items").select("*").eq("status", "Active").order("item_code").range(0, 9999),
        supabase.schema("flo").from("purchase_orders").select("*"),
      ]);
      setClients((clientsRes.data as Client[]) || []);
      setBranches((branchesRes.data as Branch[]) || []);
      setLinks((linksRes.data as ClientBranchLink[]) || []);
      setItems((itemsRes.data as Item[]) || []);
      const pos = (posRes.data as PurchaseOrder[]) || [];
      setExistingPos(pos);
      setPoNumber(nextPoNumber(pos));
    }
    load();
  }, []);

  const availableBranches = useMemo(() => {
    if (!clientId) return [];
    const branchIds = new Set(links.filter((l) => l.client_id === clientId).map((l) => l.branch_id));
    return branches.filter((b) => branchIds.has(b.id));
  }, [clientId, links, branches]);

  const availableItems = useMemo(() => {
    if (!clientId) return items;
    return items.filter((i) => i.client_id === clientId || !i.client_id);
  }, [clientId, items]);

  function handleClientChange(newClientId: string) {
    setClientId(newClientId);
    setBranchId("");
  }

  function updateLine(key: string, patch: Partial<LineRow>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function handleItemSelect(key: string, itemId: string) {
    const item = availableItems.find((i) => i.id === itemId);
    updateLine(key, {
      item_id: itemId,
      item_description: item?.item_description || "",
      unit_price: item?.unit_price || 0,
    });
  }

  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  const grandTotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.qty * l.unit_price, 0),
    [lines]
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!clientId) {
      setError("Please select a client.");
      return;
    }
    if (!poNumber.trim()) {
      setError("Please provide a P.O. number.");
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

    const { data: po, error: poErr } = await supabase
      .schema("flo").from("purchase_orders")
      .insert({
        po_number: poNumber.trim(),
        client_id: clientId,
        branch_id: branchId || null,
        po_date: poDate || null,
        status: "Open",
        notes: notes || null,
        created_by: user?.id || null,
      })
      .select()
      .single();

    if (poErr || !po) {
      setError(poErr?.message || "Failed to create purchase order.");
      setSaving(false);
      return;
    }

    const lineInserts = lines.map((l) => ({
      po_id: po.id,
      item_id: l.item_id,
      item_description: l.item_description,
      qty: l.qty,
      unit_price: l.unit_price,
    }));

    const { error: linesErr } = await supabase.schema("flo").from("po_lines").insert(lineInserts);

    setSaving(false);

    if (linesErr) {
      setError(linesErr.message);
      return;
    }

    router.push(`/mercury/purchase-orders/${po.id}`);
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">New Purchase Order</h1>
        <p className="text-sm text-gray-500">
          Encode a Purchase Order provided by the client, with its line items. Once saved, it
          stays &quot;Open&quot; and can be loaded when creating a Delivery / Invoice.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Client &amp; Branch</h2>
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
              <label className="label">Branch</label>
              <select
                className="input"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                disabled={!clientId}
              >
                <option value="">
                  {clientId ? "— Select Branch —" : "Select a client first"}
                </option>
                {availableBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.branch_code} — {b.branch_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">P.O. Details</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">
                P.O. Number <span className="text-red-500">*</span>
              </label>
              <input
                className="input"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">P.O. Date</label>
              <input
                type="date"
                className="input"
                value={poDate}
                onChange={(e) => setPoDate(e.target.value)}
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
            <h2 className="text-sm font-semibold text-gray-700">Line Items</h2>
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
                  <th className="w-28">Unit Price (VAT-incl.)</th>
                  <th className="w-24">Qty</th>
                  <th className="w-32">Amount</th>
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
                        className="input"
                        value={line.unit_price}
                        onChange={(e) =>
                          updateLine(line.key, { unit_price: Number(e.target.value) })
                        }
                      />
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
                      {new Intl.NumberFormat("en-PH", {
                        style: "currency",
                        currency: "PHP",
                      }).format(line.qty * line.unit_price)}
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

          <div className="text-right text-sm font-semibold text-gray-700">
            Grand Total:{" "}
            {new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
              grandTotal
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save Purchase Order"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => router.push("/mercury/purchase-orders")}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

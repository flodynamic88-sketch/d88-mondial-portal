"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type {
  BadOrderHeader,
  BadOrderStatus,
  Branch,
  Client,
  ClientBranchLink,
  Item,
} from "@/lib/mercury/types";
import { BAD_ORDER_STATUSES } from "@/lib/mercury/types";

function nextBoNumber(existing: BadOrderHeader[]): string {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const prefix = `BO-${y}${m}${d}`;

  const todaysNums = existing
    .map((r) => r.bo_number)
    .filter((c) => c.startsWith(prefix))
    .map((c) => {
      const suffix = c.slice(prefix.length).replace(/^-/, "");
      const n = parseInt(suffix, 10);
      return isNaN(n) ? 0 : n;
    });

  const next = (todaysNums.length ? Math.max(...todaysNums) : 0) + 1;
  return `${prefix}-${String(next).padStart(2, "0")}`;
}

interface LineRow {
  key: string;
  item_id: string;
  item_code: string;
  item_description: string;
  qty: string;
  unit: string;
  unit_price: string;
  amount: string;
  amount_touched: boolean;
  expiration_date: string;
}

function newLine(): LineRow {
  return {
    key: Math.random().toString(36).slice(2),
    item_id: "",
    item_code: "",
    item_description: "",
    qty: "",
    unit: "",
    unit_price: "",
    amount: "",
    amount_touched: false,
    expiration_date: "",
  };
}

export default function NewBadOrderPage() {
  const router = useRouter();

  const [clients, setClients] = useState<Client[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [links, setLinks] = useState<ClientBranchLink[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [existing, setExisting] = useState<BadOrderHeader[]>([]);

  const [boNumber, setBoNumber] = useState("");
  const [dateBackload, setDateBackload] = useState(() => new Date().toISOString().slice(0, 10));

  const [clientId, setClientId] = useState("");
  const [branchId, setBranchId] = useState("");

  const [lines, setLines] = useState<LineRow[]>([newLine()]);

  const [status, setStatus] = useState<BadOrderStatus>("Stored in Warehouse");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const [clientsRes, branchesRes, linksRes, itemsRes, boRes] = await Promise.all([
        supabase.schema("flo").from("clients").select("*").order("client_code").range(0, 9999),
        supabase.schema("flo").from("branches").select("*").order("branch_name").range(0, 9999),
        supabase.schema("flo").from("client_branch_links").select("*").range(0, 9999),
        supabase.schema("flo").from("items").select("*").order("item_code").range(0, 9999),
        supabase.schema("flo").from("bad_order_headers").select("*"),
      ]);
      setClients((clientsRes.data as Client[]) || []);
      setBranches((branchesRes.data as Branch[]) || []);
      setLinks((linksRes.data as ClientBranchLink[]) || []);
      setItems((itemsRes.data as Item[]) || []);
      const rows = (boRes.data as BadOrderHeader[]) || [];
      setExisting(rows);
      setBoNumber(nextBoNumber(rows));
    }
    load();
  }, []);

  const availableBranches = useMemo(() => {
    if (!clientId) return [];
    const branchIds = new Set(
      links.filter((l) => l.client_id === clientId).map((l) => l.branch_id)
    );
    return branches.filter((b) => branchIds.has(b.id));
  }, [clientId, links, branches]);

  const availableItems = useMemo(
    () => (clientId ? items.filter((i) => i.client_id === clientId) : []),
    [clientId, items]
  );

  function handleClientChange(value: string) {
    setClientId(value);
    setBranchId("");
    setLines([newLine()]);
  }

  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  function updateLine(key: string, patch: Partial<LineRow>) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const updated = { ...l, ...patch };
        if (!("amount_touched" in patch) && !updated.amount_touched) {
          const q = parseFloat(updated.qty);
          const p = parseFloat(updated.unit_price);
          if (!isNaN(q) && !isNaN(p)) {
            updated.amount = (q * p).toFixed(2);
          }
        }
        return updated;
      })
    );
  }

  function handleItemSelect(key: string, itemId: string) {
    const item = availableItems.find((i) => i.id === itemId);
    if (item) {
      updateLine(key, {
        item_id: itemId,
        item_code: item.mercury_item_code || item.item_code,
        item_description: item.item_description,
        unit: item.unit || "",
        unit_price: item.unit_price != null ? String(item.unit_price) : "",
      });
    } else {
      updateLine(key, { item_id: "", item_code: "", item_description: "", unit: "", unit_price: "" });
    }
  }

  const totalQty = useMemo(
    () => lines.reduce((s, l) => s + (parseFloat(l.qty) || 0), 0),
    [lines]
  );
  const totalAmount = useMemo(
    () => lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0),
    [lines]
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!boNumber.trim()) {
      setError("Please provide a BO number.");
      return;
    }

    const validLines = lines.filter(
      (l) => l.item_code.trim() && l.item_description.trim() && l.qty && !isNaN(parseFloat(l.qty))
    );
    if (validLines.length === 0) {
      setError("Please add at least one item line with an item and valid quantity.");
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: header, error: headerErr } = await supabase
      .schema("flo").from("bad_order_headers")
      .insert({
        bo_number: boNumber.trim(),
        date_backload: dateBackload || null,
        client_id: clientId || null,
        branch_id: branchId || null,
        status,
        notes: notes.trim() || null,
        created_by: user?.id || null,
      })
      .select()
      .single();

    if (headerErr || !header) {
      setSaving(false);
      setError(headerErr?.message || "Failed to create Bad Order header.");
      return;
    }

    const lineInserts = validLines.map((l) => ({
      bad_order_header_id: header.id,
      item_id: l.item_id || null,
      item_code: l.item_code.trim(),
      item_description: l.item_description.trim(),
      qty: parseFloat(l.qty) || 0,
      unit: l.unit.trim() || null,
      unit_price: l.unit_price ? parseFloat(l.unit_price) : null,
      amount: l.amount ? parseFloat(l.amount) : 0,
      expiration_date: l.expiration_date || null,
    }));

    const { error: linesErr } = await supabase.schema("flo").from("bad_order_lines").insert(lineInserts);

    setSaving(false);

    if (linesErr) {
      setError(linesErr.message);
      return;
    }

    router.push(`/mercury/bad-orders/${header.id}`);
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">New Bad Order</h1>
        <p className="text-sm text-gray-500">
          Encode a backload BO# due to bad orders (e.g. from Mercury). Select the client to
          auto-filter its branches and item catalog, then add one line per item.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Bad Order Details</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">
                BO Number <span className="text-red-500">*</span>
              </label>
              <input
                className="input"
                value={boNumber}
                onChange={(e) => setBoNumber(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">
                Date Backload <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                className="input"
                value={dateBackload}
                onChange={(e) => setDateBackload(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Status</label>
              <select
                className="input"
                value={status}
                onChange={(e) => setStatus(e.target.value as BadOrderStatus)}
              >
                {BAD_ORDER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Client / Branch</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">Client</label>
              <select
                className="input"
                value={clientId}
                onChange={(e) => handleClientChange(e.target.value)}
              >
                <option value="">— Select —</option>
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
                <option value="">— Select —</option>
                {availableBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.branch_code} — {b.branch_name}
                  </option>
                ))}
              </select>
              {!clientId && <p className="text-xs text-gray-400 mt-1">Select a client first.</p>}
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
                  <th>Item (catalog)</th>
                  <th>Item Code</th>
                  <th>Item Description</th>
                  <th className="text-right">Qty</th>
                  <th>Unit</th>
                  <th className="text-right">Unit Price</th>
                  <th className="text-right">Amount</th>
                  <th>Expiration</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td>
                      <select
                        className="input"
                        value={l.item_id}
                        onChange={(e) => handleItemSelect(l.key, e.target.value)}
                        disabled={!clientId}
                      >
                        <option value="">— Select —</option>
                        {availableItems.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.item_code} — {i.item_description}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="input"
                        value={l.item_code}
                        onChange={(e) => updateLine(l.key, { item_code: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        value={l.item_description}
                        onChange={(e) => updateLine(l.key, { item_description: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="any"
                        className="input text-right"
                        value={l.qty}
                        onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        value={l.unit}
                        onChange={(e) => updateLine(l.key, { unit: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="any"
                        className="input text-right"
                        value={l.unit_price}
                        onChange={(e) => updateLine(l.key, { unit_price: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="any"
                        className="input text-right"
                        value={l.amount}
                        onChange={(e) => updateLine(l.key, { amount: e.target.value, amount_touched: true })}
                      />
                    </td>
                    <td>
                      <input
                        type="date"
                        className="input"
                        value={l.expiration_date}
                        onChange={(e) => updateLine(l.key, { expiration_date: e.target.value })}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="text-red-500 hover:underline text-xs"
                        onClick={() => removeLine(l.key)}
                        disabled={lines.length === 1}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td colSpan={3} className="text-right">
                    Totals:
                  </td>
                  <td className="text-right">{totalQty}</td>
                  <td></td>
                  <td></td>
                  <td className="text-right">{totalAmount.toFixed(2)}</td>
                  <td></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-gray-400">
            Item Code auto-fills from the item&apos;s Mercury Item Code (falls back to the internal
            item code if none is set) — editable. Amount auto-computes as Qty × Unit Price unless
            manually edited. If one BO has the same item with multiple expiration dates, add a
            separate line per date.
          </p>
        </div>

        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Notes</h2>
          <textarea
            className="input"
            rows={3}
            placeholder="Optional remarks"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save Bad Order"}
          </button>
          <button type="button" className="btn-secondary" onClick={() => router.push("/mercury/bad-orders")}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

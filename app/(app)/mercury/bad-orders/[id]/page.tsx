"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import PhotoAttachments from "@/components/mercury/MercuryPhotoAttachments";
import type {
  BadOrderHeader,
  BadOrderLine,
  BadOrderStatus,
  Branch,
  Client,
  ClientBranchLink,
  Item,
} from "@/lib/mercury/types";
import { BAD_ORDER_STATUSES } from "@/lib/mercury/types";

function peso(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(n || 0);
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "Stored in Warehouse":
      return "bg-blue-100 text-blue-700";
    case "Returned to Client/Principal":
      return "bg-amber-100 text-amber-700";
    case "Disposed":
      return "bg-gray-200 text-gray-600";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

function newLineDraft() {
  return {
    item_id: "",
    item_code: "",
    item_description: "",
    qty: "",
    unit: "",
    unit_price: "",
    amount: "",
    expiration_date: "",
  };
}

export default function BadOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [clients, setClients] = useState<Client[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [links, setLinks] = useState<ClientBranchLink[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  const [record, setRecord] = useState<BadOrderHeader | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [lines, setLines] = useState<BadOrderLine[]>([]);
  const [lineEdits, setLineEdits] = useState<Record<string, Partial<BadOrderLine>>>({});

  const [newLine, setNewLine] = useState(newLineDraft());
  const [addingLine, setAddingLine] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const [
      { data: clientsData },
      { data: branchesData },
      { data: linksData },
      { data: itemsData },
      { data: headerData, error: headerErr },
      { data: linesData, error: linesErr },
    ] = await Promise.all([
      supabase.schema("flo").from("clients").select("*").order("client_code").range(0, 9999),
      supabase.schema("flo").from("branches").select("*").order("branch_name").range(0, 9999),
      supabase.schema("flo").from("client_branch_links").select("*").range(0, 9999),
      supabase.schema("flo").from("items").select("*").order("item_code").range(0, 9999),
      supabase.schema("flo").from("bad_order_headers").select("*").eq("id", id).single(),
      supabase
        .schema("flo").from("bad_order_lines")
        .select("*, items(id, item_code, item_description, unit)")
        .eq("bad_order_header_id", id)
        .order("created_at", { ascending: true }),
    ]);
    setClients((clientsData as Client[]) || []);
    setBranches((branchesData as Branch[]) || []);
    setLinks((linksData as ClientBranchLink[]) || []);
    setItems((itemsData as Item[]) || []);
    if (headerErr) setError(headerErr.message);
    if (linesErr) setError(linesErr.message);
    setRecord((headerData as BadOrderHeader) || null);
    setForm((headerData as Record<string, unknown>) || {});
    setLines((linesData as unknown as BadOrderLine[]) || []);
    setLineEdits({});
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function set(key: string, value: unknown) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const availableBranches = useMemo(() => {
    const clientId = form.client_id as string | undefined;
    if (!clientId) return [];
    const branchIds = new Set(
      links.filter((l) => l.client_id === clientId).map((l) => l.branch_id)
    );
    return branches.filter((b) => branchIds.has(b.id));
  }, [form.client_id, links, branches]);

  const availableItems = useMemo(() => {
    const clientId = form.client_id as string | undefined;
    return clientId ? items.filter((i) => i.client_id === clientId) : [];
  }, [form.client_id, items]);

  const totalQty = useMemo(() => lines.reduce((s, l) => s + (l.qty || 0), 0), [lines]);
  const totalAmount = useMemo(() => lines.reduce((s, l) => s + (l.amount || 0), 0), [lines]);

  async function handleSaveHeader() {
    setSaving(true);
    setError(null);
    const supabase = createClient();

    const payload = {
      bo_number: form.bo_number,
      date_backload: form.date_backload || null,
      client_id: form.client_id || null,
      branch_id: form.branch_id || null,
      status: form.status,
      notes: form.notes || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.schema("flo").from("bad_order_headers").update(payload).eq("id", id);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  async function saveAttachments(urls: string[]) {
    const supabase = createClient();
    const { error } = await supabase
      .schema("flo").from("bad_order_headers")
      .update({ attachment_urls: urls, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    setRecord((prev) => (prev ? { ...prev, attachment_urls: urls } : prev));
    set("attachment_urls", urls);
  }

  async function handleDeleteHeader() {
    if (!confirm("Delete this whole Bad Order (BO# and all its lines)? This cannot be undone.")) return;
    const supabase = createClient();
    const { error } = await supabase.schema("flo").from("bad_order_headers").delete().eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/mercury/bad-orders");
  }

  function updateLineEdit(lineId: string, patch: Partial<BadOrderLine>) {
    setLineEdits((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  }

  function lineValue<K extends keyof BadOrderLine>(line: BadOrderLine, key: K) {
    const edit = lineEdits[line.id];
    return edit && key in edit ? (edit[key] as BadOrderLine[K]) : line[key];
  }

  async function handleSaveLine(lineId: string) {
    const edit = lineEdits[lineId];
    if (!edit) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .schema("flo").from("bad_order_lines")
      .update({ ...edit, updated_at: new Date().toISOString() })
      .eq("id", lineId);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  async function handleDeleteLine(lineId: string) {
    if (!confirm("Remove this line?")) return;
    const supabase = createClient();
    const { error } = await supabase.schema("flo").from("bad_order_lines").delete().eq("id", lineId);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  function handleNewLineItemSelect(itemId: string) {
    const item = availableItems.find((i) => i.id === itemId);
    if (item) {
      setNewLine((prev) => ({
        ...prev,
        item_id: itemId,
        item_code: item.mercury_item_code || item.item_code,
        item_description: item.item_description,
        unit: item.unit || "",
        unit_price: item.unit_price != null ? String(item.unit_price) : "",
      }));
    } else {
      setNewLine((prev) => ({ ...prev, item_id: "", item_code: "", item_description: "", unit: "", unit_price: "" }));
    }
  }

  async function handleAddLine() {
    if (!newLine.item_code.trim() || !newLine.item_description.trim() || !newLine.qty) {
      setError("Please fill in item code, description, and qty for the new line.");
      return;
    }
    setAddingLine(true);
    setError(null);
    const supabase = createClient();
    const qtyNum = parseFloat(newLine.qty) || 0;
    const priceNum = newLine.unit_price ? parseFloat(newLine.unit_price) : null;
    const amountNum = newLine.amount ? parseFloat(newLine.amount) : qtyNum * (priceNum || 0);

    const { error } = await supabase.schema("flo").from("bad_order_lines").insert({
      bad_order_header_id: id,
      item_id: newLine.item_id || null,
      item_code: newLine.item_code.trim(),
      item_description: newLine.item_description.trim(),
      qty: qtyNum,
      unit: newLine.unit.trim() || null,
      unit_price: priceNum,
      amount: amountNum,
      expiration_date: newLine.expiration_date || null,
    });
    setAddingLine(false);
    if (error) {
      setError(error.message);
      return;
    }
    setNewLine(newLineDraft());
    load();
  }

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading…</div>;
  if (!record) return <div className="p-6 text-sm text-red-600">Bad Order record not found.</div>;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{record.bo_number}</h1>
          <span
            className={`inline-block mt-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(
              (form.status as string) || record.status
            )}`}
          >
            {(form.status as string) || record.status}
          </span>
        </div>
        <div className="flex gap-2">
          <Link href="/mercury/bad-orders" className="btn-secondary">
            Back to List
          </Link>
          <button type="button" className="btn-secondary text-red-600" onClick={handleDeleteHeader}>
            Delete BO#
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Bad Order Details</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label">BO Number</label>
            <input
              className="input"
              value={(form.bo_number as string) || ""}
              onChange={(e) => set("bo_number", e.target.value)}
            />
          </div>
          <div>
            <label className="label">Date Backload</label>
            <input
              type="date"
              className="input"
              value={(form.date_backload as string) || ""}
              onChange={(e) => set("date_backload", e.target.value)}
            />
          </div>
          <div>
            <label className="label">Status</label>
            <select
              className="input"
              value={(form.status as BadOrderStatus) || "Stored in Warehouse"}
              onChange={(e) => set("status", e.target.value)}
            >
              {BAD_ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Client</label>
            <select
              className="input"
              value={(form.client_id as string) || ""}
              onChange={(e) => {
                set("client_id", e.target.value);
                set("branch_id", "");
              }}
            >
              <option value="">— None —</option>
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
              value={(form.branch_id as string) || ""}
              onChange={(e) => set("branch_id", e.target.value)}
            >
              <option value="">— None —</option>
              {availableBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.branch_code} — {b.branch_name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea
            className="input"
            rows={2}
            value={(form.notes as string) || ""}
            onChange={(e) => set("notes", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Photos (damaged items, evidence)</label>
          <PhotoAttachments
            urls={(form.attachment_urls as string[]) || record?.attachment_urls || []}
            pathPrefix={`bad-orders/${id}`}
            onChange={saveAttachments}
          />
        </div>
        <button type="button" className="btn-primary" disabled={saving} onClick={handleSaveHeader}>
          {saving ? "Saving…" : "Save Header"}
        </button>
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            Item Lines &middot; {lines.length} line(s) &middot; {totalQty} total qty &middot;{" "}
            {peso(totalAmount)} total
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
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
                <tr key={l.id}>
                  <td>
                    <input
                      className="input"
                      value={(lineValue(l, "item_code") as string) || ""}
                      onChange={(e) => updateLineEdit(l.id, { item_code: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      value={(lineValue(l, "item_description") as string) || ""}
                      onChange={(e) => updateLineEdit(l.id, { item_description: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="any"
                      className="input text-right"
                      value={(lineValue(l, "qty") as number) ?? ""}
                      onChange={(e) => updateLineEdit(l.id, { qty: Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      value={(lineValue(l, "unit") as string) || ""}
                      onChange={(e) => updateLineEdit(l.id, { unit: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="any"
                      className="input text-right"
                      value={(lineValue(l, "unit_price") as number) ?? ""}
                      onChange={(e) => updateLineEdit(l.id, { unit_price: Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="any"
                      className="input text-right"
                      value={(lineValue(l, "amount") as number) ?? ""}
                      onChange={(e) => updateLineEdit(l.id, { amount: Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      className="input"
                      value={(lineValue(l, "expiration_date") as string) || ""}
                      onChange={(e) => updateLineEdit(l.id, { expiration_date: e.target.value })}
                    />
                  </td>
                  <td className="whitespace-nowrap">
                    <button
                      type="button"
                      className="text-brand-dark hover:underline text-xs font-medium mr-2"
                      disabled={!lineEdits[l.id] || saving}
                      onClick={() => handleSaveLine(l.id)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="text-red-500 hover:underline text-xs"
                      onClick={() => handleDeleteLine(l.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}

              {/* Add-line row */}
              <tr className="bg-gray-50">
                <td>
                  <select
                    className="input"
                    value={newLine.item_id}
                    onChange={(e) => handleNewLineItemSelect(e.target.value)}
                    disabled={!form.client_id}
                  >
                    <option value="">— Select item —</option>
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
                    placeholder="Item description"
                    value={newLine.item_description}
                    onChange={(e) => setNewLine((prev) => ({ ...prev, item_description: e.target.value }))}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="any"
                    className="input text-right"
                    placeholder="Qty"
                    value={newLine.qty}
                    onChange={(e) => setNewLine((prev) => ({ ...prev, qty: e.target.value }))}
                  />
                </td>
                <td>
                  <input
                    className="input"
                    placeholder="Unit"
                    value={newLine.unit}
                    onChange={(e) => setNewLine((prev) => ({ ...prev, unit: e.target.value }))}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="any"
                    className="input text-right"
                    placeholder="Unit Price"
                    value={newLine.unit_price}
                    onChange={(e) => setNewLine((prev) => ({ ...prev, unit_price: e.target.value }))}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="any"
                    className="input text-right"
                    placeholder="Amount"
                    value={newLine.amount}
                    onChange={(e) => setNewLine((prev) => ({ ...prev, amount: e.target.value }))}
                  />
                </td>
                <td>
                  <input
                    type="date"
                    className="input"
                    value={newLine.expiration_date}
                    onChange={(e) => setNewLine((prev) => ({ ...prev, expiration_date: e.target.value }))}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    disabled={addingLine}
                    onClick={handleAddLine}
                  >
                    {addingLine ? "Adding…" : "+ Add"}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400">
          Item Code auto-fills from the item&apos;s Mercury Item Code (falls back to the internal
          item code if none is set) — editable.
        </p>
      </div>
    </div>
  );
}

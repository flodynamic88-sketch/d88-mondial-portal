"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Client, Item, StoreVisitHeader, StoreVisitLine } from "@/lib/mercury/types";

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
}

function formatDateTime(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// A working copy of a line while in edit mode. `_removed` marks a line for
// deletion on Save without losing it from the array (so Cancel can restore
// it). Lines with no `id` are brand-new (added while editing).
type LineDraft = {
  id: string | null;
  client_id: string | null;
  item_id: string | null;
  client_code: string | null;
  client_name: string | null;
  item_code: string | null;
  item_description: string | null;
  qty: number;
  _removed?: boolean;
};

function toDraft(l: StoreVisitLine): LineDraft {
  return {
    id: l.id,
    client_id: l.client_id,
    item_id: l.item_id,
    client_code: l.client_code,
    client_name: l.client_name,
    item_code: l.item_code,
    item_description: l.item_description,
    qty: l.qty,
  };
}

export default function StoreVisitDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [record, setRecord] = useState<StoreVisitHeader | null>(null);
  const [lines, setLines] = useState<StoreVisitLine[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [lineDrafts, setLineDrafts] = useState<LineDraft[]>([]);
  const [newItemId, setNewItemId] = useState("");
  const [newQty, setNewQty] = useState("");

  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const [
      { data: headerData, error: headerErr },
      { data: linesData, error: linesErr },
      { data: itemsData },
    ] = await Promise.all([
      supabase.schema("flo").from("store_visit_headers").select("*").eq("id", id).single(),
      supabase
        .schema("flo").from("store_visit_lines")
        .select("*, clients(id, client_code, client_name), items(id, item_code, item_description, unit)")
        .eq("store_visit_header_id", id)
        .order("client_name", { ascending: true })
        .order("item_description", { ascending: true }),
      supabase
        .schema("flo").from("items")
        .select("*, clients(id, client_code, client_name)")
        .eq("status", "Active")
        .order("item_description")
        .range(0, 9999),
    ]);
    if (headerErr) setError(headerErr.message);
    if (linesErr) setError(linesErr.message);
    const header = (headerData as StoreVisitHeader) || null;
    setRecord(header);
    setForm((header as unknown as Record<string, unknown>) || {});
    setNotes(header?.notes || "");
    const ls = (linesData as unknown as StoreVisitLine[]) || [];
    setLines(ls);
    setLineDrafts(ls.map(toDraft));
    setItems((itemsData as unknown as Item[]) || []);
    setEditing(false);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function set(key: string, value: unknown) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function startEditing() {
    setForm((record as unknown as Record<string, unknown>) || {});
    setLineDrafts(lines.map(toDraft));
    setNewItemId("");
    setNewQty("");
    setEditing(true);
    setError(null);
  }

  function cancelEditing() {
    setForm((record as unknown as Record<string, unknown>) || {});
    setLineDrafts(lines.map(toDraft));
    setEditing(false);
    setError(null);
  }

  function updateLineQty(idx: number, qty: string) {
    setLineDrafts((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, qty: qty === "" ? 0 : Number(qty) } : l))
    );
  }

  function removeLine(idx: number) {
    setLineDrafts((prev) => prev.map((l, i) => (i === idx ? { ...l, _removed: true } : l)));
  }

  function restoreLine(idx: number) {
    setLineDrafts((prev) => prev.map((l, i) => (i === idx ? { ...l, _removed: false } : l)));
  }

  function addNewLine() {
    if (!newItemId) return;
    const item = items.find((i) => i.id === newItemId);
    if (!item) return;
    const client = (item as unknown as { clients?: Pick<Client, "id" | "client_code" | "client_name"> })
      .clients;
    setLineDrafts((prev) => [
      ...prev,
      {
        id: null,
        client_id: client?.id || null,
        item_id: item.id,
        client_code: client?.client_code || null,
        client_name: client?.client_name || null,
        item_code: item.item_code,
        item_description: item.item_description,
        qty: newQty === "" ? 0 : Number(newQty),
      },
    ]);
    setNewItemId("");
    setNewQty("");
  }

  async function handleSave() {
    if (!record) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();

    const { error: headerErr } = await supabase
      .schema("flo").from("store_visit_headers")
      .update({
        sales_coordinator_name: form.sales_coordinator_name,
        visit_date: form.visit_date,
        time_in: form.time_in || null,
        branch_code: form.branch_code || null,
        branch_name: form.branch_name || null,
        address: form.address || null,
        store_hours: form.store_hours || null,
        contact_no: form.contact_no || null,
        notes: notes.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", record.id);
    if (headerErr) {
      setSaving(false);
      setError(headerErr.message);
      return;
    }

    const toDelete = lineDrafts.filter((l) => l._removed && l.id).map((l) => l.id as string);
    const toUpdate = lineDrafts.filter((l) => !l._removed && l.id);
    const toInsert = lineDrafts.filter((l) => !l._removed && !l.id);

    if (toDelete.length > 0) {
      const { error: delErr } = await supabase.schema("flo").from("store_visit_lines").delete().in("id", toDelete);
      if (delErr) {
        setSaving(false);
        setError(delErr.message);
        return;
      }
    }

    for (const l of toUpdate) {
      const { error: updErr } = await supabase
        .schema("flo").from("store_visit_lines")
        .update({ qty: l.qty, updated_at: new Date().toISOString() })
        .eq("id", l.id as string);
      if (updErr) {
        setSaving(false);
        setError(updErr.message);
        return;
      }
    }

    if (toInsert.length > 0) {
      const { error: insErr } = await supabase.schema("flo").from("store_visit_lines").insert(
        toInsert.map((l) => ({
          store_visit_header_id: record.id,
          client_id: l.client_id,
          item_id: l.item_id,
          client_code: l.client_code,
          client_name: l.client_name,
          item_code: l.item_code,
          item_description: l.item_description,
          qty: l.qty,
        }))
      );
      if (insErr) {
        setSaving(false);
        setError(insErr.message);
        return;
      }
    }

    setSaving(false);
    await load();
  }

  async function handleDelete() {
    if (!record) return;
    if (!confirm("Delete this store visit and all its lines? This cannot be undone.")) return;
    setDeleting(true);
    const supabase = createClient();
    const { error } = await supabase.schema("flo").from("store_visit_headers").delete().eq("id", record.id);
    setDeleting(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/mercury/store-visits");
  }

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading…</div>;
  if (!record) return <div className="p-6 text-sm text-gray-400">Store visit not found.</div>;

  const visibleDrafts = lineDrafts.filter((l) => !l._removed);
  const totalQty = editing
    ? visibleDrafts.reduce((s, l) => s + (l.qty || 0), 0)
    : lines.reduce((s, l) => s + (l.qty || 0), 0);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Store Visit</h1>
          <p className="text-sm text-gray-500">
            {formatDate(record.visit_date)} &middot; {record.sales_coordinator_name} &middot;{" "}
            {record.branch_name || "—"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/mercury/store-visits" className="btn-secondary">
            Back to List
          </Link>
          {editing ? (
            <>
              <button className="btn-secondary" onClick={cancelEditing} disabled={saving}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </>
          ) : (
            <>
              <button className="btn-secondary" onClick={startEditing}>
                Edit
              </button>
              <button className="btn-secondary text-red-600" onClick={handleDelete} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Visit Details</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          <div>
            <div className="label">Sales Coordinator</div>
            {editing ? (
              <input
                className="input"
                value={(form.sales_coordinator_name as string) || ""}
                onChange={(e) => set("sales_coordinator_name", e.target.value)}
              />
            ) : (
              <div className="text-gray-900">{record.sales_coordinator_name}</div>
            )}
          </div>
          <div>
            <div className="label">Date Visit</div>
            {editing ? (
              <input
                type="date"
                className="input"
                value={(form.visit_date as string) || ""}
                onChange={(e) => set("visit_date", e.target.value)}
              />
            ) : (
              <div className="text-gray-900">{formatDate(record.visit_date)}</div>
            )}
          </div>
          <div>
            <div className="label">Time In</div>
            {editing ? (
              <input
                className="input"
                value={(form.time_in as string) || ""}
                onChange={(e) => set("time_in", e.target.value)}
              />
            ) : (
              <div className="text-gray-900">{record.time_in || "—"}</div>
            )}
          </div>
          <div>
            <div className="label">Branch Code</div>
            {editing ? (
              <input
                className="input"
                value={(form.branch_code as string) || ""}
                onChange={(e) => set("branch_code", e.target.value)}
              />
            ) : (
              <div className="text-gray-900">{record.branch_code || "—"}</div>
            )}
          </div>
          <div>
            <div className="label">Branch Name</div>
            {editing ? (
              <input
                className="input"
                value={(form.branch_name as string) || ""}
                onChange={(e) => set("branch_name", e.target.value)}
              />
            ) : (
              <div className="text-gray-900">{record.branch_name || "—"}</div>
            )}
          </div>
          <div>
            <div className="label">Address</div>
            {editing ? (
              <input
                className="input"
                value={(form.address as string) || ""}
                onChange={(e) => set("address", e.target.value)}
              />
            ) : (
              <div className="text-gray-900">{record.address || "—"}</div>
            )}
          </div>
          <div>
            <div className="label">Store Hours</div>
            {editing ? (
              <input
                className="input"
                value={(form.store_hours as string) || ""}
                onChange={(e) => set("store_hours", e.target.value)}
              />
            ) : (
              <div className="text-gray-900">{record.store_hours || "—"}</div>
            )}
          </div>
          <div>
            <div className="label">Contact #</div>
            {editing ? (
              <input
                className="input"
                value={(form.contact_no as string) || ""}
                onChange={(e) => set("contact_no", e.target.value)}
              />
            ) : (
              <div className="text-gray-900">{record.contact_no || "—"}</div>
            )}
          </div>
          <div>
            <div className="label">Submitted Via</div>
            <div className="text-gray-900">
              {record.submitted_via === "mobile_form" ? "Mobile Form (on-site)" : "Portal"}
            </div>
          </div>
          <div>
            <div className="label">Submitted At</div>
            <div className="text-gray-900">{formatDateTime(record.created_at)}</div>
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            Items Counted ({visibleDrafts.length} line{visibleDrafts.length === 1 ? "" : "s"} &middot;{" "}
            {totalQty} total qty)
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Client</th>
                <th>Item Code</th>
                <th>Item Description</th>
                <th className="text-right">Qty</th>
                {editing && <th className="text-right">Action</th>}
              </tr>
            </thead>
            <tbody>
              {(editing ? lineDrafts : lines.map(toDraft)).length === 0 ? (
                <tr>
                  <td colSpan={editing ? 5 : 4} className="text-center text-gray-400 py-4">
                    No items were counted on this visit.
                  </td>
                </tr>
              ) : editing ? (
                lineDrafts.map((l, idx) => (
                  <tr key={l.id || `new-${idx}`} className={l._removed ? "opacity-40" : ""}>
                    <td>{l.client_name || "—"}</td>
                    <td>{l.item_code || "—"}</td>
                    <td>{l.item_description || "—"}</td>
                    <td className="text-right">
                      <input
                        type="number"
                        className="input w-24 text-right"
                        value={l.qty}
                        disabled={l._removed}
                        onChange={(e) => updateLineQty(idx, e.target.value)}
                      />
                    </td>
                    <td className="text-right">
                      {l._removed ? (
                        <button className="text-teal-600 text-sm" onClick={() => restoreLine(idx)}>
                          Undo
                        </button>
                      ) : (
                        <button className="text-red-600 text-sm" onClick={() => removeLine(idx)}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.client_name || "—"}</td>
                    <td>{l.item_code || "—"}</td>
                    <td>{l.item_description || "—"}</td>
                    <td className="text-right">{l.qty}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {editing && (
          <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-gray-100">
            <div className="flex-1 min-w-[220px]">
              <div className="label">Add Item</div>
              <select className="input" value={newItemId} onChange={(e) => setNewItemId(e.target.value)}>
                <option value="">Select item…</option>
                {items.map((i) => {
                  const client = (i as unknown as { clients?: Pick<Client, "client_name"> }).clients;
                  return (
                    <option key={i.id} value={i.id}>
                      {client?.client_name ? `${client.client_name} — ` : ""}
                      {i.item_description}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="w-28">
              <div className="label">Qty</div>
              <input
                type="number"
                className="input"
                value={newQty}
                onChange={(e) => setNewQty(e.target.value)}
              />
            </div>
            <button className="btn-secondary" onClick={addNewLine} disabled={!newItemId}>
              + Add
            </button>
          </div>
        )}
      </div>

      {(
        <div className="card p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Notes</h2>
          <textarea
            className="input"
            rows={3}
            placeholder="Optional remarks"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button
            className="btn-primary"
            onClick={async () => {
              if (!record) return;
              setSaving(true);
              const supabase = createClient();
              const { error } = await supabase
                .schema("flo").from("store_visit_headers")
                .update({ notes: notes.trim() || null, updated_at: new Date().toISOString() })
                .eq("id", record.id);
              setSaving(false);
              if (error) {
                setError(error.message);
                return;
              }
              load();
            }}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save Notes"}
          </button>
        </div>
      )}
    </div>
  );
}

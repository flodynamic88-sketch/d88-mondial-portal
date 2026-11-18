"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/vas/supabase/client";

// Generic CRUD table for simple VAS master-data tables (Item Master, Kit/BOM
// header, Memo header, ...). Modeled directly on
// components/mercury/MercuryCrudTable.tsx, but scoped to the `vas` schema
// and with explicit canAdd/canEdit/canDelete props (VAS reuses the main
// app's own role system via useAuth(), unlike Mercury's separate internal
// RoleContext, so the caller passes the already-resolved booleans instead of
// this component knowing about roles itself).

export type VasColumnType = "text" | "number" | "date" | "select" | "textarea" | "fk" | "boolean";

export interface VasCrudColumn<T> {
  key: keyof T & string;
  label: string;
  type?: VasColumnType;
  options?: string[];
  fkOptions?: { value: string; label: string }[];
  required?: boolean;
  hideInTable?: boolean;
}

interface VasCrudTableProps<T extends { id: string }> {
  tableName: string;
  title: string;
  columns: VasCrudColumn<T>[];
  defaultOrder?: string;
  ascending?: boolean;
  emptyRow: Omit<T, "id">;
  searchPlaceholder?: string;
  /** When true, hides Add/Edit UI entirely. */
  readOnly?: boolean;
  /** When false, hides the Delete action only (VAS_OFFICER: encode, no delete). */
  canDelete?: boolean;
  onAfterSave?: (id: string, payload: Record<string, unknown>) => void | Promise<void>;
  /** Extra row-level action rendered before Edit/Delete, e.g. "Manage BOM". */
  renderExtraAction?: (row: T) => React.ReactNode;
  refreshKey?: number;
}

export default function VasCrudTable<T extends { id: string }>({
  tableName,
  title,
  columns,
  defaultOrder,
  ascending = true,
  emptyRow,
  searchPlaceholder,
  readOnly,
  canDelete = true,
  onAfterSave,
  renderExtraAction,
  refreshKey,
}: VasCrudTableProps<T>) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    let query = supabase.schema("vas").from(tableName).select("*");
    if (defaultOrder) query = query.order(defaultOrder, { ascending });
    const { data, error } = await query;
    if (error) setError(error.message);
    setRows((data as T[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName, refreshKey]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((row) =>
      columns.some((col) => {
        if (col.type === "fk") {
          const raw = (row as any)[col.key];
          const label = col.fkOptions?.find((o) => o.value === raw)?.label ?? "";
          return label.toLowerCase().includes(q);
        }
        return String((row as any)[col.key] ?? "").toLowerCase().includes(q);
      })
    );
  }, [rows, search, columns]);

  function startAdd() {
    if (readOnly) return;
    setForm({ ...emptyRow });
    setEditingId("new");
  }

  function startEdit(row: T) {
    if (readOnly) return;
    setForm({ ...row });
    setEditingId(row.id);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm({});
  }

  async function handleSave() {
    setError(null);

    const missing = columns.filter((col) => {
      if (!col.required) return false;
      const v = form[col.key];
      return v === undefined || v === null || v === "";
    });
    if (missing.length > 0) {
      setError(`Please fill in: ${missing.map((c) => c.label).join(", ")}`);
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const payload: Record<string, unknown> = {};
    for (const col of columns) {
      let v = form[col.key];
      if (col.type === "number") {
        v = v === "" || v === null || v === undefined ? null : Number(v);
      }
      if (v === "") v = null;
      payload[col.key] = v;
    }

    let savedId = editingId as string;

    if (editingId === "new") {
      const { data, error } = await supabase
        .schema("vas")
        .from(tableName)
        .insert(payload)
        .select("id")
        .single();
      if (error) {
        setError(error.message);
        setSaving(false);
        return;
      }
      savedId = (data as { id: string }).id;
    } else if (editingId) {
      const { error } = await supabase.schema("vas").from(tableName).update(payload).eq("id", editingId);
      if (error) {
        setError(error.message);
        setSaving(false);
        return;
      }
    }

    if (onAfterSave) {
      try {
        await onAfterSave(savedId, payload);
      } catch {
        // Non-fatal -- the main record already saved fine.
      }
    }

    setSaving(false);
    cancelEdit();
    load();
  }

  async function handleDelete(id: string) {
    if (!canDelete) return;
    if (!confirm("Delete this record? This cannot be undone.")) return;
    const supabase = createClient();
    const { error } = await supabase.schema("vas").from(tableName).delete().eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500">
            {filtered.length} record(s)
            {readOnly && <span className="ml-2 text-gray-400">&middot; View only</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <input
            className="input w-56"
            placeholder={searchPlaceholder || "Search…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {!readOnly && (
            <button className="btn-primary" onClick={startAdd}>
              + Add New
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {editingId && (
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">
            {editingId === "new" ? "Add New Record" : "Edit Record"}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {columns.map((col) => (
              <div key={col.key}>
                <label className="label">
                  {col.label}
                  {col.required && <span className="text-red-500"> *</span>}
                </label>
                {col.type === "boolean" ? (
                  <label className="flex items-center gap-2 pt-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300"
                      checked={!!form[col.key]}
                      onChange={(e) => setForm({ ...form, [col.key]: e.target.checked })}
                    />
                    <span className="text-sm text-gray-600">Yes</span>
                  </label>
                ) : col.type === "select" ? (
                  <select
                    className="input"
                    value={(form[col.key] as string) ?? ""}
                    onChange={(e) => setForm({ ...form, [col.key]: e.target.value })}
                  >
                    <option value="">— Select —</option>
                    {col.options?.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : col.type === "fk" ? (
                  <select
                    className="input"
                    value={(form[col.key] as string) ?? ""}
                    onChange={(e) => setForm({ ...form, [col.key]: e.target.value })}
                  >
                    {!col.required && <option value="">— None —</option>}
                    {col.fkOptions?.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : col.type === "textarea" ? (
                  <textarea
                    className="input"
                    rows={2}
                    value={(form[col.key] as string) ?? ""}
                    onChange={(e) => setForm({ ...form, [col.key]: e.target.value })}
                  />
                ) : (
                  <input
                    className="input"
                    type={col.type === "number" ? "number" : col.type === "date" ? "date" : "text"}
                    value={(form[col.key] as string | number) ?? ""}
                    onChange={(e) => setForm({ ...form, [col.key]: e.target.value })}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="btn-secondary" onClick={cancelEdit} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">No records found.</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                {columns
                  .filter((c) => !c.hideInTable)
                  .map((col) => (
                    <th key={col.key}>{col.label}</th>
                  ))}
                {(!readOnly || renderExtraAction) && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  {columns
                    .filter((c) => !c.hideInTable)
                    .map((col) => {
                      let display: string;
                      if (col.type === "fk") {
                        const raw = (row as any)[col.key];
                        display = col.fkOptions?.find((o) => o.value === raw)?.label ?? "";
                      } else if (col.type === "boolean") {
                        display = (row as any)[col.key] ? "Yes" : "No";
                      } else {
                        display = String((row as any)[col.key] ?? "");
                      }
                      return <td key={col.key}>{display}</td>;
                    })}
                  {(!readOnly || renderExtraAction) && (
                    <td className="space-x-2 whitespace-nowrap">
                      {renderExtraAction?.(row)}
                      {!readOnly && (
                        <button
                          className="text-brand-dark hover:underline text-xs font-medium"
                          onClick={() => startEdit(row)}
                        >
                          Edit
                        </button>
                      )}
                      {!readOnly && canDelete && (
                        <button
                          className="text-red-600 hover:underline text-xs font-medium"
                          onClick={() => handleDelete(row.id)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

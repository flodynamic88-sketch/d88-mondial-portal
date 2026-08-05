"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/mercury/supabase/client";

export type ColumnType = "text" | "number" | "date" | "select" | "textarea" | "fk" | "boolean";

export interface CrudColumn<T> {
  key: keyof T & string;
  label: string;
  type?: ColumnType;
  options?: string[];
  fkOptions?: { value: string; label: string }[];
  required?: boolean;
  hideInTable?: boolean;
  width?: string;
}

interface CrudTableProps<T extends { id: string }> {
  tableName: string;
  title: string;
  columns: CrudColumn<T>[];
  defaultOrder?: string;
  emptyRow: Omit<T, "id">;
  searchPlaceholder?: string;
  filterColumn?: string;
  filterValue?: string | null;
  /** When true, hides Add/Edit/Delete UI — view-only mode (e.g. General Manager). */
  readOnly?: boolean;
  /**
   * When set, "+ Add New" auto-fills this column with the next sequential
   * code (prefix + zero-padded number) based on existing rows, e.g. C-0001,
   * C-0002, ... The field is shown as fixed/non-editable while adding.
   */
  autoCode?: { column: keyof T & string; prefix: string; padLength?: number };
  /**
   * Called right after a successful Add/Edit save, with the exact payload
   * that was just written. Use this for "propagate this to related rows"
   * side-effects (e.g. copying a Branch's registered_name/tin/registered
   * address to every other branch of the same retail chain) without baking
   * table-specific logic into this generic component.
   */
  onAfterSave?: (payload: Record<string, unknown>) => void | Promise<void>;
  /**
   * When set, warns (non-blocking, via confirm()) before Add/Edit save if
   * another row already shares the same values for the given columns —
   * e.g. catching an accidental duplicate item description for the same
   * client. The user can still choose to save anyway.
   */
  duplicateCheck?: { matchColumns: (keyof T & string)[]; label?: string };
}

export default function CrudTable<T extends { id: string }>({
  tableName,
  title,
  columns,
  defaultOrder,
  emptyRow,
  searchPlaceholder,
  filterColumn,
  filterValue,
  readOnly,
  autoCode,
  onAfterSave,
  duplicateCheck,
}: CrudTableProps<T>) {
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
    let query = supabase.schema("flo").from(tableName).select("*");
    if (filterColumn && filterValue) query = query.eq(filterColumn, filterValue);
    if (defaultOrder) query = query.order(defaultOrder, { ascending: true });
    const { data, error } = await query;
    if (error) setError(error.message);
    setRows((data as T[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName, filterColumn, filterValue]);

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
    const init: Record<string, unknown> = { ...emptyRow };
    if (autoCode) {
      const pad = autoCode.padLength ?? 4;
      const nums = rows
        .map((r) => String((r as any)[autoCode.column] || ""))
        .filter((c) => c.startsWith(autoCode.prefix))
        .map((c) => parseInt(c.slice(autoCode.prefix.length), 10))
        .filter((n) => !isNaN(n));
      const next = (nums.length ? Math.max(...nums) : 0) + 1;
      init[autoCode.column] = `${autoCode.prefix}${String(next).padStart(pad, "0")}`;
    }
    setForm(init);
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
      setError(`Kailangan punan muna: ${missing.map((c) => c.label).join(", ")}`);
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

    if (duplicateCheck) {
      let dupQuery = supabase.schema("flo").from(tableName).select("id").limit(1);
      let hasMatchValue = false;
      for (const col of duplicateCheck.matchColumns) {
        const val = payload[col];
        if (val === null || val === undefined || val === "") continue;
        hasMatchValue = true;
        dupQuery = typeof val === "string" ? dupQuery.ilike(col as string, val) : dupQuery.eq(col as string, val as any);
      }
      if (editingId !== "new") dupQuery = dupQuery.neq("id", editingId as string);
      if (hasMatchValue) {
        const { data: dupRows } = await dupQuery;
        if (dupRows && dupRows.length > 0) {
          const proceed = confirm(
            `May kaparehong ${duplicateCheck.label || "record"} na. Sigurado ka bang i-save pa rin ito?`
          );
          if (!proceed) {
            setSaving(false);
            return;
          }
        }
      }
    }

    if (editingId === "new") {
      const { error } = await supabase.schema("flo").from(tableName).insert(payload);
      if (error) {
        setError(error.message);
        setSaving(false);
        return;
      }
    } else if (editingId) {
      const { error } = await supabase.schema("flo").from(tableName).update(payload).eq("id", editingId);
      if (error) {
        setError(error.message);
        setSaving(false);
        return;
      }
    }

    if (onAfterSave) {
      try {
        await onAfterSave(payload);
      } catch {
        // Non-fatal — the main record already saved fine; a side-effect
        // failing here shouldn't block the user from continuing.
      }
    }

    setSaving(false);
    cancelEdit();
    load();
  }

  async function handleDelete(id: string) {
    if (readOnly) return;
    if (!confirm("Delete this record? This cannot be undone.")) return;
    const supabase = createClient();
    const { error } = await supabase.schema("flo").from(tableName).delete().eq("id", id);
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
                {autoCode && col.key === autoCode.column && editingId === "new" ? (
                  <input
                    className="input bg-gray-50"
                    readOnly
                    value={(form[col.key] as string) ?? ""}
                  />
                ) : col.type === "boolean" ? (
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
                {!readOnly && <th>Actions</th>}
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
                  {!readOnly && (
                    <td className="space-x-2">
                      <button
                        className="text-brand-dark hover:underline text-xs font-medium"
                        onClick={() => startEdit(row)}
                      >
                        Edit
                      </button>
                      <button
                        className="text-red-600 hover:underline text-xs font-medium"
                        onClick={() => handleDelete(row.id)}
                      >
                        Delete
                      </button>
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

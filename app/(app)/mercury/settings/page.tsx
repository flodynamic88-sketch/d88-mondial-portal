"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/mercury/supabase/client";
import {
  LOOKUP_CATEGORIES,
  LOOKUP_CATEGORY_LABELS,
  type LookupCategory,
  type LookupValue,
} from "@/lib/mercury/types";
import { useRole } from "@/lib/mercury/RoleContext";

export default function SettingsPage() {
  const role = useRole();
  const readOnly = role === "general_manager";
  const [category, setCategory] = useState<LookupCategory>(LOOKUP_CATEGORIES[0]);
  const [values, setValues] = useState<LookupValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newValue, setNewValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  async function load(cat: LookupCategory) {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .schema("flo").from("lookup_values")
      .select("*")
      .eq("category", cat)
      .order("sort_order", { ascending: true });
    if (error) setError(error.message);
    setValues((data as LookupValue[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load(category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  async function handleAdd() {
    if (readOnly || !newValue.trim()) return;
    const supabase = createClient();
    const nextSort = values.length ? Math.max(...values.map((v) => v.sort_order)) + 1 : 1;
    const { error } = await supabase
      .schema("flo").from("lookup_values")
      .insert({ category, value: newValue.trim(), sort_order: nextSort, is_active: true });
    if (error) {
      setError(error.message);
      return;
    }
    setNewValue("");
    load(category);
  }

  async function handleToggleActive(v: LookupValue) {
    if (readOnly) return;
    const supabase = createClient();
    const { error } = await supabase
      .schema("flo").from("lookup_values")
      .update({ is_active: !v.is_active })
      .eq("id", v.id);
    if (error) {
      setError(error.message);
      return;
    }
    load(category);
  }

  async function handleSaveEdit(id: string) {
    if (readOnly) return;
    const supabase = createClient();
    const { error } = await supabase
      .schema("flo").from("lookup_values")
      .update({ value: editingValue })
      .eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    setEditingId(null);
    load(category);
  }

  async function handleDelete(id: string) {
    if (readOnly) return;
    if (!confirm("Delete this setting value?")) return;
    const supabase = createClient();
    const { error } = await supabase.schema("flo").from("lookup_values").delete().eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    load(category);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500">
          Manage dropdown reference values used throughout the app (delivery status,
          carriers, drivers, etc.)
          {readOnly && <span className="ml-2 text-gray-400">&middot; View only</span>}
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {LOOKUP_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              category === cat
                ? "bg-brand text-white"
                : "bg-white border border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {LOOKUP_CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      <div className="card p-5 space-y-4">
        {!readOnly && (
          <div className="flex gap-2">
            <input
              className="input"
              placeholder={`Add a new ${LOOKUP_CATEGORY_LABELS[category]} value…`}
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <button className="btn-primary whitespace-nowrap" onClick={handleAdd}>
              + Add
            </button>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : values.length === 0 ? (
          <div className="text-sm text-gray-400">No values yet for this category.</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>#</th>
                <th>Value</th>
                <th>Active</th>
                {!readOnly && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {values.map((v) => (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td>{v.sort_order}</td>
                  <td>
                    {editingId === v.id ? (
                      <input
                        className="input"
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSaveEdit(v.id)}
                        autoFocus
                      />
                    ) : (
                      v.value
                    )}
                  </td>
                  <td>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        v.is_active
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-500"
                      } ${readOnly ? "" : "cursor-pointer"}`}
                      onClick={() => !readOnly && handleToggleActive(v)}
                    >
                      {v.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  {!readOnly && (
                    <td className="space-x-2">
                      {editingId === v.id ? (
                        <>
                          <button
                            className="text-brand-dark hover:underline text-xs font-medium"
                            onClick={() => handleSaveEdit(v.id)}
                          >
                            Save
                          </button>
                          <button
                            className="text-gray-500 hover:underline text-xs font-medium"
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="text-brand-dark hover:underline text-xs font-medium"
                            onClick={() => {
                              setEditingId(v.id);
                              setEditingValue(v.value);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="text-red-600 hover:underline text-xs font-medium"
                            onClick={() => handleDelete(v.id)}
                          >
                            Delete
                          </button>
                        </>
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

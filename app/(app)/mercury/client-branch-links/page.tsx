"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Branch, Client, ClientBranchLink } from "@/lib/mercury/types";
import { useRole } from "@/lib/mercury/RoleContext";

export default function ClientBranchLinksPage() {
  const role = useRole();
  const readOnly = role === "general_manager";
  const [links, setLinks] = useState<ClientBranchLink[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [selectedClient, setSelectedClient] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadAll() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const [linksRes, clientsRes, branchesRes] = await Promise.all([
      supabase
        .schema("flo").from("client_branch_links")
        .select("*, clients(id, client_code, client_name), branches(id, branch_code, branch_name)")
        .order("created_at", { ascending: false })
        .range(0, 9999),
      supabase.schema("flo").from("clients").select("*").order("client_code").range(0, 9999),
      supabase.schema("flo").from("branches").select("*").order("branch_code").range(0, 9999),
    ]);
    if (linksRes.error) setError(linksRes.error.message);
    setLinks((linksRes.data as unknown as ClientBranchLink[]) || []);
    setClients((clientsRes.data as Client[]) || []);
    setBranches((branchesRes.data as Branch[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return links;
    const q = search.toLowerCase();
    return links.filter(
      (l) =>
        l.clients?.client_name.toLowerCase().includes(q) ||
        l.clients?.client_code.toLowerCase().includes(q) ||
        l.branches?.branch_name.toLowerCase().includes(q) ||
        l.branches?.branch_code.toLowerCase().includes(q)
    );
  }, [links, search]);

  async function handleAdd() {
    if (readOnly) return;
    if (!selectedClient || !selectedBranch) {
      setError("Please select both a client and a branch.");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .schema("flo").from("client_branch_links")
      .insert({ client_id: selectedClient, branch_id: selectedBranch, notes: notes || null });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setShowForm(false);
    setSelectedClient("");
    setSelectedBranch("");
    setNotes("");
    loadAll();
  }

  async function handleDelete(id: string) {
    if (readOnly) return;
    if (!confirm("Remove this client-branch link?")) return;
    const supabase = createClient();
    const { error } = await supabase.schema("flo").from("client_branch_links").delete().eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    loadAll();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Client — Branch Links</h1>
          <p className="text-sm text-gray-500">
            {filtered.length} link(s). Drives the cascading Client → Branch dropdown when
            encoding deliveries.
            {readOnly && <span className="ml-2 text-gray-400">&middot; View only</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <input
            className="input w-56"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {!readOnly && (
            <button className="btn-primary" onClick={() => setShowForm(true)}>
              + Add Link
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {showForm && (
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Add New Link</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Client</label>
              <select
                className="input"
                value={selectedClient}
                onChange={(e) => setSelectedClient(e.target.value)}
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
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
              >
                <option value="">— Select Branch —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.branch_code} — {b.branch_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Notes</label>
              <input
                className="input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={handleAdd} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="btn-secondary" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">No links found.</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Client Code</th>
                <th>Client Name</th>
                <th>Branch Code</th>
                <th>Branch Name</th>
                <th>Notes</th>
                {!readOnly && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td>{l.clients?.client_code}</td>
                  <td>{l.clients?.client_name}</td>
                  <td>{l.branches?.branch_code}</td>
                  <td>{l.branches?.branch_name}</td>
                  <td>{l.notes}</td>
                  {!readOnly && (
                    <td>
                      <button
                        className="text-red-600 hover:underline text-xs font-medium"
                        onClick={() => handleDelete(l.id)}
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

"use client";

import { useCallback, useEffect, useState } from "react";
import RequireRole from "@/components/RequireRole";
import { ALL_ROLES, ROLE_LABELS } from "@/lib/roles";
import type { UserProfile, UserRole } from "@/types/database";

function UserManagementInner() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("LOGISTICS_ASSOCIATE");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [resetPasswordId, setResetPasswordId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editFullName, setEditFullName] = useState("");

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/users");
      const body = await res.json();
      if (!res.ok) {
        setLoadError(body.error ?? "Failed to load users.");
        setUsers([]);
        return;
      }
      setUsers(body.users ?? []);
    } catch {
      setLoadError("Could not load users.");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);

    if (!username.trim()) {
      setCreateError("Username is required.");
      return;
    }
    if (password.length < 6) {
      setCreateError("Password must be at least 6 characters.");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password, full_name: fullName, role }),
      });
      const body = await res.json();
      if (!res.ok) {
        setCreateError(body.error ?? "Failed to create user.");
        return;
      }
      setUsername("");
      setFullName("");
      setPassword("");
      setRole("LOGISTICS_ASSOCIATE");
      await loadUsers();
    } catch {
      setCreateError("Could not create user.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRoleChange(id: string, newRole: UserRole) {
    setBusyId(id);
    setRowError(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      const body = await res.json();
      if (!res.ok) {
        setRowError(body.error ?? "Failed to update role.");
        return;
      }
      await loadUsers();
    } catch {
      setRowError("Could not update role.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleResetPassword(id: string) {
    if (newPassword.length < 6) {
      setRowError("New password must be at least 6 characters.");
      return;
    }
    setBusyId(id);
    setRowError(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      const body = await res.json();
      if (!res.ok) {
        setRowError(body.error ?? "Failed to reset password.");
        return;
      }
      setResetPasswordId(null);
      setNewPassword("");
    } catch {
      setRowError("Could not reset password.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaveDetails(id: string) {
    if (!editUsername.trim()) {
      setRowError("Username cannot be empty.");
      return;
    }
    setBusyId(id);
    setRowError(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: editUsername.trim(), full_name: editFullName }),
      });
      const body = await res.json();
      if (!res.ok) {
        setRowError(body.error ?? "Failed to update account.");
        return;
      }
      setEditingId(null);
      await loadUsers();
    } catch {
      setRowError("Could not update account.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string, label: string) {
    if (!window.confirm(`Remove ${label}'s account? This cannot be undone.`)) return;
    setBusyId(id);
    setRowError(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) {
        setRowError(body.error ?? "Failed to delete user.");
        return;
      }
      await loadUsers();
    } catch {
      setRowError("Could not delete user.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">User Management</h1>
          <p className="page-subtitle">
            Create accounts and assign roles for everyone who needs access to the portal.
          </p>
        </div>
      </div>

      <div className="card mt-6">
        <h2 className="text-sm font-semibold text-gray-700">Add User</h2>
        <form
          onSubmit={handleCreate}
          className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
        >
          <div>
            <label className="label">Username</label>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. jdelacruz"
              required
            />
          </div>
          <div>
            <label className="label">Full Name</label>
            <input
              className="input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Juan Dela Cruz"
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 6 characters"
              required
            />
          </div>
          <div>
            <label className="label">Role</label>
            <select
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
            >
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-primary" disabled={creating}>
            {creating ? "Creating…" : "Create User"}
          </button>
        </form>
        {createError && <p className="mt-2 text-sm text-red-600">{createError}</p>}
      </div>

      <div className="card mt-6">
        <h2 className="text-sm font-semibold text-gray-700">Accounts</h2>

        {rowError && <p className="mt-2 text-sm text-red-600">{rowError}</p>}
        {loading && <p className="mt-3 text-sm text-gray-400">Loading…</p>}
        {!loading && loadError && <p className="mt-3 text-sm text-gray-400">{loadError}</p>}
        {!loading && !loadError && users.length === 0 && (
          <p className="mt-3 text-sm text-gray-400">No user accounts yet.</p>
        )}

        {!loading && !loadError && users.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase text-gray-500">
                  <th className="py-2 pr-4">Username</th>
                  <th className="py-2 pr-4">Full Name</th>
                  <th className="py-2 pr-4">Role</th>
                  <th className="py-2 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2 pr-4 font-medium text-gray-800">
                      {editingId === u.id ? (
                        <input
                          className="input w-36"
                          value={editUsername}
                          onChange={(e) => setEditUsername(e.target.value)}
                          disabled={busyId === u.id}
                        />
                      ) : (
                        u.username
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {editingId === u.id ? (
                        <input
                          className="input w-40"
                          value={editFullName}
                          onChange={(e) => setEditFullName(e.target.value)}
                          disabled={busyId === u.id}
                        />
                      ) : (
                        u.full_name ?? "—"
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <select
                        className="input w-auto"
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                        disabled={busyId === u.id}
                      >
                        {ALL_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {editingId === u.id ? (
                          <>
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={() => handleSaveDetails(u.id)}
                              disabled={busyId === u.id}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="tab-button tab-button-inactive"
                              onClick={() => setEditingId(null)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="tab-button tab-button-inactive"
                            onClick={() => {
                              setEditingId(u.id);
                              setEditUsername(u.username);
                              setEditFullName(u.full_name ?? "");
                              setResetPasswordId(null);
                            }}
                          >
                            Edit
                          </button>
                        )}
                        {resetPasswordId === u.id ? (
                          <>
                            <input
                              type="password"
                              className="input w-36"
                              placeholder="New password"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                            />
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={() => handleResetPassword(u.id)}
                              disabled={busyId === u.id}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="tab-button tab-button-inactive"
                              onClick={() => {
                                setResetPasswordId(null);
                                setNewPassword("");
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="tab-button tab-button-inactive"
                            onClick={() => {
                              setResetPasswordId(u.id);
                              setNewPassword("");
                            }}
                          >
                            Reset Password
                          </button>
                        )}
                        <button
                          type="button"
                          className="tab-button tab-button-inactive text-red-600"
                          onClick={() => handleDelete(u.id, u.username)}
                          disabled={busyId === u.id}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function UserManagementPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <UserManagementInner />
    </RequireRole>
  );
}

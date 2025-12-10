"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { BUILDINGS } from "@/lib/buildings"; // ✅ shared buildings

const ACCESS_ROLES = [
  "Worker",
  "Lead",
  "Supervisor",
  "Building Manager",
  "HR",
  "HQ",
  "Admin",
  "Super Admin",
] as const;

type AccessRole = (typeof ACCESS_ROLES)[number];

type UserAccountRow = {
  id: string;
  email: string;
  name: string | null;
  access_role: string | null;
  building: string | null;
  active: boolean | null;
  created_at: string | null;
  last_login_at?: string | null;
};

const USER_ACCOUNTS_TABLE = "user_accounts";

export default function UserAccountsPage() {
  const currentUser = useCurrentUser(); // redirect handled inside hook

  const [users, setUsers] = useState<UserAccountRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // extra status for auth actions
  const [authActionLoading, setAuthActionLoading] = useState<string | null>(
    null
  );

  // Form state for create / edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [building, setBuilding] = useState<string>("DC18");
  const [role, setRole] = useState<AccessRole>("Worker");
  const [active, setActive] = useState<boolean>(true);

  // Filters
  const [filterBuilding, setFilterBuilding] = useState<string>("ALL");
  const [filterRole, setFilterRole] = useState<string>("ALL");
  const [search, setSearch] = useState<string>("");

  // Only Super Admins can access this page
  const isSuperAdmin = currentUser?.accessRole === "Super Admin";

  useEffect(() => {
    if (!currentUser) return;
    if (!isSuperAdmin) return;
    refreshUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, isSuperAdmin]);

  async function refreshUsers() {
    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const { data, error } = await supabase
        .from(USER_ACCOUNTS_TABLE)
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error loading user accounts", error);
        setError("Failed to load user accounts from Supabase.");
        setUsers([]);
        return;
      }

      setUsers((data || []) as UserAccountRow[]);
    } catch (e) {
      console.error("Unexpected error loading user accounts", e);
      setError("Unexpected error loading user accounts.");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setEditingId(null);
    setName("");
    setEmail("");
    setBuilding("DC18");
    setRole("Worker");
    setActive(true);
  }

  function startEdit(u: UserAccountRow) {
    setEditingId(u.id);
    setName(u.name || "");
    setEmail(u.email || "");
    setBuilding(u.building || "DC18");
    const r = (u.access_role as AccessRole) || "Worker";
    setRole(ACCESS_ROLES.includes(r) ? r : "Worker");
    setActive(u.active ?? true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isSuperAdmin) return;

    setError(null);
    setInfo(null);

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();

    if (!trimmedEmail) {
      setError("Email is required.");
      return;
    }

    try {
      setSaving(true);

      if (editingId) {
        // UPDATE
        const { error } = await supabase
          .from(USER_ACCOUNTS_TABLE)
          .update({
            email: trimmedEmail,
            name: trimmedName || null,
            building: building || null,
            access_role: role,
            active,
          })
          .eq("id", editingId);

        if (error) {
          console.error("Error updating user account", error);
          setError("Failed to update user account.");
          return;
        }

        setInfo("User account updated.");
      } else {
        // INSERT
        const { error } = await supabase.from(USER_ACCOUNTS_TABLE).insert({
          email: trimmedEmail,
          name: trimmedName || null,
          building: building || null,
          access_role: role,
          active: true,
        });

        if (error) {
          console.error("Error creating user account", error);
          setError("Failed to create user account.");
          return;
        }

        setInfo("User account created.");
      }

      resetForm();
      await refreshUsers();
    } catch (e) {
      console.error("Unexpected error saving user account", e);
      setError("Unexpected error while saving user account.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!isSuperAdmin) return;

    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "Delete this user account record? This does NOT delete the Supabase auth user, but will remove this record."
      );
      if (!ok) return;
    }

    try {
      setError(null);
      setInfo(null);
      const { error } = await supabase
        .from(USER_ACCOUNTS_TABLE)
        .delete()
        .eq("id", id);

      if (error) {
        console.error("Error deleting user account", error);
        setError("Failed to delete user account.");
        return;
      }

      if (editingId === id) resetForm();
      setInfo("User account deleted.");
      await refreshUsers();
    } catch (e) {
      console.error("Unexpected error deleting user account", e);
      setError("Unexpected error deleting user account.");
    }
  }

  async function toggleActive(u: UserAccountRow) {
    if (!isSuperAdmin) return;

    try {
      setError(null);
      setInfo(null);
      const { error } = await supabase
        .from(USER_ACCOUNTS_TABLE)
        .update({ active: !u.active })
        .eq("id", u.id);

      if (error) {
        console.error("Error toggling active state", error);
        setError("Failed to update active status.");
        return;
      }

      setInfo("User active status updated.");
      await refreshUsers();
    } catch (e) {
      console.error("Unexpected error toggling active status", e);
      setError("Unexpected error updating active status.");
    }
  }

  async function handleCreateAuthUser(u: UserAccountRow) {
    if (!isSuperAdmin) return;
    if (!u.email) {
      setError("User row has no email.");
      return;
    }

    setError(null);
    setInfo(null);
    setAuthActionLoading(u.id + "-auth");

    try {
      const res = await fetch("/api/auth-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: u.email,
          name: u.name,
          accessRole: u.access_role || "Worker",
          building: u.building,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        console.error("Error from /api/auth-users", data);
        setError(
          data.error ||
            "Failed to create Supabase Auth user. Check server logs."
        );
        return;
      }

      setInfo(
        data.message ||
          "Auth user created or already exists. You can now send a password reset email."
      );
    } catch (e) {
      console.error("Unexpected error calling /api/auth-users", e);
      setError("Unexpected error creating Auth user.");
    } finally {
      setAuthActionLoading(null);
    }
  }

  async function handleSendPasswordReset(u: UserAccountRow) {
    if (!isSuperAdmin) return;
    if (!u.email) {
      setError("User row has no email.");
      return;
    }

    setError(null);
    setInfo(null);
    setAuthActionLoading(u.id + "-reset");

    try {
      const res = await fetch("/api/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: u.email }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        console.error("Error from /api/password-reset", data);
        setError(
          data.error ||
            "Failed to send password reset email. Check server logs."
        );
        return;
      }

      setInfo(
        data.message ||
          "Password reset email sent (if the Auth user exists)."
      );
    } catch (e) {
      console.error("Unexpected error calling /api/password-reset", e);
      setError("Unexpected error sending password reset email.");
    } finally {
      setAuthActionLoading(null);
    }
  }

  const filteredUsers = useMemo(() => {
    let list = [...users];

    if (filterBuilding !== "ALL") {
      list = list.filter((u) => (u.building || "") === filterBuilding);
    }
    if (filterRole !== "ALL") {
      list = list.filter((u) => (u.access_role || "") === filterRole);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((u) => {
        const email = u.email?.toLowerCase() || "";
        const name = u.name?.toLowerCase() || "";
        const building = u.building?.toLowerCase() || "";
        return (
          email.includes(q) ||
          name.includes(q) ||
          building.includes(q)
        );
      });
    }

    return list;
  }, [users, filterBuilding, filterRole, search]);

  // Route protection
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center text-sm">
        Redirecting to login…
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50 flex flex-col items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3 text-sm">
          <h1 className="text-xl font-semibold text-slate-50">
            Restricted Area
          </h1>
          <p className="text-slate-400">
            Only{" "}
            <span className="font-semibold text-emerald-300">
              Super Admins
            </span>{" "}
            can manage user accounts and access levels.
          </p>
          <Link
            href="/"
            className="inline-flex items-center px-3 py-1.5 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 text-xs"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50">
      <div className="mx-auto max-w-7xl p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">
              User Accounts & Access
            </h1>
            <p className="text-sm text-slate-400">
              Manage roles, buildings, and login access for Precision Pulse
              users. Only{" "}
              <span className="font-semibold text-emerald-300">
                Super Admins
              </span>{" "}
              can access this page.
            </p>
            {loading && (
              <p className="mt-1 text-[11px] text-slate-500">
                Loading user accounts…
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 text-xs">
            <div className="text-right text-slate-300">
              Signed in as{" "}
              <span className="font-semibold">
                {currentUser.email}
              </span>{" "}
              ({currentUser.accessRole})
            </div>
            <Link
              href="/"
              className="inline-flex items-center px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
            >
              ← Back to Dashboard
            </Link>
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div className="text-xs text-red-300 bg-red-950/40 border border-red-800 rounded px-3 py-2">
            {error}
          </div>
        )}
        {info && (
          <div className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-800 rounded px-3 py-2">
            {info}
          </div>
        )}

        {/* Layout: form + list */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs space-y-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-slate-200 text-sm font-semibold">
                {editingId ? "Edit User Account" : "Add User Account"}
              </div>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-[11px] text-sky-300 hover:underline"
                >
                  Clear / New
                </button>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Email (login)
                </label>
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                  placeholder="user@precisionlumping.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Name (optional)
                </label>
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                  placeholder="Example: Jane Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Building
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={building}
                    onChange={(e) => setBuilding(e.target.value)}
                  >
                    {BUILDINGS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-slate-500">
                    Controls their default building view (e.g. Leads).
                  </p>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Access Role
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={role}
                    onChange={(e) =>
                      setRole(e.target.value as AccessRole)
                    }
                  >
                    {ACCESS_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-slate-500">
                    Leads see only their building; HQ/Admin/Super Admin
                    see all buildings.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="active"
                  type="checkbox"
                  className="rounded border-slate-600 bg-slate-950"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                />
                <label
                  htmlFor="active"
                  className="text-[11px] text-slate-400"
                >
                  Active account
                </label>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="mt-1 w-full rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-[11px] font-medium text-white px-4 py-2"
              >
                {saving
                  ? editingId
                    ? "Saving…"
                    : "Creating…"
                  : editingId
                  ? "Save Changes"
                  : "Add User"}
              </button>

              <p className="text-[10px] text-slate-500 mt-1">
                Creating/updating here manages{" "}
                <span className="font-semibold">
                  roles & buildings in the internal table
                </span>
                . Use{" "}
                <span className="font-semibold">
                  "Create Auth" & "Send Reset"
                </span>{" "}
                to manage their actual Supabase login.
              </p>
            </form>
          </div>

          {/* Filters + list */}
          <div className="lg:col-span-2 space-y-4">
            {/* Filters */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-slate-200 text-sm font-semibold">
                    Filters
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Filter by building, role, or search by name/email.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFilterBuilding("ALL");
                    setFilterRole("ALL");
                    setSearch("");
                  }}
                  className="text-[11px] text-sky-300 hover:underline"
                >
                  Reset
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Building
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={filterBuilding}
                    onChange={(e) =>
                      setFilterBuilding(e.target.value)
                    }
                  >
                    <option value="ALL">All Buildings</option>
                    {BUILDINGS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Role
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={filterRole}
                    onChange={(e) => setFilterRole(e.target.value)}
                  >
                    <option value="ALL">All Roles</option>
                    {ACCESS_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Search
                  </label>
                  <input
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    placeholder="Name, email, building..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* List */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
              <div className="flex items-center justify-between mb-2">
                <div className="text-slate-200 text-sm font-semibold">
                  User Accounts
                </div>
                <div className="text-[11px] text-slate-500">
                  Total:{" "}
                  <span className="font-semibold text-slate-200">
                    {users.length}
                  </span>{" "}
                  · Showing:{" "}
                  <span className="font-semibold text-slate-200">
                    {filteredUsers.length}
                  </span>
                </div>
              </div>

              {filteredUsers.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No users match the current filters.
                </p>
              ) : (
                <div className="overflow-auto max-h-[520px]">
                  <table className="min-w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/60">
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Name / Email
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Role
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Building
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Status
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Created
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((u) => {
                        const badgeClass = u.active
                          ? "bg-emerald-900/60 text-emerald-200 border border-emerald-700/70"
                          : "bg-slate-900/80 text-slate-300 border border-slate-700/70";

                        const roleLabel = u.access_role || "Worker";

                        const loadingAuth = authActionLoading === u.id + "-auth";
                        const loadingReset =
                          authActionLoading === u.id + "-reset";

                        return (
                          <tr
                            key={u.id}
                            className="border-b border-slate-800/60 hover:bg-slate-900/60"
                          >
                            <td className="px-3 py-2 text-slate-100">
                              <div className="text-xs font-medium">
                                {u.name || "—"}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {u.email}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              {roleLabel}
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              {u.building || "—"}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={
                                  "inline-flex rounded-full px-2 py-0.5 text-[10px] " +
                                  badgeClass
                                }
                              >
                                {u.active ? "Active" : "Inactive"}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              {u.created_at
                                ? u.created_at.slice(0, 10)
                                : "—"}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="inline-flex flex-wrap gap-2 justify-end">
                                <button
                                  type="button"
                                  onClick={() => startEdit(u)}
                                  className="text-[11px] text-sky-300 hover:underline"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleActive(u)}
                                  className="text-[11px] text-amber-300 hover:underline"
                                >
                                  {u.active ? "Deactivate" : "Activate"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCreateAuthUser(u)}
                                  disabled={loadingAuth}
                                  className="text-[11px] text-emerald-300 hover:underline disabled:opacity-60"
                                >
                                  {loadingAuth
                                    ? "Creating Auth…"
                                    : "Create Auth"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSendPasswordReset(u)}
                                  disabled={loadingReset}
                                  className="text-[11px] text-sky-200 hover:underline disabled:opacity-60"
                                >
                                  {loadingReset
                                    ? "Sending Reset…"
                                    : "Send Reset"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(u.id)}
                                  className="text-[11px] text-rose-300 hover:underline"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, FormEvent } from "react";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { useRouter } from "next/navigation";

type UserProfile = {
  id: string;
  email: string;
  full_name: string | null;
  access_role: string;
  building: string;
  created_at: string;
};

const BUILDINGS = ["DC1", "DC5", "DC11", "DC14", "DC18"];
const ROLES = [
  "Super Admin",
  "Director of Operations",
  "Regional Manager",
  "Building Manager",
  "HR",
  "Lead",
];

export default function UserAccountsPage() {
  const currentUser = useCurrentUser();
  const router = useRouter();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New user form state
  const [newFullName, setNewFullName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newBuilding, setNewBuilding] = useState("DC18");
  const [newRole, setNewRole] = useState("Building Manager");
  const [newPassword, setNewPassword] = useState("");

  // Local edit buffer
  const [editBuffer, setEditBuffer] = useState<Record<string, Partial<UserProfile>>>(
    {}
  );

  // Protect route: only Super Admin can see
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center text-sm">
        Checking access…
      </div>
    );
  }

  if (currentUser.accessRole !== "Super Admin") {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="max-w-md rounded-xl border border-slate-800 bg-slate-900/90 p-6 text-center">
          <div className="text-lg font-semibold mb-2">
            Not authorized to view this page
          </div>
          <div className="text-sm text-slate-400 mb-4">
            Only Super Admin users can manage user accounts. If you believe this
            is an error, contact your system administrator.
          </div>
          <button
            onClick={() => router.push("/")}
            className="px-4 py-2 rounded-lg bg-sky-600 text-sm text-white hover:bg-sky-500"
          >
            Go back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  useEffect(() => {
    async function loadUsers() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/users");
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || "Failed to load users.");
          return;
        }
        const data: UserProfile[] = await res.json();
        setUsers(data);
      } catch (e) {
        console.error("Failed to fetch users", e);
        setError("Unexpected error loading users.");
      } finally {
        setLoading(false);
      }
    }

    loadUsers();
  }, []);

  function getMergedUser(u: UserProfile): UserProfile {
    const overrides = editBuffer[u.id] || {};
    return {
      ...u,
      ...overrides,
    };
  }

  function handleFieldChange(
    id: string,
    field: keyof UserProfile,
    value: string
  ) {
    setEditBuffer((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        [field]: value,
      },
    }));
  }

  async function handleSaveUser(u: UserProfile) {
    const merged = getMergedUser(u);

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: merged.id,
          fullName: merged.full_name,
          accessRole: merged.access_role,
          building: merged.building,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to update user.");
        return;
      }

      // Update local list
      setUsers((prev) =>
        prev.map((p) => (p.id === merged.id ? (data as UserProfile) : p))
      );
      // Clear edit buffer for this user
      setEditBuffer((prev) => {
        const copy = { ...prev };
        delete copy[merged.id];
        return copy;
      });
    } catch (e) {
      console.error("Failed to update user", e);
      setError("Unexpected error updating user.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!newFullName.trim() || !newEmail.trim() || !newPassword.trim()) {
      setError("Full name, email, and password are required.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName: newFullName.trim(),
          email: newEmail.trim(),
          building: newBuilding,
          accessRole: newRole,
          password: newPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create user.");
        return;
      }

      // Append new user
      setUsers((prev) => [...prev, data as UserProfile]);

      // Clear form
      setNewFullName("");
      setNewEmail("");
      setNewBuilding("DC18");
      setNewRole("Building Manager");
      setNewPassword("");
    } catch (e) {
      console.error("Failed to create user", e);
      setError("Unexpected error creating user.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50">
      <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">
              User Accounts
            </h1>
            <p className="text-sm text-slate-400">
              Super Admin control panel for roles, buildings, and access.
            </p>
          </div>
          <button
            onClick={() => router.push("/")}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] text-slate-200 hover:bg-slate-800"
          >
            ← Back to Dashboard
          </button>
        </div>

        {/* New user form */}
        <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 shadow-sm shadow-slate-900/60">
          <h2 className="text-sm font-semibold text-slate-100 mb-3">
            Create New User
          </h2>
          <form
            className="grid grid-cols-1 md:grid-cols-5 gap-3 text-xs"
            onSubmit={handleCreateUser}
          >
            <div className="md:col-span-2">
              <label className="block text-[11px] text-slate-400 mb-1">
                Full Name
              </label>
              <input
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
                placeholder="John Doe"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[11px] text-slate-400 mb-1">
                Email
              </label>
              <input
                type="email"
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="john.doe@example.com"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Building
              </label>
              <select
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-[11px] text-slate-50"
                value={newBuilding}
                onChange={(e) => setNewBuilding(e.target.value)}
              >
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
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-[11px] text-slate-50"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Temp Password
              </label>
              <input
                type="text"
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Give this to the user"
              />
            </div>
            <div className="md:col-span-5 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="mt-1 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-[11px] font-medium text-white px-4 py-2"
              >
                {saving ? "Working..." : "Create User"}
              </button>
            </div>
          </form>
          <p className="mt-2 text-[11px] text-slate-500">
            After creating an account, share the email and temporary password
            with the user. They can log in at{" "}
            <span className="font-mono">/auth</span>.
          </p>
        </div>

        {/* Error display */}
        {error && (
          <div className="rounded-lg border border-rose-700 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-100">
            {error}
          </div>
        )}

        {/* Users table */}
        <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 shadow-sm shadow-slate-900/60">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-100">
              Existing Users
            </h2>
            {loading && (
              <div className="text-[11px] text-slate-400">Loading…</div>
            )}
          </div>

          <div className="overflow-x-auto text-xs">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                  <th className="text-left py-2 pr-3">Name</th>
                  <th className="text-left py-2 pr-3">Email</th>
                  <th className="text-left py-2 pr-3">Role</th>
                  <th className="text-left py-2 pr-3">Building</th>
                  <th className="text-left py-2 pr-3">Created</th>
                  <th className="text-right py-2 pl-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && !loading && (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-3 text-center text-[11px] text-slate-500"
                    >
                      No users found.
                    </td>
                  </tr>
                )}
                {users.map((u) => {
                  const merged = getMergedUser(u);
                  const isDirty = !!editBuffer[u.id];

                  return (
                    <tr
                      key={u.id}
                      className="border-b border-slate-800/60 hover:bg-slate-900/70"
                    >
                      <td className="py-2 pr-3">
                        <input
                          className="w-full bg-transparent border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-50"
                          value={merged.full_name ?? ""}
                          onChange={(e) =>
                            handleFieldChange(
                              u.id,
                              "full_name",
                              e.target.value
                            )
                          }
                        />
                      </td>
                      <td className="py-2 pr-3 text-[11px] text-slate-300">
                        {u.email}
                      </td>
                      <td className="py-2 pr-3">
                        <select
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-50"
                          value={merged.access_role}
                          onChange={(e) =>
                            handleFieldChange(
                              u.id,
                              "access_role",
                              e.target.value
                            )
                          }
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-3">
                        <select
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-50"
                          value={merged.building}
                          onChange={(e) =>
                            handleFieldChange(u.id, "building", e.target.value)
                          }
                        >
                          {BUILDINGS.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-3 text-[11px] text-slate-500">
                        {new Date(merged.created_at).toLocaleString()}
                      </td>
                      <td className="py-2 pl-3 text-right">
                        <button
                          className={`px-3 py-1 rounded-lg text-[11px] ${
                            isDirty
                              ? "bg-sky-600 text-white hover:bg-sky-500"
                              : "bg-slate-800 text-slate-300 cursor-default"
                          }`}
                          disabled={!isDirty || saving}
                          onClick={() => handleSaveUser(u)}
                        >
                          {saving && isDirty ? "Saving…" : "Save"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

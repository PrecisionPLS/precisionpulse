"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";

type ProfileRow = {
  id: string;
  email: string | null;
  name: string | null;
  access_role: string | null;
  building: string | null;
  created_at: string | null;
};

const ACCESS_ROLES = [
  "Super Admin",
  "Director of Operations",
  "Regional Manager",
  "Building Manager",
  "HR",
  "Lead",
  "Worker / Lumper",
  "Other",
];

const BUILDINGS = ["DC1", "DC5", "DC11", "DC14", "DC18"];

export default function UserAccountsPage() {
  const currentUser = useCurrentUser(); // redirects to /auth internally

  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Local edit buffers
  const [roleEdits, setRoleEdits] = useState<Record<string, string>>({});
  const [buildingEdits, setBuildingEdits] = useState<Record<string, string>>(
    {}
  );

  // Load profiles from Supabase
  useEffect(() => {
    if (!currentUser) return; // useCurrentUser will redirect

    async function loadUsers() {
      setLoading(true);
      setError(null);
      try {
        const { data, error } = await supabase
  .from("profiles")
  .select("*")
  .order("created_at", { ascending: false });

        if (error) {
          console.error("Error loading profiles", error);
          setError("Failed to load user accounts from Supabase.");
          return;
        }

        const rows = (data || []) as ProfileRow[];
        setUsers(rows);

        // Initialize edit buffers with current values
        const roleBuf: Record<string, string> = {};
        const bldBuf: Record<string, string> = {};
        for (const u of rows) {
          roleBuf[u.id] = u.access_role || "";
          bldBuf[u.id] = u.building || "";
        }
        setRoleEdits(roleBuf);
        setBuildingEdits(bldBuf);
      } catch (e) {
        console.error("Unexpected user-accounts load error", e);
        setError("Unexpected error loading user accounts.");
      } finally {
        setLoading(false);
      }
    }

    loadUsers();
  }, [currentUser]);

  async function handleSaveUser(userId: string) {
    const newRole = roleEdits[userId] || null;
    const newBuilding = buildingEdits[userId] || null;

    setSavingId(userId);
    setError(null);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          access_role: newRole,
          building: newBuilding,
        })
        .eq("id", userId);

      if (error) {
        console.error("Error updating profile", error);
        setError("Failed to update user. Check console for details.");
        return;
      }

      // Reflect change in local state
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? {
                ...u,
                access_role: newRole,
                building: newBuilding,
              }
            : u
        )
      );
    } catch (e) {
      console.error("Unexpected update error", e);
      setError("Unexpected error updating user.");
    } finally {
      setSavingId(null);
    }
  }

  // This is safe: all hooks are already called above.
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center text-sm">
        Redirecting to login…
      </div>
    );
  }

  const isSuperAdmin = currentUser.accessRole === "Super Admin";

  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50">
        <div className="mx-auto max-w-3xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold text-slate-50">
              User Accounts
            </h1>
            <Link
              href="/"
              className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
            >
              ← Back to Dashboard
            </Link>
          </div>
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 text-sm text-slate-300">
            You do not have permission to view this page.
            <br />
            <span className="text-[11px] text-slate-500">
              Only <span className="font-semibold">Super Admin</span> can
              manage user accounts and roles.
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50">
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">
              User Accounts & Roles
            </h1>
            <p className="text-sm text-slate-400">
              Manage application access roles and default building assignments
              for all profiles in the system.
            </p>
            {loading && (
              <p className="mt-1 text-[11px] text-slate-500">
                Loading user accounts…
              </p>
            )}
            {error && (
              <p className="mt-1 text-[11px] text-amber-400">{error}</p>
            )}
          </div>
          <Link
            href="/"
            className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
            <div className="text-slate-400 mb-1">Total Profiles</div>
            <div className="text-2xl font-semibold text-sky-300">
              {users.length}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              All users with profiles in Supabase.
            </div>
          </div>
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
            <div className="text-slate-400 mb-1">Super Admins</div>
            <div className="text-2xl font-semibold text-emerald-300">
              {users.filter((u) => u.access_role === "Super Admin").length}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Users with full platform access.
            </div>
          </div>
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
            <div className="text-slate-400 mb-1">Building Managers</div>
            <div className="text-2xl font-semibold text-amber-300">
              {users.filter((u) => u.access_role === "Building Manager").length}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Users responsible for single-building ops.
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
          <div className="flex items-center justify-between mb-2">
            <div className="text-slate-200 text-sm font-semibold">
              User List
            </div>
            <div className="text-[11px] text-slate-500">
              Edit roles and building, then click{" "}
              <span className="font-semibold">Save</span> per row.
            </div>
          </div>

          {users.length === 0 ? (
            <p className="text-sm text-slate-500">
              No profiles found. Once users register and complete onboarding,
              they will appear here.
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
                      Access Role
                    </th>
                    <th className="px-3 py-2 text-[11px] text-slate-400">
                      Building
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
                  {users.map((u) => {
                    const created =
                      u.created_at?.slice(0, 10) ?? "—";
                    const roleValue = roleEdits[u.id] ?? (u.access_role || "");
                    const buildingValue =
                      buildingEdits[u.id] ?? (u.building || "");

                    const isSelf = u.id === currentUser.id;

                    return (
                      <tr
                        key={u.id}
                        className="border-b border-slate-800/60 hover:bg-slate-900/60"
                      >
                        <td className="px-3 py-2 text-slate-100">
                          <div className="text-xs font-medium">
                            {u.name || "No name set"}
                            {isSelf && (
                              <span className="ml-1 text-[10px] text-sky-300">
                                (you)
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {u.email || "No email"}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-[11px] text-slate-50"
                            value={roleValue}
                            onChange={(e) =>
                              setRoleEdits((prev) => ({
                                ...prev,
                                [u.id]: e.target.value,
                              }))
                            }
                          >
                            <option value="">None / Worker Only</option>
                            {ACCESS_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-[11px] text-slate-50"
                            value={buildingValue}
                            onChange={(e) =>
                              setBuildingEdits((prev) => ({
                                ...prev,
                                [u.id]: e.target.value,
                              }))
                            }
                          >
                            <option value="">None</option>
                            {BUILDINGS.map((b) => (
                              <option key={b} value={b}>
                                {b}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-slate-300 text-[11px] font-mono">
                          {created}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => handleSaveUser(u.id)}
                            disabled={savingId === u.id}
                            className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 text-[11px] text-slate-100 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {savingId === u.id ? "Saving…" : "Save"}
                          </button>
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
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";

type AuthUserDebug = {
  id: string;
  email: string | null;
  user_metadata: any;
  created_at: string | null;
  last_sign_in_at: string | null;
};

type UserAccountsRow = {
  id: string;
  email: string;
  name: string | null;
  access_role: string | null;
  building: string | null;
  active: boolean | null;
  created_at: string | null;
};

export default function AdminDebugPage() {
  const currentUser = useCurrentUser();
  const [authUser, setAuthUser] = useState<AuthUserDebug | null>(null);
  const [dbUser, setDbUser] = useState<UserAccountsRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isSuperAdmin = currentUser?.accessRole === "Super Admin";

  useEffect(() => {
    if (!currentUser) return;
    if (!isSuperAdmin) return;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        // Raw Supabase Auth user
        const { data, error: authError } = await supabase.auth.getUser();
        if (authError) {
          console.error("Error loading auth user", authError);
          setError("Failed to load Supabase Auth user.");
        } else if (data?.user) {
          const u = data.user;

          // 🔧 Force these to string | null so TS is happy
          const createdAt: string | null =
            (u.created_at as string | undefined) ?? null;
          const lastSignInAt: string | null =
            (u.last_sign_in_at as string | undefined) ?? null;

          setAuthUser({
            id: u.id,
            email: u.email ?? null,
            user_metadata: u.user_metadata,
            created_at: createdAt,
            last_sign_in_at: lastSignInAt,
          });

          // user_accounts row for this email
          const email = (u.email || "").toLowerCase();
          if (email) {
            const { data: rows, error: dbError } = await supabase
              .from("user_accounts")
              .select("*")
              .eq("email", email)
              .limit(1);

            if (dbError) {
              console.error("Error loading user_accounts row", dbError);
              setError((prev) =>
                prev
                  ? prev +
                    " Also failed to load user_accounts row."
                  : "Failed to load user_accounts row."
              );
            } else if (rows && rows[0]) {
              setDbUser(rows[0] as UserAccountsRow);
            } else {
              setDbUser(null);
            }
          }
        }
      } catch (e) {
        console.error("Unexpected error in AdminDebugPage", e);
        setError("Unexpected error loading debug data.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [currentUser, isSuperAdmin]);

  // While useCurrentUser is figuring things out
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
            Debug Panel Restricted
          </h1>
          <p className="text-slate-400">
            Only{" "}
            <span className="font-semibold text-emerald-300">
              Super Admins
            </span>{" "}
            can view the internal user debug panel.
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
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">
              Admin Debug: Current User State
            </h1>
            <p className="text-sm text-slate-400">
              Compare what{" "}
              <span className="font-semibold text-sky-300">
                useCurrentUser
              </span>{" "}
              sees vs{" "}
              <span className="font-semibold text-sky-300">
                Supabase Auth
              </span>{" "}
              and{" "}
              <span className="font-semibold text-sky-300">
                user_accounts
              </span>{" "}
              table.
            </p>
            {loading && (
              <p className="mt-1 text-[11px] text-slate-500">
                Loading debug data…
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 text-xs">
            <div className="text-right text-slate-300">
              Signed in as{" "}
              <span className="font-semibold">
                {currentUser.email}
              </span>
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

        {/* Summary strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <SummaryCard
            label="useCurrentUser Role"
            value={currentUser.accessRole}
            hint="App-level role used for permissions"
          />
          <SummaryCard
            label="user_accounts.access_role"
            value={dbUser?.access_role}
            hint="DB source of truth"
          />
          <SummaryCard
            label="Auth user_metadata.accessRole"
            value={
              (authUser?.user_metadata &&
                (authUser.user_metadata.accessRole ||
                  authUser.user_metadata.role)) ||
              undefined
            }
            hint="Optional, no longer authoritative"
          />
        </div>

        {/* Panels */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-xs">
          {/* useCurrentUser view */}
          <CardPanel className="lg:col-span-1">
            <h2 className="text-sm font-semibold text-slate-100 mb-2">
              App View (useCurrentUser)
            </h2>
            <div className="space-y-1 text-[11px] text-slate-300">
              <div>
                <span className="text-slate-400">Email:</span>{" "}
                {currentUser.email}
              </div>
              <div>
                <span className="text-slate-400">Name:</span>{" "}
                {currentUser.name}
              </div>
              <div>
                <span className="text-slate-400">Role:</span>{" "}
                <span className="font-semibold text-emerald-300">
                  {currentUser.accessRole}
                </span>
              </div>
              <div>
                <span className="text-slate-400">Building:</span>{" "}
                {currentUser.building || "—"}
              </div>
              <div>
                <span className="text-slate-400">Active:</span>{" "}
                {currentUser.active ? "Yes" : "No"}
              </div>
            </div>
          </CardPanel>

          {/* user_accounts row */}
          <CardPanel className="lg:col-span-1">
            <h2 className="text-sm font-semibold text-slate-100 mb-2">
              Database Row (user_accounts)
            </h2>
            {dbUser ? (
              <div className="space-y-1 text-[11px] text-slate-300">
                <div>
                  <span className="text-slate-400">ID:</span>{" "}
                  {dbUser.id}
                </div>
                <div>
                  <span className="text-slate-400">Email:</span>{" "}
                  {dbUser.email}
                </div>
                <div>
                  <span className="text-slate-400">Name:</span>{" "}
                  {dbUser.name || "—"}
                </div>
                <div>
                  <span className="text-slate-400">access_role:</span>{" "}
                  <span className="font-semibold text-sky-300">
                    {dbUser.access_role || "—"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">building:</span>{" "}
                  {dbUser.building || "—"}
                </div>
                <div>
                  <span className="text-slate-400">active:</span>{" "}
                  {dbUser.active ? "true" : "false"}
                </div>
                <div>
                  <span className="text-slate-400">created_at:</span>{" "}
                  {dbUser.created_at || "—"}
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">
                No user_accounts row found for this email.
              </p>
            )}
          </CardPanel>

          {/* Raw Auth user */}
          <CardPanel className="lg:col-span-1">
            <h2 className="text-sm font-semibold text-slate-100 mb-2">
              Supabase Auth (raw)
            </h2>
            {authUser ? (
              <div className="space-y-2 text-[11px] text-slate-300">
                <div>
                  <span className="text-slate-400">Auth ID:</span>{" "}
                  {authUser.id}
                </div>
                <div>
                  <span className="text-slate-400">Email:</span>{" "}
                  {authUser.email}
                </div>
                <div>
                  <span className="text-slate-400">created_at:</span>{" "}
                  {authUser.created_at || "—"}
                </div>
                <div>
                  <span className="text-slate-400">
                    last_sign_in_at:
                  </span>{" "}
                  {authUser.last_sign_in_at || "—"}
                </div>
                <div className="mt-2">
                  <div className="text-slate-400 mb-1">
                    user_metadata:
                  </div>
                  <pre className="bg-slate-950 border border-slate-800 rounded-lg p-2 text-[10px] text-slate-200 overflow-auto max-h-48">
                    {JSON.stringify(authUser.user_metadata, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">
                No Auth user loaded.
              </p>
            )}
          </CardPanel>
        </div>
      </div>
    </div>
  );
}

/** Small layout helpers */

function CardPanel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-slate-900/95 border border-slate-800 rounded-2xl p-4 shadow-sm shadow-slate-900/50 ${className}`}
    >
      {children}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | null | undefined;
  hint: string;
}) {
  const display = value ?? "—";
  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
      <div className="text-[11px] text-slate-400 mb-1">{label}</div>
      <div className="text-lg font-semibold text-sky-300 break-all">
        {display}
      </div>
      <div className="text-[10px] text-slate-500 mt-1">{hint}</div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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

export type AccessRole = (typeof ACCESS_ROLES)[number];

type UserAccountRow = {
  id: string;
  email: string;
  name: string | null;
  access_role: string | null;
  building: string | null;
  active: boolean | null;
  created_at: string | null;
};

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  accessRole: AccessRole;
  building: string | null;
  active: boolean;
};

type UserMeta = {
  accessRole?: unknown;
  building?: unknown;
  name?: unknown;
  full_name?: unknown;
  fullName?: unknown;
  [key: string]: unknown;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function sanitizeRole(raw: unknown): AccessRole {
  if (typeof raw !== "string") return "Worker";
  const match = ACCESS_ROLES.find((r) => r.toLowerCase() === raw.toLowerCase());
  return match ?? "Worker";
}

function pickName(meta: UserMeta): string | null {
  const candidates = [meta.name, meta.full_name, meta.fullName];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

export function useCurrentUser(): CurrentUser | null {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const {
          data: { user: authUser },
          error,
        } = await supabase.auth.getUser();

        if (error || !authUser) {
          if (!cancelled) {
            setUser(null);
            setLoaded(true);
          }
          router.push("/auth");
          return;
        }

        const email = (authUser.email || "").toLowerCase();

        const rawMeta: unknown = authUser.user_metadata;
        const metaObj = (isRecord(rawMeta) ? rawMeta : {}) as UserMeta;

        const metaRole = sanitizeRole(metaObj.accessRole);
        const metaBuilding = typeof metaObj.building === "string" ? metaObj.building : null;
        const metaName = pickName(metaObj);

        // Load user_accounts row (if any)
        const { data: rows, error: dbError } = await supabase
          .from("user_accounts")
          .select("*")
          .eq("email", email)
          .limit(1);

        if (dbError) {
          console.error("Error loading user_accounts for current user", dbError);
        }

        let dbUser: UserAccountRow | undefined = (rows?.[0] as UserAccountRow | undefined) ?? undefined;

        // If no DB row yet, seed it ONCE from metadata/defaults.
        if (!dbUser) {
          try {
            const { data: inserted, error: insertError } = await supabase
              .from("user_accounts")
              .insert({
                email,
                name: metaName || null,
                building: metaBuilding,
                access_role: metaRole || "Worker",
                active: true,
              })
              .select("*")
              .single();

            if (insertError) {
              console.error("Error inserting user_accounts from useCurrentUser", insertError);
            } else if (inserted) {
              dbUser = inserted as UserAccountRow;
            }
          } catch (insertErr) {
            console.error("Unexpected error inserting user_accounts from useCurrentUser", insertErr);
          }
        } else {
          // Optional: lightly sync ONLY missing name/building from metadata (never touch role here)
          const updates: Partial<UserAccountRow> = {};
          if (!dbUser.name && metaName) updates.name = metaName;
          if (!dbUser.building && metaBuilding) updates.building = metaBuilding;

          if (Object.keys(updates).length > 0) {
            try {
              const { data: updatedRows, error: updateError } = await supabase
                .from("user_accounts")
                .update(updates)
                .eq("id", dbUser.id)
                .select("*")
                .limit(1);

              if (updateError) {
                console.error("Error lightly syncing user_accounts from metadata", updateError);
              } else if (updatedRows && updatedRows[0]) {
                dbUser = updatedRows[0] as UserAccountRow;
              }
            } catch (syncErr) {
              console.error("Unexpected error updating user_accounts from metadata", syncErr);
            }
          }
        }

        // 🔐 FINAL SOURCE OF TRUTH:
        // access_role COMES FROM user_accounts, NOT from metadata.
        const finalRole = sanitizeRole(dbUser?.access_role);
        const finalBuilding = dbUser?.building ?? metaBuilding ?? null;

        const finalName =
          dbUser?.name ??
          metaName ??
          (authUser.email ? authUser.email.split("@")[0] : "") ??
          "";

        const active = dbUser?.active ?? true;

        const appUser: CurrentUser = {
          id: authUser.id,
          email,
          name: finalName,
          accessRole: finalRole,
          building: finalBuilding,
          active,
        };

        if (!cancelled) {
          setUser(appUser);
          setLoaded(true);

          if (typeof window !== "undefined") {
            try {
              window.localStorage.setItem("precisionpulse_currentUser", JSON.stringify(appUser));
            } catch {
              // ignore localStorage errors
            }
          }
        }
      } catch (e) {
        console.error("Unexpected error in useCurrentUser", e);
        if (!cancelled) {
          setUser(null);
          setLoaded(true);
          router.push("/auth");
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!loaded) return null;
  return user;
}

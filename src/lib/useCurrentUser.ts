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

function sanitizeRole(raw: any): AccessRole {
  if (!raw || typeof raw !== "string") return "Worker";
  const match = ACCESS_ROLES.find(
    (r) => r.toLowerCase() === raw.toLowerCase()
  );
  return match || "Worker";
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
          data: { user },
          error,
        } = await supabase.auth.getUser();

        if (error || !user) {
          if (!cancelled) {
            setUser(null);
            setLoaded(true);
          }
          router.push("/auth");
          return;
        }

        const email = (user.email || "").toLowerCase();
        const meta = (user.user_metadata || {}) as any;

        const metaRoleRaw = meta?.accessRole;
        const metaRole = metaRoleRaw
          ? sanitizeRole(metaRoleRaw)
          : "Worker";
        const metaBuilding =
          typeof meta.building === "string" ? meta.building : null;
        const metaName =
          (meta.name ||
            meta.full_name ||
            meta.fullName ||
            null) as string | null;

        // Load user_accounts row (if any)
        const { data: rows, error: dbError } = await supabase
          .from("user_accounts")
          .select("*")
          .eq("email", email)
          .limit(1);

        if (dbError) {
          console.error(
            "Error loading user_accounts for current user",
            dbError
          );
        }

        let dbUser = (rows?.[0] as UserAccountRow | undefined) || undefined;

        // If no DB row yet, seed it ONCE from metadata/defaults.
        if (!dbUser) {
          try {
            const insertRole = metaRole || "Worker";
            const { data: inserted, error: insertError } = await supabase
              .from("user_accounts")
              .insert({
                email,
                name: metaName || null,
                building: metaBuilding,
                access_role: insertRole,
                active: true,
              })
              .select("*")
              .single();

            if (insertError) {
              console.error(
                "Error inserting user_accounts from useCurrentUser",
                insertError
              );
            } else {
              dbUser = inserted as UserAccountRow;
            }
          } catch (insertErr) {
            console.error(
              "Unexpected error inserting user_accounts from useCurrentUser",
              insertErr
            );
          }
        } else {
          // Optional: lightly sync ONLY missing name/building from metadata (never touch role here)
          const updates: Partial<UserAccountRow> = {};
          if (!dbUser.name && metaName) {
            updates.name = metaName;
          }
          if (!dbUser.building && metaBuilding) {
            updates.building = metaBuilding;
          }

          if (Object.keys(updates).length > 0) {
            try {
              const { data: updatedRows, error: updateError } =
                await supabase
                  .from("user_accounts")
                  .update(updates)
                  .eq("id", dbUser.id)
                  .select("*")
                  .limit(1);

              if (updateError) {
                console.error(
                  "Error lightly syncing user_accounts from metadata",
                  updateError
                );
              } else if (updatedRows && updatedRows[0]) {
                dbUser = updatedRows[0] as UserAccountRow;
              }
            } catch (syncErr) {
              console.error(
                "Unexpected error updating user_accounts from metadata",
                syncErr
              );
            }
          }
        }

        // 🔐 FINAL SOURCE OF TRUTH:
        // access_role COMES FROM user_accounts, NOT from metadata.
        const dbRole = sanitizeRole(dbUser?.access_role);
        const finalRole: AccessRole = dbRole || "Worker";

        const finalBuilding =
          dbUser?.building ?? metaBuilding ?? null;

        const finalName =
          dbUser?.name ??
          metaName ??
          user.email?.split("@")[0] ??
          "";

        const active = dbUser?.active ?? true;

        const appUser: CurrentUser = {
          id: user.id,
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
              window.localStorage.setItem(
                "precisionpulse_currentUser",
                JSON.stringify(appUser)
              );
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

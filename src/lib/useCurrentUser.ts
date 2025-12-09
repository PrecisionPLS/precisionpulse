"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  accessRole: string;
  building: string;
};

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      setLoading(true);

      // 1) Get the current auth.user from Supabase
      const { data: authData, error: authError } =
        await supabase.auth.getUser();

      if (!active) return;

      if (authError || !authData.user) {
        // Not logged in
        setUser(null);
        setLoading(false);
        return;
      }

      const authUser = authData.user;

      // 2) Get their profile row from public.profiles
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", authUser.id)
        .maybeSingle();

      if (!active) return;

      if (profileError) {
        console.error("Failed to load profile", profileError);

        // Fallback: build a basic user object
        setUser({
          id: authUser.id,
          email: authUser.email ?? "",
          name: authUser.email ?? "",
          accessRole: "Building Manager",
          building: "DC18",
        });
      } else if (profile) {
        setUser({
          id: authUser.id,
          email: profile.email,
          name: profile.full_name ?? profile.email,
          accessRole: profile.access_role ?? "Building Manager",
          building: profile.building ?? "DC18",
        });
      } else {
        // No profile row yet, use email only
        setUser({
          id: authUser.id,
          email: authUser.email ?? "",
          name: authUser.email ?? "",
          accessRole: "Building Manager",
          building: "DC18",
        });
      }

      setLoading(false);
    }

    loadProfile();

    // 3) Listen for login/logout events
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        setUser(null);
      } else {
        loadProfile();
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return user;
}

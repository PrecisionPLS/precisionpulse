"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  accessRole?: string;
  building?: string;
  createdAt?: string;
};

const CURRENT_USER_KEY = "precisionpulse_currentUser";

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(CURRENT_USER_KEY);
      if (!raw) {
        // No user logged in – send to auth
        router.replace("/auth");
        return;
      }
      const parsed = JSON.parse(raw);
      setUser(parsed);
    } catch (err) {
      console.error("Failed to read current user", err);
      router.replace("/auth");
    }
  }, [router]);

  return user;
}

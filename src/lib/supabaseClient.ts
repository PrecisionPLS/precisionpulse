// src/lib/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

// Read env vars
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// 🚨 Fail fast if env vars are missing
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables. " +
      "Make sure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set."
  );
}

// Browser-safe Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,       // keep user logged in
    autoRefreshToken: true,     // refresh JWT automatically
    detectSessionInUrl: true,   // needed for auth redirects
  },
});

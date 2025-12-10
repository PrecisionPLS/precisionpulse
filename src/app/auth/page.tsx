"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { BUILDINGS } from "@/lib/buildings";

export default function AuthPage() {
  const router = useRouter();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [building, setBuilding] = useState("DC18");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!email.trim()) {
        setError("Please enter an email address.");
        return;
      }
      if (!password) {
        setError("Please enter a password.");
        return;
      }

      const emailLower = email.trim().toLowerCase();

      if (mode === "signup") {
        if (!fullName.trim()) {
          setError("Please enter your full name.");
          return;
        }
        if (!password2) {
          setError("Please confirm your password.");
          return;
        }
        if (password !== password2) {
          setError("Passwords do not match.");
          return;
        }

        // 1) Sign up with Supabase Auth
        const { data, error: signupError } = await supabase.auth.signUp({
          email: emailLower,
          password,
        });

        if (signupError) {
          console.error("Sign up error:", signupError);
          setError(signupError.message);
          return;
        }

        const authUser = data.user;
        if (!authUser) {
          setError(
            "Sign up successful, but no user returned. Check your email if confirmations are required."
          );
          return;
        }

        // 2) Try to insert a profile row (not fatal if it fails)
        const { error: profileError } = await supabase.from("profiles").insert({
          id: authUser.id,
          email: emailLower,
          full_name: fullName.trim(),
          access_role: "Building Manager", // default; you'll promote yourself in Supabase
          building: building,
        });

        if (profileError) {
          console.error("Profile insert error", profileError);
          // soft-fail on profile
        }

        // 3) Ensure we actually have a session by logging in
        const { error: loginAfterSignupError } =
          await supabase.auth.signInWithPassword({
            email: emailLower,
            password,
          });

        if (loginAfterSignupError) {
          console.error("Login after signup error:", loginAfterSignupError);
          setError(
            "Account created, but login failed. Try logging in with your email and password."
          );
          return;
        }

        // 4) Go to dashboard
        router.push("/");
        return;
      } else {
        // LOGIN mode
        const { error: loginError } =
          await supabase.auth.signInWithPassword({
            email: emailLower,
            password,
          });

        if (loginError) {
          console.error("Login error:", loginError);
          setError(loginError.message);
          return;
        }

        // Logged in → go to dashboard
        router.push("/");
        return;
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950/90 p-6 shadow-xl">
        <div className="mb-4 text-center">
          <h1 className="text-xl font-semibold text-slate-50">
            Precision Pulse Login
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Sign in to your Precision Pulse account, or create one if this is
            your first time.
          </p>
        </div>

        <div className="flex mb-4 text-xs rounded-full bg-slate-900 border border-slate-800 p-1">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`flex-1 py-1.5 rounded-full ${
              mode === "login"
                ? "bg-sky-600 text-white"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            Log In
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`flex-1 py-1.5 rounded-full ${
              mode === "signup"
                ? "bg-sky-600 text-white"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          {mode === "signup" && (
            <>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Full Name
                </label>
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Doe"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Home Building
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
              </div>
            </>
          )}

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">
              Email
            </label>
            <input
              type="email"
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john.doe@example.com"
            />
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">
              Password
            </label>
            <input
              type="password"
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter a secure password"
            />
          </div>

          {mode === "signup" && (
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Confirm Password
              </label>
              <input
                type="password"
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                placeholder="Re-enter your password"
              />
            </div>
          )}

          {error && (
            <div className="text-[11px] text-rose-300 bg-rose-950/40 border border-rose-700/60 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 w-full rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-[11px] font-medium text-white px-4 py-2"
          >
            {loading
              ? "Working..."
              : mode === "login"
              ? "Log In"
              : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}

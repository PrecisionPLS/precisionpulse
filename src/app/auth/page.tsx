"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const USERS_KEY = "precisionpulse_users";
const CURRENT_USER_KEY = "precisionpulse_currentUser";

type AppUser = {
  id: string;
  email: string;
  name: string;
  password: string;
  accessRole: string;
  building: string;
  createdAt: string;
};

export default function AuthPage() {
  const router = useRouter();

  const [usersExist, setUsersExist] = useState<boolean | null>(null);
  const [knownEmails, setKnownEmails] = useState<string[]>([]);

  // login form
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);

  // first-time setup
  const [setupName, setSetupName] = useState("Ryan Blankenship");
  const [setupEmail, setSetupEmail] = useState("ryan@precisionlumping.com");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupPassword2, setSetupPassword2] = useState("");
  const [setupBuilding, setSetupBuilding] = useState("DC18");
  const [setupError, setSetupError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // If logged in, redirect
    try {
      const rawCurrent = window.localStorage.getItem(CURRENT_USER_KEY);
      if (rawCurrent) {
        router.replace("/");
        return;
      }
    } catch {}

    // Check for users
    try {
      const raw = window.localStorage.getItem(USERS_KEY);
      if (!raw) {
        setUsersExist(false);
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setUsersExist(true);
        setKnownEmails(parsed.map((u: any) => u.email));
      } else {
        setUsersExist(false);
      }
    } catch {
      setUsersExist(false);
    }
  }, [router]);

  function loadUsers(): AppUser[] {
    try {
      const raw = window.localStorage.getItem(USERS_KEY);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  function saveUsers(users: AppUser[]) {
    window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  function saveCurrentUser(user: AppUser) {
    window.localStorage.setItem(
      CURRENT_USER_KEY,
      JSON.stringify({
        id: user.id,
        email: user.email,
        name: user.name,
        accessRole: user.accessRole,
        building: user.building,
        createdAt: user.createdAt,
      })
    );
  }

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);

    const users = loadUsers();
    const user = users.find(
      (u) => u.email.toLowerCase() === loginEmail.trim().toLowerCase()
    );

    if (!user) {
      setLoginError("User not found.");
      return;
    }
    if (user.password !== loginPassword) {
      setLoginError("Incorrect password.");
      return;
    }

    saveCurrentUser(user);
    router.replace("/");
  }

  function handleFirstSetup(e: React.FormEvent) {
    e.preventDefault();
    setSetupError(null);

    if (!setupName.trim()) return setSetupError("Enter your name.");
    if (!setupEmail.trim()) return setSetupError("Enter your email.");
    if (setupPassword !== setupPassword2)
      return setSetupError("Passwords do not match.");

    const users = loadUsers();

    if (users.length > 0) {
      setSetupError("Users already exist. Use login instead.");
      setUsersExist(true);
      return;
    }

    const now = new Date().toISOString();

    const user: AppUser = {
      id: String(Date.now()),
      email: setupEmail.trim(),
      name: setupName.trim(),
      password: setupPassword,
      accessRole: "Super Admin",
      building: setupBuilding,
      createdAt: now,
    };

    saveUsers([user]);
    saveCurrentUser(user);
    router.replace("/");
  }

  function handleResetAccounts() {
    const ok = window.confirm(
      "This will delete ALL login accounts in THIS browser only. It will NOT delete containers, work orders, workforce, or any other operations data. Continue?"
    );
    if (!ok) return;

    window.localStorage.removeItem(USERS_KEY);
    window.localStorage.removeItem(CURRENT_USER_KEY);

    setUsersExist(false);
    setKnownEmails([]);
    router.replace("/auth");
  }

  if (usersExist === null) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex justify-center items-center">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 to-slate-900 text-slate-50">
      <div className="max-w-md mx-auto p-6 space-y-6">
        <div className="text-center">
          <div className="text-xs text-sky-300 font-semibold">
            Precision Pulse
          </div>
          <h1 className="text-xl font-semibold">
            {usersExist ? "Sign In" : "Create Super Admin"}
          </h1>
          <p className="text-[11px] text-slate-500">
            {usersExist
              ? "Log in to access the system."
              : "First-time setup — this will create your main admin account."}
          </p>
        </div>

        {/* LOGIN FORM */}
        {usersExist ? (
          <>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-xs space-y-3">
              {knownEmails.length > 0 && (
                <div className="text-[11px] text-slate-400">
                  Known accounts:{" "}
                  <span className="text-slate-200">{knownEmails.join(", ")}</span>
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-3">
                <div>
                  <label className="block text-[11px] mb-1">Email</label>
                  <input
                    type="email"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-[11px]"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="you@precisionlumping.com"
                  />
                </div>
                <div>
                  <label className="block text-[11px] mb-1">Password</label>
                  <input
                    type="password"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-[11px]"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>

                {loginError && (
                  <div className="text-[11px] text-rose-300 bg-rose-900/40 border border-rose-700/70 rounded-lg px-3 py-2">
                    {loginError}
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full bg-sky-600 hover:bg-sky-500 rounded-lg py-2 text-[11px] font-semibold"
                >
                  Log In
                </button>
              </form>
            </div>

            {/* RESET BOX */}
            <div className="bg-slate-950 border border-red-800/70 rounded-2xl p-4 text-xs">
              <div className="text-red-300 font-semibold text-[11px] mb-1">
                Reset Login Accounts
              </div>
              <p className="text-[11px] text-slate-300 mb-2">
                This ONLY resets login accounts in this browser. It does NOT
                delete containers, work orders, or workforce data.
              </p>
              <button
                onClick={handleResetAccounts}
                className="bg-red-700 hover:bg-red-600 text-white text-[11px] px-4 py-2 rounded-lg"
              >
                🔁 Reset Accounts
              </button>
            </div>
          </>
        ) : (
          // SUPER ADMIN SETUP FORM
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-xs space-y-3">
            <form onSubmit={handleFirstSetup} className="space-y-3">
              <div>
                <label className="block text-[11px] mb-1">Full Name</label>
                <input
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-[11px]"
                  value={setupName}
                  onChange={(e) => setSetupName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[11px] mb-1">Email</label>
                <input
                  type="email"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-[11px]"
                  value={setupEmail}
                  onChange={(e) => setSetupEmail(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] mb-1">Password</label>
                  <input
                    type="password"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-[11px]"
                    value={setupPassword}
                    onChange={(e) => setSetupPassword(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[11px] mb-1">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-[11px]"
                    value={setupPassword2}
                    onChange={(e) => setSetupPassword2(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] mb-1">Home Building</label>
                <select
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-[11px]"
                  value={setupBuilding}
                  onChange={(e) => setSetupBuilding(e.target.value)}
                >
                  <option value="DC1">DC1</option>
                  <option value="DC5">DC5</option>
                  <option value="DC11">DC11</option>
                  <option value="DC14">DC14</option>
                  <option value="DC18">DC18</option>
                </select>
              </div>

              {setupError && (
                <div className="text-[11px] text-rose-300 bg-rose-900/40 border border-rose-700/70 rounded-lg px-3 py-2">
                  {setupError}
                </div>
              )}

              <button
                type="submit"
                className="w-full bg-emerald-600 hover:bg-emerald-500 rounded-lg py-2 text-[11px] font-semibold"
              >
                Create Super Admin & Continue
              </button>
            </form>
          </div>
        )}

        <div className="text-center text-[10px] text-slate-600">
          <Link href="/" className="hover:text-sky-300 hover:underline">
            Back to site
          </Link>
        </div>
      </div>
    </div>
  );
}

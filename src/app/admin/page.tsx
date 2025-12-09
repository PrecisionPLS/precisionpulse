"use client";

import {
  useEffect,
  useState,
  useMemo,
  FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCurrentUser } from "@/lib/useCurrentUser";

const STORAGE_PREFIX = "precisionpulse_";
const USERS_KEY = "precisionpulse_users";

type AppUser = {
  id: string;
  email: string;
  name: string;
  password: string;
  accessRole: string;
  building: string;
  createdAt: string;
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

type BackupSummaryItem = {
  key: string;
  size: number;
};

export default function AdminPage() {
  const router = useRouter();
  const currentUser = useCurrentUser(); // redirects to /auth if not logged in

  // Tab: "backup" or "users"
  const [tab, setTab] = useState<"backup" | "users">("backup");

  // BACKUP / RESTORE STATE
  const [summary, setSummary] = useState<BackupSummaryItem[]>([]);
  const [backupJson, setBackupJson] = useState("");
  const [restoreJson, setRestoreJson] = useState("");
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);

  // USER MANAGEMENT STATE
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [accessRole, setAccessRole] = useState<string>("Worker / Lumper");
  const [building, setBuilding] = useState<string>("DC18");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [userError, setUserError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!currentUser) return;
    // Only Super Admin can access /admin
    if (currentUser.accessRole !== "Super Admin") {
      router.replace("/");
      return;
    }

    if (typeof window === "undefined") return;

    // Load backup summary
    const items: BackupSummaryItem[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (!key.startsWith(STORAGE_PREFIX)) continue;

      const value = window.localStorage.getItem(key) ?? "";
      items.push({ key, size: value.length });
    }
    items.sort((a, b) => a.key.localeCompare(b.key));
    setSummary(items);

    // Load users
    try {
      const raw = window.localStorage.getItem(USERS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setUsers(parsed);
        } else {
          setUsers([]);
        }
      } else {
        setUsers([]);
      }
    } catch (err) {
      console.error("Failed to load users", err);
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  }, [currentUser, router]);

  // -------- BACKUP / RESTORE HANDLERS --------

  function handleGenerateBackup() {
    if (typeof window === "undefined") return;

    const data: Record<string, unknown> = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (!key.startsWith(STORAGE_PREFIX)) continue;

      const rawValue = window.localStorage.getItem(key);
      if (rawValue == null) continue;

      try {
        data[key] = JSON.parse(rawValue);
      } catch {
        data[key] = rawValue;
      }
    }

    const payload = {
      version: "precision-pulse-backup-v1",
      createdAt: new Date().toISOString(),
      data,
    };

    const json = JSON.stringify(payload, null, 2);
    setBackupJson(json);
    setBackupMessage(
      "Backup generated. You can copy this JSON and store it safely."
    );
  }

  function handleCopyBackup() {
    if (!backupJson) return;
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setBackupMessage("Clipboard not available in this browser.");
      return;
    }
    navigator.clipboard
      .writeText(backupJson)
      .then(() =>
        setBackupMessage("Backup JSON copied to clipboard.")
      )
      .catch(() =>
        setBackupMessage(
          "Failed to copy. You can still select and copy manually."
        )
      );
  }

  function handleRestore() {
    setRestoreMessage(null);
    if (!restoreJson.trim()) {
      setRestoreMessage("Paste backup JSON first.");
      return;
    }
    if (typeof window === "undefined") return;

    try {
      const parsed = JSON.parse(restoreJson);
      if (!parsed || typeof parsed !== "object" || !("data" in parsed)) {
        setRestoreMessage("Invalid backup format (no data field).");
        return;
      }

      const data = (parsed as any).data as Record<string, unknown>;
      const keys = Object.keys(data);

      const ok = window.confirm(
        `This will overwrite ${keys.length} precisionpulse_ keys in localStorage. Continue?`
      );
      if (!ok) return;

      keys.forEach((key) => {
        const value = data[key];
        if (typeof value === "string") {
          window.localStorage.setItem(key, value);
        } else {
          window.localStorage.setItem(key, JSON.stringify(value));
        }
      });

      setRestoreMessage(
        `Restore complete for ${keys.length} keys. Reload the page to see all updated data.`
      );

      const items: BackupSummaryItem[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (!key) continue;
        if (!key.startsWith(STORAGE_PREFIX)) continue;

        const value = window.localStorage.getItem(key) ?? "";
        items.push({ key, size: value.length });
      }
      items.sort((a, b) => a.key.localeCompare(b.key));
      setSummary(items);
    } catch (err) {
      console.error("Restore failed", err);
      setRestoreMessage(
        "Failed to parse backup JSON. Check that it is valid."
      );
    }
  }

  // -------- USER MANAGEMENT HANDLERS --------

  function persistUsers(next: AppUser[]) {
    setUsers(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(USERS_KEY, JSON.stringify(next));
    }
  }

  function resetUserForm() {
    setEditingId(null);
    setName("");
    setEmail("");
    setAccessRole("Worker / Lumper");
    setBuilding("DC18");
    setPassword("");
    setPassword2("");
    setUserError(null);
  }

  function handleEditUser(u: AppUser) {
    setEditingId(u.id);
    setName(u.name);
    setEmail(u.email);
    setAccessRole(u.accessRole || "Worker / Lumper");
    setBuilding(u.building || "DC18");
    setPassword("");
    setPassword2("");
    setUserError(null);
    setTab("users");
  }

  function handleDeleteUser(u: AppUser) {
    if (currentUser && u.email === currentUser.email) {
      window.alert(
        "You cannot delete the account you are currently logged in as."
      );
      return;
    }

    const ok = window.confirm(
      `Delete user ${u.email}? This only removes their login account in THIS browser. Operational data like containers is not touched.`
    );
    if (!ok) return;

    const next = users.filter((x) => x.id !== u.id);
    persistUsers(next);
    if (editingId === u.id) {
      resetUserForm();
    }
  }

  function handleUserSubmit(e: FormEvent) {
    e.preventDefault();
    setUserError(null);

    if (!name.trim()) {
      setUserError("Please enter a name.");
      return;
    }
    if (!email.trim()) {
      setUserError("Please enter an email.");
      return;
    }

    const emailLower = email.trim().toLowerCase();

    if (editingId) {
      const existing = users.find((u) => u.id === editingId);
      if (!existing) {
        setUserError("User not found.");
        return;
      }

      if (password || password2) {
        if (password !== password2) {
          setUserError("New passwords do not match.");
          return;
        }
      }

      const another = users.find(
        (u) => u.id !== editingId && u.email.toLowerCase() === emailLower
      );
      if (another) {
        setUserError("Another user already has that email.");
        return;
      }

      const next = users.map((u) =>
        u.id === editingId
          ? {
              ...u,
              name: name.trim(),
              email: emailLower,
              accessRole,
              building,
              password:
                password && password2 && password === password2
                  ? password
                  : u.password,
            }
          : u
      );
      persistUsers(next);
      resetUserForm();
    } else {
      if (!password || !password2) {
        setUserError("Enter and confirm a password for the new user.");
        return;
      }
      if (password !== password2) {
        setUserError("Passwords do not match.");
        return;
      }

      const collision = users.find(
        (u) => u.email.toLowerCase() === emailLower
      );
      if (collision) {
        setUserError("A user with that email already exists.");
        return;
      }

      const now = new Date().toISOString();
      const newUser: AppUser = {
        id: String(Date.now()),
        name: name.trim(),
        email: emailLower,
        accessRole,
        building,
        password,
        createdAt: now,
      };

      persistUsers([newUser, ...users]);
      resetUserForm();
    }
  }

  const displayedUsers = useMemo(() => {
    let list = [...users];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (u) =>
          u.email.toLowerCase().includes(q) ||
          u.name.toLowerCase().includes(q) ||
          (u.accessRole || "").toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => a.email.localeCompare(b.email));
    return list;
  }, [users, search]);

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center text-sm">
        Checking access…
      </div>
    );
  }

  if (currentUser.accessRole !== "Super Admin") {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center text-sm">
        Redirecting…
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
              Admin · Backup & Access
            </h1>
            <p className="text-sm text-slate-400">
              Super Admin tools for backing up Precision Pulse data and
              managing who can log into the platform.
            </p>
          </div>
          <Link
            href="/"
            className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => setTab("backup")}
            className={`px-3 py-1.5 rounded-full border ${
              tab === "backup"
                ? "border-sky-500 bg-sky-900/30 text-sky-200"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
            }`}
          >
            Backup / Restore
          </button>
          <button
            type="button"
            onClick={() => setTab("users")}
            className={`px-3 py-1.5 rounded-full border ${
              tab === "users"
                ? "border-sky-500 bg-sky-900/30 text-sky-200"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
            }`}
          >
            User Accounts
          </button>
        </div>

        {tab === "backup" ? (
          <BackupSection
            summary={summary}
            backupJson={backupJson}
            backupMessage={backupMessage}
            restoreJson={restoreJson}
            restoreMessage={restoreMessage}
            setBackupJson={setBackupJson}
            setRestoreJson={setRestoreJson}
            onGenerateBackup={handleGenerateBackup}
            onCopyBackup={handleCopyBackup}
            onRestore={handleRestore}
          />
        ) : (
          <UsersSection
            users={users}
            loadingUsers={loadingUsers}
            displayedUsers={displayedUsers}
            search={search}
            setSearch={setSearch}
            editingId={editingId}
            name={name}
            email={email}
            accessRole={accessRole}
            building={building}
            password={password}
            password2={password2}
            userError={userError}
            setName={setName}
            setEmail={setEmail}
            setAccessRole={setAccessRole}
            setBuilding={setBuilding}
            setPassword={setPassword}
            setPassword2={setPassword2}
            resetUserForm={resetUserForm}
            onSubmit={handleUserSubmit}
            onEdit={handleEditUser}
            onDelete={handleDeleteUser}
          />
        )}
      </div>
    </div>
  );
}

// --------- Backup Section Component ---------

function BackupSection(props: {
  summary: BackupSummaryItem[];
  backupJson: string;
  backupMessage: string | null;
  restoreJson: string;
  restoreMessage: string | null;
  setBackupJson: (v: string) => void;
  setRestoreJson: (v: string) => void;
  onGenerateBackup: () => void;
  onCopyBackup: () => void;
  onRestore: () => void;
}) {
  const {
    summary,
    backupJson,
    backupMessage,
    restoreJson,
    restoreMessage,
    setBackupJson,
    setRestoreJson,
    onGenerateBackup,
    onCopyBackup,
    onRestore,
  } = props;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
      {/* Summary & generate */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-100">
              Local Storage Summary
            </div>
            <div className="text-[11px] text-slate-500">
              Keys starting with{" "}
              <span className="font-mono">{STORAGE_PREFIX}</span>{" "}
              (Precision Pulse data in this browser).
            </div>
          </div>
          <button
            type="button"
            onClick={onGenerateBackup}
            className="text-[11px] px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white"
          >
            Generate Backup JSON
          </button>
        </div>

        {summary.length === 0 ? (
          <div className="text-[11px] text-slate-500">
            No precisionpulse_ keys found in localStorage yet.
          </div>
        ) : (
          <div className="max-h-56 overflow-auto border border-slate-800 rounded-lg">
            <table className="min-w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60">
                  <th className="px-2 py-1 text-[10px] text-slate-400">
                    Key
                  </th>
                  <th className="px-2 py-1 text-[10px] text-slate-400">
                    Size (chars)
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.map((item) => (
                  <tr
                    key={item.key}
                    className="border-b border-slate-800/60 hover:bg-slate-900/60"
                  >
                    <td className="px-2 py-1 text-[11px] text-slate-200 font-mono">
                      {item.key}
                    </td>
                    <td className="px-2 py-1 text-[11px] text-slate-300">
                      {item.size}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {backupMessage && (
          <div className="text-[11px] text-sky-300 bg-sky-950/40 border border-sky-700/60 rounded-lg px-3 py-2">
            {backupMessage}
          </div>
        )}

        <div>
          <label className="block text-[11px] text-slate-400 mb-1">
            Backup JSON (you can copy and save this)
          </label>
          <textarea
            className="w-full h-40 rounded-lg bg-slate-950 border border-slate-800 px-2 py-1.5 text-[11px] font-mono text-slate-50"
            value={backupJson}
            onChange={(e) => setBackupJson(e.target.value)}
            placeholder="Click 'Generate Backup JSON' to fill this."
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onCopyBackup}
              className="text-[11px] px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
            >
              Copy backup JSON
            </button>
          </div>
        </div>
      </div>

      {/* Restore */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-100">
          Restore from Backup
        </div>
        <p className="text-[11px] text-slate-500">
          Paste a backup JSON (created by this screen) below and apply it.
          This will overwrite existing{" "}
          <span className="font-mono">precisionpulse_*</span> keys in this
          browser&apos;s localStorage.
        </p>
        <textarea
          className="w-full h-40 rounded-lg bg-slate-950 border border-slate-800 px-2 py-1.5 text-[11px] font-mono text-slate-50"
          value={restoreJson}
          onChange={(e) => setRestoreJson(e.target.value)}
          placeholder="Paste backup JSON here..."
        />
        <button
          type="button"
          onClick={onRestore}
          className="text-[11px] px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
        >
          Restore Backup
        </button>
        {restoreMessage && (
          <div className="text-[11px] text-emerald-300 bg-emerald-950/40 border border-emerald-700/60 rounded-lg px-3 py-2">
            {restoreMessage}
          </div>
        )}
      </div>
    </div>
  );
}

// --------- User Accounts Section Component ---------

function UsersSection(props: {
  users: AppUser[];
  loadingUsers: boolean;
  displayedUsers: AppUser[];
  search: string;
  setSearch: (v: string) => void;
  editingId: string | null;
  name: string;
  email: string;
  accessRole: string;
  building: string;
  password: string;
  password2: string;
  userError: string | null;
  setName: (v: string) => void;
  setEmail: (v: string) => void;
  setAccessRole: (v: string) => void;
  setBuilding: (v: string) => void;
  setPassword: (v: string) => void;
  setPassword2: (v: string) => void;
  resetUserForm: () => void;
  onSubmit: (e: FormEvent) => void;
  onEdit: (u: AppUser) => void;
  onDelete: (u: AppUser) => void;
}) {
  const {
    users,
    loadingUsers,
    displayedUsers,
    search,
    setSearch,
    editingId,
    name,
    email,
    accessRole,
    building,
    password,
    password2,
    userError,
    setName,
    setEmail,
    setAccessRole,
    setBuilding,
    setPassword,
    setPassword2,
    resetUserForm,
    onSubmit,
    onEdit,
    onDelete,
  } = props;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-xs">
      {/* Form */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between mb-1">
          <div className="text-slate-200 text-sm font-semibold">
            {editingId ? "Edit User Account" : "Create User Account"}
          </div>
          {editingId && (
            <button
              type="button"
              onClick={resetUserForm}
              className="text-[11px] text-sky-300 hover:underline"
            >
              Clear / New
            </button>
          )}
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">
              Full Name
            </label>
            <input
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Example: John Doe"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">
              Email (login username)
            </label>
            <input
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@precisionlumping.com"
            />
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">
              System Role (access level)
            </label>
            <select
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
              value={accessRole}
              onChange={(e) => setAccessRole(e.target.value)}
            >
              {ACCESS_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-slate-500">
              This controls what they are in the system: Super Admin,
              Building Manager, HR, etc.
            </p>
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

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                {editingId ? "New Password (optional)" : "Password"}
              </label>
              <input
                type="password"
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={editingId ? "Leave blank = keep same" : ""}
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                {editingId ? "Confirm New Password" : "Confirm Password"}
              </label>
              <input
                type="password"
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
              />
            </div>
          </div>

          {userError && (
            <div className="text-[11px] text-rose-300 bg-rose-950/40 border border-rose-700/60 rounded-lg px-3 py-2">
              {userError}
            </div>
          )}

          <button
            type="submit"
            className="mt-1 w-full rounded-lg bg-sky-600 hover:bg-sky-500 text-[11px] font-medium text-white px-4 py-2"
          >
            {editingId ? "Save Changes" : "Create User"}
          </button>
        </form>
      </div>

      {/* Table */}
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-slate-200 text-sm font-semibold">
                Accounts
              </div>
              <div className="text-[11px] text-slate-500">
                Total:{" "}
                <span className="text-slate-100 font-semibold">
                  {users.length}
                </span>{" "}
                · Showing:{" "}
                <span className="text-slate-100 font-semibold">
                  {displayedUsers.length}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                placeholder="Search email / name / role"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {loadingUsers ? (
            <p className="text-sm text-slate-500">Loading accounts…</p>
          ) : displayedUsers.length === 0 ? (
            <p className="text-sm text-slate-500">
              No accounts found. Create a user on the left to get started.
            </p>
          ) : (
            <div className="overflow-auto max-h-[480px]">
              <table className="min-w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60">
                    <th className="px-3 py-2 text-[11px] text-slate-400">
                      Name
                    </th>
                    <th className="px-3 py-2 text-[11px] text-slate-400">
                      Email
                    </th>
                    <th className="px-3 py-2 text-[11px] text-slate-400">
                      System Role
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
                  {displayedUsers.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b border-slate-800/60 hover:bg-slate-900/60"
                    >
                      <td className="px-3 py-2 text-slate-100">
                        <div className="text-xs font-medium">
                          {u.name}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {u.email}
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {u.accessRole}
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {u.building}
                      </td>
                      <td className="px-3 py-2 text-slate-400 text-[11px] font-mono">
                        {u.createdAt.slice(0, 10)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-2">
                          <button
                            type="button"
                            onClick={() => onEdit(u)}
                            className="text-[11px] text-sky-300 hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(u)}
                            className="text-[11px] text-rose-300 hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

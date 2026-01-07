"use client";

import Link from "next/link";
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";

const SUPABASE_TABLES = [
  "workforce",
  "containers",
  "work_orders",
  "damage_reports",
  "terminations",
  "startup_checklists",
  "chats",
  "training_modules",
  "training_assignments",
  "hiring_pipeline",
  "staffing_coverage",
];

type BackupSnapshot = {
  createdAt: string;
  createdBy: string | null;
  tables: Record<string, Record<string, unknown>[]>;
};

export default function AdminPage() {
  const currentUser = useCurrentUser(); // redirects to /auth if not logged in

  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);

  const [restoreStatus, setRestoreStatus] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreLoading, setRestoreLoading] = useState(false);

  // If still loading user / redirecting
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center text-sm">
        Redirecting to login…
      </div>
    );
  }

  // Role gate: only Super Admin can use this page
  if (!currentUser || currentUser.accessRole !== "Super Admin") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50">
        <div className="mx-auto max-w-3xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-50">
                Admin / Backup
              </h1>
              <p className="text-sm text-slate-400">
                This area is restricted to Super Admins.
              </p>
            </div>
            <Link
              href="/"
              className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
            >
              ← Back to Dashboard
            </Link>
          </div>

          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 text-sm">
            <p className="text-slate-300">
              Your current access role is{" "}
              <span className="font-semibold text-sky-300">
                {currentUser.accessRole || "Worker"}
              </span>
              . Only users marked as{" "}
              <span className="font-semibold">Super Admin</span> in{" "}
              <code className="text-[11px] bg-slate-800 px-1 rounded">
                User Accounts
              </code>{" "}
              can view and use backup tools.
            </p>
          </div>
        </div>
      </div>
    );
  }

  async function handleBackupClick() {
    setBackupStatus(null);
    setBackupError(null);
    setBackupLoading(true);

    try {
      const tablesData: Record<string, Record<string, unknown>[]> = {};
      const errorTables: string[] = [];

      for (const table of SUPABASE_TABLES) {
        const { data, error } = await supabase.from(table).select("*");
        if (error) {
          console.warn(`Failed to fetch table ${table}`, error);
          errorTables.push(table);
          // still put an empty array so restore code doesn't break
          tablesData[table] = [];
        } else {
          tablesData[table] = data || [];
        }
      }

      const snapshot: BackupSnapshot = {
        createdAt: new Date().toISOString(),
        createdBy: currentUser?.email || null,
        tables: tablesData,
      };

      const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      a.href = url;
      a.download = `precisionpulse-supabase-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (errorTables.length > 0) {
        setBackupStatus(
          `Backup completed with warnings. Failed tables: ${errorTables.join(
            ", "
          )}`
        );
      } else {
        setBackupStatus("Backup completed and downloaded successfully.");
      }
    } catch (e: unknown) {
      console.error("Backup error", e);
      setBackupError("Unexpected error while creating backup file.");
    } finally {
      setBackupLoading(false);
    }
  }

  async function handleRestoreFileChange(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];
    if (!file) return;

    setRestoreStatus(null);
    setRestoreError(null);
    setRestoreLoading(true);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as BackupSnapshot;

      if (!parsed || !parsed.tables || typeof parsed.tables !== "object") {
        setRestoreError("Invalid backup file format.");
        setRestoreLoading(false);
        return;
      }

      const tableNames = Object.keys(parsed.tables);
      const failed: string[] = [];
      const succeeded: string[] = [];

      // Simple strategy: upsert rows for each table that exists in the backup.
      for (const table of tableNames) {
        const rows = parsed.tables[table];
        if (!Array.isArray(rows) || rows.length === 0) {
          continue;
        }

        // Only try restoring tables we know about. Skip anything unknown.
        if (!SUPABASE_TABLES.includes(table)) {
          console.warn(
            `Skipping unknown table from backup: ${table}`
          );
          continue;
        }

        const { error } = await supabase.from(table).upsert(rows);
        if (error) {
          console.error(`Restore error for table ${table}`, error);
          failed.push(table);
        } else {
          succeeded.push(table);
        }
      }

      if (failed.length > 0) {
        setRestoreStatus(
          `Restore finished with some errors. Restored: ${succeeded.join(
            ", "
          )}. Failed: ${failed.join(", ")}.`
        );
      } else {
        setRestoreStatus(
          `Restore completed successfully for tables: ${succeeded.join(
            ", "
          )}.`
        );
      }
    } catch (e: unknown) {
      console.error("Restore error", e);
      setRestoreError(
        "Unexpected error while restoring from backup file."
      );
    } finally {
      setRestoreLoading(false);
      // clear file input so you can re-select the same file if needed
      e.target.value = "";
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50">
      <div className="mx-auto max-w-4xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">
              Admin / Backup
            </h1>
            <p className="text-sm text-slate-400">
              Supabase-powered backup & restore for core Precision Pulse
              data. Super Admin only.
            </p>
          </div>
          <Link
            href="/"
            className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {/* Info card */}
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 text-xs space-y-2">
          <p className="text-slate-300">
            These tools work directly against your{" "}
            <span className="font-semibold text-sky-300">
              Supabase tables
            </span>{" "}
            (not just local browser data).
          </p>
          <ul className="list-disc list-inside text-slate-400 space-y-1">
            <li>
              <span className="font-semibold text-slate-200">
                Backup
              </span>{" "}
              downloads a JSON file containing rows from core tables
              like workforce, containers, work_orders, etc.
            </li>
            <li>
              <span className="font-semibold text-slate-200">
                Restore
              </span>{" "}
              will <span className="font-semibold">upsert</span> rows
              from that file back into the same tables. Use carefully.
            </li>
            <li>
              Only run restore if you know what you&apos;re doing – it
              can overwrite existing rows with the same primary keys.
            </li>
          </ul>
        </div>

        {/* Backup section */}
        <section className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4 text-sm">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Supabase Backup
              </h2>
              <p className="text-xs text-slate-400">
                Download a snapshot of core tables:{" "}
                <span className="text-slate-200">
                  {SUPABASE_TABLES.join(", ")}
                </span>
                .
              </p>
            </div>
            <button
              type="button"
              onClick={handleBackupClick}
              disabled={backupLoading}
              className="text-xs px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 disabled:cursor-not-allowed text-white"
            >
              {backupLoading ? "Creating Backup…" : "Download Backup JSON"}
            </button>
          </div>

          {backupStatus && (
            <div className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-800 rounded px-3 py-2">
              {backupStatus}
            </div>
          )}
          {backupError && (
            <div className="text-xs text-red-300 bg-red-950/40 border border-red-800 rounded px-3 py-2">
              {backupError}
            </div>
          )}
        </section>

        {/* Restore section */}
        <section className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4 text-sm">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Supabase Restore
              </h2>
              <p className="text-xs text-slate-400">
                Choose a JSON file that was downloaded from this page.
                Rows will be <span className="font-semibold">upserted</span>{" "}
                into the corresponding tables.
              </p>
            </div>
          </div>

          <div className="space-y-2 text-xs text-slate-400">
            <p>
              ⚠️ <span className="font-semibold text-amber-300">Warning:</span>{" "}
              This can overwrite existing data with the same primary keys
              (for example, matching <code>id</code> values).
            </p>
            <p>Recommended: test on dev/staging before using on live data.</p>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <input
              type="file"
              accept="application/json"
              onChange={handleRestoreFileChange}
              disabled={restoreLoading}
              className="text-[11px] file:mr-2 file:rounded-lg file:border file:border-slate-700 file:bg-slate-800 file:px-3 file:py-1.5 file:text-[11px] file:text-slate-100 file:hover:bg-slate-700"
            />
            {restoreLoading && (
              <span className="text-slate-400">Restoring…</span>
            )}
          </div>

          {restoreStatus && (
            <div className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-800 rounded px-3 py-2">
              {restoreStatus}
            </div>
          )}
          {restoreError && (
            <div className="text-xs text-red-300 bg-red-950/40 border border-red-800 rounded px-3 py-2">
              {restoreError}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

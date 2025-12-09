"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";

const BUILDINGS = ["DC1", "DC5", "DC11", "DC14", "DC18"];
const ROLES = [
  "Lumper",
  "Lead",
  "Supervisor",
  "Building Manager",
  "Forklift Operator",
  "Clamp Operator",
  "Shuttler",
  "Picker",
  "Sanitation",
  "Other",
];

const STATUS_OPTIONS = [
  "Assigned",
  "In Progress",
  "Completed",
  "Overdue",
] as const;

type TrainingStatus = (typeof STATUS_OPTIONS)[number];

type TrainingRow = {
  id: string;
  created_at: string;
  building: string | null;
  role: string | null;
  module_name: string | null;
  required: boolean | null;
  status: string | null;
  due_date: string | null; // date
  completed_at: string | null;
  assignee_name: string | null;
  notes: string | null;
};

type TrainingRecord = {
  id: string;
  createdAt: string;
  building: string;
  role: string;
  moduleName: string;
  required: boolean;
  status: TrainingStatus;
  dueDate?: string;
  completedAt?: string;
  assigneeName?: string;
  notes?: string;
};

function rowToRecord(row: TrainingRow): TrainingRecord {
  const statusRaw = (row.status ?? "Assigned") as TrainingStatus;
  return {
    id: String(row.id),
    createdAt: row.created_at ?? new Date().toISOString(),
    building: row.building ?? "DC18",
    role: row.role ?? "Lumper",
    moduleName: row.module_name ?? "",
    required: row.required ?? true,
    status:
      STATUS_OPTIONS.includes(statusRaw) ? statusRaw : "Assigned",
    dueDate: row.due_date ?? undefined,
    completedAt: row.completed_at ?? undefined,
    assigneeName: row.assignee_name ?? undefined,
    notes: row.notes ?? undefined,
  };
}

export default function TrainingPage() {
  const currentUser = useCurrentUser();

  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [building, setBuilding] = useState<string>("DC18");
  const [role, setRole] = useState<string>("Lumper");
  const [moduleName, setModuleName] = useState<string>("");
  const [required, setRequired] = useState<boolean>(true);
  const [status, setStatus] = useState<TrainingStatus>("Assigned");
  const [dueDate, setDueDate] = useState<string>("");
  const [assigneeName, setAssigneeName] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  // Filters
  const [filterBuilding, setFilterBuilding] = useState<string>("ALL");
  const [filterRole, setFilterRole] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] =
    useState<TrainingStatus | "ALL">("ALL");
  const [search, setSearch] = useState<string>("");

  function resetForm() {
    setEditingId(null);
    setBuilding("DC18");
    setRole("Lumper");
    setModuleName("");
    setRequired(true);
    setStatus("Assigned");
    setDueDate("");
    setAssigneeName("");
    setNotes("");
  }

  async function loadTraining() {
    if (!currentUser) return;

    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const { data, error } = await supabase
        .from("training_records")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error loading training records", error);
        setError("Failed to load training data from server.");
        return;
      }

      const rows = (data || []) as TrainingRow[];
      const mapped = rows.map(rowToRecord);
      setRecords(mapped);
    } catch (e) {
      console.error("Unexpected error loading training", e);
      setError("Unexpected error loading training data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!currentUser) return;
    loadTraining();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!moduleName.trim()) {
      setError("Module name is required.");
      return;
    }

    try {
      if (editingId) {
        // UPDATE
        const { error } = await supabase
          .from("training_records")
          .update({
            building,
            role,
            module_name: moduleName.trim(),
            required,
            status,
            due_date: dueDate || null,
            completed_at:
              status === "Completed"
                ? new Date().toISOString()
                : null,
            assignee_name: assigneeName.trim() || null,
            notes: notes.trim() || null,
          })
          .eq("id", editingId);

        if (error) {
          console.error("Error updating training record", error);
          setError("Failed to update training record.");
          return;
        }

        setInfo("Training record updated.");
      } else {
        // INSERT
        const { error } = await supabase.from("training_records").insert({
          building,
          role,
          module_name: moduleName.trim(),
          required,
          status,
          due_date: dueDate || null,
          completed_at:
            status === "Completed"
              ? new Date().toISOString()
              : null,
          assignee_name: assigneeName.trim() || null,
          notes: notes.trim() || null,
        });

        if (error) {
          console.error("Error inserting training record", error);
          setError("Failed to create training record.");
          return;
        }

        setInfo("Training record created.");
      }

      resetForm();
      await loadTraining();
    } catch (e) {
      console.error("Unexpected error saving training record", e);
      setError("Unexpected error saving training record.");
    }
  }

  async function handleDelete(id: string) {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "Delete this training record? This cannot be undone."
      );
      if (!ok) return;
    }

    try {
      const { error } = await supabase
        .from("training_records")
        .delete()
        .eq("id", id);

      if (error) {
        console.error("Error deleting training record", error);
        setError("Failed to delete training record.");
        return;
      }

      setInfo("Training record deleted.");
      if (editingId === id) resetForm();
      await loadTraining();
    } catch (e) {
      console.error("Unexpected error deleting training record", e);
      setError("Unexpected error deleting training record.");
    }
  }

  function handleEdit(rec: TrainingRecord) {
    setEditingId(rec.id);
    setBuilding(rec.building);
    setRole(rec.role);
    setModuleName(rec.moduleName);
    setRequired(rec.required);
    setStatus(rec.status);
    setDueDate(rec.dueDate ?? "");
    setAssigneeName(rec.assigneeName ?? "");
    setNotes(rec.notes ?? "");
  }

  const filteredRecords = useMemo(() => {
    let rows = [...records];

    if (filterBuilding !== "ALL") {
      rows = rows.filter((r) => r.building === filterBuilding);
    }
    if (filterRole !== "ALL") {
      rows = rows.filter((r) => r.role === filterRole);
    }
    if (filterStatus !== "ALL") {
      rows = rows.filter((r) => r.status === filterStatus);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          r.moduleName.toLowerCase().includes(q) ||
          (r.assigneeName || "").toLowerCase().includes(q) ||
          r.role.toLowerCase().includes(q)
      );
    }

    return rows;
  }, [records, filterBuilding, filterRole, filterStatus, search]);

  const summary = useMemo(() => {
    const total = records.length;
    const completed = records.filter(
      (r) => r.status === "Completed"
    ).length;
    const inProgress = records.filter(
      (r) => r.status === "In Progress"
    ).length;
    const overdue = records.filter(
      (r) => r.status === "Overdue"
    ).length;
    const requiredTotal = records.filter((r) => r.required).length;

    return { total, completed, inProgress, overdue, requiredTotal };
  }, [records]);

  // Route protection AFTER hooks
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex flex-col items-center justify-center text-sm gap-2">
        <div>Redirecting to login…</div>
        <a
          href="/auth"
          className="text-sky-400 text-xs underline hover:text-sky-300"
        >
          Click here if you are not redirected.
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50">
      <div className="mx-auto max-w-7xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">
              Training & Compliance
            </h1>
            <p className="text-sm text-slate-400">
              Track training modules, required compliance, and completion
              by building and role.
            </p>
          </div>
          <Link
            href="/"
            className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {/* Summary row */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 text-xs">
          <SummaryCard
            label="Total Records"
            value={summary.total}
            color="text-sky-300"
          />
          <SummaryCard
            label="Required Modules"
            value={summary.requiredTotal}
            color="text-slate-100"
          />
          <SummaryCard
            label="Completed"
            value={summary.completed}
            color="text-emerald-300"
          />
          <SummaryCard
            label="In Progress"
            value={summary.inProgress}
            color="text-amber-300"
          />
          <SummaryCard
            label="Overdue"
            value={summary.overdue}
            color="text-rose-300"
          />
        </div>

        {/* Error/info */}
        {error && (
          <div className="text-xs text-red-300 bg-red-950/40 border border-red-800 rounded px-3 py-2">
            {error}
          </div>
        )}
        {info && (
          <div className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-800 rounded px-3 py-2">
            {info}
          </div>
        )}
        {loading && (
          <div className="text-xs text-slate-400">
            Loading training records…
          </div>
        )}

        {/* Form + list */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-xs space-y-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-slate-200 text-sm font-semibold">
                {editingId ? "Edit Training Record" : "Add Training Record"}
              </div>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-[11px] text-sky-300 hover:underline"
                >
                  Clear / New
                </button>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Module Name
                </label>
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                  placeholder="Example: Safety - Powered Industrial Truck"
                  value={moduleName}
                  onChange={(e) => setModuleName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Building
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
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Role / Audience
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Status
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={status}
                    onChange={(e) =>
                      setStatus(e.target.value as TrainingStatus)
                    }
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end gap-2">
                  <label className="flex items-center gap-2 text-[11px] text-slate-400 mb-1">
                    <input
                      type="checkbox"
                      className="rounded border-slate-600 bg-slate-950"
                      checked={required}
                      onChange={(e) => setRequired(e.target.checked)}
                    />
                    Required module
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Due Date (optional)
                </label>
                <input
                  type="date"
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Assignee Name (optional)
                </label>
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                  placeholder="Lumper name / lead / manager..."
                  value={assigneeName}
                  onChange={(e) => setAssigneeName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Notes (optional)
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50 resize-none"
                  placeholder="Compliance details, renewal cadence, etc."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="mt-1 w-full rounded-lg bg-sky-600 hover:bg-sky-500 text-[11px] font-medium text-white px-4 py-2"
              >
                {editingId ? "Save Changes" : "Add Training Record"}
              </button>
            </form>
          </div>

          {/* Filters + list */}
          <div className="lg:col-span-2 space-y-4">
            {/* Filters */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-slate-200 text-sm font-semibold">
                    Filters
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Filter by building, role, status, or search text.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFilterBuilding("ALL");
                    setFilterRole("ALL");
                    setFilterStatus("ALL");
                    setSearch("");
                  }}
                  className="text-[11px] text-sky-300 hover:underline"
                >
                  Reset
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Building
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={filterBuilding}
                    onChange={(e) => setFilterBuilding(e.target.value)}
                  >
                    <option value="ALL">All Buildings</option>
                    {BUILDINGS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Role
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={filterRole}
                    onChange={(e) => setFilterRole(e.target.value)}
                  >
                    <option value="ALL">All Roles</option>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Status
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={filterStatus}
                    onChange={(e) =>
                      setFilterStatus(
                        e.target.value as TrainingStatus | "ALL"
                      )
                    }
                  >
                    <option value="ALL">All Status</option>
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Search
                  </label>
                  <input
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    placeholder="Module, assignee, role..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* List */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
              <div className="flex items-center justify-between mb-2">
                <div className="text-slate-200 text-sm font-semibold">
                  Training Records
                </div>
                <div className="text-[11px] text-slate-500">
                  Total:{" "}
                  <span className="font-semibold text-slate-200">
                    {records.length}
                  </span>{" "}
                  · Showing:{" "}
                  <span className="font-semibold text-slate-200">
                    {filteredRecords.length}
                  </span>
                </div>
              </div>

              {filteredRecords.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No training records match the current filters.
                </p>
              ) : (
                <div className="overflow-auto max-h-[520px]">
                  <table className="min-w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/60">
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Module
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Building / Role
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Assignee
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Due / Completed
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Required
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Status
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRecords.map((r) => {
                        let badgeClass =
                          "bg-slate-900/80 text-slate-200 border border-slate-600/70";
                        if (r.status === "Completed") {
                          badgeClass =
                            "bg-emerald-900/60 text-emerald-200 border border-emerald-700/70";
                        } else if (r.status === "In Progress") {
                          badgeClass =
                            "bg-sky-900/60 text-sky-200 border border-sky-700/70";
                        } else if (r.status === "Overdue") {
                          badgeClass =
                            "bg-rose-900/60 text-rose-200 border border-rose-700/70";
                        }

                        return (
                          <tr
                            key={r.id}
                            className="border-b border-slate-800/60 hover:bg-slate-900/60"
                          >
                            <td className="px-3 py-2 text-slate-100">
                              <div className="text-xs font-medium">
                                {r.moduleName}
                              </div>
                              {r.notes && (
                                <div className="text-[11px] text-slate-500 line-clamp-1">
                                  {r.notes}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              {r.building} • {r.role}
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              {r.assigneeName || "—"}
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              <div className="text-[11px] text-slate-400">
                                Due:{" "}
                                <span className="text-slate-100">
                                  {r.dueDate || "—"}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-400">
                                Done:{" "}
                                <span className="text-slate-100">
                                  {r.completedAt
                                    ? r.completedAt.slice(0, 10)
                                    : "—"}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              {r.required ? "Yes" : "No"}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={
                                  "inline-flex rounded-full px-2 py-0.5 text-[10px] " +
                                  badgeClass
                                }
                              >
                                {r.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="inline-flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleEdit(r)}
                                  className="text-[11px] text-sky-300 hover:underline"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(r.id)}
                                  className="text-[11px] text-rose-300 hover:underline"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

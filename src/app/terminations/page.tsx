"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { BUILDINGS } from "@/lib/buildings"; // ✅ shared buildings

const TERMINATIONS_KEY = "precisionpulse_terminations";

const STATUS_OPTIONS = ["In Progress", "Completed"];

type TerminationRecord = {
  id: string;
  employeeName: string;
  role: string;
  building: string;
  reason: string;
  status: string;
  checklist: Record<string, boolean>;
  notes?: string;
  createdAt: string;
};

type TerminationRow = {
  id: string;
  created_at: string;
  employee_name: string | null;
  role: string | null;
  building: string | null;
  reason: string | null;
  status: string | null;
  checklist: any | null;
  notes: string | null;
};

function rowToTermination(row: TerminationRow): TerminationRecord {
  const checklist =
    row.checklist && typeof row.checklist === "object"
      ? (row.checklist as Record<string, boolean>)
      : {
          equipmentCollected: false,
          badgeCollected: false,
          exitInterview: false,
          payrollUpdated: false,
        };

  return {
    id: String(row.id),
    employeeName: row.employee_name ?? "Unknown Worker",
    role: row.role ?? "",
    building: row.building ?? "DC18",
    reason: row.reason ?? "",
    status: row.status ?? "In Progress",
    checklist,
    notes: row.notes ?? "",
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

// Default checklist template for new terminations
function defaultChecklist(): Record<string, boolean> {
  return {
    equipmentCollected: false,
    badgeCollected: false,
    exitInterview: false,
    payrollUpdated: false,
  };
}

export default function TerminationsPage() {
  const currentUser = useCurrentUser();
  const isSuperAdmin = currentUser?.accessRole === "Super Admin";
  const isLead = currentUser?.accessRole === "Lead";
  const leadBuilding = currentUser?.building || "";

  const [records, setRecords] = useState<TerminationRecord[]>([]);

  // Form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [employeeName, setEmployeeName] = useState("");
  const [role, setRole] = useState("");
  const [building, setBuilding] = useState("DC18");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("In Progress");
  const [checklist, setChecklist] = useState<Record<string, boolean>>(
    defaultChecklist()
  );
  const [notes, setNotes] = useState("");

  // Filters
  const [filterBuilding, setFilterBuilding] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [search, setSearch] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function persist(next: TerminationRecord[]) {
    setRecords(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TERMINATIONS_KEY, JSON.stringify(next));
    }
  }

  async function refreshFromSupabase() {
    if (!currentUser) return;
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from("terminations")
        .select("*")
        .order("created_at", { ascending: false });

      // Leads only see terminations for their own building
      if (isLead && leadBuilding) {
        query = query.eq("building", leadBuilding);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error loading terminations", error);
        setError("Failed to load terminations from server.");
        return;
      }

      const rows: TerminationRow[] = (data || []) as TerminationRow[];
      const mapped = rows.map(rowToTermination);
      persist(mapped);
    } catch (e) {
      console.error("Unexpected error loading terminations", e);
      setError("Unexpected error loading terminations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!currentUser) return;
    refreshFromSupabase();
  }, [currentUser]);

  // Once we know user is a Lead, force their building for form + filters
  useEffect(() => {
    if (!currentUser) return;
    if (isLead && leadBuilding) {
      setBuilding((prev) => prev || leadBuilding);
      setFilterBuilding(leadBuilding);
    }
  }, [currentUser, isLead, leadBuilding]);

  function resetForm() {
    setEditingId(null);
    setEmployeeName("");
    setRole("");
    setBuilding(leadBuilding || "DC18");
    setReason("");
    setStatus("In Progress");
    setChecklist(defaultChecklist());
    setNotes("");
  }

  function handleChecklistToggle(key: string) {
    setChecklist((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }

  function handleEdit(item: TerminationRecord) {
    setEditingId(item.id);
    setEmployeeName(item.employeeName);
    setRole(item.role);
    setBuilding(item.building);
    setReason(item.reason);
    setStatus(item.status);
    setChecklist(item.checklist || defaultChecklist());
    setNotes(item.notes || "");
  }

  async function handleDelete(item: TerminationRecord) {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `Delete termination record for ${item.employeeName}?`
      );
      if (!ok) return;
    }

    setSaving(true);
    setError(null);

    try {
      const { error } = await supabase
        .from("terminations")
        .delete()
        .eq("id", item.id);

      if (error) {
        console.error("Error deleting termination", error);
        setError("Failed to delete termination.");
        return;
      }

      await refreshFromSupabase();
      if (editingId === item.id) {
        resetForm();
      }
    } catch (e) {
      console.error("Unexpected error deleting termination", e);
      setError("Unexpected error deleting termination.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;

    if (!employeeName.trim()) {
      if (typeof window !== "undefined") {
        window.alert("Please enter an employee name.");
      }
      return;
    }
    if (!reason.trim()) {
      if (typeof window !== "undefined") {
        window.alert("Please enter a termination reason.");
      }
      return;
    }

    // Compute status from checklist: if all done, mark Completed
    const checklistValues = Object.values(checklist);
    const allComplete =
      checklistValues.length > 0 && checklistValues.every(Boolean);
    const finalStatus = allComplete ? "Completed" : status;

    setSaving(true);
    setError(null);

    try {
      const payload = {
        employee_name: employeeName.trim(),
        role: role.trim() || null,
        building,
        reason: reason.trim(),
        status: finalStatus,
        checklist,
        notes: notes.trim() || null,
      };

      if (editingId) {
        const { error } = await supabase
          .from("terminations")
          .update(payload)
          .eq("id", editingId);

        if (error) {
          console.error("Error updating termination", error);
          setError("Failed to update termination.");
          return;
        }
      } else {
        const { error } = await supabase
          .from("terminations")
          .insert(payload);

        if (error) {
          console.error("Error inserting termination", error);
          setError("Failed to create termination record.");
          return;
        }
      }

      await refreshFromSupabase();
      resetForm();
    } catch (e) {
      console.error("Unexpected error saving termination", e);
      setError("Unexpected error saving termination.");
    } finally {
      setSaving(false);
    }
  }

  const displayedRecords = useMemo(() => {
    let rows = [...records];

    if (filterBuilding !== "ALL") {
      rows = rows.filter((r) => r.building === filterBuilding);
    }
    if (filterStatus !== "ALL") {
      rows = rows.filter((r) => r.status === filterStatus);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          r.employeeName.toLowerCase().includes(q) ||
          r.reason.toLowerCase().includes(q) ||
          (r.role || "").toLowerCase().includes(q)
      );
    }

    return rows;
  }, [records, filterBuilding, filterStatus, search]);

  // Summary metrics
  const totalTerminations = records.length;
  const completedCount = records.filter(
    (r) => r.status === "Completed"
  ).length;
  const inProgressCount = totalTerminations - completedCount;

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
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">
              Termination Workflows
            </h1>
            <p className="text-sm text-slate-400">
              Track termination checklists by employee, building, and status
              for clean HR compliance.
            </p>
          </div>
          <Link
            href="/"
            className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
            <div className="text-slate-400 mb-1">Total Terminations</div>
            <div className="text-2xl font-semibold text-sky-300">
              {totalTerminations}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              {isLead && leadBuilding
                ? `For ${leadBuilding}`
                : "Across all buildings"}
            </div>
          </div>
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
            <div className="text-slate-400 mb-1">In Progress</div>
            <div className="text-2xl font-semibold text-amber-300">
              {inProgressCount}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Checklists not fully completed
            </div>
          </div>
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
            <div className="text-slate-400 mb-1">Completed</div>
            <div className="text-2xl font-semibold text-emerald-300">
              {completedCount}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              All checklist items done
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-rose-700 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-100">
            {error}
          </div>
        )}

        {/* Form + list */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs space-y-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-slate-200 text-sm font-semibold">
                {editingId ? "Edit Termination" : "New Termination"}
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
                  Employee Name
                </label>
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                  placeholder="John Doe"
                  value={employeeName}
                  onChange={(e) => setEmployeeName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Role / Position
                </label>
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                  placeholder="Lumper, Lead, Supervisor..."
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
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
                    disabled={isLead && !!leadBuilding}
                  >
                    {BUILDINGS.map((b) => {
                      if (isLead && leadBuilding && b !== leadBuilding)
                        return null;
                      return (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Status
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Termination Reason
                </label>
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                  placeholder="Attendance, performance, voluntary, etc."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>

              {/* Checklist */}
              <div>
                <div className="text-[11px] text-slate-400 mb-1">
                  Required Checklist
                </div>
                <div className="space-y-1">
                  <label className="flex items-center gap-2 text-[11px] text-slate-200">
                    <input
                      type="checkbox"
                      checked={checklist.equipmentCollected}
                      onChange={() =>
                        handleChecklistToggle("equipmentCollected")
                      }
                    />
                    Equipment / PPE collected
                  </label>
                  <label className="flex items-center gap-2 text-[11px] text-slate-200">
                    <input
                      type="checkbox"
                      checked={checklist.badgeCollected}
                      onChange={() =>
                        handleChecklistToggle("badgeCollected")
                      }
                    />
                    Badge / access removed
                  </label>
                  <label className="flex items-center gap-2 text-[11px] text-slate-200">
                    <input
                      type="checkbox"
                      checked={checklist.exitInterview}
                      onChange={() => handleChecklistToggle("exitInterview")}
                    />
                    Exit interview completed
                  </label>
                  <label className="flex items-center gap-2 text-[11px] text-slate-200">
                    <input
                      type="checkbox"
                      checked={checklist.payrollUpdated}
                      onChange={() => handleChecklistToggle("payrollUpdated")}
                    />
                    Payroll updated / final pay
                  </label>
                </div>
                <p className="mt-1 text-[10px] text-slate-500">
                  When all steps are checked, status will be set to
                  &quot;Completed&quot; on save.
                </p>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Notes (optional)
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50 resize-none"
                  placeholder="Any additional HR notes or documentation details..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="mt-1 w-full rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-[11px] font-medium text-white px-4 py-2"
              >
                {saving
                  ? "Saving…"
                  : editingId
                  ? "Save Changes"
                  : "Create Termination"}
              </button>
            </form>
          </div>

          {/* Filters + table */}
          <div className="lg:col-span-2 space-y-4">
            {/* Filters */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-slate-200 text-sm font-semibold">
                    Filters
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Filter by building, status, or search by name / reason.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFilterStatus("ALL");
                    setSearch("");
                    setFilterBuilding(
                      isLead && leadBuilding ? leadBuilding : "ALL"
                    );
                  }}
                  className="text-[11px] text-sky-300 hover:underline"
                >
                  Reset
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Building
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={filterBuilding}
                    onChange={(e) => setFilterBuilding(e.target.value)}
                    disabled={isLead && !!leadBuilding}
                  >
                    {!isLead && <option value="ALL">All Buildings</option>}
                    {BUILDINGS.map((b) => {
                      if (isLead && leadBuilding && b !== leadBuilding)
                        return null;
                      return (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Status
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                  >
                    <option value="ALL">All Statuses</option>
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
                    placeholder="Name, reason, role..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>

              {loading && (
                <div className="mt-2 text-[11px] text-slate-500">
                  Loading termination workflows…
                </div>
              )}
            </div>

            {/* Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
              <div className="flex items-center justify-between mb-2">
                <div className="text-slate-200 text-sm font-semibold">
                  Termination List
                </div>
                <div className="text-[11px] text-slate-500">
                  Total:{" "}
                  <span className="font-semibold text-slate-200">
                    {totalTerminations}
                  </span>{" "}
                  · Showing:{" "}
                  <span className="font-semibold text-slate-200">
                    {displayedRecords.length}
                  </span>
                </div>
              </div>

              {displayedRecords.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No termination workflows match the current filters. Add
                  one on the left or adjust filters.
                </p>
              ) : (
                <div className="overflow-auto max-h-[480px]">
                  <table className="min-w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/60">
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Employee
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Role / Building
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Reason
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Checklist
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Status
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                          Created
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedRecords.map((r) => {
                        const checklistValues = Object.values(
                          r.checklist || {}
                        );
                        const totalSteps = checklistValues.length;
                        const doneSteps = checklistValues.filter(Boolean)
                          .length;

                        const badgeClass =
                          r.status === "Completed"
                            ? "bg-emerald-900/60 text-emerald-200 border border-emerald-700/70"
                            : "bg-amber-900/60 text-amber-200 border border-amber-700/70";

                        const createdShort = r.createdAt.slice(0, 10);

                        return (
                          <tr
                            key={r.id}
                            className="border-b border-slate-800/60 hover:bg-slate-900/60"
                          >
                            <td className="px-3 py-2 text-slate-100">
                              <div className="text-xs font-medium">
                                {r.employeeName}
                              </div>
                              {r.notes && (
                                <div className="text-[11px] text-slate-500 line-clamp-1">
                                  {r.notes}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              {r.role || "—"} · {r.building}
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              {r.reason || "—"}
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              {totalSteps > 0 ? (
                                <span className="text-[11px]">
                                  {doneSteps}/{totalSteps} steps
                                </span>
                              ) : (
                                <span className="text-[11px]">—</span>
                              )}
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
                            <td className="px-3 py-2 text-right text-slate-300 font-mono">
                              {createdShort}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="inline-flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleEdit(r)}
                                  className="text-[11px] text-sky-300 hover:underline"
                                  disabled={saving}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(r)}
                                  className="text-[11px] text-rose-300 hover:underline"
                                  disabled={saving}
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

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const WORKFORCE_STORAGE_KEY = "precisionpulse_workforce";
const TERMINATIONS_STORAGE_KEY = "precisionpulse_terminations";

const BUILDINGS = ["DC1", "DC5", "DC11", "DC14", "DC18"];

type WorkerStatus = "Active" | "Terminated" | "Candidate";

type Worker = {
  id: string;
  name: string;
  role: string;
  building: string;
  status: WorkerStatus;
  hireDate?: string;
  terminationDate?: string;
  notes?: string;
  createdAt: string;
};

type TerminationType = "Voluntary" | "Involuntary";
type TerminationStatus = "In Progress" | "Completed";

type Checklist = {
  badgeReturned: boolean;
  equipmentReturned: boolean;
  timecardVerified: boolean;
  exitInterviewCompleted: boolean;
  incidentReportFiled: boolean;
  supervisorSignOff: boolean;
  hrSignOff: boolean;
};

type TerminationRecord = {
  id: string;
  workerId: string;
  building: string;
  role: string;
  reason: string;
  type: TerminationType;
  notes?: string;
  createdAt: string;
  completedAt?: string;
  checklist: Checklist;
};

export default function TerminationsPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [terminations, setTerminations] = useState<TerminationRecord[]>([]);

  // form state
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [terminationType, setTerminationType] =
    useState<TerminationType>("Involuntary");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  // filters
  const [filterBuilding, setFilterBuilding] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] =
    useState<TerminationStatus | "ALL">("ALL");

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // load workforce + terminations
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const rawWorkers = window.localStorage.getItem(
        WORKFORCE_STORAGE_KEY
      );
      if (rawWorkers) {
        const all: Worker[] = JSON.parse(rawWorkers);
        setWorkers(all);
        if (all.length > 0) {
          setSelectedWorkerId(all[0].id);
        }
      }
    } catch (e) {
      console.error("Failed to load workforce for terminations", e);
    }

    try {
      const rawTerms = window.localStorage.getItem(
        TERMINATIONS_STORAGE_KEY
      );
      if (rawTerms) {
        setTerminations(JSON.parse(rawTerms));
      }
    } catch (e) {
      console.error("Failed to load terminations", e);
    }
  }, []);

  function saveTerminations(next: TerminationRecord[]) {
    setTerminations(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        TERMINATIONS_STORAGE_KEY,
        JSON.stringify(next)
      );
    }
  }

  const workersMap = useMemo(() => {
    const m: Record<string, Worker> = {};
    for (const w of workers) m[w.id] = w;
    return m;
  }, [workers]);

  function checklistProgress(c: Checklist) {
    const values = Object.values(c);
    const total = values.length;
    const done = values.filter(Boolean).length;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);
    return { total, done, percent };
  }

  function getStatus(t: TerminationRecord): TerminationStatus {
    const { total, done } = checklistProgress(t.checklist);
    return done === total && total > 0 ? "Completed" : "In Progress";
  }

  const summary = useMemo(() => {
    const total = terminations.length;
    let completed = 0;
    let inProgress = 0;

    for (const t of terminations) {
      const s = getStatus(t);
      if (s === "Completed") completed++;
      else inProgress++;
    }

    return { total, completed, inProgress };
  }, [terminations]);

  const buildingStats = useMemo(() => {
    const result: Record<
      string,
      { total: number; completed: number; inProgress: number }
    > = {};
    for (const b of BUILDINGS) {
      result[b] = { total: 0, completed: 0, inProgress: 0 };
    }
    for (const t of terminations) {
      const b = t.building;
      if (!result[b]) {
        result[b] = { total: 0, completed: 0, inProgress: 0 };
      }
      result[b].total++;
      const s = getStatus(t);
      if (s === "Completed") result[b].completed++;
      else result[b].inProgress++;
    }
    return result;
  }, [terminations]);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!selectedWorkerId) {
      setError("Select a worker to terminate.");
      return;
    }
    if (!reason.trim()) {
      setError("Termination reason is required.");
      return;
    }

    const worker = workersMap[selectedWorkerId];
    if (!worker) {
      setError("Selected worker not found.");
      return;
    }

    const now = new Date().toISOString();

    const newRecord: TerminationRecord = {
      id: `${Date.now()}`,
      workerId: worker.id,
      building: worker.building,
      role: worker.role,
      reason: reason.trim(),
      type: terminationType,
      notes: notes.trim() || undefined,
      createdAt: now,
      completedAt: undefined,
      checklist: {
        badgeReturned: false,
        equipmentReturned: false,
        timecardVerified: false,
        exitInterviewCompleted: false,
        incidentReportFiled: false,
        supervisorSignOff: false,
        hrSignOff: false,
      },
    };

    const next = [newRecord, ...terminations];
    saveTerminations(next);
    setReason("");
    setNotes("");
    setInfo("Termination record created. Complete the checklist to finalize.");

    // Optional: automatically set worker status to Terminated in workforce
    try {
      if (typeof window !== "undefined") {
        const rawWorkers = window.localStorage.getItem(
          WORKFORCE_STORAGE_KEY
        );
        if (rawWorkers) {
          const all: Worker[] = JSON.parse(rawWorkers);
          const todayStr = new Date().toISOString().slice(0, 10);
          const updated = all.map((w) =>
            w.id === worker.id
              ? {
                  ...w,
                  status: "Terminated" as WorkerStatus,
                  terminationDate: w.terminationDate || todayStr,
                }
              : w
          );
          window.localStorage.setItem(
            WORKFORCE_STORAGE_KEY,
            JSON.stringify(updated)
          );
          setWorkers(updated);
        }
      }
    } catch (e) {
      console.error("Failed to update workforce status on termination", e);
    }
  }

  function toggleChecklist(
    id: string,
    field: keyof Checklist
  ) {
    const now = new Date().toISOString();
    const next = terminations.map((t) => {
      if (t.id !== id) return t;
      const updatedChecklist: Checklist = {
        ...t.checklist,
        [field]: !t.checklist[field],
      };
      const { total, done } = checklistProgress(updatedChecklist);
      const allDone = done === total && total > 0;
      return {
        ...t,
        checklist: updatedChecklist,
        completedAt: allDone ? t.completedAt || now : undefined,
      };
    });

    saveTerminations(next);
  }

  const filteredTerminations = useMemo(() => {
    return terminations.filter((t) => {
      if (filterBuilding !== "ALL" && t.building !== filterBuilding) {
        return false;
      }
      const status = getStatus(t);
      if (filterStatus !== "ALL" && status !== filterStatus) {
        return false;
      }
      return true;
    });
  }, [terminations, filterBuilding, filterStatus]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">
            Terminations Workflow
          </h1>
          <p className="text-sm text-slate-400">
            Track terminations with required checklists, building-level
            visibility, and completion validation. A record is only
            considered completed when all checklist steps are done.
          </p>
        </div>
        <Link
          href="/"
          className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
        >
          ← Back to Dashboard
        </Link>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">
            Total Terminations
          </div>
          <div className="text-2xl font-semibold text-sky-300">
            {summary.total}
          </div>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">
            Completed
          </div>
          <div className="text-2xl font-semibold text-emerald-300">
            {summary.completed}
          </div>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">
            In Progress
          </div>
          <div className="text-2xl font-semibold text-amber-300">
            {summary.inProgress}
          </div>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">
            Buildings Involved
          </div>
          <div className="text-2xl font-semibold text-slate-100">
            {
              Object.values(buildingStats).filter(
                (b) => b.total > 0
              ).length
            }
          </div>
        </div>
      </div>

      {/* Building stats */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-slate-100 mb-3">
          Building Termination Overview
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-xs">
          {BUILDINGS.map((b) => {
            const stats = buildingStats[b];
            return (
              <div
                key={b}
                className="rounded-xl bg-slate-950 border border-slate-800 p-3"
              >
                <div className="text-slate-300 mb-1 font-semibold">
                  {b}
                </div>
                <div className="text-slate-400">
                  Total:{" "}
                  <span className="text-slate-100">
                    {stats?.total || 0}
                  </span>
                </div>
                <div className="text-slate-400">
                  Completed:{" "}
                  <span className="text-emerald-300">
                    {stats?.completed || 0}
                  </span>
                </div>
                <div className="text-slate-400">
                  In Progress:{" "}
                  <span className="text-amber-300">
                    {stats?.inProgress || 0}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Create termination + list */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create termination */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-100">
            Start Termination Workflow
          </h2>
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

          <form onSubmit={handleCreate} className="space-y-3 text-sm">
            <div>
              <label className="block text-xs text-slate-300 mb-1">
                Worker (from Workforce)
              </label>
              <select
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
                value={selectedWorkerId}
                onChange={(e) => setSelectedWorkerId(e.target.value)}
                disabled={workers.length === 0}
              >
                {workers.length === 0 ? (
                  <option value="">
                    Add workers in the Workforce page first
                  </option>
                ) : (
                  workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} • {w.role} • {w.building} •{" "}
                      {w.status}
                    </option>
                  ))
                )}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Status in Workforce will automatically be set to
                &ldquo;Terminated&rdquo;.
              </p>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1">
                Type
              </label>
              <select
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
                value={terminationType}
                onChange={(e) =>
                  setTerminationType(e.target.value as TerminationType)
                }
              >
                <option value="Involuntary">Involuntary</option>
                <option value="Voluntary">Voluntary (Resignation)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1">
                Reason
              </label>
              <input
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. No call/no show, performance, attendance"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1">
                Notes (optional)
              </label>
              <textarea
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-50"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional details, corrective actions, etc."
              />
            </div>

            <button
              type="submit"
              className="mt-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-sm font-medium text-white px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={workers.length === 0}
            >
              Create Termination Record
            </button>
          </form>
        </div>

        {/* Termination list with checklist */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 lg:col-span-2">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-100">
              Termination Records
            </h2>
            <div className="flex flex-wrap gap-2 text-xs">
              <select
                className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-slate-50"
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
              <select
                className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-slate-50"
                value={filterStatus}
                onChange={(e) =>
                  setFilterStatus(
                    e.target.value as TerminationStatus | "ALL"
                  )
                }
              >
                <option value="ALL">All Status</option>
                <option value="In Progress">In Progress</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
          </div>

          {filteredTerminations.length === 0 ? (
            <p className="text-sm text-slate-500">
              No termination records match the current filters.
            </p>
          ) : (
            <div className="space-y-3 text-xs max-h-[520px] overflow-auto pr-1">
              {filteredTerminations.map((t) => {
                const worker = workersMap[t.workerId];
                const status = getStatus(t);
                const progress = checklistProgress(t.checklist);

                return (
                  <div
                    key={t.id}
                    className="border border-slate-800 rounded-xl bg-slate-950 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-slate-100 text-sm font-semibold">
                          {worker?.name || "Unknown Worker"}
                        </div>
                        <div className="text-slate-400">
                          {worker?.role || t.role} •{" "}
                          {worker?.building || t.building}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {t.type} • Created:{" "}
                          {t.createdAt.slice(0, 10)}
                          {t.completedAt &&
                            ` • Completed: ${t.completedAt.slice(
                              0,
                              10
                            )}`}
                        </div>
                      </div>
                      <div className="text-right space-y-1">
                        <span
                          className={
                            status === "Completed"
                              ? "inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-900/60 text-emerald-200 border border-emerald-700 text-[11px]"
                              : "inline-flex items-center px-2 py-0.5 rounded-full bg-amber-900/60 text-amber-200 border border-amber-700 text-[11px]"
                          }
                        >
                          {status}
                        </span>
                        <div className="text-[11px] text-slate-400">
                          Checklist: {progress.done}/{progress.total} (
                          {progress.percent}%)
                        </div>
                        <div className="w-28 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-sky-500"
                            style={{ width: `${progress.percent}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="text-slate-300 text-[11px]">
                      Reason: <span className="text-slate-100">{t.reason}</span>
                    </div>
                    {t.notes && (
                      <div className="text-[11px] text-slate-400">
                        Notes: {t.notes}
                      </div>
                    )}

                    {/* Checklist */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-2 border-t border-slate-800">
                      <ChecklistItem
                        label="Badge/Vest Returned"
                        checked={t.checklist.badgeReturned}
                        onToggle={() =>
                          toggleChecklist(t.id, "badgeReturned")
                        }
                      />
                      <ChecklistItem
                        label="Equipment Returned"
                        checked={t.checklist.equipmentReturned}
                        onToggle={() =>
                          toggleChecklist(t.id, "equipmentReturned")
                        }
                      />
                      <ChecklistItem
                        label="Timecard Verified"
                        checked={t.checklist.timecardVerified}
                        onToggle={() =>
                          toggleChecklist(t.id, "timecardVerified")
                        }
                      />
                      <ChecklistItem
                        label="Exit Interview Completed"
                        checked={t.checklist.exitInterviewCompleted}
                        onToggle={() =>
                          toggleChecklist(
                            t.id,
                            "exitInterviewCompleted"
                          )
                        }
                      />
                      <ChecklistItem
                        label="Incident/Damage Report Filed"
                        checked={t.checklist.incidentReportFiled}
                        onToggle={() =>
                          toggleChecklist(
                            t.id,
                            "incidentReportFiled"
                          )
                        }
                      />
                      <ChecklistItem
                        label="Supervisor Sign-Off"
                        checked={t.checklist.supervisorSignOff}
                        onToggle={() =>
                          toggleChecklist(
                            t.id,
                            "supervisorSignOff"
                          )
                        }
                      />
                      <ChecklistItem
                        label="HR Sign-Off"
                        checked={t.checklist.hrSignOff}
                        onToggle={() =>
                          toggleChecklist(t.id, "hrSignOff")
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Small helper component for each checklist row */
function ChecklistItem({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border text-[11px] text-left ${
        checked
          ? "bg-emerald-900/40 border-emerald-700 text-emerald-100"
          : "bg-slate-900 border-slate-700 text-slate-200"
      }`}
    >
      <span
        className={`w-3 h-3 rounded border ${
          checked
            ? "bg-emerald-500 border-emerald-400"
            : "bg-slate-950 border-slate-600"
        }`}
      />
      <span>{label}</span>
    </button>
  );
}

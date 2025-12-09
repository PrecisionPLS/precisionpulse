"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const STARTUP_STORAGE_KEY = "precisionpulse_startup_checklists";

const BUILDINGS = ["DC1", "DC5", "DC11", "DC14", "DC18"];
const SHIFTS = ["1st", "2nd", "3rd", "4th"];

type ChecklistStatus = "In Progress" | "Completed";

type ChecklistItems = {
  staffingConfirmed: boolean;
  safetyTalkCompleted: boolean;
  equipmentChecked: boolean;
  dockAislesClear: boolean;
  goalsReviewed: boolean;
  whatsappBroadcastSent: boolean;
};

type StartupChecklist = {
  id: string;
  building: string;
  shift: string;
  date: string; // YYYY-MM-DD
  createdAt: string; // ISO
  completedAt?: string; // ISO
  items: ChecklistItems;
};

function getProgress(rec: StartupChecklist) {
  const values = Object.values(rec.items);
  const total = values.length;
  const done = values.filter(Boolean).length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, percent };
}

function getStatus(rec: StartupChecklist): ChecklistStatus {
  const { total, done } = getProgress(rec);
  return done === total && total > 0 ? "Completed" : "In Progress";
}

export default function StartupChecklistsPage() {
  const [records, setRecords] = useState<StartupChecklist[]>([]);

  // Form state
  const [building, setBuilding] = useState(BUILDINGS[0]);
  const [shift, setShift] = useState(SHIFTS[0]);
  const [date, setDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().slice(0, 10);
  });

  // Filters
  const [filterBuilding, setFilterBuilding] = useState<string>("ALL");
  const [filterShift, setFilterShift] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] =
    useState<ChecklistStatus | "ALL">("ALL");

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Load from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STARTUP_STORAGE_KEY);
      if (raw) {
        setRecords(JSON.parse(raw));
      }
    } catch (e) {
      console.error("Failed to load startup checklists", e);
    }
  }, []);

  function saveRecords(next: StartupChecklist[]) {
    setRecords(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        STARTUP_STORAGE_KEY,
        JSON.stringify(next)
      );
    }
  }

  const summary = useMemo(() => {
    const total = records.length;
    const completed = records.filter(
      (r) => getStatus(r) === "Completed"
    ).length;
    const inProgress = total - completed;

    const todayStr = new Date().toISOString().slice(0, 10);
    const todayRecords = records.filter((r) => r.date === todayStr);
    const todayTotal = todayRecords.length;
    const todayCompleted = todayRecords.filter(
      (r) => getStatus(r) === "Completed"
    ).length;

    return { total, completed, inProgress, todayTotal, todayCompleted };
  }, [records]);

  const buildingStats = useMemo(() => {
    const result: Record<
      string,
      { total: number; completed: number }
    > = {};
    for (const b of BUILDINGS) {
      result[b] = { total: 0, completed: 0 };
    }
    for (const r of records) {
      const b = r.building;
      if (!result[b]) {
        result[b] = { total: 0, completed: 0 };
      }
      result[b].total++;
      if (getStatus(r) === "Completed") result[b].completed++;
    }
    return result;
  }, [records]);

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (filterBuilding !== "ALL" && r.building !== filterBuilding) {
        return false;
      }
      if (filterShift !== "ALL" && r.shift !== filterShift) {
        return false;
      }
      if (filterStatus !== "ALL" && getStatus(r) !== filterStatus) {
        return false;
      }
      return true;
    });
  }, [records, filterBuilding, filterShift, filterStatus]);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!date.trim()) {
      setError("Date is required.");
      return;
    }

    // only one per building/shift/date
    const existing = records.find(
      (r) =>
        r.building === building && r.shift === shift && r.date === date
    );
    if (existing) {
      setError(
        "A startup checklist already exists for this building, shift, and date."
      );
      return;
    }

    const now = new Date().toISOString();

    const newRecord: StartupChecklist = {
      id: `${Date.now()}`,
      building,
      shift,
      date,
      createdAt: now,
      completedAt: undefined,
      items: {
        staffingConfirmed: false,
        safetyTalkCompleted: false,
        equipmentChecked: false,
        dockAislesClear: false,
        goalsReviewed: false,
        whatsappBroadcastSent: false,
      },
    };

    const next = [newRecord, ...records];
    saveRecords(next);
    setInfo("Startup checklist created. Use the list below to complete steps.");
  }

  function toggleItem(
    id: string,
    field: keyof ChecklistItems
  ) {
    const now = new Date().toISOString();
    const next = records.map((r) => {
      if (r.id !== id) return r;
      const updatedItems: ChecklistItems = {
        ...r.items,
        [field]: !r.items[field],
      };
      const updated: StartupChecklist = {
        ...r,
        items: updatedItems,
      };
      const status = getStatus(updated);
      if (status === "Completed" && !r.completedAt) {
        updated.completedAt = now;
      } else if (status === "In Progress" && r.completedAt) {
        updated.completedAt = undefined;
      }
      return updated;
    });
    saveRecords(next);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">
            Startup Meeting Checklists
          </h1>
          <p className="text-sm text-slate-400">
            Track daily pre-shift startup meetings by building and shift with
            required steps and completion status.
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
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">
            Total Checklists
          </div>
          <div className="text-2xl font-semibold text-sky-300">
            {summary.total}
          </div>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">Completed</div>
          <div className="text-2xl font-semibold text-emerald-300">
            {summary.completed}
          </div>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">In Progress</div>
          <div className="text-2xl font-semibold text-amber-300">
            {summary.inProgress}
          </div>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">
            Today&apos;s Checklists
          </div>
          <div className="text-2xl font-semibold text-slate-100">
            {summary.todayTotal}
          </div>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">
            Today Completed
          </div>
          <div className="text-2xl font-semibold text-emerald-300">
            {summary.todayCompleted}
          </div>
        </div>
      </div>

      {/* Building stats */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-slate-100 mb-3">
          Building Startup Overview
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-xs">
          {BUILDINGS.map((b) => {
            const stats = buildingStats[b];
            const rate =
              stats.total === 0
                ? 0
                : Math.round((stats.completed / stats.total) * 100);
            return (
              <div
                key={b}
                className="rounded-xl bg-slate-950 border border-slate-800 p-3"
              >
                <div className="text-slate-300 mb-1 font-semibold">
                  {b}
                </div>
                <div className="text-slate-400">
                  Checklists:{" "}
                  <span className="text-slate-100">
                    {stats.total}
                  </span>
                </div>
                <div className="text-slate-400">
                  Completed:{" "}
                  <span className="text-emerald-300">
                    {stats.completed}
                  </span>
                </div>
                <div className="text-slate-400 mt-1">
                  Completion Rate:{" "}
                  <span className="text-sky-300">{rate}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Form + list */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create checklist */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-100">
            Create Startup Checklist
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Building
                </label>
                <select
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
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
                <label className="block text-xs text-slate-300 mb-1">
                  Shift
                </label>
                <select
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
                  value={shift}
                  onChange={(e) => setShift(e.target.value)}
                >
                  {SHIFTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1">
                Date
              </label>
              <input
                type="date"
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="mt-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-sm font-medium text-white px-4 py-2"
            >
              Create Checklist
            </button>
          </form>
        </div>

        {/* List */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 lg:col-span-2">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-100">
              Startup Checklist History
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
                value={filterShift}
                onChange={(e) => setFilterShift(e.target.value)}
              >
                <option value="ALL">All Shifts</option>
                {SHIFTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-slate-50"
                value={filterStatus}
                onChange={(e) =>
                  setFilterStatus(
                    e.target.value as ChecklistStatus | "ALL"
                  )
                }
              >
                <option value="ALL">All Status</option>
                <option value="In Progress">In Progress</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
          </div>

          {filteredRecords.length === 0 ? (
            <p className="text-sm text-slate-500">
              No checklists match the current filters.
            </p>
          ) : (
            <div className="space-y-3 text-xs max-h-[520px] overflow-auto pr-1">
              {filteredRecords.map((r) => {
                const status = getStatus(r);
                const progress = getProgress(r);
                return (
                  <div
                    key={r.id}
                    className="border border-slate-800 rounded-xl bg-slate-950 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-slate-100 text-sm font-semibold">
                          {r.building} • {r.shift} Shift
                        </div>
                        <div className="text-slate-400">
                          Date: {r.date}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Created: {r.createdAt.slice(0, 10)}
                          {r.completedAt &&
                            ` • Completed: ${r.completedAt.slice(0, 10)}`}
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
                          Steps: {progress.done}/{progress.total} (
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

                    {/* Checklist toggles */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-2 border-t border-slate-800">
                      <ChecklistToggle
                        label="Staffing confirmed"
                        checked={r.items.staffingConfirmed}
                        onToggle={() =>
                          toggleItem(r.id, "staffingConfirmed")
                        }
                      />
                      <ChecklistToggle
                        label="Safety talk completed"
                        checked={r.items.safetyTalkCompleted}
                        onToggle={() =>
                          toggleItem(r.id, "safetyTalkCompleted")
                        }
                      />
                      <ChecklistToggle
                        label="Equipment checked"
                        checked={r.items.equipmentChecked}
                        onToggle={() =>
                          toggleItem(r.id, "equipmentChecked")
                        }
                      />
                      <ChecklistToggle
                        label="Dock/aisles clear"
                        checked={r.items.dockAislesClear}
                        onToggle={() =>
                          toggleItem(r.id, "dockAislesClear")
                        }
                      />
                      <ChecklistToggle
                        label="Goals reviewed"
                        checked={r.items.goalsReviewed}
                        onToggle={() =>
                          toggleItem(r.id, "goalsReviewed")
                        }
                      />
                      <ChecklistToggle
                        label="WhatsApp broadcast sent"
                        checked={r.items.whatsappBroadcastSent}
                        onToggle={() =>
                          toggleItem(r.id, "whatsappBroadcastSent")
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

function ChecklistToggle({
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

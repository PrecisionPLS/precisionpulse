"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { BUILDINGS } from "@/lib/buildings";

const SHIFT_OPTIONS = ["ALL", "1st", "2nd", "3rd", "4th"] as const;
type ShiftFilter = (typeof SHIFT_OPTIONS)[number];

const DATE_RANGES = ["Today", "Last 7 days", "Last 30 days", "All time", "Custom"] as const;
type DateRange = (typeof DATE_RANGES)[number];

type WorkerContribution = {
  name: string;
  minutesWorked: number;
  percentContribution: number;
  payout: number;
};

type ContainerRow = {
  id: string;
  created_at: string;
  building: string;
  shift: string | null;
  work_date: string | null;
  container_no: string;
  pieces_total: number;
  skus_total: number;
  pay_total: number;
  workers: WorkerContribution[];
  work_order_id: string | null;
  palletized?: boolean | null;
};

type WorkforceWorker = {
  id: string;
  fullName: string;
  building: string | null;
  shift: string | null;
  active: boolean;
};

type WorkforceRow = Record<string, unknown>;

function mapWorkforceRow(row: WorkforceRow): WorkforceWorker {
  const fullName =
    (typeof row.full_name === "string" ? row.full_name : null) ??
    (typeof row.fullName === "string" ? row.fullName : null) ??
    (typeof row.name === "string" ? row.name : null) ??
    (typeof row.worker_name === "string" ? row.worker_name : null) ??
    "Unknown";

  const building =
    (typeof row.building === "string" ? row.building : null) ??
    (typeof row.dc === "string" ? row.dc : null) ??
    (typeof row.location === "string" ? row.location : null) ??
    null;

  const shift =
    (typeof row.shift === "string" ? row.shift : null) ??
    (typeof row.shift_name === "string" ? row.shift_name : null) ??
    (typeof row.shiftName === "string" ? row.shiftName : null) ??
    null;

  const activeRaw =
    (typeof row.active === "boolean" ? row.active : null) ??
    (typeof row.is_active === "boolean" ? row.is_active : null) ??
    null;

  const statusRaw =
    (typeof row.status === "string" ? row.status : null) ??
    (typeof row.employment_status === "string" ? row.employment_status : null) ??
    null;

  const active =
    typeof activeRaw === "boolean"
      ? activeRaw
      : statusRaw
      ? String(statusRaw).toLowerCase().includes("active")
      : true;

  const idValue =
    (typeof row.id === "string" ? row.id : null) ??
    (typeof row.id === "number" ? String(row.id) : null) ??
    (typeof row.worker_id === "string" ? row.worker_id : null) ??
    (typeof row.worker_id === "number" ? String(row.worker_id) : null) ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()));

  return {
    id: String(idValue),
    fullName: String(fullName).trim(),
    building,
    shift,
    active,
  };
}

function money(n: number) {
  return `$${Number(n || 0).toFixed(2)}`;
}

/** --- no-any helpers --- */
function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null) {
    const rec = e as Record<string, unknown>;
    const msg = rec.message;
    if (typeof msg === "string") return msg;
  }
  return "Unknown error";
}

function toUnknownArray(data: unknown): unknown[] {
  return Array.isArray(data) ? data : [];
}

/** --- Date helpers (NY-safe) --- */
function parseDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  return String(value).slice(0, 10);
}

/**
 * Converts ISO timestamp → YYYY-MM-DD in America/New_York to avoid “missing day” issues.
 * If input is already date-only, it just returns it.
 */
function toNYDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;

  const s = String(value);

  // Already looks like YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);

  // en-CA gives YYYY-MM-DD format
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return fmt.format(d);
}

/** Pull “best” container date */
function getContainerDateNY(c: ContainerRow): string {
  return (
    toNYDateOnly(c.work_date) ||
    toNYDateOnly(c.created_at) ||
    parseDateOnly(c.work_date) ||
    parseDateOnly(c.created_at) ||
    ""
  );
}

/** --- Date range logic --- */
function isWithinPreset(dateStr: string | null, range: DateRange): boolean {
  if (!dateStr) return range === "All time";
  if (range === "All time") return true;
  if (range === "Custom") return true;

  const only = dateStr.slice(0, 10);
  const d = new Date(`${only}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;

  const todayNY = toNYDateOnly(new Date().toISOString()) || new Date().toISOString().slice(0, 10);
  const today = new Date(`${todayNY}T00:00:00`);
  const diffMs = today.getTime() - d.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (range === "Today") return only === todayNY;
  if (range === "Last 7 days") return diffDays >= 0 && diffDays <= 7;
  if (range === "Last 30 days") return diffDays >= 0 && diffDays <= 30;

  return true;
}

function isWithinCustom(dateStr: string | null, start: string | null, end: string | null): boolean {
  if (!dateStr) return false;
  const only = dateStr.slice(0, 10);

  if (!start && !end) return true;
  if (start && only < start) return false;
  if (end && only > end) return false;
  return true;
}

/** --- CSV --- */
function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      r
        .map((cell) => {
          const value = String(cell ?? "");
          if (value.includes(",") || value.includes('"') || value.includes("\n")) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        })
        .join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function WorkerHistoryPage() {
  const currentUser = useCurrentUser();

  const role = currentUser?.accessRole || "";
  const isLead = role === "Lead";
  const isBuildingManager = role === "Building Manager";
  const isSuperAdmin = role === "Super Admin";

  // Leads + Building Managers are restricted to only their building
  const scopedBuilding = currentUser?.building || "";
  const isScoped = (isLead || isBuildingManager) && !!scopedBuilding;

  const [error, setError] = useState<string | null>(null);

  const [workforce, setWorkforce] = useState<WorkforceWorker[]>([]);
  const [loadingWorkforce, setLoadingWorkforce] = useState(false);

  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [loadingContainers, setLoadingContainers] = useState(false);

  const [selectedWorkerName, setSelectedWorkerName] = useState<string | null>(null);

  const [search, setSearch] = useState("");

  // Filters (like other pages)
  const [buildingFilter, setBuildingFilter] = useState<string>(() => (isScoped ? scopedBuilding : "ALL"));
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>("ALL");

  const [dateRange, setDateRange] = useState<DateRange>("Last 7 days");
  const [customStart, setCustomStart] = useState<string>(""); // YYYY-MM-DD
  const [customEnd, setCustomEnd] = useState<string>(""); // YYYY-MM-DD

  const effectiveBuildingFilter = isScoped ? scopedBuilding : buildingFilter;

  const isDateMatch = useCallback(
    (dateStr: string | null) => {
      if (!isWithinPreset(dateStr, dateRange)) return false;

      if (dateRange === "Custom") {
        const start = customStart.trim() ? customStart.trim() : null;
        const end = customEnd.trim() ? customEnd.trim() : null;
        return isWithinCustom(dateStr, start, end);
      }

      return true;
    },
    [dateRange, customStart, customEnd]
  );

  // --- Load workforce ---
  const loadWorkforce = useCallback(async () => {
    if (!currentUser) return;
    setLoadingWorkforce(true);
    setError(null);

    try {
      let q = supabase.from("workforce").select("*").order("created_at", { ascending: false });
      if (isScoped) q = q.eq("building", scopedBuilding);

      const { data, error } = await q;
      if (error) throw error;

      const raw = toUnknownArray(data);
      const mapped = raw
        .map((r) => mapWorkforceRow(r as WorkforceRow))
        .filter((w) => w.fullName && w.fullName !== "Unknown" && w.active !== false);

      setWorkforce(mapped);
    } catch (e: unknown) {
      setError(`Failed to load workforce: ${getErrorMessage(e)}`);
    } finally {
      setLoadingWorkforce(false);
    }
  }, [currentUser, isScoped, scopedBuilding]);

  // --- Load containers ---
  const loadContainers = useCallback(async () => {
    if (!currentUser) return;
    setLoadingContainers(true);
    setError(null);

    try {
      let q = supabase.from("containers").select("*").order("created_at", { ascending: false });

      // scope for leads/building managers
      if (isScoped) q = q.eq("building", scopedBuilding);

      // for HQ users: if they picked a building, scope server-side for speed
      if (!isScoped && buildingFilter !== "ALL") q = q.eq("building", buildingFilter);

      const { data, error } = await q;
      if (error) throw error;

      const raw = toUnknownArray(data);

      const rows: ContainerRow[] = raw.map((rowU) => {
        const row = rowU as Record<string, unknown>;

        const workersRaw = row.workers;
        const workers: WorkerContribution[] = Array.isArray(workersRaw)
          ? (workersRaw as WorkerContribution[])
          : [];

        return {
          id: String(row.id ?? ""),
          created_at: String(row.created_at ?? ""),
          building: String(row.building ?? ""),
          shift: (row.shift ?? null) as string | null,
          work_date: (row.work_date ?? null) as string | null,
          container_no: String(row.container_no ?? ""),
          pieces_total: Number(row.pieces_total ?? 0),
          skus_total: Number(row.skus_total ?? 0),
          pay_total: Number(row.pay_total ?? 0),
          workers,
          work_order_id: (row.work_order_id ?? null) as string | null,
          palletized: (row.palletized ?? null) as boolean | null,
        };
      });

      setContainers(rows);
    } catch (e: unknown) {
      setError(`Failed to load containers: ${getErrorMessage(e)}`);
    } finally {
      setLoadingContainers(false);
    }
  }, [currentUser, isScoped, scopedBuilding, buildingFilter]);

  useEffect(() => {
    if (!currentUser) return;
    loadWorkforce();
  }, [currentUser, loadWorkforce]);

  useEffect(() => {
    if (!currentUser) return;
    loadContainers();
  }, [currentUser, loadContainers]);

  // Keep building filter locked for scoped users
  useEffect(() => {
    if (!currentUser) return;
    if (isScoped) setBuildingFilter(scopedBuilding);
  }, [currentUser, isScoped, scopedBuilding]);

  // Workers list filtered
  const filteredWorkers = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = workforce;

    // building filter for HQ users
    if (!isScoped && effectiveBuildingFilter !== "ALL") {
      list = list.filter((w) => !w.building || w.building === effectiveBuildingFilter);
    }

    if (!q) return list.slice(0, 200);
    return list.filter((w) => w.fullName.toLowerCase().includes(q)).slice(0, 200);
  }, [workforce, search, isScoped, effectiveBuildingFilter]);

  // Build “ledger” for the selected worker
  type WorkerContainerLine = {
    containerId: string;
    date: string;
    building: string;
    shift: string;
    containerNo: string;
    type: string;
    pieces: number;
    skus: number;
    containerPayTotal: number;
    minutes: number;
    percent: number;
    payout: number;
    workOrderId: string | null;
  };

  const selectedWorkerLines = useMemo((): WorkerContainerLine[] => {
    if (!selectedWorkerName) return [];

    const target = selectedWorkerName.trim().toLowerCase();
    const lines: WorkerContainerLine[] = [];

    for (const c of containers) {
      const match = (c.workers || []).find((w) => String(w.name || "").trim().toLowerCase() === target);
      if (!match) continue;

      const d = getContainerDateNY(c);
      if (!isDateMatch(d)) continue;

      // building filter
      if (effectiveBuildingFilter !== "ALL" && c.building !== effectiveBuildingFilter) continue;

      // shift filter
      const shift = c.shift ?? "—";
      if (shiftFilter !== "ALL" && shift !== shiftFilter) continue;

      lines.push({
        containerId: c.id,
        date: d,
        building: c.building,
        shift,
        containerNo: c.container_no,
        type: c.palletized ? "Palletized" : "Loose",
        pieces: Number(c.pieces_total || 0),
        skus: Number(c.skus_total || 0),
        containerPayTotal: Number(c.pay_total || 0),
        minutes: Number(match.minutesWorked || 0),
        percent: Number(match.percentContribution || 0),
        payout: Number(match.payout || 0),
        workOrderId: c.work_order_id ?? null,
      });
    }

    // newest first
    lines.sort((a, b) => b.date.localeCompare(a.date));
    return lines;
  }, [containers, selectedWorkerName, effectiveBuildingFilter, shiftFilter, isDateMatch]);

  const selectedTotals = useMemo(() => {
    const totalContainers = selectedWorkerLines.length;
    const totalPayout = selectedWorkerLines.reduce((sum, r) => sum + (r.payout || 0), 0);
    const totalMinutes = selectedWorkerLines.reduce((sum, r) => sum + (r.minutes || 0), 0);
    const totalPieces = selectedWorkerLines.reduce((sum, r) => sum + (r.pieces || 0), 0);
    return { totalContainers, totalPayout, totalMinutes, totalPieces };
  }, [selectedWorkerLines]);

  /** --- Payroll export (per worker per container) --- */
  type PayrollExportLine = {
    date: string;
    building: string;
    shift: string;
    workerName: string;
    containerNo: string;
    pieces: number;
    workerPayout: number;
    minutes: number;
    percent: number;
  };

  const payrollExportLines = useMemo((): PayrollExportLine[] => {
    const lines: PayrollExportLine[] = [];

    for (const c of containers) {
      // building filter
      if (effectiveBuildingFilter !== "ALL" && c.building !== effectiveBuildingFilter) continue;

      // shift filter
      const shift = c.shift ?? "—";
      if (shiftFilter !== "ALL" && shift !== shiftFilter) continue;

      // date filter
      const d = getContainerDateNY(c);
      if (!isDateMatch(d)) continue;

      const containerNo = String(c.container_no || "") || String(c.id || "");
      const pieces = Number(c.pieces_total || 0);

      for (const w of c.workers || []) {
        const name = String(w.name || "").trim();
        if (!name) continue;

        lines.push({
          date: d,
          building: c.building || "—",
          shift,
          workerName: name,
          containerNo,
          pieces,
          workerPayout: Number(w.payout || 0),
          minutes: Number(w.minutesWorked || 0),
          percent: Number(w.percentContribution || 0),
        });
      }
    }

    lines.sort((a, b) => {
      if (a.date === b.date) {
        if (a.building === b.building) {
          if (a.shift === b.shift) {
            if (a.workerName === b.workerName) return a.containerNo.localeCompare(b.containerNo);
            return a.workerName.localeCompare(b.workerName);
          }
          return a.shift.localeCompare(b.shift);
        }
        return a.building.localeCompare(b.building);
      }
      return a.date.localeCompare(b.date);
    });

    return lines;
  }, [containers, effectiveBuildingFilter, shiftFilter, isDateMatch]);

  function makeFilterLabel() {
    const b = effectiveBuildingFilter === "ALL" ? "all-buildings" : effectiveBuildingFilter.toLowerCase();
    const s = shiftFilter === "ALL" ? "all-shifts" : String(shiftFilter).toLowerCase();
    let d = dateRange.replace(/\s+/g, "-").toLowerCase();
    if (dateRange === "Custom") {
      const cs = customStart ? customStart : "start";
      const ce = customEnd ? customEnd : "end";
      d = `custom-${cs}-to-${ce}`;
    }
    return `${b}-${s}-${d}`;
  }

  function handleExportPayrollCsv() {
    const header = ["Date", "Building", "Shift", "Worker Name", "Container #", "Pieces", "Worker Payout", "Minutes", "% Split"];
    const rows = payrollExportLines.map((r) => [
      r.date,
      r.building,
      r.shift,
      r.workerName,
      r.containerNo,
      r.pieces,
      r.workerPayout.toFixed(2),
      r.minutes,
      r.percent.toFixed(2),
    ]);

    downloadCsv(`payroll-export-${makeFilterLabel()}.csv`, header, rows);
  }

  function handleResetFilters() {
    setShiftFilter("ALL");
    setDateRange("Last 7 days");
    setCustomStart("");
    setCustomEnd("");
    setBuildingFilter(isScoped ? scopedBuilding : "ALL");
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex flex-col items-center justify-center text-sm gap-2">
        <div>Redirecting to login…</div>
        <a href="/auth" className="text-sky-400 text-xs underline hover:text-sky-300">
          Click here if you are not redirected.
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50">
      <div className="mx-auto max-w-7xl p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">Worker History</h1>
            <p className="text-sm text-slate-400">
              Click a worker to view every container they worked, plus earnings per container. (Read-only)
            </p>
            {isScoped && (
              <p className="text-[11px] text-slate-500 mt-1">
                Access restricted to <span className="text-sky-300 font-semibold">{scopedBuilding}</span>.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
            >
              ← Back to Dashboard
            </Link>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-700 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-100">
            {error}
          </div>
        )}

        {/* Filters + Export (Super Admin only) */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs w-full">
              <div>
                <div className="text-[11px] text-slate-400 mb-1">Building</div>
                <select
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-50"
                  value={effectiveBuildingFilter}
                  onChange={(e) => setBuildingFilter(e.target.value)}
                  disabled={isScoped}
                >
                  {!isScoped && <option value="ALL">All Buildings</option>}
                  {BUILDINGS.map((b) => {
                    if (isScoped && b !== scopedBuilding) return null;
                    return (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <div className="text-[11px] text-slate-400 mb-1">Shift</div>
                <select
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-50"
                  value={shiftFilter}
                  onChange={(e) => setShiftFilter(e.target.value as ShiftFilter)}
                >
                  {SHIFT_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s === "ALL" ? "All Shifts" : s}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="text-[11px] text-slate-400 mb-1">Date Preset</div>
                <select
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-50"
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value as DateRange)}
                >
                  {DATE_RANGES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 px-3 py-2 text-[11px] text-slate-200"
                >
                  Reset
                </button>
              </div>

              {dateRange === "Custom" && (
                <>
                  <div>
                    <div className="text-[11px] text-slate-400 mb-1">Start Date</div>
                    <input
                      type="date"
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-50"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                    />
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400 mb-1">End Date</div>
                    <input
                      type="date"
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-50"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                    />
                  </div>
                  <div className="md:col-span-2 text-[11px] text-slate-500 flex items-center">
                    Tip: pick a range, then export payroll CSV (Super Admin only).
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-col items-end gap-2">
              {isSuperAdmin ? (
                <>
                  <button
                    type="button"
                    onClick={handleExportPayrollCsv}
                    className="text-[11px] px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 text-slate-200"
                  >
                    Export Payroll CSV
                  </button>
                  <div className="text-[10px] text-slate-500 text-right max-w-sm">
                    Export includes: Date, DC, Shift, Worker Name, Container #, Pieces, Worker Payout (plus minutes/% split).
                  </div>
                  <div className="text-[10px] text-slate-500 text-right">
                    Rows in export: <span className="text-sky-300 font-semibold">{payrollExportLines.length}</span>
                  </div>
                </>
              ) : (
                <div className="text-[11px] text-slate-500 text-right max-w-sm">
                  Payroll export is restricted to <span className="text-slate-200 font-semibold">Super Admin</span>.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT: worker list */}
          <div className="lg:col-span-4 space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-100">Workers</div>
                {(loadingWorkforce || loadingContainers) && (
                  <div className="text-[11px] text-slate-500">
                    Loading… {loadingWorkforce ? "workforce" : ""} {loadingContainers ? "containers" : ""}
                  </div>
                )}
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3">
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-[12px] text-slate-50"
                  placeholder="Search worker name…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />

                <div className="max-h-[520px] overflow-auto rounded-xl border border-slate-800 bg-slate-950">
                  {filteredWorkers.length === 0 ? (
                    <div className="px-3 py-3 text-[11px] text-slate-500">No matches.</div>
                  ) : (
                    filteredWorkers.map((w) => {
                      const active = selectedWorkerName === w.fullName;
                      return (
                        <button
                          key={w.id}
                          type="button"
                          onClick={() => setSelectedWorkerName(w.fullName)}
                          className={`w-full text-left px-3 py-2 border-b border-slate-800 hover:bg-slate-900 ${
                            active ? "bg-sky-950/20" : ""
                          }`}
                        >
                          <div className="text-[12px] text-slate-100 font-medium">{w.fullName}</div>
                          <div className="text-[11px] text-slate-500">
                            {w.building ?? "—"} • {w.shift ?? "—"}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="text-[10px] text-slate-500">
                  Showing {filteredWorkers.length} (max 200). Earnings are pulled from containers → workers[].
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: selected worker detail */}
          <div className="lg:col-span-8 space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              {!selectedWorkerName ? (
                <div className="text-[12px] text-slate-400">Select a worker on the left to view their container history.</div>
              ) : (
                <>
                  <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-100">{selectedWorkerName}</div>
                      <div className="text-[11px] text-slate-400">
                        Filters apply above (Building / Shift / Date). Dates are normalized to{" "}
                        <span className="text-slate-200">America/New_York</span> to prevent missing days.
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-[11px]">
                      <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-slate-200">
                        Containers:{" "}
                        <span className="ml-1 font-semibold text-sky-300">{selectedTotals.totalContainers}</span>
                      </span>
                      <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-slate-200">
                        Earnings:{" "}
                        <span className="ml-1 font-semibold text-emerald-300">{money(selectedTotals.totalPayout)}</span>
                      </span>
                      <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-slate-200">
                        Minutes:{" "}
                        <span className="ml-1 font-semibold text-slate-100">{selectedTotals.totalMinutes}</span>
                      </span>
                      <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-slate-200">
                        Pieces:{" "}
                        <span className="ml-1 font-semibold text-slate-100">{selectedTotals.totalPieces}</span>
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                          <th className="text-left py-2 pr-3">Date</th>
                          <th className="text-left py-2 pr-3">Building</th>
                          <th className="text-left py-2 pr-3">Shift</th>
                          <th className="text-left py-2 pr-3">Container #</th>
                          <th className="text-left py-2 pr-3">Type</th>
                          <th className="text-right py-2 pr-3">Pieces</th>
                          <th className="text-right py-2 pr-3">Pay Total</th>
                          <th className="text-right py-2 pr-3">Minutes</th>
                          <th className="text-right py-2 pr-3">% Split</th>
                          <th className="text-right py-2 pr-3">Worker Payout</th>
                          <th className="text-left py-2 pr-3">Work Order</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedWorkerLines.length === 0 ? (
                          <tr>
                            <td className="py-4 text-[11px] text-slate-500" colSpan={11}>
                              No containers found for this worker in the selected filters.
                            </td>
                          </tr>
                        ) : (
                          selectedWorkerLines.map((r) => (
                            <tr key={r.containerId} className="border-b border-slate-800/60 hover:bg-slate-900/60">
                              <td className="py-2 pr-3 text-[11px] text-slate-400">{r.date}</td>
                              <td className="py-2 pr-3 text-[11px] text-slate-200">{r.building}</td>
                              <td className="py-2 pr-3 text-[11px] text-slate-200">{r.shift}</td>
                              <td className="py-2 pr-3 text-[11px] text-slate-200">{r.containerNo}</td>
                              <td className="py-2 pr-3 text-[11px] text-slate-200">{r.type}</td>
                              <td className="py-2 pr-3 text-right text-[11px] text-slate-200">{r.pieces}</td>
                              <td className="py-2 pr-3 text-right text-[11px] text-emerald-300">{money(r.containerPayTotal)}</td>
                              <td className="py-2 pr-3 text-right text-[11px] text-slate-200">{r.minutes}</td>
                              <td className="py-2 pr-3 text-right text-[11px] text-slate-200">{r.percent.toFixed(2)}%</td>
                              <td className="py-2 pr-3 text-right text-[11px] text-sky-300 font-semibold">{money(r.payout)}</td>
                              <td className="py-2 pr-3 text-[11px] text-slate-400">
                                {r.workOrderId ? r.workOrderId.slice(0, 8) + "…" : "—"}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-3 text-[10px] text-slate-500">
                    Note: This is read-only. Earnings are pulled from each container’s worker payout entry.
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

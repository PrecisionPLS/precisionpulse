"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const CONTAINERS_KEY = "precisionpulse_containers";
const SHIFTS_KEY = "precisionpulse_shifts";

const BUILDINGS = ["DC1", "DC5", "DC11", "DC14", "DC18"];
const SHIFTS = ["1st", "2nd", "3rd", "4th"];

type WorkerAssignment = {
  id: string;
  workerId: string;
  workerName: string;
  role?: string;
  minutesWorked: number;
  percentContribution: number;
  payout: number;
};

type ContainerRecord = {
  id: string;
  workOrderId?: string;
  building: string;
  shift: string;
  containerNo: string;
  piecesTotal: number;
  skusTotal: number;
  containerPayTotal: number;
  createdAt: string;
  workers: WorkerAssignment[];
};

type ShiftConfig = {
  id: string;
  building: string;
  shift: string;
  requiredStaff: number;
  active?: boolean;
};

// Try to normalize shift configs from whatever the Shifts page stored
function normalizeShift(raw: any): ShiftConfig {
  const building =
    raw?.building ||
    raw?.buildingCode ||
    raw?.assignedBuilding ||
    "DC1";

  const shift =
    raw?.shift ||
    raw?.shiftName ||
    raw?.name ||
    "1st";

  const required =
    Number(
      raw?.requiredStaff ??
        raw?.requiredStaffCount ??
        raw?.staffRequired ??
        raw?.headcountRequired
    ) || 0;

  return {
    id: String(raw?.id ?? `${building}-${shift}`),
    building,
    shift,
    requiredStaff: required,
    active:
      typeof raw?.active === "boolean"
        ? raw.active
        : raw?.status === "Active"
        ? true
        : true,
  };
}

// Normalize containers to be safe
function normalizeContainer(raw: any): ContainerRecord {
  const pieces = Number(raw?.piecesTotal ?? 0) || 0;
  const skus = Number(raw?.skusTotal ?? 0) || 0;
  const workersRaw: any[] = Array.isArray(raw?.workers)
    ? raw.workers
    : [];

  const workers: WorkerAssignment[] = workersRaw.map((w, idx) => ({
    id: String(w.id ?? `worker-${idx}-${raw?.id ?? Date.now()}`),
    workerId: String(w.workerId ?? ""),
    workerName: String(w.workerName ?? w.name ?? "Unknown"),
    role: w.role ?? "",
    minutesWorked: Number(w.minutesWorked ?? 0) || 0,
    percentContribution: Number(w.percentContribution ?? 0) || 0,
    payout: Number(w.payout ?? 0) || 0,
  }));

  return {
    id: String(raw?.id ?? Date.now()),
    workOrderId: raw?.workOrderId,
    building: raw?.building ?? "DC1",
    shift: raw?.shift ?? "1st",
    containerNo: raw?.containerNo ?? "",
    piecesTotal: pieces,
    skusTotal: skus,
    containerPayTotal: Number(raw?.containerPayTotal ?? 0) || 0,
    createdAt: raw?.createdAt ?? new Date().toISOString(),
    workers,
  };
}

type StaffingRow = {
  building: string;
  shift: string;
  requiredStaff: number;
  actualWorkers: number;
  diff: number;
  status: "Under" | "Balanced" | "Over" | "No Target";
  containers: number;
  pieces: number;
};

export default function StaffingPage() {
  const [containers, setContainers] = useState<ContainerRecord[]>([]);
  const [shifts, setShifts] = useState<ShiftConfig[]>([]);

  const todayStr = new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState<string>(todayStr);
  const [buildingFilter, setBuildingFilter] = useState<string>("ALL");
  const [shiftFilter, setShiftFilter] = useState<string>("ALL");

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Load containers
    try {
      const raw = window.localStorage.getItem(CONTAINERS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const normalized = Array.isArray(parsed)
          ? parsed.map(normalizeContainer)
          : [];
        setContainers(normalized);
      }
    } catch (e) {
      console.error("Failed to load containers for staffing", e);
    }

    // Load shift configs
    try {
      const raw = window.localStorage.getItem(SHIFTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const normalized = Array.isArray(parsed)
          ? parsed.map(normalizeShift)
          : [];
        setShifts(normalized);
      }
    } catch (e) {
      console.error("Failed to load shifts for staffing", e);
    }
  }, []);

  const staffingRows = useMemo<StaffingRow[]>(() => {
    type Acc = {
      building: string;
      shift: string;
      requiredStaff: number;
      workerIds: Set<string>;
      containers: number;
      pieces: number;
    };

    const map = new Map<string, Acc>();

    // Build a lookup of required staff from shift configs (per building+shift)
    const requiredMap = new Map<string, number>();
    for (const s of shifts) {
      if (s.active === false) continue;
      const key = `${s.building}::${s.shift}`;
      requiredMap.set(key, s.requiredStaff || 0);
    }

    // Walk containers for the selected date and filters
    for (const c of containers) {
      const day = (c.createdAt || "").slice(0, 10);
      if (date && day !== date) continue;

      if (buildingFilter !== "ALL" && c.building !== buildingFilter) {
        continue;
      }

      if (shiftFilter !== "ALL" && c.shift !== shiftFilter) {
        continue;
      }

      const key = `${c.building}::${c.shift}`;
      let acc = map.get(key);
      if (!acc) {
        acc = {
          building: c.building,
          shift: c.shift,
          requiredStaff: requiredMap.get(key) ?? 0,
          workerIds: new Set<string>(),
          containers: 0,
          pieces: 0,
        };
        map.set(key, acc);
      }

      acc.containers += 1;
      acc.pieces += c.piecesTotal || 0;

      for (const w of c.workers || []) {
        const id = w.workerId || w.workerName;
        if (id) acc.workerIds.add(id);
      }
    }

    // Also include shift configs that might not yet have containers for the day
    for (const s of shifts) {
      if (buildingFilter !== "ALL" && s.building !== buildingFilter) {
        continue;
      }
      if (shiftFilter !== "ALL" && s.shift !== shiftFilter) {
        continue;
      }
      const key = `${s.building}::${s.shift}`;
      if (!map.has(key)) {
        map.set(key, {
          building: s.building,
          shift: s.shift,
          requiredStaff: s.requiredStaff || 0,
          workerIds: new Set<string>(),
          containers: 0,
          pieces: 0,
        });
      }
    }

    const rows: StaffingRow[] = [];

    for (const acc of map.values()) {
      const actualWorkers = acc.workerIds.size;
      const requiredStaff = acc.requiredStaff;
      const diff = actualWorkers - requiredStaff;

      let status: StaffingRow["status"] = "No Target";
      if (requiredStaff > 0) {
        if (actualWorkers < requiredStaff) status = "Under";
        else if (actualWorkers === requiredStaff) status = "Balanced";
        else status = "Over";
      }

      rows.push({
        building: acc.building,
        shift: acc.shift,
        requiredStaff,
        actualWorkers,
        diff,
        status,
        containers: acc.containers,
        pieces: acc.pieces,
      });
    }

    // Sort by building then shift
    rows.sort((a, b) => {
      if (a.building === b.building) {
        return a.shift.localeCompare(b.shift);
      }
      return a.building.localeCompare(b.building);
    });

    return rows;
  }, [containers, shifts, date, buildingFilter, shiftFilter]);

  const totals = useMemo(() => {
    const totalContainers = staffingRows.reduce(
      (sum, r) => sum + r.containers,
      0
    );
    const totalPieces = staffingRows.reduce(
      (sum, r) => sum + r.pieces,
      0
    );
    const requiredTotal = staffingRows.reduce(
      (sum, r) => sum + r.requiredStaff,
      0
    );
    const actualTotal = staffingRows.reduce(
      (sum, r) => sum + r.actualWorkers,
      0
    );
    return {
      totalContainers,
      totalPieces,
      requiredTotal,
      actualTotal,
    };
  }, [staffingRows]);

  function statusBadge(row: StaffingRow) {
    const base =
      "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium";

    if (row.status === "Under") {
      return (
        <span className={`${base} bg-rose-900/40 text-rose-200 border border-rose-700`}>
          Understaffed ({row.diff})
        </span>
      );
    }
    if (row.status === "Balanced") {
      return (
        <span
          className={`${base} bg-emerald-900/40 text-emerald-200 border border-emerald-700`}
        >
          Balanced
        </span>
      );
    }
    if (row.status === "Over") {
      return (
        <span
          className={`${base} bg-sky-900/40 text-sky-200 border border-sky-700`}
        >
          Overstaffed (+{row.diff})
        </span>
      );
    }
    return (
      <span
        className={`${base} bg-slate-900/60 text-slate-300 border border-slate-700`}
      >
        No target
      </span>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">
            Staffing Coverage
          </h1>
          <p className="text-sm text-slate-400">
            Required vs actual staffing per building and shift based on
            live containers and lumper assignments.
          </p>
        </div>
        <Link
          href="/"
          className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
        >
          ← Back to Dashboard
        </Link>
      </div>

      {/* Filters + summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Filters */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-slate-200 text-sm font-semibold">
              Filters
            </span>
            <button
              type="button"
              onClick={() => {
                setDate(todayStr);
                setBuildingFilter("ALL");
                setShiftFilter("ALL");
              }}
              className="text-[11px] text-sky-300 hover:underline"
            >
              Reset
            </button>
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">
              Date
            </label>
            <input
              type="date"
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-[11px] text-slate-50"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">
              Building
            </label>
            <select
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
              value={buildingFilter}
              onChange={(e) => setBuildingFilter(e.target.value)}
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
              Shift
            </label>
            <select
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
              value={shiftFilter}
              onChange={(e) => setShiftFilter(e.target.value)}
            >
              <option value="ALL">All Shifts</option>
              {SHIFTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Summary cards */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between text-xs">
          <div>
            <div className="text-slate-400 mb-1">
              Total Required vs Actual
            </div>
            <div className="text-2xl font-semibold text-slate-50">
              {totals.actualTotal}{" "}
              <span className="text-sm text-slate-400 font-normal">
                actual
              </span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Required:{" "}
              <span className="text-slate-200">
                {totals.requiredTotal}
              </span>
            </div>
          </div>
          <div className="mt-3 text-[11px] text-slate-500">
            Difference:{" "}
            <span
              className={
                totals.actualTotal > totals.requiredTotal
                  ? "text-sky-300"
                  : totals.actualTotal < totals.requiredTotal
                  ? "text-rose-300"
                  : "text-emerald-300"
              }
            >
              {totals.actualTotal - totals.requiredTotal}
            </span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2 text-xs">
          <div className="text-slate-400">Volume Snapshot</div>
          <div className="flex justify-between mt-1">
            <div>
              <div className="text-[11px] text-slate-500">
                Containers (day)
              </div>
              <div className="text-lg font-semibold text-slate-100">
                {totals.totalContainers}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">
                Pieces (day)
              </div>
              <div className="text-lg font-semibold text-slate-100">
                {totals.totalPieces}
              </div>
            </div>
          </div>
          <div className="text-[11px] text-slate-500 mt-2">
            Containers and pieces are calculated from containers on the
            selected date and filters.
          </div>
        </div>
      </div>

      {/* Staffing table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-slate-200 text-sm font-semibold">
              Staffing Coverage by Shift
            </div>
            <div className="text-[11px] text-slate-500">
              Each row shows required vs actual headcount plus containers
              and pieces for the day.
            </div>
          </div>
        </div>

        {staffingRows.length === 0 ? (
          <p className="text-sm text-slate-500">
            No staffing data for the current filters. Make sure shifts
            are configured and containers with lumpers exist for this
            date.
          </p>
        ) : (
          <div className="overflow-auto max-h-[520px]">
            <table className="min-w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60">
                  <th className="px-3 py-2 text-[11px] text-slate-400">
                    Building
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400">
                    Shift
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    Required
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    Actual
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    Diff
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400">
                    Status
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    Containers
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    Pieces
                  </th>
                </tr>
              </thead>
              <tbody>
                {staffingRows.map((r) => (
                  <tr
                    key={`${r.building}-${r.shift}`}
                    className="border-b border-slate-800/60 hover:bg-slate-900/60"
                  >
                    <td className="px-3 py-2 text-slate-100">
                      {r.building}
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {r.shift}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-200">
                      {r.requiredStaff}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-200">
                      {r.actualWorkers}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-200">
                      {r.diff}
                    </td>
                    <td className="px-3 py-2">{statusBadge(r)}</td>
                    <td className="px-3 py-2 text-right text-slate-200">
                      {r.containers}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-200">
                      {r.pieces}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

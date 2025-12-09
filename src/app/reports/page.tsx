"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const CONTAINERS_KEY = "precisionpulse_containers";
const WORKFORCE_KEY = "precisionpulse_workforce";
const DAMAGE_KEY = "precisionpulse_damage_reports";

const BUILDINGS = ["DC1", "DC5", "DC11", "DC14", "DC18"];

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

type WorkforcePerson = {
  id: string;
  name: string;
  role?: string;
  building?: string;
  status?: string;
};

type DamageReport = {
  id: string;
  building?: string;
  piecesTotal?: number;
  piecesDamaged?: number;
  createdAt?: string;
  status?: string;
};

// Normalize any old container records in localStorage
function normalizeContainer(raw: any): ContainerRecord {
  const pieces = Number(raw?.piecesTotal ?? 0) || 0;
  const skus = Number(raw?.skusTotal ?? 0) || 0;
  const pay =
    typeof raw?.containerPayTotal === "number"
      ? raw.containerPayTotal
      : calculateContainerPay(pieces);

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
    containerPayTotal: pay,
    createdAt: raw?.createdAt ?? new Date().toISOString(),
    workers,
  };
}

// Same pay scale used on Containers page
function calculateContainerPay(pieces: number): number {
  if (pieces <= 0) return 0;
  if (pieces <= 500) return 100;
  if (pieces <= 1500) return 130;
  if (pieces <= 3500) return 180;
  if (pieces <= 5500) return 230;
  if (pieces <= 7500) return 280;
  return 280 + 0.05 * (pieces - 7500);
}

type WorkerPayRow = {
  workerId: string;
  workerName: string;
  role?: string;
  building: string;
  totalContainers: number;
  totalMinutes: number;
  totalPayout: number;
};

type ShiftPerformanceRow = {
  building: string;
  shift: string;
  totalContainers: number;
  totalPieces: number;
  totalMinutes: number;
  totalPayout: number;
  pph: number;
};

type LeaderRow = {
  leaderId: string;
  leaderName: string;
  role?: string;
  building: string;
  totalContainers: number;
  totalPieces: number;
  totalMinutes: number;
  totalPayout: number;
  pph: number;
  damageReports: number;
  damagePieces: number;
  damagedUnits: number;
  damageRate: number;
};

// Normalize workforce from localStorage
function normalizeWorkforce(raw: any): WorkforcePerson[] {
  const arr: any[] = Array.isArray(raw) ? raw : [];
  return arr.map((w) => ({
    id: String(w.id ?? w.workerId ?? w.email ?? w.name ?? ""),
    name: String(
      w.fullName ?? w.name ?? w.displayName ?? w.email ?? "Unknown"
    ),
    role: w.role ?? w.position ?? "",
    building: w.building ?? w.assignedBuilding ?? "",
    status: w.status ?? "",
  }));
}

// Normalize damage reports
function normalizeDamage(raw: any): DamageReport[] {
  const arr: any[] = Array.isArray(raw) ? raw : [];
  return arr.map((r) => ({
    id: String(r.id ?? Date.now()),
    building: r.building ?? r.buildingCode ?? "",
    piecesTotal: Number(r.piecesTotal ?? r.totalPieces ?? 0) || 0,
    piecesDamaged:
      Number(r.piecesDamaged ?? r.damagedPieces ?? 0) || 0,
    createdAt: r.createdAt ?? r.date ?? "",
    status: r.status ?? "",
  }));
}

// --- CSV for Production Pay ---
function exportProductionCsv(
  rows: WorkerPayRow[],
  buildingFilter: string,
  dateFrom: string,
  dateTo: string
) {
  if (rows.length === 0) {
    if (typeof window !== "undefined") {
      window.alert("No data to export for the current filters.");
    }
    return;
  }

  const header = [
    "Worker ID",
    "Worker Name",
    "Role",
    "Building",
    "Total Containers",
    "Total Minutes",
    "Total Payout",
    "Average $ Per Container",
    "Filter Building",
    "Filter Date From",
    "Filter Date To",
  ];

  const lines = [header];

  for (const r of rows) {
    const avg =
      r.totalContainers === 0 ? 0 : r.totalPayout / r.totalContainers;

    const line = [
      r.workerId,
      r.workerName,
      r.role ?? "",
      r.building,
      String(r.totalContainers),
      String(r.totalMinutes),
      r.totalPayout.toFixed(2),
      avg.toFixed(2),
      buildingFilter === "ALL" ? "All" : buildingFilter,
      dateFrom || "",
      dateTo || "",
    ];

    lines.push(line);
  }

  downloadCsv(lines, "production_pay");
}

// --- CSV for Shift Performance ---
function exportShiftCsv(
  rows: ShiftPerformanceRow[],
  buildingFilter: string,
  dateFrom: string,
  dateTo: string
) {
  if (rows.length === 0) {
    if (typeof window !== "undefined") {
      window.alert("No shift performance data to export for the current filters.");
    }
    return;
  }

  const header = [
    "Building",
    "Shift",
    "Total Containers",
    "Total Pieces",
    "Total Minutes (Lumper)",
    "Total Payout",
    "PPH (Pieces per Hour)",
    "Filter Building",
    "Filter Date From",
    "Filter Date To",
  ];

  const lines = [header];

  for (const r of rows) {
    const line = [
      r.building,
      r.shift,
      String(r.totalContainers),
      String(r.totalPieces),
      String(r.totalMinutes),
      r.totalPayout.toFixed(2),
      r.pph.toFixed(2),
      buildingFilter === "ALL" ? "All" : buildingFilter,
      dateFrom || "",
      dateTo || "",
    ];
    lines.push(line);
  }

  downloadCsv(lines, "shift_performance");
}

// --- Shared CSV downloader ---
function downloadCsv(lines: string[][], prefix: string) {
  const csv = lines
    .map((line) =>
      line
        .map((value) => {
          const v = value.replace(/"/g, '""');
          return `"${v}"`;
        })
        .join(",")
    )
    .join("\n");

  if (typeof window === "undefined") return;

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `precision_pulse_${prefix}_${ts}.csv`;

  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [containers, setContainers] = useState<ContainerRecord[]>([]);
  const [workforce, setWorkforce] = useState<WorkforcePerson[]>([]);
  const [damageReports, setDamageReports] = useState<DamageReport[]>([]);

  const [buildingFilter, setBuildingFilter] = useState<string>("ALL");
  const [workerSearch, setWorkerSearch] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;

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
      console.error("Failed to load containers for reports", e);
    }

    try {
      const raw = window.localStorage.getItem(WORKFORCE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setWorkforce(normalizeWorkforce(parsed));
      }
    } catch (e) {
      console.error("Failed to load workforce for reports", e);
    }

    try {
      const raw = window.localStorage.getItem(DAMAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setDamageReports(normalizeDamage(parsed));
      }
    } catch (e) {
      console.error("Failed to load damage reports for leader scorecard", e);
    }
  }, []);

  // --- PRODUCTION PAY ROWS (per worker) ---
  const workerPayRows = useMemo<WorkerPayRow[]>(() => {
    const rows: WorkerPayRow[] = [];

    for (const c of containers) {
      if (!c.workers || c.workers.length === 0) continue;

      const date = (c.createdAt || "").slice(0, 10);
      if (dateFrom && date < dateFrom) continue;
      if (dateTo && date > dateTo) continue;

      if (buildingFilter !== "ALL" && c.building !== buildingFilter) {
        continue;
      }

      for (const w of c.workers) {
        if (!w.workerId && !w.workerName) continue;

        rows.push({
          workerId: w.workerId || w.workerName,
          workerName: w.workerName || "Unknown",
          role: w.role,
          building: c.building,
          totalContainers: 1,
          totalMinutes: w.minutesWorked || 0,
          totalPayout: w.payout || 0,
        });
      }
    }

    if (rows.length === 0) return [];

    // Group by workerId + building
    const map = new Map<string, WorkerPayRow>();

    for (const r of rows) {
      const key = `${r.workerId}::${r.building}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { ...r });
      } else {
        existing.totalContainers += 1;
        existing.totalMinutes += r.totalMinutes;
        existing.totalPayout += r.totalPayout;
      }
    }

    let grouped = Array.from(map.values());

    if (workerSearch.trim()) {
      const q = workerSearch.trim().toLowerCase();
      grouped = grouped.filter(
        (r) =>
          r.workerName.toLowerCase().includes(q) ||
          (r.role ?? "").toLowerCase().includes(q)
      );
    }

    grouped.sort((a, b) => b.totalPayout - a.totalPayout);
    return grouped;
  }, [containers, buildingFilter, workerSearch, dateFrom, dateTo]);

  const totalPayoutAll = workerPayRows.reduce(
    (sum, r) => sum + r.totalPayout,
    0
  );
  const totalMinutesAll = workerPayRows.reduce(
    (sum, r) => sum + r.totalMinutes,
    0
  );
  const totalContainersAll = workerPayRows.reduce(
    (sum, r) => sum + r.totalContainers,
    0
  );

  // --- SHIFT PERFORMANCE ROWS (per building + shift) ---
  const shiftRows = useMemo<ShiftPerformanceRow[]>(() => {
    if (!containers || containers.length === 0) return [];

    type Acc = {
      building: string;
      shift: string;
      totalContainers: number;
      totalPieces: number;
      totalMinutes: number;
      totalPayout: number;
    };

    const map = new Map<string, Acc>();

    for (const c of containers) {
      const date = (c.createdAt || "").slice(0, 10);
      if (dateFrom && date < dateFrom) continue;
      if (dateTo && date > dateTo) continue;

      if (buildingFilter !== "ALL" && c.building !== buildingFilter) {
        continue;
      }

      const key = `${c.building}::${c.shift}`;
      const existing = map.get(key) || {
        building: c.building,
        shift: c.shift,
        totalContainers: 0,
        totalPieces: 0,
        totalMinutes: 0,
        totalPayout: 0,
      };

      existing.totalContainers += 1;
      existing.totalPieces += c.piecesTotal || 0;
      existing.totalPayout += c.containerPayTotal || 0;

      const minutesForContainer = (c.workers || []).reduce(
        (sum, w) => sum + (w.minutesWorked || 0),
        0
      );
      existing.totalMinutes += minutesForContainer;

      map.set(key, existing);
    }

    const rows: ShiftPerformanceRow[] = Array.from(map.values()).map(
      (r) => {
        const pph =
          r.totalMinutes === 0
            ? 0
            : (r.totalPieces * 60) / r.totalMinutes; // pieces per hour

        return {
          building: r.building,
          shift: r.shift,
          totalContainers: r.totalContainers,
          totalPieces: r.totalPieces,
          totalMinutes: r.totalMinutes,
          totalPayout: r.totalPayout,
          pph,
        };
      }
    );

    rows.sort((a, b) => {
      if (a.building === b.building) {
        return a.shift.localeCompare(b.shift);
      }
      return a.building.localeCompare(b.building);
    });

    return rows;
  }, [containers, buildingFilter, dateFrom, dateTo]);

  // --- LEADER SCORECARD (per lead/supervisor/manager) ---
  const leaderRows = useMemo<LeaderRow[]>(() => {
    if (!containers || containers.length === 0) return [];

    // Identify leaders from workforce by role
    const leaderById = new Map<string, WorkforcePerson>();
    for (const w of workforce) {
      const role = (w.role ?? "").toLowerCase();
      if (
        role.includes("lead") ||
        role.includes("supervisor") ||
        role.includes("manager")
      ) {
        leaderById.set(w.id, w);
      }
    }

    if (leaderById.size === 0) return [];

    // Damage by building (for same filters)
    type DamageAcc = {
      damageReports: number;
      damagePieces: number;
      damagedUnits: number;
    };
    const damageByBuilding = new Map<string, DamageAcc>();

    for (const d of damageReports) {
      const building = d.building || "";
      if (!building) continue;

      if (buildingFilter !== "ALL" && building !== buildingFilter) {
        continue;
      }

      const date = (d.createdAt || "").slice(0, 10);
      if (dateFrom && date < dateFrom) continue;
      if (dateTo && date > dateTo) continue;

      const acc = damageByBuilding.get(building) || {
        damageReports: 0,
        damagePieces: 0,
        damagedUnits: 0,
      };
      acc.damageReports += 1;
      acc.damagePieces += d.piecesTotal || 0;
      acc.damagedUnits += d.piecesDamaged || 0;
      damageByBuilding.set(building, acc);
    }

    type Acc = {
      leaderId: string;
      leaderName: string;
      role?: string;
      building: string;
      totalContainers: number;
      totalPieces: number;
      totalMinutes: number;
      totalPayout: number;
    };

    const map = new Map<string, Acc>();

    for (const c of containers) {
      const date = (c.createdAt || "").slice(0, 10);
      if (dateFrom && date < dateFrom) continue;
      if (dateTo && date > dateTo) continue;

      if (buildingFilter !== "ALL" && c.building !== buildingFilter) {
        continue;
      }

      for (const w of c.workers || []) {
        const leader = leaderById.get(w.workerId);
        if (!leader) continue;

        const key = `${leader.id}::${c.building}`;
        const existing = map.get(key) || {
          leaderId: leader.id,
          leaderName: leader.name,
          role: leader.role,
          building: c.building,
          totalContainers: 0,
          totalPieces: 0,
          totalMinutes: 0,
          totalPayout: 0,
        };

        existing.totalContainers += 1;
        existing.totalPieces += c.piecesTotal || 0;
        existing.totalMinutes += w.minutesWorked || 0;
        existing.totalPayout += w.payout || 0;

        map.set(key, existing);
      }
    }

    const rows: LeaderRow[] = [];

    for (const acc of map.values()) {
      const pph =
        acc.totalMinutes === 0
          ? 0
          : (acc.totalPieces * 60) / acc.totalMinutes;

      const dmg = damageByBuilding.get(acc.building) || {
        damageReports: 0,
        damagePieces: 0,
        damagedUnits: 0,
      };

      const damageRate =
        dmg.damagePieces === 0
          ? 0
          : (dmg.damagedUnits / dmg.damagePieces) * 100;

      rows.push({
        leaderId: acc.leaderId,
        leaderName: acc.leaderName,
        role: acc.role,
        building: acc.building,
        totalContainers: acc.totalContainers,
        totalPieces: acc.totalPieces,
        totalMinutes: acc.totalMinutes,
        totalPayout: acc.totalPayout,
        pph,
        damageReports: dmg.damageReports,
        damagePieces: dmg.damagePieces,
        damagedUnits: dmg.damagedUnits,
        damageRate,
      });
    }

    // Sort: highest containers / volume first
    rows.sort((a, b) => b.totalPieces - a.totalPieces);

    return rows;
  }, [containers, workforce, damageReports, buildingFilter, dateFrom, dateTo]);

  const totalLeaderContainers = leaderRows.reduce(
    (sum, r) => sum + r.totalContainers,
    0
  );
  const totalLeaderPieces = leaderRows.reduce(
    (sum, r) => sum + r.totalPieces,
    0
  );
  const totalLeaderPayout = leaderRows.reduce(
    (sum, r) => sum + r.totalPayout,
    0
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">
            Reports & Analytics
          </h1>
          <p className="text-sm text-slate-400">
            Production pay rollups, shift performance, and leader
            scorecards driven by live container and lumper data.
          </p>
        </div>
        <Link
          href="/"
          className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
        >
          ← Back to Dashboard
        </Link>
      </div>

      {/* Filters & summary row (shared) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Filters */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-200 text-sm font-semibold">
              Filters
            </span>
            <button
              type="button"
              onClick={() => {
                setBuildingFilter("ALL");
                setWorkerSearch("");
                setDateFrom("");
                setDateTo("");
              }}
              className="text-[11px] text-sky-300 hover:underline"
            >
              Reset
            </button>
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
              Worker search (Production Pay)
            </label>
            <input
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
              placeholder="Search by name or role"
              value={workerSearch}
              onChange={(e) => setWorkerSearch(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Date from
              </label>
              <input
                type="date"
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-[11px] text-slate-50"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Date to
              </label>
              <input
                type="date"
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-[11px] text-slate-50"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Summary cards – Production Pay */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
          <div className="text-xs text-slate-400 mb-1">
            Total Payout (Production Pay)
          </div>
          <div className="text-2xl font-semibold text-emerald-300">
            ${totalPayoutAll.toFixed(2)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Across {workerPayRows.length} worker(s)
          </div>
          <button
            type="button"
            onClick={() =>
              exportProductionCsv(
                workerPayRows,
                buildingFilter,
                dateFrom,
                dateTo
              )
            }
            className="mt-3 text-[11px] px-3 py-1 rounded-full border border-sky-600 bg-sky-600/10 text-sky-200 hover:bg-sky-600/30 self-start"
          >
            ⬇️ Download Production Pay CSV
          </button>
        </div>

        {/* Summary cards – Shift Performance */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-slate-300">Shift Performance</div>
              <div className="text-[11px] text-slate-500">
                Based on containers + lumper minutes
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                exportShiftCsv(shiftRows, buildingFilter, dateFrom, dateTo)
              }
              className="text-[11px] px-3 py-1 rounded-full border border-sky-600 bg-sky-600/10 text-sky-200 hover:bg-sky-600/30"
            >
              ⬇️ Download Shift CSV
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-2">
            <div>
              <div className="text-slate-400">Shift Groups</div>
              <div className="text-slate-100 text-lg font-semibold">
                {shiftRows.length}
              </div>
            </div>
            <div>
              <div className="text-slate-400">Total Containers</div>
              <div className="text-slate-100 text-lg font-semibold">
                {shiftRows.reduce(
                  (sum, r) => sum + r.totalContainers,
                  0
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* PRODUCTION PAY TABLE */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-slate-200 text-sm font-semibold">
              Production Pay – Worker Payout Detail
            </div>
            <div className="text-[11px] text-slate-500">
              Container-based payouts grouped by worker.
            </div>
          </div>
        </div>

        {workerPayRows.length === 0 ? (
          <p className="text-sm text-slate-500">
            No production pay records match the current filters. Make sure
            containers have lumpers with saved payouts.
          </p>
        ) : (
          <div className="overflow-auto max-h-[360px]">
            <table className="min-w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60">
                  <th className="px-3 py-2 text-[11px] text-slate-400">
                    Worker
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400">
                    Role
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400">
                    Building
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    Containers
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    Minutes
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    Total Payout
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    Avg $ / Container
                  </th>
                </tr>
              </thead>
              <tbody>
                {workerPayRows.map((r) => {
                  const avg =
                    r.totalContainers === 0
                      ? 0
                      : r.totalPayout / r.totalContainers;
                  return (
                    <tr
                      key={`${r.workerId}-${r.building}`}
                      className="border-b border-slate-800/60 hover:bg-slate-900/60"
                    >
                      <td className="px-3 py-2 text-slate-100">
                        {r.workerName}
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {r.role || "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {r.building}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-200">
                        {r.totalContainers}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-200">
                        {r.totalMinutes}
                      </td>
                      <td className="px-3 py-2 text-right text-emerald-300">
                        ${r.totalPayout.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-200">
                        ${avg.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SHIFT PERFORMANCE TABLE */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-slate-200 text-sm font-semibold">
              Shift Performance – PPH & Payout by Shift
            </div>
            <div className="text-[11px] text-slate-500">
              Aggregated by building + shift using container pieces and
              lumper minutes.
            </div>
          </div>
        </div>

        {shiftRows.length === 0 ? (
          <p className="text-sm text-slate-500">
            No shift performance data for the current filters. Make sure
            containers and lumpers are recorded for this period.
          </p>
        ) : (
          <div className="overflow-auto max-h-[360px]">
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
                    Containers
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    Pieces
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    Minutes (Lumper)
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    Total Payout
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    PPH
                  </th>
                </tr>
              </thead>
              <tbody>
                {shiftRows.map((r) => (
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
                      {r.totalContainers}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-200">
                      {r.totalPieces}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-200">
                      {r.totalMinutes}
                    </td>
                    <td className="px-3 py-2 text-right text-emerald-300">
                      ${r.totalPayout.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right text-sky-300">
                      {r.pph.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* LEADER SCORECARD */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-slate-200 text-sm font-semibold">
              Leader Scorecard – Supervisors & Leads
            </div>
            <div className="text-[11px] text-slate-500">
              Leaders are detected from Workforce roles (Lead, Supervisor,
              Manager) and linked to containers they touch plus building
              damage.
            </div>
          </div>
          <div className="text-right text-[11px] text-slate-500">
            Total leader containers:{" "}
            <span className="text-slate-200">
              {totalLeaderContainers}
            </span>
            <br />
            Total leader pieces:{" "}
            <span className="text-slate-200">
              {totalLeaderPieces}
            </span>
            <br />
            Leader payout:{" "}
            <span className="text-emerald-300">
              ${totalLeaderPayout.toFixed(2)}
            </span>
          </div>
        </div>

        {leaderRows.length === 0 ? (
          <p className="text-sm text-slate-500">
            No leaders detected for the current filters. Make sure
            Workforce roles include terms like &quot;Lead&quot;,
            &quot;Supervisor&quot;, or &quot;Manager&quot; and that they
            are assigned to containers (even with 0% share if needed).
          </p>
        ) : (
          <div className="overflow-auto max-h-[360px]">
            <table className="min-w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60">
                  <th className="px-3 py-2 text-[11px] text-slate-400">
                    Leader
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400">
                    Role
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400">
                    Building
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    Containers
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    Pieces
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    Minutes
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    Payout
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    PPH
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    Damage Reports
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    Damage %
                  </th>
                </tr>
              </thead>
              <tbody>
                {leaderRows.map((r) => (
                  <tr
                    key={`${r.leaderId}-${r.building}`}
                    className="border-b border-slate-800/60 hover:bg-slate-900/60"
                  >
                    <td className="px-3 py-2 text-slate-100">
                      {r.leaderName}
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {r.role || "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {r.building}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-200">
                      {r.totalContainers}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-200">
                      {r.totalPieces}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-200">
                      {r.totalMinutes}
                    </td>
                    <td className="px-3 py-2 text-right text-emerald-300">
                      ${r.totalPayout.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right text-sky-300">
                      {r.pph.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-200">
                      {r.damageReports}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={
                          r.damageRate > 2
                            ? "text-rose-300"
                            : r.damageRate > 0
                            ? "text-amber-300"
                            : "text-emerald-300"
                        }
                      >
                        {r.damageRate.toFixed(1)}%
                      </span>
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

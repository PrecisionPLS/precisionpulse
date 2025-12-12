"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { BUILDINGS } from "@/lib/buildings";

const BUILDING_OPTIONS = ["ALL", ...BUILDINGS];
const SHIFT_OPTIONS = ["ALL", "1st", "2nd", "3rd", "4th"] as const;

const WORK_ORDERS_KEY = "precisionpulse_work_orders";
const CONTAINERS_KEY = "precisionpulse_containers";

const DATE_RANGES = ["Today", "Last 7 days", "Last 30 days", "All time", "Custom"] as const;
type DateRange = (typeof DATE_RANGES)[number];

type ContainerWorker = {
  workerId?: string | null;
  workerName?: string | null;
  minutesWorked?: number | null;
  percentContribution?: number | null;
  payoutAmount?: number | null;
  [key: string]: any;
};

type ContainerRow = {
  id: string;
  workOrderId?: string | null;
  building?: string | null;
  shift?: string | null;
  date?: string | null;
  container_no?: string | null;
  pieces_total?: number | null;
  skus_total?: number | null;
  container_pay_total?: number | null;
  workers?: ContainerWorker[] | null;
  [key: string]: any;
};

type WorkOrderRecord = {
  id: string;
  name: string;
  building?: string;
  shift?: string;
  status?: string;
  createdAt?: string;
  notes?: string;
  [key: string]: any;
};

type StaffingRow = {
  id: string;
  building?: string | null;
  shift?: string | null;
  date?: string | null;
  required_headcount?: number | null;
  actual_headcount?: number | null;
};

type ProductionPayRow = {
  date: string;
  building: string;
  shift: string;
  workOrderId?: string;
  workOrderName?: string;
  containerNo: string;
  workerName: string;
  minutesWorked: number;
  percentContribution: number;
  payoutAmount: number;
  containerPayTotal: number;
  piecesTotal: number;
  skusTotal: number;
};

type ShiftPerfRow = {
  date: string;
  building: string;
  shift: string;
  containers: number;
  piecesTotal: number;
  minutesTotal: number;
  pph: number;
};

type StaffingViewRow = {
  date: string;
  building: string;
  shift: string;
  required: number;
  actual: number;
  delta: number;
  status: "Understaffed" | "Balanced" | "Overstaffed";
};

type LeaderboardRow = {
  workerName: string;
  building: string | "Multiple";
  totalPayout: number;
  totalPieces: number;
  totalContainers: number;
  totalMinutes: number;
  avgPPH: number;
};

function parseDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

function isWithinPreset(dateStr: string | null, range: DateRange): boolean {
  if (!dateStr) return range === "All time";
  if (range === "All time") return true;
  if (range === "Custom") return true; // handled by custom range check

  const only = dateStr.slice(0, 10);
  const d = new Date(only);
  if (Number.isNaN(d.getTime())) return false;

  const today = new Date();
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffMs = todayOnly.getTime() - d.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (range === "Today") return only === today.toISOString().slice(0, 10);
  if (range === "Last 7 days") return diffDays >= 0 && diffDays <= 7;
  if (range === "Last 30 days") return diffDays >= 0 && diffDays <= 30;

  return true;
}

function isWithinCustom(dateStr: string | null, start: string | null, end: string | null): boolean {
  if (!dateStr) return false;
  const only = dateStr.slice(0, 10);

  // if user didn't set one side, treat it as open-ended
  if (!start && !end) return true;

  if (start && only < start) return false;
  if (end && only > end) return false;
  return true;
}

/**
 * Helper readers that try multiple key names.
 */
function getContainerDate(c: ContainerRow): string | null {
  return (
    parseDateOnly(
      (c.date as string | undefined) ??
        (c.work_date as string | undefined) ??
        (c.workDate as string | undefined) ??
        (c.created_at as string | undefined) ??
        null
    ) ?? null
  );
}

function getContainerBuilding(c: ContainerRow): string {
  return (
    (c.building as string | undefined) ??
    (c.bldg as string | undefined) ??
    (c.location as string | undefined) ??
    ""
  );
}

function getContainerShift(c: ContainerRow): string {
  return (
    (c.shift as string | undefined) ??
    (c.shift_name as string | undefined) ??
    (c.shiftName as string | undefined) ??
    ""
  );
}

function getContainerNo(c: ContainerRow): string {
  return (
    (c.container_no as string | undefined) ??
    (c.containerNo as string | undefined) ??
    (c.container_number as string | undefined) ??
    (c.container_num as string | undefined) ??
    (c.containerId as string | undefined) ??
    (c.container_id as string | undefined) ??
    String(c.id ?? "")
  );
}

function getPiecesTotal(c: ContainerRow): number {
  const possible =
    (c.pieces_total as number | undefined) ??
    (c.pieces as number | undefined) ??
    (c.total_pieces as number | undefined) ??
    (c.pieceCount as number | undefined) ??
    (c.piecesTotal as number | undefined) ??
    (c.totalPieces as number | undefined) ??
    (c.totalPieceCount as number | undefined) ??
    (c.piece_count as number | undefined) ??
    (c.total_piece_count as number | undefined);

  return typeof possible === "number" && !Number.isNaN(possible) ? possible : 0;
}

function getSkusTotal(c: ContainerRow): number {
  return (
    (c.skus_total as number | undefined) ??
    (c.skuCount as number | undefined) ??
    (c.total_skus as number | undefined) ??
    0
  );
}

function getContainerPayTotal(c: ContainerRow): number {
  return (
    (c.container_pay_total as number | undefined) ??
    (c.containerPayTotal as number | undefined) ??
    (c.containerPay as number | undefined) ??
    (c.totalPay as number | undefined) ??
    (c.pay_total as number | undefined) ??
    0
  );
}

function getWorkerName(w: ContainerWorker): string {
  return (
    (w.workerName as string | undefined) ??
    (w.name as string | undefined) ??
    (w.fullName as string | undefined) ??
    (w.worker_name as string | undefined) ??
    "Unknown Worker"
  );
}

function getWorkerMinutes(w: ContainerWorker): number {
  return (
    (w.minutesWorked as number | undefined) ??
    (w.minutes as number | undefined) ??
    (w.mins as number | undefined) ??
    (w.timeMinutes as number | undefined) ??
    0
  );
}

function getWorkerPercent(w: ContainerWorker): number {
  return (
    (w.percentContribution as number | undefined) ??
    (w.percent as number | undefined) ??
    (w.share as number | undefined) ??
    (w.sharePercent as number | undefined) ??
    0
  );
}

function getWorkerPayout(w: ContainerWorker): number {
  return (
    (w.payoutAmount as number | undefined) ??
    (w.payout as number | undefined) ??
    (w.pay as number | undefined) ??
    (w.payAmount as number | undefined) ??
    (w.amount as number | undefined) ??
    0
  );
}

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

export default function ReportsPage() {
  const currentUser = useCurrentUser();

  const isLead = currentUser?.accessRole === "Lead";
  const leadBuilding = currentUser?.building || "";

  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderRecord[]>([]);
  const [staffing, setStaffing] = useState<StaffingRow[]>([]);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [buildingFilter, setBuildingFilter] = useState<string>("ALL");
  const [shiftFilter, setShiftFilter] = useState<(typeof SHIFT_OPTIONS)[number]>("ALL");

  // presets + custom range
  const [dateRange, setDateRange] = useState<DateRange>("Last 7 days");
  const [customStart, setCustomStart] = useState<string>(""); // YYYY-MM-DD
  const [customEnd, setCustomEnd] = useState<string>(""); // YYYY-MM-DD
  const [showAdvanced, setShowAdvanced] = useState<boolean>(true);

  // Load containers + work orders from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const contRaw = window.localStorage.getItem(CONTAINERS_KEY);
      if (contRaw) {
        const parsed = JSON.parse(contRaw);
        if (Array.isArray(parsed)) setContainers(parsed as ContainerRow[]);
      }

      const woRaw = window.localStorage.getItem(WORK_ORDERS_KEY);
      if (woRaw) {
        const parsed = JSON.parse(woRaw);
        if (Array.isArray(parsed)) setWorkOrders(parsed as WorkOrderRecord[]);
      }
    } catch (e) {
      console.error("Error loading containers/work orders from localStorage", e);
    }
  }, []);

  // Fetch staffing data from Supabase
  useEffect(() => {
    if (!currentUser) return;

    async function loadStaffing() {
      setLoading(true);
      setError(null);
      try {
        let staffQuery = supabase.from("staffing_plans").select("*");

        if (isLead && leadBuilding) {
          staffQuery = staffQuery.eq("building", leadBuilding);
        }

        const staffRes = await staffQuery;

        if (staffRes.error) {
          console.error("Error loading staffing coverage for reports", staffRes.error);
          setError("Failed to load staffing data from Supabase.");
        } else {
          setStaffing((staffRes.data || []) as StaffingRow[]);
        }
      } catch (e) {
        console.error("Unexpected reports staffing load error", e);
        setError("Unexpected error loading reports data.");
      } finally {
        setLoading(false);
      }
    }

    loadStaffing();
  }, [currentUser, isLead, leadBuilding]);

  useEffect(() => {
    if (isLead && leadBuilding) {
      setBuildingFilter(leadBuilding);
    }
  }, [isLead, leadBuilding]);

  const effectiveBuildingFilter = isLead && leadBuilding ? leadBuilding : buildingFilter;

  function matchesBuilding(b: string | null | undefined): boolean {
    if (effectiveBuildingFilter === "ALL") return true;
    return (b || "") === effectiveBuildingFilter;
  }

  function matchesShift(s: string | null | undefined): boolean {
    if (shiftFilter === "ALL") return true;
    return (s || "") === shiftFilter;
  }

  const isDateMatch = (dateStr: string | null) => {
    if (!isWithinPreset(dateStr, dateRange)) return false;

    if (dateRange === "Custom") {
      const start = customStart.trim() ? customStart.trim() : null;
      const end = customEnd.trim() ? customEnd.trim() : null;
      return isWithinCustom(dateStr, start, end);
    }

    return true;
  };

  // Filtered containers and staffing
  const filteredContainers = useMemo(() => {
    return containers.filter((c) => {
      if (!matchesBuilding(getContainerBuilding(c))) return false;
      if (!matchesShift(getContainerShift(c))) return false;
      const d = getContainerDate(c);
      return isDateMatch(d);
    });
  }, [containers, effectiveBuildingFilter, shiftFilter, dateRange, customStart, customEnd]);

  const filteredStaffing = useMemo(() => {
    return staffing.filter((s) => {
      if (!matchesBuilding(s.building ?? null)) return false;
      if (!matchesShift(s.shift ?? null)) return false;
      const d = parseDateOnly(s.date ?? null);
      return isDateMatch(d);
    });
  }, [staffing, effectiveBuildingFilter, shiftFilter, dateRange, customStart, customEnd]);

  // Map work orders by id
  const workOrderMap = useMemo(() => {
    const map = new Map<string, WorkOrderRecord>();
    for (const wo of workOrders) map.set(String(wo.id), wo);
    return map;
  }, [workOrders]);

  // 1) Production Pay rows
  const productionRows: ProductionPayRow[] = useMemo(() => {
    const rows: ProductionPayRow[] = [];

    for (const c of filteredContainers) {
      const date = getContainerDate(c) || "";
      const building = getContainerBuilding(c);
      const shift = getContainerShift(c);
      const containerNo = getContainerNo(c);
      const piecesTotal = getPiecesTotal(c);
      const skusTotal = getSkusTotal(c);
      const containerPay = getContainerPayTotal(c);
      const workersArr = (c.workers || []) as ContainerWorker[];

      const workOrderId = c.workOrderId ? String(c.workOrderId) : "";
      const workOrder = workOrderId ? workOrderMap.get(workOrderId) : undefined;
      const workOrderName = workOrder?.name ?? "";

      for (const w of workersArr) {
        rows.push({
          date,
          building,
          shift,
          workOrderId,
          workOrderName,
          containerNo,
          workerName: getWorkerName(w),
          minutesWorked: getWorkerMinutes(w),
          percentContribution: getWorkerPercent(w),
          payoutAmount: getWorkerPayout(w),
          containerPayTotal: containerPay,
          piecesTotal,
          skusTotal,
        });
      }
    }

    rows.sort((a, b) => {
      if (a.date === b.date) {
        if (a.workOrderName === b.workOrderName) return a.containerNo.localeCompare(b.containerNo);
        return (a.workOrderName || "").localeCompare(b.workOrderName || "");
      }
      return a.date.localeCompare(b.date);
    });

    return rows;
  }, [filteredContainers, workOrderMap]);

  // 2) Shift Performance rows
  const shiftRows: ShiftPerfRow[] = useMemo(() => {
    const map = new Map<string, ShiftPerfRow>();

    for (const c of filteredContainers) {
      const date = getContainerDate(c) || "";
      const building = getContainerBuilding(c);
      const shift = getContainerShift(c);
      const key = `${date}|${building}|${shift}`;

      const pieces = getPiecesTotal(c);
      const workersArr = (c.workers || []) as ContainerWorker[];
      const minutes = workersArr.reduce((sum, w) => sum + getWorkerMinutes(w), 0);

      if (!map.has(key)) {
        map.set(key, { date, building, shift, containers: 0, piecesTotal: 0, minutesTotal: 0, pph: 0 });
      }

      const row = map.get(key)!;
      row.containers += 1;
      row.piecesTotal += pieces;
      row.minutesTotal += minutes;
    }

    for (const row of map.values()) {
      row.pph = row.minutesTotal === 0 ? 0 : (row.piecesTotal * 60) / row.minutesTotal;
    }

    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredContainers]);

  // 3) Staffing view
  const staffingRows: StaffingViewRow[] = useMemo(() => {
    const rows: StaffingViewRow[] = [];

    for (const s of filteredStaffing) {
      const date = parseDateOnly(s.date ?? null) || "";
      const building = s.building || "";
      const shift = s.shift || "";
      const required = s.required_headcount || 0;
      const actual = s.actual_headcount || 0;
      const delta = actual - required;

      let status: StaffingViewRow["status"];
      if (delta < 0) status = "Understaffed";
      else if (delta > 0) status = "Overstaffed";
      else status = "Balanced";

      rows.push({ date, building, shift, required, actual, delta, status });
    }

    rows.sort((a, b) => {
      if (a.date === b.date) {
        if (a.building === b.building) return a.shift.localeCompare(b.shift);
        return a.building.localeCompare(b.building);
      }
      return a.date.localeCompare(b.date);
    });

    return rows;
  }, [filteredStaffing]);

  // 4) Worker Leaderboard
  const leaderboardRows: LeaderboardRow[] = useMemo(() => {
    const map = new Map<
      string,
      {
        workerName: string;
        buildings: Set<string>;
        totalPayout: number;
        totalPieces: number;
        totalContainers: number;
        totalMinutes: number;
      }
    >();

    for (const c of filteredContainers) {
      const building = getContainerBuilding(c);
      const pieces = getPiecesTotal(c);
      const workersArr = (c.workers || []) as ContainerWorker[];

      const uniqueContainerWorkers = new Set<string>();

      for (const w of workersArr) {
        const workerName = getWorkerName(w).trim();
        if (!workerName) continue;

        const key = workerName.toLowerCase();

        if (!map.has(key)) {
          map.set(key, {
            workerName,
            buildings: new Set<string>(),
            totalPayout: 0,
            totalPieces: 0,
            totalContainers: 0,
            totalMinutes: 0,
          });
        }

        const entry = map.get(key)!;
        if (building) entry.buildings.add(building);

        entry.totalPayout += getWorkerPayout(w);
        entry.totalMinutes += getWorkerMinutes(w);

        if (!uniqueContainerWorkers.has(key)) {
          entry.totalContainers += 1;
          entry.totalPieces += pieces;
          uniqueContainerWorkers.add(key);
        }
      }
    }

    const rows: LeaderboardRow[] = [];
    for (const entry of map.values()) {
      const buildingsArr = Array.from(entry.buildings);
      const buildingLabel =
        buildingsArr.length === 0 ? "Unknown" : buildingsArr.length === 1 ? buildingsArr[0] : "Multiple";

      const avgPPH = entry.totalMinutes === 0 ? 0 : (entry.totalPieces * 60) / entry.totalMinutes;

      rows.push({
        workerName: entry.workerName,
        building: buildingLabel,
        totalPayout: Number(entry.totalPayout.toFixed(2)),
        totalPieces: entry.totalPieces,
        totalContainers: entry.totalContainers,
        totalMinutes: entry.totalMinutes,
        avgPPH: Number(avgPPH.toFixed(1)),
      });
    }

    rows.sort((a, b) => b.totalPayout - a.totalPayout);
    return rows.slice(0, 25);
  }, [filteredContainers]);

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

  // CSV handlers (same outputs, now obey shift + custom dates too)
  function handleDownloadProductionCsv() {
    const header = [
      "Date","Building","Shift","Work Order","Container #","Worker","Minutes Worked",
      "% Contribution","Payout Amount","Container Pay Total","Pieces Total","SKUs Total",
    ];
    const rows = productionRows.map((r) => [
      r.date, r.building, r.shift, r.workOrderName || r.workOrderId || "",
      r.containerNo, r.workerName, r.minutesWorked, r.percentContribution,
      r.payoutAmount.toFixed(2), r.containerPayTotal.toFixed(2), r.piecesTotal, r.skusTotal,
    ]);
    downloadCsv(`production-pay-${makeFilterLabel()}.csv`, header, rows);
  }

  function handleDownloadShiftCsv() {
    const header = ["Date","Building","Shift","Containers","Pieces Total","Minutes Total","PPH"];
    const rows = shiftRows.map((r) => [
      r.date, r.building, r.shift, r.containers, r.piecesTotal, r.minutesTotal, r.pph.toFixed(1),
    ]);
    downloadCsv(`shift-performance-${makeFilterLabel()}.csv`, header, rows);
  }

  function handleDownloadStaffingCsv() {
    const header = ["Date","Building","Shift","Required","Actual","Delta","Status"];
    const rows = staffingRows.map((r) => [r.date, r.building, r.shift, r.required, r.actual, r.delta, r.status]);
    downloadCsv(`staffing-coverage-${makeFilterLabel()}.csv`, header, rows);
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center text-sm">
        Redirecting to login…
      </div>
    );
  }

  const buildingLabel = effectiveBuildingFilter === "ALL" ? "All Buildings" : effectiveBuildingFilter;
  const shiftLabel = shiftFilter === "ALL" ? "All Shifts" : shiftFilter;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50">
      <div className="mx-auto max-w-7xl p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">Reports & KPIs</h1>
            <p className="text-sm text-slate-400">
              Live analytics across{" "}
              <span className="font-semibold text-sky-300">{buildingLabel}</span>{" "}
              • <span className="font-semibold text-sky-300">{shiftLabel}</span>{" "}
              • <span className="text-slate-300">{dateRange === "Custom" ? "Custom range" : dateRange}</span>
            </p>
            {dateRange === "Custom" && (
              <p className="mt-1 text-[11px] text-slate-500">
                Range: {customStart || "—"} → {customEnd || "—"}
              </p>
            )}
            {loading && <p className="mt-1 text-[11px] text-slate-500">Loading Supabase staffing data…</p>}
            {error && <p className="mt-1 text-[11px] text-amber-400">{error}</p>}
          </div>

          <div className="flex flex-col items-end gap-2 text-xs">
            <Link
              href="/"
              className="mt-1 inline-flex items-center px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
            >
              ← Back to Dashboard
            </Link>
          </div>
        </div>

        {/* Advanced Filters */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Filters</h2>
            <button
              type="button"
              onClick={() => setShowAdvanced((p) => !p)}
              className="text-[11px] text-sky-300 hover:underline"
            >
              {showAdvanced ? "Hide" : "Show"}
            </button>
          </div>

          {showAdvanced && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
              <div>
                <div className="text-[11px] text-slate-400 mb-1">Building</div>
                <select
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-50"
                  value={effectiveBuildingFilter}
                  onChange={(e) => setBuildingFilter(e.target.value)}
                  disabled={isLead && !!leadBuilding}
                >
                  {isLead && leadBuilding ? (
                    <option value={leadBuilding}>{leadBuilding}</option>
                  ) : (
                    BUILDING_OPTIONS.map((b) => (
                      <option key={b} value={b}>
                        {b === "ALL" ? "All Buildings" : b}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <div className="text-[11px] text-slate-400 mb-1">Shift</div>
                <select
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-50"
                  value={shiftFilter}
                  onChange={(e) => setShiftFilter(e.target.value as any)}
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
                  onClick={() => {
                    setShiftFilter("ALL");
                    setDateRange("Last 7 days");
                    setCustomStart("");
                    setCustomEnd("");
                    setBuildingFilter(isLead && leadBuilding ? leadBuilding : "ALL");
                  }}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 px-3 py-2 text-[11px] text-slate-200"
                >
                  Reset
                </button>
              </div>

              {/* Custom date range */}
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
                    Tip: pick a week (Sun–Sat) or any range, then download CSVs.
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Top summary strip */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <SummaryCard label="Production rows" value={productionRows.length} hint="Worker x container lines" />
          <SummaryCard label="Shift groups" value={shiftRows.length} hint="Building x shift x date" />
          <SummaryCard label="Staffing entries" value={staffingRows.length} hint="Coverage per shift" />
          <SummaryCard label="Leaderboard workers" value={leaderboardRows.length} hint="Top payout / pieces" />
        </div>

        {/* Layout: 2x2 grid */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Production Pay */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs flex flex-col max-h-[480px]">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Production Pay Report</h2>
                <p className="text-[11px] text-slate-500">
                  Per worker, per container payout with pieces, SKUs, and work order number.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadProductionCsv}
                className="text-[11px] px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 text-slate-200"
              >
                Download CSV
              </button>
            </div>
            <div className="overflow-auto border border-slate-800 rounded-xl flex-1">
              {productionRows.length === 0 ? (
                <p className="p-3 text-[11px] text-slate-500">No production pay records for this filter.</p>
              ) : (
                <table className="min-w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-950/70 border-b border-slate-800">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Bldg</th>
                      <th className="px-3 py-2">Shift</th>
                      <th className="px-3 py-2">Work Order</th>
                      <th className="px-3 py-2">Container</th>
                      <th className="px-3 py-2">Worker</th>
                      <th className="px-3 py-2 text-right">Minutes</th>
                      <th className="px-3 py-2 text-right">%</th>
                      <th className="px-3 py-2 text-right">Payout</th>
                      <th className="px-3 py-2 text-right">Pay Total</th>
                      <th className="px-3 py-2 text-right">Pieces</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productionRows.map((r, idx) => (
                      <tr
                        key={`${r.date}-${r.workOrderId}-${r.containerNo}-${r.workerName}-${idx}`}
                        className="border-b border-slate-800/60 hover:bg-slate-900/60"
                      >
                        <td className="px-3 py-1.5">{r.date}</td>
                        <td className="px-3 py-1.5">{r.building}</td>
                        <td className="px-3 py-1.5">{r.shift}</td>
                        <td className="px-3 py-1.5">{r.workOrderName || r.workOrderId || "—"}</td>
                        <td className="px-3 py-1.5 font-mono text-[11px]">{r.containerNo}</td>
                        <td className="px-3 py-1.5">{r.workerName}</td>
                        <td className="px-3 py-1.5 text-right">{r.minutesWorked}</td>
                        <td className="px-3 py-1.5 text-right">{r.percentContribution.toFixed(0)}%</td>
                        <td className="px-3 py-1.5 text-right text-emerald-300">${r.payoutAmount.toFixed(2)}</td>
                        <td className="px-3 py-1.5 text-right text-slate-300">${r.containerPayTotal.toFixed(2)}</td>
                        <td className="px-3 py-1.5 text-right">{r.piecesTotal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* Shift Performance */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs flex flex-col max-h-[480px]">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Shift Performance</h2>
                <p className="text-[11px] text-slate-500">PPH by building, shift, and date from container volume.</p>
              </div>
              <button
                type="button"
                onClick={handleDownloadShiftCsv}
                className="text-[11px] px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 text-slate-200"
              >
                Download CSV
              </button>
            </div>
            <div className="overflow-auto border border-slate-800 rounded-xl flex-1">
              {shiftRows.length === 0 ? (
                <p className="p-3 text-[11px] text-slate-500">No shift performance data for this filter.</p>
              ) : (
                <table className="min-w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-950/70 border-b border-slate-800">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Bldg</th>
                      <th className="px-3 py-2">Shift</th>
                      <th className="px-3 py-2 text-right">Containers</th>
                      <th className="px-3 py-2 text-right">Pieces</th>
                      <th className="px-3 py-2 text-right">Minutes</th>
                      <th className="px-3 py-2 text-right">PPH</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shiftRows.map((r, idx) => (
                      <tr
                        key={`${r.date}-${r.building}-${r.shift}-${idx}`}
                        className="border-b border-slate-800/60 hover:bg-slate-900/60"
                      >
                        <td className="px-3 py-1.5">{r.date}</td>
                        <td className="px-3 py-1.5">{r.building}</td>
                        <td className="px-3 py-1.5">{r.shift}</td>
                        <td className="px-3 py-1.5 text-right">{r.containers}</td>
                        <td className="px-3 py-1.5 text-right">{r.piecesTotal}</td>
                        <td className="px-3 py-1.5 text-right">{r.minutesTotal}</td>
                        <td className="px-3 py-1.5 text-right text-sky-300">{r.pph.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* Staffing Coverage */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs flex flex-col max-h-[480px]">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Staffing Coverage</h2>
                <p className="text-[11px] text-slate-500">Required vs actual headcount per building/shift.</p>
              </div>
              <button
                type="button"
                onClick={handleDownloadStaffingCsv}
                className="text-[11px] px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 text-slate-200"
              >
                Download CSV
              </button>
            </div>
            <div className="overflow-auto border border-slate-800 rounded-xl flex-1">
              {staffingRows.length === 0 ? (
                <p className="p-3 text-[11px] text-slate-500">No staffing coverage records for this filter.</p>
              ) : (
                <table className="min-w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-950/70 border-b border-slate-800">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Bldg</th>
                      <th className="px-3 py-2">Shift</th>
                      <th className="px-3 py-2 text-right">Required</th>
                      <th className="px-3 py-2 text-right">Actual</th>
                      <th className="px-3 py-2 text-right">Delta</th>
                      <th className="px-3 py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffingRows.map((r, idx) => (
                      <tr
                        key={`${r.date}-${r.building}-${r.shift}-${idx}`}
                        className="border-b border-slate-800/60 hover:bg-slate-900/60"
                      >
                        <td className="px-3 py-1.5">{r.date}</td>
                        <td className="px-3 py-1.5">{r.building}</td>
                        <td className="px-3 py-1.5">{r.shift}</td>
                        <td className="px-3 py-1.5 text-right">{r.required}</td>
                        <td className="px-3 py-1.5 text-right">{r.actual}</td>
                        <td className="px-3 py-1.5 text-right">{r.delta}</td>
                        <td className="px-3 py-1.5 text-right">
                          <span
                            className={
                              "inline-flex rounded-full px-2 py-0.5 text-[10px] " +
                              (r.status === "Understaffed"
                                ? "bg-rose-900/60 text-rose-200 border border-rose-700/70"
                                : r.status === "Overstaffed"
                                ? "bg-amber-900/60 text-amber-200 border border-amber-700/70"
                                : "bg-emerald-900/60 text-emerald-200 border border-emerald-700/70")
                            }
                          >
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* Worker Leaderboard */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs flex flex-col max-h-[480px]">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Worker Leaderboard</h2>
                <p className="text-[11px] text-slate-500">Top workers by total payout, pieces, and efficiency.</p>
              </div>
            </div>
            <div className="overflow-auto border border-slate-800 rounded-xl flex-1">
              {leaderboardRows.length === 0 ? (
                <p className="p-3 text-[11px] text-slate-500">No worker leaderboard data for this filter.</p>
              ) : (
                <table className="min-w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-950/70 border-b border-slate-800">
                      <th className="px-3 py-2">Worker</th>
                      <th className="px-3 py-2">Building</th>
                      <th className="px-3 py-2 text-right">Containers</th>
                      <th className="px-3 py-2 text-right">Pieces</th>
                      <th className="px-3 py-2 text-right">Minutes</th>
                      <th className="px-3 py-2 text-right">PPH</th>
                      <th className="px-3 py-2 text-right">Payout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboardRows.map((r) => (
                      <tr key={r.workerName} className="border-b border-slate-800/60 hover:bg-slate-900/60">
                        <td className="px-3 py-1.5">{r.workerName}</td>
                        <td className="px-3 py-1.5">{r.building}</td>
                        <td className="px-3 py-1.5 text-right">{r.totalContainers}</td>
                        <td className="px-3 py-1.5 text-right">{r.totalPieces}</td>
                        <td className="px-3 py-1.5 text-right">{r.totalMinutes}</td>
                        <td className="px-3 py-1.5 text-right text-sky-300">{r.avgPPH.toFixed(1)}</td>
                        <td className="px-3 py-1.5 text-right text-emerald-300">${r.totalPayout.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
      <div className="text-[11px] text-slate-400 mb-1">{label}</div>
      <div className="text-2xl font-semibold text-sky-300">{value}</div>
      <div className="text-[11px] text-slate-500 mt-1">{hint}</div>
    </div>
  );
}

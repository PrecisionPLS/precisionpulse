"use client";

import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import React, { useCallback, useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { BUILDINGS } from "@/lib/buildings";

const WORKFORCE_KEY = "precisionpulse_workforce";
const TERMINATIONS_KEY = "precisionpulse_terminations";
const DAMAGE_KEY = "precisionpulse_damage_reports";
const STARTUP_KEY = "precisionpulse_startup_checklists";
const CHATS_KEY = "precisionpulse_chats";
const CONTAINERS_KEY = "precisionpulse_containers";
const WORK_ORDERS_KEY = "precisionpulse_work_orders";

type LocalRow = Record<string, unknown>;

const SHIFT_OPTIONS = ["ALL", "1st", "2nd", "3rd", "4th"] as const;
type ShiftOption = (typeof SHIFT_OPTIONS)[number];

/**
 * ✅ RULES (kept)
 * - Leads: NO containers page. Entry is inside Work Orders
 * - Building Managers: NO containers page/tab. Yes Workforce (their building)
 * - Super Admin: full admin nav
 * - HQ/Admin: normal nav (containers allowed)
 * - Worker History visible to everyone, scoped by building (Lead/BM on that page)
 */

// ✅ Non–Super Admin allowed routes
const NON_SUPER_ALLOWED_ROUTES = new Set<string>([
  "/",
  "/work-orders",
  "/training",
  "/damage-reports",
  "/startup-checklists",
  "/chats",
  "/injury-report",
  "/worker-history",
]);

const NON_SUPER_BLOCKED_ROUTES = [
  "/shifts",
  "/staffing",
  "/workforce",
  "/hiring",
  "/terminations",
  "/reports",
  "/admin",
  "/user-accounts",
];

function safeReadArray(key: string): LocalRow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as LocalRow[]) : [];
  } catch {
    return [];
  }
}

function getObjBuilding(obj: LocalRow): string | undefined {
  const b =
    (typeof obj.building === "string" ? obj.building : undefined) ||
    (typeof obj.assignedBuilding === "string" ? obj.assignedBuilding : undefined) ||
    (typeof obj.homeBuilding === "string" ? obj.homeBuilding : undefined) ||
    (typeof obj.buildingCode === "string" ? obj.buildingCode : undefined) ||
    (typeof obj.dc === "string" ? obj.dc : undefined) ||
    (typeof obj.location === "string" ? obj.location : undefined);
  return b;
}

function getObjShift(obj: LocalRow): string | undefined {
  const s =
    (typeof obj.shift === "string" ? obj.shift : undefined) ||
    (typeof obj.shift_name === "string" ? obj.shift_name : undefined) ||
    (typeof obj.shiftName === "string" ? obj.shiftName : undefined);
  return s;
}

function getString(obj: LocalRow, key: string): string {
  const v = obj[key];
  return typeof v === "string" ? v : "";
}

function getNumber(obj: LocalRow, key: string): number {
  const v = obj[key];
  return typeof v === "number" ? v : 0;
}

function getBoolRecordValues(obj: unknown): boolean[] {
  if (!obj || typeof obj !== "object") return [];
  return Object.values(obj as Record<string, unknown>).filter((v): v is boolean => typeof v === "boolean");
}

/**
 * IMPORTANT FIX:
 * Minutes were often 0 because workers can store minutes under different keys.
 * This makes PPH + charts correct.
 */
function getWorkerMinutesFromWorkerRecord(w: Record<string, unknown>): number {
  const candidates = [w.minutesWorked, w.minutes, w.mins, w.timeMinutes, w.totalMinutes, w.minutes_worked];
  for (const c of candidates) {
    if (typeof c === "number" && !Number.isNaN(c)) return c;
  }
  if (typeof w.minutesWorked === "string") {
    const n = Number(w.minutesWorked);
    if (!Number.isNaN(n)) return n;
  }
  if (typeof w.minutes === "string") {
    const n = Number(w.minutes);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

function getWorkersMinutes(row: LocalRow): number {
  const workersRaw = row.workers;
  if (!Array.isArray(workersRaw)) return 0;

  return workersRaw.reduce<number>((sum, w) => {
    if (!w || typeof w !== "object") return sum;
    return sum + getWorkerMinutesFromWorkerRecord(w as Record<string, unknown>);
  }, 0);
}

function todayInNY(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // YYYY-MM-DD
}

function toDateOnlyISO(value: unknown): string {
  if (typeof value !== "string") return "";
  if (value.length >= 10) return value.slice(0, 10);
  return value;
}

function getRowDateOnly(row: LocalRow): string {
  const workDate =
    (typeof row.work_date === "string" ? row.work_date : "") ||
    (typeof row.workDate === "string" ? row.workDate : "") ||
    (typeof row.date === "string" ? row.date : "");

  const created =
    (typeof row.createdAt === "string" ? row.createdAt : "") ||
    (typeof row.created_at === "string" ? row.created_at : "") ||
    (typeof row.timestamp === "string" ? row.timestamp : "") ||
    (typeof row.savedAt === "string" ? row.savedAt : "");

  const best = workDate || created;
  return toDateOnlyISO(best);
}

function money(n: number): string {
  return `$${Number(n || 0).toFixed(2)}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map((x) => Number(x));
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function inLastNDays(dateISO: string, n: number, todayISO: string): boolean {
  if (!dateISO) return false;
  const start = addDaysISO(todayISO, -(n - 1)); // inclusive
  return dateISO >= start && dateISO <= todayISO;
}

/**
 * ✅ KEY FIX: Containers may live INSIDE work orders
 * This extracts container rows from each work order and normalizes them.
 */
function extractContainersFromWorkOrders(workOrders: LocalRow[]): LocalRow[] {
  const out: LocalRow[] = [];

  for (const wo of workOrders) {
    const woId = String(wo.id ?? wo.workOrderId ?? wo.work_order_id ?? "");
    const woName = (typeof wo.name === "string" ? wo.name : "") || (typeof wo.title === "string" ? wo.title : "");

    // Common places you may be storing them:
    const candidates = [
      wo.containers,
      wo.containerEntries,
      wo.container_entries,
      wo.entries,
      wo.items,
    ];

    const list = candidates.find((c) => Array.isArray(c)) as unknown;

    if (!Array.isArray(list)) continue;

    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;

      const c = raw as LocalRow;

      // Normalize: inherit building/shift from work order if container missing it
      const merged: LocalRow = {
        ...c,
        workOrderId: (typeof c.workOrderId === "string" ? c.workOrderId : "") || woId,
        workOrderName: (typeof c.workOrderName === "string" ? c.workOrderName : "") || woName,
        building: (typeof c.building === "string" ? c.building : "") || (typeof wo.building === "string" ? wo.building : ""),
        shift: (typeof c.shift === "string" ? c.shift : "") || (typeof wo.shift === "string" ? wo.shift : ""),
      };

      out.push(merged);
    }
  }

  return out;
}

/**
 * ✅ De-dupe containers so we don't double count if saved in two places.
 * Uses (id) if present, otherwise uses a stable fingerprint.
 */
function dedupeContainers(rows: LocalRow[]): LocalRow[] {
  const seen = new Set<string>();
  const out: LocalRow[] = [];

  for (const r of rows) {
    const id =
      (typeof r.id === "string" ? r.id : "") ||
      (typeof r.containerId === "string" ? r.containerId : "") ||
      (typeof r.container_id === "string" ? r.container_id : "");

    const created =
      (typeof r.createdAt === "string" ? r.createdAt : "") ||
      (typeof r.created_at === "string" ? r.created_at : "") ||
      (typeof r.timestamp === "string" ? r.timestamp : "");

    const pieces =
      (typeof r.piecesTotal === "number" ? r.piecesTotal : 0) ||
      (typeof r.pieces_total === "number" ? r.pieces_total : 0) ||
      (typeof r.total_pieces === "number" ? r.total_pieces : 0) ||
      0;

    const woId = (typeof r.workOrderId === "string" ? r.workOrderId : "") || "";
    const fp = id ? `id:${id}` : `fp:${woId}|${created}|${pieces}`;

    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(r);
  }

  return out;
}

export default function Page() {
  const router = useRouter();
  const currentUser = useCurrentUser();

  const role = currentUser?.accessRole || "";
  const isSuperAdmin = role === "Super Admin";
  const isLead = role === "Lead";
  const isBuildingManager = role === "Building Manager";
  const isHQ = !!currentUser && ["Super Admin", "Admin", "HQ"].includes(role);

  const userBuilding = currentUser?.building || "";
  const userShiftRaw = (currentUser as unknown as Record<string, unknown>)?.shift;
  const userShift = typeof userShiftRaw === "string" ? userShiftRaw : "";

  // ✅ Containers hidden for Leads + Building Managers
  const canSeeContainers = !(isLead || isBuildingManager);

  // ✅ Workforce only for Building Managers + Super Admin
  const canSeeWorkforce = isBuildingManager || isSuperAdmin;

  // ✅ Worker History visible to everyone
  const canSeeWorkerHistory = true;

  // ✅ URL Guard (kept)
  useEffect(() => {
    if (!currentUser) return;
    if (isSuperAdmin) return;

    const path = typeof window !== "undefined" ? window.location.pathname : "/";

    // Block containers for Lead/BM even if typed
    if ((isLead || isBuildingManager) && (path === "/containers" || path.startsWith("/containers/"))) {
      router.replace("/work-orders");
      return;
    }

    const isBlocked =
      NON_SUPER_BLOCKED_ROUTES.some((blocked) => path === blocked || path.startsWith(blocked + "/")) ||
      (!NON_SUPER_ALLOWED_ROUTES.has(path) && !(canSeeContainers && path === "/containers"));

    if (isBlocked) router.replace("/");
  }, [currentUser, isSuperAdmin, isLead, isBuildingManager, router, canSeeContainers]);

  // Filters
  const [buildingFilter, setBuildingFilter] = useState<string>(() => {
    return isHQ ? "ALL" : userBuilding || "ALL";
  });

  const [shiftFilter, setShiftFilter] = useState<ShiftOption>("ALL");

  // ✅ Effective scope rules:
  const effectiveBuilding = useMemo(() => {
    if (isLead || isBuildingManager) return userBuilding || buildingFilter || "ALL";
    return buildingFilter;
  }, [isLead, isBuildingManager, userBuilding, buildingFilter]);

  const effectiveShift = useMemo<ShiftOption>(() => {
    if (isLead) {
      const normalized = (userShift || "").trim();
      if (SHIFT_OPTIONS.includes(normalized as ShiftOption)) return normalized as ShiftOption;
      return "ALL";
    }
    return shiftFilter;
  }, [isLead, userShift, shiftFilter]);

  const matchesScope = useCallback(
    (obj: LocalRow): boolean => {
      const b = getObjBuilding(obj) || "";
      const s = getObjShift(obj) || "";

      const buildingOk = effectiveBuilding === "ALL" ? true : b === effectiveBuilding;
      const shiftOk = effectiveShift === "ALL" ? true : s === effectiveShift;

      return buildingOk && shiftOk;
    },
    [effectiveBuilding, effectiveShift]
  );

  // ✅ Initialize from localStorage
  const [workforce, setWorkforce] = useState<LocalRow[]>(() => safeReadArray(WORKFORCE_KEY));
  const [terminations, setTerminations] = useState<LocalRow[]>(() => safeReadArray(TERMINATIONS_KEY));
  const [damageReports, setDamageReports] = useState<LocalRow[]>(() => safeReadArray(DAMAGE_KEY));
  const [startupChecklists, setStartupChecklists] = useState<LocalRow[]>(() => safeReadArray(STARTUP_KEY));
  const [chats, setChats] = useState<LocalRow[]>(() => safeReadArray(CHATS_KEY));
  const [containers, setContainers] = useState<LocalRow[]>(() => safeReadArray(CONTAINERS_KEY));
  const [workOrders, setWorkOrders] = useState<LocalRow[]>(() => safeReadArray(WORK_ORDERS_KEY));

  useEffect(() => {
    if (typeof window === "undefined") return;

    function onStorage(e: StorageEvent) {
      if (!e.key) return;
      if (e.key === WORKFORCE_KEY) setWorkforce(safeReadArray(WORKFORCE_KEY));
      if (e.key === TERMINATIONS_KEY) setTerminations(safeReadArray(TERMINATIONS_KEY));
      if (e.key === DAMAGE_KEY) setDamageReports(safeReadArray(DAMAGE_KEY));
      if (e.key === STARTUP_KEY) setStartupChecklists(safeReadArray(STARTUP_KEY));
      if (e.key === CHATS_KEY) setChats(safeReadArray(CHATS_KEY));
      if (e.key === CONTAINERS_KEY) setContainers(safeReadArray(CONTAINERS_KEY));
      if (e.key === WORK_ORDERS_KEY) setWorkOrders(safeReadArray(WORK_ORDERS_KEY));
    }

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ✅ Correct today (NY)
  const todayStr = useMemo(() => todayInNY(), []);

  /**
   * ✅ BIG FIX: Build a single “source of truth” for container rows:
   * - standalone containers
   * - containers nested inside work orders
   */
  const allContainers = useMemo(() => {
    const fromWO = extractContainersFromWorkOrders(workOrders);
    const merged = [...containers, ...fromWO];
    return dedupeContainers(merged);
  }, [containers, workOrders]);

  // Trend (30-day arrays) using scoped rows
  const trend = useMemo(() => {
    const contAll = allContainers.filter(matchesScope);

    const days: { date: string; containers: number; pieces: number; minutes: number; pph: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = addDaysISO(todayStr, -i);
      days.push({ date: d, containers: 0, pieces: 0, minutes: 0, pph: 0 });
    }
    const idx = new Map<string, number>();
    days.forEach((d, i) => idx.set(d.date, i));

    for (const c of contAll) {
      const d = getRowDateOnly(c);
      if (!d) continue;
      const i = idx.get(d);
      if (i === undefined) continue;

      days[i].containers += 1;

      const pieces =
        getNumber(c, "piecesTotal") ||
        getNumber(c, "pieces_total") ||
        getNumber(c, "total_pieces") ||
        0;
      days[i].pieces += pieces;

      const minutes = getWorkersMinutes(c);
      days[i].minutes += minutes;
    }

    for (const d of days) {
      d.pph = d.minutes === 0 ? 0 : (d.pieces * 60) / d.minutes;
    }

    const last7 = days.slice(-7);
    const last30 = days.slice(-30);
    const today = days[days.length - 1];

    const sum = (arr: typeof days, key: keyof (typeof days)[number]) =>
      arr.reduce((s, r) => s + (Number(r[key]) || 0), 0);

    const todayAgg = {
      containers: today?.containers || 0,
      pieces: today?.pieces || 0,
      minutes: today?.minutes || 0,
      pph: today?.pph || 0,
    };

    const last7Agg = {
      containers: sum(last7, "containers"),
      pieces: sum(last7, "pieces"),
      minutes: sum(last7, "minutes"),
      pph: sum(last7, "minutes") === 0 ? 0 : (sum(last7, "pieces") * 60) / sum(last7, "minutes"),
    };

    const last30Agg = {
      containers: sum(last30, "containers"),
      pieces: sum(last30, "pieces"),
      minutes: sum(last30, "minutes"),
      pph: sum(last30, "minutes") === 0 ? 0 : (sum(last30, "pieces") * 60) / sum(last30, "minutes"),
    };

    const maxContainers = Math.max(1, ...days.map((d) => d.containers));
    const maxPieces = Math.max(1, ...days.map((d) => d.pieces));
    const maxPPH = Math.max(1, ...days.map((d) => d.pph));

    const anyData =
      days.some((d) => d.containers > 0) ||
      days.some((d) => d.pieces > 0) ||
      days.some((d) => d.minutes > 0);

    return { days, todayAgg, last7Agg, last30Agg, maxContainers, maxPieces, maxPPH, anyData };
  }, [allContainers, matchesScope, todayStr]);

  const metrics = useMemo(() => {
    const wf = workforce.filter(matchesScope);
    const term = terminations.filter(matchesScope);
    const dmg = damageReports.filter(matchesScope);
    const startup = startupChecklists.filter(matchesScope);
    const chatAll = chats.filter(matchesScope);

    // ✅ Use merged container source
    const contAll = allContainers.filter(matchesScope);

    const wo = workOrders.filter(matchesScope);

    const totalWorkers = wf.length;
    const activeWorkers = wf.filter((w) => getString(w, "status") === "Active").length;

    function checklistProgress(c: unknown) {
      const vals = getBoolRecordValues(c);
      return { total: vals.length, done: vals.filter(Boolean).length };
    }

    function terminationStatus(t: LocalRow) {
      const { total, done } = checklistProgress(t.checklist);
      return total > 0 && done === total ? "Completed" : "In Progress";
    }

    const termInProgress = term.filter((t) => terminationStatus(t) === "In Progress").length;
    const termCompleted = term.length - termInProgress;

    const totalDamageReports = dmg.length;
    const openDamageReports = dmg.filter((r) => {
      const s = getString(r, "status");
      return s === "Open" || s === "In Review";
    }).length;

    const totalPiecesDamage = dmg.reduce<number>((sum, r) => sum + getNumber(r, "piecesTotal"), 0);
    const totalDamaged = dmg.reduce<number>((sum, r) => sum + getNumber(r, "piecesDamaged"), 0);
    const avgDamagePercent = totalPiecesDamage === 0 ? 0 : Math.round((totalDamaged / totalPiecesDamage) * 100);

    // Startup today (NY)
    const startupToday = startup.filter((r) => toDateOnlyISO(getString(r, "date")) === todayStr);
    const startupTodayTotal = startupToday.length;
    const startupTodayCompleted = startupToday.filter((r) => {
      const vals = getBoolRecordValues(r.items);
      return vals.length > 0 && vals.every(Boolean);
    }).length;

    // Chats today
    const chatsToday = chatAll.filter((m) => toDateOnlyISO(getString(m, "createdAt")) === todayStr);
    const chatsTodayCount = chatsToday.length;

    // Work orders
    const workOrdersTotal = wo.length;
    const workOrdersOpen = wo.filter((item) => {
      const s = getString(item, "status");
      return s === "Pending" || s === "Active";
    }).length;

    // Containers today
    const contToday = contAll.filter((c) => getRowDateOnly(c) === todayStr);
    const containersToday = contToday.length;

    const piecesToday = contToday.reduce<number>((sum, c) => {
      const pieces =
        getNumber(c, "piecesTotal") ||
        getNumber(c, "pieces_total") ||
        getNumber(c, "total_pieces") ||
        0;
      return sum + pieces;
    }, 0);

    const minutesToday = contToday.reduce<number>((sum, c) => sum + getWorkersMinutes(c), 0);
    const pphToday = minutesToday === 0 ? 0 : (piecesToday * 60) / minutesToday;

    // Coverage signal (last 7 days)
    const last7 = contAll.filter((c) => {
      const d = getRowDateOnly(c);
      return inLastNDays(d, 7, todayStr);
    });
    const uniqueDays = new Set(last7.map((c) => getRowDateOnly(c)).filter(Boolean));
    const last7CoverageDays = uniqueDays.size;

    // Freshness
    const lastSeen = contAll
      .map((c) => {
        const t =
          (typeof c.createdAt === "string" ? c.createdAt : "") ||
          (typeof c.created_at === "string" ? c.created_at : "") ||
          (typeof c.timestamp === "string" ? c.timestamp : "");
        return t;
      })
      .filter(Boolean)
      .sort()
      .slice(-1)[0];

    return {
      totalWorkers,
      activeWorkers,
      termInProgress,
      termCompleted,
      totalDamageReports,
      openDamageReports,
      avgDamagePercent,
      startupTodayTotal,
      startupTodayCompleted,
      chatsTodayCount,
      containersTotal: contAll.length,
      workOrdersTotal,
      workOrdersOpen,
      containersToday,
      piecesToday,
      minutesToday,
      pphToday,
      last7CoverageDays,
      lastSeen,
    };
  }, [
    workforce,
    terminations,
    damageReports,
    startupChecklists,
    chats,
    allContainers,
    workOrders,
    todayStr,
    matchesScope,
  ]);

  const buildingLabel = effectiveBuilding === "ALL" ? "All Buildings" : effectiveBuilding;
  const shiftLabel = effectiveShift === "ALL" ? "All Shifts" : effectiveShift;

  // Insights (Top Work Orders + Top Workers) last 7 days, scoped
  const insights = useMemo(() => {
    const contAll = allContainers.filter(matchesScope);

    const woById = new Map<string, string>();
    for (const w of workOrders) {
      const id = String(w.id ?? "");
      const name = getString(w, "name");
      if (id) woById.set(id, name || id);
    }

    const woAgg = new Map<string, { workOrder: string; containers: number; pieces: number; payTotal: number }>();

    for (const c of contAll) {
      const d = getRowDateOnly(c);
      if (!inLastNDays(d, 7, todayStr)) continue;

      const woId =
        (typeof c.workOrderId === "string" ? c.workOrderId : "") ||
        (typeof c.work_order_id === "string" ? c.work_order_id : "") ||
        "";

      const label =
        woId ? woById.get(woId) || woId : (typeof c.workOrderName === "string" ? c.workOrderName : "") || "Unassigned";

      const key = label;

      if (!woAgg.has(key)) woAgg.set(key, { workOrder: label, containers: 0, pieces: 0, payTotal: 0 });

      const row = woAgg.get(key)!;
      row.containers += 1;

      const pieces =
        getNumber(c, "piecesTotal") ||
        getNumber(c, "pieces_total") ||
        getNumber(c, "total_pieces") ||
        0;
      row.pieces += pieces;

      const pay =
        getNumber(c, "containerPayTotal") ||
        getNumber(c, "pay_total") ||
        getNumber(c, "container_pay_total") ||
        0;
      row.payTotal += pay;
    }

    const topWorkOrders = Array.from(woAgg.values())
      .sort((a, b) => b.containers - a.containers || b.pieces - a.pieces)
      .slice(0, 6);

    const workerAgg = new Map<string, { worker: string; payout: number; minutes: number; containers: number }>();

    for (const c of contAll) {
      const d = getRowDateOnly(c);
      if (!inLastNDays(d, 7, todayStr)) continue;

      const workersRaw = c.workers;
      if (!Array.isArray(workersRaw)) continue;

      const seenInThisContainer = new Set<string>();

      for (const w of workersRaw) {
        if (!w || typeof w !== "object") continue;
        const rec = w as Record<string, unknown>;
        const name =
          (typeof rec.name === "string" ? rec.name : "") ||
          (typeof rec.workerName === "string" ? rec.workerName : "") ||
          (typeof rec.fullName === "string" ? rec.fullName : "");

        const worker = String(name || "Unknown").trim();
        if (!worker) continue;

        const key = worker.toLowerCase();
        if (!workerAgg.has(key)) workerAgg.set(key, { worker, payout: 0, minutes: 0, containers: 0 });

        const entry = workerAgg.get(key)!;

        const payout =
          (typeof rec.payout === "number" ? rec.payout : 0) ||
          (typeof rec.payoutAmount === "number" ? rec.payoutAmount : 0) ||
          (typeof rec.pay === "number" ? rec.pay : 0);

        const minutes = getWorkerMinutesFromWorkerRecord(rec);

        entry.payout += payout;
        entry.minutes += minutes;

        if (!seenInThisContainer.has(key)) {
          entry.containers += 1;
          seenInThisContainer.add(key);
        }
      }
    }

    const topWorkers = Array.from(workerAgg.values())
      .sort((a, b) => b.payout - a.payout)
      .slice(0, 6);

    return { topWorkOrders, topWorkers };
  }, [allContainers, workOrders, matchesScope, todayStr]);

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.error("Supabase signOut failed", e);
    }
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("precisionpulse_currentUser");
    }
    router.push("/auth");
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center text-sm">
        Redirecting to login…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50">
      <div className="mx-auto max-w-7xl flex">
        {/* SIDEBAR */}
        <aside className="w-72 border-r border-slate-800 bg-slate-950/80 p-5 flex flex-col gap-4 backdrop-blur-sm">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-sky-300 tracking-wide">Precision Pulse</div>
            <div className="text-lg font-semibold text-slate-50 leading-tight">3PL Operations</div>
            <div className="text-[11px] text-slate-500 leading-relaxed">
              Containers • workforce • quality • HR workflows — in one place.
            </div>
          </div>

          {/* Role banner */}
          {isLead ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <div className="text-[11px] text-slate-300 font-semibold">Lead Entry</div>
              <div className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                Enter containers <span className="text-sky-300 font-semibold">inside Work Orders</span> to avoid duplicates.
              </div>
              <div className="mt-2 text-[10px] text-slate-500">
                Scope: <span className="text-slate-200">{buildingLabel}</span> •{" "}
                <span className="text-slate-200">{shiftLabel}</span>
              </div>
              <Link
                href="/work-orders"
                className="mt-2 inline-flex items-center gap-2 rounded-lg bg-sky-600 hover:bg-sky-500 px-3 py-1.5 text-[11px] text-white font-medium"
              >
                Go to Work Orders →
              </Link>

              {canSeeWorkerHistory && (
                <Link
                  href="/worker-history"
                  className="mt-2 inline-flex items-center gap-2 rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-[11px] text-slate-100"
                >
                  Worker History →
                </Link>
              )}
            </div>
          ) : isBuildingManager ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <div className="text-[11px] text-slate-300 font-semibold">Building Manager</div>
              <div className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                Manage work orders and workforce for{" "}
                <span className="text-sky-300 font-semibold">{buildingLabel}</span>.
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link
                  href="/work-orders"
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-[11px] text-slate-100"
                >
                  Work Orders →
                </Link>

                {canSeeWorkforce && (
                  <Link
                    href="/workforce"
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-[11px] text-slate-100"
                  >
                    Workforce →
                  </Link>
                )}

                <Link
                  href="/injury-report"
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-[11px] text-slate-100"
                >
                  Injury Report →
                </Link>

                {canSeeWorkerHistory && (
                  <Link
                    href="/worker-history"
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-[11px] text-slate-100"
                  >
                    Worker History →
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <div className="text-[11px] text-slate-300 font-semibold">Quick Start</div>
              <div className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                Use <span className="text-sky-300 font-semibold">Work Orders</span> for grouped entry and review.
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link
                  href="/work-orders"
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-[11px] text-slate-100"
                >
                  Work Orders →
                </Link>

                {canSeeContainers && (
                  <Link
                    href="/containers"
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-[11px] text-slate-100"
                  >
                    Containers →
                  </Link>
                )}

                <Link
                  href="/injury-report"
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-[11px] text-slate-100"
                >
                  Injury Report →
                </Link>

                {canSeeWorkerHistory && (
                  <Link
                    href="/worker-history"
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-[11px] text-slate-100"
                  >
                    Worker History →
                  </Link>
                )}
              </div>
            </div>
          )}

          <div className="mt-1">
            <div className="text-[10px] uppercase tracking-wide text-slate-600 mb-2">Navigation</div>
            <nav className="space-y-1 text-sm">
              <NavItem href="/" active>
                Dashboard
              </NavItem>

              <NavItem href="/work-orders">Work Orders</NavItem>

              {canSeeContainers && <NavItem href="/containers">Containers</NavItem>}

              {canSeeWorkforce && <NavItem href="/workforce">Workforce</NavItem>}

              <NavItem href="/injury-report">Injury Report</NavItem>

              {canSeeWorkerHistory && <NavItem href="/worker-history">Worker History</NavItem>}

              <div className="pt-2 mt-2 border-t border-slate-800/80">
                <div className="text-[10px] uppercase tracking-wide text-slate-600 mb-2">Operations</div>
                <NavItem href="/damage-reports">Damage Reports</NavItem>
                <NavItem href="/startup-checklists">Shift Readiness Reports</NavItem>
                <NavItem href="/training">Training</NavItem>
                <NavItem href="/chats">Chats</NavItem>
              </div>

              {isSuperAdmin && (
                <div className="pt-2 mt-2 border-t border-slate-800/80">
                  <div className="text-[10px] uppercase tracking-wide text-slate-600 mb-2">Admin</div>
                  <NavItem href="/shifts">Shifts</NavItem>
                  <NavItem href="/staffing">Staffing Coverage</NavItem>
                  <NavItem href="/hiring">Hiring</NavItem>
                  <NavItem href="/terminations">Terminations</NavItem>
                  <NavItem href="/reports">Reports</NavItem>
                  <NavItem href="/admin">Admin / Backup</NavItem>
                  <NavItem href="/user-accounts" emphasize>
                    User Accounts
                  </NavItem>
                </div>
              )}
            </nav>
          </div>

          <div className="mt-auto pt-3 border-t border-slate-800/80">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] text-slate-200 truncate">
                  {currentUser.name}{" "}
                  {currentUser.accessRole && (
                    <span className="ml-1 inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-sky-200">
                      {currentUser.accessRole}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  {currentUser.email} · {currentUser.building || "No building set"}
                  {isLead && userShift ? ` · ${userShift}` : ""}
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="text-[11px] px-3 py-1.5 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 shrink-0"
              >
                Logout
              </button>
            </div>
          </div>
        </aside>

        {/* MAIN DASHBOARD */}
        <main className="flex-1 p-6 space-y-6">
          {/* Header */}
          <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900/80 via-slate-900/40 to-slate-950 p-6 shadow-sm shadow-slate-900/60">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold text-slate-50">Dashboard</h1>
                <p className="text-sm text-slate-400">
                  Live overview • <span className="font-semibold text-sky-300">{buildingLabel}</span> •{" "}
                  <span className="font-semibold text-sky-300">{shiftLabel}</span>
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Pill subtle>
                    Timezone: <span className="ml-1 text-slate-200">America/New_York</span>
                  </Pill>
                  <Pill subtle>
                    Today: <span className="ml-1 font-mono text-slate-200">{todayStr}</span>
                  </Pill>
                  <Pill subtle>
                    Last 7-day coverage:{" "}
                    <span className="ml-1 text-sky-300 font-semibold">{metrics.last7CoverageDays}/7</span>
                  </Pill>
                  {metrics.lastSeen ? (
                    <Pill subtle>
                      Last container saved:{" "}
                      <span className="ml-1 font-mono text-slate-200">{String(metrics.lastSeen).slice(0, 19)}</span>
                    </Pill>
                  ) : (
                    <Pill subtle>No container timestamps found</Pill>
                  )}
                </div>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500">Building:</span>
                  <select
                    className="rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-1.5 text-xs text-slate-50 shadow-sm shadow-slate-900/50"
                    value={buildingFilter}
                    onChange={(e) => setBuildingFilter(e.target.value)}
                    disabled={!isHQ && !!userBuilding}
                  >
                    {isHQ && <option value="ALL">All Buildings</option>}
                    {BUILDINGS.map((b) => {
                      if (!isHQ && userBuilding && b !== userBuilding) return null;
                      return (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500">Shift:</span>
                  <select
                    className="rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-1.5 text-xs text-slate-50 shadow-sm shadow-slate-900/50"
                    value={shiftFilter}
                    onChange={(e) => setShiftFilter(e.target.value as ShiftOption)}
                    disabled={isLead}
                  >
                    {SHIFT_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s === "ALL" ? "All Shifts" : s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
              <ActionCard
                title="Enter Work"
                desc={isLead ? "Add containers inside a work order (recommended)." : "Create work orders and add containers."}
                href="/work-orders"
                cta="Open Work Orders →"
              />

              {canSeeContainers ? (
                <ActionCard
                  title="Review Containers"
                  desc="View container totals and worker payouts."
                  href="/containers"
                  cta="Open Containers →"
                />
              ) : (
                <ActionCard
                  title="Container Entry"
                  desc="Containers are entered inside Work Orders to keep everything organized."
                  href="/work-orders"
                  cta="Go to Work Orders →"
                />
              )}

              <ActionCard
                title="Injury Report"
                desc="Report injuries, attach documents, and print forms for signatures."
                href="/injury-report"
                cta="Open Injury Report →"
              />
            </div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <ActionCard
                title="Worker History"
                desc="Click a worker to see every container they worked and earnings by container."
                href="/worker-history"
                cta="Open Worker History →"
              />
            </div>
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <KpiCard
              label="Active Workforce"
              value={String(metrics.activeWorkers)}
              sub={`Total workers: ${metrics.totalWorkers}`}
              href={canSeeWorkforce ? "/workforce" : undefined}
              linkText={canSeeWorkforce ? "Manage Workforce →" : undefined}
              accent="emerald"
            />

            <KpiCard
              label="Open Damage Reports"
              value={String(metrics.openDamageReports)}
              sub={`Avg damage: ${metrics.avgDamagePercent}%`}
              href="/damage-reports"
              linkText="View Damage →"
              accent="amber"
            />

            <KpiCard
              label="Terminations In Progress"
              value={String(metrics.termInProgress)}
              sub={`Completed: ${metrics.termCompleted}`}
              href={isSuperAdmin ? "/terminations" : undefined}
              linkText={isSuperAdmin ? "View Terminations →" : undefined}
              accent="rose"
            />

            <KpiCard
              label="Chat Activity Today"
              value={String(metrics.chatsTodayCount)}
              sub={`Messages in ${buildingLabel}`}
              href="/chats"
              linkText="Open Chats →"
              accent="sky"
            />
          </div>

          {/* Trends + Highlights */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <Panel className="xl:col-span-2 space-y-4">
              <div className="flex items-end justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">Performance Trends</h2>
                  <p className="text-[11px] text-slate-500">Last 30 days • Containers • Pieces • PPH</p>
                </div>
                <Pill subtle>
                  {buildingLabel} • {shiftLabel}
                </Pill>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <TrendStat
                  title="Containers"
                  today={trend.todayAgg.containers}
                  last7={trend.last7Agg.containers}
                  last30={trend.last30Agg.containers}
                  hint="Count of containers logged"
                />
                <TrendStat
                  title="Pieces"
                  today={trend.todayAgg.pieces}
                  last7={trend.last7Agg.pieces}
                  last30={trend.last30Agg.pieces}
                  hint="Total pieces from container entries"
                />
                <TrendStat
                  title="PPH"
                  today={Number(trend.todayAgg.pph.toFixed(1))}
                  last7={Number(trend.last7Agg.pph.toFixed(1))}
                  last30={Number(trend.last30Agg.pph.toFixed(1))}
                  hint="Pieces per hour (pieces*60 / minutes)"
                />
              </div>

              {!trend.anyData ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                  <div className="text-[12px] text-slate-200 font-semibold">No chart data found in the last 30 days</div>
                  <div className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    If you KNOW containers exist, it usually means they are stored inside Work Orders. This dashboard now reads both
                    sources, so refresh and try again. Also confirm containers have a timestamp (createdAt/work_date).
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  <MiniChart
                    title="Containers (30 days)"
                    subtitle="Daily container volume"
                    series={trend.days.map((d) => d.containers)}
                    labels={trend.days.map((d) => d.date.slice(5))}
                    max={trend.maxContainers}
                  />
                  <MiniChart
                    title="Pieces (30 days)"
                    subtitle="Daily piece volume"
                    series={trend.days.map((d) => d.pieces)}
                    labels={trend.days.map((d) => d.date.slice(5))}
                    max={trend.maxPieces}
                  />
                  <MiniChart
                    title="PPH (30 days)"
                    subtitle="Daily throughput efficiency"
                    series={trend.days.map((d) => Number(d.pph.toFixed(1)))}
                    labels={trend.days.map((d) => d.date.slice(5))}
                    max={trend.maxPPH}
                  />
                </div>
              )}
            </Panel>

            <Panel className="xl:col-span-1 space-y-4">
              <div className="flex items-end justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">Weekly Highlights</h2>
                  <p className="text-[11px] text-slate-500">Top Work Orders & Workers (7 days)</p>
                </div>
                <Pill subtle>Last 7</Pill>
              </div>

              <MiniCard>
                <div className="text-slate-300 mb-2 font-semibold">Top Work Orders</div>
                {insights.topWorkOrders.length === 0 ? (
                  <div className="text-[11px] text-slate-500">No work order activity in the last 7 days.</div>
                ) : (
                  <div className="space-y-2">
                    {insights.topWorkOrders.map((w) => (
                      <div key={w.workOrder} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[12px] text-slate-100 truncate">{w.workOrder}</div>
                          <div className="text-[10px] text-slate-500">
                            {w.containers} containers • {w.pieces.toLocaleString()} pieces
                          </div>
                        </div>
                        <div className="text-[11px] text-emerald-300 shrink-0">{money(w.payTotal)}</div>
                      </div>
                    ))}
                  </div>
                )}
                <Link href="/work-orders" className="mt-3 inline-block text-[11px] text-sky-300 hover:underline">
                  Open Work Orders →
                </Link>
              </MiniCard>

              <MiniCard>
                <div className="text-slate-300 mb-2 font-semibold">Top Workers (by payout)</div>
                {insights.topWorkers.length === 0 ? (
                  <div className="text-[11px] text-slate-500">No worker payout activity in the last 7 days.</div>
                ) : (
                  <div className="space-y-2">
                    {insights.topWorkers.map((w) => (
                      <div key={w.worker} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[12px] text-slate-100 truncate">{w.worker}</div>
                          <div className="text-[10px] text-slate-500">
                            {w.containers} containers • {w.minutes} minutes
                          </div>
                        </div>
                        <div className="text-[11px] text-sky-300 font-semibold shrink-0">{money(w.payout)}</div>
                      </div>
                    ))}
                  </div>
                )}
                <Link href="/worker-history" className="mt-3 inline-block text-[11px] text-sky-300 hover:underline">
                  Open Worker History →
                </Link>
              </MiniCard>

              {metrics.last7CoverageDays < 7 && (
                <div className="rounded-xl border border-amber-700/60 bg-amber-950/30 p-3">
                  <div className="text-[11px] text-amber-200 font-semibold">Coverage warning</div>
                  <div className="text-[11px] text-amber-100/80 mt-1 leading-relaxed">
                    Only <span className="font-semibold">{metrics.last7CoverageDays}</span> of the last 7 days have container entries in this view.
                    If you expected daily entries, check Work Orders for missing logs.
                  </div>
                </div>
              )}
            </Panel>
          </div>
        </main>
      </div>
    </div>
  );
}

/** ---------------- Components (visual-only) ---------------- */

function NavItem({
  href,
  children,
  active,
  emphasize,
}: {
  href: string;
  children: React.ReactNode;
  active?: boolean;
  emphasize?: boolean;
}) {
  const base = "block px-3 py-2 rounded-lg transition-colors text-sm border border-transparent";
  const activeCls = "bg-slate-900 text-slate-50 shadow-sm shadow-slate-900/60 border-slate-800";
  const normalCls = "text-slate-300 hover:bg-slate-800 hover:text-sky-200";
  const emphCls = "text-slate-200 hover:bg-slate-800 hover:text-sky-200 border border-slate-700/80";

  return (
    <Link href={href} className={`${base} ${active ? activeCls : emphasize ? emphCls : normalCls}`}>
      {children}
    </Link>
  );
}

function Pill({ children, subtle }: { children: React.ReactNode; subtle?: boolean }) {
  return (
    <span
      className={
        subtle
          ? "inline-flex items-center rounded-full border border-slate-800 bg-slate-950/70 px-3 py-1 text-[11px] text-slate-300"
          : "inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[11px] text-slate-200 shadow-sm shadow-slate-900/40"
      }
    >
      {children}
    </span>
  );
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-slate-900/95 border border-slate-800 rounded-2xl p-6 shadow-sm shadow-slate-900/50 ${className}`}>
      {children}
    </div>
  );
}

function MiniCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 shadow-sm shadow-slate-900/40">{children}</div>;
}

function ActionCard({ title, desc, href, cta }: { title: string; desc: string; href: string; cta: string }) {
  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm shadow-slate-900/40 hover:shadow-lg hover:shadow-slate-900/70 transition-shadow">
      <div className="text-sm font-semibold text-slate-100">{title}</div>
      <div className="mt-1 text-[11px] text-slate-500 leading-relaxed">{desc}</div>
      <Link
        href={href}
        className="mt-3 inline-flex items-center justify-between w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-[11px] text-sky-300 hover:bg-slate-900/60"
      >
        <span>{cta}</span>
        <span className="text-slate-500">→</span>
      </Link>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  href,
  linkText,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  href?: string;
  linkText?: string;
  accent: "emerald" | "amber" | "rose" | "sky";
}) {
  const valueColor =
    accent === "emerald"
      ? "text-emerald-300"
      : accent === "amber"
      ? "text-amber-300"
      : accent === "rose"
      ? "text-rose-300"
      : "text-sky-300";

  return (
    <div className="rounded-2xl bg-gradient-to-br from-slate-900/90 to-slate-950 border border-slate-800 p-4 shadow-sm shadow-slate-900/50 hover:shadow-lg hover:shadow-slate-900/70 transition-shadow">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${valueColor}`}>{value}</div>
      <div className="mt-1 text-[11px] text-slate-500">{sub}</div>
      {href && linkText && (
        <Link href={href} className="mt-3 inline-block text-[11px] text-sky-300 hover:underline">
          {linkText}
        </Link>
      )}
    </div>
  );
}

function TrendStat({
  title,
  today,
  last7,
  last30,
  hint,
}: {
  title: string;
  today: number;
  last7: number;
  last30: number;
  hint: string;
}) {
  return (
    <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 shadow-sm shadow-slate-900/40">
      <div className="text-[11px] text-slate-400">{title}</div>
      <div className="mt-1 text-lg font-semibold text-slate-100">{Number(today).toLocaleString()}</div>
      <div className="mt-1 text-[10px] text-slate-500">{hint}</div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-slate-400">
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-2 py-1">
          <div className="text-slate-500">Last 7</div>
          <div className="text-slate-200 font-semibold">{Number(last7).toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-2 py-1">
          <div className="text-slate-500">Last 30</div>
          <div className="text-slate-200 font-semibold">{Number(last30).toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * ✅ Upgraded MiniChart:
 * - Visible bars even when values are small vs max
 * - Auto "scaled" mode (sqrt) when one day dwarfs the rest
 * - Premium look; never "blank" when data exists
 */
function MiniChart({
  title,
  subtitle,
  series,
  labels,
  max,
}: {
  title: string;
  subtitle: string;
  series: number[];
  labels: string[];
  max: number;
}) {
  const numeric = series.map((v) => (typeof v === "number" && !Number.isNaN(v) ? v : Number(v) || 0));
  const anyNonZero = numeric.some((v) => v > 0);

  const computedMax = Math.max(1, ...numeric);
  const safeMax = max && max > 0 ? Math.max(1, max) : computedMax;

  const sorted = [...numeric].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const useSqrtScale = safeMax > 0 && median > 0 && safeMax / median >= 12;

  function heightPct(v: number): number {
    if (v <= 0) return 0;
    const raw = useSqrtScale ? (Math.sqrt(v) / Math.sqrt(safeMax)) * 100 : (v / safeMax) * 100;
    const clamped = clamp(raw, 0, 100);
    return clamped < 4 ? 4 : clamped; // min visible
  }

  const tickEvery = 5;

  return (
    <div className="rounded-2xl bg-gradient-to-br from-slate-950 to-slate-900 border border-slate-800 p-4 shadow-sm shadow-slate-900/40">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[12px] text-slate-200 font-semibold">{title}</div>
          <div className="text-[10px] text-slate-500">{subtitle}</div>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          <span className="rounded-full border border-slate-800 bg-slate-950/60 px-2 py-1">30d</span>
          {useSqrtScale && (
            <span className="rounded-full border border-slate-800 bg-slate-950/60 px-2 py-1">scaled</span>
          )}
        </div>
      </div>

      {!anyNonZero ? (
        <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
          <div className="text-[11px] text-slate-300 font-semibold">No data in this range</div>
          <div className="text-[11px] text-slate-500 mt-1">
            Nothing logged in the last 30 days for this building/shift scope.
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 h-[150px] flex items-end gap-[3px]">
            {numeric.map((v, i) => {
              const pct = heightPct(v);
              const showTick = i % tickEvery === 0 || i === numeric.length - 1;

              return (
                <div key={`${i}-${labels[i]}`} className="flex-1 min-w-[3px] group">
                  <div
                    className="w-full rounded-md border border-slate-800/70 bg-gradient-to-t from-sky-700/60 via-sky-600/30 to-sky-400/20 shadow-[0_0_0_1px_rgba(2,6,23,0.3)]"
                    style={{ height: `${pct}%` }}
                    title={`${labels[i]} • ${Number(v).toLocaleString()}`}
                  />
                  <div className={`mt-1 text-[9px] text-center select-none ${showTick ? "text-slate-600" : "text-transparent"}`}>
                    {showTick ? labels[i] : "."}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-2 text-[10px] text-slate-500">
            Tip: hover any bar to see the exact value for that day.
          </div>
        </>
      )}
    </div>
  );
}

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

// LocalStorage row types (kept flexible but NOT `any`)
type LocalRow = Record<string, unknown>;

/**
 * ✅ RULES
 * - Leads: NO containers page. (Entry is inside Work Orders)
 * - Building Managers: NO containers page OR tab. Yes Workforce (to manage their building workers)
 * - Super Admin: full admin nav
 * - HQ/Admin: normal nav (containers allowed)
 * - ✅ NEW: Worker History visible to everyone, scoped by building (Lead/BM)
 */

// ✅ Non–Super Admins are only allowed to access these routes (client-side guard)
const NON_SUPER_ALLOWED_ROUTES = new Set<string>([
  "/",
  "/work-orders",
  "/training",
  "/damage-reports",
  "/startup-checklists",
  "/chats",
  "/injury-report",
  "/worker-history", // ✅ NEW
  // NOTE: "/containers" stays allowed for non-super ONLY if they are HQ/Admin (handled in guard below)
]);

// ✅ These are blocked routes if typed directly in the URL by non–Super Admin
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
    (typeof obj.buildingCode === "string" ? obj.buildingCode : undefined);
  return b;
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

function getWorkersMinutes(row: LocalRow): number {
  const workersRaw = row.workers;
  if (!Array.isArray(workersRaw)) return 0;

  return workersRaw.reduce<number>((sum, w) => {
    if (!w || typeof w !== "object") return sum;
    const mw = (w as Record<string, unknown>).minutesWorked;
    return sum + (typeof mw === "number" ? mw : 0);
  }, 0);
}

export default function Page() {
  const router = useRouter();
  const currentUser = useCurrentUser();

  const isSuperAdmin = currentUser?.accessRole === "Super Admin";
  const isAdmin = currentUser?.accessRole === "Admin";
  const isHQ = !!currentUser && ["Super Admin", "Admin", "HQ"].includes(currentUser.accessRole || "");

  const isLead = currentUser?.accessRole === "Lead";
  const isBuildingManager = currentUser?.accessRole === "Building Manager";

  const userBuilding = currentUser?.building || "";

  // ✅ Containers are hidden for Leads + Building Managers
  const canSeeContainers = !(isLead || isBuildingManager);

  // ✅ Workforce is visible/manageable for Building Managers + Super Admin
  const canSeeWorkforce = isBuildingManager || isSuperAdmin;

  // ✅ Worker History visible to everyone (scoped by building for Lead/BM on that page)
  const canSeeWorkerHistory = true;

  // ✅ URL Guard:
  useEffect(() => {
    if (!currentUser) return;
    if (isSuperAdmin) return;

    const path = typeof window !== "undefined" ? window.location.pathname : "/";

    // ✅ Block containers for Leads + Building Managers (even if typed in URL)
    if ((isLead || isBuildingManager) && (path === "/containers" || path.startsWith("/containers/"))) {
      router.replace("/work-orders");
      return;
    }

    const isBlocked =
      NON_SUPER_BLOCKED_ROUTES.some((blocked) => path === blocked || path.startsWith(blocked + "/")) ||
      (!NON_SUPER_ALLOWED_ROUTES.has(path) && !(canSeeContainers && path === "/containers"));

    if (isBlocked) router.replace("/");
  }, [currentUser, isSuperAdmin, isLead, isBuildingManager, router, canSeeContainers]);

  const [buildingFilter, setBuildingFilter] = useState<string>(() => {
    return isHQ ? "ALL" : userBuilding || "ALL";
  });

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

  const todayStr = new Date().toISOString().slice(0, 10);

  const matchesBuilding = useCallback(
    (obj: LocalRow): boolean => {
      if (buildingFilter === "ALL") return true;
      const b = getObjBuilding(obj);
      return b === buildingFilter;
    },
    [buildingFilter]
  );

  const metrics = useMemo(() => {
    const wf = workforce.filter(matchesBuilding);
    const term = terminations.filter(matchesBuilding);
    const dmg = damageReports.filter(matchesBuilding);
    const startup = startupChecklists.filter(matchesBuilding);
    const chatAll = chats.filter(matchesBuilding);
    const contAll = containers.filter(matchesBuilding);
    const wo = workOrders.filter(matchesBuilding);

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

    const startupToday = startup.filter((r) => getString(r, "date") === todayStr);
    const startupTodayTotal = startupToday.length;

    const startupTodayCompleted = startupToday.filter((r) => {
      const vals = getBoolRecordValues(r.items);
      return vals.length > 0 && vals.every(Boolean);
    }).length;

    const chatsToday = chatAll.filter((m) => getString(m, "createdAt").startsWith(todayStr));
    const chatsTodayCount = chatsToday.length;

    // Containers & throughput
    const containersTotal = contAll.length;
    const workOrdersTotal = wo.length;
    const workOrdersOpen = wo.filter((item) => {
      const s = getString(item, "status");
      return s === "Pending" || s === "Active";
    }).length;

    const contToday = contAll.filter((c) => getString(c, "createdAt").startsWith(todayStr));

    const containersToday = contToday.length;
    const piecesToday = contToday.reduce<number>((sum, c) => sum + getNumber(c, "piecesTotal"), 0);

    const minutesToday = contToday.reduce<number>((sum, c) => sum + getWorkersMinutes(c), 0);

    const pphToday = minutesToday === 0 ? 0 : (piecesToday * 60) / minutesToday;

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
      containersTotal,
      workOrdersTotal,
      workOrdersOpen,
      containersToday,
      piecesToday,
      minutesToday,
      pphToday,
    };
  }, [
    workforce,
    terminations,
    damageReports,
    startupChecklists,
    chats,
    containers,
    workOrders,
    todayStr,
    matchesBuilding,
  ]);

  const buildingLabel = buildingFilter === "ALL" ? "All Buildings" : buildingFilter;

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
                Enter containers <span className="text-sky-300 font-semibold">inside Work Orders</span> to avoid
                duplicates.
              </div>
              <Link
                href="/work-orders"
                className="mt-2 inline-flex items-center gap-2 rounded-lg bg-sky-600 hover:bg-sky-500 px-3 py-1.5 text-[11px] text-white font-medium"
              >
                Go to Work Orders →
              </Link>

              {/* ✅ NEW: Worker History quick link */}
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
                <span className="text-sky-300 font-semibold">{currentUser.building}</span>.
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

                {/* ✅ NEW */}
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

                {/* ✅ Containers shortcut hidden for Leads + Building Managers */}
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

                {/* ✅ NEW */}
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

              {/* ✅ Hide Containers nav for Leads + Building Managers */}
              {canSeeContainers && <NavItem href="/containers">Containers</NavItem>}

              {/* ✅ Workforce nav ONLY for Building Managers (and Super Admin if you want) */}
              {canSeeWorkforce && <NavItem href="/workforce">Workforce</NavItem>}

              {/* ✅ Injury Report visible to everyone */}
              <NavItem href="/injury-report">Injury Report</NavItem>

              {/* ✅ NEW: Worker History visible to everyone */}
              {canSeeWorkerHistory && <NavItem href="/worker-history">Worker History</NavItem>}

              <div className="pt-2 mt-2 border-t border-slate-800/80">
                <div className="text-[10px] uppercase tracking-wide text-slate-600 mb-2">Operations</div>
                <NavItem href="/damage-reports">Damage Reports</NavItem>
                <NavItem href="/startup-checklists">Startup Meetings</NavItem>
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
          <div className="flex flex-col gap-3">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold text-slate-50">Dashboard</h1>
                <p className="text-sm text-slate-400">
                  Live overview across <span className="font-semibold text-sky-300">{buildingLabel}</span>.
                </p>

                {(isLead || isBuildingManager) && currentUser.building && (
                  <p className="text-[11px] text-slate-500">
                    Access is restricted to{" "}
                    <span className="font-semibold text-sky-300">{currentUser.building}</span>.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Pill>
                  Today: <span className="font-mono text-slate-200">{todayStr}</span>
                </Pill>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500">View:</span>
                  <select
                    className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-50 shadow-sm shadow-slate-900/50"
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
              </div>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <ActionCard
                title="Enter Work"
                desc={isLead ? "Add containers inside a work order (recommended)." : "Create work orders and add containers."}
                href="/work-orders"
                cta="Open Work Orders →"
              />

              {/* ✅ Containers action card removed for Building Managers + Leads */}
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

              {/* Injury Report */}
              <ActionCard
                title="Injury Report"
                desc="Report injuries, attach documents, and print forms for signatures."
                href="/injury-report"
                cta="Open Injury Report →"
              />
            </div>

            {/* ✅ NEW row: Worker History action card */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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

          {/* Two-column content */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Left */}
            <Panel className="xl:col-span-1 space-y-4">
              <div className="flex items-end justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">Operations Snapshot</h2>
                  <p className="text-[11px] text-slate-500">Containers • Work Orders • Throughput</p>
                </div>
                <Pill subtle>{buildingLabel}</Pill>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <MiniStat
                  title="Work Orders (Open)"
                  value={`${metrics.workOrdersOpen}`}
                  sub={`Total: ${metrics.workOrdersTotal}`}
                  href="/work-orders"
                  link="Go to Work Orders →"
                />

                {/* ✅ Never link to /containers for Leads or Building Managers */}
                <MiniStat
                  title="Total Containers"
                  value={`${metrics.containersTotal}`}
                  sub={`Today: ${metrics.containersToday} · Pieces: ${metrics.piecesToday}`}
                  href="/work-orders"
                  link="Go to Work Orders →"
                />

                <MiniStat
                  title="Throughput Today"
                  value={`${metrics.pphToday.toFixed(1)} PPH`}
                  sub={`Minutes logged: ${metrics.minutesToday}`}
                  href={isSuperAdmin ? "/reports" : "/"}
                  link="See details →"
                />

                <MiniStat
                  title="Startup Meetings Today"
                  value={`${metrics.startupTodayCompleted}/${metrics.startupTodayTotal} completed`}
                  sub={buildingLabel}
                  href="/startup-checklists"
                  link="View Checklists →"
                />
              </div>
            </Panel>

            {/* Right */}
            <Panel className="xl:col-span-2 space-y-4">
              <div className="flex items-end justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">People & Compliance</h2>
                  <p className="text-[11px] text-slate-500">Workforce · Training · HR</p>
                </div>
                <div className="hidden md:flex gap-2">
                  <Pill subtle>Active: {metrics.activeWorkers}</Pill>
                  <Pill subtle>Open Damage: {metrics.openDamageReports}</Pill>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <MiniCard>
                  <div className="text-slate-300 mb-1 font-semibold">Workforce</div>
                  <div className="text-slate-400">
                    Active: <span className="text-emerald-300">{metrics.activeWorkers}</span>
                  </div>
                  <div className="text-slate-400">
                    Total: <span className="text-slate-100">{metrics.totalWorkers}</span>
                  </div>
                  {canSeeWorkforce && (
                    <Link href="/workforce" className="mt-2 inline-block text-[11px] text-sky-300 hover:underline">
                      Manage Workforce →
                    </Link>
                  )}
                </MiniCard>

                <MiniCard>
                  <div className="text-slate-300 mb-1 font-semibold">Terminations</div>
                  <div className="text-slate-400">
                    In Progress: <span className="text-rose-300">{metrics.termInProgress}</span>
                  </div>
                  <div className="text-slate-400">
                    Completed: <span className="text-emerald-300">{metrics.termCompleted}</span>
                  </div>
                  {isSuperAdmin && (
                    <Link href="/terminations" className="mt-2 inline-block text-[11px] text-sky-300 hover:underline">
                      View Terminations →
                    </Link>
                  )}
                </MiniCard>

                <MiniCard>
                  <div className="text-slate-300 mb-1 font-semibold">Training</div>
                  <div className="text-slate-400">Compliance matrix + readiness.</div>
                  <Link href="/training" className="mt-2 inline-block text-[11px] text-sky-300 hover:underline">
                    Go to Training →
                  </Link>
                </MiniCard>
              </div>

              <MiniCard>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-slate-300 mb-1 font-semibold">Injury Reporting</div>
                    <div className="text-slate-400 text-[11px] leading-relaxed">
                      Report incidents, upload documents, and print signature forms — scoped by building.
                    </div>
                  </div>
                  <Link href="/injury-report" className="text-[11px] text-sky-300 hover:underline shrink-0">
                    Open →
                  </Link>
                </div>
              </MiniCard>

              {/* ✅ NEW: Worker History card */}
              <MiniCard>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-slate-300 mb-1 font-semibold">Worker History</div>
                    <div className="text-slate-400 text-[11px] leading-relaxed">
                      View each worker’s containers and earnings breakdown (read-only).
                    </div>
                  </div>
                  <Link href="/worker-history" className="text-[11px] text-sky-300 hover:underline shrink-0">
                    Open →
                  </Link>
                </div>
              </MiniCard>

              <MiniCard>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-slate-300 mb-1 font-semibold">Quality & Damage</div>
                    <div className="text-slate-400 text-[11px] leading-relaxed">
                      Open/Review: <span className="text-amber-300">{metrics.openDamageReports}</span> · Total:{" "}
                      <span className="text-slate-100">{metrics.totalDamageReports}</span> · Avg Damage:{" "}
                      <span className="text-amber-300">{metrics.avgDamagePercent}%</span>
                    </div>
                  </div>
                  <Link href="/damage-reports" className="text-[11px] text-sky-300 hover:underline shrink-0">
                    Open →
                  </Link>
                </div>
              </MiniCard>
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
  return (
    <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 shadow-sm shadow-slate-900/40">
      {children}
    </div>
  );
}

function ActionCard({ title, desc, href, cta }: { title: string; desc: string; href: string; cta: string }) {
  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm shadow-slate-900/40">
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
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm shadow-slate-900/50 hover:shadow-lg hover:shadow-slate-900/70 transition-shadow">
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

function MiniStat({
  title,
  value,
  sub,
  href,
  link,
}: {
  title: string;
  value: string;
  sub: string;
  href: string;
  link: string;
}) {
  return (
    <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 shadow-sm shadow-slate-900/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] text-slate-400">{title}</div>
          <div className="mt-1 text-lg font-semibold text-slate-100">{value}</div>
          <div className="mt-1 text-[11px] text-slate-500">{sub}</div>
        </div>
        <Link href={href} className="text-[11px] text-sky-300 hover:underline shrink-0">
          {link}
        </Link>
      </div>
    </div>
  );
}

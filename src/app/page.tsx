"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/lib/useCurrentUser";

const WORKFORCE_KEY = "precisionpulse_workforce";
const TERMINATIONS_KEY = "precisionpulse_terminations";
const DAMAGE_KEY = "precisionpulse_damage_reports";
const STARTUP_KEY = "precisionpulse_startup_checklists";
const CHATS_KEY = "precisionpulse_chats";
const CONTAINERS_KEY = "precisionpulse_containers";
const WORK_ORDERS_KEY = "precisionpulse_work_orders";

const BUILDINGS = ["ALL", "DC1", "DC5", "DC11", "DC14", "DC18"];

type ContainerWorker = {
  minutesWorked?: number;
};

type ContainerRecord = {
  building?: string;
  createdAt?: string;
  piecesTotal?: number;
  workers?: ContainerWorker[];
};

export default function Page() {
  const router = useRouter();
  const currentUser = useCurrentUser(); // redirects to /auth if not logged in

  const [buildingFilter, setBuildingFilter] = useState<string>("ALL");

  const [workforce, setWorkforce] = useState<any[]>([]);
  const [terminations, setTerminations] = useState<any[]>([]);
  const [damageReports, setDamageReports] = useState<any[]>([]);
  const [startupChecklists, setStartupChecklists] = useState<any[]>([]);
  const [chats, setChats] = useState<any[]>([]);
  const [containers, setContainers] = useState<any[]>([]);
  const [workOrders, setWorkOrders] = useState<any[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(WORKFORCE_KEY);
      if (raw) setWorkforce(JSON.parse(raw));
    } catch (e) {
      console.error("Failed to load workforce", e);
    }

    try {
      const raw = window.localStorage.getItem(TERMINATIONS_KEY);
      if (raw) setTerminations(JSON.parse(raw));
    } catch (e) {
      console.error("Failed to load terminations", e);
    }

    try {
      const raw = window.localStorage.getItem(DAMAGE_KEY);
      if (raw) setDamageReports(JSON.parse(raw));
    } catch (e) {
      console.error("Failed to load damage reports", e);
    }

    try {
      const raw = window.localStorage.getItem(STARTUP_KEY);
      if (raw) setStartupChecklists(JSON.parse(raw));
    } catch (e) {
      console.error("Failed to load startup checklists", e);
    }

    try {
      const raw = window.localStorage.getItem(CHATS_KEY);
      if (raw) setChats(JSON.parse(raw));
    } catch (e) {
      console.error("Failed to load chats", e);
    }

    try {
      const raw = window.localStorage.getItem(CONTAINERS_KEY);
      if (raw) setContainers(JSON.parse(raw));
    } catch (e) {
      console.error("Failed to load containers", e);
    }

    try {
      const raw = window.localStorage.getItem(WORK_ORDERS_KEY);
      if (raw) setWorkOrders(JSON.parse(raw));
    } catch (e) {
      console.error("Failed to load work orders", e);
    }
  }, []);

  const todayStr = new Date().toISOString().slice(0, 10);

  function matchesBuilding(obj: any): boolean {
    if (buildingFilter === "ALL") return true;
    const b =
      obj?.building ||
      obj?.assignedBuilding ||
      obj?.homeBuilding ||
      obj?.buildingCode;
    return b === buildingFilter;
  }

  const metrics = useMemo(() => {
    const wf = workforce.filter(matchesBuilding);
    const term = terminations.filter(matchesBuilding);
    const dmg = damageReports.filter(matchesBuilding);
    const startup = startupChecklists.filter(matchesBuilding);
    const chatAll = chats.filter(matchesBuilding);
    const contAll = containers.filter(matchesBuilding);
    const wo = workOrders.filter(matchesBuilding);

    const totalWorkers = wf.length;
    const activeWorkers = wf.filter((w) => w.status === "Active").length;

    function checklistProgress(c: any) {
      if (!c) return { total: 0, done: 0 };
      const vals = Object.values(c) as boolean[];
      const total = vals.length;
      const done = vals.filter(Boolean).length;
      return { total, done };
    }

    function terminationStatus(t: any) {
      const { total, done } = checklistProgress(t.checklist);
      return total > 0 && done === total ? "Completed" : "In Progress";
    }

    const termInProgress = term.filter(
      (t) => terminationStatus(t) === "In Progress"
    ).length;
    const termCompleted = term.length - termInProgress;

    const totalDamageReports = dmg.length;
    const openDamageReports = dmg.filter(
      (r) => r.status === "Open" || r.status === "In Review"
    ).length;
    const totalPiecesDamage = dmg.reduce(
      (sum, r) => sum + (r.piecesTotal || 0),
      0
    );
    const totalDamaged = dmg.reduce(
      (sum, r) => sum + (r.piecesDamaged || 0),
      0
    );
    const avgDamagePercent =
      totalPiecesDamage === 0
        ? 0
        : Math.round((totalDamaged / totalPiecesDamage) * 100);

    const startupToday = startup.filter((r) => r.date === todayStr);
    const startupTodayTotal = startupToday.length;
    const startupTodayCompleted = startupToday.filter((r) => {
      const items = r.items || {};
      const vals = Object.values(items) as boolean[];
      return vals.length > 0 && vals.every(Boolean);
    }).length;

    const chatsToday = chatAll.filter((m) =>
      (m.createdAt || "").startsWith(todayStr)
    );
    const chatsTodayCount = chatsToday.length;

    // Containers & throughput
    const containersTotal = contAll.length;
    const workOrdersTotal = wo.length;
    const workOrdersOpen = wo.filter(
      (item) => item.status === "Pending" || item.status === "Active"
    ).length;

    const contToday = contAll.filter((c: ContainerRecord) =>
      (c.createdAt || "").startsWith(todayStr)
    );

    const containersToday = contToday.length;
    const piecesToday = contToday.reduce(
      (sum: number, c: ContainerRecord) => sum + (c.piecesTotal || 0),
      0
    );

    const minutesToday = contToday.reduce(
      (outerSum: number, c: ContainerRecord) => {
        const wArr = c.workers || [];
        const m = wArr.reduce(
          (inner, w) => inner + (w.minutesWorked || 0),
          0
        );
        return outerSum + m;
      },
      0
    );

    const pphToday =
      minutesToday === 0 ? 0 : (piecesToday * 60) / minutesToday;

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
    buildingFilter,
  ]);

  const buildingLabel =
    buildingFilter === "ALL" ? "All Buildings" : buildingFilter;

  function handleLogout() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("precisionpulse_currentUser");
    }
    router.push("/auth");
  }

  // While useCurrentUser is redirecting, don't flash the dashboard
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
        <aside className="w-64 border-r border-slate-800 bg-slate-950/80 p-4 flex flex-col gap-4 backdrop-blur-sm">
          <div>
            <div className="text-xs font-semibold text-sky-300 tracking-wide">
              Precision Pulse
            </div>
            <div className="text-lg font-semibold text-slate-50">
              3PL Operations
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Enterprise LMS / WMS spine for containers & workforce.
            </div>
          </div>

                    <nav className="space-y-1 text-sm">
            <Link
              href="/"
              className="block px-3 py-2 rounded-lg bg-slate-900 text-slate-50 shadow-sm shadow-slate-900/60 border border-slate-800 transition-colors"
            >
              Dashboard
            </Link>
            <Link
              href="/containers"
              className="block px-3 py-2 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-sky-200 transition-colors"
            >
              Containers
            </Link>
            <Link
              href="/work-orders"
              className="block px-3 py-2 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-sky-200 transition-colors"
            >
              Work Orders
            </Link>
            <Link
              href="/shifts"
              className="block px-3 py-2 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-sky-200 transition-colors"
            >
              Shifts
            </Link>
            <Link
              href="/staffing"
              className="block px-3 py-2 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-sky-200 transition-colors"
            >
              Staffing Coverage
            </Link>
            <Link
              href="/workforce"
              className="block px-3 py-2 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-sky-200 transition-colors"
            >
              Workforce
            </Link>
            <Link
              href="/hiring"
              className="block px-3 py-2 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-sky-200 transition-colors"
            >
              Hiring
            </Link>
            <Link
              href="/training"
              className="block px-3 py-2 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-sky-200 transition-colors"
            >
              Training
            </Link>
            <Link
              href="/terminations"
              className="block px-3 py-2 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-sky-200 transition-colors"
            >
              Terminations
            </Link>
            <Link
              href="/damage-reports"
              className="block px-3 py-2 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-sky-200 transition-colors"
            >
              Damage Reports
            </Link>
            <Link
              href="/startup-checklists"
              className="block px-3 py-2 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-sky-200 transition-colors"
            >
              Startup Meetings
            </Link>
            <Link
              href="/chats"
              className="block px-3 py-2 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-sky-200 transition-colors"
            >
              Chats
            </Link>
            <Link
              href="/reports"
              className="block px-3 py-2 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-sky-200 transition-colors"
            >
              Reports
            </Link>
            <Link
              href="/admin"
              className="block px-3 py-2 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-sky-200 transition-colors"
            >
              Admin / Backup
            </Link>
              {currentUser.accessRole === "Super Admin" && (
  <Link
    href="/user-accounts"
    className="block px-3 py-2 rounded-lg text-slate-200 hover:bg-slate-800 hover:text-sky-200 transition-colors border border-slate-700/80"
  >
    User Accounts
  </Link>
)}
          </nav>
        </aside>

        {/* MAIN DASHBOARD */}
        <main className="flex-1 p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-50">
                Precision Pulse Dashboard
              </h1>
              <p className="text-sm text-slate-400">
                Live overview of workforce, containers, damage, and HR
                workflows across{" "}
                <span className="font-semibold text-sky-300">
                  {buildingLabel}
                </span>
                .
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-[11px] text-slate-300">
                    {currentUser.name}{" "}
                    {currentUser.accessRole && (
                      <span className="ml-1 inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-sky-200">
                        {currentUser.accessRole}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {currentUser.email} ·{" "}
                    {currentUser.building || "No building set"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="text-[11px] px-3 py-1.5 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                >
                  Log out
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500">
                  View:
                </span>
                <select
                  className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-50 shadow-sm shadow-slate-900/50"
                  value={buildingFilter}
                  onChange={(e) => setBuildingFilter(e.target.value)}
                >
                  {BUILDINGS.map((b) => (
                    <option key={b} value={b}>
                      {b === "ALL" ? "All Buildings" : b}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-slate-500">
                  Today:{" "}
                  <span className="text-slate-200 font-mono">
                    {todayStr}
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Quick Actions row */}
          <div className="flex flex-wrap gap-2 text-xs">
            <QuickLink
              href="/containers"
              label="Containers"
              sub="Enter volume & lumpers"
            />
            <QuickLink
              href="/staffing"
              label="Staffing Coverage"
              sub="Required vs actual"
            />
            <QuickLink
              href="/reports"
              label="Reports"
              sub="Pay · PPH · Leaders"
            />
            <QuickLink
              href="/workforce"
              label="Workforce"
              sub="Roster & roles"
            />
            <QuickLink
              href="/training"
              label="Training"
              sub="Compliance matrix"
            />
          </div>

          {/* Top KPI row */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <CardKpi>
              <div className="text-xs text-slate-400 mb-1">
                Active Workforce
              </div>
              <div className="text-2xl font-semibold text-emerald-300">
                {metrics.activeWorkers}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Total workers: {metrics.totalWorkers}
              </div>
              <Link
                href="/workforce"
                className="mt-3 inline-block text-[11px] text-sky-300 hover:underline"
              >
                View Workforce →
              </Link>
            </CardKpi>

            <CardKpi>
              <div className="text-xs text-slate-400 mb-1">
                Open Damage Reports
              </div>
              <div className="text-2xl font-semibold text-amber-300">
                {metrics.openDamageReports}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Average damage: {metrics.avgDamagePercent}%
              </div>
              <Link
                href="/damage-reports"
                className="mt-3 inline-block text-[11px] text-sky-300 hover:underline"
              >
                View Damage →
              </Link>
            </CardKpi>

            <CardKpi>
              <div className="text-xs text-slate-400 mb-1">
                Terminations In Progress
              </div>
              <div className="text-2xl font-semibold text-rose-300">
                {metrics.termInProgress}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Completed: {metrics.termCompleted}
              </div>
              <Link
                href="/terminations"
                className="mt-3 inline-block text-[11px] text-sky-300 hover:underline"
              >
                View Terminations →
              </Link>
            </CardKpi>

            <CardKpi>
              <div className="text-xs text-slate-400 mb-1">
                Chat Activity Today
              </div>
              <div className="text-2xl font-semibold text-sky-300">
                {metrics.chatsTodayCount}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Messages in {buildingLabel}
              </div>
              <Link
                href="/chats"
                className="mt-3 inline-block text-[11px] text-sky-300 hover:underline"
              >
                Open Chats →
              </Link>
            </CardKpi>
          </div>

          {/* Second row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Operations snapshot */}
            <CardPanel className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-100">
                  Operations Snapshot
                </h2>
                <span className="text-[11px] text-slate-500">
                  Containers · Work Orders · Throughput
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 text-sm">
                <CardMini>
                  <div className="text-[11px] text-slate-400 mb-1">
                    Total Containers
                  </div>
                  <div className="text-lg font-semibold text-slate-100">
                    {metrics.containersTotal}
                  </div>
                  <Link
                    href="/containers"
                    className="text-[11px] text-sky-300 hover:underline"
                  >
                    Go to Containers →
                  </Link>
                </CardMini>
                <CardMini>
                  <div className="text-[11px] text-slate-400 mb-1">
                    Work Orders (Open)
                  </div>
                  <div className="text-lg font-semibold text-emerald-300">
                    {metrics.workOrdersOpen}
                  </div>
                  <div className="text-[11px] text-slate-500 mb-1">
                    Total: {metrics.workOrdersTotal}
                  </div>
                  <Link
                    href="/work-orders"
                    className="text-[11px] text-sky-300 hover:underline"
                  >
                    Go to Work Orders →
                  </Link>
                </CardMini>
                <CardMini>
                  <div className="text-[11px] text-slate-400 mb-1">
                    Containers Today
                  </div>
                  <div className="text-lg font-semibold text-sky-300">
                    {metrics.containersToday}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Pieces today:{" "}
                    <span className="text-slate-100">
                      {metrics.piecesToday}
                    </span>
                  </div>
                </CardMini>
              </div>

              <CardMini>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-slate-300 mb-1 text-xs">
                      Throughput (Today)
                    </div>
                    <div className="text-[11px] text-slate-400">
                      PPH:{" "}
                      <span className="text-sky-300 font-semibold">
                        {metrics.pphToday.toFixed(1)}
                      </span>{" "}
                      · Minutes logged:{" "}
                      <span className="text-slate-100">
                        {metrics.minutesToday}
                      </span>
                    </div>
                  </div>
                  <Link
                    href="/reports"
                    className="text-[11px] text-sky-300 hover:underline"
                  >
                    See details →
                  </Link>
                </div>
              </CardMini>

              <CardMini>
                <div className="text-slate-300 mb-1 text-xs">
                  Startup Meetings Today
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-slate-100 text-sm font-semibold">
                      {metrics.startupTodayCompleted}/
                      {metrics.startupTodayTotal} completed
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {buildingLabel}
                    </div>
                  </div>
                  <Link
                    href="/startup-checklists"
                    className="text-[11px] text-sky-300 hover:underline"
                  >
                    View Checklists →
                  </Link>
                </div>
              </CardMini>
            </CardPanel>

            {/* People & Compliance */}
            <CardPanel className="space-y-4 lg:col-span-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-100">
                  People & Compliance
                </h2>
                <span className="text-[11px] text-slate-500">
                  Workforce · Training · HR
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <CardMini>
                  <div className="text-slate-300 mb-1">
                    Workforce Overview
                  </div>
                  <div className="text-slate-400">
                    Active:{" "}
                    <span className="text-emerald-300">
                      {metrics.activeWorkers}
                    </span>
                  </div>
                  <div className="text-slate-400">
                    Total:{" "}
                    <span className="text-slate-100">
                      {metrics.totalWorkers}
                    </span>
                  </div>
                  <Link
                    href="/workforce"
                    className="mt-2 inline-block text-[11px] text-sky-300 hover:underline"
                  >
                    Manage Workforce →
                  </Link>
                </CardMini>

                <CardMini>
                  <div className="text-slate-300 mb-1">
                    Termination Workflows
                  </div>
                  <div className="text-slate-400">
                    In Progress:{" "}
                    <span className="text-rose-300">
                      {metrics.termInProgress}
                    </span>
                  </div>
                  <div className="text-slate-400">
                    Completed:{" "}
                    <span className="text-emerald-300">
                      {metrics.termCompleted}
                    </span>
                  </div>
                  <Link
                    href="/terminations"
                    className="mt-2 inline-block text-[11px] text-sky-300 hover:underline"
                  >
                    View Terminations →
                  </Link>
                </CardMini>

                <CardMini>
                  <div className="text-slate-300 mb-1">
                    Training & Readiness
                  </div>
                  <div className="text-slate-400">
                    (Hook to Training data later)
                  </div>
                  <Link
                    href="/training"
                    className="mt-2 inline-block text-[11px] text-sky-300 hover:underline"
                  >
                    Go to Training →
                  </Link>
                </CardMini>
              </div>

              <CardMini>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-slate-300 mb-1">
                      Quality & Damage
                    </div>
                    <div className="text-slate-400">
                      Open/Review:{" "}
                      <span className="text-amber-300">
                        {metrics.openDamageReports}
                      </span>{" "}
                      · Total:{" "}
                      <span className="text-slate-100">
                        {metrics.totalDamageReports}
                      </span>{" "}
                      · Avg Damage:{" "}
                      <span className="text-amber-300">
                        {metrics.avgDamagePercent}%
                      </span>
                    </div>
                  </div>
                  <Link
                    href="/damage-reports"
                    className="text-[11px] text-sky-300 hover:underline"
                  >
                    Open Damage Reports →
                  </Link>
                </div>
              </CardMini>
            </CardPanel>
          </div>
        </main>
      </div>
    </div>
  );
}

/** Small components just for nicer styling & less repetition */

function CardKpi({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm shadow-slate-900/50 transition-transform transition-shadow duration-150 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/70">
      {children}
    </div>
  );
}

function CardPanel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-slate-900/95 border border-slate-800 rounded-2xl p-6 shadow-sm shadow-slate-900/50 transition-transform transition-shadow duration-150 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/70 ${className}`}
    >
      {children}
    </div>
  );
}

function CardMini({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 shadow-sm shadow-slate-900/40 transition-transform duration-150 hover:-translate-y-0.5">
      {children}
    </div>
  );
}

function QuickLink({
  href,
  label,
  sub,
}: {
  href: string;
  label: string;
  sub: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-800 bg-slate-950/80 text-[11px] text-slate-200 hover:border-sky-500 hover:bg-slate-900/90 hover:text-sky-200 transition-colors shadow-sm shadow-slate-900/40"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      <span className="font-medium">{label}</span>
      <span className="text-[10px] text-slate-500">{sub}</span>
    </Link>
  );
}

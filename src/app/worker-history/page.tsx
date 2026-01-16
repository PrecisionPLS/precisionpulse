"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { BUILDINGS } from "@/lib/buildings";

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

function dateShort(d: string | null, fallbackISO: string) {
  const base = d ? String(d).slice(0, 10) : String(fallbackISO).slice(0, 10);
  return base;
}

export default function WorkerHistoryPage() {
  const currentUser = useCurrentUser();

  const role = currentUser?.accessRole || "";
  const isLead = role === "Lead";
  const isBuildingManager = role === "Building Manager";

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
  const [buildingFilter, setBuildingFilter] = useState<string>(() => (isScoped ? scopedBuilding : "ALL"));

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

      const mapped = ((data as any[]) || [])
        .map((r) => mapWorkforceRow(r))
        .filter((w) => w.fullName && w.fullName !== "Unknown" && w.active !== false);

      setWorkforce(mapped);
    } catch (e: any) {
      setError(`Failed to load workforce: ${e?.message || "Unknown error"}`);
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

      // additional building filter for HQ users
      if (!isScoped && buildingFilter !== "ALL") q = q.eq("building", buildingFilter);

      const { data, error } = await q;
      if (error) throw error;

      const rows: ContainerRow[] =
        ((data as any[]) || []).map((row) => ({
          ...row,
          workers: Array.isArray(row.workers) ? row.workers : [],
          work_order_id: row.work_order_id ?? null,
          palletized: row.palletized ?? null,
          shift: row.shift ?? null,
          work_date: row.work_date ?? null,
        })) ?? [];

      setContainers(rows);
    } catch (e: any) {
      setError(`Failed to load containers: ${e?.message || "Unknown error"}`);
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

    // extra filter (for HQ users)
    if (!isScoped && buildingFilter !== "ALL") {
      list = list.filter((w) => !w.building || w.building === buildingFilter);
    }

    if (!q) return list.slice(0, 200);

    return list
      .filter((w) => w.fullName.toLowerCase().includes(q))
      .slice(0, 200);
  }, [workforce, search, isScoped, buildingFilter]);

  // Build “ledger” for the selected worker:
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

      lines.push({
        containerId: c.id,
        date: dateShort(c.work_date, c.created_at),
        building: c.building,
        shift: c.shift ?? "—",
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
  }, [containers, selectedWorkerName]);

  const selectedTotals = useMemo(() => {
    const totalContainers = selectedWorkerLines.length;
    const totalPayout = selectedWorkerLines.reduce((sum, r) => sum + (r.payout || 0), 0);
    const totalMinutes = selectedWorkerLines.reduce((sum, r) => sum + (r.minutes || 0), 0);
    const totalPieces = selectedWorkerLines.reduce((sum, r) => sum + (r.pieces || 0), 0);
    return { totalContainers, totalPayout, totalMinutes, totalPieces };
  }, [selectedWorkerLines]);

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

                <div className="flex items-center justify-between">
                  <div className="text-[11px] text-slate-500">Building</div>
                  <select
                    className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-[12px] text-slate-50"
                    value={buildingFilter}
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
                  Showing {filteredWorkers.length} (max 200). Uses containers table for earnings.
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: selected worker detail */}
          <div className="lg:col-span-8 space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              {!selectedWorkerName ? (
                <div className="text-[12px] text-slate-400">
                  Select a worker on the left to view their container history.
                </div>
              ) : (
                <>
                  <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-100">{selectedWorkerName}</div>
                      <div className="text-[11px] text-slate-400">
                        Totals based on the worker’s entries inside each container’s <span className="text-slate-200">workers[]</span> array.
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-[11px]">
                      <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-slate-200">
                        Containers: <span className="ml-1 font-semibold text-sky-300">{selectedTotals.totalContainers}</span>
                      </span>
                      <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-slate-200">
                        Earnings: <span className="ml-1 font-semibold text-emerald-300">{money(selectedTotals.totalPayout)}</span>
                      </span>
                      <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-slate-200">
                        Minutes: <span className="ml-1 font-semibold text-slate-100">{selectedTotals.totalMinutes}</span>
                      </span>
                      <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-slate-200">
                        Pieces: <span className="ml-1 font-semibold text-slate-100">{selectedTotals.totalPieces}</span>
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
                              No containers found for this worker yet.
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

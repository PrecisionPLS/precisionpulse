"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const DAMAGE_STORAGE_KEY = "precisionpulse_damage_reports";

const BUILDINGS = ["DC1", "DC5", "DC11", "DC14", "DC18"];
const SHIFTS = ["1st", "2nd", "3rd", "4th"];

type DamageStatus = "Open" | "In Review" | "Closed";
type DamageType =
  | "Product Damage"
  | "Shortage"
  | "Overage"
  | "Mis-pick"
  | "Pallet / Wrap Issue"
  | "Other";

type Severity = "Minor" | "Moderate" | "Severe";

type DamageReport = {
  id: string;
  building: string;
  shift: string;
  containerNo: string;
  workOrderNo?: string;
  damageType: DamageType;
  severity: Severity;
  piecesDamaged: number;
  piecesTotal: number;
  damagePercent: number;
  reworkPercent?: number;
  description?: string;
  reporterName?: string;
  status: DamageStatus;
  createdAt: string; // ISO
  updatedAt: string; // ISO
};

export default function DamageReportsPage() {
  const [reports, setReports] = useState<DamageReport[]>([]);

  // Form state
  const [building, setBuilding] = useState(BUILDINGS[0]);
  const [shift, setShift] = useState(SHIFTS[0]);
  const [containerNo, setContainerNo] = useState("");
  const [workOrderNo, setWorkOrderNo] = useState("");
  const [damageType, setDamageType] =
    useState<DamageType>("Product Damage");
  const [severity, setSeverity] = useState<Severity>("Moderate");
  const [piecesDamaged, setPiecesDamaged] = useState("");
  const [piecesTotal, setPiecesTotal] = useState("");
  const [reworkPercent, setReworkPercent] = useState("");
  const [description, setDescription] = useState("");
  const [reporterName, setReporterName] = useState("");

  // Filters
  const [filterBuilding, setFilterBuilding] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] =
    useState<DamageStatus | "ALL">("ALL");
  const [filterSeverity, setFilterSeverity] =
    useState<Severity | "ALL">("ALL");

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Load from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DAMAGE_STORAGE_KEY);
      if (raw) {
        setReports(JSON.parse(raw));
      }
    } catch (e) {
      console.error("Failed to load damage reports", e);
    }
  }, []);

  function saveReports(next: DamageReport[]) {
    setReports(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DAMAGE_STORAGE_KEY, JSON.stringify(next));
    }
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!containerNo.trim()) {
      setError("Container number is required.");
      return;
    }

    const damagedNum = piecesDamaged.trim()
      ? Number(piecesDamaged.trim())
      : 0;
    const totalNum = piecesTotal.trim()
      ? Number(piecesTotal.trim())
      : 0;

    if (isNaN(damagedNum) || isNaN(totalNum)) {
      setError("Pieces damaged and total must be numbers.");
      return;
    }
    if (totalNum < 0 || damagedNum < 0) {
      setError("Piece counts cannot be negative.");
      return;
    }
    if (damagedNum > totalNum && totalNum > 0) {
      setError("Pieces damaged cannot be greater than total pieces.");
      return;
    }

    const dmgPercent =
      totalNum === 0 ? 0 : Math.round((damagedNum / totalNum) * 100);

    const reworkNum = reworkPercent.trim()
      ? Number(reworkPercent.trim())
      : undefined;
    if (reworkNum !== undefined && isNaN(reworkNum)) {
      setError("Rework % must be a number or left blank.");
      return;
    }

    const now = new Date().toISOString();

    const newReport: DamageReport = {
      id: `${Date.now()}`,
      building,
      shift,
      containerNo: containerNo.trim(),
      workOrderNo: workOrderNo.trim() || undefined,
      damageType,
      severity,
      piecesDamaged: damagedNum,
      piecesTotal: totalNum,
      damagePercent: dmgPercent,
      reworkPercent:
        reworkNum !== undefined ? Math.max(0, Math.min(100, reworkNum)) : undefined,
      description: description.trim() || undefined,
      reporterName: reporterName.trim() || undefined,
      status: "Open",
      createdAt: now,
      updatedAt: now,
    };

    const next = [newReport, ...reports];
    saveReports(next);

    // Reset form
    setContainerNo("");
    setWorkOrderNo("");
    setPiecesDamaged("");
    setPiecesTotal("");
    setReworkPercent("");
    setDescription("");
    setReporterName("");
    setDamageType("Product Damage");
    setSeverity("Moderate");

    setInfo("Damage report logged as Open.");
  }

  function updateStatus(id: string, newStatus: DamageStatus) {
    const now = new Date().toISOString();
    const next = reports.map((r) =>
      r.id === id ? { ...r, status: newStatus, updatedAt: now } : r
    );
    saveReports(next);
  }

  const summary = useMemo(() => {
    const total = reports.length;
    const open = reports.filter((r) => r.status === "Open").length;
    const inReview = reports.filter(
      (r) => r.status === "In Review"
    ).length;
    const closed = reports.filter((r) => r.status === "Closed").length;

    const totalPieces = reports.reduce(
      (sum, r) => sum + (r.piecesTotal || 0),
      0
    );
    const totalDamaged = reports.reduce(
      (sum, r) => sum + (r.piecesDamaged || 0),
      0
    );
    const avgDamagePercent =
      totalPieces === 0
        ? 0
        : Math.round((totalDamaged / totalPieces) * 100);

    return { total, open, inReview, closed, avgDamagePercent };
  }, [reports]);

  const buildingStats = useMemo(() => {
    const result: Record<
      string,
      { total: number; open: number; closed: number }
    > = {};
    for (const b of BUILDINGS) {
      result[b] = { total: 0, open: 0, closed: 0 };
    }

    for (const r of reports) {
      const b = r.building;
      if (!result[b]) {
        result[b] = { total: 0, open: 0, closed: 0 };
      }
      result[b].total++;
      if (r.status === "Open" || r.status === "In Review") {
        result[b].open++;
      }
      if (r.status === "Closed") {
        result[b].closed++;
      }
    }

    return result;
  }, [reports]);

  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      if (filterBuilding !== "ALL" && r.building !== filterBuilding) {
        return false;
      }
      if (filterStatus !== "ALL" && r.status !== filterStatus) {
        return false;
      }
      if (filterSeverity !== "ALL" && r.severity !== filterSeverity) {
        return false;
      }
      return true;
    });
  }, [reports, filterBuilding, filterStatus, filterSeverity]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">
            Damage & Incident Reports
          </h1>
          <p className="text-sm text-slate-400">
            Log and track damage by building, shift, and container with
            status workflows and damage/rework percentages.
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
          <div className="text-xs text-slate-400 mb-1">Total Reports</div>
          <div className="text-2xl font-semibold text-sky-300">
            {summary.total}
          </div>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">Open</div>
          <div className="text-2xl font-semibold text-amber-300">
            {summary.open}
          </div>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">In Review</div>
          <div className="text-2xl font-semibold text-sky-300">
            {summary.inReview}
          </div>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">Closed</div>
          <div className="text-2xl font-semibold text-emerald-300">
            {summary.closed}
          </div>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">
            Average Damage %
          </div>
          <div className="text-2xl font-semibold text-amber-300">
            {summary.avgDamagePercent}%
          </div>
        </div>
      </div>

      {/* Building stats */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-slate-100 mb-3">
          Building Damage Overview
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
                  Reports:{" "}
                  <span className="text-slate-100">
                    {stats?.total || 0}
                  </span>
                </div>
                <div className="text-slate-400">
                  Open/In Review:{" "}
                  <span className="text-amber-300">
                    {stats?.open || 0}
                  </span>
                </div>
                <div className="text-slate-400">
                  Closed:{" "}
                  <span className="text-emerald-300">
                    {stats?.closed || 0}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Form + List */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create report */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-100">
            Log Damage / Incident
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Container #
                </label>
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
                  value={containerNo}
                  onChange={(e) => setContainerNo(e.target.value)}
                  placeholder="e.g. ABCU1234567"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Work Order # (optional)
                </label>
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
                  value={workOrderNo}
                  onChange={(e) => setWorkOrderNo(e.target.value)}
                  placeholder="e.g. WO-00123"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Damage Type
                </label>
                <select
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
                  value={damageType}
                  onChange={(e) =>
                    setDamageType(e.target.value as DamageType)
                  }
                >
                  <option value="Product Damage">Product Damage</option>
                  <option value="Shortage">Shortage</option>
                  <option value="Overage">Overage</option>
                  <option value="Mis-pick">Mis-pick</option>
                  <option value="Pallet / Wrap Issue">
                    Pallet / Wrap Issue
                  </option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Severity
                </label>
                <select
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
                  value={severity}
                  onChange={(e) =>
                    setSeverity(e.target.value as Severity)
                  }
                >
                  <option value="Minor">Minor</option>
                  <option value="Moderate">Moderate</option>
                  <option value="Severe">Severe</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Pieces Damaged
                </label>
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
                  value={piecesDamaged}
                  onChange={(e) => setPiecesDamaged(e.target.value)}
                  placeholder="e.g. 25"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Total Pieces
                </label>
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
                  value={piecesTotal}
                  onChange={(e) => setPiecesTotal(e.target.value)}
                  placeholder="e.g. 3600"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Rework % (optional)
                </label>
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
                  value={reworkPercent}
                  onChange={(e) => setReworkPercent(e.target.value)}
                  placeholder="e.g. 10"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1">
                Description (optional)
              </label>
              <textarea
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-50"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What happened, location in trailer, photos reference, etc."
              />
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1">
                Reported By (optional)
              </label>
              <input
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
                value={reporterName}
                onChange={(e) => setReporterName(e.target.value)}
                placeholder="e.g. Lead name"
              />
            </div>

            <button
              type="submit"
              className="mt-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-sm font-medium text-white px-4 py-2"
            >
              Log Damage Report
            </button>
          </form>
        </div>

        {/* List / table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 lg:col-span-2">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-100">
              Damage Report List
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
                  setFilterStatus(e.target.value as DamageStatus | "ALL")
                }
              >
                <option value="ALL">All Status</option>
                <option value="Open">Open</option>
                <option value="In Review">In Review</option>
                <option value="Closed">Closed</option>
              </select>
              <select
                className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-slate-50"
                value={filterSeverity}
                onChange={(e) =>
                  setFilterSeverity(e.target.value as Severity | "ALL")
                }
              >
                <option value="ALL">All Severity</option>
                <option value="Minor">Minor</option>
                <option value="Moderate">Moderate</option>
                <option value="Severe">Severe</option>
              </select>
            </div>
          </div>

          {filteredReports.length === 0 ? (
            <p className="text-sm text-slate-500">
              No damage reports match the current filters.
            </p>
          ) : (
            <div className="overflow-x-auto text-xs max-h-[520px] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 pr-3 font-normal">Building</th>
                    <th className="py-2 pr-3 font-normal">Shift</th>
                    <th className="py-2 pr-3 font-normal">Container</th>
                    <th className="py-2 pr-3 font-normal">WO #</th>
                    <th className="py-2 pr-3 font-normal">Type</th>
                    <th className="py-2 pr-3 font-normal">Severity</th>
                    <th className="py-2 pr-3 font-normal">
                      Damaged / Total
                    </th>
                    <th className="py-2 pr-3 font-normal">Damage %</th>
                    <th className="py-2 pr-3 font-normal">Rework %</th>
                    <th className="py-2 pr-3 font-normal">Status</th>
                    <th className="py-2 pr-3 font-normal">Updated</th>
                    <th className="py-2 pr-3 font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReports.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-slate-800 last:border-0 align-top"
                    >
                      <td className="py-2 pr-3 text-slate-300">
                        {r.building}
                      </td>
                      <td className="py-2 pr-3 text-slate-300">
                        {r.shift}
                      </td>
                      <td className="py-2 pr-3 text-slate-100">
                        {r.containerNo}
                      </td>
                      <td className="py-2 pr-3 text-slate-300">
                        {r.workOrderNo || "-"}
                      </td>
                      <td className="py-2 pr-3 text-slate-300">
                        {r.damageType}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={
                            r.severity === "Severe"
                              ? "px-2 py-0.5 rounded-full bg-red-900/60 text-red-200 border border-red-700 text-[11px]"
                              : r.severity === "Moderate"
                              ? "px-2 py-0.5 rounded-full bg-amber-900/60 text-amber-200 border border-amber-700 text-[11px]"
                              : "px-2 py-0.5 rounded-full bg-slate-800 text-slate-100 border border-slate-600 text-[11px]"
                          }
                        >
                          {r.severity}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-slate-300">
                        {r.piecesDamaged}/{r.piecesTotal || 0}
                      </td>
                      <td className="py-2 pr-3 text-amber-300">
                        {r.damagePercent}%
                      </td>
                      <td className="py-2 pr-3 text-slate-300">
                        {r.reworkPercent !== undefined
                          ? `${r.reworkPercent}%`
                          : "-"}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={
                            r.status === "Closed"
                              ? "px-2 py-0.5 rounded-full bg-emerald-900/60 text-emerald-200 border border-emerald-700 text-[11px]"
                              : r.status === "In Review"
                              ? "px-2 py-0.5 rounded-full bg-sky-900/60 text-sky-200 border border-sky-700 text-[11px]"
                              : "px-2 py-0.5 rounded-full bg-amber-900/60 text-amber-200 border border-amber-700 text-[11px]"
                          }
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-slate-400">
                        {r.updatedAt.slice(0, 10)}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-col gap-1">
                          <select
                            className="rounded bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                            value={r.status}
                            onChange={(e) =>
                              updateStatus(
                                r.id,
                                e.target.value as DamageStatus
                              )
                            }
                          >
                            <option value="Open">Open</option>
                            <option value="In Review">In Review</option>
                            <option value="Closed">Closed</option>
                          </select>
                          {r.description && (
                            <div className="text-[11px] text-slate-400 max-w-[260px]">
                              {r.description}
                              {r.reporterName && (
                                <span className="block text-[10px] text-slate-500 mt-1">
                                  Reported by: {r.reporterName}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

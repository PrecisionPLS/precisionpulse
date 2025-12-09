"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";

const DAMAGE_KEY = "precisionpulse_damage_reports";

const BUILDINGS = ["DC1", "DC5", "DC11", "DC14", "DC18"];
const SHIFTS = ["1st", "2nd", "3rd", "4th"];
const STATUS_OPTIONS = ["Open", "In Review", "Closed"];

type DamageReport = {
  id: string;
  building: string;
  shift: string;
  containerNo: string;
  piecesTotal: number;
  piecesDamaged: number;
  status: string;
  reporterName?: string;
  notes?: string;
  createdAt: string;
};

type DamageReportRow = {
  id: string;
  created_at: string;
  building: string | null;
  shift: string | null;
  container_no: string | null;
  pieces_total: number | null;
  pieces_damaged: number | null;
  status: string | null;
  reporter_name: string | null;
  notes: string | null;
};

function rowToDamageReport(row: DamageReportRow): DamageReport {
  return {
    id: String(row.id),
    building: row.building ?? "DC18",
    shift: row.shift ?? "1st",
    containerNo: row.container_no ?? "",
    piecesTotal: row.pieces_total ?? 0,
    piecesDamaged: row.pieces_damaged ?? 0,
    status: row.status ?? "Open",
    reporterName: row.reporter_name ?? "",
    notes: row.notes ?? "",
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

export default function DamageReportsPage() {
  const currentUser = useCurrentUser();

  const [reports, setReports] = useState<DamageReport[]>([]);

  // form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [building, setBuilding] = useState("DC18");
  const [shift, setShift] = useState("1st");
  const [containerNo, setContainerNo] = useState("");
  const [piecesTotal, setPiecesTotal] = useState<string>("");
  const [piecesDamaged, setPiecesDamaged] = useState<string>("");
  const [status, setStatus] = useState("Open");
  const [reporterName, setReporterName] = useState("");
  const [notes, setNotes] = useState("");

  // filters
  const [filterBuilding, setFilterBuilding] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [search, setSearch] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function persist(next: DamageReport[]) {
    setReports(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DAMAGE_KEY, JSON.stringify(next));
    }
  }

  async function refreshFromSupabase() {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    try {
      let query = supabase
  .from("containers")
  .select("*")
  .order("created_at", { ascending: false });

// If this user is a Lead, only show containers for their building
if (currentUser?.accessRole === "Lead" && currentUser.building) {
  query = query.eq("building", currentUser.building);
}

const { data, error } = await query;

      if (error) {
        console.error("Error loading damage reports", error);
        setError("Failed to load damage reports from server.");
        return;
      }

      const rows: DamageReportRow[] = (data || []) as DamageReportRow[];
      const mapped = rows.map(rowToDamageReport);
      persist(mapped);
    } catch (e) {
      console.error("Unexpected error loading damage reports", e);
      setError("Unexpected error loading damage reports.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!currentUser) return;
    refreshFromSupabase();
  }, [currentUser]);

  function resetForm() {
    setEditingId(null);
    setBuilding(currentUser?.building || "DC18");
    setShift("1st");
    setContainerNo("");
    setPiecesTotal("");
    setPiecesDamaged("");
    setStatus("Open");
    setReporterName(currentUser?.name || "");
    setNotes("");
  }

  function handleEdit(report: DamageReport) {
    setEditingId(report.id);
    setBuilding(report.building);
    setShift(report.shift);
    setContainerNo(report.containerNo);
    setPiecesTotal(
      report.piecesTotal != null ? String(report.piecesTotal) : ""
    );
    setPiecesDamaged(
      report.piecesDamaged != null ? String(report.piecesDamaged) : ""
    );
    setStatus(report.status);
    setReporterName(report.reporterName || "");
    setNotes(report.notes || "");
  }

  async function handleDelete(report: DamageReport) {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `Delete damage report for container ${report.containerNo || ""}?`
      );
      if (!ok) return;
    }

    setSaving(true);
    setError(null);

    try {
      const { error } = await supabase
        .from("damage_reports")
        .delete()
        .eq("id", report.id);

      if (error) {
        console.error("Error deleting damage report", error);
        setError("Failed to delete damage report.");
        return;
      }

      await refreshFromSupabase();
      if (editingId === report.id) {
        resetForm();
      }
    } catch (e) {
      console.error("Unexpected error deleting damage report", e);
      setError("Unexpected error deleting damage report.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;

    if (!containerNo.trim()) {
      if (typeof window !== "undefined") {
        window.alert("Please enter a container number.");
      }
      return;
    }

    const totalPieces =
      piecesTotal.trim() === "" ? 0 : Number(piecesTotal);
    const damagedPieces =
      piecesDamaged.trim() === "" ? 0 : Number(piecesDamaged);

    if (Number.isNaN(totalPieces) || Number.isNaN(damagedPieces)) {
      if (typeof window !== "undefined") {
        window.alert(
          "Pieces total and pieces damaged must be numbers (or leave blank)."
        );
      }
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const payload = {
        building,
        shift,
        container_no: containerNo.trim(),
        pieces_total: totalPieces,
        pieces_damaged: damagedPieces,
        status,
        reporter_name: reporterName.trim() || null,
        notes: notes.trim() || null,
      };

      if (editingId) {
        const { error } = await supabase
          .from("damage_reports")
          .update(payload)
          .eq("id", editingId);

        if (error) {
          console.error("Error updating damage report", error);
          setError("Failed to update damage report.");
          return;
        }
      } else {
        const { error } = await supabase
          .from("damage_reports")
          .insert(payload);

        if (error) {
          console.error("Error inserting damage report", error);
          setError("Failed to create damage report.");
          return;
        }
      }

      await refreshFromSupabase();
      resetForm();
    } catch (e) {
      console.error("Unexpected error saving damage report", e);
      setError("Unexpected error saving damage report.");
    } finally {
      setSaving(false);
    }
  }

  const displayedReports = useMemo(() => {
    let rows = [...reports];

    if (filterBuilding !== "ALL") {
      rows = rows.filter((r) => r.building === filterBuilding);
    }
    if (filterStatus !== "ALL") {
      rows = rows.filter((r) => r.status === filterStatus);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          r.containerNo.toLowerCase().includes(q) ||
          (r.reporterName || "").toLowerCase().includes(q) ||
          (r.notes || "").toLowerCase().includes(q)
      );
    }

    return rows;
  }, [reports, filterBuilding, filterStatus, search]);

  const totalReports = reports.length;
  const openReports = reports.filter(
    (r) => r.status === "Open" || r.status === "In Review"
  ).length;

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

  // route protection AFTER hooks
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex flex-col items-center justify-center text-sm gap-2">
        <div>Redirecting to login…</div>
        <a
          href="/auth"
          className="text-sky-400 text-xs underline hover:text-sky-300"
        >
          Click here if you are not redirected.
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50">
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">
              Damage Reports
            </h1>
            <p className="text-sm text-slate-400">
              Track container-level damage, pieces impacted, and workflow
              status across all buildings and shifts.
            </p>
          </div>
          <Link
            href="/"
            className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
            <div className="text-slate-400 mb-1">Total Reports</div>
            <div className="text-2xl font-semibold text-sky-300">
              {totalReports}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Across all buildings
            </div>
          </div>
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
            <div className="text-slate-400 mb-1">Open / In Review</div>
            <div className="text-2xl font-semibold text-amber-300">
              {openReports}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Includes both Open and In Review
            </div>
          </div>
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
            <div className="text-slate-400 mb-1">Average Damage %</div>
            <div className="text-2xl font-semibold text-rose-300">
              {avgDamagePercent}%
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Based on pieces damaged vs total reported
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-rose-700 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-100">
            {error}
          </div>
        )}

        {/* Form + list */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs space-y-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-slate-200 text-sm font-semibold">
                {editingId ? "Edit Damage Report" : "New Damage Report"}
              </div>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-[11px] text-sky-300 hover:underline"
                >
                  Clear / New
                </button>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Building
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
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
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Shift
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
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
                <label className="block text-[11px] text-slate-400 mb-1">
                  Container #
                </label>
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                  placeholder="Container number"
                  value={containerNo}
                  onChange={(e) => setContainerNo(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Pieces Total
                  </label>
                  <input
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    placeholder="e.g. 3600"
                    value={piecesTotal}
                    onChange={(e) => setPiecesTotal(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Pieces Damaged
                  </label>
                  <input
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    placeholder="e.g. 25"
                    value={piecesDamaged}
                    onChange={(e) => setPiecesDamaged(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Status
                </label>
                <select
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Reported By
                </label>
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                  placeholder="Name of person reporting"
                  value={reporterName}
                  onChange={(e) => setReporterName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Notes (optional)
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50 resize-none"
                  placeholder="Describe the damage, photos taken, vendor notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="mt-1 w-full rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-[11px] font-medium text-white px-4 py-2"
              >
                {saving
                  ? "Saving…"
                  : editingId
                  ? "Save Changes"
                  : "Create Damage Report"}
              </button>
            </form>
          </div>

          {/* Filters + table */}
          <div className="lg:col-span-2 space-y-4">
            {/* Filters */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-slate-200 text-sm font-semibold">
                    Filters
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Filter by building, status, or search by container /
                    reporter.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFilterBuilding("ALL");
                    setFilterStatus("ALL");
                    setSearch("");
                  }}
                  className="text-[11px] text-sky-300 hover:underline"
                >
                  Reset
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Building
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={filterBuilding}
                    onChange={(e) =>
                      setFilterBuilding(e.target.value)
                    }
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
                    Status
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={filterStatus}
                    onChange={(e) =>
                      setFilterStatus(e.target.value)
                    }
                  >
                    <option value="ALL">All Statuses</option>
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Search
                  </label>
                  <input
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    placeholder="Container #, reporter, notes..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>

              {loading && (
                <div className="mt-2 text-[11px] text-slate-500">
                  Loading damage reports…
                </div>
              )}
            </div>

            {/* Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
              <div className="flex items-center justify-between mb-2">
                <div className="text-slate-200 text-sm font-semibold">
                  Damage Report List
                </div>
                <div className="text-[11px] text-slate-500">
                  Total:{" "}
                  <span className="font-semibold text-slate-200">
                    {totalReports}
                  </span>{" "}
                  · Showing:{" "}
                  <span className="font-semibold text-slate-200">
                    {displayedReports.length}
                  </span>
                </div>
              </div>

              {displayedReports.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No damage reports match the current filters. Add one on
                  the left or adjust filters.
                </p>
              ) : (
                <div className="overflow-auto max-h-[480px]">
                  <table className="min-w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/60">
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Container
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Building / Shift
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Pieces
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Status
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Reporter
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                          Created
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedReports.map((r) => {
                        const damagePercent =
                          r.piecesTotal === 0
                            ? 0
                            : Math.round(
                                (r.piecesDamaged / r.piecesTotal) * 100
                              );

                        const badgeClass =
                          r.status === "Closed"
                            ? "bg-emerald-900/60 text-emerald-200 border border-emerald-700/70"
                            : r.status === "In Review"
                            ? "bg-amber-900/60 text-amber-200 border border-amber-700/70"
                            : "bg-rose-900/60 text-rose-200 border border-rose-700/70";

                        const createdShort = r.createdAt.slice(0, 10);

                        return (
                          <tr
                            key={r.id}
                            className="border-b border-slate-800/60 hover:bg-slate-900/60"
                          >
                            <td className="px-3 py-2 text-slate-100">
                              <div className="text-xs font-medium">
                                {r.containerNo || "—"}
                              </div>
                              {r.notes && (
                                <div className="text-[11px] text-slate-500 line-clamp-1">
                                  {r.notes}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              {r.building} · {r.shift}
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              <div className="text-[11px]">
                                Total:{" "}
                                <span className="text-slate-100">
                                  {r.piecesTotal}
                                </span>
                              </div>
                              <div className="text-[11px]">
                                Damaged:{" "}
                                <span className="text-rose-300">
                                  {r.piecesDamaged}
                                </span>{" "}
                                ({damagePercent}%)
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={
                                  "inline-flex rounded-full px-2 py-0.5 text-[10px] " +
                                  badgeClass
                                }
                              >
                                {r.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              {r.reporterName || "—"}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-300 font-mono">
                              {createdShort}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="inline-flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleEdit(r)}
                                  className="text-[11px] text-sky-300 hover:underline"
                                  disabled={saving}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(r)}
                                  className="text-[11px] text-rose-300 hover:underline"
                                  disabled={saving}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

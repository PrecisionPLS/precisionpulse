"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";

const BUILDINGS = ["DC1", "DC5", "DC11", "DC14", "DC18"];
const SHIFTS = ["1st", "2nd", "3rd", "4th"];

type StaffingRow = {
  id: string;
  created_at: string;
  date: string;
  building: string;
  shift: string;
  required_total: number | null;
  required_lumpers: number | null;
  required_equipment: number | null;
  required_leads: number | null;
  notes: string | null;
};

type StaffingPlan = {
  id: string;
  createdAt: string;
  date: string; // YYYY-MM-DD
  building: string;
  shift: string;
  requiredTotal: number;
  requiredLumpers: number;
  requiredEquipment: number;
  requiredLeads: number;
  notes?: string;
};

type WorkforceRow = {
  id: string;
  building: string | null;
  status: string | null;
};

type WorkforceSummary = {
  building: string;
  activeCount: number;
};

function rowToPlan(row: StaffingRow): StaffingPlan {
  return {
    id: row.id,
    createdAt: row.created_at ?? new Date().toISOString(),
    date: row.date,
    building: row.building ?? "DC18",
    shift: row.shift ?? "1st",
    requiredTotal: row.required_total ?? 0,
    requiredLumpers: row.required_lumpers ?? 0,
    requiredEquipment: row.required_equipment ?? 0,
    requiredLeads: row.required_leads ?? 0,
    notes: row.notes ?? undefined,
  };
}

export default function StaffingPage() {
  const currentUser = useCurrentUser();
  const isSuperAdmin = currentUser?.accessRole === "Super Admin";
  const isLead = currentUser?.accessRole === "Lead";
  const leadBuilding = currentUser?.building || "";

  const [plans, setPlans] = useState<StaffingPlan[]>([]);
  const [workforceSummary, setWorkforceSummary] = useState<WorkforceSummary[]>(
    []
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [date, setDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [building, setBuilding] = useState<string>("DC18");
  const [shift, setShift] = useState<string>("1st");
  const [requiredTotal, setRequiredTotal] = useState<string>("0");
  const [requiredLumpers, setRequiredLumpers] = useState<string>("0");
  const [requiredEquipment, setRequiredEquipment] = useState<string>("0");
  const [requiredLeads, setRequiredLeads] = useState<string>("0");
  const [notes, setNotes] = useState<string>("");

  // Filters
  const [filterBuilding, setFilterBuilding] = useState<string>("ALL");
  const [filterShift, setFilterShift] = useState<string>("ALL");
  const [filterDateFrom, setFilterDateFrom] = useState<string>("");
  const [filterDateTo, setFilterDateTo] = useState<string>("");

  function resetForm() {
    setEditingId(null);
    setDate(new Date().toISOString().slice(0, 10));
    // For leads, force their building; others default to DC18 / last value
    setBuilding(leadBuilding || "DC18");
    setShift("1st");
    setRequiredTotal("0");
    setRequiredLumpers("0");
    setRequiredEquipment("0");
    setRequiredLeads("0");
    setNotes("");
  }

  async function loadStaffingPlans() {
    setError(null);
    try {
      let query = supabase
        .from("staffing_plans")
        .select("*")
        .order("date", { ascending: true })
        .order("building", { ascending: true })
        .order("shift", { ascending: true });

      // Leads only see staffing plans for their building
      if (isLead && leadBuilding) {
        query = query.eq("building", leadBuilding);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error loading staffing plans", error);
        setError("Failed to load staffing plans from server.");
        return;
      }

      const rows = (data || []) as StaffingRow[];
      setPlans(rows.map(rowToPlan));
    } catch (e) {
      console.error("Unexpected error loading staffing plans", e);
      setError("Unexpected error loading staffing plans.");
    }
  }

  async function loadWorkforceSummary() {
    setError(null);
    try {
      let query = supabase
        .from("workforce")
        .select("id, building, status");

      // Leads only see workforce counts for their own building
      if (isLead && leadBuilding) {
        query = query.eq("building", leadBuilding);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error loading workforce for staffing", error);
        // not fatal, we can still show plans
        return;
      }

      const rows = (data || []) as WorkforceRow[];
      const map: Record<string, number> = {};

      for (const row of rows) {
        const b = row.building ?? "Unknown";
        const status = row.status ?? "";
        if (status !== "Active") continue;
        map[b] = (map[b] ?? 0) + 1;
      }

      const result: WorkforceSummary[] = Object.entries(map).map(
        ([building, activeCount]) => ({
          building,
          activeCount,
        })
      );
      setWorkforceSummary(result);
    } catch (e) {
      console.error("Unexpected error loading workforce for staffing", e);
      // ignore, just means "actual" might be 0
    }
  }

  async function refreshAll() {
    setLoading(true);
    await Promise.all([loadStaffingPlans(), loadWorkforceSummary()]);
    setLoading(false);
  }

  useEffect(() => {
    if (!currentUser) return;
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // Once we know this user is a Lead, force building + filter to their DC
  useEffect(() => {
    if (!currentUser) return;
    if (isLead && leadBuilding) {
      setBuilding((prev) => prev || leadBuilding);
      setFilterBuilding(leadBuilding);
    }
  }, [currentUser, isLead, leadBuilding]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!date.trim()) {
      setError("Date is required.");
      return;
    }

    const rt = Number(requiredTotal || "0");
    const rl = Number(requiredLumpers || "0");
    const re = Number(requiredEquipment || "0");
    const rlead = Number(requiredLeads || "0");

    if ([rt, rl, re, rlead].some((v) => Number.isNaN(v) || v < 0)) {
      setError("Required counts must be non-negative numbers.");
      return;
    }

    try {
      if (editingId) {
        const { error } = await supabase
          .from("staffing_plans")
          .update({
            date,
            building,
            shift,
            required_total: rt,
            required_lumpers: rl,
            required_equipment: re,
            required_leads: rlead,
            notes: notes.trim() || null,
          })
          .eq("id", editingId);

        if (error) {
          console.error("Error updating staffing plan", error);
          setError("Failed to update staffing plan.");
          return;
        }
        setInfo("Staffing plan updated.");
      } else {
        const { error } = await supabase.from("staffing_plans").insert({
          date,
          building,
          shift,
          required_total: rt,
          required_lumpers: rl,
          required_equipment: re,
          required_leads: rlead,
          notes: notes.trim() || null,
        });

        if (error) {
          console.error("Error inserting staffing plan", error);
          setError("Failed to create staffing plan.");
          return;
        }
        setInfo("Staffing plan created.");
      }

      resetForm();
      await refreshAll();
    } catch (e) {
      console.error("Unexpected error saving staffing plan", e);
      setError("Unexpected error saving staffing plan.");
    }
  }

  function handleEdit(plan: StaffingPlan) {
    setEditingId(plan.id);
    setDate(plan.date);
    setBuilding(plan.building);
    setShift(plan.shift);
    setRequiredTotal(String(plan.requiredTotal));
    setRequiredLumpers(String(plan.requiredLumpers));
    setRequiredEquipment(String(plan.requiredEquipment));
    setRequiredLeads(String(plan.requiredLeads));
    setNotes(plan.notes ?? "");
  }

  async function handleDelete(plan: StaffingPlan) {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "Delete this staffing plan? This cannot be undone."
      );
      if (!ok) return;
    }

    try {
      const { error } = await supabase
        .from("staffing_plans")
        .delete()
        .eq("id", plan.id);

      if (error) {
        console.error("Error deleting staffing plan", error);
        setError("Failed to delete staffing plan.");
        return;
      }

      setInfo("Staffing plan deleted.");
      if (editingId === plan.id) resetForm();
      await refreshAll();
    } catch (e) {
      console.error("Unexpected error deleting staffing plan", e);
      setError("Unexpected error deleting staffing plan.");
    }
  }

  const actualByBuilding = useMemo(() => {
    const map: Record<string, number> = {};
    for (const w of workforceSummary) {
      map[w.building] = w.activeCount;
    }
    return map;
  }, [workforceSummary]);

  const filteredPlans = useMemo(() => {
    return plans.filter((p) => {
      if (filterBuilding !== "ALL" && p.building !== filterBuilding) {
        return false;
      }
      if (filterShift !== "ALL" && p.shift !== filterShift) {
        return false;
      }
      if (filterDateFrom && p.date < filterDateFrom) {
        return false;
      }
      if (filterDateTo && p.date > filterDateTo) {
        return false;
      }
      return true;
    });
  }, [plans, filterBuilding, filterShift, filterDateFrom, filterDateTo]);

  const summary = useMemo(() => {
    const total = plans.length;
    let under = 0;
    let over = 0;
    const todayStr = new Date().toISOString().slice(0, 10);
    let todayPlans = 0;

    for (const p of plans) {
      const actual = actualByBuilding[p.building] ?? 0;
      const diff = actual - p.requiredTotal;
      if (diff < 0) under++;
      if (diff > 0) over++;
      if (p.date === todayStr) todayPlans++;
    }

    return { total, under, over, todayPlans };
  }, [plans, actualByBuilding]);

  // Protect route after hooks
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
      <div className="mx-auto max-w-7xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">
              Staffing Coverage
            </h1>
            <p className="text-sm text-slate-400">
              Plan required headcount by building and shift, and compare
              against active workers from the workforce roster.
            </p>
          </div>
          <Link
            href="/"
            className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {/* Summary row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
          <SummaryCard label="Total Plans" value={summary.total} />
          <SummaryCard
            label="Understaffed Shifts"
            value={summary.under}
            accent="rose"
          />
          <SummaryCard
            label="Overstaffed Shifts"
            value={summary.over}
            accent="amber"
          />
          <SummaryCard
            label="Today’s Plans"
            value={summary.todayPlans}
            accent="sky"
          />
        </div>

        {/* Error/info + loading */}
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
        {loading && (
          <div className="text-xs text-slate-400">Loading staffing…</div>
        )}

        {/* Form + table */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-xs space-y-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-slate-200 text-sm font-semibold">
                {editingId ? "Edit Staffing Plan" : "Create Staffing Plan"}
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
                    Date
                  </label>
                  <input
                    type="date"
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
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
                    value={building}
                    onChange={(e) => setBuilding(e.target.value)}
                    disabled={isLead && !!leadBuilding}
                  >
                    {BUILDINGS.map((b) => {
                      if (isLead && leadBuilding && b !== leadBuilding)
                        return null;
                      return (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      );
                    })}
                  </select>
                </div>
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

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Required Total
                  </label>
                  <input
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={requiredTotal}
                    onChange={(e) => setRequiredTotal(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Lumpers
                  </label>
                  <input
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={requiredLumpers}
                    onChange={(e) => setRequiredLumpers(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Equipment Ops
                  </label>
                  <input
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={requiredEquipment}
                    onChange={(e) => setRequiredEquipment(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Leads
                  </label>
                  <input
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={requiredLeads}
                    onChange={(e) => setRequiredLeads(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Notes (optional)
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50 resize-none"
                  placeholder="Example: Need 2 clamp ops, 1 shuttle, 1 zero-tolerance lead…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="mt-1 w-full rounded-lg bg-sky-600 hover:bg-sky-500 text-[11px] font-medium text-white px-4 py-2"
              >
                {editingId ? "Save Changes" : "Create Staffing Plan"}
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
                    Filter by building, shift, and date range.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFilterShift("ALL");
                    setFilterDateFrom("");
                    setFilterDateTo("");
                    // Only reset building filter to ALL for non-Leads
                    setFilterBuilding(isLead && leadBuilding ? leadBuilding : "ALL");
                  }}
                  className="text-[11px] text-sky-300 hover:underline"
                >
                  Reset
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Building
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={filterBuilding}
                    onChange={(e) => setFilterBuilding(e.target.value)}
                    disabled={isLead && !!leadBuilding}
                  >
                    {!isLead && <option value="ALL">All Buildings</option>}
                    {BUILDINGS.map((b) => {
                      if (isLead && leadBuilding && b !== leadBuilding)
                        return null;
                      return (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Shift
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={filterShift}
                    onChange={(e) => setFilterShift(e.target.value)}
                  >
                    <option value="ALL">All Shifts</option>
                    {SHIFTS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    From (Date)
                  </label>
                  <input
                    type="date"
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={filterDateFrom}
                    onChange={(e) => setFilterDateFrom(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    To (Date)
                  </label>
                  <input
                    type="date"
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={filterDateTo}
                    onChange={(e) => setFilterDateTo(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
              <div className="flex items-center justify-between mb-2">
                <div className="text-slate-200 text-sm font-semibold">
                  Staffing Plans
                </div>
                <div className="text-[11px] text-slate-500">
                  Total:{" "}
                  <span className="font-semibold">
                    {plans.length}
                  </span>{" "}
                  · Showing:{" "}
                  <span className="font-semibold">
                    {filteredPlans.length}
                  </span>
                </div>
              </div>

              {filteredPlans.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No staffing plans match the current filters.
                </p>
              ) : (
                <div className="overflow-auto max-h-[520px]">
                  <table className="min-w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/60">
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Date
                        </th>
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
                          Actual (Active)
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                          Status
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPlans.map((p) => {
                        const actual = actualByBuilding[p.building] ?? 0;
                        const diff = actual - p.requiredTotal;
                        let badgeLabel = "Balanced";
                        let badgeClass =
                          "bg-emerald-900/60 text-emerald-200 border border-emerald-700/70";

                        if (diff < 0) {
                          badgeLabel = "Understaffed";
                          badgeClass =
                            "bg-rose-900/60 text-rose-200 border border-rose-700/70";
                        } else if (diff > 0) {
                          badgeLabel = "Overstaffed";
                          badgeClass =
                            "bg-amber-900/60 text-amber-200 border border-amber-700/70";
                        }

                        return (
                          <tr
                            key={p.id}
                            className="border-b border-slate-800/60 hover:bg-slate-900/60"
                          >
                            <td className="px-3 py-2 text-slate-300 font-mono">
                              {p.date}
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              {p.building}
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              {p.shift}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-200">
                              {p.requiredTotal}
                              <span className="text-[10px] text-slate-500 ml-1">
                                (L {p.requiredLumpers} · E{" "}
                                {p.requiredEquipment} · Lead{" "}
                                {p.requiredLeads})
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right text-slate-200">
                              {actual}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <span
                                className={
                                  "inline-flex rounded-full px-2 py-0.5 text-[10px] " +
                                  badgeClass
                                }
                              >
                                {badgeLabel}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="inline-flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleEdit(p)}
                                  className="text-[11px] text-sky-300 hover:underline"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(p)}
                                  className="text-[11px] text-rose-300 hover:underline"
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

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "emerald" | "rose" | "amber" | "sky";
}) {
  const color =
    accent === "emerald"
      ? "text-emerald-300"
      : accent === "rose"
      ? "text-rose-300"
      : accent === "amber"
      ? "text-amber-300"
      : accent === "sky"
      ? "text-sky-300"
      : "text-sky-300";

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

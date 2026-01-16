"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, FormEvent, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { BUILDINGS } from "@/lib/buildings";

const WORKFORCE_KEY = "precisionpulse_workforce";

const STATUS_OPTIONS = ["Active", "On Leave", "Terminated", "Candidate"] as const;

const ACCESS_ROLES = [
  "Worker / Lumper",
] as const;

const ROLE_HINTS = [
  "Lumper",
  "Forklift Operator",
  "Clamp Operator",
  "Shuttler",
  "Picker",
  "Sanitation",
] as const;

type WorkforcePerson = {
  id: string;
  name: string;
  role: string; // job role/position
  accessRole?: string; // system role / access level
  building: string;
  status: string;
  rateType?: "Hourly" | "Production" | "";
  rateValue?: number | null;
  notes?: string;
  createdAt: string;
};

type WorkforceRow = {
  id: string;
  created_at: string;
  name: string | null;
  job_role: string | null;
  access_role: string | null;
  building: string | null;
  status: string | null;
  rate_type: string | null;
  rate_value: number | null;
  notes: string | null;
};

function rowToPerson(row: WorkforceRow): WorkforcePerson {
  const createdAt = row.created_at ?? new Date().toISOString();
  const rateTypeRaw = row.rate_type ?? "";
  const rateType: "Hourly" | "Production" | "" =
    rateTypeRaw === "Hourly" || rateTypeRaw === "Production" ? (rateTypeRaw as "Hourly" | "Production") : "";

  return {
    id: String(row.id),
    name: row.name ?? "Unnamed Worker",
    role: row.job_role ?? "",
    accessRole: row.access_role ?? "",
    building: row.building ?? "DC18",
    status: row.status ?? "Active",
    rateType,
    rateValue: row.rate_value,
    notes: row.notes ?? "",
    createdAt,
  };
}

export default function WorkforcePage() {
  const currentUser = useCurrentUser();

  // ✅ Permissions
  const isSuperAdmin = currentUser?.accessRole === "Super Admin";
  const isBuildingManager = currentUser?.accessRole === "Building Manager";
  const isLead = currentUser?.accessRole === "Lead";

  // ✅ You said: ONLY Building Managers should manage workforce
  // I keep Super Admin allowed for safety / admin override.
  const canManageWorkforce = isBuildingManager || isSuperAdmin;

  // Building scoping for Building Managers
  const scopedBuilding = currentUser?.building || "";
  const isScopedToOneBuilding = isBuildingManager && !!scopedBuilding;

  const [people, setPeople] = useState<WorkforcePerson[]>([]);

  // form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [accessRole, setAccessRole] = useState<string>("");
  const [building, setBuilding] = useState("DC18");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("Active");
  const [rateType, setRateType] = useState<"Hourly" | "Production" | "">("");
  const [rateValue, setRateValue] = useState<string>("");
  const [notes, setNotes] = useState("");

  // filters
  const [filterBuilding, setFilterBuilding] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [search, setSearch] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persist into localStorage so dashboard/reports keep working
  const persist = useCallback((next: WorkforcePerson[]) => {
    setPeople(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(WORKFORCE_KEY, JSON.stringify(next));
    }
  }, []);

  async function refreshFromSupabase() {
    if (!currentUser) return;
    setLoading(true);
    setError(null);

    try {
      let query = supabase.from("workforce").select("*").order("name", { ascending: true });

      // ✅ Building Managers only see their building
      if (isScopedToOneBuilding) {
        query = query.eq("building", scopedBuilding);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error loading workforce", error);
        setError("Failed to load workforce from server.");
        return;
      }

      const rows: WorkforceRow[] = (data || []) as WorkforceRow[];
      const mapped = rows.map(rowToPerson);
      persist(mapped);
    } catch (e) {
      console.error("Unexpected error loading workforce", e);
      setError("Unexpected error loading workforce.");
    } finally {
      setLoading(false);
    }
  }

  // Load from Supabase once we know who is logged in
  useEffect(() => {
    if (!currentUser) return;
    refreshFromSupabase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, isScopedToOneBuilding, scopedBuilding]);

  // ✅ Lock building defaults + filters for Building Managers
  useEffect(() => {
    if (isScopedToOneBuilding) {
      setBuilding(scopedBuilding);
      setFilterBuilding(scopedBuilding);
    }
  }, [isScopedToOneBuilding, scopedBuilding]);

  // Form helpers
  function resetForm() {
    setEditingId(null);
    setName("");
    setRole("");
    setAccessRole("");
    setBuilding(isScopedToOneBuilding ? scopedBuilding : currentUser?.building || "DC18");
    setStatus("Active");
    setRateType("");
    setRateValue("");
    setNotes("");
  }

  function canEditPerson(p: WorkforcePerson): boolean {
    if (!currentUser) return false;

    // ✅ Only Building Managers (and Super Admin) can edit/delete/add
    if (!canManageWorkforce) return false;

    // ✅ Building Manager can only edit workers in their building
    if (isScopedToOneBuilding) return p.building === scopedBuilding;

    // Super Admin: allow
    return true;
  }

  function handleEdit(person: WorkforcePerson) {
    if (!canEditPerson(person)) {
      setError("Not allowed.");
      return;
    }

    setEditingId(person.id);
    setName(person.name);
    setRole(person.role);
    setAccessRole(person.accessRole ?? "");
    setBuilding(person.building);
    setStatus(person.status as (typeof STATUS_OPTIONS)[number]);
    setRateType(person.rateType ?? "");
    setRateValue(person.rateValue != null ? String(person.rateValue) : "");
    setNotes(person.notes ?? "");
  }

  async function handleDelete(person: WorkforcePerson) {
    if (!canEditPerson(person)) {
      setError("Not allowed.");
      return;
    }

    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `Remove ${person.name} from the workforce roster? This does NOT delete historical container records; it only removes them from this roster list.`
      );
      if (!ok) return;
    }

    setSaving(true);
    setError(null);

    try {
      // ✅ Extra safety: building managers can only delete within their building
      let del = supabase.from("workforce").delete().eq("id", person.id);
      if (isScopedToOneBuilding) del = del.eq("building", scopedBuilding);

      const { error } = await del;

      if (error) {
        console.error("Error deleting workforce record", error);
        setError("Failed to delete worker.");
        return;
      }

      await refreshFromSupabase();
      if (editingId === person.id) resetForm();
    } catch (e) {
      console.error("Unexpected error deleting worker", e);
      setError("Unexpected error deleting worker.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;

    if (!canManageWorkforce) {
      setError("Not allowed.");
      return;
    }

    if (!name.trim()) {
      if (typeof window !== "undefined") window.alert("Please enter a name.");
      return;
    }

    const parsedRate = rateValue.trim() === "" ? null : Number(rateValue);
    if (rateValue.trim() !== "" && Number.isNaN(parsedRate)) {
      if (typeof window !== "undefined") window.alert("Rate must be a valid number (or leave blank).");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // ✅ Force building for Building Managers
      const effectiveBuilding = isScopedToOneBuilding ? scopedBuilding : building;

      const payload = {
        name: name.trim(),
        job_role: role.trim() || null,
        access_role: accessRole || null,
        building: effectiveBuilding,
        status,
        rate_type: rateType || null,
        rate_value: parsedRate,
        notes: notes.trim() || null,
      };

      if (editingId) {
        const existing = people.find((p) => p.id === editingId);
        if (!existing || !canEditPerson(existing)) {
          setError("Not allowed.");
          return;
        }

        // ✅ If BM, ensure update can't cross buildings
        let upd = supabase.from("workforce").update(payload).eq("id", editingId);
        if (isScopedToOneBuilding) upd = upd.eq("building", scopedBuilding);

        const { error } = await upd;

        if (error) {
          console.error("Error updating workforce record", error);
          setError("Failed to update worker.");
          return;
        }
      } else {
        // ✅ If BM, the insert is already forced into their building
        const { error } = await supabase.from("workforce").insert(payload);
        if (error) {
          console.error("Error inserting workforce record", error);
          setError("Failed to add worker.");
          return;
        }
      }

      await refreshFromSupabase();
      resetForm();
    } catch (e) {
      console.error("Unexpected error saving worker", e);
      setError("Unexpected error saving worker.");
    } finally {
      setSaving(false);
    }
  }

  const displayedPeople = useMemo(() => {
    let rows = [...people];

    // ✅ Extra safety: Building Managers can only ever see their own building
    if (isScopedToOneBuilding) {
      rows = rows.filter((p) => p.building === scopedBuilding);
    }

    if (filterBuilding !== "ALL") rows = rows.filter((p) => p.building === filterBuilding);
    if (filterStatus !== "ALL") rows = rows.filter((p) => p.status === filterStatus);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.role.toLowerCase().includes(q) ||
          (p.accessRole || "").toLowerCase().includes(q)
      );
    }

    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }, [people, filterBuilding, filterStatus, search, isScopedToOneBuilding, scopedBuilding]);

  const totalActive = people.filter((p) => p.status === "Active").length;
  const totalSuperAdmins = people.filter((p) => p.accessRole === "Super Admin").length;
  const totalBuildingManagers = people.filter((p) => p.accessRole === "Building Manager").length;

  // Route guard AFTER hooks
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

  // ✅ Block Leads (and anyone else) from this page unless Building Manager or Super Admin
  if (!canManageWorkforce) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col items-center justify-center text-sm gap-3 p-6">
        <div className="text-slate-50 font-semibold">Access Restricted</div>
        <div className="text-[11px] text-slate-400 text-center max-w-md">
          Only Building Managers can access and manage the Workforce roster.
        </div>
        <Link
          href="/"
          className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
        >
          ← Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50">
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">Workforce Roster</h1>
            <p className="text-sm text-slate-400">
              Maintain your roster of lumpers, leads, supervisors, and managers with system roles for access control.
            </p>
            {isScopedToOneBuilding && (
              <p className="text-[11px] text-slate-500 mt-1">
                Scoped to: <span className="font-semibold text-sky-300">{scopedBuilding}</span>
              </p>
            )}
          </div>
          <Link
            href="/"
            className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {/* Summary row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
            <div className="text-slate-400 mb-1">Total Active Workers</div>
            <div className="text-2xl font-semibold text-emerald-300">{totalActive}</div>
            <div className="text-[11px] text-slate-500 mt-1">Across current scope</div>
          </div>
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
            <div className="text-slate-400 mb-1">Super Admins (System)</div>
            <div className="text-2xl font-semibold text-sky-300">{totalSuperAdmins}</div>
            <div className="text-[11px] text-slate-500 mt-1">Users marked as &quot;Super Admin&quot;</div>
          </div>
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
            <div className="text-slate-400 mb-1">Building Managers (System)</div>
            <div className="text-2xl font-semibold text-amber-300">{totalBuildingManagers}</div>
            <div className="text-[11px] text-slate-500 mt-1">Users marked as &quot;Building Manager&quot;</div>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-700 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-100">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs space-y-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-slate-200 text-sm font-semibold">{editingId ? "Edit Worker" : "Add Worker"}</div>
              {editingId && (
                <button type="button" onClick={resetForm} className="text-[11px] text-sky-300 hover:underline">
                  Clear / New
                </button>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Full Name</label>
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                  placeholder="Example: John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Role / Position (Job)</label>
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                  placeholder="Lumper, Lead, Supervisor..."
                  list="role-hints"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                />
                <datalist id="role-hints">
                  {ROLE_HINTS.map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">System Role (Access Level)</label>
                <select
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                  value={accessRole}
                  onChange={(e) => setAccessRole(e.target.value)}
                >
                  <option value="">None / Worker Only</option>
                  {ACCESS_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-slate-500">
                  Use this for &quot;Building Manager&quot;, &quot;HR&quot;, etc. This is separate from job title.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Building</label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={building}
                    onChange={(e) => setBuilding(e.target.value)}
                    disabled={isScopedToOneBuilding}
                  >
                    {BUILDINGS.map((b) => {
                      if (isScopedToOneBuilding && b !== scopedBuilding) return null;
                      return (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Status</label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as (typeof STATUS_OPTIONS)[number])}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Rate Type</label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={rateType}
                    onChange={(e) => setRateType(e.target.value as "Hourly" | "Production" | "")}
                  >
                    <option value="">None / N/A</option>
                    <option value="Hourly">Hourly</option>
                    <option value="Production">Production</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Rate Value</label>
                  <input
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    placeholder="e.g. 20.00"
                    value={rateValue}
                    onChange={(e) => setRateValue(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Notes (optional)</label>
                <textarea
                  rows={3}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50 resize-none"
                  placeholder="Certifications, equipment, special notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="mt-1 w-full rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-[11px] font-medium text-white px-4 py-2"
              >
                {saving ? "Saving…" : editingId ? "Save Changes" : "Add Worker"}
              </button>
            </form>
          </div>

          {/* Filters + table */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-slate-200 text-sm font-semibold">Filters</div>
                  <div className="text-[11px] text-slate-500">Drill into specific buildings, statuses, or roles.</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFilterStatus("ALL");
                    setSearch("");
                    setFilterBuilding(isScopedToOneBuilding ? scopedBuilding : "ALL");
                  }}
                  className="text-[11px] text-sky-300 hover:underline"
                >
                  Reset
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Building</label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={filterBuilding}
                    onChange={(e) => setFilterBuilding(e.target.value)}
                    disabled={isScopedToOneBuilding}
                  >
                    {!isScopedToOneBuilding && <option value="ALL">All Buildings</option>}
                    {BUILDINGS.map((b) => {
                      if (isScopedToOneBuilding && b !== scopedBuilding) return null;
                      return (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Status</label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
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
                  <label className="block text-[11px] text-slate-400 mb-1">Search name / role / system</label>
                  <input
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    placeholder="Type to filter..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>

              {loading && <div className="mt-2 text-[11px] text-slate-500">Loading workforce…</div>}
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
              <div className="flex items-center justify-between mb-2">
                <div className="text-slate-200 text-sm font-semibold">Workforce List</div>
                <div className="text-[11px] text-slate-500">
                  Total: <span className="font-semibold text-slate-200">{people.length}</span> · Showing:{" "}
                  <span className="font-semibold text-slate-200">{displayedPeople.length}</span>
                </div>
              </div>

              {displayedPeople.length === 0 ? (
                <p className="text-sm text-slate-500">No workers match the current filters. Add a worker or adjust filters.</p>
              ) : (
                <div className="overflow-auto max-h-[480px]">
                  <table className="min-w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/60">
                        <th className="px-3 py-2 text-[11px] text-slate-400">Name</th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">Role (Job)</th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">System Role</th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">Building</th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">Status</th>
                        <th className="px-3 py-2 text-[11px] text-slate-400 text-right">Rate</th>
                        <th className="px-3 py-2 text-[11px] text-slate-400 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedPeople.map((p) => {
                        const badgeClass =
                          p.status === "Active"
                            ? "bg-emerald-900/60 text-emerald-200 border border-emerald-700/70"
                            : p.status === "On Leave"
                            ? "bg-amber-900/60 text-amber-200 border border-amber-700/70"
                            : p.status === "Candidate"
                            ? "bg-sky-900/60 text-sky-200 border border-sky-700/70"
                            : "bg-slate-900/80 text-slate-200 border border-slate-600/70";

                        const rateLabel =
                          !p.rateType ? "—" : p.rateValue != null ? `${p.rateType} $${p.rateValue.toFixed(2)}` : p.rateType;

                        const blocked = !canEditPerson(p);

                        return (
                          <tr key={p.id} className="border-b border-slate-800/60 hover:bg-slate-900/60">
                            <td className="px-3 py-2 text-slate-100">
                              <div className="text-xs font-medium">{p.name}</div>
                              {p.notes && <div className="text-[11px] text-slate-500 line-clamp-1">{p.notes}</div>}
                            </td>
                            <td className="px-3 py-2 text-slate-300">{p.role || "—"}</td>
                            <td className="px-3 py-2 text-slate-300">{p.accessRole || "—"}</td>
                            <td className="px-3 py-2 text-slate-300">{p.building}</td>
                            <td className="px-3 py-2">
                              <span className={"inline-flex rounded-full px-2 py-0.5 text-[10px] " + badgeClass}>
                                {p.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right text-slate-200">{rateLabel}</td>
                            <td className="px-3 py-2 text-right">
                              <div className="inline-flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleEdit(p)}
                                  className="text-[11px] text-sky-300 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                                  disabled={saving || blocked}
                                  title={blocked ? "Not allowed." : "Edit"}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(p)}
                                  className="text-[11px] text-rose-300 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                                  disabled={saving || blocked}
                                  title={blocked ? "Not allowed." : "Delete"}
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

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const WORKFORCE_KEY = "precisionpulse_workforce";

const BUILDINGS = ["DC1", "DC5", "DC11", "DC14", "DC18"];
const STATUS_OPTIONS = ["Active", "On Leave", "Terminated", "Candidate"];

const ACCESS_ROLES = [
  "Super Admin",
  "Director of Operations",
  "Regional Manager",
  "Building Manager",
  "HR",
  "Lead",
  "Worker / Lumper",
  "Other",
];

const ROLE_HINTS = [
  "Lumper",
  "Lead",
  "Supervisor",
  "Building Manager",
  "Forklift Operator",
  "Clamp Operator",
  "Shuttler",
  "Picker",
  "Sanitation",
];

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

function normalizePerson(raw: any): WorkforcePerson {
  const id =
    String(raw?.id ?? raw?.workerId ?? raw?.email ?? Date.now());
  const name = String(
    raw?.name ??
      raw?.fullName ??
      raw?.displayName ??
      raw?.email ??
      "Unnamed Worker"
  );
  const createdAt =
    raw?.createdAt ??
    raw?.onboardedAt ??
    new Date().toISOString();

  return {
    id,
    name,
    role: raw?.role ?? raw?.position ?? "",
    accessRole: raw?.accessRole ?? raw?.systemRole ?? "",
    building: raw?.building ?? raw?.assignedBuilding ?? "DC18",
    status: raw?.status ?? "Active",
    rateType: raw?.rateType ?? "",
    rateValue:
      typeof raw?.rateValue === "number"
        ? raw.rateValue
        : raw?.rateValue
        ? Number(raw.rateValue)
        : null,
    notes: raw?.notes ?? "",
    createdAt,
  };
}

export default function WorkforcePage() {
  const [people, setPeople] = useState<WorkforcePerson[]>([]);

  // form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [accessRole, setAccessRole] = useState<string>("");
  const [building, setBuilding] = useState("DC18");
  const [status, setStatus] = useState("Active");
  const [rateType, setRateType] = useState<"Hourly" | "Production" | "">("");
  const [rateValue, setRateValue] = useState<string>("");
  const [notes, setNotes] = useState("");

  // filters
  const [filterBuilding, setFilterBuilding] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [search, setSearch] = useState<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(WORKFORCE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const normalized: WorkforcePerson[] = Array.isArray(parsed)
          ? parsed.map(normalizePerson)
          : [];
        setPeople(normalized);
      }
    } catch (e) {
      console.error("Failed to load workforce", e);
    }
  }, []);

  function persist(next: WorkforcePerson[]) {
    setPeople(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(WORKFORCE_KEY, JSON.stringify(next));
    }
  }

  function resetForm() {
    setEditingId(null);
    setName("");
    setRole("");
    setAccessRole("");
    setBuilding("DC18");
    setStatus("Active");
    setRateType("");
    setRateValue("");
    setNotes("");
  }

  function handleEdit(person: WorkforcePerson) {
    setEditingId(person.id);
    setName(person.name);
    setRole(person.role);
    setAccessRole(person.accessRole ?? "");
    setBuilding(person.building);
    setStatus(person.status);
    setRateType(person.rateType ?? "");
    setRateValue(
      person.rateValue != null ? String(person.rateValue) : ""
    );
    setNotes(person.notes ?? "");
  }

  function handleDelete(person: WorkforcePerson) {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `Remove ${person.name} from the workforce roster? This does NOT delete historical container records; it only removes them from this roster list.`
      );
      if (!ok) return;
    }

    const next = people.filter((p) => p.id !== person.id);
    persist(next);

    if (editingId === person.id) {
      resetForm();
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      if (typeof window !== "undefined") {
        window.alert("Please enter a name.");
      }
      return;
    }

    const nowIso = new Date().toISOString();

    const parsedRate =
      rateValue.trim() === "" ? null : Number(rateValue);
    if (rateValue.trim() !== "" && Number.isNaN(parsedRate)) {
      if (typeof window !== "undefined") {
        window.alert("Rate must be a valid number (or leave blank).");
      }
      return;
    }

    if (editingId) {
      const next = people.map((p) =>
        p.id === editingId
          ? {
              ...p,
              name: name.trim(),
              role: role.trim(),
              accessRole: accessRole || "",
              building,
              status,
              rateType,
              rateValue: parsedRate,
              notes: notes.trim(),
            }
          : p
      );
      persist(next);
    } else {
      const newPerson: WorkforcePerson = {
        id: String(Date.now()),
        name: name.trim(),
        role: role.trim(),
        accessRole: accessRole || "",
        building,
        status,
        rateType,
        rateValue: parsedRate,
        notes: notes.trim(),
        createdAt: nowIso,
      };
      persist([newPerson, ...people]);
    }

    resetForm();
  }

  const displayedPeople = useMemo(() => {
    let rows = [...people];

    if (filterBuilding !== "ALL") {
      rows = rows.filter((p) => p.building === filterBuilding);
    }
    if (filterStatus !== "ALL") {
      rows = rows.filter((p) => p.status === filterStatus);
    }
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
  }, [people, filterBuilding, filterStatus, search]);

  const totalActive = people.filter((p) => p.status === "Active").length;
  const totalSuperAdmins = people.filter(
    (p) => p.accessRole === "Super Admin"
  ).length;
  const totalBuildingManagers = people.filter(
    (p) => p.accessRole === "Building Manager"
  ).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50">
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">
              Workforce Roster
            </h1>
            <p className="text-sm text-slate-400">
              Maintain your roster of lumpers, leads, supervisors, and
              managers with system roles for access control.
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
            <div className="text-slate-400 mb-1">
              Total Active Workers
            </div>
            <div className="text-2xl font-semibold text-emerald-300">
              {totalActive}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Across all buildings
            </div>
          </div>
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
            <div className="text-slate-400 mb-1">
              Super Admins (System)
            </div>
            <div className="text-2xl font-semibold text-sky-300">
              {totalSuperAdmins}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Users marked as &quot;Super Admin&quot;
            </div>
          </div>
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
            <div className="text-slate-400 mb-1">
              Building Managers (System)
            </div>
            <div className="text-2xl font-semibold text-amber-300">
              {totalBuildingManagers}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Users marked as &quot;Building Manager&quot;
            </div>
          </div>
        </div>

        {/* Form + list */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs space-y-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-slate-200 text-sm font-semibold">
                {editingId ? "Edit Worker" : "Add Worker"}
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
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Full Name
                </label>
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                  placeholder="Example: John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Role / Position (Job)
                </label>
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
                <label className="block text-[11px] text-slate-400 mb-1">
                  System Role (Access Level)
                </label>
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
                  Use this for &quot;Super Admin&quot;, &quot;Building
                  Manager&quot;, &quot;HR&quot;, etc. This is separate
                  from their job title.
                </p>
              </div>

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
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Rate Type
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={rateType}
                    onChange={(e) =>
                      setRateType(
                        e.target.value as "Hourly" | "Production" | ""
                      )
                    }
                  >
                    <option value="">None / N/A</option>
                    <option value="Hourly">Hourly</option>
                    <option value="Production">Production</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Rate Value
                  </label>
                  <input
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    placeholder="e.g. 20.00"
                    value={rateValue}
                    onChange={(e) => setRateValue(e.target.value)}
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
                  placeholder="Certifications, equipment, special notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="mt-1 w-full rounded-lg bg-sky-600 hover:bg-sky-500 text-[11px] font-medium text-white px-4 py-2"
              >
                {editingId ? "Save Changes" : "Add Worker"}
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
                    Drill into specific buildings, statuses, or roles.
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
                    Search name / role / system
                  </label>
                  <input
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    placeholder="Type to filter..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
              <div className="flex items-center justify-between mb-2">
                <div className="text-slate-200 text-sm font-semibold">
                  Workforce List
                </div>
                <div className="text-[11px] text-slate-500">
                  Total:{" "}
                  <span className="font-semibold text-slate-200">
                    {people.length}
                  </span>{" "}
                  · Showing:{" "}
                  <span className="font-semibold text-slate-200">
                    {displayedPeople.length}
                  </span>
                </div>
              </div>

              {displayedPeople.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No workers match the current filters. Add a worker or
                  adjust filters.
                </p>
              ) : (
                <div className="overflow-auto max-h-[480px]">
                  <table className="min-w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/60">
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Name
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Role (Job)
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          System Role
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Building
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Status
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                          Rate
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                          Actions
                        </th>
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
  !p.rateType
    ? "—"
    : p.rateValue != null
    ? `${p.rateType} $${p.rateValue.toFixed(2)}`
    : p.rateType;

                        return (
                          <tr
                            key={p.id}
                            className="border-b border-slate-800/60 hover:bg-slate-900/60"
                          >
                            <td className="px-3 py-2 text-slate-100">
                              <div className="text-xs font-medium">
                                {p.name}
                              </div>
                              {p.notes && (
                                <div className="text-[11px] text-slate-500 line-clamp-1">
                                  {p.notes}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              {p.role || "—"}
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              {p.accessRole || "—"}
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              {p.building}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={
                                  "inline-flex rounded-full px-2 py-0.5 text-[10px] " +
                                  badgeClass
                                }
                              >
                                {p.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right text-slate-200">
                              {rateLabel}
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

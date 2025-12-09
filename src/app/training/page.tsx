"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const WORKFORCE_KEY = "precisionpulse_workforce";
const TRAINING_KEY = "precisionpulse_training";

const BUILDINGS = ["ALL", "DC1", "DC5", "DC11", "DC14", "DC18"];

type WorkforcePerson = {
  id: string;
  name: string;
  role?: string;
  building?: string;
  status?: string;
};

type TrainingModule = {
  id: string;
  name: string;
  description?: string;
  requiredRoles: string[]; // roles this module applies to
  active: boolean;
};

type TrainingCompletion = {
  id: string;
  workerId: string;
  moduleId: string;
  completed: boolean;
  completedAt?: string;
  building?: string;
  role?: string;
};

type TrainingState = {
  modules: TrainingModule[];
  completions: TrainingCompletion[];
};

// Normalize workforce from whatever is stored
function normalizeWorkforce(raw: any[]): WorkforcePerson[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((w) => ({
    id: String(w.id ?? w.workerId ?? w.email ?? w.name ?? ""),
    name: String(
      w.fullName ?? w.name ?? w.displayName ?? w.email ?? "Unknown"
    ),
    role: w.role ?? w.position ?? "",
    building: w.building ?? w.assignedBuilding ?? "",
    status: w.status ?? "",
  }));
}

// Normalize training state in case shape changed
function normalizeTraining(raw: any): TrainingState {
  const modulesRaw: any[] = Array.isArray(raw?.modules) ? raw.modules : [];
  const completionsRaw: any[] = Array.isArray(raw?.completions)
    ? raw.completions
    : [];

  const modules: TrainingModule[] = modulesRaw.map((m) => ({
    id: String(m.id ?? `${m.name ?? "module"}-${Date.now()}`),
    name: String(m.name ?? "Untitled Module"),
    description: m.description ?? "",
    requiredRoles: Array.isArray(m.requiredRoles)
      ? m.requiredRoles.map(String)
      : [],
    active:
      typeof m.active === "boolean"
        ? m.active
        : m.status === "Active"
        ? true
        : true,
  }));

  const completions: TrainingCompletion[] = completionsRaw.map((c) => ({
    id: String(
      c.id ??
        `${c.workerId ?? "worker"}-${c.moduleId ?? "module"}-${Date.now()}`
    ),
    workerId: String(c.workerId ?? ""),
    moduleId: String(c.moduleId ?? ""),
    completed: Boolean(c.completed ?? c.isComplete ?? false),
    completedAt: c.completedAt ?? undefined,
    building: c.building ?? "",
    role: c.role ?? "",
  }));

  return { modules, completions };
}

export default function TrainingPage() {
  const [workforce, setWorkforce] = useState<WorkforcePerson[]>([]);
  const [trainingState, setTrainingState] = useState<TrainingState>({
    modules: [],
    completions: [],
  });

  // Filters
  const [buildingFilter, setBuildingFilter] = useState<string>("ALL");
  const [roleFilter, setRoleFilter] = useState<string>("ALL");

  // Module form
  const [moduleName, setModuleName] = useState("");
  const [moduleDescription, setModuleDescription] = useState("");
  const [moduleRolesText, setModuleRolesText] = useState("");
  const [moduleError, setModuleError] = useState<string | null>(null);

  // UI state
  const [selectedModuleId, setSelectedModuleId] = useState<string | "ALL">(
    "ALL"
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Load workforce
    try {
      const raw = window.localStorage.getItem(WORKFORCE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setWorkforce(normalizeWorkforce(parsed));
      }
    } catch (e) {
      console.error("Failed to load workforce for training", e);
    }

    // Load training state
    try {
      const raw = window.localStorage.getItem(TRAINING_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setTrainingState(normalizeTraining(parsed));
      }
    } catch (e) {
      console.error("Failed to load training state", e);
    }
  }, []);

  function saveTrainingState(next: TrainingState) {
    setTrainingState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TRAINING_KEY, JSON.stringify(next));
    }
  }

  // Derived data
  const allRoles = useMemo(() => {
    const set = new Set<string>();
    for (const w of workforce) {
      if (w.role) set.add(w.role);
    }
    return Array.from(set).sort();
  }, [workforce]);

  const filteredWorkforce = useMemo(() => {
    return workforce.filter((w) => {
      if (buildingFilter !== "ALL" && w.building !== buildingFilter) {
        return false;
      }
      if (roleFilter !== "ALL" && (w.role ?? "") !== roleFilter) {
        return false;
      }
      return true;
    });
  }, [workforce, buildingFilter, roleFilter]);

  // Modules list (active first)
  const activeModules = trainingState.modules.filter((m) => m.active);
  const allModules = trainingState.modules;

  // Compliance calculations
  function getRequiredModulesForWorker(w: WorkforcePerson): TrainingModule[] {
    // Rule: module applies to a worker if:
    // - module.active
    // - AND either requiredRoles is empty (global) OR it includes worker.role
    return activeModules.filter((m) => {
      if (!m.requiredRoles || m.requiredRoles.length === 0) return true;
      if (!w.role) return false;
      return m.requiredRoles.includes(w.role);
    });
  }

  function isModuleCompleted(
    workerId: string,
    moduleId: string
  ): TrainingCompletion | null {
    return (
      trainingState.completions.find(
        (c) => c.workerId === workerId && c.moduleId === moduleId
      ) ?? null
    );
  }

  type WorkerComplianceRow = {
    worker: WorkforcePerson;
    requiredCount: number;
    completedCount: number;
    percent: number;
    status: "Compliant" | "Partial" | "Not Started" | "No Required";
  };

  const workerComplianceRows: WorkerComplianceRow[] = useMemo(() => {
    const rows: WorkerComplianceRow[] = [];

    for (const w of filteredWorkforce) {
      const required = getRequiredModulesForWorker(w);
      const requiredCount = required.length;

      if (requiredCount === 0) {
        rows.push({
          worker: w,
          requiredCount: 0,
          completedCount: 0,
          percent: 100,
          status: "No Required",
        });
        continue;
      }

      let completedCount = 0;
      for (const m of required) {
        const comp = isModuleCompleted(w.id, m.id);
        if (comp && comp.completed) completedCount += 1;
      }

      const percent =
        requiredCount === 0
          ? 100
          : Math.round((completedCount / requiredCount) * 100);

      let status: WorkerComplianceRow["status"];
      if (completedCount === 0) status = "Not Started";
      else if (completedCount === requiredCount) status = "Compliant";
      else status = "Partial";

      rows.push({
        worker: w,
        requiredCount,
        completedCount,
        percent,
        status,
      });
    }

    // Sort: Non-compliant first, then compliant, then no required
    rows.sort((a, b) => {
      const statusOrder = (s: WorkerComplianceRow["status"]) => {
        if (s === "Compliant") return 2;
        if (s === "No Required") return 3;
        if (s === "Partial") return 1;
        return 0; // Not Started
      };
      const diff = statusOrder(a.status) - statusOrder(b.status);
      if (diff !== 0) return diff;

      // Within same status, sort by worker name
      return a.worker.name.localeCompare(b.worker.name);
    });

    return rows;
  }, [filteredWorkforce, activeModules, trainingState.completions]);

  const complianceSummary = useMemo(() => {
    const withRequirements = workerComplianceRows.filter(
      (r) => r.requiredCount > 0
    );
    const compliant = withRequirements.filter(
      (r) => r.status === "Compliant"
    );
    const partialOrNot = withRequirements.filter(
      (r) => r.status === "Partial" || r.status === "Not Started"
    );

    const totalWorkers = filteredWorkforce.length;
    const totalWithReq = withRequirements.length;
    const percentCompliant =
      totalWithReq === 0
        ? 100
        : Math.round((compliant.length / totalWithReq) * 100);

    return {
      totalWorkers,
      totalWithReq,
      compliantCount: compliant.length,
      nonCompliantCount: partialOrNot.length,
      percentCompliant,
    };
  }, [workerComplianceRows, filteredWorkforce.length]);

  function handleAddModule(e: React.FormEvent) {
    e.preventDefault();
    setModuleError(null);

    if (!moduleName.trim()) {
      setModuleError("Module name is required.");
      return;
    }

    const roles = moduleRolesText
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);

    const newModule: TrainingModule = {
      id: `${Date.now()}`,
      name: moduleName.trim(),
      description: moduleDescription.trim(),
      requiredRoles: roles,
      active: true,
    };

    const next: TrainingState = {
      ...trainingState,
      modules: [newModule, ...trainingState.modules],
    };
    saveTrainingState(next);

    setModuleName("");
    setModuleDescription("");
    setModuleRolesText("");
  }

  function handleToggleModuleActive(moduleId: string) {
    const nextModules = trainingState.modules.map((m) =>
      m.id === moduleId ? { ...m, active: !m.active } : m
    );
    saveTrainingState({
      ...trainingState,
      modules: nextModules,
    });
  }

  function handleDeleteModule(moduleId: string) {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "Delete this module and all its completion records?"
      );
      if (!ok) return;
    }

    const nextModules = trainingState.modules.filter(
      (m) => m.id !== moduleId
    );
    const nextCompletions = trainingState.completions.filter(
      (c) => c.moduleId !== moduleId
    );

    saveTrainingState({
      modules: nextModules,
      completions: nextCompletions,
    });

    if (selectedModuleId === moduleId) {
      setSelectedModuleId("ALL");
    }
  }

  function handleToggleCompletion(worker: WorkforcePerson, module: TrainingModule) {
    const existingIndex = trainingState.completions.findIndex(
      (c) => c.workerId === worker.id && c.moduleId === module.id
    );

    let nextCompletions = [...trainingState.completions];

    if (existingIndex === -1) {
      const now = new Date().toISOString();
      const newCompletion: TrainingCompletion = {
        id: `${worker.id}-${module.id}-${Date.now()}`,
        workerId: worker.id,
        moduleId: module.id,
        completed: true,
        completedAt: now,
        building: worker.building,
        role: worker.role,
      };
      nextCompletions.push(newCompletion);
    } else {
      const existing = nextCompletions[existingIndex];
      const nowCompleted = !existing.completed;
      nextCompletions[existingIndex] = {
        ...existing,
        completed: nowCompleted,
        completedAt: nowCompleted
          ? new Date().toISOString()
          : undefined,
      };
    }

    saveTrainingState({
      ...trainingState,
      completions: nextCompletions,
    });
  }

  const displayModules =
    selectedModuleId === "ALL"
      ? activeModules
      : activeModules.filter((m) => m.id === selectedModuleId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">
            Training & Compliance
          </h1>
          <p className="text-sm text-slate-400">
            Define training modules, tie them to roles, and track worker
            completion by building and role.
          </p>
        </div>
        <Link
          href="/"
          className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
        >
          ← Back to Dashboard
        </Link>
      </div>

      {/* Top section: Modules + Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Modules card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-slate-200 text-sm font-semibold">
                Training Modules
              </div>
              <div className="text-[11px] text-slate-500">
                Create modules and assign them to roles.
              </div>
            </div>
          </div>

          {moduleError && (
            <div className="text-[11px] text-red-300 bg-red-950/40 border border-red-800 rounded px-3 py-2">
              {moduleError}
            </div>
          )}

          <form onSubmit={handleAddModule} className="space-y-2">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Module name
              </label>
              <input
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                placeholder="e.g. Dock Safety, Zero Tolerance, PIT Certification"
                value={moduleName}
                onChange={(e) => setModuleName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Description (optional)
              </label>
              <textarea
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50 min-h-[40px]"
                placeholder="What this module covers or any notes for leads/HR."
                value={moduleDescription}
                onChange={(e) => setModuleDescription(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Required roles (comma separated)
              </label>
              <input
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                placeholder="e.g. Lumper, Lead, Forklift"
                value={moduleRolesText}
                onChange={(e) => setModuleRolesText(e.target.value)}
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Leave blank to apply this module to <strong>all roles</strong>.
              </p>
            </div>
            <button
              type="submit"
              className="mt-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-[11px] font-medium text-white px-3 py-1.5"
            >
              + Add Module
            </button>
          </form>

          <div className="mt-3 border-t border-slate-800 pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[11px] text-slate-400">
                Existing Modules
              </div>
              <select
                className="rounded bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                value={selectedModuleId}
                onChange={(e) => setSelectedModuleId(e.target.value as any)}
              >
                <option value="ALL">Show all active</option>
                {trainingState.modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            {allModules.length === 0 ? (
              <p className="text-[11px] text-slate-500">
                No modules defined yet. Create your first Dock Safety /
                Zero Tolerance module above.
              </p>
            ) : (
              <div className="space-y-2 max-h-52 overflow-auto pr-1">
                {allModules.map((m) => (
                  <div
                    key={m.id}
                    className="border border-slate-800 rounded-lg bg-slate-950 px-2 py-2 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] text-slate-100 font-medium">
                        {m.name}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleModuleActive(m.id)}
                          className={`text-[10px] px-2 py-0.5 rounded-full border ${
                            m.active
                              ? "bg-emerald-900/40 border-emerald-700 text-emerald-200"
                              : "bg-slate-900/60 border-slate-700 text-slate-300"
                          }`}
                        >
                          {m.active ? "Active" : "Inactive"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteModule(m.id)}
                          className="text-[10px] px-2 py-0.5 rounded-full border border-red-700 bg-red-950 text-red-200 hover:bg-red-900"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {m.description && (
                      <div className="text-[11px] text-slate-400">
                        {m.description}
                      </div>
                    )}
                    <div className="text-[11px] text-slate-500">
                      Roles:{" "}
                      {m.requiredRoles.length === 0
                        ? "All roles"
                        : m.requiredRoles.join(", ")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Compliance summary */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-slate-200 text-sm font-semibold">
                Compliance Summary
              </div>
              <div className="text-[11px] text-slate-500">
                Based on Workforce & active modules.
              </div>
            </div>
            <div className="text-[11px] text-slate-500 text-right">
              Workers in view:{" "}
              <span className="text-slate-200">
                {complianceSummary.totalWorkers}
              </span>
              <br />
              With requirements:{" "}
              <span className="text-slate-200">
                {complianceSummary.totalWithReq}
              </span>
            </div>
          </div>

          <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
            <div className="text-[11px] text-slate-400 mb-1">
              Fully Compliant (all required modules)
            </div>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-semibold text-emerald-300">
                {complianceSummary.percentCompliant}%
              </div>
              <div className="text-[11px] text-slate-500">
                {complianceSummary.compliantCount} of{" "}
                {complianceSummary.totalWithReq} workers with requirements
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
              <div className="text-[11px] text-slate-400 mb-1">
                Non-compliant (partial / not started)
              </div>
              <div className="text-lg font-semibold text-amber-300">
                {complianceSummary.nonCompliantCount}
              </div>
            </div>
            <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
              <div className="text-[11px] text-slate-400 mb-1">
                Modules (active)
              </div>
              <div className="text-lg font-semibold text-slate-100">
                {activeModules.length}
              </div>
            </div>
          </div>
        </div>

        {/* Filters for workers */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 text-xs">
          <div className="text-slate-200 text-sm font-semibold">
            Filter Workforce
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">
              Building
            </label>
            <select
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
              value={buildingFilter}
              onChange={(e) => setBuildingFilter(e.target.value)}
            >
              {BUILDINGS.map((b) => (
                <option key={b} value={b}>
                  {b === "ALL" ? "All Buildings" : b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">
              Role
            </label>
            <select
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="ALL">All Roles</option>
              {allRoles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[11px] text-slate-500">
            Workforce list is pulled from the Workforce module. Make sure
            workers have roles and buildings assigned for best results.
          </p>
        </div>
      </div>

      {/* Worker x Module matrix */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-slate-200 text-sm font-semibold">
              Worker Training Matrix
            </div>
            <div className="text-[11px] text-slate-500">
              Click the checkboxes to mark modules complete per worker.
            </div>
          </div>
        </div>

        {filteredWorkforce.length === 0 ? (
          <p className="text-sm text-slate-500">
            No workers match the current filters. Check your Workforce
            data for buildings and roles.
          </p>
        ) : activeModules.length === 0 ? (
          <p className="text-sm text-slate-500">
            No active modules. Activate or create training modules to
            track compliance.
          </p>
        ) : (
          <div className="overflow-auto max-h-[520px]">
            <table className="min-w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60">
                  <th className="px-3 py-2 text-[11px] text-slate-400">
                    Worker
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400">
                    Role
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400">
                    Building
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    Required / Completed
                  </th>
                  <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                    %
                  </th>
                  {displayModules.map((m) => (
                    <th
                      key={m.id}
                      className="px-3 py-2 text-[11px] text-slate-400 text-center"
                    >
                      {m.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workerComplianceRows.map((row) => {
                  const w = row.worker;
                  return (
                    <tr
                      key={w.id}
                      className="border-b border-slate-800/60 hover:bg-slate-900/60"
                    >
                      <td className="px-3 py-2 text-slate-100">
                        {w.name}
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {w.role || "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {w.building || "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-200">
                        {row.requiredCount} / {row.completedCount}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={
                            row.status === "Compliant"
                              ? "text-emerald-300"
                              : row.status === "Partial"
                              ? "text-amber-300"
                              : row.status === "Not Started"
                              ? "text-rose-300"
                              : "text-slate-300"
                          }
                        >
                          {row.percent}%
                        </span>
                      </td>
                      {displayModules.map((m) => {
                        const requiredForThisWorker =
                          getRequiredModulesForWorker(w).some(
                            (rm) => rm.id === m.id
                          );
                        const comp = isModuleCompleted(w.id, m.id);
                        const checked = comp?.completed ?? false;
                        return (
                          <td
                            key={m.id}
                            className="px-3 py-2 text-center"
                          >
                            {requiredForThisWorker ? (
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  handleToggleCompletion(w, m)
                                }
                                className="h-3 w-3 rounded border-slate-500 bg-slate-950"
                              />
                            ) : (
                              <span className="text-[10px] text-slate-700">
                                —
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

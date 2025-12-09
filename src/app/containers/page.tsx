"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const CONTAINERS_KEY = "precisionpulse_containers";
const WORK_ORDERS_KEY = "precisionpulse_work_orders";
const WORKFORCE_KEY = "precisionpulse_workforce";

const BUILDINGS = ["DC1", "DC5", "DC11", "DC14", "DC18"];
const SHIFTS = ["1st", "2nd", "3rd", "4th"];

type WorkOrderStatus = "Pending" | "Active" | "Completed" | "Locked";

type WorkOrder = {
  id: string;
  code: string;
  building: string;
  shift: string;
  status: WorkOrderStatus;
  createdAt: string;
};

type WorkerAssignment = {
  id: string;
  workerId: string; // link to workforce
  workerName: string;
  role?: string;
  minutesWorked: number;
  percentContribution: number;
  payout: number;
};

type ContainerRecord = {
  id: string;
  workOrderId?: string;
  building: string;
  shift: string;
  containerNo: string;
  piecesTotal: number;
  skusTotal: number;
  containerPayTotal: number;
  createdAt: string;
  workers: WorkerAssignment[];
};

type WorkerFormRow = {
  workerId: string;
  minutesWorked: string;
  percentContribution: string;
};

type WorkforcePerson = {
  id: string;
  name: string;
  role?: string;
  building?: string;
};

// ---- PAY SCALE ----
function calculateContainerPay(pieces: number): number {
  if (pieces <= 0) return 0;
  if (pieces <= 500) return 100;
  if (pieces <= 1500) return 130;
  if (pieces <= 3500) return 180;
  if (pieces <= 5500) return 230;
  if (pieces <= 7500) return 280;
  return 280 + 0.05 * (pieces - 7500);
}

// Normalize any old container records in localStorage
function normalizeContainer(raw: any): ContainerRecord {
  const pieces = Number(raw?.piecesTotal ?? 0) || 0;
  const skus = Number(raw?.skusTotal ?? 0) || 0;

  const pay =
    typeof raw?.containerPayTotal === "number"
      ? raw.containerPayTotal
      : calculateContainerPay(pieces);

  const workersRaw: any[] = Array.isArray(raw?.workers)
    ? raw.workers
    : [];

  const workers: WorkerAssignment[] = workersRaw.map((w, idx) => ({
    id: String(w.id ?? `worker-${idx}-${raw?.id ?? Date.now()}`),
    workerId: String(w.workerId ?? ""),
    workerName: String(w.workerName ?? w.name ?? ""),
    role: w.role ?? "",
    minutesWorked: Number(w.minutesWorked ?? 0) || 0,
    percentContribution: Number(w.percentContribution ?? 0) || 0,
    payout: Number(w.payout ?? 0) || 0,
  }));

  return {
    id: String(raw?.id ?? Date.now()),
    workOrderId: raw?.workOrderId,
    building: raw?.building ?? "DC1",
    shift: raw?.shift ?? "1st",
    containerNo: raw?.containerNo ?? "",
    piecesTotal: pieces,
    skusTotal: skus,
    containerPayTotal: pay,
    createdAt: raw?.createdAt ?? new Date().toISOString(),
    workers,
  };
}

// Normalize workforce data from Workforce page
function normalizeWorkforce(raw: any[]): WorkforcePerson[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((w) => ({
    id: String(w.id ?? w.workerId ?? w.email ?? w.name ?? ""),
    name: String(w.fullName ?? w.name ?? w.displayName ?? w.email ?? "Unknown"),
    role: w.role ?? w.position ?? "",
    building: w.building ?? w.assignedBuilding ?? "",
  }));
}

export default function ContainersPage() {
  const [containers, setContainers] = useState<ContainerRecord[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [workforce, setWorkforce] = useState<WorkforcePerson[]>([]);

  // Create container form
  const [building, setBuilding] = useState(BUILDINGS[0]);
  const [shift, setShift] = useState(SHIFTS[0]);
  const [containerNo, setContainerNo] = useState("");
  const [piecesTotal, setPiecesTotal] = useState("");
  const [skusTotal, setSkusTotal] = useState("");
  const [workOrderId, setWorkOrderId] = useState<string>("");

  // Lumpers on CREATE (up to 4 rows)
  const [createWorkers, setCreateWorkers] = useState<WorkerFormRow[]>([
    { workerId: "", minutesWorked: "", percentContribution: "" },
    { workerId: "", minutesWorked: "", percentContribution: "" },
    { workerId: "", minutesWorked: "", percentContribution: "" },
    { workerId: "", minutesWorked: "", percentContribution: "" },
  ]);

  // Filters
  const [filterBuilding, setFilterBuilding] = useState<string>("ALL");
  const [filterWorkOrder, setFilterWorkOrder] = useState<string>("ALL");

  // Editing existing container’s workers
  const [editingContainerId, setEditingContainerId] = useState<string | null>(
    null
  );
  const [editWorkers, setEditWorkers] = useState<WorkerFormRow[]>([]);

  // NEW: editing container info (number, pieces, etc.)
  const [editingInfoId, setEditingInfoId] = useState<string | null>(null);
  const [editInfo, setEditInfo] = useState<{
    containerNo: string;
    piecesTotal: string;
    skusTotal: string;
    building: string;
    shift: string;
    workOrderId: string;
  }>({
    containerNo: "",
    piecesTotal: "",
    skusTotal: "",
    building: BUILDINGS[0],
    shift: SHIFTS[0],
    workOrderId: "",
  });

  const [workerError, setWorkerError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);

  // ---- LOAD DATA ----
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(CONTAINERS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const normalized = Array.isArray(parsed)
          ? parsed.map(normalizeContainer)
          : [];
        setContainers(normalized);
      }
    } catch (e) {
      console.error("Failed to load containers", e);
    }

    try {
      const raw = window.localStorage.getItem(WORK_ORDERS_KEY);
      if (raw) setWorkOrders(JSON.parse(raw));
    } catch (e) {
      console.error("Failed to load work orders", e);
    }

    try {
      const raw = window.localStorage.getItem(WORKFORCE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setWorkforce(normalizeWorkforce(parsed));
      }
    } catch (e) {
      console.error("Failed to load workforce", e);
    }
  }, []);

  function saveContainers(next: ContainerRecord[]) {
    setContainers(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CONTAINERS_KEY, JSON.stringify(next));
    }
  }

  // ---- HELPERS ----
  function workOrderLabel(id?: string) {
    if (!id) return "Unassigned";
    const wo = workOrders.find((w) => w.id === id);
    if (!wo) return "Unknown WO";
    return `${wo.code} • ${wo.building} • ${wo.shift}`;
  }

  function findWorkforcePersonById(
    id: string | undefined
  ): WorkforcePerson | undefined {
    if (!id) return undefined;
    return workforce.find((w) => w.id === id);
  }

  function computeTotalPercentFromRows(rows: WorkerFormRow[]): number {
    return rows.reduce((sum, row) => {
      const p = Number(row.percentContribution || "0") || 0;
      return sum + p;
    }, 0);
  }

  // ---- CREATE CONTAINER (WITH LUMPERS) ----
  function handleCreateContainer(e: any) {
    e.preventDefault();
    setError(null);
    setWorkerError(null);
    setInfoError(null);

    if (!containerNo.trim()) {
      setError("Container number is required.");
      return;
    }

    const pieces = parseInt(piecesTotal || "0", 10);
    const skus = parseInt(skusTotal || "0", 10);
    if (!pieces || pieces <= 0) {
      setError("Pieces must be a positive number.");
      return;
    }
    if (!skus || skus <= 0) {
      setError("SKUs must be a positive number.");
      return;
    }

    const payTotal = calculateContainerPay(pieces);

    // Build workers from createWorkers rows
    const cleanedRows = createWorkers
      .map((row) => ({
        workerId: row.workerId.trim(),
        minutesWorked: row.minutesWorked.trim(),
        percentContribution: row.percentContribution.trim(),
      }))
      .filter(
        (row) =>
          row.workerId ||
          row.minutesWorked ||
          row.percentContribution
      );

    let workers: WorkerAssignment[] = [];
    if (cleanedRows.length > 0) {
      const totalPercent = computeTotalPercentFromRows(cleanedRows);
      if (totalPercent !== 100) {
        setWorkerError(
          "Contribution percentages must add up to exactly 100% for assigned workers."
        );
        return;
      }

      workers = cleanedRows
        .map((row, idx) => {
          const person = findWorkforcePersonById(row.workerId);
          if (!person) return null;

          const minutes = Number(row.minutesWorked || "0") || 0;
          const percent = Number(row.percentContribution || "0") || 0;

          return {
            id: `new-${Date.now()}-${idx}`,
            workerId: person.id,
            workerName: person.name,
            role: person.role ?? "",
            minutesWorked: minutes,
            percentContribution: percent,
            payout: (percent / 100) * payTotal,
          } as WorkerAssignment;
        })
        .filter(Boolean) as WorkerAssignment[];

      if (workers.length === 0) {
        setWorkerError(
          "Selected workers must exist in Workforce. Please add them to Workforce first."
        );
        return;
      }
    }

    const now = new Date().toISOString();

    const newContainer: ContainerRecord = {
      id: `${Date.now()}`,
      workOrderId: workOrderId || undefined,
      building,
      shift,
      containerNo: containerNo.trim(),
      piecesTotal: pieces,
      skusTotal: skus,
      containerPayTotal: payTotal,
      createdAt: now,
      workers,
    };

    const next = [newContainer, ...containers];
    saveContainers(next);

    // reset container fields
    setContainerNo("");
    setPiecesTotal("");
    setSkusTotal("");
    // keep building/shift/workOrder

    // reset worker rows
    setCreateWorkers([
      { workerId: "", minutesWorked: "", percentContribution: "" },
      { workerId: "", minutesWorked: "", percentContribution: "" },
      { workerId: "", minutesWorked: "", percentContribution: "" },
      { workerId: "", minutesWorked: "", percentContribution: "" },
    ]);
  }

  function updateCreateWorkerRow(
    index: number,
    field: keyof WorkerFormRow,
    value: string
  ) {
    setCreateWorkers((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  // ---- FILTERED LIST ----
  const filteredContainers = useMemo(() => {
    return containers.filter((c) => {
      if (filterBuilding !== "ALL" && c.building !== filterBuilding) {
        return false;
      }
      if (
        filterWorkOrder !== "ALL" &&
        (c.workOrderId || "NONE") !== filterWorkOrder
      ) {
        return false;
      }
      return true;
    });
  }, [containers, filterBuilding, filterWorkOrder]);

  // ---- EDIT EXISTING CONTAINER WORKERS (ALSO USE WORKFORCE) ----
  function startEditingContainer(container: ContainerRecord) {
    setWorkerError(null);
    setEditingContainerId(container.id);

    if (container.workers && container.workers.length > 0) {
      const rows: WorkerFormRow[] = container.workers.map((w) => ({
        workerId: w.workerId || "",
        minutesWorked: String(w.minutesWorked || ""),
        percentContribution: String(w.percentContribution || ""),
      }));
      while (rows.length < 4) {
        rows.push({
          workerId: "",
          minutesWorked: "",
          percentContribution: "",
        });
      }
      setEditWorkers(rows);
    } else {
      setEditWorkers([
        { workerId: "", minutesWorked: "", percentContribution: "" },
        { workerId: "", minutesWorked: "", percentContribution: "" },
        { workerId: "", minutesWorked: "", percentContribution: "" },
        { workerId: "", minutesWorked: "", percentContribution: "" },
      ]);
    }
  }

  function updateEditWorkerRow(
    index: number,
    field: keyof WorkerFormRow,
    value: string
  ) {
    setEditWorkers((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function computeDisplayPercentForContainer(c: ContainerRecord): number {
    if (editingContainerId === c.id) {
      return computeTotalPercentFromRows(editWorkers);
    }
    if (!c.workers || c.workers.length === 0) return 0;
    return c.workers.reduce(
      (sum, w) => sum + (w.percentContribution || 0),
      0
    );
  }

  function handleSaveWorkers(container: ContainerRecord) {
    setWorkerError(null);

    if (editingContainerId !== container.id) return;

    const cleanedRows = editWorkers
      .map((row) => ({
        workerId: row.workerId.trim(),
        minutesWorked: row.minutesWorked.trim(),
        percentContribution: row.percentContribution.trim(),
      }))
      .filter(
        (row) =>
          row.workerId ||
          row.minutesWorked ||
          row.percentContribution
      );

    if (cleanedRows.length === 0) {
      // Clear workers
      const updated: ContainerRecord = {
        ...container,
        workers: [],
        containerPayTotal: calculateContainerPay(container.piecesTotal),
      };
      const next = containers.map((c) =>
        c.id === container.id ? updated : c
      );
      saveContainers(next);
      return;
    }

    const totalPercent = computeTotalPercentFromRows(cleanedRows);
    if (totalPercent !== 100) {
      setWorkerError(
        "Contribution percentages must add up to exactly 100% before saving."
      );
      return;
    }

    const payTotal = calculateContainerPay(container.piecesTotal);

    const workers: WorkerAssignment[] = [];
    cleanedRows.forEach((row, idx) => {
      const person = findWorkforcePersonById(row.workerId);
      if (!person) return;

      const minutes = Number(row.minutesWorked || "0") || 0;
      const percent = Number(row.percentContribution || "0") || 0;

      workers.push({
        id: `${container.id}-worker-${idx}`,
        workerId: person.id,
        workerName: person.name,
        role: person.role ?? "",
        minutesWorked: minutes,
        percentContribution: percent,
        payout: (percent / 100) * payTotal,
      });
    });

    if (workers.length === 0) {
      setWorkerError(
        "All selected workers must exist in Workforce. Add them there first."
      );
      return;
    }

    const updated: ContainerRecord = {
      ...container,
      workers,
      containerPayTotal: payTotal,
    };

    const next = containers.map((c) =>
      c.id === container.id ? updated : c
    );
    saveContainers(next);
  }

  // ---- NEW: EDIT CONTAINER INFO (NUMBER, PIECES, SKUS, BUILDING, SHIFT, WO) ----
  function startEditContainerInfo(container: ContainerRecord) {
    setInfoError(null);
    setEditingInfoId(container.id);
    setEditInfo({
      containerNo: container.containerNo,
      piecesTotal: String(container.piecesTotal || ""),
      skusTotal: String(container.skusTotal || ""),
      building: container.building,
      shift: container.shift,
      workOrderId: container.workOrderId || "",
    });
  }

  function handleSaveContainerInfo(container: ContainerRecord) {
    setInfoError(null);

    if (editingInfoId !== container.id) return;

    if (!editInfo.containerNo.trim()) {
      setInfoError("Container number is required.");
      return;
    }

    const pieces = parseInt(editInfo.piecesTotal || "0", 10);
    const skus = parseInt(editInfo.skusTotal || "0", 10);
    if (!pieces || pieces <= 0) {
      setInfoError("Pieces must be a positive number.");
      return;
    }
    if (!skus || skus <= 0) {
      setInfoError("SKUs must be a positive number.");
      return;
    }

    const payTotal = calculateContainerPay(pieces);

    // Recalculate payouts for existing workers with new container pay
    const updatedWorkers = (container.workers || []).map((w) => ({
      ...w,
      payout: (w.percentContribution / 100) * payTotal,
    }));

    const updated: ContainerRecord = {
      ...container,
      containerNo: editInfo.containerNo.trim(),
      piecesTotal: pieces,
      skusTotal: skus,
      building: editInfo.building,
      shift: editInfo.shift,
      workOrderId: editInfo.workOrderId || undefined,
      containerPayTotal: payTotal,
      workers: updatedWorkers,
    };

    const next = containers.map((c) =>
      c.id === container.id ? updated : c
    );
    saveContainers(next);
    setEditingInfoId(null);
  }

  function handleDeleteContainer(containerId: string) {
    setInfoError(null);
    setWorkerError(null);

    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "Are you sure you want to delete this container and all its payouts?"
      );
      if (!ok) return;
    }

    const next = containers.filter((c) => c.id !== containerId);
    saveContainers(next);

    if (editingContainerId === containerId) setEditingContainerId(null);
    if (editingInfoId === containerId) setEditingInfoId(null);
  }

  // Workforce dropdown options
  const workforceOptions = workforce;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">
            Containers & Lumpers
          </h1>
          <p className="text-sm text-slate-400">
            Create containers, link them to work orders, assign lumpers
            from Workforce, and edit or delete containers when needed.
          </p>
        </div>
        <Link
          href="/"
          className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
        >
          ← Back to Dashboard
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create container + assign lumpers */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-100">
            Add Container & Assign Lumpers
          </h2>
          {error && (
            <div className="text-xs text-red-300 bg-red-950/40 border border-red-800 rounded px-3 py-2">
              {error}
            </div>
          )}
          {workerError && (
            <div className="text-xs text-red-300 bg-red-950/40 border border-red-800 rounded px-3 py-2">
              {workerError}
            </div>
          )}
          <form
            onSubmit={handleCreateContainer}
            className="space-y-3 text-sm"
          >
            <div>
              <label className="block text-xs text-slate-300 mb-1">
                Container Number
              </label>
              <input
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
                value={containerNo}
                onChange={(e) => setContainerNo(e.target.value)}
                placeholder="e.g. MSKU1234567"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Pieces Total
                </label>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
                  value={piecesTotal}
                  onChange={(e) => setPiecesTotal(e.target.value)}
                  placeholder="e.g. 3600"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  SKUs Total
                </label>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
                  value={skusTotal}
                  onChange={(e) => setSkusTotal(e.target.value)}
                  placeholder="e.g. 45"
                />
              </div>
            </div>

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

            <div>
              <label className="block text-xs text-slate-300 mb-1">
                Work Order (optional)
              </label>
              <select
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
                value={workOrderId}
                onChange={(e) => setWorkOrderId(e.target.value)}
              >
                <option value="">Unassigned</option>
                {workOrders.map((wo) => (
                  <option key={wo.id} value={wo.id}>
                    {wo.code} • {wo.building} • {wo.shift}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Tie this container to a specific work order (optional).
              </p>
            </div>

            {/* Assign lumpers directly here */}
            <div className="mt-3 border-t border-slate-800 pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-300">
                  Assign Lumpers (from Workforce)
                </div>
                <div className="text-[11px] text-slate-500">
                  Total % must equal 100% if any workers are assigned.
                </div>
              </div>

              <div className="space-y-2">
                {createWorkers.map((row, idx) => (
                  <div
                    key={idx}
                    className="bg-slate-900 border border-slate-800 rounded-lg p-2 space-y-1"
                  >
                    <div className="flex gap-2">
                      <select
                        className="flex-1 rounded bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                        value={row.workerId}
                        onChange={(e) =>
                          updateCreateWorkerRow(
                            idx,
                            "workerId",
                            e.target.value
                          )
                        }
                      >
                        <option value="">Select worker</option>
                        {workforceOptions.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                            {w.role ? ` • ${w.role}` : ""}
                            {w.building ? ` • ${w.building}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <input
                        className="flex-1 rounded bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                        placeholder="Minutes worked"
                        value={row.minutesWorked}
                        onChange={(e) =>
                          updateCreateWorkerRow(
                            idx,
                            "minutesWorked",
                            e.target.value
                          )
                        }
                      />
                      <input
                        className="w-28 rounded bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                        placeholder="% contribution"
                        value={row.percentContribution}
                        onChange={(e) =>
                          updateCreateWorkerRow(
                            idx,
                            "percentContribution",
                            e.target.value
                          )
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="mt-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-sm font-medium text-white px-4 py-2"
            >
              Save Container
            </button>
          </form>
        </div>

        {/* Containers list + lumpers editing (still workforce-based) */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 lg:col-span-2 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-100">
              Containers & Lumpers
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
                value={filterWorkOrder}
                onChange={(e) => setFilterWorkOrder(e.target.value)}
              >
                <option value="ALL">All Work Orders</option>
                <option value="NONE">Unassigned</option>
                {workOrders.map((wo) => (
                  <option key={wo.id} value={wo.id}>
                    {wo.code} • {wo.building} • {wo.shift}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {infoError && (
            <div className="text-[11px] text-red-300 bg-red-950/40 border border-red-800 rounded px-3 py-2 mb-2">
              {infoError}
            </div>
          )}
          {workerError && !error && (
            <div className="text-[11px] text-red-300 bg-red-950/40 border border-red-800 rounded px-3 py-2 mb-2">
              {workerError}
            </div>
          )}

          {filteredContainers.length === 0 ? (
            <p className="text-sm text-slate-500">
              No containers match the current filters.
            </p>
          ) : (
            <div className="space-y-2 text-xs max-h-[520px] overflow-auto pr-1">
              {filteredContainers.map((c) => {
                const totalPercent = computeDisplayPercentForContainer(c);
                const payTotal = calculateContainerPay(c.piecesTotal);
                const isEditingLumpers = editingContainerId === c.id;
                const isEditingInfo = editingInfoId === c.id;

                return (
                  <div
                    key={c.id}
                    className="border border-slate-800 rounded-xl bg-slate-950 p-3 space-y-2"
                  >
                    {/* Header row */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="text-slate-100 text-sm font-semibold">
                          {c.containerNo}
                        </div>
                        <div className="text-slate-400">
                          {c.piecesTotal} pieces · {c.skusTotal} SKUs
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {c.building} • {c.shift} Shift •{" "}
                          {c.createdAt.slice(0, 10)}
                        </div>
                      </div>
                      <div className="text-right text-[11px] space-y-1">
                        <div className="text-slate-400">
                          Work Order:
                          <br />
                          <span className="text-sky-300">
                            {workOrderLabel(c.workOrderId)}
                          </span>
                        </div>
                        <div className="text-slate-400">
                          Container Pay:
                          <br />
                          <span className="text-emerald-300">
                            ${payTotal.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex gap-1 justify-end mt-1">
                          <button
                            type="button"
                            onClick={() =>
                              isEditingInfo
                                ? setEditingInfoId(null)
                                : startEditContainerInfo(c)
                            }
                            className="text-[11px] px-2 py-0.5 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                          >
                            {isEditingInfo ? "Cancel Edit" : "Edit Info"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteContainer(c.id)}
                            className="text-[11px] px-2 py-0.5 rounded-full border border-red-700 bg-red-950 text-red-200 hover:bg-red-900"
                          >
                            Delete
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            isEditingLumpers
                              ? setEditingContainerId(null)
                              : startEditingContainer(c)
                          }
                          className="mt-1 text-[11px] px-2 py-0.5 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                        >
                          {isEditingLumpers
                            ? "Hide Lumpers"
                            : "View / Edit Lumpers"}
                        </button>
                      </div>
                    </div>

                    {/* Edit container info section */}
                    {isEditingInfo && (
                      <div className="pt-3 border-t border-slate-800 space-y-2">
                        <div className="text-[11px] text-slate-300 mb-1">
                          Edit Container Info
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Container Number
                            </label>
                            <input
                              className="w-full rounded bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                              value={editInfo.containerNo}
                              onChange={(e) =>
                                setEditInfo((prev) => ({
                                  ...prev,
                                  containerNo: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Pieces Total
                            </label>
                            <input
                              type="number"
                              min={1}
                              className="w-full rounded bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                              value={editInfo.piecesTotal}
                              onChange={(e) =>
                                setEditInfo((prev) => ({
                                  ...prev,
                                  piecesTotal: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              SKUs Total
                            </label>
                            <input
                              type="number"
                              min={1}
                              className="w-full rounded bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                              value={editInfo.skusTotal}
                              onChange={(e) =>
                                setEditInfo((prev) => ({
                                  ...prev,
                                  skusTotal: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Building
                            </label>
                            <select
                              className="w-full rounded bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                              value={editInfo.building}
                              onChange={(e) =>
                                setEditInfo((prev) => ({
                                  ...prev,
                                  building: e.target.value,
                                }))
                              }
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
                              className="w-full rounded bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                              value={editInfo.shift}
                              onChange={(e) =>
                                setEditInfo((prev) => ({
                                  ...prev,
                                  shift: e.target.value,
                                }))
                              }
                            >
                              {SHIFTS.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Work Order
                            </label>
                            <select
                              className="w-full rounded bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                              value={editInfo.workOrderId}
                              onChange={(e) =>
                                setEditInfo((prev) => ({
                                  ...prev,
                                  workOrderId: e.target.value,
                                }))
                              }
                            >
                              <option value="">Unassigned</option>
                              {workOrders.map((wo) => (
                                <option key={wo.id} value={wo.id}>
                                  {wo.code} • {wo.building} • {wo.shift}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="flex justify-end gap-2 mt-2">
                          <button
                            type="button"
                            onClick={() => setEditingInfoId(null)}
                            className="rounded-lg border border-slate-700 bg-slate-900 text-[11px] text-slate-200 px-3 py-1 hover:bg-slate-800"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveContainerInfo(c)}
                            className="rounded-lg bg-sky-600 hover:bg-sky-500 text-[11px] font-medium text-white px-3 py-1"
                          >
                            Save Info
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Lumper editor (uses Workforce) */}
                    {isEditingLumpers && (
                      <div className="pt-3 border-t border-slate-800 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-[11px] text-slate-300">
                            Lumpers / Worker Contributions (from Workforce)
                          </div>
                          <div className="text-[11px] text-slate-400">
                            Total %:{" "}
                            <span
                              className={
                                totalPercent === 100
                                  ? "text-emerald-300"
                                  : "text-amber-300"
                              }
                            >
                              {totalPercent}%
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {editWorkers.map((row, idx) => (
                            <div
                              key={idx}
                              className="bg-slate-900 border border-slate-800 rounded-lg p-2 space-y-1"
                            >
                              <div className="flex gap-2">
                                <select
                                  className="flex-1 rounded bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                                  value={row.workerId}
                                  onChange={(e) =>
                                    updateEditWorkerRow(
                                      idx,
                                      "workerId",
                                      e.target.value
                                    )
                                  }
                                >
                                  <option value="">Select worker</option>
                                  {workforceOptions.map((w) => (
                                    <option key={w.id} value={w.id}>
                                      {w.name}
                                      {w.role ? ` • ${w.role}` : ""}
                                      {w.building
                                        ? ` • ${w.building}`
                                        : ""}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex gap-2">
                                <input
                                  className="flex-1 rounded bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                                  placeholder="Minutes worked"
                                  value={row.minutesWorked}
                                  onChange={(e) =>
                                    updateEditWorkerRow(
                                      idx,
                                      "minutesWorked",
                                      e.target.value
                                    )
                                  }
                                />
                                <input
                                  className="w-28 rounded bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                                  placeholder="% contribution"
                                  value={row.percentContribution}
                                  onChange={(e) =>
                                    updateEditWorkerRow(
                                      idx,
                                      "percentContribution",
                                      e.target.value
                                    )
                                  }
                                />
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="flex items-center justify-between mt-2">
                          <div className="text-[11px] text-slate-500">
                            Payouts will be calculated from container pay
                            and each worker&apos;s % contribution. Workers
                            must exist in Workforce.
                          </div>
                          <button
                            type="button"
                            onClick={() => handleSaveWorkers(c)}
                            className="rounded-lg bg-sky-600 hover:bg-sky-500 text-[11px] font-medium text-white px-3 py-1"
                          >
                            Save Lumpers & Payouts
                          </button>
                        </div>

                        {/* Saved workers summary */}
                        {c.workers && c.workers.length > 0 && (
                          <div className="mt-2 border-t border-slate-800 pt-2">
                            <div className="text-[11px] text-slate-300 mb-1">
                              Saved Payouts
                            </div>
                            <div className="space-y-1">
                              {c.workers.map((w) => (
                                <div
                                  key={w.id}
                                  className="flex items-center justify-between text-[11px] bg-slate-900 border border-slate-800 rounded-lg px-2 py-1"
                                >
                                  <div>
                                    <span className="text-slate-100">
                                      {w.workerName}
                                    </span>
                                    {w.role && (
                                      <span className="text-slate-400">
                                        {" "}
                                        • {w.role}
                                      </span>
                                    )}
                                    <div className="text-slate-400">
                                      {w.minutesWorked} min ·{" "}
                                      {w.percentContribution}% share
                                    </div>
                                  </div>
                                  <div className="text-emerald-300">
                                    ${w.payout.toFixed(2)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

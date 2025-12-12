"use client";

import { useEffect, useMemo, useState, FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { useRouter } from "next/navigation";
import { BUILDINGS } from "@/lib/buildings";

const CONTAINERS_KEY = "precisionpulse_containers";

const SHIFTS = ["1st", "2nd", "3rd", "4th"] as const;
type ShiftName = (typeof SHIFTS)[number];

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
  work_date: string | null; // YYYY-MM-DD
  container_no: string;
  pieces_total: number;
  skus_total: number;
  pay_total: number;
  workers: WorkerContribution[];
  damage_pieces: number;
  rework_pieces: number;
  work_order_id: string | null;
};

type EditFormState = {
  id?: string;
  building: string;
  shift: ShiftName;
  workDate: string; // YYYY-MM-DD
  containerNo: string;
  piecesTotal: number;
  skusTotal: number;
  workOrderId: string | null;
  workers: WorkerContribution[];
};

type WorkOrderOption = {
  id: string;
  name: string;
  building: string;
  status: string;
};

type WorkforceWorker = {
  id: string;
  fullName: string;
  building: string | null;
  shift: string | null;
  active: boolean;
};

function calculateContainerPay(pieces: number): number {
  if (pieces <= 0) return 0;
  if (pieces <= 500) return 100;
  if (pieces <= 1500) return 130;
  if (pieces <= 3500) return 180;
  if (pieces <= 5500) return 230;
  if (pieces <= 7500) return 280;
  const extra = pieces - 7500;
  return 280 + extra * 0.05;
}

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

// Try multiple column names so it works even if your table uses different names
function mapWorkforceRow(row: any): WorkforceWorker {
  const fullName =
    (row.full_name as string | null) ??
    (row.fullName as string | null) ??
    (row.name as string | null) ??
    (row.worker_name as string | null) ??
    "Unknown";

  const building =
    (row.building as string | null) ??
    (row.dc as string | null) ??
    (row.location as string | null) ??
    null;

  const shift =
    (row.shift as string | null) ??
    (row.shift_name as string | null) ??
    (row.shiftName as string | null) ??
    null;

  const activeRaw =
    (row.active as boolean | null) ??
    (row.is_active as boolean | null) ??
    null;

  // if table uses a status string instead of boolean
  const statusRaw =
    (row.status as string | null) ??
    (row.employment_status as string | null) ??
    null;

  const active =
    typeof activeRaw === "boolean"
      ? activeRaw
      : statusRaw
      ? String(statusRaw).toLowerCase().includes("active")
      : true;

  return {
    id: String(row.id ?? row.worker_id ?? crypto.randomUUID()),
    fullName: String(fullName).trim(),
    building,
    shift,
    active,
  };
}

export default function ContainersPage() {
  const currentUser = useCurrentUser();
  const router = useRouter();

  const isLead = currentUser?.accessRole === "Lead";
  const leadBuilding = currentUser?.building || "";

  const [buildingFilter, setBuildingFilter] = useState<string>(() =>
    isLead && leadBuilding ? leadBuilding : "ALL"
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderOption[]>([]);

  // Grouping UI state
  const [expandedWorkOrderId, setExpandedWorkOrderId] = useState<string | null>(
    null
  );
  const [showUnassigned, setShowUnassigned] = useState<boolean>(true);

  // Workforce list (for dropdown worker picking)
  const [workforce, setWorkforce] = useState<WorkforceWorker[]>([]);
  const [workforceLoading, setWorkforceLoading] = useState<boolean>(false);

  const [showForm, setShowForm] = useState(false);
  const [formState, setFormState] = useState<EditFormState>({
    building: currentUser?.building || BUILDINGS[0] || "DC18",
    shift: "1st",
    workDate: todayISODate(),
    containerNo: "",
    piecesTotal: 0,
    skusTotal: 0,
    workOrderId: null,
    workers: [
      { name: "", minutesWorked: 0, percentContribution: 0, payout: 0 },
      { name: "", minutesWorked: 0, percentContribution: 0, payout: 0 },
      { name: "", minutesWorked: 0, percentContribution: 0, payout: 0 },
      { name: "", minutesWorked: 0, percentContribution: 0, payout: 0 },
    ],
  });

  // lock filter for leads
  useEffect(() => {
    if (isLead && leadBuilding && buildingFilter !== leadBuilding) {
      setBuildingFilter(leadBuilding);
    }
  }, [isLead, leadBuilding, buildingFilter]);

  async function loadContainers() {
    if (!currentUser) return;

    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from("containers")
        .select("*")
        .order("created_at", { ascending: false });

      if (isLead && leadBuilding) {
        query = query.eq("building", leadBuilding);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error loading containers", error);
        setError("Failed to load containers from server.");
        return;
      }

      const rows: ContainerRow[] =
        (data as any as ContainerRow[])?.map((row) => ({
          ...row,
          workers: (row.workers || []) as WorkerContribution[],
          work_order_id: row.work_order_id ?? null,
          shift: (row.shift ?? null) as any,
          work_date: (row.work_date ?? null) as any,
        })) ?? [];

      setContainers(rows);

      // sync localStorage for dashboard/reports/work orders
      try {
        const mappedForLocal = rows.map((row) => ({
          id: row.id,
          building: row.building,
          shift: row.shift ?? "",
          date: row.work_date ?? row.created_at, // important for reports
          createdAt: row.created_at,
          containerNo: row.container_no,
          piecesTotal: row.pieces_total,
          skusTotal: row.skus_total,
          containerPayTotal: row.pay_total,
          workOrderId: row.work_order_id,
          workers: row.workers || [],
        }));
        if (typeof window !== "undefined") {
          window.localStorage.setItem(CONTAINERS_KEY, JSON.stringify(mappedForLocal));
        }
      } catch (e) {
        console.error("Failed to write containers to localStorage", e);
      }
    } catch (e) {
      console.error("Unexpected error loading containers", e);
      setError("Unexpected error loading containers.");
    } finally {
      setLoading(false);
    }
  }

  // Load containers on mount/user
  useEffect(() => {
    loadContainers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, isLead, leadBuilding]);

  // Load work orders
  useEffect(() => {
    if (!currentUser) return;

    async function loadWorkOrders() {
      try {
        const { data, error } = await supabase
          .from("work_orders")
          .select("id, building, status, work_order_code, created_at")
          .order("created_at", { ascending: false });

        if (error) {
          console.error("Error loading work orders", error);
          return;
        }

        const opts: WorkOrderOption[] =
          (data || []).map((row: any) => ({
            id: String(row.id),
            name:
              (row.work_order_code as string | null) ??
              `Work Order ${String(row.id).slice(-4)}`,
            building: (row.building as string | null) ?? (BUILDINGS[0] || "DC1"),
            status: (row.status as string | null) ?? "Pending",
          })) ?? [];

        setWorkOrders(opts);
      } catch (e) {
        console.error("Unexpected error loading work orders", e);
      }
    }

    loadWorkOrders();
  }, [currentUser]);

  // ✅ NEW: Load Workforce (for dropdown names)
  useEffect(() => {
    if (!currentUser) return;

    async function loadWorkforce() {
      setWorkforceLoading(true);
      try {
        // Adjust this table name if yours is different
        const { data, error } = await supabase
          .from("workforce")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) {
          console.error("Error loading workforce", error);
          return;
        }

        const mapped: WorkforceWorker[] = (data || [])
          .map(mapWorkforceRow)
          .filter((w) => w.fullName && w.fullName !== "Unknown");

        setWorkforce(mapped);
      } catch (e) {
        console.error("Unexpected error loading workforce", e);
      } finally {
        setWorkforceLoading(false);
      }
    }

    loadWorkforce();
  }, [currentUser]);

  const filteredContainers = useMemo(() => {
    let rows = [...containers];

    if (isLead && leadBuilding) {
      rows = rows.filter((c) => c.building === leadBuilding);
      return rows;
    }

    if (buildingFilter !== "ALL") {
      rows = rows.filter((c) => c.building === buildingFilter);
    }

    return rows;
  }, [containers, buildingFilter, isLead, leadBuilding]);

  const totalPieces = useMemo(
    () => filteredContainers.reduce((sum, c) => sum + (c.pieces_total || 0), 0),
    [filteredContainers]
  );

  const totalPay = useMemo(
    () => filteredContainers.reduce((sum, c) => sum + (Number(c.pay_total) || 0), 0),
    [filteredContainers]
  );

  function resetForm() {
    setFormState({
      building: currentUser?.building || BUILDINGS[0] || "DC18",
      shift: "1st",
      workDate: todayISODate(),
      containerNo: "",
      piecesTotal: 0,
      skusTotal: 0,
      workOrderId: null,
      workers: [
        { name: "", minutesWorked: 0, percentContribution: 0, payout: 0 },
        { name: "", minutesWorked: 0, percentContribution: 0, payout: 0 },
        { name: "", minutesWorked: 0, percentContribution: 0, payout: 0 },
        { name: "", minutesWorked: 0, percentContribution: 0, payout: 0 },
      ],
    });
  }

  function openNewForm() {
    resetForm();
    setShowForm(true);
  }

  function openEditForm(row: ContainerRow) {
    setFormState({
      id: row.id,
      building: row.building,
      shift: ((row.shift as any) || "1st") as ShiftName,
      workDate: (row.work_date ? String(row.work_date).slice(0, 10) : todayISODate()),
      containerNo: row.container_no,
      piecesTotal: row.pieces_total,
      skusTotal: row.skus_total,
      workOrderId: row.work_order_id ?? null,
      workers: (row.workers || [])
        .concat(
          Array(Math.max(0, 4 - (row.workers?.length || 0))).fill({
            name: "",
            minutesWorked: 0,
            percentContribution: 0,
            payout: 0,
          })
        )
        .slice(0, 4),
    });
    setShowForm(true);
  }

  function handleWorkerChange(index: number, field: keyof WorkerContribution, value: string) {
    setFormState((prev) => {
      const workers = [...prev.workers];
      const w = { ...workers[index] };

      if (field === "minutesWorked") w.minutesWorked = Number(value) || 0;
      else if (field === "percentContribution") w.percentContribution = Number(value) || 0;
      else if (field === "name") w.name = value;

      workers[index] = w;
      return { ...prev, workers };
    });
  }

  const { payForForm, workersWithPayout, percentSum } = useMemo(() => {
    const pieces = formState.piecesTotal || 0;
    const pay = calculateContainerPay(pieces);

    const workers = (formState.workers || []).map((w) => {
      const pct = w.percentContribution || 0;
      return { ...w, payout: (pay * pct) / 100 };
    });

    const sumPct = workers.reduce((sum, w) => sum + (w.percentContribution || 0), 0);

    return { payForForm: pay, workersWithPayout: workers, percentSum: sumPct };
  }, [formState.piecesTotal, formState.workers]);

  const isPercentValid = percentSum === 100 || percentSum === 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;

    setError(null);

    if (!formState.containerNo.trim()) return setError("Container number is required.");
    if (formState.piecesTotal <= 0) return setError("Pieces total must be greater than 0.");

    const finalWorkers = workersWithPayout.filter(
      (w) => w.name.trim() && w.percentContribution > 0
    );

    if (finalWorkers.length > 0 && !isPercentValid) {
      setError("Worker contribution percentages must total exactly 100%.");
      return;
    }

    setSaving(true);

    try {
      const effectiveBuilding = isLead && leadBuilding ? leadBuilding : formState.building;

      const payload: any = {
        building: effectiveBuilding,
        shift: formState.shift,
        work_date: formState.workDate,
        container_no: formState.containerNo.trim(),
        pieces_total: formState.piecesTotal,
        skus_total: formState.skusTotal,
        pay_total: payForForm,
        damage_pieces: 0,
        rework_pieces: 0,
        workers: finalWorkers,
        work_order_id: formState.workOrderId || null,
      };

      if (formState.id) {
        const { error } = await supabase.from("containers").update(payload).eq("id", formState.id);
        if (error) {
          console.error(error);
          return setError("Failed to update container.");
        }
      } else {
        const { error } = await supabase.from("containers").insert(payload);
        if (error) {
          console.error(error);
          return setError("Failed to create container.");
        }
      }

      await loadContainers();
      setShowForm(false);
      resetForm();
    } catch (e) {
      console.error("Unexpected error saving container", e);
      setError("Unexpected error saving container.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this container? This cannot be undone.")) return;
    setSaving(true);
    setError(null);

    try {
      const { error } = await supabase.from("containers").delete().eq("id", id);
      if (error) return setError("Failed to delete container.");

      const updated = containers.filter((c) => c.id !== id);
      setContainers(updated);

      try {
        const mappedForLocal = updated.map((row) => ({
          id: row.id,
          building: row.building,
          shift: row.shift ?? "",
          date: row.work_date ?? row.created_at,
          createdAt: row.created_at,
          containerNo: row.container_no,
          piecesTotal: row.pieces_total,
          skusTotal: row.skus_total,
          containerPayTotal: row.pay_total,
          workOrderId: row.work_order_id,
          workers: row.workers || [],
        }));
        if (typeof window !== "undefined") {
          window.localStorage.setItem(CONTAINERS_KEY, JSON.stringify(mappedForLocal));
        }
      } catch (e) {
        console.error("Failed to write containers to localStorage", e);
      }
    } catch (e) {
      console.error("Unexpected error deleting container", e);
      setError("Unexpected error deleting container.");
    } finally {
      setSaving(false);
    }
  }

  // ✅ keep hooks above early return
  const workOrdersForBuilding = useMemo(
    () => workOrders.filter((wo) => wo.building === formState.building),
    [workOrders, formState.building]
  );

  const visibleWorkOrders = useMemo(() => {
    let list = [...workOrders];

    if (isLead && leadBuilding) {
      return list.filter((wo) => wo.building === leadBuilding);
    }

    if (buildingFilter !== "ALL") {
      list = list.filter((wo) => wo.building === buildingFilter);
    }

    return list;
  }, [workOrders, isLead, leadBuilding, buildingFilter]);

  const containersByWorkOrder = useMemo(() => {
    const map = new Map<string, ContainerRow[]>();
    for (const c of filteredContainers) {
      const key = c.work_order_id ? String(c.work_order_id) : "__unassigned__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => b.created_at.localeCompare(a.created_at));
      map.set(k, arr);
    }
    return map;
  }, [filteredContainers]);

  // ✅ NEW: workforce options filtered by form building + shift
  const workforceOptionsForForm = useMemo(() => {
    const b = (isLead && leadBuilding ? leadBuilding : formState.building) || "";
    const s = formState.shift || "";

    const list = workforce
      .filter((w) => w.active !== false)
      .filter((w) => {
        // match building if worker has one
        if (w.building && b && w.building !== b) return false;
        return true;
      })
      .filter((w) => {
        // match shift if worker has one
        if (w.shift && s && String(w.shift) !== String(s)) return false;
        return true;
      })
      .map((w) => w.fullName)
      .filter(Boolean);

    // de-dupe + sort
    return Array.from(new Set(list)).sort((a, b) => a.localeCompare(b));
  }, [workforce, formState.building, formState.shift, isLead, leadBuilding]);

  function toggleWorkOrder(id: string) {
    setExpandedWorkOrderId((prev) => (prev === id ? null : id));
  }

  function renderContainerTable(rows: ContainerRow[]) {
    return (
      <div className="overflow-x-auto text-xs">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] text-slate-400">
              <th className="text-left py-2 pr-3">Date</th>
              <th className="text-left py-2 pr-3">Building</th>
              <th className="text-left py-2 pr-3">Shift</th>
              <th className="text-left py-2 pr-3">Container #</th>
              <th className="text-right py-2 pr-3">Pieces</th>
              <th className="text-right py-2 pr-3">SKUs</th>
              <th className="text-right py-2 pr-3">Pay Total</th>
              <th className="text-left py-2 pr-3">Workers</th>
              <th className="text-right py-2 pl-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr
                key={c.id}
                className="border-b border-slate-800/60 hover:bg-slate-900/70"
              >
                <td className="py-2 pr-3 text-[11px] text-slate-400">
                  {(c.work_date ? String(c.work_date).slice(0, 10) : new Date(c.created_at).toISOString().slice(0, 10))}
                </td>
                <td className="py-2 pr-3 text-[11px] text-slate-200">{c.building}</td>
                <td className="py-2 pr-3 text-[11px] text-slate-200">{c.shift ?? "—"}</td>
                <td className="py-2 pr-3 text-[11px] text-slate-200">{c.container_no}</td>
                <td className="py-2 pr-3 text-right text-[11px] text-slate-200">{c.pieces_total}</td>
                <td className="py-2 pr-3 text-right text-[11px] text-slate-200">{c.skus_total}</td>
                <td className="py-2 pr-3 text-right text-[11px] text-emerald-300">
                  ${Number(c.pay_total).toFixed(2)}
                </td>
                <td className="py-2 pr-3 text-[11px] text-slate-300">
                  {(c.workers || [])
                    .filter((w) => w.name)
                    .map(
                      (w) =>
                        `${w.name} (${w.percentContribution}% · $${w.payout.toFixed(2)})`
                    )
                    .join(", ") || "—"}
                </td>
                <td className="py-2 pl-3 text-right">
                  <div className="inline-flex gap-2">
                    <button
                      className="px-3 py-1 rounded-lg bg-slate-800 text-[11px] text-slate-100 hover:bg-slate-700"
                      onClick={() => openEditForm(c)}
                    >
                      Edit
                    </button>
                    <button
                      className="px-3 py-1 rounded-lg bg-rose-700 text-[11px] text-white hover:bg-rose-600"
                      onClick={() => handleDelete(c.id)}
                      disabled={saving}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

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
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">Containers</h1>
            <p className="text-sm text-slate-400">
              Live container tracking with automatic pay scale, work orders, and worker contributions.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/")}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] text-slate-200 hover:bg-slate-800"
            >
              ← Back to Dashboard
            </button>
            <button
              onClick={openNewForm}
              className="rounded-lg bg-sky-600 hover:bg-sky-500 text-[11px] font-medium text-white px-4 py-2"
            >
              + New Container
            </button>
          </div>
        </div>

        {/* Filters + summary */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Building:</span>
            <select
              className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-50"
              value={buildingFilter}
              onChange={(e) => setBuildingFilter(e.target.value)}
              disabled={isLead && !!leadBuilding}
            >
              {!isLead && <option value="ALL">All Buildings</option>}
              {BUILDINGS.map((b) => {
                if (isLead && leadBuilding && b !== leadBuilding) return null;
                return (
                  <option key={b} value={b}>
                    {b}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="text-slate-400">
              Containers: <span className="text-slate-100">{filteredContainers.length}</span>
            </div>
            <div className="text-slate-400">
              Total Pieces: <span className="text-slate-100">{totalPieces}</span>
            </div>
            <div className="text-slate-400">
              Total Pay: <span className="text-emerald-300">${totalPay.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-700 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-100">
            {error}
          </div>
        )}

        {/* Grouped View */}
        <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 shadow-sm shadow-slate-900/60">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-100">Containers by Work Order</h2>
            {loading && <div className="text-[11px] text-slate-400">Loading…</div>}
          </div>

          {/* Unassigned */}
          {(() => {
            const unassigned = containersByWorkOrder.get("__unassigned__") || [];
            if (unassigned.length === 0) return null;

            return (
              <div className="mb-3 rounded-xl border border-slate-800 bg-slate-950">
                <button
                  type="button"
                  onClick={() => setShowUnassigned((p) => !p)}
                  className="w-full flex items-center justify-between px-3 py-2 text-left"
                >
                  <div>
                    <div className="text-slate-100 text-sm font-semibold">Unassigned Containers</div>
                    <div className="text-[11px] text-slate-500">Containers not linked to a work order.</div>
                  </div>
                  <div className="text-[10px] text-slate-500">{showUnassigned ? "▴" : "▾"}</div>
                </button>
                {showUnassigned && <div className="px-3 pb-3">{renderContainerTable(unassigned)}</div>}
              </div>
            );
          })()}

          {/* Work Order Groups */}
          <div className="space-y-3">
            {visibleWorkOrders.map((wo) => {
              const rows = containersByWorkOrder.get(wo.id) || [];
              if (rows.length === 0) return null;

              const isOpen = expandedWorkOrderId === wo.id;
              const piecesSum = rows.reduce((sum, c) => sum + (c.pieces_total || 0), 0);
              const paySum = rows.reduce((sum, c) => sum + (Number(c.pay_total) || 0), 0);

              return (
                <div key={wo.id} className="rounded-xl border border-slate-800 bg-slate-950">
                  <button
                    type="button"
                    onClick={() => setExpandedWorkOrderId((p) => (p === wo.id ? null : wo.id))}
                    className="w-full flex items-center justify-between px-3 py-2 text-left"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="text-slate-100 text-sm font-semibold">{wo.name}</div>
                        <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] border bg-slate-900/80 text-slate-200 border-slate-600/70">
                          {wo.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {wo.building} • {rows.length} containers • Pieces {piecesSum} • Pay ${paySum.toFixed(2)}
                      </div>
                    </div>
                    <div className="text-[10px] text-slate-500">{isOpen ? "▴" : "▾"}</div>
                  </button>

                  {isOpen && <div className="px-3 pb-3">{renderContainerTable(rows)}</div>}
                </div>
              );
            })}
          </div>

          {filteredContainers.length === 0 && !loading && (
            <div className="py-3 text-center text-[11px] text-slate-500">
              No containers found for this filter.
            </div>
          )}
        </div>

        {/* Form modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="w-full max-w-2xl rounded-2xl bg-slate-950 border border-slate-800 shadow-xl p-6 text-xs">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-100">
                  {formState.id ? "Edit Container" : "New Container"}
                </h2>
                <button
                  onClick={() => {
                    setShowForm(false);
                    resetForm();
                  }}
                  className="text-[11px] text-slate-400 hover:text-slate-200"
                >
                  ✕ Close
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Building</label>
                    <select
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-[11px] text-slate-50"
                      value={formState.building}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          building: e.target.value,
                          workOrderId: null,
                        }))
                      }
                      disabled={isLead && !!leadBuilding}
                    >
                      {BUILDINGS.map((b) => {
                        if (isLead && leadBuilding && b !== leadBuilding) return null;
                        return (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Shift</label>
                    <select
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-[11px] text-slate-50"
                      value={formState.shift}
                      onChange={(e) =>
                        setFormState((prev) => ({ ...prev, shift: e.target.value as ShiftName }))
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
                    <label className="block text-[11px] text-slate-400 mb-1">Work Date</label>
                    <input
                      type="date"
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-[11px] text-slate-50"
                      value={formState.workDate}
                      onChange={(e) => setFormState((prev) => ({ ...prev, workDate: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Container #</label>
                    <input
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                      value={formState.containerNo}
                      onChange={(e) => setFormState((prev) => ({ ...prev, containerNo: e.target.value }))}
                      placeholder="e.g., MSKU1234567"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Pieces Total</label>
                    <input
                      type="number"
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                      value={formState.piecesTotal}
                      onChange={(e) =>
                        setFormState((prev) => ({ ...prev, piecesTotal: Number(e.target.value) || 0 }))
                      }
                      min={0}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">SKU Count</label>
                    <input
                      type="number"
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                      value={formState.skusTotal}
                      onChange={(e) =>
                        setFormState((prev) => ({ ...prev, skusTotal: Number(e.target.value) || 0 }))
                      }
                      min={0}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Work Order (optional)</label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={formState.workOrderId || ""}
                    onChange={(e) =>
                      setFormState((prev) => ({ ...prev, workOrderId: e.target.value || null }))
                    }
                  >
                    <option value="">Unassigned</option>
                    {workOrdersForBuilding.map((wo) => (
                      <option key={wo.id} value={wo.id}>
                        {wo.name} ({wo.status})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-slate-500">
                    Only work orders for this building are shown.
                  </p>
                </div>

                <div className="rounded-xl bg-slate-900 border border-slate-800 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] text-slate-300 font-semibold">Worker Contributions</div>
                    <div className="text-[11px] text-slate-400">
                      Total %:{" "}
                      <span className={isPercentValid ? "text-emerald-300" : "text-rose-300"}>
                        {percentSum}%
                      </span>{" "}
                      · Container Pay:{" "}
                      <span className="text-emerald-300">${payForForm.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-[11px] text-slate-400 font-semibold mb-1">
                    <div>Name</div>
                    <div>Minutes Worked</div>
                    <div>% Contribution</div>
                    <div>Payout</div>
                  </div>

                  {/* ✅ single datalist shared by all worker name inputs */}
                  <datalist id="precisionpulse-worker-options">
                    {workforceOptionsForForm.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>

                  {(formState.workers || []).map((w, idx) => (
                    <div key={idx} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center">
                      <div className="space-y-1">
                        <input
                          list="precisionpulse-worker-options"
                          className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                          value={w.name}
                          onChange={(e) => handleWorkerChange(idx, "name", e.target.value)}
                          placeholder={
                            workforceLoading
                              ? "Loading workers…"
                              : workforceOptionsForForm.length
                              ? "Start typing or pick…"
                              : "No workers for this building/shift"
                          }
                        />
                        <div className="text-[10px] text-slate-600">
                          {workforceOptionsForForm.length} workers available
                        </div>
                      </div>

                      <input
                        type="number"
                        className="rounded-lg bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                        value={w.minutesWorked}
                        onChange={(e) => handleWorkerChange(idx, "minutesWorked", e.target.value)}
                        min={0}
                      />
                      <input
                        type="number"
                        className="rounded-lg bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                        value={w.percentContribution}
                        onChange={(e) => handleWorkerChange(idx, "percentContribution", e.target.value)}
                        min={0}
                        max={100}
                      />
                      <div className="text-[11px] text-emerald-300">
                        $
                        {workersWithPayout[idx]
                          ? workersWithPayout[idx].payout.toFixed(2)
                          : "0.00"}
                      </div>
                    </div>
                  ))}

                  <p className="text-[10px] text-slate-500 mt-1">
                    Pick from the roster for this building/shift (or type a name). If you use contributions, the
                    percentages must sum to exactly 100%.
                  </p>
                </div>

                {error && (
                  <div className="rounded-lg border border-rose-700 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-100">
                    {error}
                  </div>
                )}

                <div className="flex items-center justify-between mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowForm(false);
                      resetForm();
                    }}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] text-slate-200 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving || (!isPercentValid && percentSum !== 0)}
                    className="rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-[11px] font-medium text-white px-4 py-2"
                  >
                    {saving ? "Saving…" : formState.id ? "Save Changes" : "Create Container"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

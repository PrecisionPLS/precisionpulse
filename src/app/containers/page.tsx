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
  percentContribution: number; // now supports decimals (e.g., 33.33)
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

  // ownership fields
  created_by_user_id?: string | null;
  created_by_email?: string | null;
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

// Avoid `any`
type WorkforceRow = Record<string, unknown>;

// Try multiple column names so it works even if your table uses different names
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
    crypto.randomUUID();

  return {
    id: String(idValue),
    fullName: String(fullName).trim(),
    building,
    shift,
    active,
  };
}

function blankWorker(): WorkerContribution {
  return { name: "", minutesWorked: 0, percentContribution: 0, payout: 0 };
}

// decimal-safe compare for percentage sum
function approxEqual(a: number, b: number, tolerance = 0.01): boolean {
  return Math.abs(a - b) <= tolerance;
}

export default function ContainersPage() {
  const currentUser = useCurrentUser();
  const router = useRouter();

  const isLead = currentUser?.accessRole === "Lead";
  const leadBuilding = currentUser?.building || "";

  function isOwner(row: ContainerRow): boolean {
    if (!currentUser) return false;
    const byId =
      !!row.created_by_user_id && row.created_by_user_id === currentUser.id;
    const byEmail =
      !!row.created_by_email &&
      row.created_by_email.toLowerCase() === currentUser.email.toLowerCase();
    return byId || byEmail;
  }

  function canLeadEdit(row: ContainerRow): boolean {
    if (!isLead) return true;
    return isOwner(row);
  }

  const [buildingFilter, setBuildingFilter] = useState<string>(() =>
    isLead && leadBuilding ? leadBuilding : "ALL"
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderOption[]>([]);

  const [expandedWorkOrderId, setExpandedWorkOrderId] = useState<string | null>(
    null
  );
  const [showUnassigned, setShowUnassigned] = useState<boolean>(true);

  const [workforce, setWorkforce] = useState<WorkforceWorker[]>([]);
  const [workforceLoading, setWorkforceLoading] = useState<boolean>(false);

  const [showForm, setShowForm] = useState(false);
  const [formState, setFormState] = useState<EditFormState>(() => ({
    building: currentUser?.building || BUILDINGS[0] || "DC18",
    shift: "1st",
    workDate: todayISODate(),
    containerNo: "",
    piecesTotal: 0,
    skusTotal: 0,
    workOrderId: null,
    workers: [blankWorker()], // ✅ start with ONE worker row
  }));

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
        (data as unknown as ContainerRow[])?.map((row) => ({
          ...row,
          workers: (row.workers || []) as WorkerContribution[],
          work_order_id: row.work_order_id ?? null,
          shift: (row.shift ?? null) as string | null,
          work_date: (row.work_date ?? null) as string | null,

          created_by_user_id: (row as unknown as { created_by_user_id?: string | null })
            .created_by_user_id ?? null,
          created_by_email: (row as unknown as { created_by_email?: string | null })
            .created_by_email ?? null,
        })) ?? [];

      setContainers(rows);

      try {
        const mappedForLocal = rows.map((row) => ({
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
          window.localStorage.setItem(
            CONTAINERS_KEY,
            JSON.stringify(mappedForLocal)
          );
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

  useEffect(() => {
    loadContainers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, isLead, leadBuilding]);

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
          (data || []).map((row: Record<string, unknown>) => ({
            id: String(row.id),
            name:
              (typeof row.work_order_code === "string" ? row.work_order_code : null) ??
              `Work Order ${String(row.id).slice(-4)}`,
            building:
              (typeof row.building === "string" ? row.building : null) ??
              (BUILDINGS[0] || "DC1"),
            status: (typeof row.status === "string" ? row.status : null) ?? "Pending",
          })) ?? [];

        setWorkOrders(opts);
      } catch (e) {
        console.error("Unexpected error loading work orders", e);
      }
    }

    loadWorkOrders();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;

    async function loadWorkforce() {
      setWorkforceLoading(true);
      try {
        const { data, error } = await supabase
          .from("workforce")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) {
          console.error("Error loading workforce", error);
          return;
        }

        const mapped: WorkforceWorker[] = (data as unknown[] | null | undefined ?? [])
          .map((r) => mapWorkforceRow(r as WorkforceRow))
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
    () =>
      filteredContainers.reduce(
        (sum, c) => sum + (Number(c.pay_total) || 0),
        0
      ),
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
      workers: [blankWorker()], // ✅ reset to ONE worker
    });
  }

  function openNewForm() {
    resetForm();
    setShowForm(true);
  }

  function openEditForm(row: ContainerRow) {
    if (isLead && !canLeadEdit(row)) {
      setError("Leads can only edit their own container entries.");
      return;
    }

    const existingWorkers =
      (row.workers || []).length > 0 ? (row.workers || []) : [blankWorker()];

    setFormState({
      id: row.id,
      building: row.building,
      shift: ((row.shift as ShiftName) || "1st") as ShiftName,
      workDate: row.work_date ? String(row.work_date).slice(0, 10) : todayISODate(),
      containerNo: row.container_no,
      piecesTotal: row.pieces_total,
      skusTotal: row.skus_total,
      workOrderId: row.work_order_id ?? null,
      workers: existingWorkers.map((w) => ({
        name: w.name ?? "",
        minutesWorked: Number(w.minutesWorked ?? 0),
        percentContribution: Number(w.percentContribution ?? 0),
        payout: Number(w.payout ?? 0),
      })),
    });

    setShowForm(true);
  }

  function addWorker() {
    setFormState((prev) => ({ ...prev, workers: [...prev.workers, blankWorker()] }));
  }

  function removeWorker(index: number) {
    setFormState((prev) => {
      const next = prev.workers.filter((_, i) => i !== index);
      return { ...prev, workers: next.length ? next : [blankWorker()] };
    });
  }

  function handleWorkerChange(
    index: number,
    field: keyof WorkerContribution,
    value: string
  ) {
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
      const pct = Number(w.percentContribution || 0);
      return { ...w, payout: (pay * pct) / 100 };
    });

    const sumPct = workers.reduce((sum, w) => sum + (Number(w.percentContribution) || 0), 0);

    return { payForForm: pay, workersWithPayout: workers, percentSum: sumPct };
  }, [formState.piecesTotal, formState.workers]);

  // ✅ allow decimals with tolerance
  const isPercentValid = approxEqual(percentSum, 100, 0.02) || approxEqual(percentSum, 0, 0.0001);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;

    setError(null);

    if (!formState.containerNo.trim()) return setError("Container number is required.");
    if (formState.piecesTotal <= 0) return setError("Pieces total must be greater than 0.");

    const finalWorkers = workersWithPayout.filter(
      (w) => w.name.trim() && Number(w.percentContribution) > 0
    );

    if (finalWorkers.length > 0 && !approxEqual(percentSum, 100, 0.02)) {
      setError("Worker contribution percentages must total 100% (decimals allowed).");
      return;
    }

    setSaving(true);

    try {
      const effectiveBuilding =
        isLead && leadBuilding ? leadBuilding : formState.building;

      const payload: Record<string, unknown> = {
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
        if (isLead) {
          const existing = containers.find((c) => c.id === formState.id);
          if (!existing || !canLeadEdit(existing)) {
            setError("Leads can only edit their own container entries.");
            return;
          }
        }

        const { error } = await supabase.from("containers").update(payload).eq("id", formState.id);
        if (error) {
          console.error(error);
          return setError("Failed to update container.");
        }
      } else {
        payload.created_by_user_id = currentUser?.id ?? null;
        payload.created_by_email = currentUser?.email ?? null;

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
    const row = containers.find((c) => c.id === id);

    if (isLead) {
      if (!row || !canLeadEdit(row)) {
        setError("Leads can only delete their own container entries.");
        return;
      }
    }

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

  const workforceOptionsForForm = useMemo(() => {
    const b = (isLead && leadBuilding ? leadBuilding : formState.building) || "";
    const s = formState.shift || "";

    const list = workforce
      .filter((w) => w.active !== false)
      .filter((w) => {
        if (w.building && b && w.building !== b) return false;
        return true;
      })
      .filter((w) => {
        if (w.shift && s && String(w.shift) !== String(s)) return false;
        return true;
      })
      .map((w) => w.fullName)
      .filter(Boolean);

    return Array.from(new Set(list)).sort((a, b) => a.localeCompare(b));
  }, [workforce, formState.building, formState.shift, isLead, leadBuilding]);

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
            {rows.map((c) => {
              const leadBlocked = isLead && !canLeadEdit(c);

              return (
                <tr
                  key={c.id}
                  className="border-b border-slate-800/60 hover:bg-slate-900/70"
                >
                  <td className="py-2 pr-3 text-[11px] text-slate-400">
                    {c.work_date
                      ? String(c.work_date).slice(0, 10)
                      : new Date(c.created_at).toISOString().slice(0, 10)}
                  </td>
                  <td className="py-2 pr-3 text-[11px] text-slate-200">
                    {c.building}
                  </td>
                  <td className="py-2 pr-3 text-[11px] text-slate-200">
                    {c.shift ?? "—"}
                  </td>
                  <td className="py-2 pr-3 text-[11px] text-slate-200">
                    {c.container_no}
                  </td>
                  <td className="py-2 pr-3 text-right text-[11px] text-slate-200">
                    {c.pieces_total}
                  </td>
                  <td className="py-2 pr-3 text-right text-[11px] text-slate-200">
                    {c.skus_total}
                  </td>
                  <td className="py-2 pr-3 text-right text-[11px] text-emerald-300">
                    ${Number(c.pay_total).toFixed(2)}
                  </td>
                  <td className="py-2 pr-3 text-[11px] text-slate-300">
                    {(c.workers || [])
                      .filter((w) => w.name)
                      .map(
                        (w) =>
                          `${w.name} (${Number(w.percentContribution).toFixed(
                            2
                          )}% · $${Number(w.payout).toFixed(2)})`
                      )
                      .join(", ") || "—"}
                  </td>
                  <td className="py-2 pl-3 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        className="px-3 py-1 rounded-lg bg-slate-800 text-[11px] text-slate-100 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => openEditForm(c)}
                        disabled={leadBlocked}
                        title={
                          leadBlocked
                            ? "Leads can only edit their own entries."
                            : "Edit"
                        }
                      >
                        Edit
                      </button>
                      <button
                        className="px-3 py-1 rounded-lg bg-rose-700 text-[11px] text-white hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => handleDelete(c.id)}
                        disabled={saving || leadBlocked}
                        title={
                          leadBlocked
                            ? "Leads can only delete their own entries."
                            : "Delete"
                        }
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
    );
  }

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
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">Containers</h1>
            <p className="text-sm text-slate-400">
              Live container tracking with automatic pay scale, work orders, and
              worker contributions.
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

        <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 shadow-sm shadow-slate-900/60">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-100">
              Containers by Work Order
            </h2>
            {loading && <div className="text-[11px] text-slate-400">Loading…</div>}
          </div>

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
                    <div className="text-slate-100 text-sm font-semibold">
                      Unassigned Containers
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Containers not linked to a work order.
                    </div>
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {showUnassigned ? "▴" : "▾"}
                  </div>
                </button>
                {showUnassigned && (
                  <div className="px-3 pb-3">{renderContainerTable(unassigned)}</div>
                )}
              </div>
            );
          })()}

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
                    onClick={() =>
                      setExpandedWorkOrderId((p) => (p === wo.id ? null : wo.id))
                    }
                    className="w-full flex items-center justify-between px-3 py-2 text-left"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="text-slate-100 text-sm font-semibold">
                          {wo.name}
                        </div>
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
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Building
                    </label>
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
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Shift
                    </label>
                    <select
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-[11px] text-slate-50"
                      value={formState.shift}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          shift: e.target.value as ShiftName,
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
                      Work Date
                    </label>
                    <input
                      type="date"
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-[11px] text-slate-50"
                      value={formState.workDate}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          workDate: e.target.value,
                        }))
                      }
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Container #
                    </label>
                    <input
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                      value={formState.containerNo}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          containerNo: e.target.value,
                        }))
                      }
                      placeholder="e.g., MSKU1234567"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Pieces Total
                    </label>
                    <input
                      type="number"
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                      value={formState.piecesTotal}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          piecesTotal: Number(e.target.value) || 0,
                        }))
                      }
                      min={0}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      SKU Count
                    </label>
                    <input
                      type="number"
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                      value={formState.skusTotal}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          skusTotal: Number(e.target.value) || 0,
                        }))
                      }
                      min={0}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Work Order (optional)
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={formState.workOrderId || ""}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        workOrderId: e.target.value || null,
                      }))
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

                {/* Worker Contributions */}
                <div className="rounded-xl bg-slate-900 border border-slate-800 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] text-slate-300 font-semibold">
                      Worker Contributions
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-slate-400">
                      <div>
                        Total %:{" "}
                        <span className={isPercentValid ? "text-emerald-300" : "text-rose-300"}>
                          {percentSum.toFixed(2)}%
                        </span>
                      </div>
                      <div>
                        Container Pay:{" "}
                        <span className="text-emerald-300">${payForForm.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={addWorker}
                      className="rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-100 px-3 py-1.5"
                    >
                      + Add Worker
                    </button>

                    <div className="text-[10px] text-slate-500">
                      Decimals allowed (ex: 33.33). Total must equal 100%.
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-[11px] text-slate-400 font-semibold mb-1">
                    <div className="md:col-span-2">Name</div>
                    <div>Minutes</div>
                    <div>%</div>
                    <div>Payout</div>
                  </div>

                  <datalist id="precisionpulse-worker-options">
                    {workforceOptionsForForm.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>

                  {(formState.workers || []).map((w, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center"
                    >
                      <div className="md:col-span-2 flex gap-2 items-start">
                        <div className="flex-1 space-y-1">
                          <input
                            list="precisionpulse-worker-options"
                            className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                            value={w.name}
                            onChange={(e) =>
                              handleWorkerChange(idx, "name", e.target.value)
                            }
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

                        <button
                          type="button"
                          onClick={() => removeWorker(idx)}
                          className="mt-[2px] rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
                          title="Remove worker"
                        >
                          ✕
                        </button>
                      </div>

                      <input
                        type="number"
                        className="rounded-lg bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                        value={w.minutesWorked}
                        onChange={(e) =>
                          handleWorkerChange(idx, "minutesWorked", e.target.value)
                        }
                        min={0}
                      />

                      <input
                        type="number"
                        step="0.01"
                        className="rounded-lg bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                        value={w.percentContribution}
                        onChange={(e) =>
                          handleWorkerChange(idx, "percentContribution", e.target.value)
                        }
                        min={0}
                        max={100}
                      />

                      <div className="text-[11px] text-emerald-300">
                        $
                        {workersWithPayout[idx]
                          ? Number(workersWithPayout[idx].payout).toFixed(2)
                          : "0.00"}
                      </div>
                    </div>
                  ))}

                  <p className="text-[10px] text-slate-500 mt-1">
                    Pick from the roster (or type). If you use contributions, the total % should be 100%.
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

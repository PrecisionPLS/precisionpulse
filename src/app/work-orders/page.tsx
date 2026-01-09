"use client";

import Link from "next/link";
import React, { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { BUILDINGS } from "@/lib/buildings";

const WORK_ORDERS_KEY = "precisionpulse_work_orders";
const CONTAINERS_KEY = "precisionpulse_containers";

const SHIFTS = ["1st", "2nd", "3rd", "4th"] as const;
type ShiftName = (typeof SHIFTS)[number];

const STATUS_OPTIONS = ["Pending", "Active", "Completed", "Locked"] as const;

/** ---------------- Types (Work Orders) ---------------- */
type WorkOrderRecord = {
  id: string;
  name: string;
  building: string;
  shift: string;
  status: string;
  createdAt: string;
  notes?: string;

  createdByUserId?: string | null;
  createdByEmail?: string | null;
};

type WorkOrderRow = {
  id: string;
  created_at: string;
  building: string;
  shift_name: string | null;
  work_order_code: string | null;
  status: string;
  notes: string | null;

  created_by_user_id?: string | null;
  created_by_email?: string | null;
};

/** ---------------- Types (Containers) ---------------- */
type WorkerContribution = {
  name: string;
  minutesWorked: number;
  percentContribution: number; // supports decimals
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

  created_by_user_id?: string | null;
  created_by_email?: string | null;
};

type EditContainerFormState = {
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

/** ---------------- Helpers ---------------- */
function mapRowToRecord(row: WorkOrderRow): WorkOrderRecord {
  const id = String(row.id);
  const createdAt = row.created_at ?? new Date().toISOString();
  const name = row.work_order_code ?? `${row.status ?? "Pending"} Work Order ${id.slice(-4)}`;

  return {
    id,
    name,
    building: row.building ?? "DC1",
    shift: row.shift_name ?? "1st",
    status: row.status ?? "Pending",
    createdAt,
    notes: row.notes ?? "",

    createdByUserId: row.created_by_user_id ?? null,
    createdByEmail: row.created_by_email ?? null,
  };
}

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

function blankWorker(): WorkerContribution {
  return { name: "", minutesWorked: 0, percentContribution: 0, payout: 0 };
}

function approxEqual(a: number, b: number, tolerance = 0.01): boolean {
  return Math.abs(a - b) <= tolerance;
}

/** ---- Supabase error helpers ---- */
function extractSupabaseError(err: unknown): Record<string, unknown> {
  const extracted: Record<string, unknown> = { type: typeof err, string: String(err) };

  if (typeof err === "object" && err !== null) {
    const rec = err as Record<string, unknown>;
    if (typeof rec.message === "string") extracted.message = rec.message;
    if (typeof rec.details === "string") extracted.details = rec.details;
    if (typeof rec.hint === "string") extracted.hint = rec.hint;
    if (typeof rec.code === "string") extracted.code = rec.code;
    if (typeof rec.status === "number") extracted.status = rec.status;
    for (const k of Object.getOwnPropertyNames(err)) extracted[k] = rec[k];
  }

  return extracted;
}

function logSupabaseError(
  label: string,
  err: unknown,
  level: "error" | "warn" | "debug" = "error"
) {
  const extracted = extractSupabaseError(err);
  const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.debug;
  logger(label, extracted);
}

function formatSupabaseError(err: unknown): string {
  const e = extractSupabaseError(err);
  const msg =
    (typeof e.message === "string" && e.message) ||
    (typeof e.details === "string" && e.details) ||
    (typeof e.hint === "string" && e.hint) ||
    "";
  return msg || "Unknown error (check console for details).";
}

function isMissingOwnershipColumnError(err: unknown): boolean {
  const e = extractSupabaseError(err);
  const msg = String(e.message ?? e.details ?? e.hint ?? "").toLowerCase();
  return (
    msg.includes("does not exist") &&
    (msg.includes("created_by_user_id") || msg.includes("created_by_email"))
  );
}

/** Workforce mapping (same approach you used on Containers page) */
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
    crypto.randomUUID();

  return {
    id: String(idValue),
    fullName: String(fullName).trim(),
    building,
    shift,
    active,
  };
}

export default function WorkOrdersPage() {
  const currentUser = useCurrentUser();

  /** ---------------- Role logic ---------------- */
  const isLead = currentUser?.accessRole === "Lead";
  const leadBuilding = currentUser?.building || "";

  function isOwnerWorkOrder(wo: WorkOrderRecord): boolean {
    if (!currentUser) return false;
    const byId = !!wo.createdByUserId && wo.createdByUserId === currentUser.id;
    const byEmail =
      !!wo.createdByEmail && wo.createdByEmail.toLowerCase() === currentUser.email.toLowerCase();
    return byId || byEmail;
  }

  function canLeadEditWorkOrder(wo: WorkOrderRecord): boolean {
    if (!isLead) return true;
    return isOwnerWorkOrder(wo);
  }

  function isOwnerContainer(c: ContainerRow): boolean {
    if (!currentUser) return false;
    const byId = !!c.created_by_user_id && c.created_by_user_id === currentUser.id;
    const byEmail =
      !!c.created_by_email && c.created_by_email.toLowerCase() === currentUser.email.toLowerCase();
    return byId || byEmail;
  }

  function canLeadEditContainer(c: ContainerRow): boolean {
    if (!isLead) return true;
    return isOwnerContainer(c);
  }

  /** ---------------- State (Work Orders) ---------------- */
  const [workOrders, setWorkOrders] = useState<WorkOrderRecord[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [building, setBuilding] = useState("DC1");
  const [shift, setShift] = useState<ShiftName>("1st");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("Pending");
  const [notes, setNotes] = useState("");

  const [filterBuilding, setFilterBuilding] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");

  const [loadingWorkOrders, setLoadingWorkOrders] = useState(true);
  const [savingWorkOrders, setSavingWorkOrders] = useState(false);

  // Work order ownership columns support
  const [woOwnershipColsSupported, setWoOwnershipColsSupported] = useState<boolean | null>(null);

  /** ---------------- State (Containers inside Work Orders) ---------------- */
  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [loadingContainers, setLoadingContainers] = useState(true);
  const [savingContainer, setSavingContainer] = useState(false);

  // Containers ownership columns support
  const [cOwnershipColsSupported, setCOwnershipColsSupported] = useState<boolean | null>(null);

  const [expandedWorkOrderId, setExpandedWorkOrderId] = useState<string | null>(null);
  const [showContainerForm, setShowContainerForm] = useState(false);

  const [workOrderOptions, setWorkOrderOptions] = useState<WorkOrderOption[]>([]);
  const [workforce, setWorkforce] = useState<WorkforceWorker[]>([]);
  const [workforceLoading, setWorkforceLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [containerForm, setContainerForm] = useState<EditContainerFormState>(() => ({
    building: currentUser?.building || BUILDINGS[0] || "DC18",
    shift: "1st",
    workDate: todayISODate(),
    containerNo: "",
    piecesTotal: 0,
    skusTotal: 0,
    workOrderId: null,
    workers: [blankWorker()],
  }));

  /** ---------------- Persistence (existing behavior kept) ---------------- */
  const persistWorkOrders = useCallback((next: WorkOrderRecord[]) => {
    setWorkOrders(next);
    if (typeof window !== "undefined") window.localStorage.setItem(WORK_ORDERS_KEY, JSON.stringify(next));
  }, []);

  // Keep localStorage write for containers too (so nothing else relying on it breaks)
  const persistContainersLocal = useCallback((rows: ContainerRow[]) => {
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
      if (typeof window !== "undefined") window.localStorage.setItem(CONTAINERS_KEY, JSON.stringify(mappedForLocal));
    } catch (e) {
      logSupabaseError("Failed to write containers to localStorage", e, "warn");
    }
  }, []);

  /** ---------------- Probes: ownership cols ---------------- */
  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;

    async function probeWorkOrders() {
      try {
        const { error } = await supabase
          .from("work_orders")
          .select("created_by_user_id,created_by_email")
          .limit(1);

        if (cancelled) return;

        if (error) {
          setWoOwnershipColsSupported(false);
          logSupabaseError("WO ownership probe failed (treated as unsupported)", error, "warn");
        } else {
          setWoOwnershipColsSupported(true);
        }
      } catch (e) {
        if (!cancelled) setWoOwnershipColsSupported(false);
        logSupabaseError("WO ownership probe threw (treated as unsupported)", e, "warn");
      }
    }

    probeWorkOrders();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;

    async function probeContainers() {
      try {
        const { error } = await supabase
          .from("containers")
          .select("created_by_user_id,created_by_email")
          .limit(1);

        if (cancelled) return;

        if (error) {
          setCOwnershipColsSupported(false);
          logSupabaseError("Container ownership probe failed (treated as unsupported)", error, "warn");
        } else {
          setCOwnershipColsSupported(true);
        }
      } catch (e) {
        if (!cancelled) setCOwnershipColsSupported(false);
        logSupabaseError("Container ownership probe threw (treated as unsupported)", e, "warn");
      }
    }

    probeContainers();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  /** ---------------- Loaders ---------------- */
  const refreshWorkOrders = useCallback(async () => {
    if (!currentUser) return;
    setLoadingWorkOrders(true);
    setError(null);

    try {
      let query = supabase.from("work_orders").select("*").order("created_at", { ascending: false });
      if (isLead && leadBuilding) query = query.eq("building", leadBuilding);

      const { data, error } = await query;
      if (error) {
        logSupabaseError("Error loading work orders", error, "error");
        setError("Failed to load work orders from server.");
        return;
      }

      const rows = (data || []) as WorkOrderRow[];
      const mapped = rows.map(mapRowToRecord);
      persistWorkOrders(mapped);
    } catch (e) {
      logSupabaseError("Unexpected error loading work orders", e, "error");
      setError("Unexpected error loading work orders.");
    } finally {
      setLoadingWorkOrders(false);
    }
  }, [currentUser, isLead, leadBuilding, persistWorkOrders]);

  const loadContainers = useCallback(async () => {
    if (!currentUser) return;
    setLoadingContainers(true);
    setError(null);

    try {
      let query = supabase.from("containers").select("*").order("created_at", { ascending: false });
      if (isLead && leadBuilding) query = query.eq("building", leadBuilding);

      const { data, error } = await query;
      if (error) {
        logSupabaseError("Error loading containers", error, "error");
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
          created_by_user_id:
            (row as unknown as { created_by_user_id?: string | null }).created_by_user_id ?? null,
          created_by_email:
            (row as unknown as { created_by_email?: string | null }).created_by_email ?? null,
        })) ?? [];

      setContainers(rows);
      persistContainersLocal(rows);
    } catch (e) {
      logSupabaseError("Unexpected error loading containers", e, "error");
      setError("Unexpected error loading containers.");
    } finally {
      setLoadingContainers(false);
    }
  }, [currentUser, isLead, leadBuilding, persistContainersLocal]);

  useEffect(() => {
    if (!currentUser) return;
    refreshWorkOrders();
    loadContainers();
  }, [currentUser, refreshWorkOrders, loadContainers]);

  useEffect(() => {
    if (isLead && leadBuilding) {
      setFilterBuilding((prev) => (prev === "ALL" ? leadBuilding : prev));
      setBuilding((prev) => (prev === "DC1" ? leadBuilding : prev));
    }
  }, [isLead, leadBuilding]);

  // Work order options for container form select
  useEffect(() => {
    if (!currentUser) return;

    async function loadWOOptions() {
      try {
        const { data, error } = await supabase
          .from("work_orders")
          .select("id, building, status, work_order_code, created_at")
          .order("created_at", { ascending: false });

        if (error) {
          logSupabaseError("Error loading WO options", error, "warn");
          return;
        }

        const opts: WorkOrderOption[] =
          (data || []).map((row: Record<string, unknown>) => ({
            id: String(row.id),
            name:
              (typeof row.work_order_code === "string" ? row.work_order_code : null) ??
              `Work Order ${String(row.id).slice(-4)}`,
            building: (typeof row.building === "string" ? row.building : null) ?? (BUILDINGS[0] || "DC1"),
            status: (typeof row.status === "string" ? row.status : null) ?? "Pending",
          })) ?? [];

        setWorkOrderOptions(opts);
      } catch (e) {
        logSupabaseError("Unexpected error loading WO options", e, "warn");
      }
    }

    loadWOOptions();
  }, [currentUser]);

  // Workforce for datalist
  useEffect(() => {
    if (!currentUser) return;

    async function loadWorkforce() {
      setWorkforceLoading(true);
      try {
        const { data, error } = await supabase.from("workforce").select("*").order("created_at", { ascending: false });
        if (error) {
          logSupabaseError("Error loading workforce", error, "warn");
          return;
        }

        const mapped: WorkforceWorker[] = ((data as unknown[] | null | undefined) ?? [])
          .map((r) => mapWorkforceRow(r as WorkforceRow))
          .filter((w) => w.fullName && w.fullName !== "Unknown");

        setWorkforce(mapped);
      } catch (e) {
        logSupabaseError("Unexpected error loading workforce", e, "warn");
      } finally {
        setWorkforceLoading(false);
      }
    }

    loadWorkforce();
  }, [currentUser]);

  /** ---------------- Work Orders actions (existing behavior) ---------------- */
  function resetWorkOrderForm() {
    setEditingId(null);
    setName("");
    setBuilding(currentUser?.building || "DC18");
    setShift("1st");
    setStatus("Pending");
    setNotes("");
  }

  function handleEditWorkOrder(order: WorkOrderRecord) {
    if (isLead && !canLeadEditWorkOrder(order)) {
      setError("Leads can only edit their own work orders.");
      return;
    }

    setEditingId(order.id);
    setName(order.name);
    setBuilding(order.building);
    setShift((order.shift as ShiftName) || "1st");
    setStatus(order.status as (typeof STATUS_OPTIONS)[number]);
    setNotes(order.notes ?? "");
  }

  async function handleDeleteWorkOrder(order: WorkOrderRecord) {
    if (isLead && !canLeadEditWorkOrder(order)) {
      setError("Leads can only delete their own work orders.");
      return;
    }

    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "Delete this work order? Any containers linked to it will stay, but will become unassigned."
      );
      if (!ok) return;
    }

    setSavingWorkOrders(true);
    setError(null);

    try {
      const { error } = await supabase.from("work_orders").delete().eq("id", order.id);
      if (error) {
        logSupabaseError("Error deleting work order", error, "error");
        setError("Failed to delete work order.");
        return;
      }

      // Make linked containers unassigned (client-side view will update after reload)
      await loadContainers();
      await refreshWorkOrders();

      if (expandedWorkOrderId === order.id) setExpandedWorkOrderId(null);
      if (editingId === order.id) resetWorkOrderForm();
    } catch (e) {
      logSupabaseError("Unexpected error deleting work order", e, "error");
      setError("Unexpected error deleting work order.");
    } finally {
      setSavingWorkOrders(false);
    }
  }

  async function handleSubmitWorkOrder(e: FormEvent) {
    e.preventDefault();
    if (savingWorkOrders) return;

    if (!name.trim()) {
      if (typeof window !== "undefined") window.alert("Please enter a work order name.");
      return;
    }

    setSavingWorkOrders(true);
    setError(null);

    try {
      const effectiveBuilding = isLead && leadBuilding ? leadBuilding : building;

      const basePayload: Partial<WorkOrderRow> = {
        building: effectiveBuilding,
        shift_name: shift,
        work_order_code: name.trim(),
        status,
        notes: notes.trim() || null,
      };

      if (editingId) {
        if (isLead) {
          const existing = workOrders.find((w) => w.id === editingId);
          if (!existing || !canLeadEditWorkOrder(existing)) {
            setError("Leads can only edit their own work orders.");
            return;
          }
        }

        const { error } = await supabase.from("work_orders").update(basePayload).eq("id", editingId);
        if (error) {
          logSupabaseError("Error updating work order", error, "error");
          setError("Failed to update work order.");
          return;
        }
      } else {
        let createPayload: Record<string, unknown> = { ...basePayload };

        if (woOwnershipColsSupported) {
          createPayload = {
            ...createPayload,
            created_by_user_id: currentUser?.id ?? null,
            created_by_email: currentUser?.email ?? null,
          };
        }

        let res = await supabase.from("work_orders").insert(createPayload).select("id").single();

        if (res.error && woOwnershipColsSupported && isMissingOwnershipColumnError(res.error)) {
          logSupabaseError("WO insert failed (ownership cols missing) — retrying", res.error, "warn");
          setWoOwnershipColsSupported(false);
          res = await supabase.from("work_orders").insert(basePayload).select("id").single();
        }

        if (res.error) {
          logSupabaseError("Error creating work order", res.error, "error");
          setError(formatSupabaseError(res.error) || "Failed to create work order.");
          return;
        }

        // Auto-open the work order after create (nice UX)
        if (res.data?.id) setExpandedWorkOrderId(String(res.data.id));
      }

      await refreshWorkOrders();
      await loadContainers(); // keep view synced
      resetWorkOrderForm();
    } catch (e) {
      logSupabaseError("Unexpected error saving work order", e, "error");
      setError(formatSupabaseError(e) || "Unexpected error saving work order.");
    } finally {
      setSavingWorkOrders(false);
    }
  }

  /** ---------------- Containers actions inside Work Orders ---------------- */
  function resetContainerForm() {
    setContainerForm({
      building: currentUser?.building || BUILDINGS[0] || "DC18",
      shift: "1st",
      workDate: todayISODate(),
      containerNo: "",
      piecesTotal: 0,
      skusTotal: 0,
      workOrderId: null,
      workers: [blankWorker()],
    });
  }

  function openNewContainerForWorkOrder(wo: WorkOrderRecord) {
    // Default values match the work order (this is the key "combined" behavior)
    setContainerForm({
      building: wo.building,
      shift: (wo.shift as ShiftName) || "1st",
      workDate: todayISODate(),
      containerNo: "",
      piecesTotal: 0,
      skusTotal: 0,
      workOrderId: wo.id,
      workers: [blankWorker()],
    });
    setShowContainerForm(true);
  }

  function openEditContainer(row: ContainerRow) {
    if (isLead && !canLeadEditContainer(row)) {
      setError("Leads can only edit their own container entries.");
      return;
    }

    const existingWorkers = (row.workers || []).length > 0 ? (row.workers || []) : [blankWorker()];

    setContainerForm({
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

    setShowContainerForm(true);
  }

  function addWorker() {
    setContainerForm((prev) => ({ ...prev, workers: [...prev.workers, blankWorker()] }));
  }

  function removeWorker(index: number) {
    setContainerForm((prev) => {
      const next = prev.workers.filter((_, i) => i !== index);
      return { ...prev, workers: next.length ? next : [blankWorker()] };
    });
  }

  function handleWorkerChange(index: number, field: keyof WorkerContribution, value: string) {
    setContainerForm((prev) => {
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
    const pieces = containerForm.piecesTotal || 0;
    const pay = calculateContainerPay(pieces);

    const workers = (containerForm.workers || []).map((w) => {
      const pct = Number(w.percentContribution || 0);
      return { ...w, payout: (pay * pct) / 100 };
    });

    const sumPct = workers.reduce((sum, w) => sum + (Number(w.percentContribution) || 0), 0);
    return { payForForm: pay, workersWithPayout: workers, percentSum: sumPct };
  }, [containerForm.piecesTotal, containerForm.workers]);

  const isPercentValid = approxEqual(percentSum, 100, 0.02) || approxEqual(percentSum, 0, 0.0001);

  async function handleSubmitContainer(e: FormEvent) {
    e.preventDefault();
    if (savingContainer) return;

    setError(null);

    if (!containerForm.containerNo.trim()) return setError("Container number is required.");
    if (containerForm.piecesTotal <= 0) return setError("Pieces total must be greater than 0.");

    const finalWorkers = workersWithPayout.filter((w) => w.name.trim() && Number(w.percentContribution) > 0);

    if (finalWorkers.length > 0 && !approxEqual(percentSum, 100, 0.02)) {
      setError("Worker contribution percentages must total 100% (decimals allowed).");
      return;
    }

    setSavingContainer(true);

    try {
      const effectiveBuilding =
        isLead && leadBuilding ? leadBuilding : containerForm.building;

      const basePayload: Record<string, unknown> = {
        building: effectiveBuilding,
        shift: containerForm.shift,
        work_date: containerForm.workDate,
        container_no: containerForm.containerNo.trim(),
        pieces_total: containerForm.piecesTotal,
        skus_total: containerForm.skusTotal,
        pay_total: payForForm,
        damage_pieces: 0,
        rework_pieces: 0,
        workers: finalWorkers,
        work_order_id: containerForm.workOrderId || null,
      };

      if (containerForm.id) {
        if (isLead) {
          const existing = containers.find((c) => c.id === containerForm.id);
          if (!existing || !canLeadEditContainer(existing)) {
            setError("Leads can only edit their own container entries.");
            return;
          }
        }

        const { error } = await supabase.from("containers").update(basePayload).eq("id", containerForm.id);

        if (error) {
          logSupabaseError("Error updating container", error, "error");
          setError("Failed to update container.");
          return;
        }
      } else {
        let createPayload: Record<string, unknown> = { ...basePayload };

        if (cOwnershipColsSupported) {
          createPayload = {
            ...createPayload,
            created_by_user_id: currentUser?.id ?? null,
            created_by_email: currentUser?.email ?? null,
          };
        }

        let res = await supabase.from("containers").insert(createPayload).select("id").single();

        if (res.error && cOwnershipColsSupported && isMissingOwnershipColumnError(res.error)) {
          logSupabaseError("Container insert failed (ownership cols missing) — retrying", res.error, "warn");
          setCOwnershipColsSupported(false);
          res = await supabase.from("containers").insert(basePayload).select("id").single();
        }

        if (res.error) {
          logSupabaseError("Error creating container", res.error, "error");
          setError("Failed to create container.");
          return;
        }
      }

      await loadContainers();
      setShowContainerForm(false);
      resetContainerForm();
    } catch (e) {
      logSupabaseError("Unexpected error saving container", e, "error");
      setError("Unexpected error saving container.");
    } finally {
      setSavingContainer(false);
    }
  }

  async function handleDeleteContainer(id: string) {
    const row = containers.find((c) => c.id === id);

    if (isLead) {
      if (!row || !canLeadEditContainer(row)) {
        setError("Leads can only delete their own container entries.");
        return;
      }
    }

    if (!confirm("Delete this container? This cannot be undone.")) return;

    setSavingContainer(true);
    setError(null);

    try {
      const { error } = await supabase.from("containers").delete().eq("id", id);
      if (error) {
        logSupabaseError("Failed to delete container", error, "error");
        setError("Failed to delete container.");
        return;
      }
      await loadContainers();
    } catch (e) {
      logSupabaseError("Unexpected error deleting container", e, "error");
      setError("Unexpected error deleting container.");
    } finally {
      setSavingContainer(false);
    }
  }

  /** ---------------- Derived data ---------------- */
  const displayedOrders = useMemo(() => {
    return workOrders
      .filter((wo) => {
        if (isLead && leadBuilding && wo.building !== leadBuilding) return false;
        if (filterBuilding !== "ALL" && wo.building !== filterBuilding) return false;
        if (filterStatus !== "ALL" && wo.status !== filterStatus) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [workOrders, filterBuilding, filterStatus, isLead, leadBuilding]);

  const containersForWorkOrder = useCallback(
    (workOrderId: string) =>
      containers
        .filter((c) => String(c.work_order_id ?? "") === String(workOrderId))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [containers]
  );

  const workOrdersForBuildingInForm = useMemo(() => {
    const b = containerForm.building;
    return workOrderOptions.filter((wo) => wo.building === b);
  }, [workOrderOptions, containerForm.building]);

  const workforceOptionsForForm = useMemo(() => {
    const b = (isLead && leadBuilding ? leadBuilding : containerForm.building) || "";
    const s = containerForm.shift || "";

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
  }, [workforce, containerForm.building, containerForm.shift, isLead, leadBuilding]);

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
              const leadBlocked = isLead && !canLeadEditContainer(c);
              return (
                <tr key={c.id} className="border-b border-slate-800/60 hover:bg-slate-900/70">
                  <td className="py-2 pr-3 text-[11px] text-slate-400">
                    {c.work_date ? String(c.work_date).slice(0, 10) : new Date(c.created_at).toISOString().slice(0, 10)}
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
                      .map((w) => `${w.name} (${Number(w.percentContribution).toFixed(2)}% · $${Number(w.payout).toFixed(2)})`)
                      .join(", ") || "—"}
                  </td>
                  <td className="py-2 pl-3 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        className="px-3 py-1 rounded-lg bg-slate-800 text-[11px] text-slate-100 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => openEditContainer(c)}
                        disabled={leadBlocked}
                        title={leadBlocked ? "Leads can only edit their own entries." : "Edit"}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        className="px-3 py-1 rounded-lg bg-rose-700 text-[11px] text-white hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => handleDeleteContainer(c.id)}
                        disabled={savingContainer || leadBlocked}
                        title={leadBlocked ? "Leads can only delete their own entries." : "Delete"}
                        type="button"
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

  /** ---------------- Render guards ---------------- */
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

  /** ---------------- UI ---------------- */
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50">
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">Work Orders</h1>
            <p className="text-sm text-slate-400">
              Create work orders, then open each work order to add/edit containers inside it.
            </p>
          </div>
          <Link
            href="/"
            className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-700 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-100">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT: Work Order create/edit */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs space-y-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-slate-200 text-sm font-semibold">
                {editingId ? "Edit Work Order" : "Create Work Order"}
              </div>
              {editingId && (
                <button type="button" onClick={resetWorkOrderForm} className="text-[11px] text-sky-300 hover:underline">
                  Clear / New
                </button>
              )}
            </div>

            <form onSubmit={handleSubmitWorkOrder} className="space-y-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Work Order Name</label>
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                  placeholder="Example: DC18 Inbound Wave 1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Building</label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={building}
                    onChange={(e) => setBuilding(e.target.value)}
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
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={shift}
                    onChange={(e) => setShift(e.target.value as ShiftName)}
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

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Notes (optional)</label>
                <textarea
                  rows={3}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50 resize-none"
                  placeholder="Anything the lead or building manager should know..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={savingWorkOrders}
                className="mt-1 w-full rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-[11px] font-medium text-white px-4 py-2"
              >
                {savingWorkOrders ? "Saving…" : editingId ? "Save Changes" : "Create Work Order"}
              </button>

              <div className="text-[10px] text-slate-500">
                WO ownership cols:{" "}
                <span className="text-slate-300">
                  {woOwnershipColsSupported === null ? "checking…" : woOwnershipColsSupported ? "yes" : "no"}
                </span>
                {" · "}
                Container ownership cols:{" "}
                <span className="text-slate-300">
                  {cOwnershipColsSupported === null ? "checking…" : cOwnershipColsSupported ? "yes" : "no"}
                </span>
              </div>
            </form>
          </div>

          {/* RIGHT: Filters + Work Order accordion with containers inside */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-slate-200 text-sm font-semibold">Filters</div>
                  <div className="text-[11px] text-slate-500">Narrow down work orders by building and status.</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFilterStatus("ALL");
                    if (!isLead) setFilterBuilding("ALL");
                    else if (leadBuilding) setFilterBuilding(leadBuilding);
                  }}
                  className="text-[11px] text-sky-300 hover:underline"
                >
                  Reset
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Building</label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={filterBuilding}
                    onChange={(e) => setFilterBuilding(e.target.value)}
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

                <div className="hidden md:block">
                  <div className="text-[11px] text-slate-400 mb-1">Summary</div>
                  <div className="text-[11px] text-slate-300">
                    Work Orders: <span className="font-semibold">{workOrders.length}</span> · Showing:{" "}
                    <span className="font-semibold">{displayedOrders.length}</span>
                  </div>
                </div>
              </div>

              {(loadingWorkOrders || loadingContainers) && (
                <div className="mt-2 text-[11px] text-slate-500">
                  Loading… {loadingWorkOrders ? "work orders" : ""} {loadingContainers ? "containers" : ""}
                </div>
              )}
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
              <div className="flex items-center justify-between mb-2">
                <div className="text-slate-200 text-sm font-semibold">Work Orders (open to manage containers)</div>
                <div className="text-[11px] text-slate-500">
                  Click a work order to expand, then add/edit containers inside it.
                </div>
              </div>

              {displayedOrders.length === 0 ? (
                <p className="text-sm text-slate-500">No work orders found. Create one on the left to get started.</p>
              ) : (
                <div className="space-y-3">
                  {displayedOrders.map((wo) => {
                    const rows = containersForWorkOrder(wo.id);
                    const isOpen = expandedWorkOrderId === wo.id;
                    const dateShort = wo.createdAt.slice(0, 10);

                    const piecesSum = rows.reduce((sum, c) => sum + (c.pieces_total || 0), 0);
                    const paySum = rows.reduce((sum, c) => sum + (Number(c.pay_total) || 0), 0);

                    const leadBlockedWO = isLead && !canLeadEditWorkOrder(wo);

                    return (
                      <div key={wo.id} className="rounded-xl border border-slate-800 bg-slate-950">
                        <button
                          type="button"
                          onClick={() => setExpandedWorkOrderId((p) => (p === wo.id ? null : wo.id))}
                          className="w-full flex items-center justify-between px-3 py-2 text-left"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <div className="text-slate-100 text-sm font-semibold">{wo.name}</div>
                              <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] border bg-slate-900/80 text-slate-200 border-slate-600/70">
                                {wo.status}
                              </span>
                              <span className="text-[10px] text-slate-500">
                                {wo.building} • {wo.shift} • {dateShort}
                              </span>
                            </div>

                            <div className="text-[11px] text-slate-500">
                              Containers: {rows.length} • Pieces: {piecesSum} • Pay: ${paySum.toFixed(2)}
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <Link
                              href={`/work-orders/${wo.id}`}
                              className="text-[11px] text-sky-300 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              View details →
                            </Link>
                            <div className="text-[10px] text-slate-500">{isOpen ? "▴" : "▾"}</div>
                          </div>
                        </button>

                        {isOpen && (
                          <div className="px-3 pb-3 space-y-3">
                            {wo.notes && (
                              <div className="rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2 text-[11px] text-slate-300">
                                <span className="text-slate-400">Notes:</span> {wo.notes}
                              </div>
                            )}

                            <div className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => openNewContainerForWorkOrder(wo)}
                                className="rounded-lg bg-sky-600 hover:bg-sky-500 text-[11px] font-medium text-white px-3 py-2"
                              >
                                + Add Container to this Work Order
                              </button>

                              <div className="inline-flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleEditWorkOrder(wo)}
                                  className="text-[11px] text-sky-300 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                                  disabled={leadBlockedWO}
                                  title={leadBlockedWO ? "Leads can only edit their own work orders." : "Edit Work Order"}
                                >
                                  Edit WO
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDeleteWorkOrder(wo)}
                                  className="text-[11px] text-rose-300 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                                  disabled={savingWorkOrders || leadBlockedWO}
                                  title={leadBlockedWO ? "Leads can only delete their own work orders." : "Delete Work Order"}
                                >
                                  Delete WO
                                </button>
                              </div>
                            </div>

                            {rows.length === 0 ? (
                              <div className="py-3 text-center text-[11px] text-slate-500">
                                No containers in this work order yet. Click “Add Container” above.
                              </div>
                            ) : (
                              renderContainerTable(rows)
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

        {/* ---------------- Container Modal (inside Work Orders page) ---------------- */}
        {showContainerForm && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="w-full max-w-2xl rounded-2xl bg-slate-950 border border-slate-800 shadow-xl p-6 text-xs">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-100">
                  {containerForm.id ? "Edit Container" : "New Container"}
                </h2>
                <button
                  onClick={() => {
                    setShowContainerForm(false);
                    resetContainerForm();
                  }}
                  className="text-[11px] text-slate-400 hover:text-slate-200"
                  type="button"
                >
                  ✕ Close
                </button>
              </div>

              <form onSubmit={handleSubmitContainer} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Building</label>
                    <select
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-[11px] text-slate-50"
                      value={containerForm.building}
                      onChange={(e) =>
                        setContainerForm((prev) => ({ ...prev, building: e.target.value, workOrderId: null }))
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
                      value={containerForm.shift}
                      onChange={(e) => setContainerForm((prev) => ({ ...prev, shift: e.target.value as ShiftName }))}
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
                      value={containerForm.workDate}
                      onChange={(e) => setContainerForm((prev) => ({ ...prev, workDate: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Container #</label>
                    <input
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                      value={containerForm.containerNo}
                      onChange={(e) => setContainerForm((prev) => ({ ...prev, containerNo: e.target.value }))}
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
                      value={containerForm.piecesTotal}
                      onChange={(e) =>
                        setContainerForm((prev) => ({ ...prev, piecesTotal: Number(e.target.value) || 0 }))
                      }
                      min={0}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">SKU Count</label>
                    <input
                      type="number"
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                      value={containerForm.skusTotal}
                      onChange={(e) =>
                        setContainerForm((prev) => ({ ...prev, skusTotal: Number(e.target.value) || 0 }))
                      }
                      min={0}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Work Order (optional)</label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={containerForm.workOrderId || ""}
                    onChange={(e) =>
                      setContainerForm((prev) => ({ ...prev, workOrderId: e.target.value || null }))
                    }
                  >
                    <option value="">Unassigned</option>
                    {workOrdersForBuildingInForm.map((wo) => (
                      <option key={wo.id} value={wo.id}>
                        {wo.name} ({wo.status})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-slate-500">Only work orders for this building are shown.</p>
                </div>

                {/* Worker Contributions */}
                <div className="rounded-xl bg-slate-900 border border-slate-800 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] text-slate-300 font-semibold">Worker Contributions</div>

                    <div className="flex items-center gap-3 text-[11px] text-slate-400">
                      <div>
                        Total %:{" "}
                        <span className={isPercentValid ? "text-emerald-300" : "text-rose-300"}>
                          {percentSum.toFixed(2)}%
                        </span>
                      </div>
                      <div>
                        Container Pay: <span className="text-emerald-300">${payForForm.toFixed(2)}</span>
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

                    <div className="text-[10px] text-slate-500">Decimals allowed (ex: 33.33). Total must equal 100%.</div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-[11px] text-slate-400 font-semibold mb-1">
                    <div className="md:col-span-2">Name</div>
                    <div>Minutes</div>
                    <div>%</div>
                    <div>Payout</div>
                  </div>

                  <datalist id="precisionpulse-worker-options">
                    {workforceOptionsForForm.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>

                  {(containerForm.workers || []).map((w, idx) => (
                    <div key={idx} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
                      <div className="md:col-span-2 flex gap-2 items-start">
                        <div className="flex-1 space-y-1">
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
                          <div className="text-[10px] text-slate-600">{workforceOptionsForForm.length} workers available</div>
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
                        onChange={(e) => handleWorkerChange(idx, "minutesWorked", e.target.value)}
                        min={0}
                      />

                      <input
                        type="number"
                        step="0.01"
                        className="rounded-lg bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                        value={w.percentContribution}
                        onChange={(e) => handleWorkerChange(idx, "percentContribution", e.target.value)}
                        min={0}
                        max={100}
                      />

                      <div className="text-[11px] text-emerald-300">
                        $
                        {workersWithPayout[idx] ? Number(workersWithPayout[idx].payout).toFixed(2) : "0.00"}
                      </div>
                    </div>
                  ))}

                  <p className="text-[10px] text-slate-500 mt-1">
                    Pick from the roster (or type). If you use contributions, the total % should be 100%.
                  </p>
                </div>

                <div className="flex items-center justify-between mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowContainerForm(false);
                      resetContainerForm();
                    }}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] text-slate-200 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingContainer || (!isPercentValid && percentSum !== 0)}
                    className="rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-[11px] font-medium text-white px-4 py-2"
                  >
                    {savingContainer ? "Saving…" : containerForm.id ? "Save Changes" : "Create Container"}
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

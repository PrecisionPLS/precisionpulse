"use client";

import Link from "next/link";
import React, { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { BUILDINGS } from "@/lib/buildings";

const WORK_ORDERS_KEY = "precisionpulse_work_orders";
const CONTAINERS_KEY = "precisionpulse_containers";

const SHIFTS = ["1st", "2nd", "3rd", "4th"] as const;
const STATUS_OPTIONS = ["Pending", "Active", "Completed", "Locked"] as const;

type WorkOrderRecord = {
  id: string;
  name: string;
  building: string;
  shift: string;
  status: string;
  createdAt: string;
  notes?: string;

  // ownership fields (optional)
  createdByUserId?: string | null;
  createdByEmail?: string | null;
};

type ContainerRecord = {
  id: string;
  workOrderId?: string | null;
} & Record<string, unknown>;

type WorkOrderRow = {
  id: string;
  created_at: string;
  building: string;
  shift_name: string | null;
  work_order_code: string | null;
  status: string;
  notes: string | null;

  // optional columns (may not exist in your DB)
  created_by_user_id?: string | null;
  created_by_email?: string | null;
};

function safeReadArray<T extends Record<string, unknown>>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function mapRowToRecord(row: WorkOrderRow): WorkOrderRecord {
  const id = String(row.id);
  const createdAt = row.created_at ?? new Date().toISOString();
  const name =
    row.work_order_code ??
    `${row.status ?? "Pending"} Work Order ${id.slice(-4)}`;

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

function extractSupabaseError(err: unknown): Record<string, unknown> {
  const extracted: Record<string, unknown> = {
    type: typeof err,
    string: String(err),
  };

  if (typeof err === "object" && err !== null) {
    const rec = err as Record<string, unknown>;

    if (typeof rec.message === "string") extracted.message = rec.message;
    if (typeof rec.details === "string") extracted.details = rec.details;
    if (typeof rec.hint === "string") extracted.hint = rec.hint;
    if (typeof rec.code === "string") extracted.code = rec.code;
    if (typeof rec.status === "number") extracted.status = rec.status;

    for (const k of Object.getOwnPropertyNames(err)) {
      extracted[k] = rec[k];
    }
  }

  return extracted;
}

// Supabase errors often stringify to {} — log safely, and avoid Next's red overlay for expected retries.
function logSupabaseError(
  label: string,
  err: unknown,
  level: "error" | "warn" | "debug" = "error"
) {
  const extracted = extractSupabaseError(err);

  const logger =
    level === "error" ? console.error : level === "warn" ? console.warn : console.debug;

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

  // Postgres "column does not exist" often appears like:
  // 'column "created_by_user_id" of relation "work_orders" does not exist'
  return (
    msg.includes("does not exist") &&
    (msg.includes("created_by_user_id") || msg.includes("created_by_email"))
  );
}

export default function WorkOrdersPage() {
  const currentUser = useCurrentUser();

  const [workOrders, setWorkOrders] = useState<WorkOrderRecord[]>([]);
  const [containers, setContainers] = useState<ContainerRecord[]>(() =>
    safeReadArray<ContainerRecord>(CONTAINERS_KEY)
  );

  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [building, setBuilding] = useState("DC1");
  const [shift, setShift] = useState<(typeof SHIFTS)[number]>("1st");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("Pending");
  const [notes, setNotes] = useState("");

  const [filterBuilding, setFilterBuilding] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // role info
  const isLead = currentUser?.accessRole === "Lead";
  const leadBuilding = currentUser?.building || "";

  // Cache whether ownership columns exist in DB.
  // If they don't exist, we must NOT insert them.
  const [ownershipColsSupported, setOwnershipColsSupported] = useState<boolean | null>(null);

  // Check schema once (client-side) after login.
  useEffect(() => {
    if (!currentUser) return;

    let cancelled = false;

    async function probe() {
      try {
        // If RLS blocks this select, we treat as not supported to keep inserts safe.
        const { error } = await supabase
          .from("work_orders")
          .select("created_by_user_id,created_by_email")
          .limit(1);

        if (cancelled) return;

        if (error) {
          setOwnershipColsSupported(false);
          // Avoid red overlay — this isn't fatal; it just means we won't use those fields.
          logSupabaseError("Ownership column probe failed (treated as unsupported)", error, "warn");
        } else {
          setOwnershipColsSupported(true);
        }
      } catch (e) {
        if (!cancelled) setOwnershipColsSupported(false);
        logSupabaseError("Ownership column probe threw (treated as unsupported)", e, "warn");
      }
    }

    probe();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  function isOwner(wo: WorkOrderRecord): boolean {
    if (!currentUser) return false;

    const byId = !!wo.createdByUserId && wo.createdByUserId === currentUser.id;

    const byEmail =
      !!wo.createdByEmail &&
      wo.createdByEmail.toLowerCase() === currentUser.email.toLowerCase();

    return byId || byEmail;
  }

  function canLeadEdit(wo: WorkOrderRecord): boolean {
    if (!isLead) return true;
    return isOwner(wo);
  }

  const persistWorkOrders = useCallback((next: WorkOrderRecord[]) => {
    setWorkOrders(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(WORK_ORDERS_KEY, JSON.stringify(next));
    }
  }, []);

  const persistContainers = useCallback((next: ContainerRecord[]) => {
    setContainers(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CONTAINERS_KEY, JSON.stringify(next));
    }
  }, []);

  const refreshWorkOrders = useCallback(async () => {
    if (!currentUser) return;

    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from("work_orders")
        .select("*")
        .order("created_at", { ascending: false });

      if (isLead && leadBuilding) {
        query = query.eq("building", leadBuilding);
      }

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
      setLoading(false);
    }
  }, [currentUser, isLead, leadBuilding, persistWorkOrders]);

  useEffect(() => {
    if (!currentUser) return;
    refreshWorkOrders();
  }, [currentUser, refreshWorkOrders]);

  useEffect(() => {
    if (isLead && leadBuilding) {
      setFilterBuilding((prev) => (prev === "ALL" ? leadBuilding : prev));
      setBuilding((prev) => (prev === "DC1" ? leadBuilding : prev));
    }
  }, [isLead, leadBuilding]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function onStorage(e: StorageEvent) {
      if (e.key === CONTAINERS_KEY) {
        setContainers(safeReadArray<ContainerRecord>(CONTAINERS_KEY));
      }
    }

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function resetForm() {
    setEditingId(null);
    setName("");
    setBuilding(currentUser?.building || "DC18");
    setShift("1st");
    setStatus("Pending");
    setNotes("");
  }

  function handleEdit(order: WorkOrderRecord) {
    if (isLead && !canLeadEdit(order)) {
      setError("Leads can only edit their own work orders.");
      return;
    }

    setEditingId(order.id);
    setName(order.name);
    setBuilding(order.building);
    setShift(order.shift as (typeof SHIFTS)[number]);
    setStatus(order.status as (typeof STATUS_OPTIONS)[number]);
    setNotes(order.notes ?? "");
  }

  async function handleDelete(order: WorkOrderRecord) {
    if (isLead && !canLeadEdit(order)) {
      setError("Leads can only delete their own work orders.");
      return;
    }

    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "Delete this work order? Any containers linked to it will stay, but the link to this work order will be removed."
      );
      if (!ok) return;
    }

    setSaving(true);
    setError(null);

    try {
      const { error } = await supabase.from("work_orders").delete().eq("id", order.id);

      if (error) {
        logSupabaseError("Error deleting work order", error, "error");
        setError("Failed to delete work order.");
        return;
      }

      const updatedContainers = containers.map((c) => {
        if (c.workOrderId === order.id) {
          const copy = { ...c };
          delete (copy as Record<string, unknown>).workOrderId;
          return copy;
        }
        return c;
      });
      persistContainers(updatedContainers);

      await refreshWorkOrders();
      if (editingId === order.id) resetForm();
    } catch (e) {
      logSupabaseError("Unexpected error deleting work order", e, "error");
      setError("Unexpected error deleting work order.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;

    if (!name.trim()) {
      if (typeof window !== "undefined") window.alert("Please enter a work order name.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const effectiveBuilding = isLead && leadBuilding ? leadBuilding : building;

      // Base payload = only columns that we KNOW exist on your table.
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
          if (!existing || !canLeadEdit(existing)) {
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
        // Create: try with ownership columns ONLY if supported. If it fails due to missing cols, retry without them.
        let createPayload: Record<string, unknown> = { ...basePayload };

        if (ownershipColsSupported) {
          createPayload = {
            ...createPayload,
            created_by_user_id: currentUser?.id ?? null,
            created_by_email: currentUser?.email ?? null,
          };
        }

        // Do select().single() so we get real PostgREST error info back in dev.
        let res = await supabase.from("work_orders").insert(createPayload).select("id").single();

        if (res.error && ownershipColsSupported && isMissingOwnershipColumnError(res.error)) {
          // Expected if those cols don't exist; don't trigger red overlay.
          logSupabaseError(
            "Insert failed (ownership cols missing) — retrying without ownership",
            res.error,
            "warn"
          );

          // Mark unsupported so we don't try again this session
          setOwnershipColsSupported(false);

          res = await supabase.from("work_orders").insert(basePayload).select("id").single();
        }

        if (res.error) {
          logSupabaseError("Error creating work order", res.error, "error");
          setError(formatSupabaseError(res.error) || "Failed to create work order.");
          return;
        }
      }

      await refreshWorkOrders();
      resetForm();
    } catch (e) {
      logSupabaseError("Unexpected error saving work order", e, "error");
      setError(formatSupabaseError(e) || "Unexpected error saving work order.");
    } finally {
      setSaving(false);
    }
  }

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

  function containersForOrder(orderId: string): ContainerRecord[] {
    return containers.filter((c) => c.workOrderId === orderId);
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
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">Work Orders</h1>
            <p className="text-sm text-slate-400">
              Create, edit, and manage work orders that group containers by building, shift, and status.
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
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs space-y-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-slate-200 text-sm font-semibold">
                {editingId ? "Edit Work Order" : "Create Work Order"}
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

            {error && (
              <div className="mb-2 rounded-lg border border-rose-700 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-100">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
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
                    onChange={(e) => setShift(e.target.value as (typeof SHIFTS)[number])}
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
                  placeholder="Anything the lead or building manager should know about this wave..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="mt-1 w-full rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-[11px] font-medium text-white px-4 py-2"
              >
                {saving ? "Saving…" : editingId ? "Save Changes" : "Create Work Order"}
              </button>

              <div className="text-[10px] text-slate-500">
                Ownership columns detected:{" "}
                <span className="text-slate-300">
                  {ownershipColsSupported === null ? "checking…" : ownershipColsSupported ? "yes" : "no"}
                </span>
              </div>
            </form>
          </div>

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
                    Total: <span className="font-semibold">{workOrders.length}</span> · Showing:{" "}
                    <span className="font-semibold">{displayedOrders.length}</span>
                  </div>
                </div>
              </div>

              {loading && <div className="mt-2 text-[11px] text-slate-500">Loading work orders…</div>}
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
              <div className="flex items-center justify-between mb-2">
                <div className="text-slate-200 text-sm font-semibold">Work Order List</div>
                <div className="text-[11px] text-slate-500">Click a work order name to open and see containers.</div>
              </div>

              {displayedOrders.length === 0 ? (
                <p className="text-sm text-slate-500">No work orders found. Create one on the left to get started.</p>
              ) : (
                <div className="overflow-auto max-h-[480px]">
                  <table className="min-w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/60">
                        <th className="px-3 py-2 text-[11px] text-slate-400">Name</th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">Building</th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">Shift</th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">Status</th>
                        <th className="px-3 py-2 text-[11px] text-slate-400 text-right">Containers</th>
                        <th className="px-3 py-2 text-[11px] text-slate-400 text-right">Created</th>
                        <th className="px-3 py-2 text-[11px] text-slate-400 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedOrders.map((wo) => {
                        const containersForThis = containersForOrder(wo.id);
                        const dateShort = wo.createdAt.slice(0, 10);
                        const leadBlocked = isLead && !canLeadEdit(wo);

                        return (
                          <tr key={wo.id} className="border-b border-slate-800/60 hover:bg-slate-900/60">
                            <td className="px-3 py-2 text-slate-100">
                              <Link
                                href={`/work-orders/${wo.id}`}
                                className="flex flex-col text-xs font-medium text-sky-300 hover:underline"
                              >
                                <span>{wo.name}</span>
                                {wo.notes && (
                                  <span className="text-[11px] text-slate-500 line-clamp-1">{wo.notes}</span>
                                )}
                                <span className="text-[10px] text-sky-400 mt-0.5">View details & containers</span>
                              </Link>
                            </td>

                            <td className="px-3 py-2 text-slate-300">{wo.building}</td>
                            <td className="px-3 py-2 text-slate-300">{wo.shift}</td>

                            <td className="px-3 py-2">
                              <span
                                className={
                                  "inline-flex rounded-full px-2 py-0.5 text-[10px] " +
                                  (wo.status === "Completed"
                                    ? "bg-emerald-900/60 text-emerald-200 border border-emerald-700/70"
                                    : wo.status === "Active"
                                    ? "bg-sky-900/60 text-sky-200 border border-sky-700/70"
                                    : wo.status === "Locked"
                                    ? "bg-slate-900/80 text-slate-200 border border-slate-600/70"
                                    : "bg-amber-900/60 text-amber-200 border border-amber-700/70")
                                }
                              >
                                {wo.status}
                              </span>
                            </td>

                            <td className="px-3 py-2 text-right text-slate-200">{containersForThis.length}</td>
                            <td className="px-3 py-2 text-right text-slate-300 font-mono">{dateShort}</td>

                            <td className="px-3 py-2 text-right">
                              <div className="inline-flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleEdit(wo)}
                                  className="text-[11px] text-sky-300 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                                  disabled={leadBlocked}
                                  title={leadBlocked ? "Leads can only edit their own work orders." : "Edit"}
                                >
                                  Edit
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDelete(wo)}
                                  className="text-[11px] text-rose-300 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                                  disabled={saving || leadBlocked}
                                  title={leadBlocked ? "Leads can only delete their own work orders." : "Delete"}
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

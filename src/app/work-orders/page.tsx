"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";

const WORK_ORDERS_KEY = "precisionpulse_work_orders";
const CONTAINERS_KEY = "precisionpulse_containers";

const BUILDINGS = ["DC1", "DC5", "DC11", "DC14", "DC18"];
const SHIFTS = ["1st", "2nd", "3rd", "4th"];
const STATUS_OPTIONS = ["Pending", "Active", "Completed", "Locked"];

type WorkOrderRecord = {
  id: string;
  name: string;
  building: string;
  shift: string;
  status: string;
  createdAt: string;
  notes?: string;
};

type ContainerRecord = {
  id: string;
  workOrderId?: string;
  [key: string]: any; // keep any extra fields intact
};

// Shape as stored in Supabase
type WorkOrderRow = {
  id: string;
  created_at: string;
  building: string;
  shift_name: string | null;
  work_order_code: string | null;
  status: string;
  notes: string | null;
};

function mapRowToRecord(row: WorkOrderRow): WorkOrderRecord {
  const id = String(row.id);
  const createdAt = row.created_at ?? new Date().toISOString();
  const name =
    row.work_order_code ??
    row.status + " Work Order " + id.slice(-4);

  return {
    id,
    name,
    building: row.building ?? "DC1",
    shift: row.shift_name ?? "1st",
    status: row.status ?? "Pending",
    createdAt,
    notes: row.notes ?? "",
  };
}

export default function WorkOrdersPage() {
  const currentUser = useCurrentUser();

  const [workOrders, setWorkOrders] = useState<WorkOrderRecord[]>([]);
  const [containers, setContainers] = useState<ContainerRecord[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [building, setBuilding] = useState("DC1");
  const [shift, setShift] = useState("1st");
  const [status, setStatus] = useState("Pending");
  const [notes, setNotes] = useState("");

  const [filterBuilding, setFilterBuilding] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function persistWorkOrders(next: WorkOrderRecord[]) {
    setWorkOrders(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(WORK_ORDERS_KEY, JSON.stringify(next));
    }
  }

  function persistContainers(next: ContainerRecord[]) {
    setContainers(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CONTAINERS_KEY, JSON.stringify(next));
    }
  }

  async function refreshWorkOrders() {
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
        console.error("Error loading work orders", error);
        setError("Failed to load work orders from server.");
        return;
      }

      const rows = (data || []) as WorkOrderRow[];
      const mapped = rows.map(mapRowToRecord);
      persistWorkOrders(mapped);
    } catch (e) {
      console.error("Unexpected error loading work orders", e);
      setError("Unexpected error loading work orders.");
    } finally {
      setLoading(false);
    }
  }

  // Load work orders from Supabase when we know who is logged in
  useEffect(() => {
    if (!currentUser) return;
    refreshWorkOrders();
  }, [currentUser]);

  // Load containers from localStorage for "containers per work order" counts
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(CONTAINERS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const arr: ContainerRecord[] = Array.isArray(parsed) ? parsed : [];
        setContainers(arr);
      }
    } catch (e) {
      console.error("Failed to load containers for work order linking", e);
    }
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
    setEditingId(order.id);
    setName(order.name);
    setBuilding(order.building);
    setShift(order.shift);
    setStatus(order.status);
    setNotes(order.notes ?? "");
  }

  async function handleDelete(order: WorkOrderRecord) {
    if (typeof window !== "undefined") {
      const confirmDelete = window.confirm(
        "Delete this work order? Any containers linked to it will stay, but the link to this work order will be removed."
      );
      if (!confirmDelete) return;
    }

    setSaving(true);
    setError(null);

    try {
      const { error } = await supabase
        .from("work_orders")
        .delete()
        .eq("id", order.id);

      if (error) {
        console.error("Error deleting work order", error);
        setError("Failed to delete work order.");
        return;
      }

      // Detach containers that were linked to this work order (local only for now)
      const updatedContainers = containers.map((c) => {
        if (c.workOrderId === order.id) {
          const copy = { ...c };
          delete copy.workOrderId;
          return copy;
        }
        return c;
      });
      persistContainers(updatedContainers);

      // Reload from Supabase to keep in sync
      await refreshWorkOrders();

      if (editingId === order.id) {
        resetForm();
      }
    } catch (e) {
      console.error("Unexpected error deleting work order", e);
      setError("Unexpected error deleting work order.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;

    if (!name.trim()) {
      if (typeof window !== "undefined") {
        window.alert("Please enter a work order name.");
      }
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const payload = {
        building,
        shift_name: shift,
        work_order_code: name.trim(),
        status,
        notes: notes.trim() || null,
      };

      if (editingId) {
        const { error } = await supabase
          .from("work_orders")
          .update(payload)
          .eq("id", editingId);

        if (error) {
          console.error("Error updating work order", error);
          setError("Failed to update work order.");
          return;
        }
      } else {
        const { error } = await supabase.from("work_orders").insert(payload);
        if (error) {
          console.error("Error creating work order", error);
          setError("Failed to create work order.");
          return;
        }
      }

      await refreshWorkOrders();
      resetForm();
    } catch (e) {
      console.error("Unexpected error saving work order", e);
      setError("Unexpected error saving work order.");
    } finally {
      setSaving(false);
    }
  }

  const displayedOrders = useMemo(() => {
    return workOrders
      .filter((wo) => {
        if (filterBuilding !== "ALL" && wo.building !== filterBuilding) {
          return false;
        }
        if (filterStatus !== "ALL" && wo.status !== filterStatus) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [workOrders, filterBuilding, filterStatus]);

  function containersForOrder(orderId: string): ContainerRecord[] {
    return containers.filter((c) => c.workOrderId === orderId);
  }

  // Protect route after all hooks are declared
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
              Work Orders
            </h1>
            <p className="text-sm text-slate-400">
              Create, edit, and manage work orders that group containers
              by building, shift, and status.
            </p>
          </div>
          <Link
            href="/"
            className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {/* Form + filters */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form */}
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
                <label className="block text-[11px] text-slate-400 mb-1">
                  Work Order Name
                </label>
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                  placeholder="Example: DC18 Inbound Wave 1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
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
                  Notes (optional)
                </label>
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
                {saving
                  ? "Saving…"
                  : editingId
                  ? "Save Changes"
                  : "Create Work Order"}
              </button>
            </form>
          </div>

          {/* Filters + summary */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-slate-200 text-sm font-semibold">
                    Filters
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Narrow down work orders by building and status.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFilterBuilding("ALL");
                    setFilterStatus("ALL");
                  }}
                  className="text-[11px] text-sky-300 hover:underline"
                >
                  Reset
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Building
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
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
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Status
                  </label>
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
                  <div className="text-[11px] text-slate-400 mb-1">
                    Summary
                  </div>
                  <div className="text-[11px] text-slate-300">
                    Total:{" "}
                    <span className="font-semibold">
                      {workOrders.length}
                    </span>{" "}
                    · Showing:{" "}
                    <span className="font-semibold">
                      {displayedOrders.length}
                    </span>
                  </div>
                </div>
              </div>
              {loading && (
                <div className="mt-2 text-[11px] text-slate-500">
                  Loading work orders…
                </div>
              )}
            </div>

            {/* Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
              <div className="flex items-center justify-between mb-2">
                <div className="text-slate-200 text-sm font-semibold">
                  Work Order List
                </div>
                <div className="text-[11px] text-slate-500">
                  Click Edit to change, Delete to remove and unlink
                  containers.
                </div>
              </div>

              {displayedOrders.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No work orders found. Create one on the left to get
                  started.
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
                          Building
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Shift
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400">
                          Status
                        </th>
                        <th className="px-3 py-2 text-[11px] text-slate-400 text-right">
                          Containers
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
                      {displayedOrders.map((wo) => {
                        const containersForThis = containersForOrder(wo.id);
                        const dateShort = wo.createdAt.slice(0, 10);
                        return (
                          <tr
                            key={wo.id}
                            className="border-b border-slate-800/60 hover:bg-slate-900/60"
                          >
                            <td className="px-3 py-2 text-slate-100">
                              <div className="text-xs font-medium">
                                {wo.name}
                              </div>
                              {wo.notes && (
                                <div className="text-[11px] text-slate-500 line-clamp-1">
                                  {wo.notes}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              {wo.building}
                            </td>
                            <td className="px-3 py-2 text-slate-300">
                              {wo.shift}
                            </td>
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
                            <td className="px-3 py-2 text-right text-slate-200">
                              {containersForThis.length}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-300 font-mono">
                              {dateShort}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="inline-flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleEdit(wo)}
                                  className="text-[11px] text-sky-300 hover:underline"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(wo)}
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

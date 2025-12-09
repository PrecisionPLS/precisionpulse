"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

function normalizeWorkOrder(raw: any): WorkOrderRecord {
  const id = String(raw?.id ?? Date.now());
  const createdAt =
    raw?.createdAt ??
    raw?.date ??
    new Date().toISOString();
  const name =
    raw?.name ??
    raw?.title ??
    `Work Order ${id.slice(-4)}`;

  return {
    id,
    name,
    building: raw?.building ?? "DC1",
    shift: raw?.shift ?? "1st",
    status: raw?.status ?? "Pending",
    createdAt,
    notes: raw?.notes ?? raw?.description ?? "",
  };
}

export default function WorkOrdersPage() {
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

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(WORK_ORDERS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const normalized: WorkOrderRecord[] = Array.isArray(parsed)
          ? parsed.map(normalizeWorkOrder)
          : [];
        setWorkOrders(normalized);
      }
    } catch (e) {
      console.error("Failed to load work orders", e);
    }

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

  function resetForm() {
    setEditingId(null);
    setName("");
    setBuilding("DC1");
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

  function handleDelete(order: WorkOrderRecord) {
    if (typeof window !== "undefined") {
      const confirm = window.confirm(
        "Delete this work order? Any containers linked to it will stay, but the link to this work order will be removed."
      );
      if (!confirm) return;
    }

    // Remove work order
    const nextOrders = workOrders.filter((w) => w.id !== order.id);
    persistWorkOrders(nextOrders);

    // Detach containers that were linked to this work order
    const updatedContainers = containers.map((c) => {
      if (c.workOrderId === order.id) {
        const copy = { ...c };
        delete copy.workOrderId;
        return copy;
      }
      return c;
    });
    persistContainers(updatedContainers);

    if (editingId === order.id) {
      resetForm();
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      if (typeof window !== "undefined") {
        window.alert("Please enter a work order name.");
      }
      return;
    }

    const nowIso = new Date().toISOString();

    if (editingId) {
      const next = workOrders.map((wo) =>
        wo.id === editingId
          ? {
              ...wo,
              name: name.trim(),
              building,
              shift,
              status,
              notes: notes.trim(),
            }
          : wo
      );
      persistWorkOrders(next);
    } else {
      const newOrder: WorkOrderRecord = {
        id: String(Date.now()),
        name: name.trim(),
        building,
        shift,
        status,
        notes: notes.trim(),
        createdAt: nowIso,
      };
      persistWorkOrders([newOrder, ...workOrders]);
    }

    resetForm();
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
                className="mt-1 w-full rounded-lg bg-sky-600 hover:bg-sky-500 text-[11px] font-medium text-white px-4 py-2"
              >
                {editingId ? "Save Changes" : "Create Work Order"}
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

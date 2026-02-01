"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";

const CONTAINERS_KEY = "precisionpulse_containers";

type WorkOrderRow = {
  id: string;
  created_at: string;
  building: string;
  shift_name: string | null;
  work_order_code: string | null;
  status: string;
  notes: string | null;
};

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
  [key: string]: unknown; // ✅ no "any"
};

function mapRowToRecord(row: WorkOrderRow): WorkOrderRecord {
  const id = String(row.id);
  const createdAt = row.created_at ?? new Date().toISOString();
  const name = row.work_order_code ?? row.status + " Work Order " + id.slice(-4);

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

function displayValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return "[object]";
    }
  }
  return String(v);
}

export default function WorkOrderDetailPage() {
  const params = useParams();
  const workOrderId = params?.id as string;
  const currentUser = useCurrentUser();

  const [workOrder, setWorkOrder] = useState<WorkOrderRecord | null>(null);
  const [containers, setContainers] = useState<ContainerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isLead = currentUser?.accessRole === "Lead";
  const leadBuilding = currentUser?.building || "";

  useEffect(() => {
    if (!currentUser || !workOrderId) return;

    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        // 1) Load work order from Supabase
        const { data, error } = await supabase
          .from("work_orders")
          .select("*")
          .eq("id", workOrderId)
          .maybeSingle();

        if (error) {
          console.error("Error loading work order detail", error);
          setError("Failed to load work order details.");
          setLoading(false);
          return;
        }

        if (!data) {
          setError("Work order not found.");
          setLoading(false);
          return;
        }

        const woRow = data as WorkOrderRow;
        const woRecord = mapRowToRecord(woRow);

        // 🔒 If user is a Lead, block viewing other buildings
        if (isLead && leadBuilding && woRecord.building !== leadBuilding) {
          setError("You are not authorized to view this work order.");
          setLoading(false);
          return;
        }

        setWorkOrder(woRecord);

        // 2) Load containers from localStorage
        if (typeof window !== "undefined") {
          try {
            const raw = window.localStorage.getItem(CONTAINERS_KEY);
            if (raw) {
              const parsed: unknown = JSON.parse(raw);
              const arr: ContainerRecord[] = Array.isArray(parsed) ? (parsed as ContainerRecord[]) : [];
              const linked = arr.filter((c) => c?.workOrderId === workOrderId);
              setContainers(linked);
            } else {
              setContainers([]);
            }
          } catch (e) {
            console.error("Failed to load containers for detail page", e);
            setContainers([]);
          }
        }
      } catch (e) {
        console.error("Unexpected error loading work order detail", e);
        setError("Unexpected error loading work order.");
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [currentUser, workOrderId, isLead, leadBuilding]);

  // Route protection
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

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50">
        <div className="mx-auto max-w-5xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold text-slate-50">Work Order</h1>
            <Link
              href="/work-orders"
              className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
            >
              ← Back to Work Orders
            </Link>
          </div>
          <div className="rounded-lg border border-rose-700 bg-rose-950/40 px-4 py-3 text-xs text-rose-100">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (loading || !workOrder) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50">
        <div className="mx-auto max-w-5xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold text-slate-50">Work Order</h1>
            <Link
              href="/work-orders"
              className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
            >
              ← Back to Work Orders
            </Link>
          </div>
          <p className="text-sm text-slate-400">Loading work order…</p>
        </div>
      </div>
    );
  }

  const dateShort = workOrder.createdAt.slice(0, 10);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50">
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">{workOrder.name}</h1>
            <p className="text-sm text-slate-400">
              Building {workOrder.building} · {workOrder.shift} shift ·{" "}
              <span
                className={
                  "inline-flex rounded-full px-2 py-0.5 text-[11px] ml-1 " +
                  (workOrder.status === "Completed"
                    ? "bg-emerald-900/60 text-emerald-200 border border-emerald-700/70"
                    : workOrder.status === "Active"
                    ? "bg-sky-900/60 text-sky-200 border border-sky-700/70"
                    : workOrder.status === "Locked"
                    ? "bg-slate-900/80 text-slate-200 border border-slate-600/70"
                    : "bg-amber-900/60 text-amber-200 border border-amber-700/70")
                }
              >
                {workOrder.status}
              </span>
            </p>
            <p className="text-xs text-slate-500 mt-1">Created on {dateShort}</p>
          </div>
          <div className="flex flex-col items-end gap-2 text-xs">
            <Link
              href="/work-orders"
              className="inline-flex items-center px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
            >
              ← Back to Work Orders
            </Link>
            <div className="text-[11px] text-slate-400">
              Total containers linked:{" "}
              <span className="font-semibold text-slate-100">{containers.length}</span>
            </div>
          </div>
        </div>

        {/* Notes card */}
        {workOrder.notes && (
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 text-xs">
            <div className="text-[11px] text-slate-400 mb-1">Work Order Notes</div>
            <div className="text-slate-200 whitespace-pre-wrap">{workOrder.notes}</div>
          </div>
        )}

        {/* Containers section */}
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 text-xs space-y-3">
          <div className="flex items-center justify-between mb-1">
            <div>
              <div className="text-slate-200 text-sm font-semibold">Containers for this Work Order</div>
              <div className="text-[11px] text-slate-500">
                Showing all containers linked with this work order in your browser.
              </div>
            </div>
            <div className="text-[11px] text-slate-400">
              Total: <span className="font-semibold text-slate-100">{containers.length}</span>
            </div>
          </div>

          {containers.length === 0 ? (
            <p className="text-[11px] text-slate-400">No containers are linked to this work order yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {containers.map((c) => {
                const entries = Object.entries(c).filter(([key]) => key !== "id" && key !== "workOrderId");

                return (
                  <div key={c.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-1">
                    <div className="text-[10px] text-slate-500 mb-1">
                      Container ID: <span className="font-mono text-slate-200">{c.id}</span>
                    </div>

                    {entries.length === 0 ? (
                      <div className="text-[10px] text-slate-500">(No additional fields on this container record.)</div>
                    ) : (
                      entries.slice(0, 10).map(([key, value]) => (
                        <div key={key} className="flex justify-between gap-2">
                          <span className="text-[10px] text-slate-400">{key}</span>
                          <span className="text-[10px] text-slate-200 max-w-[12rem] truncate text-right">
                            {displayValue(value)}
                          </span>
                        </div>
                      ))
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

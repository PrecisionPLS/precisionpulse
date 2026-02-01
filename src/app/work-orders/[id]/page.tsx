"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";

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
  work_date: string | null;
  container_no: string;
  pieces_total: number;
  skus_total: number;
  pay_total: number;
  workers: WorkerContribution[];
  damage_pieces: number;
  rework_pieces: number;
  work_order_id: string | null;
  palletized?: boolean | null;

  created_by_user_id?: string | null;
  created_by_email?: string | null;
};

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

function safeISODate10(s: string): string {
  return String(s || "").slice(0, 10);
}

export default function WorkOrderDetailPage() {
  const params = useParams();
  const workOrderId = String((params as { id?: string })?.id ?? "");
  const currentUser = useCurrentUser();

  const role = currentUser?.accessRole ?? "";
  const isLead = role === "Lead";
  const isBuildingManager = role === "Building Manager";
  const isSuperAdmin = role === "Super Admin";

  const scopedBuilding = currentUser?.building ?? "";
  const scopedShift = (currentUser as unknown as { shift?: string | null })?.shift ?? "";

  const userIdent = useMemo(() => {
    return {
      id: currentUser?.id ?? "",
      email: currentUser?.email ?? "",
    };
  }, [currentUser]);

  const [workOrder, setWorkOrder] = useState<WorkOrderRecord | null>(null);
  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingContainers, setLoadingContainers] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser || !workOrderId) return;

    let cancelled = false;

    async function loadWorkOrderAndContainers() {
      setLoading(true);
      setLoadingContainers(true);
      setError(null);

      try {
        // 1) Load the work order row
        const woRes = await supabase.from("work_orders").select("*").eq("id", workOrderId).maybeSingle();

        if (woRes.error) {
          console.error("Error loading work order detail:", woRes.error);
          if (!cancelled) setError("Failed to load work order details.");
          return;
        }

        if (!woRes.data) {
          if (!cancelled) setError("Work order not found.");
          return;
        }

        const woRecord = mapRowToRecord(woRes.data as WorkOrderRow);

        // 🔒 Authorization guard
        if (isLead || isBuildingManager) {
          if (scopedBuilding && woRecord.building !== scopedBuilding) {
            if (!cancelled) setError("You are not authorized to view this work order.");
            return;
          }
        }

        // If Lead: also enforce shift match (if your rule is “Lead shift locked”)
        if (isLead && scopedShift) {
          if (String(woRecord.shift) !== String(scopedShift)) {
            if (!cancelled) setError("You are not authorized to view this work order (shift restricted).");
            return;
          }
        }

        if (!cancelled) setWorkOrder(woRecord);

        // 2) Load containers from Supabase (NOT localStorage)
        setLoadingContainers(true);

        let cq = supabase
          .from("containers")
          .select("*")
          .eq("work_order_id", workOrderId)
          .order("created_at", { ascending: false });

        // Building scope for Lead/Manager
        if ((isLead || isBuildingManager) && scopedBuilding) cq = cq.eq("building", scopedBuilding);

        // Lead shift scope
        if (isLead && scopedShift) cq = cq.eq("shift", scopedShift);

        // If you want Lead to only see their OWN container rows:
        // (requires created_by_* columns to exist and be populated)
        if (isLead) {
          cq = cq.or(`created_by_user_id.eq.${userIdent.id},created_by_email.eq.${userIdent.email}`);
        }

        const cRes = await cq;

        if (cRes.error) {
          console.error("Error loading containers for WO detail:", cRes.error);
          if (!cancelled) setError("Failed to load containers for this work order.");
          return;
        }

        const rows = ((cRes.data as unknown) as ContainerRow[]) ?? [];
        if (!cancelled) setContainers(rows);
      } catch (e) {
        console.error("Unexpected error loading work order detail:", e);
        if (!cancelled) setError("Unexpected error loading work order.");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoadingContainers(false);
        }
      }
    }

    loadWorkOrderAndContainers();

    return () => {
      cancelled = true;
    };
  }, [currentUser, workOrderId, isLead, isBuildingManager, isSuperAdmin, scopedBuilding, scopedShift, userIdent.id, userIdent.email]);

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
            <Link href="/work-orders" className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800">
              ← Back to Work Orders
            </Link>
          </div>
          <div className="rounded-lg border border-rose-700 bg-rose-950/40 px-4 py-3 text-xs text-rose-100">{error}</div>
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
            <Link href="/work-orders" className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800">
              ← Back to Work Orders
            </Link>
          </div>
          <p className="text-sm text-slate-400">Loading work order…</p>
        </div>
      </div>
    );
  }

  const dateShort = safeISODate10(workOrder.createdAt);

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
            <Link href="/work-orders" className="inline-flex items-center px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800">
              ← Back to Work Orders
            </Link>
            <div className="text-[11px] text-slate-400">
              Total containers linked:{" "}
              <span className="font-semibold text-slate-100">{loadingContainers ? "…" : containers.length}</span>
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
              <div className="text-[11px] text-slate-500">Loaded from the database.</div>
            </div>
            <div className="text-[11px] text-slate-400">
              Total: <span className="font-semibold text-slate-100">{loadingContainers ? "…" : containers.length}</span>
            </div>
          </div>

          {loadingContainers ? (
            <p className="text-[11px] text-slate-400">Loading containers…</p>
          ) : containers.length === 0 ? (
            <p className="text-[11px] text-slate-400">No containers are linked to this work order yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {containers.map((c) => {
                const entries = Object.entries(c).filter(([key]) => key !== "id");

                return (
                  <div key={c.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-1">
                    <div className="text-[10px] text-slate-500 mb-1">
                      Container ID: <span className="font-mono text-slate-200">{c.id}</span>
                    </div>

                    {entries.slice(0, 12).map(([key, value]) => (
                      <div key={key} className="flex justify-between gap-2">
                        <span className="text-[10px] text-slate-400">{key}</span>
                        <span className="text-[10px] text-slate-200 max-w-[12rem] truncate text-right">{displayValue(value)}</span>
                      </div>
                    ))}
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

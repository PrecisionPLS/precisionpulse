"use client";

import { useEffect, useMemo, useState, FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { useRouter } from "next/navigation";
import { BUILDINGS } from "@/lib/buildings"; // ✅ shared buildings

const CONTAINERS_KEY = "precisionpulse_containers";

// Workers stored in Supabase JSON
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

export default function ContainersPage() {
  const currentUser = useCurrentUser();
  const router = useRouter();

  // Role + building info
  const isLead = currentUser?.accessRole === "Lead";
  const leadBuilding = currentUser?.building || "";

  // Filters & UI state
  const [buildingFilter, setBuildingFilter] = useState<string>(() =>
    isLead && leadBuilding ? leadBuilding : "ALL"
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderOption[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [formState, setFormState] = useState<EditFormState>({
    building: currentUser?.building || BUILDINGS[0] || "DC18",
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

  // If user changes (or their building changes), keep the filter locked for Leads
  useEffect(() => {
    if (isLead && leadBuilding && buildingFilter !== leadBuilding) {
      setBuildingFilter(leadBuilding);
    }
  }, [isLead, leadBuilding, buildingFilter]);

  // Load containers from Supabase and sync to localStorage
  useEffect(() => {
    if (!currentUser) return;

    async function loadContainers() {
      setLoading(true);
      setError(null);
      try {
        let query = supabase
          .from("containers")
          .select("*")
          .order("created_at", { ascending: false });

        // If this user is a Lead, only show containers for their building
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
          })) ?? [];

        setContainers(rows);

        // Sync to localStorage so Dashboard/Reports/Work Orders still work
        try {
          const mappedForLocal = rows.map((row) => ({
            id: row.id,
            building: row.building,
            createdAt: row.created_at,
            containerNo: row.container_no,
            piecesTotal: row.pieces_total,
            skusTotal: row.skus_total,
            containerPayTotal: row.pay_total,
            workOrderId: row.work_order_id, // <-- for Work Orders page
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

    loadContainers();
  }, [currentUser, isLead, leadBuilding]);

  // Load work orders for the Work Order dropdown (only once we know user)
  useEffect(() => {
    if (!currentUser) return;

    async function loadWorkOrders() {
      try {
        const { data, error } = await supabase
          .from("work_orders")
          .select("id, building, status, work_order_code, created_at")
          .order("created_at", { ascending: false });

        if (error) {
          console.error("Error loading work orders for container form", error);
          return;
        }

        const opts: WorkOrderOption[] =
          (data || []).map((row: any) => ({
            id: row.id as string,
            name:
              (row.work_order_code as string | null) ??
              `Work Order ${String(row.id).slice(-4)}`,
            building: (row.building as string | null) ?? (BUILDINGS[0] || "DC1"),
            status: (row.status as string | null) ?? "Pending",
          })) ?? [];

        setWorkOrders(opts);
      } catch (e) {
        console.error(
          "Unexpected error loading work orders for container form",
          e
        );
      }
    }

    loadWorkOrders();
  }, [currentUser]);

  const filteredContainers = useMemo(() => {
    let rows = [...containers];

    // Hard lock for Leads — they only ever see their building’s containers
    if (isLead && leadBuilding) {
      rows = rows.filter((c) => c.building === leadBuilding);
      return rows;
    }

    // Non-Leads can use the building filter (including "ALL")
    if (buildingFilter !== "ALL") {
      rows = rows.filter((c) => c.building === buildingFilter);
    }

    return rows;
  }, [containers, buildingFilter, isLead, leadBuilding]);

  const totalPieces = useMemo(
    () =>
      filteredContainers.reduce((sum, c) => {
        return sum + (c.pieces_total || 0);
      }, 0),
    [filteredContainers]
  );

  const totalPay = useMemo(
    () =>
      filteredContainers.reduce((sum, c) => {
        return sum + (Number(c.pay_total) || 0);
      }, 0),
    [filteredContainers]
  );

  function resetForm() {
    setFormState({
      building: currentUser?.building || BUILDINGS[0] || "DC18",
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

  function handleWorkerChange(
    index: number,
    field: keyof WorkerContribution,
    value: string
  ) {
    setFormState((prev) => {
      const workers = [...prev.workers];
      const w = { ...workers[index] };

      if (field === "minutesWorked") {
        w.minutesWorked = Number(value) || 0;
      } else if (field === "percentContribution") {
        w.percentContribution = Number(value) || 0;
      } else if (field === "name") {
        w.name = value;
      }
      workers[index] = w;
      return { ...prev, workers };
    });
  }

  const { payForForm, workersWithPayout, percentSum } = useMemo(() => {
    const pieces = formState.piecesTotal || 0;
    const pay = calculateContainerPay(pieces);

    const workers = (formState.workers || []).map((w) => {
      const pct = w.percentContribution || 0;
      const payout = (pay * pct) / 100;
      return {
        ...w,
        payout,
      };
    });

    const sumPct = workers.reduce(
      (sum, w) => sum + (w.percentContribution || 0),
      0
    );

    return {
      payForForm: pay,
      workersWithPayout: workers,
      percentSum: sumPct,
    };
  }, [formState.piecesTotal, formState.workers]);

  const isPercentValid = percentSum === 100 || percentSum === 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;

    setError(null);

    if (!formState.containerNo.trim()) {
      setError("Container number is required.");
      return;
    }
    if (formState.piecesTotal <= 0) {
      setError("Pieces total must be greater than 0.");
      return;
    }

    const finalWorkers = workersWithPayout.filter(
      (w) => w.name.trim() && w.percentContribution > 0
    );

    if (finalWorkers.length > 0 && !isPercentValid) {
      setError("Worker contribution percentages must total exactly 100%.");
      return;
    }

    setSaving(true);

    try {
      // Force building for Leads
      const effectiveBuilding =
        isLead && leadBuilding ? leadBuilding : formState.building;

      const payload: any = {
        building: effectiveBuilding,
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
        const { error } = await supabase
          .from("containers")
          .update(payload)
          .eq("id", formState.id);

        if (error) {
          console.error("Error updating container", error);
          setError("Failed to update container.");
          return;
        }
      } else {
        const { error } = await supabase.from("containers").insert(payload);
        if (error) {
          console.error("Error inserting container", error);
          setError("Failed to create container.");
          return;
        }
      }

      // Reload from Supabase and sync localStorage
      let reloadQuery = supabase
        .from("containers")
        .select("*")
        .order("created_at", { ascending: false });

      if (isLead && leadBuilding) {
        reloadQuery = reloadQuery.eq("building", leadBuilding);
      }

      const { data, error: loadError } = await reloadQuery;

      if (loadError) {
        console.error("Error reloading containers", loadError);
      } else {
        const rows: ContainerRow[] =
          (data as any as ContainerRow[])?.map((row) => ({
            ...row,
            workers: (row.workers || []) as WorkerContribution[],
            work_order_id: row.work_order_id ?? null,
          })) ?? [];
        setContainers(rows);

        try {
          const mappedForLocal = rows.map((row) => ({
            id: row.id,
            building: row.building,
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
      }

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
      if (error) {
        console.error("Error deleting container", error);
        setError("Failed to delete container.");
        return;
      }

      const updated = containers.filter((c) => c.id !== id);
      setContainers(updated);

      try {
        const mappedForLocal = updated.map((row) => ({
          id: row.id,
          building: row.building,
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
      console.error("Unexpected error deleting container", e);
      setError("Unexpected error deleting container.");
    } finally {
      setSaving(false);
    }
  }

  // Protect route AFTER all hooks
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

  // Work orders filtered by selected building for the dropdown
  const workOrdersForBuilding = workOrders.filter(
    (wo) => wo.building === formState.building
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">
              Containers
            </h1>
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
              {/* Non-Leads can see "All Buildings" */}
              {!isLead && <option value="ALL">All Buildings</option>}
              {BUILDINGS.map((b) => {
                // Leads only see their own building option
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
              Containers:{" "}
              <span className="text-slate-100">
                {filteredContainers.length}
              </span>
            </div>
            <div className="text-slate-400">
              Total Pieces:{" "}
              <span className="text-slate-100">{totalPieces}</span>
            </div>
            <div className="text-slate-400">
              Total Pay:{" "}
              <span className="text-emerald-300">
                ${totalPay.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-700 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-100">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 shadow-sm shadow-slate-900/60">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-100">
              Container List
            </h2>
            {loading && (
              <div className="text-[11px] text-slate-400">Loading…</div>
            )}
          </div>

          <div className="overflow-x-auto text-xs">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                  <th className="text-left py-2 pr-3">Date</th>
                  <th className="text-left py-2 pr-3">Building</th>
                  <th className="text-left py-2 pr-3">Container #</th>
                  <th className="text-left py-2 pr-3">Work Order</th>
                  <th className="text-right py-2 pr-3">Pieces</th>
                  <th className="text-right py-2 pr-3">SKUs</th>
                  <th className="text-right py-2 pr-3">Pay Total</th>
                  <th className="text-left py-2 pr-3">Workers</th>
                  <th className="text-right py-2 pl-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredContainers.length === 0 && !loading && (
                  <tr>
                    <td
                      colSpan={9}
                      className="py-3 text-center text-[11px] text-slate-500"
                    >
                      No containers found for this filter.
                    </td>
                  </tr>
                )}
                {filteredContainers.map((c) => {
                  const workOrderName =
                    workOrders.find((wo) => wo.id === c.work_order_id)?.name ||
                    (c.work_order_id ? c.work_order_id.slice(0, 8) : "—");

                  return (
                    <tr
                      key={c.id}
                      className="border-b border-slate-800/60 hover:bg-slate-900/70"
                    >
                      <td className="py-2 pr-3 text-[11px] text-slate-400">
                        {new Date(c.created_at).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3 text-[11px] text-slate-200">
                        {c.building}
                      </td>
                      <td className="py-2 pr-3 text-[11px] text-slate-200">
                        {c.container_no}
                      </td>
                      <td className="py-2 pr-3 text-[11px] text-slate-300">
                        {workOrderName}
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
                              `${w.name} (${w.percentContribution}% · $${w.payout.toFixed(
                                2
                              )})`
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
                  );
                })}
              </tbody>
            </table>
          </div>
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
                          // when building changes, clear work order selection
                          workOrderId: null,
                        }))
                      }
                      disabled={isLead && !!leadBuilding}
                    >
                      {BUILDINGS.map((b) => {
                        if (isLead && leadBuilding && b !== leadBuilding)
                          return null;
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

                {/* Work Order select */}
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

                <div className="rounded-xl bg-slate-900 border border-slate-800 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] text-slate-300 font-semibold">
                      Worker Contributions
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Total %:{" "}
                      <span
                        className={
                          isPercentValid ? "text-emerald-300" : "text-rose-300"
                        }
                      >
                        {percentSum}%
                      </span>{" "}
                      · Container Pay:{" "}
                      <span className="text-emerald-300">
                        ${payForForm.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-[11px] text-slate-400 font-semibold mb-1">
                    <div>Name</div>
                    <div>Minutes Worked</div>
                    <div>% Contribution</div>
                    <div>Payout</div>
                  </div>
                  {(formState.workers || []).map((w, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center"
                    >
                      <input
                        className="rounded-lg bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                        value={w.name}
                        onChange={(e) =>
                          handleWorkerChange(idx, "name", e.target.value)
                        }
                        placeholder={`Worker ${idx + 1}`}
                      />
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
                        className="rounded-lg bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                        value={w.percentContribution}
                        onChange={(e) =>
                          handleWorkerChange(
                            idx,
                            "percentContribution",
                            e.target.value
                          )
                        }
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
                    You can assign up to four workers. If you use contributions,
                    the percentages must sum to exactly 100% before you can
                    save.
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
                    {saving
                      ? "Saving…"
                      : formState.id
                      ? "Save Changes"
                      : "Create Container"}
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

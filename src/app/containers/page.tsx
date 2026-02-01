"use client";

import { useEffect, useMemo, useState, FormEvent, useCallback } from "react";
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
  work_date: string | null;
  container_no: string;
  pieces_total: number;
  skus_total: number;
  pay_total: number;
  workers: WorkerContribution[];
  damage_pieces: number;
  rework_pieces: number;
  work_order_id: string | null;

  // ✅ NEW
  palletized?: boolean | null;

  created_by_user_id?: string | null;
  created_by_email?: string | null;
};

type EditFormState = {
  id?: string;
  building: string;
  shift: ShiftName;
  workDate: string;
  containerNo: string;
  piecesTotal: number;
  skusTotal: number;
  workOrderId: string | null;

  // ✅ NEW
  palletized: boolean;

  workers: WorkerContribution[];
};

function calculateContainerPay(pieces: number, palletized: boolean): number {
  // ✅ Palletized overrides everything
  if (palletized) return 100;

  if (pieces <= 0) return 0;
  if (pieces <= 500) return 100;
  if (pieces <= 1500) return 130;
  if (pieces <= 3500) return 180;
  if (pieces <= 5500) return 230;
  if (pieces <= 7500) return 280;
  const extra = pieces - 7500;
  return 280 + extra * 0.05;
}

/**
 * ✅ NEW YORK TIME HELPERS (fixes the "tomorrow" bug from UTC toISOString)
 * We compute YYYY-MM-DD based on America/New_York.
 */
function nyISODate(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

function todayISODate() {
  return nyISODate();
}

/**
 * Display helper for date cells:
 * - Prefer work_date (already YYYY-MM-DD)
 * - Fallback to created_at interpreted in NY time
 */
function formatDateCellNY(work_date: string | null, created_at: string): string {
  if (work_date && String(work_date).length >= 10) return String(work_date).slice(0, 10);

  // created_at is often ISO with Z; format it in NY time
  const d = new Date(created_at);
  if (Number.isNaN(d.getTime())) return String(created_at).slice(0, 10);
  return nyISODate(d);
}

function blankWorker(): WorkerContribution {
  return { name: "", minutesWorked: 0, percentContribution: 0, payout: 0 };
}

function approxEqual(a: number, b: number, tolerance = 0.01): boolean {
  return Math.abs(a - b) <= tolerance;
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

    for (const k of Object.getOwnPropertyNames(err)) extracted[k] = rec[k];
  }
  return extracted;
}

function logSupabase(label: string, err: unknown, level: "error" | "warn" = "error") {
  const extracted = extractSupabaseError(err);
  const logger = level === "warn" ? console.warn : console.error;
  logger(label, extracted);
}

function formatSupabaseError(err: unknown): string {
  const e = extractSupabaseError(err);
  const msg =
    (typeof e.message === "string" && e.message) ||
    (typeof e.details === "string" && e.details) ||
    (typeof e.hint === "string" && e.hint) ||
    "";
  return msg || "Unknown error (check console).";
}

function isMissingOwnershipColumnError(err: unknown): boolean {
  const e = extractSupabaseError(err);
  const msg = String(e.message ?? e.details ?? e.hint ?? "").toLowerCase();
  return (
    msg.includes("does not exist") &&
    (msg.includes("created_by_user_id") || msg.includes("created_by_email"))
  );
}

export default function ContainersPage() {
  const currentUser = useCurrentUser();
  const router = useRouter();

  const role = currentUser?.accessRole;
  const isLead = role === "Lead";
  const isBuildingManager = role === "Building Manager";

  /**
   * ✅ Hide Containers page from Leads AND Building Managers.
   */
  useEffect(() => {
    if (!currentUser) return;
    if (isLead || isBuildingManager) router.replace("/work-orders");
  }, [currentUser, isLead, isBuildingManager, router]);

  function isOwner(row: ContainerRow): boolean {
    if (!currentUser) return false;
    const byId = !!row.created_by_user_id && row.created_by_user_id === currentUser.id;
    const byEmail =
      !!row.created_by_email &&
      row.created_by_email.toLowerCase() === currentUser.email.toLowerCase();
    return byId || byEmail;
  }

  function canLeadEdit(row: ContainerRow): boolean {
    if (!isLead) return true;
    return isOwner(row);
  }

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [showForm, setShowForm] = useState(false);

  const [ownershipColsSupported, setOwnershipColsSupported] = useState<boolean | null>(null);

  const [formState, setFormState] = useState<EditFormState>(() => ({
    building: currentUser?.building || BUILDINGS[0] || "DC18",
    shift: "1st",
    workDate: todayISODate(), // ✅ NY time
    containerNo: "",
    piecesTotal: 0,
    skusTotal: 0,
    workOrderId: null,
    palletized: false, // ✅ NEW
    workers: [blankWorker()],
  }));

  // Probe ownership columns for containers
  useEffect(() => {
    if (!currentUser) return;

    let cancelled = false;

    async function probe() {
      try {
        const { error } = await supabase
          .from("containers")
          .select("created_by_user_id,created_by_email")
          .limit(1);

        if (cancelled) return;

        if (error) {
          setOwnershipColsSupported(false);
          logSupabase("Containers ownership probe failed (treated as unsupported)", error, "warn");
        } else {
          setOwnershipColsSupported(true);
        }
      } catch (e) {
        if (!cancelled) setOwnershipColsSupported(false);
        logSupabase("Containers ownership probe threw (treated as unsupported)", e, "warn");
      }
    }

    probe();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

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
        palletized: !!row.palletized, // ✅ NEW
      }));
      if (typeof window !== "undefined")
        window.localStorage.setItem(CONTAINERS_KEY, JSON.stringify(mappedForLocal));
    } catch (e) {
      logSupabase("Failed to write containers to localStorage", e, "warn");
    }
  }, []);

  const loadContainers = useCallback(async () => {
    if (!currentUser) return;

    setLoading(true);
    setError(null);

    try {
      let query = supabase.from("containers").select("*").order("created_at", { ascending: false });

      // Even though Leads/Managers are redirected, keep it safe:
      if ((isLead || isBuildingManager) && currentUser.building)
        query = query.eq("building", currentUser.building);

      const { data, error } = await query;

      if (error) {
        logSupabase("Error loading containers", error, "error");
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
          palletized: (row as unknown as { palletized?: boolean | null }).palletized ?? null, // ✅ NEW
          created_by_user_id:
            (row as unknown as { created_by_user_id?: string | null }).created_by_user_id ?? null,
          created_by_email:
            (row as unknown as { created_by_email?: string | null }).created_by_email ?? null,
        })) ?? [];

      setContainers(rows);
      persistContainersLocal(rows);
    } catch (e) {
      logSupabase("Unexpected error loading containers", e, "error");
      setError("Unexpected error loading containers.");
    } finally {
      setLoading(false);
    }
  }, [currentUser, isLead, isBuildingManager, persistContainersLocal]);

  useEffect(() => {
    loadContainers();
  }, [loadContainers]);

  function resetForm() {
    setFormState({
      building: currentUser?.building || BUILDINGS[0] || "DC18",
      shift: "1st",
      workDate: todayISODate(), // ✅ NY time
      containerNo: "",
      piecesTotal: 0,
      skusTotal: 0,
      workOrderId: null,
      palletized: false, // ✅ NEW
      workers: [blankWorker()],
    });
  }

  function openNew() {
    resetForm();
    setShowForm(true);
  }

  function openEdit(row: ContainerRow) {
    setFormState({
      id: row.id,
      building: row.building,
      shift: ((row.shift as ShiftName) || "1st") as ShiftName,
      workDate: row.work_date ? String(row.work_date).slice(0, 10) : nyISODate(new Date(row.created_at)),
      containerNo: row.container_no,
      piecesTotal: row.pieces_total,
      skusTotal: row.skus_total,
      workOrderId: row.work_order_id ?? null,
      palletized: !!row.palletized, // ✅ NEW
      workers: (row.workers || []).length ? (row.workers || []) : [blankWorker()],
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
    const pay = calculateContainerPay(pieces, formState.palletized);

    const workers = (formState.workers || []).map((w) => {
      const pct = Number(w.percentContribution || 0);
      return { ...w, payout: (pay * pct) / 100 };
    });

    const sumPct = workers.reduce((sum, w) => sum + (Number(w.percentContribution) || 0), 0);
    return { payForForm: pay, workersWithPayout: workers, percentSum: sumPct };
  }, [formState.piecesTotal, formState.workers, formState.palletized]);

  const isPercentValid = approxEqual(percentSum, 100, 0.02) || approxEqual(percentSum, 0, 0.0001);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;

    setError(null);

    if (!formState.containerNo.trim()) return setError("Container number is required.");

    // ✅ Still force pieces even if palletized
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
      const basePayload: Record<string, unknown> = {
        building: formState.building,
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
        palletized: formState.palletized, // ✅ NEW
      };

      if (formState.id) {
        const existing = containers.find((c) => c.id === formState.id);
        if (!existing || !canLeadEdit(existing)) {
          setError("Not allowed.");
          return;
        }

        const { error } = await supabase.from("containers").update(basePayload).eq("id", formState.id);
        if (error) {
          logSupabase("Error updating container", error, "error");
          setError(formatSupabaseError(error) || "Failed to update container.");
          return;
        }
      } else {
        let createPayload: Record<string, unknown> = { ...basePayload };

        if (ownershipColsSupported) {
          createPayload = {
            ...createPayload,
            created_by_user_id: currentUser?.id ?? null,
            created_by_email: currentUser?.email ?? null,
          };
        }

        let res = await supabase.from("containers").insert(createPayload).select("id").single();

        if (res.error && ownershipColsSupported && isMissingOwnershipColumnError(res.error)) {
          logSupabase("Insert failed (ownership cols missing) — retrying", res.error, "warn");
          setOwnershipColsSupported(false);
          res = await supabase.from("containers").insert(basePayload).select("id").single();
        }

        if (res.error) {
          logSupabase("Error creating container", res.error, "error");
          setError(formatSupabaseError(res.error) || "Failed to create container.");
          return;
        }
      }

      await loadContainers();
      setShowForm(false);
      resetForm();
    } catch (e) {
      logSupabase("Unexpected error saving container", e, "error");
      setError("Unexpected error saving container.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const row = containers.find((c) => c.id === id);
    if (!row || !canLeadEdit(row)) {
      setError("Not allowed.");
      return;
    }

    if (typeof window !== "undefined") {
      const ok = window.confirm("Delete this container? This cannot be undone.");
      if (!ok) return;
    }

    setSaving(true);
    setError(null);

    try {
      const { error } = await supabase.from("containers").delete().eq("id", id);
      if (error) {
        logSupabase("Failed to delete container", error, "error");
        setError(formatSupabaseError(error) || "Failed to delete container.");
        return;
      }
      await loadContainers();
    } catch (e) {
      logSupabase("Unexpected error deleting container", e, "error");
      setError("Unexpected error deleting container.");
    } finally {
      setSaving(false);
    }
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

  /**
   * ✅ Block UI if they land here briefly (JS redirect might be blocked)
   */
  if (isLead || isBuildingManager) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6">
        <div className="max-w-lg w-full rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-3">
          <div className="text-lg font-semibold">Containers page is disabled</div>
          <div className="text-sm text-slate-300">
            Container entry and edits are handled inside{" "}
            <span className="text-slate-100 font-semibold">Work Orders</span>.
          </div>

          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={() => router.replace("/work-orders")}
              className="rounded-lg bg-sky-600 hover:bg-sky-500 text-[12px] font-medium text-white px-4 py-2"
            >
              Go to Work Orders
            </button>
            <button
              type="button"
              onClick={() => router.replace("/")}
              className="rounded-lg border border-slate-700 px-4 py-2 text-[12px] text-slate-200 hover:bg-slate-800"
            >
              Back to Dashboard
            </button>
          </div>

          <div className="text-[11px] text-slate-500">
            If you believe you should have access, contact a Super Admin.
          </div>
        </div>
      </div>
    );
  }

  // Admin / allowed roles view
  const totalPay = containers.reduce((sum, c) => sum + (Number(c.pay_total) || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50">
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">Containers</h1>
            <p className="text-sm text-slate-400">
              Admin view — add/edit containers. Palletized pays a flat $100.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openNew}
              className="rounded-lg bg-sky-600 hover:bg-sky-500 text-[12px] font-medium text-white px-4 py-2"
            >
              + New Container
            </button>
            <button
              type="button"
              onClick={() => router.replace("/")}
              className="rounded-lg border border-slate-700 px-4 py-2 text-[12px] text-slate-200 hover:bg-slate-800"
            >
              Back
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-700 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-100">
            {error}
          </div>
        )}

        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 text-xs">
          <div className="text-slate-300">
            Total containers:{" "}
            <span className="font-semibold text-slate-50">{containers.length}</span> · Total pay:{" "}
            <span className="font-semibold text-emerald-300">${totalPay.toFixed(2)}</span>
          </div>
          {loading && <div className="mt-2 text-[11px] text-slate-500">Loading…</div>}
        </div>

        <div className="overflow-x-auto rounded-2xl bg-slate-900 border border-slate-800 p-4 text-xs">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                <th className="text-left py-2 pr-3">Date</th>
                <th className="text-left py-2 pr-3">Building</th>
                <th className="text-left py-2 pr-3">Shift</th>
                <th className="text-left py-2 pr-3">Container #</th>
                <th className="text-right py-2 pr-3">Pieces</th>
                <th className="text-right py-2 pr-3">SKUs</th>
                <th className="text-left py-2 pr-3">Type</th>
                <th className="text-right py-2 pr-3">Pay Total</th>
                <th className="text-right py-2 pl-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {containers.map((c) => (
                <tr key={c.id} className="border-b border-slate-800/60 hover:bg-slate-900/70">
                  <td className="py-2 pr-3 text-[11px] text-slate-400">
                    {formatDateCellNY(c.work_date, c.created_at)}
                  </td>
                  <td className="py-2 pr-3 text-[11px] text-slate-200">{c.building}</td>
                  <td className="py-2 pr-3 text-[11px] text-slate-200">{c.shift ?? "—"}</td>
                  <td className="py-2 pr-3 text-[11px] text-slate-200">{c.container_no}</td>
                  <td className="py-2 pr-3 text-right text-[11px] text-slate-200">{c.pieces_total}</td>
                  <td className="py-2 pr-3 text-right text-[11px] text-slate-200">{c.skus_total}</td>
                  <td className="py-2 pr-3 text-[11px] text-slate-200">{c.palletized ? "Palletized" : "Loose"}</td>
                  <td className="py-2 pr-3 text-right text-[11px] text-emerald-300">
                    ${Number(c.pay_total).toFixed(2)}
                  </td>
                  <td className="py-2 pl-3 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        className="px-3 py-1 rounded-lg bg-slate-800 text-[11px] text-slate-100 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => openEdit(c)}
                        disabled={saving}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        className="px-3 py-1 rounded-lg bg-rose-700 text-[11px] text-white hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => handleDelete(c.id)}
                        disabled={saving}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {containers.length === 0 && !loading && (
                <tr>
                  <td className="py-6 text-center text-[11px] text-slate-500" colSpan={9}>
                    No containers yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Modal */}
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
                  type="button"
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
                      onChange={(e) => setFormState((prev) => ({ ...prev, building: e.target.value }))}
                    >
                      {BUILDINGS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Shift</label>
                    <select
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-[11px] text-slate-50"
                      value={formState.shift}
                      onChange={(e) => setFormState((prev) => ({ ...prev, shift: e.target.value as ShiftName }))}
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

                  {/* ✅ NEW: Palletized checkbox */}
                  <div className="md:col-span-4 flex items-center gap-2 pt-1">
                    <input
                      id="palletized"
                      type="checkbox"
                      className="h-4 w-4"
                      checked={formState.palletized}
                      onChange={(e) => setFormState((prev) => ({ ...prev, palletized: e.target.checked }))}
                    />
                    <label htmlFor="palletized" className="text-[11px] text-slate-200">
                      Palletized (flat $100 — overrides payscale)
                    </label>
                    <div className="ml-auto text-[11px] text-slate-400">
                      Pay Total:{" "}
                      <span className="text-emerald-300 font-semibold">${payForForm.toFixed(2)}</span>
                    </div>
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
                    />
                    {formState.palletized && (
                      <div className="mt-1 text-[10px] text-slate-500">
                        Pieces are still required for tracking, but pay is forced to $100 when palletized.
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">SKUs Total</label>
                    <input
                      type="number"
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                      value={formState.skusTotal}
                      onChange={(e) =>
                        setFormState((prev) => ({ ...prev, skusTotal: Number(e.target.value) || 0 }))
                      }
                    />
                  </div>
                </div>

                {/* Workers */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] text-slate-300 font-semibold">Workers</div>
                    <button type="button" onClick={addWorker} className="text-[11px] text-sky-300 hover:underline">
                      + Add worker
                    </button>
                  </div>

                  {formState.workers.map((w, idx) => (
                    <div key={idx} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
                      <div className="md:col-span-2">
                        <label className="block text-[10px] text-slate-500 mb-1">Name</label>
                        <input
                          className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                          value={w.name}
                          onChange={(e) => handleWorkerChange(idx, "name", e.target.value)}
                          placeholder="Worker name"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-500 mb-1">Minutes</label>
                        <input
                          type="number"
                          className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                          value={w.minutesWorked}
                          onChange={(e) => handleWorkerChange(idx, "minutesWorked", e.target.value)}
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-500 mb-1">% Contribution</label>
                        <input
                          type="number"
                          step="0.01"
                          className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                          value={w.percentContribution}
                          onChange={(e) => handleWorkerChange(idx, "percentContribution", e.target.value)}
                        />
                      </div>

                      <div className="flex items-end justify-between gap-2">
                        <div className="text-[10px] text-slate-500">
                          Payout:{" "}
                          <span className="text-emerald-300">
                            ${(((payForForm * (Number(w.percentContribution) || 0)) / 100) || 0).toFixed(2)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeWorker(idx)}
                          className="text-[11px] text-rose-300 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}

                  <div className="pt-2 text-[11px] text-slate-400">
                    % Total:{" "}
                    <span className={isPercentValid ? "text-emerald-300" : "text-rose-300"}>
                      {percentSum.toFixed(2)}%
                    </span>{" "}
                    {percentSum === 0 ? "(optional)" : ""}
                  </div>
                </div>

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

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { BUILDINGS } from "@/lib/buildings";

const SHIFTS = ["1st", "2nd", "3rd", "4th"] as const;

type AccessRole = "Super Admin" | "Building Manager" | "Lead" | string;
type ReportStatus = "Draft" | "In Progress" | "Ready" | "Completed";

// Keep this minimal and compatible with your existing useCurrentUser output.
// If your hook has more fields, that’s fine.
type CurrentUser = {
  id?: string;
  userId?: string;
  uid?: string;
  email?: string;
  name?: string;
  fullName?: string;
  displayName?: string;
  accessRole?: AccessRole;
  building?: string;
  shift?: string;
} | null;

type ReadinessMeta = {
  createdByUserId?: string;
  createdByName?: string;
  createdByRole?: string;
  updatedByUserId?: string;
  updatedByName?: string;
  updatedByRole?: string;
  updatedAtISO?: string;
};

type ReadinessItems = {
  _meta?: ReadinessMeta;

  shiftDetails?: {
    scheduledStartTime?: string; // "06:00"
    headcountTarget?: number | null;
    expectedContainers?: number | null;
    notes?: string;
  };

  staffing?: {
    allArrived?: boolean;
    staffingAdequate?: boolean;
    keyRolesCovered?: boolean;
    lateOrNoShowDetails?: string;
    staffingPlanNotes?: string;
  };

  safety?: {
    safetyTalkCompleted?: boolean;
    safetyTopic?: string;
    stretchingCompleted?: boolean;
    ppeCheckCompleted?: boolean;
    hazardsIdentified?: boolean;
    hazardsDetails?: string;
    incidentsReviewed?: boolean;
    nearMissReported?: boolean;
    nearMissDetails?: string;
  };

  facility?: {
    dockAislesClear?: boolean;
    stagingAreaReady?: boolean;
    doorsAssigned?: boolean;
    sanitationAcceptable?: boolean;
    facilityIssues?: boolean;
    facilityIssuesDetails?: string;
  };

  equipment?: {
    equipmentChecked?: boolean;
    forkliftsReady?: boolean;
    scannersRadiosReady?: boolean;
    wrapSuppliesReady?: boolean;
    equipmentDown?: boolean;
    equipmentDownDetails?: string;
  };

  plan?: {
    goalsReviewed?: boolean;
    priorityNotes?: string;
    assignmentsSet?: boolean;
    riskIdentified?: boolean;
    riskDetails?: string;
  };

  communication?: {
    whatsappBroadcastSent?: boolean;
    broadcastSummary?: string;
    leadershipNotifiedIfIssues?: boolean;
    dailyFocusMessage?: string;
  };

  confirmation?: {
    readyToStart?: boolean;
    shiftStartedAtISO?: string;
    completedAtISO?: string;
    finalNotes?: string;
  };
};

type StartupChecklist = {
  id: string;
  building: string;
  shift: string;
  date: string; // YYYY-MM-DD
  createdAt: string; // ISO
  completedAt?: string; // ISO
  items: ReadinessItems;
};

type StartupRow = {
  id: string;
  created_at: string;
  completed_at: string | null;
  building: string | null;
  shift: string | null;
  date: string | null;
  items: unknown; // ✅ no any
};

// --------------------
// Helpers
// --------------------

function safeString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function safeBool(v: unknown): boolean {
  return typeof v === "boolean" ? v : false;
}

function isoNow(): string {
  return new Date().toISOString();
}

function formatISODate(iso?: string): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function defaultItems(): ReadinessItems {
  return {
    _meta: {},
    shiftDetails: {
      scheduledStartTime: "",
      headcountTarget: null,
      expectedContainers: null,
      notes: "",
    },
    staffing: {
      allArrived: false,
      staffingAdequate: false,
      keyRolesCovered: false,
      lateOrNoShowDetails: "",
      staffingPlanNotes: "",
    },
    safety: {
      safetyTalkCompleted: false,
      safetyTopic: "",
      stretchingCompleted: false,
      ppeCheckCompleted: false,
      hazardsIdentified: false,
      hazardsDetails: "",
      incidentsReviewed: false,
      nearMissReported: false,
      nearMissDetails: "",
    },
    facility: {
      dockAislesClear: false,
      stagingAreaReady: false,
      doorsAssigned: false,
      sanitationAcceptable: false,
      facilityIssues: false,
      facilityIssuesDetails: "",
    },
    equipment: {
      equipmentChecked: false,
      forkliftsReady: false,
      scannersRadiosReady: false,
      wrapSuppliesReady: false,
      equipmentDown: false,
      equipmentDownDetails: "",
    },
    plan: {
      goalsReviewed: false,
      priorityNotes: "",
      assignmentsSet: false,
      riskIdentified: false,
      riskDetails: "",
    },
    communication: {
      whatsappBroadcastSent: false,
      broadcastSummary: "",
      leadershipNotifiedIfIssues: false,
      dailyFocusMessage: "",
    },
    confirmation: {
      readyToStart: false,
      shiftStartedAtISO: "",
      completedAtISO: "",
      finalNotes: "",
    },
  };
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function mergeItems(existing: unknown): ReadinessItems {
  const base = defaultItems();
  if (!isRecordLike(existing)) return base;

  const e = existing as Record<string, unknown>;

  // section-by-section safe merge
  const merged: ReadinessItems = {
    ...base,
    ...e,
    _meta: { ...(base._meta || {}), ...(isRecordLike(e._meta) ? (e._meta as ReadinessMeta) : {}) },
    shiftDetails: { ...(base.shiftDetails || {}), ...(isRecordLike(e.shiftDetails) ? (e.shiftDetails as ReadinessItems["shiftDetails"]) : {}) },
    staffing: { ...(base.staffing || {}), ...(isRecordLike(e.staffing) ? (e.staffing as ReadinessItems["staffing"]) : {}) },
    safety: { ...(base.safety || {}), ...(isRecordLike(e.safety) ? (e.safety as ReadinessItems["safety"]) : {}) },
    facility: { ...(base.facility || {}), ...(isRecordLike(e.facility) ? (e.facility as ReadinessItems["facility"]) : {}) },
    equipment: { ...(base.equipment || {}), ...(isRecordLike(e.equipment) ? (e.equipment as ReadinessItems["equipment"]) : {}) },
    plan: { ...(base.plan || {}), ...(isRecordLike(e.plan) ? (e.plan as ReadinessItems["plan"]) : {}) },
    communication: { ...(base.communication || {}), ...(isRecordLike(e.communication) ? (e.communication as ReadinessItems["communication"]) : {}) },
    confirmation: { ...(base.confirmation || {}), ...(isRecordLike(e.confirmation) ? (e.confirmation as ReadinessItems["confirmation"]) : {}) },
  };

  return merged;
}

function rowToStartup(row: StartupRow): StartupChecklist {
  return {
    id: String(row.id),
    building: row.building ?? BUILDINGS[0],
    shift: row.shift ?? SHIFTS[0],
    date: row.date ?? new Date().toISOString().slice(0, 10),
    createdAt: row.created_at ?? isoNow(),
    completedAt: row.completed_at ?? undefined,
    items: mergeItems(row.items),
  };
}

function computeStatus(rec: StartupChecklist) {
  const req: boolean[] = [
    safeBool(rec.items.staffing?.allArrived),
    safeBool(rec.items.staffing?.staffingAdequate),
    safeBool(rec.items.safety?.safetyTalkCompleted),
    safeBool(rec.items.safety?.stretchingCompleted),
    safeBool(rec.items.safety?.ppeCheckCompleted),
    safeBool(rec.items.facility?.dockAislesClear),
    safeBool(rec.items.equipment?.equipmentChecked),
    safeBool(rec.items.plan?.goalsReviewed),
    safeBool(rec.items.communication?.whatsappBroadcastSent),
    safeBool(rec.items.confirmation?.readyToStart),
  ];

  const total = req.length;
  const done = req.filter(Boolean).length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  const completedISO = safeString(rec.items.confirmation?.completedAtISO).trim();
  if (completedISO) return { status: "Completed" as const, percent: 100, done: total, total };

  const hasAny =
    done > 0 ||
    safeString(rec.items.communication?.dailyFocusMessage).trim().length > 0 ||
    safeString(rec.items.staffing?.lateOrNoShowDetails).trim().length > 0 ||
    safeString(rec.items.plan?.priorityNotes).trim().length > 0;

  if (!hasAny) return { status: "Draft" as const, percent, done, total };
  if (done === total) return { status: "Ready" as const, percent: 100, done, total };
  return { status: "In Progress" as const, percent, done, total };
}

function pillClass(status: ReportStatus) {
  if (status === "Completed")
    return "inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-900/60 text-emerald-200 border border-emerald-700 text-[11px]";
  if (status === "Ready")
    return "inline-flex items-center px-2 py-0.5 rounded-full bg-sky-900/60 text-sky-200 border border-sky-700 text-[11px]";
  if (status === "In Progress")
    return "inline-flex items-center px-2 py-0.5 rounded-full bg-amber-900/60 text-amber-200 border border-amber-700 text-[11px]";
  return "inline-flex items-center px-2 py-0.5 rounded-full bg-slate-900/60 text-slate-200 border border-slate-700 text-[11px]";
}

// --------------------
// Page
// --------------------

export default function ShiftReadinessReportsPage() {
  const currentUser = useCurrentUser() as CurrentUser;

  const role: AccessRole = currentUser?.accessRole ?? "";
  const isSuperAdmin = role === "Super Admin";
  const isBuildingManager = role === "Building Manager";
  const isLead = role === "Lead";

  const userId = safeString(currentUser?.id || currentUser?.userId || currentUser?.uid);
  const userName = safeString(currentUser?.name || currentUser?.fullName || currentUser?.displayName || currentUser?.email);
  const userBuilding = safeString(currentUser?.building);
  const userShift = safeString(currentUser?.shift);

  const [records, setRecords] = useState<StartupChecklist[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Create/edit header state
  const [building, setBuilding] = useState<string>(BUILDINGS[0]);
  const [shift, setShift] = useState<string>(SHIFTS[0]);
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  // Filters
  const [filterBuilding, setFilterBuilding] = useState<string>("ALL");
  const [filterShift, setFilterShift] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<ReportStatus | "ALL">("ALL");

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // --------------------
  // Permissions
  // --------------------

  function canViewRecord(r: StartupChecklist): boolean {
    if (isSuperAdmin) return true;

    if (isBuildingManager) {
      return !!userBuilding && r.building === userBuilding;
    }

    if (isLead) {
      const creatorId = safeString(r.items._meta?.createdByUserId);
      return (
        !!userBuilding &&
        !!userShift &&
        r.building === userBuilding &&
        r.shift === userShift &&
        !!creatorId &&
        creatorId === userId
      );
    }

    return false;
  }

  function canEditRecord(r: StartupChecklist): boolean {
    if (isSuperAdmin) return true;
    if (isBuildingManager) return !!userBuilding && r.building === userBuilding;
    if (isLead) return safeString(r.items._meta?.createdByUserId) === userId;
    return false;
  }

  function canDeleteRecord(): boolean {
    return isSuperAdmin; // ✅ only super admins delete
  }

  function lockBuildingOnCreate(): boolean {
    return (isLead || isBuildingManager) && !!userBuilding;
  }

  function lockShiftOnCreate(): boolean {
    return isLead && !!userShift;
  }

  // --------------------
  // Load
  // --------------------

  async function refreshFromSupabase() {
    if (!currentUser) return;

    setLoading(true);
    setError(null);

    try {
      let query = supabase.from("startup_checklists").select("*").order("created_at", { ascending: false });

      // narrowing query (RLS still required)
      if (isLead) {
        if (userBuilding) query = query.eq("building", userBuilding);
        if (userShift) query = query.eq("shift", userShift);
      } else if (isBuildingManager) {
        if (userBuilding) query = query.eq("building", userBuilding);
      }

      const { data, error: loadError } = await query;
      if (loadError) {
        console.error(loadError);
        setError("Failed to load shift readiness reports from server.");
        return;
      }

      const mapped = ((data ?? []) as StartupRow[]).map(rowToStartup);
      setRecords(mapped.filter(canViewRecord));
    } catch (e) {
      console.error(e);
      setError("Unexpected error loading shift readiness reports.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!currentUser) return;
    refreshFromSupabase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;

    if ((isLead || isBuildingManager) && userBuilding) {
      setBuilding(userBuilding);
      setFilterBuilding(userBuilding);
    }
    if (isLead && userShift) {
      setShift(userShift);
      setFilterShift(userShift);
    }
  }, [currentUser, isLead, isBuildingManager, userBuilding, userShift]);

  // --------------------
  // Summary / filter
  // --------------------

  const summary = useMemo(() => {
    const total = records.length;
    const completed = records.filter((r) => computeStatus(r).status === "Completed").length;
    const ready = records.filter((r) => computeStatus(r).status === "Ready").length;
    const inProgress = records.filter((r) => computeStatus(r).status === "In Progress").length;
    const draft = records.filter((r) => computeStatus(r).status === "Draft").length;

    const todayStr = new Date().toISOString().slice(0, 10);
    const todayRecords = records.filter((r) => r.date === todayStr);
    const todayReady = todayRecords.filter((r) => ["Ready", "Completed"].includes(computeStatus(r).status)).length;

    return { total, completed, ready, inProgress, draft, todayReady };
  }, [records]);

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (filterBuilding !== "ALL" && r.building !== filterBuilding) return false;
      if (filterShift !== "ALL" && r.shift !== filterShift) return false;
      if (filterStatus !== "ALL" && computeStatus(r).status !== filterStatus) return false;
      return true;
    });
  }, [records, filterBuilding, filterShift, filterStatus]);

  // --------------------
  // Header form
  // --------------------

  function resetForm() {
    setEditingId(null);
    setError(null);
    setInfo(null);
    setDate(new Date().toISOString().slice(0, 10));

    if ((isLead || isBuildingManager) && userBuilding) setBuilding(userBuilding);
    else setBuilding(BUILDINGS[0]);

    if (isLead && userShift) setShift(userShift);
    else setShift(SHIFTS[0]);
  }

  function startEdit(rec: StartupChecklist) {
    if (!canEditRecord(rec)) return;
    setEditingId(rec.id);
    setBuilding(rec.building);
    setShift(rec.shift);
    setDate(rec.date);
    setError(null);
    setInfo(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (saving) return;

    setError(null);
    setInfo(null);

    if (!date.trim()) {
      setError("Date is required.");
      return;
    }

    const existing = records.find(
      (r) => r.building === building && r.shift === shift && r.date === date && r.id !== editingId
    );
    if (existing) {
      setError("A report already exists for this building, shift, and date.");
      return;
    }

    setSaving(true);

    try {
      if (editingId) {
        // Only Super Admin / Building Manager can edit header details
        if (!(isSuperAdmin || isBuildingManager)) {
          setInfo("Header details are locked for your role. Edit inside the report sections below.");
          return;
        }

        const { error: updateError } = await supabase
          .from("startup_checklists")
          .update({ building, shift, date })
          .eq("id", editingId);

        if (updateError) {
          console.error(updateError);
          setError("Failed to update report.");
          return;
        }

        await refreshFromSupabase();
        setInfo("Report updated.");
      } else {
        const base = defaultItems();
        base._meta = {
          createdByUserId: userId,
          createdByName: userName,
          createdByRole: role,
          updatedByUserId: userId,
          updatedByName: userName,
          updatedByRole: role,
          updatedAtISO: isoNow(),
        };

        const finalBuilding = lockBuildingOnCreate() ? userBuilding : building;
        const finalShift = lockShiftOnCreate() ? userShift : shift;

        const payload = {
          building: finalBuilding || BUILDINGS[0],
          shift: finalShift || SHIFTS[0],
          date,
          items: base,
          completed_at: null,
        };

        const { error: insertError } = await supabase.from("startup_checklists").insert(payload);
        if (insertError) {
          console.error(insertError);
          setError("Failed to create report.");
          return;
        }

        await refreshFromSupabase();
        setInfo("Report created. Complete required sections before shift start.");
      }
    } catch (e) {
      console.error(e);
      setError("Unexpected error saving report.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(rec: StartupChecklist) {
    if (!canDeleteRecord()) {
      setError("You do not have permission to delete reports.");
      return;
    }

    const ok = typeof window !== "undefined" ? window.confirm("Delete this report? This cannot be undone.") : false;
    if (!ok) return;

    setSaving(true);
    setError(null);
    setInfo(null);

    try {
      const { error: deleteError } = await supabase.from("startup_checklists").delete().eq("id", rec.id);
      if (deleteError) {
        console.error(deleteError);
        setError("Failed to delete report.");
        return;
      }

      await refreshFromSupabase();
      if (editingId === rec.id) resetForm();
      setInfo("Report deleted.");
    } catch (e) {
      console.error(e);
      setError("Unexpected error deleting report.");
    } finally {
      setSaving(false);
    }
  }

  // --------------------
  // Save items (typed)
  // --------------------

  async function saveItems(rec: StartupChecklist, nextItems: ReadinessItems) {
    if (!canEditRecord(rec)) {
      setError("You do not have permission to edit this report.");
      return;
    }

    setSaving(true);
    setError(null);
    setInfo(null);

    try {
      nextItems._meta = {
        ...(nextItems._meta || {}),
        updatedByUserId: userId,
        updatedByName: userName,
        updatedByRole: role,
        updatedAtISO: isoNow(),
      };

      const completedISO = safeString(nextItems.confirmation?.completedAtISO).trim();
      const legacyCompletedAt = completedISO ? completedISO : null;

      const { error: itemError } = await supabase
        .from("startup_checklists")
        .update({ items: nextItems, completed_at: legacyCompletedAt })
        .eq("id", rec.id);

      if (itemError) {
        console.error(itemError);
        setError("Failed to update report.");
        return;
      }

      await refreshFromSupabase();
    } catch (e) {
      console.error(e);
      setError("Unexpected error updating report.");
    } finally {
      setSaving(false);
    }
  }

  function patchSection<K extends keyof ReadinessItems>(
    rec: StartupChecklist,
    section: K,
    patch: Partial<NonNullable<ReadinessItems[K]>>
  ) {
    const merged = mergeItems(rec.items);
    const next: ReadinessItems = { ...merged };

    const currentSection = (next[section] ?? {}) as NonNullable<ReadinessItems[K]>;
    next[section] = { ...currentSection, ...patch } as ReadinessItems[K];

    void saveItems(rec, next);
  }

  function toggleSectionField<K extends keyof ReadinessItems>(
    rec: StartupChecklist,
    section: K,
    field: keyof NonNullable<ReadinessItems[K]>
  ) {
    const merged = mergeItems(rec.items);
    const sec = (merged[section] ?? {}) as Record<string, unknown>;
    const current = safeBool(sec[String(field)]);
    patchSection(rec, section, { [field]: !current } as Partial<NonNullable<ReadinessItems[K]>>);
  }

  function markShiftStarted(rec: StartupChecklist) {
    const merged = mergeItems(rec.items);
    const started = safeString(merged.confirmation?.shiftStartedAtISO).trim();

    patchSection(rec, "confirmation", {
      shiftStartedAtISO: started || isoNow(),
    });
    setInfo("Shift start time recorded.");
  }

  function markCompleted(rec: StartupChecklist) {
    const { status } = computeStatus(rec);
    if (status !== "Ready" && status !== "Completed") {
      setError("This report must be Ready (all required items complete) before it can be closed.");
      return;
    }

    const merged = mergeItems(rec.items);
    const completed = safeString(merged.confirmation?.completedAtISO).trim();

    patchSection(rec, "confirmation", {
      completedAtISO: completed || isoNow(),
    });
    setInfo("Report closed (Completed).");
  }

  // --------------------
  // Route protection
  // --------------------

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

  // --------------------
  // Render
  // --------------------

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-50">
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">Shift Readiness Reports</h1>
            <p className="text-sm text-slate-400">
              Confirm staffing, safety, equipment, dock readiness, goals, and communication — with accountability.
            </p>
          </div>
          <Link
            href="/"
            className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          <StatCard label="Total" value={summary.total} valueClass="text-sky-300" />
          <StatCard label="Draft" value={summary.draft} valueClass="text-slate-100" />
          <StatCard label="In Progress" value={summary.inProgress} valueClass="text-amber-300" />
          <StatCard label="Ready" value={summary.ready} valueClass="text-sky-200" />
          <StatCard label="Completed" value={summary.completed} valueClass="text-emerald-300" />
          <StatCard label="Today Ready/Done" value={summary.todayReady} valueClass="text-emerald-200" />
        </div>

        {/* Error / info */}
        {error && (
          <div className="text-xs text-red-300 bg-red-950/40 border border-red-800 rounded px-3 py-2">{error}</div>
        )}
        {info && (
          <div className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-800 rounded px-3 py-2">
            {info}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Create / Edit Header */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-100">
                {editingId ? "Edit Report Header" : "Create Shift Readiness Report"}
              </h2>
              {editingId && (
                <button type="button" onClick={resetForm} className="text-[11px] text-sky-300 hover:underline">
                  Clear / New
                </button>
              )}
            </div>

            <form onSubmit={handleSave} className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Building</label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
                    value={building}
                    onChange={(e) => setBuilding(e.target.value)}
                    disabled={lockBuildingOnCreate() || (!!editingId && !(isSuperAdmin || isBuildingManager))}
                  >
                    {BUILDINGS.map((b) => {
                      if ((isLead || isBuildingManager) && userBuilding && b !== userBuilding) return null;
                      return (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-300 mb-1">Shift</label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
                    value={shift}
                    onChange={(e) => setShift(e.target.value)}
                    disabled={lockShiftOnCreate() || (!!editingId && !(isSuperAdmin || isBuildingManager))}
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
                <label className="block text-xs text-slate-300 mb-1">Date</label>
                <input
                  type="date"
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  disabled={!!editingId && !(isSuperAdmin || isBuildingManager)}
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="mt-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-sm font-medium text-white px-4 py-2"
              >
                {saving ? (editingId ? "Saving…" : "Creating…") : editingId ? "Save Header Changes" : "Create Report"}
              </button>

              {loading && <div className="text-[11px] text-slate-500 mt-2">Loading reports…</div>}
            </form>
          </div>

          {/* List */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 lg:col-span-2">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-100">Report History</h2>

              <div className="flex flex-wrap gap-2 text-xs">
                <select
                  className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-slate-50"
                  value={filterBuilding}
                  onChange={(e) => setFilterBuilding(e.target.value)}
                  disabled={(isLead || isBuildingManager) && !!userBuilding}
                >
                  {!(isLead || isBuildingManager) && <option value="ALL">All Buildings</option>}
                  {BUILDINGS.map((b) => {
                    if ((isLead || isBuildingManager) && userBuilding && b !== userBuilding) return null;
                    return (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    );
                  })}
                </select>

                <select
                  className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-slate-50"
                  value={filterShift}
                  onChange={(e) => setFilterShift(e.target.value)}
                  disabled={isLead && !!userShift}
                >
                  {!isLead && <option value="ALL">All Shifts</option>}
                  {SHIFTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>

                <select
                  className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-slate-50"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as ReportStatus | "ALL")}
                >
                  <option value="ALL">All Status</option>
                  <option value="Draft">Draft</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Ready">Ready</option>
                  <option value="Completed">Completed</option>
                </select>

                <button
                  type="button"
                  onClick={() => {
                    setFilterStatus("ALL");
                    setFilterShift(isLead && userShift ? userShift : "ALL");
                    setFilterBuilding((isLead || isBuildingManager) && userBuilding ? userBuilding : "ALL");
                  }}
                  className="text-[11px] text-sky-300 hover:underline"
                >
                  Reset
                </button>
              </div>
            </div>

            {filteredRecords.length === 0 ? (
              <p className="text-sm text-slate-500">No reports match the current filters.</p>
            ) : (
              <div className="space-y-3 text-xs max-h-[680px] overflow-auto pr-1">
                {filteredRecords.map((r) => {
                  const { status, percent, done, total } = computeStatus(r);
                  const meta = r.items._meta || {};
                  const createdBy = safeString(meta.createdByName) || "Unknown";
                  const updatedBy = safeString(meta.updatedByName);
                  const updatedAt = safeString(meta.updatedAtISO);

                  return (
                    <div key={r.id} className="border border-slate-800 rounded-xl bg-slate-950 p-3 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-slate-100 text-sm font-semibold">
                            {r.building} • {r.shift} Shift • {r.date}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Entered by: <span className="text-slate-200">{createdBy}</span>
                            {updatedBy && updatedAt ? (
                              <>
                                {" "}
                                • Updated: <span className="text-slate-200">{updatedBy}</span> ({formatISODate(updatedAt)})
                              </>
                            ) : null}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Created: {formatISODate(r.createdAt)}
                            {r.completedAt ? ` • Legacy Completed: ${formatISODate(r.completedAt)}` : ""}
                          </div>
                        </div>

                        <div className="text-right space-y-1">
                          <span className={pillClass(status)}>{status}</span>

                          <div className="text-[11px] text-slate-400">
                            Readiness: {done}/{total} ({percent}%)
                          </div>
                          <div className="w-32 h-1.5 rounded-full bg-slate-800 overflow-hidden ml-auto">
                            <div className="h-full bg-sky-500" style={{ width: `${percent}%` }} />
                          </div>

                          <div className="flex items-center justify-end gap-2 pt-1">
                            {canEditRecord(r) && (
                              <button
                                type="button"
                                onClick={() => startEdit(r)}
                                className="text-[11px] text-sky-300 hover:underline"
                              >
                                Edit Header
                              </button>
                            )}
                            {canDeleteRecord() && (
                              <button
                                type="button"
                                onClick={() => handleDelete(r)}
                                className="text-[11px] text-rose-300 hover:underline"
                                disabled={saving}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Required toggles */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2 border-t border-slate-800">
                        <ChecklistToggle
                          label="All workers arrived / attendance verified"
                          checked={safeBool(r.items.staffing?.allArrived)}
                          disabled={!canEditRecord(r) || saving}
                          onToggle={() => toggleSectionField(r, "staffing", "allArrived")}
                        />
                        <ChecklistToggle
                          label="Staffing adequate for today’s volume"
                          checked={safeBool(r.items.staffing?.staffingAdequate)}
                          disabled={!canEditRecord(r) || saving}
                          onToggle={() => toggleSectionField(r, "staffing", "staffingAdequate")}
                        />
                        <ChecklistToggle
                          label="Safety talk completed"
                          checked={safeBool(r.items.safety?.safetyTalkCompleted)}
                          disabled={!canEditRecord(r) || saving}
                          onToggle={() => toggleSectionField(r, "safety", "safetyTalkCompleted")}
                        />
                        <ChecklistToggle
                          label="Stretching completed"
                          checked={safeBool(r.items.safety?.stretchingCompleted)}
                          disabled={!canEditRecord(r) || saving}
                          onToggle={() => toggleSectionField(r, "safety", "stretchingCompleted")}
                        />
                        <ChecklistToggle
                          label="PPE check completed"
                          checked={safeBool(r.items.safety?.ppeCheckCompleted)}
                          disabled={!canEditRecord(r) || saving}
                          onToggle={() => toggleSectionField(r, "safety", "ppeCheckCompleted")}
                        />
                        <ChecklistToggle
                          label="Dock/aisles clear"
                          checked={safeBool(r.items.facility?.dockAislesClear)}
                          disabled={!canEditRecord(r) || saving}
                          onToggle={() => toggleSectionField(r, "facility", "dockAislesClear")}
                        />
                        <ChecklistToggle
                          label="Equipment checked"
                          checked={safeBool(r.items.equipment?.equipmentChecked)}
                          disabled={!canEditRecord(r) || saving}
                          onToggle={() => toggleSectionField(r, "equipment", "equipmentChecked")}
                        />
                        <ChecklistToggle
                          label="Goals reviewed"
                          checked={safeBool(r.items.plan?.goalsReviewed)}
                          disabled={!canEditRecord(r) || saving}
                          onToggle={() => toggleSectionField(r, "plan", "goalsReviewed")}
                        />
                        <ChecklistToggle
                          label="WhatsApp broadcast sent"
                          checked={safeBool(r.items.communication?.whatsappBroadcastSent)}
                          disabled={!canEditRecord(r) || saving}
                          onToggle={() => toggleSectionField(r, "communication", "whatsappBroadcastSent")}
                        />
                        <ChecklistToggle
                          label="Ready to start (final confirmation)"
                          checked={safeBool(r.items.confirmation?.readyToStart)}
                          disabled={!canEditRecord(r) || saving}
                          onToggle={() => toggleSectionField(r, "confirmation", "readyToStart")}
                        />
                      </div>

                      {/* Notes */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                        <TextAreaField
                          label="Late / No-show details"
                          value={safeString(r.items.staffing?.lateOrNoShowDetails)}
                          disabled={!canEditRecord(r) || saving}
                          onChange={(v) => patchSection(r, "staffing", { lateOrNoShowDetails: v })}
                        />
                        <TextAreaField
                          label="Daily focus message"
                          value={safeString(r.items.communication?.dailyFocusMessage)}
                          disabled={!canEditRecord(r) || saving}
                          onChange={(v) => patchSection(r, "communication", { dailyFocusMessage: v })}
                        />
                      </div>

                      {/* Closeout actions */}
                      <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800">
                        <button
                          type="button"
                          onClick={() => markShiftStarted(r)}
                          disabled={!canEditRecord(r) || saving}
                          className="text-[12px] px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:bg-slate-800 disabled:opacity-60"
                        >
                          Record Shift Start
                        </button>
                        <button
                          type="button"
                          onClick={() => markCompleted(r)}
                          disabled={!canEditRecord(r) || saving}
                          className="text-[12px] px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-white"
                        >
                          Close Report (Completed)
                        </button>
                      </div>

                      <div className="text-[11px] text-slate-400">
                        Shift Started:{" "}
                        <span className="text-slate-200">{formatISODate(r.items.confirmation?.shiftStartedAtISO)}</span>{" "}
                        • Closed: <span className="text-slate-200">{formatISODate(r.items.confirmation?.completedAtISO)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --------------------
// UI pieces
// --------------------

function StatCard({ label, value, valueClass }: { label: string; value: number; valueClass?: string }) {
  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className={`text-2xl font-semibold ${valueClass || "text-slate-100"}`}>{value}</div>
    </div>
  );
}

function ChecklistToggle({
  label,
  checked,
  onToggle,
  disabled,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`flex items-center gap-2 px-2 py-2 rounded-lg border text-[11px] text-left disabled:opacity-60 ${
        checked ? "bg-emerald-900/40 border-emerald-700 text-emerald-100" : "bg-slate-900 border-slate-700 text-slate-200"
      }`}
    >
      <span
        className={`w-3 h-3 rounded border ${
          checked ? "bg-emerald-500 border-emerald-400" : "bg-slate-950 border-slate-600"
        }`}
      />
      <span>{label}</span>
    </button>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] text-slate-300 mb-1">{label}</div>
      <textarea
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-[12px] text-slate-50 disabled:opacity-60"
        placeholder="Be specific. This becomes your daily record."
      />
    </div>
  );
}

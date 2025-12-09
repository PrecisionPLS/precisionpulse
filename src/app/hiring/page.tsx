"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";

const BUILDINGS = ["DC1", "DC5", "DC11", "DC14", "DC18"];
const ROLES = [
  "Lumper",
  "Lead",
  "Supervisor",
  "Building Manager",
  "Forklift Operator",
  "Clamp Operator",
  "Shuttler",
  "Picker",
  "Sanitation",
  "Other",
];

const STAGES = [
  "Applied",
  "Phone Screen",
  "Interview",
  "Offer",
  "Hired",
  "Rejected",
] as const;

type Stage = (typeof STAGES)[number];

type CandidateRow = {
  id: string;
  created_at: string;
  full_name: string;
  building: string | null;
  role_applied: string | null;
  stage: string | null;
  source: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  is_priority: boolean | null;
  has_experience: boolean | null;
  target_start_date: string | null; // date
  last_moved_at: string | null;
};

type Candidate = {
  id: string;
  createdAt: string;
  fullName: string;
  building: string;
  roleApplied: string;
  stage: Stage;
  source?: string;
  phone?: string;
  email?: string;
  notes?: string;
  isPriority: boolean;
  hasExperience: boolean;
  targetStartDate?: string;
  lastMovedAt?: string;
};

function rowToCandidate(row: CandidateRow): Candidate {
  const stageRaw = (row.stage ?? "Applied") as Stage;
  return {
    id: row.id,
    createdAt: row.created_at ?? new Date().toISOString(),
    fullName: row.full_name,
    building: row.building ?? "DC18",
    roleApplied: row.role_applied ?? "Lumper",
    stage: STAGES.includes(stageRaw) ? stageRaw : "Applied",
    source: row.source ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    notes: row.notes ?? undefined,
    isPriority: row.is_priority ?? false,
    hasExperience: row.has_experience ?? false,
    targetStartDate: row.target_start_date ?? undefined,
    lastMovedAt: row.last_moved_at ?? undefined,
  };
}

export default function HiringPage() {
  const currentUser = useCurrentUser();

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [building, setBuilding] = useState("DC18");
  const [roleApplied, setRoleApplied] = useState("Lumper");
  const [stage, setStage] = useState<Stage>("Applied");
  const [source, setSource] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [isPriority, setIsPriority] = useState(false);
  const [hasExperience, setHasExperience] = useState(false);
  const [targetStartDate, setTargetStartDate] = useState("");

  // Filters
  const [filterBuilding, setFilterBuilding] = useState<string>("ALL");
  const [filterStage, setFilterStage] = useState<Stage | "ALL">("ALL");
  const [showPriorityOnly, setShowPriorityOnly] = useState(false);
  const [search, setSearch] = useState("");

  function resetForm() {
    setEditingId(null);
    setFullName("");
    setBuilding("DC18");
    setRoleApplied("Lumper");
    setStage("Applied");
    setSource("");
    setPhone("");
    setEmail("");
    setNotes("");
    setIsPriority(false);
    setHasExperience(false);
    setTargetStartDate("");
  }

  async function loadCandidates() {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const { data, error } = await supabase
        .from("hiring_candidates")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error loading candidates", error);
        setError("Failed to load hiring pipeline from server.");
        return;
      }

      const rows = (data || []) as CandidateRow[];
      setCandidates(rows.map(rowToCandidate));
    } catch (e) {
      console.error("Unexpected error loading candidates", e);
      setError("Unexpected error loading hiring pipeline.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!currentUser) return;
    loadCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!fullName.trim()) {
      setError("Candidate name is required.");
      return;
    }

    const nowIso = new Date().toISOString();

    try {
      if (editingId) {
        const { error } = await supabase
          .from("hiring_candidates")
          .update({
            full_name: fullName.trim(),
            building,
            role_applied: roleApplied,
            stage,
            source: source.trim() || null,
            phone: phone.trim() || null,
            email: email.trim() || null,
            notes: notes.trim() || null,
            is_priority: isPriority,
            has_experience: hasExperience,
            target_start_date: targetStartDate || null,
            last_moved_at: nowIso,
          })
          .eq("id", editingId);

        if (error) {
          console.error("Error updating candidate", error);
          setError("Failed to update candidate.");
          return;
        }

        setInfo("Candidate updated.");
      } else {
        const { error } = await supabase
          .from("hiring_candidates")
          .insert({
            full_name: fullName.trim(),
            building,
            role_applied: roleApplied,
            stage,
            source: source.trim() || null,
            phone: phone.trim() || null,
            email: email.trim() || null,
            notes: notes.trim() || null,
            is_priority: isPriority,
            has_experience: hasExperience,
            target_start_date: targetStartDate || null,
            last_moved_at: nowIso,
          });

        if (error) {
          console.error("Error inserting candidate", error);
          setError("Failed to create candidate.");
          return;
        }

        setInfo("Candidate added to pipeline.");
      }

      resetForm();
      await loadCandidates();
    } catch (e) {
      console.error("Unexpected error saving candidate", e);
      setError("Unexpected error saving candidate.");
    }
  }

  async function handleDelete(id: string) {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "Delete this candidate from the pipeline? This cannot be undone."
      );
      if (!ok) return;
    }

    try {
      const { error } = await supabase
        .from("hiring_candidates")
        .delete()
        .eq("id", id);

      if (error) {
        console.error("Error deleting candidate", error);
        setError("Failed to delete candidate.");
        return;
      }

      setInfo("Candidate deleted.");
      if (editingId === id) resetForm();
      await loadCandidates();
    } catch (e) {
      console.error("Unexpected error deleting candidate", e);
      setError("Unexpected error deleting candidate.");
    }
  }

  async function moveStage(id: string, newStage: Stage) {
    setError(null);
    setInfo(null);
    const nowIso = new Date().toISOString();

    try {
      const { error } = await supabase
        .from("hiring_candidates")
        .update({
          stage: newStage,
          last_moved_at: nowIso,
        })
        .eq("id", id);

      if (error) {
        console.error("Error moving candidate stage", error);
        setError("Failed to move candidate to new stage.");
        return;
      }

      await loadCandidates();
    } catch (e) {
      console.error("Unexpected error moving candidate stage", e);
      setError("Unexpected error moving candidate stage.");
    }
  }

  const filteredCandidates = useMemo(() => {
    let rows = [...candidates];

    if (filterBuilding !== "ALL") {
      rows = rows.filter((c) => c.building === filterBuilding);
    }
    if (filterStage !== "ALL") {
      rows = rows.filter((c) => c.stage === filterStage);
    }
    if (showPriorityOnly) {
      rows = rows.filter((c) => c.isPriority);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (c) =>
          c.fullName.toLowerCase().includes(q) ||
          c.roleApplied.toLowerCase().includes(q) ||
          (c.source || "").toLowerCase().includes(q)
      );
    }

    return rows;
  }, [candidates, filterBuilding, filterStage, showPriorityOnly, search]);

  const byStage: Record<Stage, Candidate[]> = useMemo(() => {
    const map: Record<Stage, Candidate[]> = {
      Applied: [],
      "Phone Screen": [],
      Interview: [],
      Offer: [],
      Hired: [],
      Rejected: [],
    };
    for (const c of filteredCandidates) {
      const s: Stage = STAGES.includes(c.stage) ? c.stage : "Applied";
      map[s].push(c);
    }
    return map;
  }, [filteredCandidates]);

  const summary = useMemo(() => {
    const total = candidates.length;
    const hired = candidates.filter((c) => c.stage === "Hired").length;
    const rejected = candidates.filter(
      (c) => c.stage === "Rejected"
    ).length;
    const priority = candidates.filter((c) => c.isPriority).length;
    const experienced = candidates.filter(
      (c) => c.hasExperience
    ).length;

    return { total, hired, rejected, priority, experienced };
  }, [candidates]);

  // Route protection after hooks
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
      <div className="mx-auto max-w-7xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">
              Hiring Pipeline
            </h1>
            <p className="text-sm text-slate-400">
              Track candidates from applied through hired, with building and
              role visibility for Precision&apos;s 3PL operations.
            </p>
          </div>
          <Link
            href="/"
            className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {/* Summary row */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 text-xs">
          <SummaryCard label="Total Candidates" value={summary.total} />
          <SummaryCard label="Hired" value={summary.hired} accent="emerald" />
          <SummaryCard
            label="Rejected"
            value={summary.rejected}
            accent="rose"
          />
          <SummaryCard
            label="Priority Candidates"
            value={summary.priority}
            accent="amber"
          />
          <SummaryCard
            label="With Experience"
            value={summary.experienced}
            accent="sky"
          />
        </div>

        {/* Error/info + loading */}
        {error && (
          <div className="text-xs text-red-300 bg-red-950/40 border border-red-800 rounded px-3 py-2">
            {error}
          </div>
        )}
        {info && (
          <div className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-800 rounded px-3 py-2">
            {info}
          </div>
        )}
        {loading && (
          <div className="text-xs text-slate-400">
            Loading candidates…
          </div>
        )}

        {/* Form + filters + Kanban */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-xs space-y-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-slate-200 text-sm font-semibold">
                {editingId ? "Edit Candidate" : "Add Candidate"}
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
                  Full Name
                </label>
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                  placeholder="Example: John Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
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
                    Role Applied
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={roleApplied}
                    onChange={(e) => setRoleApplied(e.target.value)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Stage
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={stage}
                    onChange={(e) =>
                      setStage(e.target.value as Stage)
                    }
                  >
                    {STAGES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Source (optional)
                  </label>
                  <input
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    placeholder="Referral, Indeed, internal..."
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Phone (optional)
                  </label>
                  <input
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Email (optional)
                  </label>
                  <input
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Target Start Date (optional)
                </label>
                <input
                  type="date"
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                  value={targetStartDate}
                  onChange={(e) => setTargetStartDate(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="inline-flex items-center gap-2 text-[11px] text-slate-400">
                  <input
                    type="checkbox"
                    className="rounded border-slate-600 bg-slate-950"
                    checked={isPriority}
                    onChange={(e) =>
                      setIsPriority(e.target.checked)
                    }
                  />
                  Priority candidate
                </label>
                <label className="inline-flex items-center gap-2 text-[11px] text-slate-400">
                  <input
                    type="checkbox"
                    className="rounded border-slate-600 bg-slate-950"
                    checked={hasExperience}
                    onChange={(e) =>
                      setHasExperience(e.target.checked)
                    }
                  />
                  Has relevant experience
                </label>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Notes (optional)
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50 resize-none"
                  placeholder="Interview notes, shift preference, etc."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="mt-1 w-full rounded-lg bg-sky-600 hover:bg-sky-500 text-[11px] font-medium text-white px-4 py-2"
              >
                {editingId ? "Save Changes" : "Add Candidate"}
              </button>
            </form>
          </div>

          {/* Filters + Kanban */}
          <div className="lg:col-span-2 space-y-4">
            {/* Filters */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-slate-200 text-sm font-semibold">
                    Filters
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Narrow by building, stage, priority, or search text.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFilterBuilding("ALL");
                    setFilterStage("ALL");
                    setShowPriorityOnly(false);
                    setSearch("");
                  }}
                  className="text-[11px] text-sky-300 hover:underline"
                >
                  Reset
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Building
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={filterBuilding}
                    onChange={(e) =>
                      setFilterBuilding(e.target.value)
                    }
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
                    Stage
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={filterStage}
                    onChange={(e) =>
                      setFilterStage(e.target.value as Stage | "ALL")
                    }
                  >
                    <option value="ALL">All Stages</option>
                    {STAGES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="inline-flex items-center gap-2 text-[11px] text-slate-400 mb-1">
                    <input
                      type="checkbox"
                      className="rounded border-slate-600 bg-slate-950"
                      checked={showPriorityOnly}
                      onChange={(e) =>
                        setShowPriorityOnly(e.target.checked)
                      }
                    />
                    Priority only
                  </label>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Search
                  </label>
                  <input
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    placeholder="Name, role, source..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Kanban-style columns */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
              <div className="flex items-center justify-between mb-2">
                <div className="text-slate-200 text-sm font-semibold">
                  Pipeline (Kanban)
                </div>
                <div className="text-[11px] text-slate-500">
                  Drag & drop is not wired yet, but use the stage buttons
                  to move candidates.
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
                {STAGES.map((s) => {
                  const list = byStage[s];
                  return (
                    <div
                      key={s}
                      className="rounded-xl bg-slate-950 border border-slate-800 p-3 flex flex-col gap-2 max-h-[420px] overflow-auto"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-[11px] font-semibold text-slate-200">
                          {s}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {list.length}
                        </div>
                      </div>
                      {list.length === 0 ? (
                        <div className="text-[11px] text-slate-500">
                          No candidates in this stage.
                        </div>
                      ) : (
                        list.map((c) => (
                          <CandidateCard
                            key={c.id}
                            c={c}
                            onEdit={() => handleEdit(c)}
                            onDelete={() => handleDelete(c.id)}
                            onMoveStage={moveStage}
                          />
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "emerald" | "rose" | "amber" | "sky";
}) {
  const color =
    accent === "emerald"
      ? "text-emerald-300"
      : accent === "rose"
      ? "text-rose-300"
      : accent === "amber"
      ? "text-amber-300"
      : accent === "sky"
      ? "text-sky-300"
      : "text-sky-300";

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function CandidateCard({
  c,
  onEdit,
  onDelete,
  onMoveStage,
}: {
  c: Candidate;
  onEdit: () => void;
  onDelete: () => void;
  onMoveStage: (id: string, newStage: Stage) => void;
}) {
  const isTerminal = c.stage === "Hired" || c.stage === "Rejected";

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold text-slate-100 line-clamp-1">
          {c.fullName}
        </div>
        {c.isPriority && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-900/70 text-amber-200 border border-amber-700/70">
            Priority
          </span>
        )}
      </div>
      <div className="text-[10px] text-slate-400">
        {c.roleApplied} • {c.building}
      </div>
      {c.source && (
        <div className="text-[10px] text-slate-500">
          Source: {c.source}
        </div>
      )}
      {c.targetStartDate && (
        <div className="text-[10px] text-slate-500">
          Target Start: {c.targetStartDate}
        </div>
      )}
      {c.notes && (
        <div className="text-[10px] text-slate-500 line-clamp-2">
          {c.notes}
        </div>
      )}

      <div className="flex items-center justify-between mt-1">
        <div className="inline-flex gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="text-[10px] text-sky-300 hover:underline"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="text-[10px] text-rose-300 hover:underline"
          >
            Delete
          </button>
        </div>
        {!isTerminal && (
          <select
            className="text-[10px] rounded bg-slate-950 border border-slate-700 px-1.5 py-0.5 text-slate-200"
            value={c.stage}
            onChange={(e) =>
              onMoveStage(c.id, e.target.value as Stage)
            }
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

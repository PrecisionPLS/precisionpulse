"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const CANDIDATE_STORAGE_KEY = "precisionpulse_candidates";
const BUILDINGS = ["DC1", "DC5", "DC11", "DC14", "DC18"];

type Stage =
  | "New"
  | "Phone Screen"
  | "On-Site"
  | "Offer"
  | "Hired"
  | "Rejected";

type Candidate = {
  id: string;
  name: string;
  position: string;
  building: string;
  source: string;
  notes: string;
  stage: Stage;
  createdAt: string;
  lastUpdated: string;
  followUpDate?: string; // YYYY-MM-DD
};

const STAGE_ORDER: Stage[] = [
  "New",
  "Phone Screen",
  "On-Site",
  "Offer",
  "Hired",
  "Rejected",
];

export default function HiringPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  // Form state
  const [name, setName] = useState("");
  const [position, setPosition] = useState("Lumper");
  const [building, setBuilding] = useState(BUILDINGS[0]);
  const [source, setSource] = useState("Referral");
  const [notes, setNotes] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(CANDIDATE_STORAGE_KEY);
      if (raw) {
        setCandidates(JSON.parse(raw));
      }
    } catch (e) {
      console.error("Failed to load candidates", e);
    }
  }, []);

  // helper to save candidates
  function saveCandidates(next: Candidate[]) {
    setCandidates(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        CANDIDATE_STORAGE_KEY,
        JSON.stringify(next)
      );
    }
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!name.trim()) {
      setError("Candidate name is required.");
      return;
    }

    const now = new Date().toISOString();

    const newCandidate: Candidate = {
      id: `${Date.now()}`,
      name: name.trim(),
      position: position.trim() || "Lumper",
      building,
      source: source.trim() || "Unknown",
      notes: notes.trim(),
      stage: "New",
      createdAt: now,
      lastUpdated: now,
      followUpDate: followUpDate || undefined,
    };

    const next = [newCandidate, ...candidates];
    saveCandidates(next);
    setInfo("Candidate added to pipeline in stage 'New'.");

    setName("");
    setPosition("Lumper");
    setSource("Referral");
    setNotes("");
    setFollowUpDate("");
  }

  function updateStage(id: string, newStage: Stage) {
    const now = new Date().toISOString();
    const next = candidates.map((c) =>
      c.id === id ? { ...c, stage: newStage, lastUpdated: now } : c
    );
    saveCandidates(next);
  }

  function isOverdue(c: Candidate): boolean {
    if (!c.followUpDate) return false;
    const today = new Date();
    const follow = new Date(c.followUpDate + "T00:00:00");
    // Overdue if follow-up date is before today and candidate not resolved
    if (follow < new Date(today.toDateString())) {
      return c.stage !== "Hired" && c.stage !== "Rejected";
    }
    return false;
  }

  const grouped = useMemo(() => {
    const map: Record<Stage, Candidate[]> = {
      New: [],
      "Phone Screen": [],
      "On-Site": [],
      Offer: [],
      Hired: [],
      Rejected: [],
    };
    for (const c of candidates) {
      map[c.stage].push(c);
    }
    return map;
  }, [candidates]);

  const totals = useMemo(() => {
    return {
      total: candidates.length,
      byBuilding: BUILDINGS.reduce<Record<string, number>>(
        (acc, b) => ({
          ...acc,
          [b]: candidates.filter((c) => c.building === b).length,
        }),
        {}
      ),
    };
  }, [candidates]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">
            Hiring Pipeline
          </h1>
          <p className="text-sm text-slate-400">
            Track candidates from first contact through offer and hire, by
            building and role. Overdue follow-ups are highlighted.
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
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <div className="text-xs text-slate-400 mb-1">
            Total Candidates
          </div>
          <div className="text-2xl font-semibold text-sky-300">
            {totals.total}
          </div>
        </div>
        {BUILDINGS.map((b) => (
          <div
            key={b}
            className="rounded-2xl bg-slate-900 border border-slate-800 p-4"
          >
            <div className="text-xs text-slate-400 mb-1">{b}</div>
            <div className="text-2xl font-semibold text-emerald-300">
              {totals.byBuilding[b] || 0}
            </div>
          </div>
        )).slice(0, 3)}
      </div>

      {/* Create candidate */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-100">
          Add Candidate
        </h2>
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

        <form
          onSubmit={handleCreate}
          className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm"
        >
          <div>
            <label className="block text-xs text-slate-300 mb-1">
              Candidate Name
            </label>
            <input
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. John Doe"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-300 mb-1">
              Position / Role
            </label>
            <input
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="e.g. Lumper, Forklift, Lead"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-300 mb-1">
              Building
            </label>
            <select
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
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
            <label className="block text-xs text-slate-300 mb-1">
              Source
            </label>
            <input
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="e.g. Referral, Indeed, Walk-in"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-300 mb-1">
              Follow-Up Date (optional)
            </label>
            <input
              type="date"
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-50"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-300 mb-1">
              Notes
            </label>
            <textarea
              className="w-full h-[38px] rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-50"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Quick notes on availability, experience, etc."
            />
          </div>

          <div className="md:col-span-3 flex justify-end">
            <button
              type="submit"
              className="rounded-lg bg-sky-600 hover:bg-sky-500 text-sm font-medium text-white px-4 py-2"
            >
              Add to Pipeline
            </button>
          </div>
        </form>
      </div>

      {/* Kanban board */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 md:p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-100">
            Pipeline Board
          </h2>
          <div className="text-xs text-slate-500">
            Click the stage dropdown on a card to move candidates.
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
          {STAGE_ORDER.map((stage) => {
            const stageCandidates = grouped[stage];
            return (
              <div
                key={stage}
                className="bg-slate-950 border border-slate-800 rounded-xl p-2 flex flex-col max-h-[420px]"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-slate-100 text-xs">
                    {stage}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {stageCandidates.length}
                  </div>
                </div>
                <div className="space-y-2 overflow-auto pr-1">
                  {stageCandidates.length === 0 ? (
                    <div className="text-[11px] text-slate-600">
                      No candidates
                    </div>
                  ) : (
                    stageCandidates.map((c) => {
                      const overdue = isOverdue(c);
                      return (
                        <div
                          key={c.id}
                          className="border border-slate-800 rounded-lg px-2 py-2 bg-slate-900 space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-[11px] font-semibold text-slate-100">
                              {c.name}
                            </div>
                            {overdue && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-900/60 text-red-200 border border-red-700">
                                Overdue
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {c.position} • {c.building}
                          </div>
                          {c.source && (
                            <div className="text-[10px] text-slate-500">
                              Source: {c.source}
                            </div>
                          )}
                          {c.followUpDate && (
                            <div className="text-[10px] text-slate-500">
                              Follow-up: {c.followUpDate}
                            </div>
                          )}
                          {c.notes && (
                            <div className="text-[10px] text-slate-400 mt-1 line-clamp-2">
                              {c.notes}
                            </div>
                          )}
                          <div className="mt-2">
                            <label className="block text-[10px] text-slate-500 mb-0.5">
                              Stage
                            </label>
                            <select
                              className="w-full rounded bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-50"
                              value={c.stage}
                              onChange={(e) =>
                                updateStage(
                                  c.id,
                                  e.target.value as Stage
                                )
                              }
                            >
                              {STAGE_ORDER.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

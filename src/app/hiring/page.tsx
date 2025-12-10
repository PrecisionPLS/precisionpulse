"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { BUILDINGS } from "@/lib/buildings"; // ✅ shared buildings

const STAGES = [
  "Applied",
  "Phone Screen",
  "Onsite Interview",
  "Offer",
  "Hired",
  "Rejected",
] as const;

type CandidateStage = (typeof STAGES)[number];

type CandidateRow = {
  id: string;
  name: string;
  phone?: string | null;
  building?: string | null;
  stage?: CandidateStage | null;
  source?: string | null;
  notes?: string | null;
  created_at?: string | null;
};

export default function HiringPage() {
  const currentUser = useCurrentUser();

  const isLead = currentUser?.accessRole === "Lead";
  const leadBuilding = currentUser?.building || "";

  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [building, setBuilding] = useState<string>(
    leadBuilding || BUILDINGS[0] || "DC18"
  );
  const [stage, setStage] = useState<CandidateStage>("Applied");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");

  // filters
  const [filterBuilding, setFilterBuilding] = useState<string>("ALL");
  const [filterStage, setFilterStage] = useState<string>("ALL");
  const [search, setSearch] = useState("");

  // Load from Supabase once user is known
  useEffect(() => {
    if (!currentUser) return;

    async function refreshFromSupabase() {
      setLoading(true);
      setError(null);
      try {
        let query = supabase
          .from("hiring_pipeline")
          .select("*")
          .order("created_at", { ascending: false });

        // If Lead, only see their building
        if (isLead && leadBuilding) {
          query = query.eq("building", leadBuilding);
        }

        const { data, error } = await query;

        if (error) {
          console.error("Error loading hiring pipeline", error);
          setError("Failed to load hiring pipeline from Supabase.");
          setCandidates([]);
        } else {
          setCandidates((data || []) as CandidateRow[]);
        }
      } catch (e) {
        console.error("Unexpected error loading hiring pipeline", e);
        setError("Unexpected error loading hiring pipeline.");
        setCandidates([]);
      } finally {
        setLoading(false);
      }
    }

    refreshFromSupabase();
  }, [currentUser, isLead, leadBuilding]);

  // Lock building for leads (form + filters)
  useEffect(() => {
    if (isLead && leadBuilding) {
      setBuilding(leadBuilding);
      setFilterBuilding(leadBuilding);
    }
  }, [isLead, leadBuilding]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setPhone("");
    setStage("Applied");
    setSource("");
    setNotes("");
    setBuilding(isLead && leadBuilding ? leadBuilding : BUILDINGS[0] || "DC18");
  }

  function startEdit(c: CandidateRow) {
    setEditingId(c.id);
    setName(c.name || "");
    setPhone(c.phone || "");
    setBuilding(
      c.building || (isLead && leadBuilding ? leadBuilding : BUILDINGS[0] || "DC18")
    );
    setStage((c.stage as CandidateStage) || "Applied");
    setSource(c.source || "");
    setNotes(c.notes || "");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Please enter a candidate name.");
      return;
    }

    const effectiveBuilding = isLead && leadBuilding ? leadBuilding : building;

    try {
      if (editingId) {
        const { error } = await supabase
          .from("hiring_pipeline")
          .update({
            name: name.trim(),
            phone: phone.trim() || null,
            building: effectiveBuilding,
            stage,
            source: source.trim() || null,
            notes: notes.trim() || null,
          })
          .eq("id", editingId);

        if (error) {
          console.error("Error updating candidate", error);
          setError("Failed to update candidate.");
          return;
        }
      } else {
        const { error } = await supabase.from("hiring_pipeline").insert({
          name: name.trim(),
          phone: phone.trim() || null,
          building: effectiveBuilding,
          stage,
          source: source.trim() || null,
          notes: notes.trim() || null,
        });

        if (error) {
          console.error("Error creating candidate", error);
          setError("Failed to create candidate.");
          return;
        }
      }

      resetForm();
      // Reload list
      try {
        let query = supabase
          .from("hiring_pipeline")
          .select("*")
          .order("created_at", { ascending: false });

        if (isLead && leadBuilding) {
          query = query.eq("building", leadBuilding);
        }

        const { data, error } = await query;

        if (error) {
          console.error("Error reloading hiring pipeline", error);
          setError("Failed to reload hiring pipeline after save.");
        } else {
          setCandidates((data || []) as CandidateRow[]);
        }
      } catch (err) {
        console.error("Unexpected error reloading after save", err);
      }
    } catch (e) {
      console.error("Unexpected error saving candidate", e);
      setError("Unexpected error while saving candidate.");
    }
  }

  async function handleDelete(id: string) {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "Delete this candidate from the hiring pipeline?"
      );
      if (!ok) return;
    }

    try {
      const { error } = await supabase
        .from("hiring_pipeline")
        .delete()
        .eq("id", id);

      if (error) {
        console.error("Error deleting candidate", error);
        setError("Failed to delete candidate.");
        return;
      }

      if (editingId === id) {
        resetForm();
      }

      // Reload list
      try {
        let query = supabase
          .from("hiring_pipeline")
          .select("*")
          .order("created_at", { ascending: false });

        if (isLead && leadBuilding) {
          query = query.eq("building", leadBuilding);
        }

        const { data, error } = await query;

        if (error) {
          console.error("Error reloading hiring pipeline", error);
          setError("Failed to reload hiring pipeline after delete.");
        } else {
          setCandidates((data || []) as CandidateRow[]);
        }
      } catch (err) {
        console.error("Unexpected error reloading after delete", err);
      }
    } catch (e) {
      console.error("Unexpected error deleting candidate", e);
      setError("Unexpected error while deleting candidate.");
    }
  }

  async function moveStage(id: string, nextStage: CandidateStage) {
    try {
      const { error } = await supabase
        .from("hiring_pipeline")
        .update({ stage: nextStage })
        .eq("id", id);

      if (error) {
        console.error("Error moving candidate to next stage", error);
        setError("Failed to move candidate.");
        return;
      }

      // Reload list
      try {
        let query = supabase
          .from("hiring_pipeline")
          .select("*")
          .order("created_at", { ascending: false });

        if (isLead && leadBuilding) {
          query = query.eq("building", leadBuilding);
        }

        const { data, error } = await query;

        if (error) {
          console.error("Error reloading hiring pipeline", error);
          setError("Failed to reload hiring pipeline after move.");
        } else {
          setCandidates((data || []) as CandidateRow[]);
        }
      } catch (err) {
        console.error("Unexpected error reloading after move", err);
      }
    } catch (e) {
      console.error("Unexpected error moving candidate", e);
      setError("Unexpected error while moving candidate.");
    }
  }

  const effectiveFilterBuilding =
    isLead && leadBuilding ? leadBuilding : filterBuilding;

  const filteredCandidates = useMemo(() => {
    let rows = [...candidates];

    if (effectiveFilterBuilding !== "ALL") {
      rows = rows.filter(
        (c) => (c.building || "") === effectiveFilterBuilding
      );
    }
    if (filterStage !== "ALL") {
      rows = rows.filter((c) => (c.stage || "Applied") === filterStage);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((c) => {
        const name = c.name?.toLowerCase() || "";
        const phone = c.phone?.toLowerCase() || "";
        const source = c.source?.toLowerCase() || "";
        return name.includes(q) || phone.includes(q) || source.includes(q);
      });
    }

    return rows;
  }, [candidates, effectiveFilterBuilding, filterStage, search]);

  function candidatesInStage(stage: CandidateStage) {
    return filteredCandidates.filter(
      (c) => (c.stage as CandidateStage) === stage
    );
  }

  // Route protection
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
              Track candidates by stage, building, and source. Use this as
              your visual hiring board for Precision.
            </p>
          </div>
          <Link
            href="/"
            className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {/* Error / loading */}
        {error && (
          <div className="text-xs text-red-300 bg-red-950/40 border border-red-800 rounded px-3 py-2">
            {error}
          </div>
        )}
        {loading && (
          <div className="text-xs text-slate-400">
            Loading hiring pipeline…
          </div>
        )}

        {/* Top row: form + filters */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs space-y-3">
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
                  placeholder="Example: Jane Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Phone (optional)
                  </label>
                  <input
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    placeholder="555-123-4567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Building
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={building}
                    onChange={(e) => setBuilding(e.target.value)}
                    disabled={isLead && !!leadBuilding}
                  >
                    {isLead && leadBuilding ? (
                      <option value={leadBuilding}>{leadBuilding}</option>
                    ) : (
                      BUILDINGS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))
                    )}
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
                      setStage(e.target.value as CandidateStage)
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
                    placeholder="Indeed, referral, etc."
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Notes (optional)
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50 resize-none"
                  placeholder="Interview notes, availability, etc."
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

          {/* Filters + board */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-slate-200 text-sm font-semibold">
                    Filters
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Filter by building, stage, or search by name/phone.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!isLead || !leadBuilding) {
                      setFilterBuilding("ALL");
                    }
                    setFilterStage("ALL");
                    setSearch("");
                  }}
                  className="text-[11px] text-sky-300 hover:underline"
                >
                  Reset
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Building
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={effectiveFilterBuilding}
                    onChange={(e) => setFilterBuilding(e.target.value)}
                    disabled={isLead && !!leadBuilding}
                  >
                    {isLead && leadBuilding ? (
                      <option value={leadBuilding}>{leadBuilding}</option>
                    ) : (
                      <>
                        <option value="ALL">All Buildings</option>
                        {BUILDINGS.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Stage
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={filterStage}
                    onChange={(e) => setFilterStage(e.target.value)}
                  >
                    <option value="ALL">All Stages</option>
                    {STAGES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Search
                  </label>
                  <input
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    placeholder="Name, phone, source..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Kanban board by stage */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs">
              <div className="text-slate-200 text-sm font-semibold mb-3">
                Hiring Board
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 max-h-[520px] overflow-auto">
                {STAGES.map((s) => {
                  const list = candidatesInStage(s);
                  return (
                    <div
                      key={s}
                      className="rounded-xl bg-slate-950 border border-slate-800 p-3 flex flex-col"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-[11px] font-semibold text-slate-200">
                          {s}
                        </div>
                        <span className="text-[11px] text-slate-500">
                          {list.length}
                        </span>
                      </div>
                      <div className="space-y-2 overflow-auto">
                        {list.length === 0 ? (
                          <div className="text-[11px] text-slate-500">
                            No candidates.
                          </div>
                        ) : (
                          list.map((c) => (
                            <div
                              key={c.id}
                              className="border border-slate-700 rounded-lg bg-slate-900 p-2 space-y-1"
                            >
                              <div className="text-[11px] text-slate-100 font-medium">
                                {c.name}
                              </div>
                              {c.phone && (
                                <div className="text-[10px] text-slate-400">
                                  {c.phone}
                                </div>
                              )}
                              {c.source && (
                                <div className="text-[10px] text-slate-500">
                                  Source: {c.source}
                                </div>
                              )}
                              {c.building && (
                                <div className="text-[10px] text-slate-500">
                                  {c.building}
                                </div>
                              )}
                              <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-800 mt-1">
                                <button
                                  type="button"
                                  onClick={() => startEdit(c)}
                                  className="text-[10px] text-sky-300 hover:underline"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(c.id)}
                                  className="text-[10px] text-rose-300 hover:underline"
                                >
                                  Delete
                                </button>
                                {STAGES.filter(
                                  (next) => next !== s
                                ).map((next) => (
                                  <button
                                    key={next}
                                    type="button"
                                    onClick={() =>
                                      moveStage(c.id, next)
                                    }
                                    className="text-[9px] text-slate-400 hover:text-emerald-300"
                                  >
                                    → {next}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
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

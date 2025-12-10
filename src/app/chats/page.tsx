"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { BUILDINGS } from "@/lib/buildings";

const CHATS_STORAGE_KEY = "precisionpulse_chats";

const SHIFTS = ["1st", "2nd", "3rd", "4th"];
const CHANNELS = ["General", "Shift Ops", "HR", "Safety", "Other"];

// For filters we want an "ALL" option on top of the shared buildings list
const BUILDING_FILTER_OPTIONS = ["ALL", ...BUILDINGS];

type ChatMessage = {
  id: string;
  building: string;
  shift: string;
  channel: string;
  message: string;
  createdAt: string; // ISO
  authorName?: string;
  authorEmail?: string;
  authorRole?: string;
};

type ChatRow = {
  id: string;
  created_at: string;
  building: string | null;
  shift: string | null;
  channel: string | null;
  message: string | null;
  author_name: string | null;
  author_email: string | null;
  author_role: string | null;
};

function rowToChat(row: ChatRow): ChatMessage {
  return {
    id: String(row.id),
    building: row.building ?? (BUILDINGS[0] ?? "DC18"),
    shift: row.shift ?? "1st",
    channel: row.channel ?? "General",
    message: row.message ?? "",
    createdAt: row.created_at ?? new Date().toISOString(),
    authorName: row.author_name ?? undefined,
    authorEmail: row.author_email ?? undefined,
    authorRole: row.author_role ?? undefined,
  };
}

export default function ChatsPage() {
  const currentUser = useCurrentUser();
  const isSuperAdmin = currentUser?.accessRole === "Super Admin";
  const isLead = currentUser?.accessRole === "Lead";
  const leadBuilding = currentUser?.building || "";

  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Filters
  const [filterBuilding, setFilterBuilding] = useState<string>("ALL");
  const [filterShift, setFilterShift] = useState<string>("ALL");
  const [filterChannel, setFilterChannel] = useState<string>("ALL");

  // Compose state
  const [building, setBuilding] = useState<string>(BUILDINGS[0] ?? "DC18");
  const [shift, setShift] = useState<string>("1st");
  const [channel, setChannel] = useState<string>("General");
  const [text, setText] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function persist(next: ChatMessage[]) {
    setMessages(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify(next));
    }
  }

  async function refreshFromSupabase() {
    if (!currentUser) return;

    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from("chats")
        .select("*")
        .order("created_at", { ascending: true });

      // If this user is a Lead, only show chats for their building
      if (isLead && leadBuilding) {
        query = query.eq("building", leadBuilding);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error loading chats", error);
        setError("Failed to load chats from server.");
        return;
      }

      const rows = (data || []) as ChatRow[];
      const mapped = rows.map(rowToChat);
      persist(mapped);
    } catch (e) {
      console.error("Unexpected error loading chats", e);
      setError("Unexpected error loading chats.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!currentUser) return;
    refreshFromSupabase();
  }, [currentUser]);

  // Once we know user + role, lock building/filters for Leads
  useEffect(() => {
    if (!currentUser) return;
    if (isLead && leadBuilding) {
      setBuilding((prev) => prev || leadBuilding);
      setFilterBuilding(leadBuilding);
    }
  }, [currentUser, isLead, leadBuilding]);

  const filteredMessages = useMemo(() => {
    return messages.filter((m) => {
      // Hard safety: Leads never see other buildings, even if somehow loaded
      if (isLead && leadBuilding && m.building !== leadBuilding) {
        return false;
      }

      if (filterBuilding !== "ALL" && m.building !== filterBuilding) {
        return false;
      }
      if (filterShift !== "ALL" && m.shift !== filterShift) {
        return false;
      }
      if (filterChannel !== "ALL" && m.channel !== filterChannel) {
        return false;
      }
      return true;
    });
  }, [messages, filterBuilding, filterShift, filterChannel, isLead, leadBuilding]);

  const effectiveFilterBuilding =
    isLead && leadBuilding ? leadBuilding : filterBuilding;
  const buildingLabel =
    effectiveFilterBuilding === "ALL"
      ? "All Buildings"
      : effectiveFilterBuilding;

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayCount = filteredMessages.filter((m) =>
    (m.createdAt || "").startsWith(todayStr)
  ).length;

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (sending) return;

    const trimmed = text.trim();
    if (!trimmed) return;

    setSending(true);
    setError(null);

    try {
      const payload = {
        building: isLead && leadBuilding ? leadBuilding : building,
        shift,
        channel,
        message: trimmed,
        author_name: currentUser?.name ?? null,
        author_email: currentUser?.email ?? null,
        author_role: currentUser?.accessRole ?? null,
      };

      const { error } = await supabase.from("chats").insert(payload);

      if (error) {
        console.error("Error sending chat message", error);
        setError("Failed to send message.");
        return;
      }

      setText("");
      await refreshFromSupabase();
    } catch (e) {
      console.error("Unexpected error sending message", e);
      setError("Unexpected error sending message.");
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(id: string) {
    if (!currentUser || !isSuperAdmin) {
      // Extra safety on the client side
      return;
    }

    if (typeof window !== "undefined") {
      const ok = window.confirm("Delete this message?");
      if (!ok) return;
    }

    setError(null);

    try {
      const { error } = await supabase
        .from("chats")
        .delete()
        .eq("id", id);

      if (error) {
        console.error("Error deleting chat message", error);
        setError("Failed to delete message.");
        return;
      }

      await refreshFromSupabase();
    } catch (e) {
      console.error("Unexpected error deleting message", e);
      setError("Unexpected error deleting message.");
    }
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
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">
              Building / Shift Chats
            </h1>
            <p className="text-sm text-slate-400">
              Quick communications hub for leads, building managers, HR, and
              lumpers. Messages are grouped by building, shift, and channel.
            </p>
          </div>
          <Link
            href="/"
            className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {/* Top summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
            <div className="text-slate-400 mb-1">Messages Today</div>
            <div className="text-2xl font-semibold text-sky-300">
              {todayCount}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Filtered view: {buildingLabel}
            </div>
          </div>
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
            <div className="text-slate-400 mb-1">Total Messages</div>
            <div className="text-2xl font-semibold text-slate-100">
              {filteredMessages.length}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              After current filters
            </div>
          </div>
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
            <div className="text-slate-400 mb-1">Your Building</div>
            <div className="text-lg font-semibold text-emerald-300">
              {currentUser.building || "Unset"}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              From your profile
            </div>
          </div>
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
            <div className="text-slate-400 mb-1">Your Role</div>
            <div className="text-lg font-semibold text-amber-300">
              {currentUser.accessRole || "Worker"}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Controls what you can see elsewhere
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="text-xs text-red-300 bg-red-950/40 border border-red-800 rounded px-3 py-2">
            {error}
          </div>
        )}

        {/* Filters + content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Compose panel */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs space-y-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-slate-200 text-sm font-semibold">
                New Message
              </div>
              {loading && (
                <div className="text-[11px] text-slate-500">
                  Loading chat history…
                </div>
              )}
            </div>

            <form onSubmit={handleSend} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Building
                  </label>
                  <select
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                    value={isLead && leadBuilding ? leadBuilding : building}
                    onChange={(e) => setBuilding(e.target.value)}
                    disabled={isLead && !!leadBuilding}
                  >
                    {BUILDINGS.map((b) => {
                      if (isLead && leadBuilding && b !== leadBuilding) return null;
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
                  Channel
                </label>
                <select
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                >
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Message
                </label>
                <textarea
                  rows={4}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-50 resize-none"
                  placeholder="Quick update for this shift…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={sending || !text.trim()}
                className="w-full rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-[11px] font-medium text-white px-4 py-2"
              >
                {sending ? "Sending…" : "Send Message"}
              </button>

              <p className="text-[10px] text-slate-500 mt-1">
                Messages are visible to anyone with access to this dashboard,
                filtered by building/shift/channel.
              </p>
            </form>
          </div>

          {/* Filters + list */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs lg:col-span-2 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <div className="text-slate-200 text-sm font-semibold">
                  Chat History
                </div>
                <div className="text-[11px] text-slate-500">
                  Sorted by time, oldest at the top.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-slate-50"
                  value={isLead && leadBuilding ? leadBuilding : filterBuilding}
                  onChange={(e) => setFilterBuilding(e.target.value)}
                  disabled={isLead && !!leadBuilding}
                >
                  {!isLead && <option value="ALL">All Buildings</option>}
                  {BUILDINGS.map((b) => {
                    if (isLead && leadBuilding && b !== leadBuilding) return null;
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
                >
                  <option value="ALL">All Shifts</option>
                  {SHIFTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-slate-50"
                  value={filterChannel}
                  onChange={(e) => setFilterChannel(e.target.value)}
                >
                  <option value="ALL">All Channels</option>
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    setFilterShift("ALL");
                    setFilterChannel("ALL");
                    setFilterBuilding(isLead && leadBuilding ? leadBuilding : "ALL");
                  }}
                  className="text-[11px] text-sky-300 hover:underline"
                >
                  Reset Filters
                </button>
              </div>
            </div>

            {filteredMessages.length === 0 ? (
              <p className="text-sm text-slate-500">
                No messages match the current filters.
              </p>
            ) : (
              <div className="space-y-2 max-h-[520px] overflow-auto pr-1">
                {filteredMessages.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 flex gap-3"
                  >
                    <div className="pt-1">
                      <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-[10px] text-slate-200">
                        {m.authorName
                          ? m.authorName
                              .split(" ")
                              .map((p) => p[0])
                              .join("")
                              .toUpperCase()
                              .slice(0, 2)
                          : "??"}
                      </div>
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-[11px] text-slate-200 font-medium">
                            {m.authorName || "Unknown User"}
                            {m.authorRole && (
                              <span className="ml-1 inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[9px] text-sky-200">
                                {m.authorRole}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {m.building} • {m.shift} • {m.channel}
                          </div>
                        </div>
                        <div className="text-right space-y-1">
                          <div className="text-[10px] text-slate-500 font-mono">
                            {m.createdAt.slice(0, 10)}{" "}
                            {m.createdAt.slice(11, 16)}
                          </div>
                          {isSuperAdmin && (
                            <button
                              type="button"
                              onClick={() => handleDelete(m.id)}
                              className="text-[10px] text-rose-300 hover:underline"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="text-[11px] text-slate-100 whitespace-pre-wrap">
                        {m.message}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

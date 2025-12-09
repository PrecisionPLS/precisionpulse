"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const CHATS_STORAGE_KEY = "precisionpulse_chats";

const BUILDINGS = ["DC1", "DC5", "DC11", "DC14", "DC18"];
const SHIFTS = ["1st", "2nd", "3rd", "4th"];

type ChatMessage = {
  id: string;
  building: string;
  shift: string;
  authorName: string;
  role?: string;
  text: string;
  attachmentUrl?: string;
  isPinned: boolean;
  createdAt: string; // ISO
};

export default function ChatsPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Current channel selection
  const [building, setBuilding] = useState(BUILDINGS[0]);
  const [shift, setShift] = useState(SHIFTS[0]);

  // Composer state
  const [authorName, setAuthorName] = useState("Lead");
  const [role, setRole] = useState("Lead");
  const [text, setText] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");

  // Filters/search
  const [search, setSearch] = useState("");

  const [error, setError] = useState<string | null>(null);

  // Load from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(CHATS_STORAGE_KEY);
      if (raw) {
        setMessages(JSON.parse(raw));
      }
    } catch (e) {
      console.error("Failed to load chats", e);
    }
  }, []);

  function saveMessages(next: ChatMessage[]) {
    setMessages(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify(next));
    }
  }

  // Messages for current channel
  const channelMessages = useMemo(() => {
    const filtered = messages.filter(
      (m) => m.building === building && m.shift === shift
    );

    const searched = search.trim()
      ? filtered.filter((m) =>
          (m.text + " " + (m.authorName || "") + " " + (m.role || ""))
            .toLowerCase()
            .includes(search.trim().toLowerCase())
        )
      : filtered;

    // Pinned first, then newest first
    const pinned = searched.filter((m) => m.isPinned);
    const regular = searched.filter((m) => !m.isPinned);

    const sortByTimeDesc = (arr: ChatMessage[]) =>
      [...arr].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() -
          new Date(a.createdAt).getTime()
      );

    return {
      pinned: sortByTimeDesc(pinned),
      regular: sortByTimeDesc(regular),
    };
  }, [messages, building, shift, search]);

  const channelSummary = useMemo(() => {
    const byChannel: Record<
      string,
      { total: number; lastMessage?: string }
    > = {};

    for (const b of BUILDINGS) {
      for (const s of SHIFTS) {
        const key = `${b}-${s}`;
        byChannel[key] = { total: 0 };
      }
    }

    for (const m of messages) {
      const key = `${m.building}-${m.shift}`;
      if (!byChannel[key]) {
        byChannel[key] = { total: 0 };
      }
      byChannel[key].total++;
      byChannel[key].lastMessage = m.createdAt;
    }

    return byChannel;
  }, [messages]);

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!text.trim()) {
      setError("Message text is required.");
      return;
    }

    const now = new Date().toISOString();
    const newMsg: ChatMessage = {
      id: `${Date.now()}`,
      building,
      shift,
      authorName: authorName.trim() || "Unknown",
      role: role.trim() || undefined,
      text: text.trim(),
      attachmentUrl: attachmentUrl.trim() || undefined,
      isPinned: false,
      createdAt: now,
    };

    const next = [...messages, newMsg];
    saveMessages(next);

    setText("");
    setAttachmentUrl("");
  }

  function togglePin(id: string) {
    const next = messages.map((m) =>
      m.id === id ? { ...m, isPinned: !m.isPinned } : m
    );
    saveMessages(next);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">
            Chats & Shift Communication
          </h1>
          <p className="text-sm text-slate-400">
            Building and shift-based communication hub for leads, managers,
            and HR. Pinned messages stay at the top for critical updates.
          </p>
        </div>
        <Link
          href="/"
          className="text-xs px-3 py-1 rounded-full border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
        >
          ← Back to Dashboard
        </Link>
      </div>

      {/* Layout: channel list + chat panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Channel overview */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-100 mb-1">
              Channels
            </h2>
            <p className="text-xs text-slate-500">
              One channel per building and shift. Select a channel to view
              its messages.
            </p>
          </div>

          <div className="space-y-2 text-xs max-h-[420px] overflow-auto pr-1">
            {BUILDINGS.map((b) => (
              <div key={b}>
                <div className="text-[11px] text-slate-400 mb-1 mt-2">
                  {b}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {SHIFTS.map((s) => {
                    const key = `${b}-${s}`;
                    const stats = channelSummary[key] || {
                      total: 0,
                      lastMessage: undefined,
                    };
                    const isActive =
                      building === b && shift === s;

                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setBuilding(b);
                          setShift(s);
                        }}
                        className={`text-left rounded-xl border px-2 py-2 ${
                          isActive
                            ? "bg-sky-900/40 border-sky-700 text-sky-100"
                            : "bg-slate-950 border-slate-700 text-slate-200 hover:bg-slate-800/60"
                        }`}
                      >
                        <div className="text-[11px] font-semibold">
                          {s} Shift
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Msgs:{" "}
                          <span className="text-slate-100">
                            {stats.total}
                          </span>
                        </div>
                        {stats.lastMessage && (
                          <div className="text-[10px] text-slate-500">
                            Last: {stats.lastMessage.slice(0, 10)}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chat panel */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4 lg:col-span-2">
          {/* Channel info + search */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                {building} • {shift} Shift
              </h2>
              <p className="text-xs text-slate-500">
                Use this channel for shift handoffs, staffing notes, damage
                alerts, and performance updates.
              </p>
            </div>
            <input
              className="w-full md:w-64 rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-slate-50"
              placeholder="Search messages…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Messages area */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 flex flex-col h-[360px]">
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 text-xs">
              {/* Pinned section */}
              {channelMessages.pinned.length > 0 && (
                <div className="mb-3 pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] text-amber-300">
                      📌 Pinned
                    </span>
                    <span className="flex-1 h-px bg-slate-800" />
                  </div>
                  {channelMessages.pinned.map((m) => (
                    <MessageBubble
                      key={m.id}
                      message={m}
                      onTogglePin={() => togglePin(m.id)}
                    />
                  ))}
                </div>
              )}

              {/* Regular messages */}
              {channelMessages.regular.length === 0 &&
              channelMessages.pinned.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No messages yet. Be the first to post for this channel.
                </p>
              ) : (
                channelMessages.regular.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    onTogglePin={() => togglePin(m.id)}
                  />
                ))
              )}
            </div>

            {/* Composer */}
            <form
              onSubmit={handleSend}
              className="pt-3 mt-3 border-t border-slate-800 space-y-2 text-xs"
            >
              {error && (
                <div className="text-[11px] text-red-300 bg-red-950/40 border border-red-800 rounded px-2 py-1">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">
                    Your Name
                  </label>
                  <input
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs text-slate-50"
                    value={authorName}
                    onChange={(e) =>
                      setAuthorName(e.target.value)
                    }
                    placeholder="e.g. Nick, Malik, Montory"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">
                    Role (optional)
                  </label>
                  <input
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs text-slate-50"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder="Lead, Manager, HR, etc."
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  Message
                </label>
                <textarea
                  className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs text-slate-50"
                  rows={2}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="e.g. DC1 1st shift: 4 containers left on dock, damage on trailer 123, need 1 extra clamp driver."
                />
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  Attachment / Photo URL (optional)
                </label>
                <input
                  className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs text-slate-50"
                  value={attachmentUrl}
                  onChange={(e) =>
                    setAttachmentUrl(e.target.value)
                  }
                  placeholder="Paste image URL or file link"
                />
                <p className="text-[10px] text-slate-500 mt-0.5">
                  For now this is URL-only (e.g. shared drive or image link).
                </p>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] text-slate-500">
                  Channel: {building} • {shift} shift
                </div>
                <button
                  type="submit"
                  className="rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-medium text-white px-3 py-1.5"
                >
                  Send Message
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Single message bubble */
function MessageBubble({
  message,
  onTogglePin,
}: {
  message: ChatMessage;
  onTogglePin: () => void;
}) {
  const time = new Date(message.createdAt)
    .toTimeString()
    .slice(0, 5);

  return (
    <div className="flex gap-2">
      <div className="w-1 rounded-full bg-sky-700 mt-1" />
      <div className="flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-[11px] text-slate-100 font-semibold">
              {message.authorName}
              {message.role && (
                <span className="text-[10px] text-slate-400">
                  {" "}
                  • {message.role}
                </span>
              )}
            </span>
            <span className="text-[10px] text-slate-500">
              {time}
            </span>
          </div>
          <button
            type="button"
            onClick={onTogglePin}
            className={`text-[10px] px-2 py-0.5 rounded-full border ${
              message.isPinned
                ? "bg-amber-900/60 border-amber-700 text-amber-100"
                : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {message.isPinned ? "Unpin" : "Pin"}
          </button>
        </div>
        <div className="mt-1 text-[11px] text-slate-100 whitespace-pre-wrap">
          {message.text}
        </div>
        {message.attachmentUrl && (
          <div className="mt-1">
            <a
              href={message.attachmentUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-sky-300 underline"
            >
              View attachment
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

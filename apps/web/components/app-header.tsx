"use client";

import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useState, useEffect, useRef } from "react";
import {
  logout,
  getGlobalNotes,
  saveGlobalNotes,
  getJournalEntries,
  createJournalEntry,
  deleteJournalEntry,
  type JournalEntry,
} from "@/lib/api";
import NewProjectModal from "@/components/new-project-modal";
import { useSearch } from "@/components/search-context";

export default function AppHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { search, setSearch } = useSearch();
  const [mounted, setMounted] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Global Scratchpad ─────────────────────────────────────────────────
  const [noteContent, setNoteContent] = useState("");
  const [showScratchpad, setShowScratchpad] = useState(false);
  const [scratchTab, setScratchTab] = useState<"notes" | "til">("til");
  const [tilInput, setTilInput] = useState("");
  const noteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scratchpadRef = useRef<HTMLDivElement>(null);
  const scratchpadBtnRef = useRef<HTMLButtonElement>(null);
  const { data: notesData } = useQuery({
    queryKey: ["global-notes"],
    queryFn: async () => {
      const res = await getGlobalNotes();
      return res.ok ? res.data : { content: "" };
    },
    enabled: showScratchpad,
  });
  useEffect(() => {
    if (notesData?.content !== undefined) setNoteContent(notesData.content);
  }, [notesData?.content]);
  const notesMutation = useMutation({
    mutationFn: (content: string) => saveGlobalNotes(content),
  });

  const today = new Date().toISOString().slice(0, 10);
  const { data: tilEntries = [], refetch: refetchTil } = useQuery({
    queryKey: ["journal-til", today],
    queryFn: async () => {
      const res = await getJournalEntries(100, 0);
      if (!res.ok) return [];
      return res.data.filter((e: JournalEntry) => {
        let tags: string[] = [];
        try { tags = JSON.parse(e.tags || "[]"); } catch { tags = []; }
        return e.created_at.slice(0, 10) === today && tags.includes("til");
      });
    },
    enabled: showScratchpad && scratchTab === "til",
  });
  const tilMutation = useMutation({
    mutationFn: (content: string) => createJournalEntry({ content, tags: ["til"] }),
    onSuccess: () => { setTilInput(""); refetchTil(); },
  });
  const tilDeleteMutation = useMutation({
    mutationFn: (id: string) => deleteJournalEntry(id),
    onSuccess: () => refetchTil(),
  });

  const handleNoteChange = (val: string) => {
    setNoteContent(val);
    if (noteDebounceRef.current) clearTimeout(noteDebounceRef.current);
    noteDebounceRef.current = setTimeout(() => notesMutation.mutate(val), 800);
  };

  // ── GitHub (read-only — for header indicator) ─────────────────────────
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => router.replace("/login"),
  });

  // ── Effects ───────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!showScratchpad) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowScratchpad(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showScratchpad]);

  useEffect(() => {
    if (!showScratchpad) return;
    const handler = (e: MouseEvent) => {
      if (
        scratchpadRef.current &&
        !scratchpadRef.current.contains(e.target as Node) &&
        scratchpadBtnRef.current &&
        !scratchpadBtnRef.current.contains(e.target as Node)
      ) {
        setShowScratchpad(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showScratchpad]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const effectiveTheme = resolvedTheme ?? theme;
  const isDarkTheme = mounted ? effectiveTheme === "dark" : false;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["projects"] });

  return (
    <>
      <header
        className="fixed inset-x-0 top-0 z-20 border-b"
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--bg-header)",
          backdropFilter: "blur(14px)",
        }}
      >
        <div className="flex items-stretch">
          {/* Brand — fixed width aligned above sidebar nav */}
          <div className="hidden w-60 shrink-0 items-center gap-2.5 px-5 py-0 lg:flex">
            <a href="/dashboard" className={`flex items-center gap-2.5 ${pathname === "/dashboard" ? "cursor-default" : "cursor-pointer"}`} onClick={(e) => { if (pathname === "/dashboard") e.preventDefault(); }}>
              <Image
                src="/logo.png"
                alt="LetMeCook logo"
                width={64}
                height={64}
                className="h-16 w-16 object-contain"
                priority
              />
              <span
                className="text-[15px] font-bold tracking-tight"
                style={{ color: "var(--text-primary)" }}
              >
                LetMeCook
              </span>
            </a>
          </div>

          {/* Search + actions */}
          <div className="flex flex-1 items-center justify-between gap-4 px-4 py-0 sm:px-6">

          {/* Search + New Project — centred */}
          <div className="hidden flex-1 items-center justify-center gap-2 sm:flex">
            <div className="w-full max-w-md flex items-center gap-2">
            <div className="relative flex-1">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
                />
              </svg>
              <input
                ref={searchRef}
                type="text"
                placeholder="Search projects…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border py-1.5 pl-9 pr-14 text-sm outline-none transition-all focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30"
                style={{
                  borderColor: "var(--input-border)",
                  background: "var(--input-bg)",
                  color: "var(--text-primary)",
                }}
              />
              <kbd
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border px-1.5 py-0.5 font-mono text-[10px]"
                style={{
                  borderColor: "var(--border-subtle)",
                  background: "var(--input-bg)",
                  color: "var(--text-muted)",
                }}
              >
                ⌘ K
              </kbd>
            </div>
            <button
              onClick={() => setShowNew(true)}
              aria-label="New project"
              title="New project"
              className="group relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-orange-400/40 text-white transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:scale-[0.98]"
              style={{
                background:
                  "linear-gradient(135deg, #f97316 0%, #ea580c 55%, #c2410c 100%)",
                boxShadow:
                  "0 10px 24px -10px rgba(249,115,22,0.6), inset 0 1px 0 rgba(255,255,255,0.2)",
              }}
            >
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-500 group-hover:translate-x-full" />
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex shrink-0 items-center gap-2">
            {/* Scratchpad toggle */}
            <button
              ref={scratchpadBtnRef}
              onClick={() => setShowScratchpad((v) => !v)}
              aria-label="Toggle scratchpad"
              title="Notes & TIL"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-200 focus:outline-none"
              style={{
                background: showScratchpad ? "rgba(99,102,241,0.12)" : "var(--bg-card)",
                border: `1px solid ${showScratchpad ? "rgba(99,102,241,0.3)" : "var(--border-subtle)"}`,
                color: showScratchpad ? "#818cf8" : "var(--text-secondary)",
              }}
            >
              <svg
                className="h-4 w-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              <span>Dev Pad</span>
            </button>

            {/* Theme toggle */}
            <button
              onClick={() => setTheme(isDarkTheme ? "light" : "dark")}
              aria-label="Toggle theme"
              title={
                mounted
                  ? isDarkTheme
                    ? "Switch to light mode"
                    : "Switch to dark mode"
                  : "Toggle theme"
              }
              className="group flex items-center justify-center rounded-lg p-1.5 transition-all duration-200 focus:outline-none"
              style={{ color: "var(--text-muted)" }}
            >
              {isDarkTheme ? (
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z"
                  />
                </svg>
              ) : (
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                  />
                </svg>
              )}
            </button>

            {/* Sign out */}
            <button
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              aria-label={
                logoutMutation.isPending ? "Signing out" : "Sign out"
              }
              title={
                logoutMutation.isPending ? "Signing out..." : "Sign out"
              }
              className="group flex items-center justify-center p-1 text-red-400 transition-all duration-200 hover:text-red-300 hover:drop-shadow-[0_0_8px_rgba(248,113,113,0.45)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h5a2 2 0 012 2v1"
                />
              </svg>
            </button>
          </div>
          </div>
        </div>
      </header>

      {/* ── Modals / panels ──────────────────────────────────────────────── */}
      {showNew && (
        <NewProjectModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            invalidate();
          }}
        />
      )}

      {/* ── Global Scratchpad ──────────────────────────────────────────── */}
      <div
        ref={scratchpadRef}
        className={`fixed inset-y-0 right-0 z-30 flex w-full max-w-sm flex-col shadow-2xl transition-transform duration-300 ease-in-out${
          showScratchpad ? " translate-x-0" : " translate-x-full pointer-events-none"
        }`}
        style={{ borderLeft: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}
      >
          {/* top accent */}
          <div className="h-0.5 w-full shrink-0" style={{ background: "linear-gradient(90deg, #6366f1, #8b5cf6 50%, transparent)" }} />

          {/* header */}
          <div className="flex shrink-0 items-center justify-between px-4 pt-3 pb-2">
            <div className="flex items-center gap-2">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-lg text-sm"
                style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.2)" }}
              >
                📝
              </div>
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Dev Pad</span>
            </div>
            <div className="flex items-center gap-2">
              {notesMutation.isPending && scratchTab === "notes" && (
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>saving…</span>
              )}
              <button
                onClick={() => setShowScratchpad(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-black/10 dark:hover:bg-white/10"
                style={{ color: "var(--text-muted)" }}
                aria-label="Close"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </div>
          </div>

          {/* tabs */}
          <div className="flex shrink-0 gap-1 px-4 pb-2">
            {(["til", "notes"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setScratchTab(tab)}
                className="rounded-lg px-3 py-1 text-xs font-medium transition-all"
                style={{
                  background: scratchTab === tab ? (tab === "til" ? "rgba(234,179,8,0.12)" : "rgba(99,102,241,0.12)") : "transparent",
                  color: scratchTab === tab ? (tab === "til" ? "#eab308" : "#818cf8") : "var(--text-muted)",
                  border: `1px solid ${scratchTab === tab ? (tab === "til" ? "rgba(234,179,8,0.25)" : "rgba(99,102,241,0.25)") : "var(--border-subtle)"}`,
                }}
              >
                {tab === "notes" ? "✦ Notes" : "💡 TIL"}
              </button>
            ))}
          </div>

          <div className="mx-4 mb-3 h-px shrink-0" style={{ background: "var(--border-subtle)" }} />

          {/* notes tab */}
          {scratchTab === "notes" && (
            <>
              <textarea
                value={noteContent}
                onChange={(e) => handleNoteChange(e.target.value)}
                placeholder="Drop random thoughts, code snippets, commands…"
                className="flex-1 resize-none bg-transparent px-4 pb-4 text-sm leading-relaxed outline-none"
                style={{ color: "var(--text-primary)", caretColor: "#6366f1" }}
              />
              <div
                className="shrink-0 border-t px-4 py-2 text-[11px]"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
              >
                {noteContent.length.toLocaleString()} chars · auto-saves as you type
              </div>
            </>
          )}

          {/* TIL tab */}
          {scratchTab === "til" && (
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* input area */}
              <div className="shrink-0 px-4 pb-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#eab308" }}>
                  Today I Learned
                </p>
                <textarea
                  value={tilInput}
                  onChange={(e) => setTilInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && tilInput.trim()) {
                      tilMutation.mutate(tilInput.trim());
                    }
                  }}
                  placeholder="What did you learn today? A trick, a concept, a fix…"
                  rows={3}
                  className="w-full resize-none rounded-xl border bg-transparent px-3 py-2.5 text-sm leading-relaxed outline-none"
                  style={{
                    borderColor: "var(--border-subtle)",
                    color: "var(--text-primary)",
                    caretColor: "#eab308",
                  }}
                />
                <button
                  onClick={() => tilInput.trim() && tilMutation.mutate(tilInput.trim())}
                  disabled={!tilInput.trim() || tilMutation.isPending}
                  className="mt-2 w-full rounded-xl py-2 text-xs font-semibold transition-all disabled:opacity-40"
                  style={{
                    background: "rgba(234,179,8,0.12)",
                    border: "1px solid rgba(234,179,8,0.25)",
                    color: "#eab308",
                  }}
                >
                  {tilMutation.isPending ? "Logging…" : "Log it  ⌘↵"}
                </button>
              </div>

              <div className="mx-4 mb-2 h-px shrink-0" style={{ background: "var(--border-subtle)" }} />

              {/* today's entries */}
              <div className="flex-1 overflow-y-auto px-4 pb-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                  Logged today
                </p>
                {tilEntries.length === 0 ? (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>Nothing logged yet — be curious!</p>
                ) : (
                  <ul className="space-y-2">
                    {tilEntries.map((entry: JournalEntry) => (
                      <li
                        key={entry.id}
                        className="group flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm leading-relaxed"
                        style={{ borderColor: "rgba(234,179,8,0.15)", background: "rgba(234,179,8,0.04)", color: "var(--text-primary)" }}
                      >
                        <span className="flex-1">{entry.content}</span>
                        <button
                          onClick={() => tilDeleteMutation.mutate(entry.id)}
                          disabled={tilDeleteMutation.isPending}
                          className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 disabled:cursor-not-allowed"
                          style={{ color: "var(--text-muted)" }}
                          title="Delete"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
    </>
  );
}

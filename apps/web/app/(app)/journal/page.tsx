"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getJournalCalendar,
  createJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
  uploadJournalImages,
  deleteJournalImage,
  type JournalEntry,
  type JournalImage,
} from "@/lib/api";

// ── Constants ───────────────────────────────────────────────────────────────

const MOODS = [
  { emoji: "🔥", label: "On fire" },
  { emoji: "😊", label: "Good" },
  { emoji: "😐", label: "Meh" },
  { emoji: "😩", label: "Tough" },
  { emoji: "🧠", label: "Learned a lot" },
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function toDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(datetimeStr: string): string {
  const dt = new Date(datetimeStr.replace(" ", "T") + (datetimeStr.includes("Z") ? "" : "Z"));
  return dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function friendlyDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - date.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff === -1) return "Tomorrow";
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function getCalendarGrid(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1);
  // Monday = 0 ... Sunday = 6
  let startDow = firstDay.getDay() - 1;
  if (startDow < 0) startDow = 6;
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// ── Main ────────────────────────────────────────────────────────────────────

export default function JournalPage() {
  const queryClient = useQueryClient();
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string>(toDateKey(today));
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [mood, setMood] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Data fetching ─────────────────────────────────────────────────────
  const { data: calendarData, isLoading } = useQuery({
    queryKey: ["journal-calendar", viewYear, viewMonth],
    queryFn: async () => {
      const res = await getJournalCalendar(viewYear, viewMonth);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const days = calendarData?.days ?? {};
  const entries = calendarData?.entries ?? [];

  // Entries for selected date
  const dayEntries = useMemo(() => {
    if (!selectedDate) return [];
    return entries.filter((e) => e.created_at.slice(0, 10) === selectedDate);
  }, [entries, selectedDate]);

  // Stats
  const totalEntries = entries.length;
  const uniqueDays = Object.keys(days).length;

  // Streak: count consecutive days with entries ending today or yesterday
  const streak = useMemo(() => {
    const todayKey = toDateKey(today);
    const allDays = new Set(Object.keys(days));
    if (allDays.size === 0) return 0;
    let count = 0;
    const d = new Date(today);
    // Check if today has entries, if not start from yesterday
    if (!allDays.has(toDateKey(d))) {
      d.setDate(d.getDate() - 1);
      if (!allDays.has(toDateKey(d))) return 0;
    }
    while (allDays.has(toDateKey(d))) {
      count++;
      d.setDate(d.getDate() - 1);
    }
    return count;
  }, [days]);

  // ── Mutations ─────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await createJournalEntry({ content: content.trim(), mood: mood ?? undefined });
      if (!res.ok) throw new Error(res.error.message);
      // Upload pending images
      if (pendingFiles.length > 0 && res.data) {
        await uploadJournalImages(res.data.id, pendingFiles);
      }
      return res;
    },
    onSuccess: () => {
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["journal-calendar"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: { content?: string; mood?: string } }) => {
      const res = await updateJournalEntry(id, body);
      if (!res.ok) throw new Error(res.error.message);
      // Upload any new images
      if (pendingFiles.length > 0) {
        await uploadJournalImages(id, pendingFiles);
      }
      return res;
    },
    onSuccess: () => {
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["journal-calendar"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteJournalEntry(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["journal-calendar"] }),
  });

  const deleteImageMutation = useMutation({
    mutationFn: (imageId: string) => deleteJournalImage(imageId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["journal-calendar"] }),
  });

  const uploadImagesMutation = useMutation({
    mutationFn: ({ entryId, files }: { entryId: string; files: File[] }) =>
      uploadJournalImages(entryId, files),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["journal-calendar"] }),
  });

  // ── Form helpers ──────────────────────────────────────────────────────
  const resetForm = useCallback(() => {
    setContent("");
    setMood(null);
    setPendingFiles([]);
    setComposing(false);
    setEditingId(null);
  }, []);

  const startEdit = useCallback((entry: JournalEntry) => {
    setEditingId(entry.id);
    setContent(entry.content);
    setMood(entry.mood);
    setPendingFiles([]);
    setComposing(true);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  const startCompose = useCallback(() => {
    resetForm();
    setComposing(true);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [resetForm]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setPendingFiles((prev) => [...prev, ...files]);
    e.target.value = "";
  }, []);

  const removePendingFile = useCallback((idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length) setPendingFiles((prev) => [...prev, ...files]);
  }, []);

  // Upload images to existing entry via separate button
  const handleAddImagesToEntry = useCallback((entryId: string) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      if (files.length) uploadImagesMutation.mutate({ entryId, files });
    };
    input.click();
  }, [uploadImagesMutation]);

  // Navigation
  const goToMonth = useCallback((delta: number) => {
    setViewMonth((m) => {
      let nm = m + delta;
      if (nm < 1) { nm = 12; setViewYear((y) => y - 1); }
      else if (nm > 12) { nm = 1; setViewYear((y) => y + 1); }
      return nm;
    });
  }, []);

  const goToToday = useCallback(() => {
    const t = new Date();
    setViewYear(t.getFullYear());
    setViewMonth(t.getMonth() + 1);
    setSelectedDate(toDateKey(t));
  }, []);

  // Calendar grid
  const cells = useMemo(() => getCalendarGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  const todayKey = toDateKey(today);
  const isCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth() + 1;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* ── Left: Calendar + Stats ──────────────────────────────────── */}
      <div className="lg:w-[340px] shrink-0 space-y-4">
        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: "rgba(249,115,22,0.1)", color: "#f97316" }}
            >
              <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Dev Journal</h1>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>What did you build today?</p>
            </div>
          </div>
        </div>

        {/* Month navigation */}
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
        >
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => goToMonth(-1)}
              className="rounded-lg p-1.5 transition-colors hover:bg-white/[0.06]"
              style={{ color: "var(--text-secondary)" }}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {MONTH_NAMES[viewMonth - 1]} {viewYear}
              </span>
              {!isCurrentMonth && (
                <button
                  onClick={goToToday}
                  className="rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors hover:bg-white/[0.06]"
                  style={{ color: "#f97316", background: "rgba(249,115,22,0.1)" }}
                >
                  Today
                </button>
              )}
            </div>
            <button
              onClick={() => goToMonth(1)}
              className="rounded-lg p-1.5 transition-colors hover:bg-white/[0.06]"
              style={{ color: "var(--text-secondary)" }}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map((d) => (
              <div key={d} className="text-center text-[10px] font-medium py-1" style={{ color: "var(--text-muted)" }}>
                {d}
              </div>
            ))}
          </div>

          {/* Calendar cells */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (day === null) return <div key={`e${i}`} />;
              const dateKey = `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const dayData = days[dateKey];
              const isToday = dateKey === todayKey;
              const isSelected = dateKey === selectedDate;
              const hasEntries = !!dayData;
              const isFuture = new Date(dateKey) > today;

              return (
                <button
                  key={dateKey}
                  onClick={() => setSelectedDate(dateKey)}
                  disabled={isFuture}
                  className="relative flex flex-col items-center justify-center rounded-lg py-1.5 transition-all"
                  style={{
                    background: isSelected
                      ? "rgba(249,115,22,0.2)"
                      : isToday
                      ? "rgba(249,115,22,0.06)"
                      : "transparent",
                    border: isSelected ? "1px solid rgba(249,115,22,0.4)" : "1px solid transparent",
                    color: isFuture
                      ? "var(--text-muted)"
                      : isSelected
                      ? "#f97316"
                      : isToday
                      ? "#f97316"
                      : "var(--text-primary)",
                    opacity: isFuture ? 0.3 : 1,
                    cursor: isFuture ? "default" : "pointer",
                  }}
                >
                  <span className="text-xs font-medium">{day}</span>
                  {/* Mood dots */}
                  {hasEntries && (
                    <div className="flex items-center gap-0.5 mt-0.5 h-3">
                      {dayData.moods.length > 0 ? (
                        dayData.moods.slice(0, 3).map((m, mi) => (
                          <span key={mi} className="text-[8px] leading-none">{m}</span>
                        ))
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#f97316" }} />
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Monthly stats */}
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
        >
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{totalEntries}</p>
              <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Entries</p>
            </div>
            <div>
              <p className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{uniqueDays}</p>
              <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Days active</p>
            </div>
            <div>
              <p className="text-lg font-bold" style={{ color: streak > 0 ? "#f97316" : "var(--text-primary)" }}>
                {streak > 0 ? `${streak}🔥` : "0"}
              </p>
              <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Streak</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: Day panel ────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">
        {/* Day header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              {friendlyDate(selectedDate)}
            </h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {dayEntries.length === 0
                ? "No entries"
                : `${dayEntries.length} ${dayEntries.length === 1 ? "entry" : "entries"}`}
            </p>
          </div>
          {!composing && (
            <button
              onClick={startCompose}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #f97316, #ea580c)" }}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New Entry
            </button>
          )}
        </div>

        {/* ── Compose / Edit form ──────────────────────────────────── */}
        {composing && (
          <div
            className="mb-5 rounded-xl border p-4"
            style={{ borderColor: "rgba(249,115,22,0.3)", background: "var(--bg-card)" }}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What did you build, learn, or figure out today?"
              rows={4}
              className="w-full resize-none rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30"
              style={{
                borderColor: "var(--input-border)",
                background: "var(--input-bg)",
                color: "var(--text-primary)",
              }}
            />

            {/* Image previews */}
            {pendingFiles.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {pendingFiles.map((file, idx) => (
                  <div key={idx} className="group relative h-16 w-16 rounded-lg overflow-hidden border" style={{ borderColor: "var(--border-subtle)" }}>
                    <img src={URL.createObjectURL(file)} alt="" className="h-full w-full object-cover" />
                    <button
                      onClick={() => removePendingFile(idx)}
                      className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 flex items-center justify-between gap-3">
              {/* Mood picker */}
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-xs mr-1" style={{ color: "var(--text-muted)" }}>Mood:</span>
                {MOODS.map((m) => (
                  <button
                    key={m.emoji}
                    onClick={() => setMood(mood === m.emoji ? null : m.emoji)}
                    className="rounded-lg px-2 py-1 text-base transition-all"
                    style={{
                      background: mood === m.emoji ? "rgba(249,115,22,0.15)" : "transparent",
                      border: mood === m.emoji ? "1px solid rgba(249,115,22,0.3)" : "1px solid transparent",
                    }}
                    title={m.label}
                  >
                    {m.emoji}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                {/* Image upload button */}
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg p-2 transition-colors hover:bg-white/[0.06]"
                  style={{ color: "var(--text-muted)" }}
                  title="Attach images"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A1.5 1.5 0 0021.75 19.5V4.5A1.5 1.5 0 0020.25 3H3.75A1.5 1.5 0 002.25 4.5v15A1.5 1.5 0 003.75 21z" />
                  </svg>
                </button>

                <button
                  onClick={resetForm}
                  className="rounded-lg px-3 py-2 text-xs font-medium transition-colors hover:bg-white/[0.06]"
                  style={{ color: "var(--text-muted)" }}
                >
                  Cancel
                </button>

                <button
                  onClick={() => {
                    if (editingId) {
                      updateMutation.mutate({ id: editingId, body: { content: content.trim(), mood: mood ?? undefined } });
                    } else {
                      createMutation.mutate();
                    }
                  }}
                  disabled={!content.trim() || createMutation.isPending || updateMutation.isPending}
                  className="shrink-0 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-opacity disabled:opacity-60 hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, #f97316, #ea580c)" }}
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? "Saving..."
                    : editingId
                    ? "Update"
                    : "Save Entry"}
                </button>
              </div>
            </div>

            {/* Drop hint */}
            <p className="mt-2 text-[10px] text-center" style={{ color: "var(--text-muted)" }}>
              Drop images here or click the image icon to attach
            </p>
          </div>
        )}

        {/* ── Loading ──────────────────────────────────────────────── */}
        {isLoading && (
          <div className="flex items-center gap-2 py-10" style={{ color: "var(--text-muted)" }}>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span className="text-sm">Loading journal…</span>
          </div>
        )}

        {/* ── Empty state ──────────────────────────────────────────── */}
        {!isLoading && dayEntries.length === 0 && !composing && (
          <div
            className="flex flex-col items-center justify-center rounded-xl border py-16"
            style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
          >
            <span className="mb-3 text-4xl">📖</span>
            <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
              No entries for this day
            </p>
            <p className="mt-1 text-xs mb-4" style={{ color: "var(--text-muted)" }}>
              {selectedDate === todayKey
                ? "Start documenting your dev journey."
                : "You didn't journal on this day."}
            </p>
            {selectedDate === todayKey && (
              <button
                onClick={startCompose}
                className="rounded-lg px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: "linear-gradient(135deg, #f97316, #ea580c)" }}
              >
                Write your first entry
              </button>
            )}
          </div>
        )}

        {/* ── Entries list ─────────────────────────────────────────── */}
        {!isLoading && dayEntries.length > 0 && (
          <div className="space-y-4">
            {dayEntries.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                onEdit={() => startEdit(entry)}
                onDelete={() => deleteMutation.mutate(entry.id)}
                onDeleteImage={(imgId) => deleteImageMutation.mutate(imgId)}
                onAddImages={() => handleAddImagesToEntry(entry.id)}
                setExpandedImage={setExpandedImage}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Lightbox overlay ────────────────────────────────────────── */}
      {expandedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setExpandedImage(null)}
        >
          <button
            onClick={() => setExpandedImage(null)}
            className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img
            src={expandedImage}
            alt=""
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

// ── Entry Card Component ────────────────────────────────────────────────────

function EntryCard({
  entry,
  onEdit,
  onDelete,
  onDeleteImage,
  onAddImages,
  setExpandedImage,
}: {
  entry: JournalEntry;
  onEdit: () => void;
  onDelete: () => void;
  onDeleteImage: (imageId: string) => void;
  onAddImages: () => void;
  setExpandedImage: (url: string | null) => void;
}) {
  return (
    <div
      className="group rounded-xl border p-4 transition-colors"
      style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {entry.mood && <span className="text-lg">{entry.mood}</span>}
          <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
            {formatTime(entry.created_at)}
          </span>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onAddImages}
            className="rounded p-1 transition-colors hover:bg-white/[0.06]"
            style={{ color: "var(--text-muted)" }}
            title="Add images"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A1.5 1.5 0 0021.75 19.5V4.5A1.5 1.5 0 0020.25 3H3.75A1.5 1.5 0 002.25 4.5v15A1.5 1.5 0 003.75 21z" />
            </svg>
          </button>
          <button
            onClick={onEdit}
            className="rounded p-1 transition-colors hover:bg-white/[0.06]"
            style={{ color: "var(--text-muted)" }}
            title="Edit"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
          </button>
          <button
            onClick={onDelete}
            className="rounded p-1 text-red-400/50 transition-colors hover:text-red-400 hover:bg-white/[0.06]"
            title="Delete"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: "var(--text-primary)" }}>
        {entry.content}
      </p>

      {/* Images */}
      {entry.images && entry.images.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {entry.images.map((img) => {
            const src = `/api/journal/images/${img.filename}`;
            return (
              <div key={img.id} className="group/img relative rounded-lg overflow-hidden border" style={{ borderColor: "var(--border-subtle)" }}>
                <button
                  onClick={() => setExpandedImage(src)}
                  className="block"
                >
                  <img
                    src={src}
                    alt={img.original_name}
                    className="h-24 w-auto max-w-[200px] object-cover rounded-lg transition-transform hover:scale-[1.02]"
                  />
                </button>
                <button
                  onClick={() => onDeleteImage(img.id)}
                  className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover/img:opacity-100 transition-opacity hover:bg-red-500/80"
                  title="Remove image"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

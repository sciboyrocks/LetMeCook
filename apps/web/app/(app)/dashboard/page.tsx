"use client";

import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useCallback } from "react";
import { getProjects, getFocus, setFocus, getActiveTunnels, getLatestBackups, killTunnel, type Project } from "@/lib/api";
import ProjectCard from "@/components/project-card";
import ActivityHeatmap from "@/components/activity-heatmap";
import AIUsageWidget from "@/components/ai-usage-widget";
import PickUpBanner from "@/components/pick-up-banner";
import WeeklyWrappedBanner from "@/components/weekly-wrapped-banner";
import { useSearch } from "@/components/search-context";

type Filter = "all" | Project["status"] | "pinned";

const FILTERS: { value: Filter; label: string; color?: string }[] = [
  { value: "all",         label: "All" },
  { value: "active",      label: "Active",      color: "#34d399" },
  { value: "idea",        label: "Ideas",       color: "#38bdf8" },
  { value: "paused",      label: "Paused",      color: "#fbbf24" },
  { value: "maintenance", label: "Maintenance", color: "#fb923c" },
  { value: "done",        label: "Done",        color: "#a3a3a3" },
  { value: "graveyard",   label: "Graveyard",   color: "#f87171" },
  { value: "pinned",      label: "Pinned",      color: "#fbbf24" },
];

const STAT_WIDGETS = [
  { key: "active",  label: "Active",  icon: "▶", color: "#34d399", glow: "rgba(52,211,153,0.2)" },
  { key: "idea",    label: "Ideas",   icon: "✦", color: "#38bdf8", glow: "rgba(56,189,248,0.2)" },
  { key: "paused",  label: "Paused",  icon: "⏸", color: "#fbbf24", glow: "rgba(251,191,36,0.2)" },
  { key: "done",    label: "Done",    icon: "✓", color: "#a3a3a3", glow: "rgba(163,163,163,0.15)" },
] as const;

function SkeletonCard() {
  return (
    <div className="skeleton rounded-xl border h-36" style={{ borderColor: "var(--border-subtle)" }} />
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { search, setSearch } = useSearch();
  const [filter, setFilter] = useState<Filter>("all");

  // ── Today's Focus ─────────────────────────────────────────────────────
  const [focusInput, setFocusInput] = useState("");
  const { data: focusData } = useQuery({
    queryKey: ["focus"],
    queryFn: async () => {
      const res = await getFocus();
      return res.ok ? res.data : { goal: "" };
    },
  });
  useEffect(() => {
    if (focusData?.goal !== undefined) setFocusInput(focusData.goal);
  }, [focusData?.goal]);
  const focusMutation = useMutation({ mutationFn: (goal: string) => setFocus(goal) });

  const handleFocusSave = useCallback(() => {
    focusMutation.mutate(focusInput);
  }, [focusInput, focusMutation]);

  // ── Projects ──────────────────────────────────────────────────────────
  const { data, isLoading, isError } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await getProjects();
      if (!res.ok) {
        if (res.error.code === "UNAUTHORIZED") router.replace("/login");
        throw new Error(res.error.message);
      }
      return res.data;
    },
  });

  const allProjects = data ?? [];

  // ── Active Tunnels + Latest Backups ───────────────────────────────────
  const { data: activeTunnels = [] } = useQuery({
    queryKey: ["active-tunnels"],
    queryFn: async () => {
      const res = await getActiveTunnels();
      return res.ok ? res.data : [];
    },
    refetchInterval: 10000,
  });

  const { data: latestBackups = {} } = useQuery({
    queryKey: ["latest-backups"],
    queryFn: async () => {
      const res = await getLatestBackups();
      return res.ok ? res.data : {};
    },
  });

  const tunnelByProject = new Map<string, { id: string; url: string | null; port: number }>();
  for (const t of activeTunnels) {
    if (t.projectId) {
      tunnelByProject.set(t.projectId, { id: t.id, url: t.url, port: t.port });
    }
  }

  const handleKillTunnel = (tunnelId: string) => {
    killTunnel(tunnelId).then(() => {
      queryClient.invalidateQueries({ queryKey: ["active-tunnels"] });
    });
  };

  const byFilter = allProjects.filter((p) => {
    if (filter === "pinned") return p.pinned;
    if (filter !== "all") return p.status === filter;
    return true;
  });

  const filtered = byFilter.filter(
    (p) =>
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.slug.toLowerCase().includes(search.toLowerCase()) ||
      p.description?.toLowerCase().includes(search.toLowerCase())
  );

  const pinned = filtered.filter((p) => p.pinned && filter === "all");
  const rest = filter === "all" ? filtered.filter((p) => !p.pinned) : filtered;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["projects"] });

  return (
    <>
      {/* ── Pick Up Where You Left Off ────────────────────────────────── */}
      {!isLoading && !isError && allProjects.length > 0 && <PickUpBanner />}

      {/* Mobile search */}
      <div className="mb-5 sm:hidden">
        <input
          type="text"
          placeholder="Search projects…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30"
          style={{ borderColor: "var(--input-border)", background: "var(--input-bg)", color: "var(--text-primary)" }}
        />
      </div>

      {/* ── Today's Focus ─────────────────────────────────────────────── */}
      <div
        className="mb-6 overflow-hidden rounded-2xl border"
        style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
      >
        {/* accent bar */}
        <div className="h-0.5 w-full" style={{ background: "linear-gradient(90deg, #f97316, #fb923c44, transparent)" }} />
        <div className="flex items-center gap-4 px-5 py-4">
          {/* icon */}
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base"
            style={{ background: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.2)" }}
          >
            🎯
          </div>
          {/* text area */}
          <div className="min-w-0 flex-1">
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#f97316" }}>
              Today&apos;s Focus
            </p>
            <input
              type="text"
              placeholder="What are you building today?"
              value={focusInput}
              onChange={(e) => setFocusInput(e.target.value)}
              onBlur={handleFocusSave}
              onKeyDown={(e) => e.key === "Enter" && handleFocusSave()}
              className="w-full bg-transparent text-sm font-medium outline-none placeholder:font-normal"
              style={{ color: "var(--text-primary)" }}
            />
          </div>
          {/* trailing */}
          {focusMutation.isPending && (
            <span className="shrink-0 text-[11px]" style={{ color: "var(--text-muted)" }}>saving…</span>
          )}
          {!focusMutation.isPending && focusInput && (
            <button
              onClick={() => { setFocusInput(""); focusMutation.mutate(""); }}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/10 dark:hover:bg-white/10"
              style={{ color: "var(--text-muted)" }}
              title="Clear focus"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Filter tabs ──────────────────────────────────────────────── */}
      {!isLoading && !isError && allProjects.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-1.5">
          {FILTERS.map(({ value, label, color }) => {
            const count = value === "all"
              ? allProjects.length
              : value === "pinned"
                ? allProjects.filter((p) => p.pinned).length
                : allProjects.filter((p) => p.status === value).length;
            if (count === 0 && value !== "all") return null;
            const active = filter === value;
            return (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
                style={{
                  background: active ? (color ? color + "18" : "rgba(255,255,255,0.08)") : "transparent",
                  color: active ? (color ?? "var(--text-primary)") : "var(--text-secondary)",
                  border: active ? `1px solid ${(color ?? "#f97316")}40` : "1px solid transparent",
                }}
              >
                {color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
                {label}
                <span className="rounded px-1 text-[10px]" style={{ background: "var(--bg-card)", color: active ? (color ?? "var(--text-primary)") : "var(--text-muted)" }}>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Loading skeletons ─────────────────────────────────────────── */}
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* ── Error ─────────────────────────────────────────────────────── */}
      {isError && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-red-900/60" style={{ background: "rgba(127,29,29,0.2)" }}>
            <svg className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-neutral-400">Failed to load projects</p>
          <p className="mt-1 text-xs text-neutral-600">Check your connection and try again.</p>
        </div>
      )}

      {/* ── Empty state — zero projects ───────────────────────────────── */}
      {!isLoading && !isError && allProjects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <div className="relative mb-7">
            <div className="absolute inset-0 rounded-3xl blur-2xl" style={{ background: "radial-gradient(circle, rgba(249,115,22,0.25) 0%, transparent 70%)" }} />
            <div className="relative flex h-24 w-24 items-center justify-center rounded-3xl border border-white/[0.07] text-5xl"
              style={{ background: "linear-gradient(135deg, rgba(249,115,22,0.15), rgba(234,88,12,0.08))" }}>
              🍳
            </div>
          </div>
          <h2 className="mb-2 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>Nothing cooking yet</h2>
          <p className="mb-8 max-w-xs text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            Fire up your first project and start building something awesome.
          </p>
        </div>
      )}

      {/* ── No search results ─────────────────────────────────────────── */}
      {!isLoading && !isError && allProjects.length > 0 && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-sm text-neutral-500">
            No projects match{" "}
            {search && <span style={{ color: "var(--text-primary)" }}>&ldquo;{search}&rdquo;</span>}
            {search && " · "}
            <button onClick={() => { setSearch(""); setFilter("all"); }} className="text-orange-400 underline-offset-2 hover:underline">
              Clear filters
            </button>
          </p>
        </div>
      )}

      {/* ── Pinned section ─────────────────────────────────────────────── */}
      {!isLoading && pinned.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-amber-400 text-xs">★</span>
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-secondary)" }}>Pinned</h2>
            <div className="h-px flex-1" style={{ background: "var(--border-subtle)" }} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pinned.map((p) => (
              <ProjectCard key={p.id} project={p} onUpdated={invalidate} onDeleted={invalidate} activeTunnel={tunnelByProject.get(p.id)} lastBackupAt={latestBackups[p.id]} onKillTunnel={handleKillTunnel} />
            ))}
          </div>
        </section>
      )}

      {/* ── Main grid ──────────────────────────────────────────────────── */}
      {!isLoading && rest.length > 0 && (
        <section>
          {pinned.length > 0 && (
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-secondary)" }}>
                {filter === "all" ? "All projects" : FILTERS.find(f => f.value === filter)?.label}
              </h2>
              <div className="h-px flex-1" style={{ background: "var(--border-subtle)" }} />
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((p) => (
              <ProjectCard key={p.id} project={p} onUpdated={invalidate} onDeleted={invalidate} activeTunnel={tunnelByProject.get(p.id)} lastBackupAt={latestBackups[p.id]} onKillTunnel={handleKillTunnel} />
            ))}
          </div>
        </section>
      )}

      {/* ── Widgets below projects ─────────────────────────────────────── */}
      {!isLoading && !isError && allProjects.length > 0 && (
        <div className="mt-10 space-y-5">
          <WeeklyWrappedBanner />
          <ActivityHeatmap />
          <AIUsageWidget />
        </div>
      )}
    </>
  );
}

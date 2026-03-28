"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { updateProject, deleteProject, updateProjectTags, exportProject, getProjectTasks, updateTask, startBackup, type Project } from "@/lib/api";
import BackupToast from "@/components/backup-toast";

const STATUS_LABELS: Record<Project["status"], string> = {
  idea: "Idea",
  active: "Active",
  paused: "Paused",
  maintenance: "Maintenance",
  done: "Done",
  graveyard: "Graveyard",
};

const STATUS_DOT: Record<Project["status"], string> = {
  idea: "#38bdf8",
  active: "#34d399",
  paused: "#fbbf24",
  maintenance: "#fb923c",
  done: "#71717a",
  graveyard: "#f87171",
};

const ALL_STATUSES = Object.keys(STATUS_LABELS) as Project["status"][];

const DEVICONS = [
  "python", "javascript", "typescript", "react", "nextjs", "nodejs", "docker", "kubernetes",
  "postgresql", "mongodb", "redis", "go", "rust", "java", "cplusplus", "csharp", "ruby", "php",
  "swift", "kotlin", "flutter", "vuejs", "angularjs", "svelte", "tailwindcss", "graphql",
  "git", "github", "linux", "ubuntu", "bash", "nginx", "amazonwebservices", "googlecloud",
  "terraform", "vscode", "sqlite",
] as const;

function deviconCandidates(name: string) {
  return `/devicons/${name}.svg`;
}

function gitIconStyle(iconName: string, isDarkTheme: boolean) {
  if (iconName !== "git" && iconName !== "github") return undefined;
  return {
    filter: isDarkTheme ? "brightness(0) invert(1)" : "brightness(0)",
  };
}

const CARD_COLORS = [
  { hex: "#f97316", name: "Orange" },
  { hex: "#ef4444", name: "Red" },
  { hex: "#ec4899", name: "Pink" },
  { hex: "#f43f5e", name: "Rose" },
  { hex: "#a855f7", name: "Purple" },
  { hex: "#6366f1", name: "Indigo" },
  { hex: "#3b82f6", name: "Blue" },
  { hex: "#06b6d4", name: "Cyan" },
  { hex: "#14b8a6", name: "Teal" },
  { hex: "#22c55e", name: "Green" },
  { hex: "#eab308", name: "Yellow" },
  { hex: "#a3a3a3", name: "Gray" },
];

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const parsed = parseApiUtcDate(dateStr);
  if (!parsed) return "";
  const diff = Date.now() - parsed.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function parseApiUtcDate(dateStr: string): Date | null {
  const value = dateStr.trim();
  if (!value) return null;

  const isoLike = value.includes('T') ? value : value.replace(' ', 'T');
  const withTimezone = /[zZ]|[+\-]\d{2}:?\d{2}$/.test(isoLike) ? isoLike : `${isoLike}Z`;
  const parsed = new Date(withTimezone);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatIstDateTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const parsed = parseApiUtcDate(dateStr);
  if (!parsed) return "";

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
    hour12: true,
  }).format(parsed);
}

type SubmenuSide = "left" | "right";

function getBestSubmenuSide(trigger: HTMLElement, submenuWidth: number): SubmenuSide {
  const rect = trigger.getBoundingClientRect();
  const gap = 10;
  const leftSpace = rect.left;
  const rightSpace = window.innerWidth - rect.right;

  const fitsLeft = leftSpace >= submenuWidth + gap;
  const fitsRight = rightSpace >= submenuWidth + gap;

  if (fitsLeft && fitsRight) return rightSpace >= leftSpace ? "right" : "left";
  if (fitsRight) return "right";
  if (fitsLeft) return "left";
  return rightSpace >= leftSpace ? "right" : "left";
}

interface Props {
  project: Project;
  onUpdated: () => void;
  onDeleted: () => void;
  lastBackupAt?: string | null;
}

function deadlineMeta(targetDate: string | null | undefined) {
  if (!targetDate) return null;
  const date = new Date(`${targetDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.ceil((date.getTime() - today.getTime()) / 86_400_000);

  if (diffDays < 0) return { label: `${Math.abs(diffDays)}d overdue`, color: "#ef4444" };
  if (diffDays === 0) return { label: "Due today", color: "#f97316" };
  return { label: `${diffDays}d left`, color: diffDays <= 3 ? "#f97316" : "#38bdf8" };
}

export default function ProjectCard({ project: p, onUpdated, onDeleted, lastBackupAt }: Props) {
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const isDarkTheme = resolvedTheme !== "light";
  const [showActions, setShowActions] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showColorMenu, setShowColorMenu] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [statusMenuSide, setStatusMenuSide] = useState<SubmenuSide>("left");
  const [colorMenuSide, setColorMenuSide] = useState<SubmenuSide>("left");
  const [tagMenuSide, setTagMenuSide] = useState<SubmenuSide>("left");
  const [isDownloading, setIsDownloading] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupJobId, setBackupJobId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { data: taskRows = [] } = useQuery({
    queryKey: ["project-tasks", p.slug],
    queryFn: async () => {
      const res = await getProjectTasks(p.slug);
      return res.ok ? res.data : [];
    },
  });

  const openTasks = taskRows.filter((task) => task.status !== "done").slice(0, 3);
  const deadline = deadlineMeta(p.target_date ?? null);

  const taskDoneMutation = useMutation({
    mutationFn: (taskId: string) => updateTask(taskId, { status: "done" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project-tasks", p.slug] });
    },
  });

  // Parse tags from JSON string
  const currentTags: string[] = (() => {
    try { return JSON.parse(p.tags ?? "[]"); } catch { return []; }
  })();

  const pinMutation = useMutation({
    mutationFn: () => updateProject(p.id, { pinned: !p.pinned }),
    onSuccess: onUpdated,
  });

  const statusMutation = useMutation({
    mutationFn: (status: Project["status"]) => updateProject(p.id, { status }),
    onSuccess: () => { setShowActions(false); onUpdated(); },
  });

  const colorMutation = useMutation({
    mutationFn: (color: string) => updateProject(p.id, { color }),
    onSuccess: () => { setShowActions(false); onUpdated(); },
  });

  const tagsMutation = useMutation({
    mutationFn: (tags: string[]) => updateProjectTags(p.id, tags),
    onSuccess: onUpdated,
  });

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      await exportProject(p.id, `${p.slug}.zip`);
    } finally {
      setIsDownloading(false);
      setShowActions(false);
    }
  };

  const toggleTag = (icon: string) => {
    const next = currentTags.includes(icon)
      ? currentTags.filter((t) => t !== icon)
      : [...currentTags, icon].slice(0, 8);
    tagsMutation.mutate(next);
  };

  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(p.id),
    onSuccess: onDeleted,
  });

  const color = p.color ?? "#f97316";
  const lastOpened = formatRelativeTime(p.last_opened_at);
  const lastOpenedIst = formatIstDateTime(p.last_opened_at);
  const statusColor = STATUS_DOT[p.status];
  const menuBackground = isDarkTheme ? "#1a1a1f" : "#ffffff";
  const menuBorder = "var(--border-subtle)";
  const menuDivider = "var(--border-subtle)";
  const menuItemClass = isDarkTheme
    ? "flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-neutral-500 transition-colors hover:bg-white/[0.05] hover:text-white"
    : "flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-zinc-600 transition-colors hover:bg-black/[0.05] hover:text-zinc-900";
  const menuItemRowClass = isDarkTheme
    ? "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs text-neutral-500 transition-colors hover:bg-white/[0.05] hover:text-white"
    : "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs text-zinc-600 transition-colors hover:bg-black/[0.05] hover:text-zinc-900";

  const openStatusMenu = (trigger: HTMLElement) => {
    setStatusMenuSide(getBestSubmenuSide(trigger, 176));
    setShowStatusMenu(true);
    setShowColorMenu(false);
    setShowTagPicker(false);
  };

  const openColorMenu = (trigger: HTMLElement) => {
    setColorMenuSide(getBestSubmenuSide(trigger, 168));
    setShowColorMenu(true);
    setShowStatusMenu(false);
    setShowTagPicker(false);
  };

  const openTagMenu = (trigger: HTMLElement) => {
    setTagMenuSide(getBestSubmenuSide(trigger, 236));
    setShowTagPicker(true);
    setShowStatusMenu(false);
    setShowColorMenu(false);
  };

  return (
    <div
      className={`project-card group relative flex flex-col rounded-2xl border ${showActions ? "z-[60] isolate" : "z-0"}`}
      style={{
        borderColor: "var(--border-subtle)",
        background: isDarkTheme
          ? `linear-gradient(135deg, ${color}08 0%, #0d0d0f 40%, #0d0d0f 100%)`
          : `linear-gradient(135deg, ${color}0a 0%, var(--bg-elevated) 40%)`,
        // @ts-expect-error CSS variable
        "--card-glow-color": color + "33",
      }}
    >
      {/* Decorative layer clipped to card radius */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
        <div
          className="absolute inset-x-0 top-0 h-[2px]"
          style={{ background: `linear-gradient(90deg, ${color} 0%, ${color}88 30%, transparent 60%)` }}
        />
      </div>

      {/* Card content */}
      <div className="relative flex flex-1 flex-col p-4">

        {/* Row 1: Name + actions */}
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-snug" style={{ color: "var(--text-primary)" }}>{p.name}</h3>

          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); pinMutation.mutate(); }}
              title={p.pinned ? "Unpin" : "Pin"}
              className={`z-10 rounded-lg p-1.5 text-[11px] transition-all hover:scale-110 ${
                p.pinned ? "text-amber-400" : "opacity-0 group-hover:opacity-100 text-neutral-600 hover:text-neutral-400"
              }`}
            >
              ★
            </button>

            {/* Actions menu */}
            <div className="relative z-20">
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowActions((v) => !v); setShowStatusMenu(false); setShowColorMenu(false); setShowTagPicker(false); }}
                className="rounded-lg p-1.5 text-sm leading-none opacity-0 group-hover:opacity-100 transition-all text-neutral-600 hover:text-neutral-300"
              >
                ⋯
              </button>

              {showActions && (
                <>
                  <div className="fixed inset-0 z-40 bg-transparent" onClick={() => { setShowActions(false); setShowStatusMenu(false); setShowColorMenu(false); setShowTagPicker(false); }} />
                  <div
                    className="absolute right-0 top-7 z-50 min-w-[165px] rounded-xl border shadow-2xl"
                    style={{ background: menuBackground, borderColor: menuBorder }}
                  >
                    <div className="p-1">
                      <a
                        href={`/open/${p.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className={menuItemClass}
                        onClick={() => setShowActions(false)}
                      >
                        <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        Open in editor
                      </a>

                      {/* Status submenu */}
                      <div className="relative" onMouseLeave={() => setShowStatusMenu(false)}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (showStatusMenu) {
                              setShowStatusMenu(false);
                            } else {
                              openStatusMenu(e.currentTarget);
                            }
                          }}
                          onMouseEnter={(e) => openStatusMenu(e.currentTarget)}
                          className={menuItemRowClass}
                        >
                          <span className="flex items-center gap-2.5">
                            <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 014-4z" />
                            </svg>
                            Change status
                          </span>
                          <svg className="h-3 w-3" style={{ color: "var(--text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                        {showStatusMenu && (
                          <div
                            className={`absolute top-0 w-40 overflow-hidden rounded-xl border p-1 shadow-2xl ${statusMenuSide === "left" ? "right-full mr-1" : "left-full ml-1"}`}
                            style={{ background: menuBackground, borderColor: menuBorder }}
                          >
                            {ALL_STATUSES.map((s) => (
                              <button
                                key={s}
                                onClick={() => statusMutation.mutate(s)}
                                disabled={p.status === s}
                                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors disabled:cursor-default"
                                style={{
                                  color: p.status === s ? STATUS_DOT[s] : (isDarkTheme ? "#737373" : "var(--text-secondary)"),
                                  background: p.status === s ? STATUS_DOT[s] + "14" : "transparent",
                                }}
                                onMouseEnter={(e) => { if (p.status !== s) (e.currentTarget as HTMLButtonElement).style.background = isDarkTheme ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"; }}
                                onMouseLeave={(e) => { if (p.status !== s) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                              >
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATUS_DOT[s] }} />
                                {STATUS_LABELS[s]}
                                {p.status === s && <span className="ml-auto text-[10px]">✓</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="h-px" style={{ background: menuDivider }} />

                    {/* Color submenu */}
                    <div className="relative p-1" onMouseLeave={() => setShowColorMenu(false)}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (showColorMenu) {
                            setShowColorMenu(false);
                          } else {
                            openColorMenu(e.currentTarget);
                          }
                        }}
                        onMouseEnter={(e) => openColorMenu(e.currentTarget)}
                        className={menuItemRowClass}
                      >
                        <span className="flex items-center gap-2.5">
                          <span className="h-3 w-3 shrink-0 rounded-full border border-white/20" style={{ background: color }} />
                          Change color
                        </span>
                        <svg className="h-3 w-3" style={{ color: "var(--text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                      {showColorMenu && (
                        <div
                          className={`absolute top-0 rounded-xl border p-3 shadow-2xl ${colorMenuSide === "left" ? "right-full mr-1" : "left-full ml-1"}`}
                          style={{ background: menuBackground, borderColor: menuBorder, width: "152px" }}
                        >
                          <div className="grid grid-cols-4 gap-2">
                            {CARD_COLORS.map(({ hex, name: n }) => (
                              <button
                                key={hex}
                                title={n}
                                onClick={() => colorMutation.mutate(hex)}
                                className="h-7 w-7 rounded-full transition-all duration-150 hover:scale-110"
                                style={{
                                  background: hex,
                                  boxShadow: p.color === hex
                                    ? `0 0 0 2px ${menuBackground}, 0 0 0 3.5px ${hex}, 0 0 10px ${hex}88`
                                    : "none",
                                  transform: p.color === hex ? "scale(1.15)" : undefined,
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="h-px" style={{ background: menuDivider }} />

                    {/* Tag picker */}
                    <div className="relative p-1" onMouseLeave={() => setShowTagPicker(false)}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (showTagPicker) {
                            setShowTagPicker(false);
                          } else {
                            openTagMenu(e.currentTarget);
                          }
                        }}
                        onMouseEnter={(e) => openTagMenu(e.currentTarget)}
                        className={menuItemRowClass}
                      >
                        <span className="flex items-center gap-2.5">
                          <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                          </svg>
                          Tech stack
                        </span>
                        <svg className="h-3 w-3" style={{ color: "var(--text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                      {showTagPicker && (
                        <div
                          className={`absolute top-0 rounded-xl border p-3 shadow-2xl ${tagMenuSide === "left" ? "right-full mr-1" : "left-full ml-1"}`}
                          style={{ background: menuBackground, borderColor: menuBorder, width: "220px" }}
                        >
                          <p className="mb-2 text-[10px]" style={{ color: "var(--text-muted)" }}>Click to toggle. Up to 8 icons.</p>
                          <div className="grid grid-cols-7 gap-1.5">
                            {DEVICONS.map((icon) => {
                              const active = currentTags.includes(icon);
                              return (
                                <button
                                  key={icon}
                                  title={icon}
                                  onClick={() => toggleTag(icon)}
                                  className="rounded-lg p-1 transition-all duration-150 hover:scale-110"
                                  style={{ background: active ? "rgba(249,115,22,0.2)" : "transparent", outline: active ? "1px solid rgba(249,115,22,0.5)" : "none" }}
                                >
                                  <img
                                    src={deviconCandidates(icon)}
                                    alt={icon}
                                    width={20}
                                    height={20}
                                    className="h-5 w-5"
                                    style={gitIconStyle(icon, isDarkTheme)}
                                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.3"; }}
                                  />
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="h-px" style={{ background: menuDivider }} />

                    {/* Download ZIP */}
                    <div className="p-1">
                      <button
                        onClick={handleDownload}
                        disabled={isDownloading}
                        className={`${menuItemClass} w-full text-left disabled:cursor-default disabled:opacity-60`}
                      >
                        <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        {isDownloading ? "Preparing…" : "Download .zip"}
                      </button>
                    </div>

                    {/* Backup */}
                    <div className="p-1">
                      <button
                        onClick={async () => {
                          setIsBackingUp(true);
                          try {
                            const res = await startBackup(p.slug);
                            if (res.ok) {
                              setBackupJobId(res.data.jobId);
                            }
                          } finally {
                            setIsBackingUp(false);
                            setShowActions(false);
                          }
                        }}
                        disabled={isBackingUp || !!backupJobId}
                        className={`${menuItemClass} w-full text-left disabled:cursor-default disabled:opacity-60`}
                      >
                        <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        {isBackingUp ? "Queuing…" : backupJobId ? "Backing up…" : "Backup Now"}
                      </button>
                    </div>

                    <div className="h-px" style={{ background: menuDivider }} />

                    <div className="p-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowActions(false);
                          setShowDeleteConfirm(true);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs text-red-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                      >
                        <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete project
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Slug */}
        <p className="mb-3 truncate font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>{p.slug}</p>

        {/* Description */}
        {p.description && (
          <p className="mb-3 line-clamp-2 text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {p.description}
          </p>
        )}

        {/* Tech stack icons */}
        {currentTags.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {currentTags.map((tag) => (
              <img
                key={tag}
                src={deviconCandidates(tag)}
                alt={tag}
                title={tag}
                width={20}
                height={20}
                className="h-5 w-5 opacity-80 transition-opacity hover:opacity-100"
                style={gitIconStyle(tag, isDarkTheme)}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            ))}
          </div>
        )}

        {/* Milestone + Deadline row */}
        {(p.milestone_name || deadline) && (
          <div className="mb-3 flex items-center gap-1.5 text-[10px]">
            {p.milestone_name && (
              <span
                className="rounded-full px-2 py-0.5"
                style={{ background: "rgba(249,115,22,0.1)", color: "#fb923c", border: "1px solid rgba(249,115,22,0.25)" }}
              >
                🎯 {p.milestone_name}
              </span>
            )}
            {deadline && (
              <span
                className="rounded-full px-2 py-0.5"
                style={{ background: `${deadline.color}15`, color: deadline.color, border: `1px solid ${deadline.color}30` }}
              >
                {deadline.label}
              </span>
            )}
          </div>
        )}

        {/* Tasks */}
        {openTasks.length > 0 && (
          <div className="relative z-10 mb-3 space-y-1">
            {openTasks.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!taskDoneMutation.isPending) taskDoneMutation.mutate(task.id);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] transition-colors hover:bg-white/[0.04]"
                style={{ color: "var(--text-secondary)" }}
                title="Mark as done"
              >
                <span
                  className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border"
                  style={{ borderColor: (task.status === "doing" ? "#fbbf24" : "#38bdf8") + "50" }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: task.status === "doing" ? "#fbbf24" : "#38bdf8" }} />
                </span>
                <span className="truncate">{task.title}</span>
              </button>
            ))}
          </div>
        )}

        {/* Spacer to push footer down */}
        <div className="flex-1" />

        {/* Quick navigation */}
        {(
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <a
              href={`/projects/${p.slug}`}
              className="relative z-10 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all hover:brightness-110"
              style={{ background: color + "18", color: color, border: `1px solid ${color}30` }}
              onClick={(e) => e.stopPropagation()}
            >
              <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Tasks
              <svg className="h-3 w-3 shrink-0 -rotate-45" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </a>
          </div>
        )}

        {/* Footer with meta */}
        <div className="flex items-center gap-3 text-[10px]" style={{ color: "var(--text-muted)" }}>
          {/* Status */}
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{
              background: statusColor + "12",
              color: statusColor,
            }}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: statusColor }} />
            {STATUS_LABELS[p.status]}
          </span>

          {lastBackupAt && (
            <>
              <span className="h-3 w-px" style={{ background: "var(--border-subtle)" }} />
              <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
                ☁ {formatRelativeTime(lastBackupAt)}
              </span>
            </>
          )}

          {/* Push remaining items right */}
          <div className="flex-1" />

          {lastOpened && (
            <span title={lastOpenedIst ? `Last opened (IST): ${lastOpenedIst}` : "Last opened"}>
              {lastOpened}
            </span>
          )}
          <span>{(p.fileCount ?? 0).toLocaleString()} files</span>
        </div>
      </div>

      {/* Full-card link */}
      <a
        href={`/open/${p.id}`}
        target="_blank"
        rel="noreferrer"
        className="absolute inset-0 rounded-2xl"
        tabIndex={-1}
        aria-hidden
      />

      {backupJobId && (
        <BackupToast
          jobId={backupJobId}
          projectName={p.name}
          onClose={() => setBackupJobId(null)}
        />
      )}

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(false); }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative z-10 w-full max-w-sm rounded-2xl border p-6 shadow-2xl"
            style={{
              background: isDarkTheme ? "#1a1a1f" : "#ffffff",
              borderColor: isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.1)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ background: "rgba(239,68,68,0.1)" }}
              >
                <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div>
                <h3
                  className="text-sm font-semibold"
                  style={{ color: isDarkTheme ? "#ffffff" : "#18181b" }}
                >
                  Delete project
                </h3>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  This action cannot be undone
                </p>
              </div>
            </div>

            <p
              className="mb-5 text-sm leading-relaxed"
              style={{ color: isDarkTheme ? "#a1a1aa" : "#52525b" }}
            >
              Are you sure you want to delete{" "}
              <span className="font-semibold" style={{ color: isDarkTheme ? "#ffffff" : "#18181b" }}>
                &ldquo;{p.name}&rdquo;
              </span>
              ? All project files will be permanently removed.
            </p>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(false); }}
                className="rounded-lg px-4 py-2 text-xs font-medium transition-colors"
                style={{
                  color: isDarkTheme ? "#a1a1aa" : "#52525b",
                  background: isDarkTheme ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)",
                }}
              >
                Cancel
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDeleteConfirm(false);
                  deleteMutation.mutate();
                }}
                disabled={deleteMutation.isPending}
                className="rounded-lg px-4 py-2 text-xs font-medium text-white transition-colors hover:brightness-110 disabled:opacity-50"
                style={{ background: "#ef4444" }}
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  cancelJob,
  createProject,
  enqueueCloneProject,
  enqueueScaffoldProject,
  getGithubBranches,
  getGithubRepos,
  type GithubRepo,
  type Project,
} from "@/lib/api";

const COLORS = [
  { hex: "#f97316", name: "Orange" },
  { hex: "#ef4444", name: "Red" },
  { hex: "#ec4899", name: "Pink" },
  { hex: "#a855f7", name: "Purple" },
  { hex: "#6366f1", name: "Indigo" },
  { hex: "#3b82f6", name: "Blue" },
  { hex: "#06b6d4", name: "Cyan" },
  { hex: "#14b8a6", name: "Teal" },
  { hex: "#22c55e", name: "Green" },
  { hex: "#eab308", name: "Yellow" },
  { hex: "#f43f5e", name: "Rose" },
  { hex: "#a3a3a3", name: "Gray" },
];

const STATUSES: { value: Project["status"]; label: string; color: string }[] = [
  { value: "idea",        label: "Idea",         color: "text-sky-400" },
  { value: "active",      label: "Active",        color: "text-emerald-400" },
  { value: "paused",      label: "Paused",        color: "text-amber-400" },
  { value: "maintenance", label: "Maintenance",   color: "text-orange-400" },
  { value: "done",        label: "Done",          color: "text-neutral-400" },
  { value: "graveyard",   label: "Graveyard",     color: "text-red-400" },
];

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

type NewMode = "empty" | "clone" | "template";

const TEMPLATES = [
  { value: "nextjs", label: "Next.js + Tailwind" },
  { value: "express", label: "Express API" },
  { value: "python", label: "Python Script" },
  { value: "vite-react", label: "React (Vite)" },
  { value: "go", label: "Go Module" },
  { value: "node-ts", label: "Node + TypeScript" },
] as const;

export default function NewProjectModal({ onClose, onCreated }: Props) {
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme !== "light";
  const [mode, setMode] = useState<NewMode>("empty");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(COLORS[0].hex);
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [selectedRepoId, setSelectedRepoId] = useState("");
  const [repoSearch, setRepoSearch] = useState("");
  const [showRepoDropdown, setShowRepoDropdown] = useState(false);
  const [branchLookupUrl, setBranchLookupUrl] = useState("");
  const [template, setTemplate] = useState<(typeof TEMPLATES)[number]["value"]>("nextjs");
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<"queued" | "running" | "completed" | "failed" | "cancelled" | null>(null);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const repoDropdownRef = useRef<HTMLDivElement | null>(null);

  const closeStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  };

  useEffect(() => () => closeStream(), []);

  useEffect(() => {
    if (!showRepoDropdown) return;

    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (repoDropdownRef.current && !repoDropdownRef.current.contains(target)) {
        setShowRepoDropdown(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowRepoDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showRepoDropdown]);

  const {
    data: githubRepos = [],
    isLoading: githubReposLoading,
  } = useQuery({
    queryKey: ["github-repos"],
    queryFn: async () => {
      const res = await getGithubRepos();
      return res.ok ? res.data : [];
    },
    enabled: mode === "clone",
  });

  useEffect(() => {
    if (mode !== "clone") {
      setBranchLookupUrl("");
      return;
    }

    const nextUrl = repoUrl.trim();
    if (!nextUrl) {
      setBranchLookupUrl("");
      return;
    }

    const timer = window.setTimeout(() => {
      setBranchLookupUrl(nextUrl);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [mode, repoUrl]);

  const { data: githubBranchesData, isFetching: branchesFetching } = useQuery({
    queryKey: ["github-branches", branchLookupUrl],
    queryFn: async () => {
      const res = await getGithubBranches(branchLookupUrl);
      return res.ok ? res.data : null;
    },
    enabled: mode === "clone" && branchLookupUrl.length > 0,
  });

  useEffect(() => {
    if (mode !== "clone") return;
    if (!githubBranchesData) return;
    if (!branch.trim() && githubBranchesData.defaultBranch) {
      setBranch(githubBranchesData.defaultBranch);
    }
  }, [mode, githubBranchesData, branch]);

  const handleRepoSelect = (repoId: string) => {
    setSelectedRepoId(repoId);
    setShowRepoDropdown(false);
    const repo = githubRepos.find((item) => String(item.id) === repoId);
    if (!repo) return;
    setRepoUrl(repo.cloneUrl);
    if (!branch.trim()) setBranch(repo.defaultBranch || "");
    if (!name.trim()) {
      const displayName = repo.name.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      setName(displayName);
    }
  };

  const filteredGithubRepos = githubRepos.filter((repo) => {
    const query = repoSearch.trim().toLowerCase();
    if (!query) return true;
    return (
      repo.fullName.toLowerCase().includes(query) ||
      repo.name.toLowerCase().includes(query)
    );
  });
  const availableBranches = githubBranchesData?.branches ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      createProject({ name: name.trim(), description: description.trim(), color }),
    onSuccess: onCreated,
    onError: (err) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode !== "clone" && !name.trim()) { setError("Name is required"); return; }
    if (mode === "clone" && !repoUrl.trim()) { setError("Repository URL is required"); return; }
    setError(null);

    if (mode === "empty") {
      mutation.mutate();
      return;
    }

    setIsSubmitting(true);
    setLogs([]);
    setProgress(0);

    const enqueue = mode === "clone"
      ? enqueueCloneProject({
          repoUrl: repoUrl.trim(),
          name: name.trim() || undefined,
          description: description.trim() || undefined,
          color,
          branch: branch.trim() || undefined,
        })
      : enqueueScaffoldProject({
          template,
          name: name.trim(),
          description: description.trim() || undefined,
          color,
        });

    enqueue
      .then((res) => {
        if (!res.ok) throw new Error(res.error.message || "Failed to enqueue job");
        setJobId(res.data.jobId);
        setJobStatus("queued");

        closeStream();
        const stream = new EventSource(`/api/jobs/${res.data.jobId}/stream`);
        eventSourceRef.current = stream;

        stream.addEventListener("log", (evt) => {
          try {
            const parsed = JSON.parse((evt as MessageEvent).data) as { message?: string };
            const message = parsed?.message;
            if (typeof message === "string" && message.length > 0) {
              setLogs((prev) => [...prev.slice(-199), message]);
            }
          } catch {}
        });

        stream.addEventListener("job", (evt) => {
          try {
            const parsed = JSON.parse((evt as MessageEvent).data) as {
              status?: "queued" | "running" | "completed" | "failed" | "cancelled";
              progress?: number;
              error?: { message?: string } | null;
            };
            if (parsed.status) setJobStatus(parsed.status);
            if (typeof parsed.progress === "number") setProgress(Math.max(0, Math.min(100, parsed.progress)));
            if (parsed.status === "failed" || parsed.status === "cancelled") {
              setError(parsed.error?.message || `Job ${parsed.status}`);
              setIsSubmitting(false);
            }
            if (parsed.status === "completed") {
              setIsSubmitting(false);
              closeStream();
              onCreated();
            }
          } catch {}
        });

        stream.addEventListener("done", () => {
          setIsSubmitting(false);
          closeStream();
        });

        stream.onerror = () => {
          setIsSubmitting(false);
          closeStream();
        };
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setIsSubmitting(false);
      });
  };

  const handleCancelJob = async () => {
    if (!jobId) return;
    await cancelJob(jobId);
  };

  const busy = mutation.isPending || isSubmitting;
  const selectedRepo = githubRepos.find((repo) => String(repo.id) === selectedRepoId);
  const modalBg = isDarkTheme ? "#0e0e10" : "var(--bg-elevated)";
  const fieldBg = isDarkTheme ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)";
  const fieldBgFocus = isDarkTheme ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";
  const inputClass = isDarkTheme
    ? "w-full rounded-xl border border-white/[0.07] bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder-neutral-700 outline-none transition-all focus:border-orange-500/50 focus:bg-white/[0.06] focus:ring-1 focus:ring-orange-500/30"
    : "w-full rounded-xl border px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-500 outline-none transition-all focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30";
  const panelBorder = "var(--border-subtle)";

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-30 bg-black/75 backdrop-blur-md" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
        <div
          className="animate-scale-in w-full max-w-md overflow-hidden rounded-2xl border shadow-2xl"
          style={{ background: modalBg, borderColor: panelBorder }}
        >
          {/* Gradient header */}
          <div
            className="relative overflow-hidden px-6 pb-5 pt-6"
            style={{ background: `linear-gradient(135deg, ${color}26 0%, ${color}14 50%, rgba(14,14,16,0) 100%)` }}
          >
            {/* Top accent line */}
            <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, ${color}cc, ${color}66, transparent)` }} />
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>New project</h2>
                <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>Set up your new workspace</p>
              </div>
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
                style={{ color: "var(--text-muted)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = fieldBg;
                  e.currentTarget.style.color = "var(--text-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Mode tabs */}
            <div className="grid grid-cols-3 gap-2 rounded-xl border p-1" style={{ borderColor: panelBorder }}>
              {([
                ["empty", "Empty"],
                ["clone", "Clone Git"],
                ["template", "Template"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
                  style={{
                    background: mode === value ? "rgba(249,115,22,0.18)" : "transparent",
                    color: mode === value ? "#fb923c" : "var(--text-muted)",
                    border: mode === value ? "1px solid rgba(249,115,22,0.45)" : "1px solid transparent",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Name */}
            <div style={{ display: mode === "clone" ? "none" : "block" }}>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                Project name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My awesome project"
                autoFocus
                maxLength={100}
                className={inputClass}
                style={{ borderColor: panelBorder, background: fieldBg }}
                onFocus={(e) => (e.currentTarget.style.background = fieldBgFocus)}
                onBlur={(e) => (e.currentTarget.style.background = fieldBg)}
              />
            </div>

            {/* Clone fields */}
            {mode === "clone" && (
              <>
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Your GitHub repos</label>
                  <div className="relative" ref={repoDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setShowRepoDropdown((v) => !v)}
                      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm outline-none transition-all focus:ring-1 focus:ring-orange-500/30 ${isDarkTheme ? "text-white" : "text-zinc-900"}`}
                      style={{ borderColor: panelBorder, background: fieldBg }}
                    >
                      <span className="truncate">
                        {selectedRepo
                          ? `${selectedRepo.fullName}${selectedRepo.private ? " (private)" : ""}`
                          : "Select a repository (optional)"}
                      </span>
                      <svg className="ml-2 h-4 w-4 shrink-0" style={{ color: "var(--text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {showRepoDropdown && (
                      <div className="absolute z-20 mt-2 w-full rounded-xl border p-2 shadow-2xl" style={{ borderColor: panelBorder, background: modalBg }}>
                        <input
                          type="text"
                          value={repoSearch}
                          onChange={(e) => setRepoSearch(e.target.value)}
                          placeholder="Search repositories..."
                          className={`mb-2 w-full rounded-lg border px-3 py-2 text-sm outline-none transition-all focus:ring-1 focus:ring-orange-500/30 ${isDarkTheme ? "text-white placeholder-neutral-700" : "text-zinc-900 placeholder-zinc-500"}`}
                          style={{ borderColor: panelBorder, background: fieldBg }}
                        />

                        <div className="max-h-52 overflow-auto rounded-lg border" style={{ borderColor: panelBorder, background: fieldBg }}>
                          {githubReposLoading ? (
                            <div className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>Loading repositories...</div>
                          ) : filteredGithubRepos.length === 0 ? (
                            <div className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>No matching repositories</div>
                          ) : (
                            filteredGithubRepos.map((repo: GithubRepo) => (
                              <button
                                key={repo.id}
                                type="button"
                                onClick={() => handleRepoSelect(String(repo.id))}
                                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors"
                                style={{ color: "var(--text-secondary)" }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = fieldBgFocus)}
                                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                              >
                                <span className="truncate">{repo.fullName}</span>
                                {repo.private && <span className="ml-2 shrink-0 text-[10px] text-amber-400">private</span>}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  {githubReposLoading ? (
                    <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>Fetching repositories...</p>
                  ) : githubRepos.length === 0 ? (
                    <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>No repositories found or GitHub is not connected.</p>
                  ) : null}
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    Repository URL <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="url"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    placeholder="https://github.com/user/repo.git"
                    className={inputClass}
                    style={{ borderColor: panelBorder, background: fieldBg }}
                    onFocus={(e) => (e.currentTarget.style.background = fieldBgFocus)}
                    onBlur={(e) => (e.currentTarget.style.background = fieldBg)}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Display name (optional)</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="My cloned project"
                      maxLength={100}
                      className={inputClass}
                      style={{ borderColor: panelBorder, background: fieldBg }}
                      onFocus={(e) => (e.currentTarget.style.background = fieldBgFocus)}
                      onBlur={(e) => (e.currentTarget.style.background = fieldBg)}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Branch (optional)</label>
                    <select
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-all focus:ring-1 focus:ring-orange-500/30 ${isDarkTheme ? "text-white" : "text-zinc-900"}`}
                      style={{ borderColor: panelBorder, background: fieldBg }}
                    >
                      <option value="" className={isDarkTheme ? "bg-[#0e0e10] text-white" : "bg-white text-zinc-900"}>
                        {branchesFetching ? "Fetching branches..." : availableBranches.length > 0 ? "Default branch" : "No branches detected"}
                      </option>
                      {availableBranches.map((branchName) => (
                        <option key={branchName} value={branchName} className={isDarkTheme ? "bg-[#0e0e10] text-white" : "bg-white text-zinc-900"}>
                          {branchName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}

            {/* Template picker */}
            {mode === "template" && (
              <div>
                <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Template</label>
                <select
                  value={template}
                  onChange={(e) => setTemplate(e.target.value as (typeof TEMPLATES)[number]["value"])}
                  className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-all focus:ring-1 focus:ring-orange-500/30 ${isDarkTheme ? "text-white" : "text-zinc-900"}`}
                  style={{ borderColor: panelBorder, background: fieldBg }}
                >
                  {TEMPLATES.map((t) => (
                    <option key={t.value} value={t.value} className={isDarkTheme ? "bg-[#0e0e10] text-white" : "bg-white text-zinc-900"}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Description */}
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                Description{" "}
                <span style={{ color: "var(--text-muted)" }}>(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What are you building?"
                rows={2}
                className={`w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none transition-all focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30 ${isDarkTheme ? "text-white placeholder-neutral-700" : "text-zinc-900 placeholder-zinc-500"}`}
                style={{ borderColor: panelBorder, background: fieldBg }}
                onFocus={(e) => (e.currentTarget.style.background = fieldBgFocus)}
                onBlur={(e) => (e.currentTarget.style.background = fieldBg)}
              />
            </div>

            {/* Color picker */}
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                Color
              </label>
              <div className="flex flex-wrap gap-2.5">
                {COLORS.map(({ hex, name: n }) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setColor(hex)}
                    title={n}
                    className="relative h-8 w-8 rounded-full transition-all duration-200 hover:scale-110"
                    style={{
                      backgroundColor: hex,
                      boxShadow: color === hex ? `0 0 0 2px ${modalBg}, 0 0 0 4px ${hex}, 0 0 16px ${hex}66` : "none",
                      transform: color === hex ? "scale(1.12)" : undefined,
                    }}
                  />
                ))}
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-900/50 bg-red-950/20 px-3.5 py-2.5">
                <svg className="h-3.5 w-3.5 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}

            {(busy || logs.length > 0 || jobStatus) && (
              <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: panelBorder, background: fieldBg }}>
                <div className="flex items-center justify-between text-xs">
                  <span style={{ color: "var(--text-secondary)" }}>{jobStatus ? `Job: ${jobStatus}` : "Queued"}</span>
                  <span style={{ color: "var(--text-muted)" }}>{progress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: isDarkTheme ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${progress}%`, background: "linear-gradient(90deg, #f97316, #ea580c)" }}
                  />
                </div>
                <div className="max-h-28 overflow-auto rounded-md border p-2 font-mono text-[11px]" style={{ borderColor: panelBorder, background: isDarkTheme ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.04)", color: "var(--text-secondary)" }}>
                  {logs.length === 0 ? "Waiting for logs…" : logs.map((line, i) => <div key={`${i}-${line.slice(0, 12)}`}>{line}</div>)}
                </div>
                {busy && jobId && (
                  <button
                    type="button"
                    onClick={handleCancelJob}
                    className="rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-950/35"
                  >
                    Cancel job
                  </button>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 border-t pt-5" style={{ borderColor: panelBorder }}>
              <button
                type="button"
                onClick={onClose}
                className={`rounded-xl border px-4 py-2 text-sm transition-colors ${isDarkTheme ? "text-neutral-400 hover:text-neutral-200" : "text-zinc-600 hover:text-zinc-900"}`}
                style={{ borderColor: panelBorder, background: fieldBg }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="group relative overflow-hidden rounded-xl px-5 py-2 text-sm font-medium text-white transition-all disabled:cursor-not-allowed disabled:opacity-40 active:scale-95"
                style={{ background: "linear-gradient(135deg, #ea580c, #c2410c)", boxShadow: "0 0 20px rgba(249,115,22,0.25)" }}
              >
                <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-500 group-hover:translate-x-full" />
                {busy ? (
                  <span className="flex items-center gap-2">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    {mode === "empty" ? "Creating…" : "Running…"}
                  </span>
                ) : mode === "clone" ? "Start clone" : mode === "template" ? "Start scaffold" : "Create project"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

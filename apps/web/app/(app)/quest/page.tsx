"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getWorkerLogs, getJob, cancelJob, type JobSnapshot, type JobLog } from "@/lib/api";

const TYPE_META: Record<string, { label: string; color: string; icon: string }> = {
  clone:        { label: "Clone",      color: "#3b82f6", icon: "⬇" },
  scaffold:     { label: "Scaffold",   color: "#8b5cf6", icon: "🏗" },
  "export-zip": { label: "Export",     color: "#f59e0b", icon: "📦" },
  backup:       { label: "Backup",     color: "#22c55e", icon: "☁" },
  "ai-agent":   { label: "AI Agent",   color: "#a855f7", icon: "✦" },
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  queued:    { label: "Queued",    color: "#6b7280", bg: "rgba(107,114,128,0.12)" },
  running:   { label: "Running",   color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  completed: { label: "Completed", color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  failed:    { label: "Failed",    color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  cancelled: { label: "Cancelled", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
};

function formatTime(dateStr: string) {
  const d = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z");
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDuration(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt || !finishedAt) return null;
  const start = new Date(startedAt.endsWith("Z") ? startedAt : startedAt + "Z").getTime();
  const end = new Date(finishedAt.endsWith("Z") ? finishedAt : finishedAt + "Z").getTime();
  const diff = Math.max(0, end - start);
  if (diff < 1000) return `${diff}ms`;
  if (diff < 60_000) return `${(diff / 1000).toFixed(1)}s`;
  return `${Math.floor(diff / 60_000)}m ${Math.round((diff % 60_000) / 1000)}s`;
}

// ── Expanded job detail with logs ──────────────────────────────────────────

function JobDetail({ job }: { job: JobSnapshot }) {
  const [logs, setLogs] = useState<JobLog[]>([]);
  const [loading, setLoading] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const isLive = job.status === "queued" || job.status === "running";

  useEffect(() => {
    if (isLive) {
      const stream = new EventSource(`/api/jobs/${job.id}/stream`);
      setLoading(false);

      stream.addEventListener("log", (evt) => {
        try {
          const parsed = JSON.parse((evt as MessageEvent).data) as JobLog;
          if (parsed.message) {
            setLogs((prev) => [...prev.slice(-199), parsed]);
          }
        } catch {}
      });

      stream.addEventListener("job", (evt) => {
        try {
          const parsed = JSON.parse((evt as MessageEvent).data);
          if (parsed.status === "completed" || parsed.status === "failed" || parsed.status === "cancelled") {
            stream.close();
            setTimeout(() => queryClient.invalidateQueries({ queryKey: ["worker-logs"] }), 2000);
          }
        } catch {}
      });

      stream.addEventListener("done", () => stream.close());
      stream.onerror = () => stream.close();

      return () => stream.close();
    } else {
      getJob(job.id).then((res) => {
        if (res.ok) setLogs(res.data.logs);
        setLoading(false);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, isLive]);

  useEffect(() => {
    if (isLive) logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, isLive]);

  const handleCancel = async () => {
    await cancelJob(job.id);
    queryClient.invalidateQueries({ queryKey: ["worker-logs"] });
  };

  const payload = job.payload as Record<string, unknown> | null;

  return (
    <div className="mt-3 space-y-3">
      {/* Job details row */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
        {job.startedAt && <span>Started: {formatTime(job.startedAt)}</span>}
        {job.finishedAt && <span>Finished: {formatTime(job.finishedAt)}</span>}
        {formatDuration(job.startedAt, job.finishedAt) && (
          <span>Duration: {formatDuration(job.startedAt, job.finishedAt)}</span>
        )}
        {payload?.projectSlug ? <span>Project: {String(payload.projectSlug)}</span> : null}
        {payload?.repoUrl ? <span className="truncate max-w-[200px]">Repo: {String(payload.repoUrl)}</span> : null}
        {payload?.instruction ? <span className="truncate max-w-[250px]">Task: {String(payload.instruction)}</span> : null}
      </div>

      {/* Cancel button for active jobs */}
      {isLive && (
        <button
          onClick={handleCancel}
          className="rounded-lg px-3 py-1 text-[11px] font-medium transition-colors"
          style={{ color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)" }}
        >
          Cancel Job
        </button>
      )}

      {/* Error message */}
      {job.error && (
        <div
          className="rounded-lg px-3 py-2 text-xs"
          style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}
        >
          <span className="font-semibold">{job.error.code}: </span>
          {job.error.message}
        </div>
      )}

      {/* Logs */}
      {loading ? (
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Loading logs…</p>
      ) : logs.length === 0 ? (
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>No logs recorded.</p>
      ) : (
        <div
          className="max-h-60 overflow-auto rounded-lg border p-3 font-mono text-[11px] leading-relaxed"
          style={{ borderColor: "var(--border-subtle)", background: "rgba(0,0,0,0.2)", color: "var(--text-muted)" }}
        >
          {logs.map((log, i) => (
            <div key={log.id ?? i} className="whitespace-pre-wrap break-words">
              <span
                className="mr-2 select-none"
                style={{
                  color: log.level === "error" ? "#ef4444" : log.level === "warn" ? "#f59e0b" : "rgba(255,255,255,0.2)",
                }}
              >
                {log.level === "error" ? "✗" : log.level === "warn" ? "⚠" : "›"}
              </span>
              <span style={{ color: log.level === "error" ? "#fca5a5" : log.level === "warn" ? "#fde68a" : "var(--text-secondary)" }}>
                {log.message}
              </span>
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function WorkerLogsPage() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["worker-logs"],
    queryFn: async () => {
      const res = await getWorkerLogs();
      return res.ok ? res.data : [];
    },
    refetchInterval: 10_000,
  });

  const activeCount = jobs.filter((j) => j.status === "queued" || j.status === "running").length;

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: "rgba(59,130,246,0.1)", color: "#3b82f6" }}
          >
            <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5A3.375 3.375 0 006.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0015 2.25h-1.5a2.251 2.251 0 00-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 00-9-9z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Worker Logs</h1>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Last 20 background jobs
              {activeCount > 0 && (
                <span
                  className="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{ background: "rgba(59,130,246,0.12)", color: "#3b82f6" }}
                >
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "#3b82f6" }} />
                  {activeCount} active
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-2 py-10" style={{ color: "var(--text-muted)" }}>
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span className="text-sm">Loading worker logs…</span>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && jobs.length === 0 && (
        <div
          className="flex flex-col items-center justify-center rounded-xl border py-16"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
        >
          <div
            className="mb-3 flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: "rgba(107,114,128,0.1)" }}
          >
            <svg className="h-6 w-6" style={{ color: "var(--text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>No worker logs yet</p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>Jobs will appear here as they run</p>
        </div>
      )}

      {/* Job list */}
      {!isLoading && jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map((job) => {
            const typeMeta = TYPE_META[job.type] ?? { label: job.type, color: "#6b7280", icon: "⚙" };
            const statusMeta = STATUS_META[job.status] ?? { label: job.status, color: "#6b7280", bg: "rgba(107,114,128,0.12)" };
            const isActive = job.status === "queued" || job.status === "running";
            const isExpanded = expanded === job.id;

            return (
              <div
                key={job.id}
                className="rounded-xl border transition-colors"
                style={{
                  borderColor: isActive ? `${typeMeta.color}30` : "var(--border-subtle)",
                  background: isActive ? `${typeMeta.color}04` : "var(--bg-card)",
                }}
              >
                {/* Job row — clickable */}
                <button
                  onClick={() => setExpanded(isExpanded ? null : job.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
                >
                  {/* Type icon */}
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm"
                    style={{ background: `${typeMeta.color}15`, color: typeMeta.color }}
                  >
                    {typeMeta.icon}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                        {typeMeta.label}
                      </span>
                      {isActive && (
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: typeMeta.color }} />
                      )}
                    </div>
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {formatTime(job.createdAt)}
                      {formatDuration(job.startedAt, job.finishedAt) && (
                        <span className="ml-2">· {formatDuration(job.startedAt, job.finishedAt)}</span>
                      )}
                    </span>
                  </div>

                  {/* Progress bar for active jobs */}
                  {isActive && (
                    <div className="hidden sm:flex items-center gap-2 shrink-0 w-24">
                      <div className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: `${typeMeta.color}20` }}>
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${job.progress}%`, background: typeMeta.color }}
                        />
                      </div>
                      <span className="text-[10px] tabular-nums font-medium" style={{ color: typeMeta.color }}>
                        {job.progress}%
                      </span>
                    </div>
                  )}

                  {/* Status badge */}
                  <span
                    className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
                    style={{ background: statusMeta.bg, color: statusMeta.color }}
                  >
                    {statusMeta.label}
                  </span>

                  {/* Expand chevron */}
                  <svg
                    className="h-4 w-4 shrink-0 transition-transform duration-200"
                    style={{
                      color: "var(--text-muted)",
                      transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                    }}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t px-4 pb-4 min-w-0 overflow-hidden" style={{ borderColor: "var(--border-subtle)" }}>
                    <JobDetail job={job} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer note */}
      {!isLoading && jobs.length > 0 && (
        <p className="mt-4 text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
          Only the 20 most recent jobs are kept. Older logs are automatically pruned.
        </p>
      )}
    </>
  );
}


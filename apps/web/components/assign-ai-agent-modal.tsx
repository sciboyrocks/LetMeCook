"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { assignToAIAgent, cancelJob, type Project } from "@/lib/api";

interface Props {
  open: boolean;
  project: Project;
  onClose: () => void;
}

type Phase = "input" | "running" | "done" | "error";

export default function AssignAIAgentModal({ open, project, onClose }: Props) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const router = useRouter();

  const [instruction, setInstruction] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const streamRef = useRef<EventSource | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    if (!open) {
      streamRef.current?.close();
      streamRef.current = null;
    }
    if (open && phase === "input") {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open, phase]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "running") handleClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phase]);

  const closeStream = () => {
    streamRef.current?.close();
    streamRef.current = null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = instruction.trim();
    if (!trimmed) return;

    setPhase("running");
    setProgress(0);
    setLogs([]);
    setErrorMsg(null);

    const res = await assignToAIAgent(project.slug, trimmed);
    if (!res.ok) {
      setErrorMsg(res.error.message || "Failed to start AI agent");
      setPhase("error");
      return;
    }

    const id = res.data.jobId;
    setJobId(id);

    closeStream();
    const stream = new EventSource(`/api/jobs/${id}/stream`);
    streamRef.current = stream;

    stream.addEventListener("log", (evt) => {
      try {
        const parsed = JSON.parse((evt as MessageEvent).data) as { message?: string };
        if (typeof parsed.message === "string" && parsed.message.length > 0) {
          setLogs((prev) => [...prev.slice(-499), parsed.message!]);
        }
      } catch {}
    });

    stream.addEventListener("job", (evt) => {
      try {
        const parsed = JSON.parse((evt as MessageEvent).data) as {
          status?: string;
          progress?: number;
          error?: { message?: string } | null;
        };
        if (typeof parsed.progress === "number") {
          setProgress(Math.max(0, Math.min(100, parsed.progress)));
        }
        if (parsed.status === "completed") {
          setPhase("done");
          setProgress(100);
          closeStream();
        } else if (parsed.status === "failed" || parsed.status === "cancelled") {
          setErrorMsg(parsed.error?.message || `Job ${parsed.status}`);
          setPhase("error");
          closeStream();
        }
      } catch {}
    });

    stream.addEventListener("done", () => closeStream());
    stream.onerror = () => closeStream();
  };

  const handleCancel = async () => {
    if (jobId) await cancelJob(jobId);
    closeStream();
    handleClose();
  };

  const handleClose = () => {
    closeStream();
    setPhase("input");
    setInstruction("");
    setProgress(0);
    setLogs([]);
    setErrorMsg(null);
    setJobId(null);
    onClose();
  };

  if (!open) return null;

  const modalBg = isDark ? "#0e0e10" : "var(--bg-elevated)";
  const panelBorder = isDark ? "rgba(255,255,255,0.09)" : "var(--border-subtle)";
  const isRunning = phase === "running";

  const textareaClass = isDark
    ? "w-full resize-none rounded-xl border border-white/[0.07] bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder-neutral-600 outline-none transition-all focus:border-purple-500/50 focus:bg-white/[0.06] focus:ring-1 focus:ring-purple-500/30"
    : "w-full resize-none rounded-xl border px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition-all focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30";

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
        <div
          className="w-full max-w-lg overflow-hidden rounded-2xl border shadow-2xl"
          style={{ background: modalBg, borderColor: panelBorder }}
        >
          {/* Gradient header */}
          <div
            className="relative overflow-hidden px-6 pb-5 pt-6"
            style={{ background: "linear-gradient(135deg, rgba(168,85,247,0.15) 0%, rgba(168,85,247,0.06) 60%, transparent 100%)" }}
          >
            <div
              className="absolute inset-x-0 top-0 h-px"
              style={{ background: "linear-gradient(90deg, #a855f7cc, #a855f755, transparent)" }}
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base font-bold"
                  style={{ background: "rgba(168,85,247,0.15)", color: "#a855f7", border: "1px solid rgba(168,85,247,0.3)" }}
                >
                  ✦
                </div>
                <div>
                  <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                    Assign to AI Agent
                  </h2>
                  <p className="mt-0.5 text-xs font-medium" style={{ color: "#a855f7" }}>
                    {project.name}
                  </p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
                style={{ color: "var(--text-muted)" }}
                title={isRunning ? "Close — job continues in background" : "Close"}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="p-6">
            {/* ── Input phase ─────────────────────────────────── */}
            {phase === "input" && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    What do you want the AI to do?
                  </label>
                  <textarea
                    ref={textareaRef}
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        (e.currentTarget.form as HTMLFormElement)?.requestSubmit();
                      }
                    }}
                    rows={4}
                    placeholder="e.g. Add input validation to the login form and write tests for it"
                    maxLength={2000}
                    className={textareaClass}
                  />
                  <p className="mt-1.5 text-right text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {instruction.length}/2000 · ⌘↵ to submit
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="rounded-lg px-3 py-2 text-xs font-medium transition-colors hover:bg-white/5"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!instruction.trim()}
                    className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ background: "linear-gradient(135deg, #a855f7, #7c3aed)" }}
                  >
                    <span>✦</span>
                    Run AI Agent
                  </button>
                </div>
              </form>
            )}

            {/* ── Running / Done / Error phase ────────────────── */}
            {phase !== "input" && (
              <div className="space-y-4">
                {/* Status + progress */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {isRunning && (
                        <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: "#a855f7" }} />
                      )}
                      <span
                        className="text-xs font-semibold"
                        style={{ color: isRunning ? "#a855f7" : phase === "done" ? "#34d399" : "#ef4444" }}
                      >
                        {isRunning ? "Agent running…" : phase === "done" ? "✓ Completed" : "✕ Failed"}
                      </span>
                    </div>
                    <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>{progress}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${progress}%`,
                        background: phase === "done" ? "#34d399" : phase === "error" ? "#ef4444" : "linear-gradient(90deg, #a855f7, #7c3aed)",
                      }}
                    />
                  </div>
                </div>

                {/* Task recap */}
                <div
                  className="rounded-xl border px-3 py-2.5 text-xs leading-relaxed"
                  style={{ borderColor: "rgba(168,85,247,0.2)", background: "rgba(168,85,247,0.06)", color: "var(--text-secondary)" }}
                >
                  <span className="font-semibold" style={{ color: "#a855f7" }}>Task: </span>
                  {instruction}
                </div>

                {/* Live log */}
                <div
                  className="max-h-56 min-h-[100px] overflow-y-auto rounded-xl border p-3 font-mono text-[11px] leading-relaxed"
                  style={{ borderColor: panelBorder, background: isDark ? "#07070a" : "#f8f8f8", color: "var(--text-secondary)" }}
                >
                  {logs.length === 0 && (
                    <span style={{ color: "var(--text-muted)" }}>Waiting for output…</span>
                  )}
                  {logs.map((line, i) => (
                    <div key={i} className="whitespace-pre-wrap break-words">{line}</div>
                  ))}
                  {errorMsg && <div className="mt-1 text-red-400">{errorMsg}</div>}
                  <div ref={logsEndRef} />
                </div>

                {/* Hint: track from Worker Logs */}
                {isRunning && (
                  <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    You can close this modal — the job runs in the background. Track progress in{" "}
                    <button
                      onClick={() => { handleClose(); router.push("/quest"); }}
                      className="underline underline-offset-2 transition-colors hover:text-purple-400"
                      style={{ color: "#a855f7" }}
                    >
                      Worker Logs
                    </button>.
                  </p>
                )}

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 pt-1">
                  {isRunning && (
                    <>
                      <button
                        onClick={handleCancel}
                        className="rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-red-500/10"
                        style={{ borderColor: "rgba(239,68,68,0.3)", color: "#ef4444" }}
                      >
                        Cancel Job
                      </button>
                      <button
                        onClick={handleClose}
                        className="rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-white/5"
                        style={{ borderColor: panelBorder, color: "var(--text-secondary)" }}
                      >
                        Close
                      </button>
                    </>
                  )}
                  {!isRunning && (
                    <button
                      onClick={handleClose}
                      className="rounded-lg px-4 py-2 text-xs font-semibold text-white transition-all"
                      style={{ background: phase === "done" ? "linear-gradient(135deg, #34d399, #059669)" : "linear-gradient(135deg, #a855f7, #7c3aed)" }}
                    >
                      {phase === "done" ? "Done" : "Close"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}


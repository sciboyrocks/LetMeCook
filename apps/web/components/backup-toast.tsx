"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  jobId: string;
  projectName: string;
  onClose: () => void;
}

type Phase = "queued" | "running" | "completed" | "failed" | "cancelled";

interface LogEntry {
  id: number;
  level: "info" | "warn" | "error";
  message: string;
}

export default function BackupToast({ jobId, projectName, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("queued");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const logIdRef = useRef(0);

  // Portal mount guard
  useEffect(() => {
    setMounted(true);
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  // Auto-scroll log panel to bottom
  useEffect(() => {
    if (logsOpen) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, logsOpen]);

  // SSE stream
  useEffect(() => {
    const es = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/stream`, {
      withCredentials: true,
    });

    es.addEventListener("job", (e) => {
      const data = JSON.parse(e.data) as { status: Phase };
      setPhase(data.status);
    });

    es.addEventListener("log", (e) => {
      const data = JSON.parse(e.data) as { level?: "info" | "warn" | "error"; message: string };
      setLogs((prev) => [
        ...prev,
        { id: ++logIdRef.current, level: data.level ?? "info", message: data.message },
      ]);
      // Auto-open log panel on warnings/errors so user sees issues immediately
      if (data.level === "warn" || data.level === "error") {
        setLogsOpen(true);
      }
    });

    es.addEventListener("done", (e) => {
      const data = JSON.parse(e.data) as { status: Phase };
      setPhase(data.status);
      es.close();
      // Keep open longer on failure so user can read logs; auto-dismiss on success
      const delay = data.status === "completed" ? 6000 : 0;
      if (delay > 0) {
        closeTimerRef.current = setTimeout(() => {
          setVisible(false);
          setTimeout(onClose, 400);
        }, delay);
      }
    });

    es.addEventListener("error", () => {
      setPhase("failed");
      es.close();
    });

    return () => {
      es.close();
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [jobId, onClose]);

  const isDone = phase === "completed" || phase === "failed" || phase === "cancelled";

  const phaseColor: Record<Phase, string> = {
    queued: "#94a3b8",
    running: "#38bdf8",
    completed: "#34d399",
    failed: "#f87171",
    cancelled: "#fbbf24",
  };

  const phaseLabel: Record<Phase, string> = {
    queued: "Queued",
    running: "Backing up…",
    completed: "Backup complete",
    failed: "Backup failed",
    cancelled: "Cancelled",
  };

  const logColor: Record<LogEntry["level"], string> = {
    info: "rgba(148,163,184,0.85)",
    warn: "#fbbf24",
    error: "#f87171",
  };

  const lastLog = logs[logs.length - 1] ?? null;

  if (!mounted) return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: "1.5rem",
        right: "1.5rem",
        zIndex: 9999,
        width: "340px",
        transform: visible ? "translateY(0)" : "translateY(calc(100% + 2rem))",
        opacity: visible ? 1 : 0,
        transition: "transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease",
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          background: "rgba(13,13,18,0.95)",
          border: `1px solid ${isDone ? phaseColor[phase] + "40" : "rgba(255,255,255,0.1)"}`,
          borderRadius: "12px",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          overflow: "hidden",
          transition: "border-color 0.4s ease",
        }}
      >
        {/* Header */}
        <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {/* Status icon */}
            <div style={{ flexShrink: 0, width: "20px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {isDone ? (
                phase === "completed" ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                )
              ) : (
                <SpinnerIcon color={phaseColor[phase]} />
              )}
            </div>

            {/* Text */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {projectName}
              </div>
              <div style={{ fontSize: "11px", color: phaseColor[phase], marginTop: "1px" }}>
                {phaseLabel[phase]}
              </div>
            </div>

            {/* Logs toggle */}
            {logs.length > 0 && (
              <button
                onClick={() => setLogsOpen((o) => !o)}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "5px",
                  cursor: "pointer",
                  padding: "3px 7px",
                  color: "rgba(255,255,255,0.5)",
                  fontSize: "10px",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  flexShrink: 0,
                  transition: "color 0.15s, background 0.15s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.85)";
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.1)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.5)";
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
                }}
                aria-label={logsOpen ? "Hide logs" : "Show logs"}
              >
                Logs
                <svg
                  width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transition: "transform 0.2s", transform: logsOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            )}

            {/* Close */}
            <button
              onClick={() => {
                setVisible(false);
                setTimeout(onClose, 400);
              }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "2px",
                color: "rgba(255,255,255,0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                borderRadius: "4px",
                transition: "color 0.15s",
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.8)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.35)")}
              aria-label="Dismiss"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Latest log line (collapsed state) */}
          {!logsOpen && lastLog && (
            <div
              style={{
                fontSize: "10px",
                color: logColor[lastLog.level],
                fontFamily: "var(--font-geist-mono), monospace",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                paddingLeft: "30px",
              }}
            >
              {lastLog.message}
            </div>
          )}

          {/* Progress bar */}
          <div
            style={{
              height: "2px",
              borderRadius: "1px",
              background: "rgba(255,255,255,0.07)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                background: phaseColor[phase],
                borderRadius: "1px",
                transition: "background 0.4s ease",
                animation: !isDone ? "backup-indeterminate 1.4s ease-in-out infinite" : "none",
                width: "100%",
              }}
            />
          </div>
        </div>

        {/* Log panel */}
        {logsOpen && (
          <div
            style={{
              borderTop: "1px solid rgba(255,255,255,0.07)",
              maxHeight: "180px",
              overflowY: "auto",
              padding: "8px 10px",
              display: "flex",
              flexDirection: "column",
              gap: "2px",
              scrollbarWidth: "thin",
              scrollbarColor: "rgba(255,255,255,0.12) transparent",
            }}
          >
            {logs.map((log) => (
              <div
                key={log.id}
                style={{
                  fontSize: "10px",
                  fontFamily: "var(--font-geist-mono), monospace",
                  color: logColor[log.level],
                  lineHeight: "1.5",
                  wordBreak: "break-word",
                  display: "flex",
                  gap: "6px",
                }}
              >
                <span style={{ opacity: 0.4, flexShrink: 0 }}>
                  {log.level === "warn" ? "⚠" : log.level === "error" ? "✕" : "›"}
                </span>
                <span>{log.message}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      <style>{`
        @keyframes backup-indeterminate {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>,
    document.body
  );
}

function SpinnerIcon({ color }: { color: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      style={{ animation: "backup-spin 0.8s linear infinite" }}
    >
      <style>{`@keyframes backup-spin { to { transform: rotate(360deg); } }`}</style>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSystemStats,
  getActiveTunnels,
  killTunnel,
  getTunnelLogs,
  getAuditLogs,
  type SystemStats,
  type Tunnel,
  type AuditLog,
} from "@/lib/api";

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(gb: number): string {
  if (gb < 1) return `${(gb * 1024).toFixed(0)} MB`;
  return `${gb.toFixed(1)} GB`;
}

function StatCard({
  label,
  value,
  subtitle,
  percent,
  color,
}: {
  label: string;
  value: string;
  subtitle?: string;
  percent?: number;
  color: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-xl border p-5"
      style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
    >
      <div className="mb-1 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
        {label}
      </div>
      <div className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        {value}
      </div>
      {subtitle && (
        <div className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
          {subtitle}
        </div>
      )}
      {percent !== undefined && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--bg-base)" }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, percent)}%`, background: color }}
          />
        </div>
      )}
    </div>
  );
}

function ContainerRow({ name, status, image }: { name: string; status: string; image: string }) {
  const isUp = status.toLowerCase().startsWith("up");
  return (
    <div
      className="flex items-center gap-3 rounded-lg border px-4 py-3"
      style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: isUp ? "#34d399" : "#f87171" }}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {name}
        </div>
        <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
          {image}
        </div>
      </div>
      <span
        className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium"
        style={{
          background: isUp ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)",
          color: isUp ? "#34d399" : "#f87171",
        }}
      >
        {status}
      </span>
    </div>
  );
}

function TunnelRow({
  tunnel,
  onKill,
  killing,
}: {
  tunnel: Tunnel;
  onKill: () => void;
  killing: boolean;
}) {
  const [showLogs, setShowLogs] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ["tunnel-logs", tunnel.id],
    queryFn: async () => {
      const res = await getTunnelLogs(tunnel.id);
      return res.ok ? res.data.lines : [];
    },
    enabled: showLogs,
    refetchInterval: showLogs ? 3000 : false,
  });

  useEffect(() => {
    if (showLogs && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logsData, showLogs]);

  const isActive = tunnel.status === "active";
  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{
            background:
              tunnel.status === "active"
                ? "#34d399"
                : tunnel.status === "starting"
                ? "#fbbf24"
                : "#f87171",
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              :{tunnel.port}
            </span>
            {tunnel.url && (
              <a
                href={tunnel.url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-xs underline-offset-2 hover:underline"
                style={{ color: "#38bdf8" }}
              >
                {tunnel.url}
              </a>
            )}
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {tunnel.status}
            {tunnel.errorMsg && ` — ${tunnel.errorMsg}`}
          </div>
        </div>
        <button
          onClick={() => setShowLogs((v) => !v)}
          className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-80"
          style={{
            background: showLogs ? "rgba(56,189,248,0.18)" : "rgba(56,189,248,0.08)",
            color: "#38bdf8",
          }}
        >
          Logs
        </button>
        {(isActive || tunnel.status === "starting") && (
          <button
            onClick={onKill}
            disabled={killing}
            className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-80 disabled:opacity-40"
            style={{ background: "rgba(248,113,113,0.15)", color: "#f87171" }}
          >
            {killing ? "Killing…" : "Kill"}
          </button>
        )}
      </div>
      {showLogs && (
        <div
          className="border-t px-0 py-0"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div
            className="h-48 overflow-y-auto p-3 font-mono text-xs"
            style={{ background: "var(--bg-base)", color: "#a3e635" }}
          >
            {logsLoading ? (
              <span style={{ color: "var(--text-muted)" }}>Loading logs…</span>
            ) : logsData && logsData.length > 0 ? (
              <>
                {logsData.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all leading-5">
                    {line}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </>
            ) : (
              <span style={{ color: "var(--text-muted)" }}>No logs yet…</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MonitorPage() {
  const queryClient = useQueryClient();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // SSE for live stats
  useEffect(() => {
    const es = new EventSource("/api/system/stats/stream");
    eventSourceRef.current = es;

    es.addEventListener("stats", (event) => {
      try {
        const data = JSON.parse(event.data) as SystemStats;
        setStats(data);
      } catch {}
    });

    es.onerror = () => {
      // Will auto-reconnect
    };

    return () => {
      es.close();
    };
  }, []);

  // Active tunnels
  const { data: tunnels = [] } = useQuery({
    queryKey: ["active-tunnels"],
    queryFn: async () => {
      const res = await getActiveTunnels();
      return res.ok ? res.data : [];
    },
    refetchInterval: 5000,
  });

  const killMutation = useMutation({
    mutationFn: (id: string) => killTunnel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active-tunnels"] });
    },
  });

  // Audit logs
  const { data: auditLogs = [] } = useQuery({
    queryKey: ["audit-logs"],
    queryFn: async () => {
      const res = await getAuditLogs();
      return res.ok ? res.data : [];
    },
    refetchInterval: 10000,
  });

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "rgba(56,189,248,0.12)" }}>
          <svg className="h-5 w-5 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
          </svg>
        </div>
        <div>
          <h1 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>System Monitor</h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Live resource stats &amp; infrastructure
          </p>
        </div>
        {stats && (
          <span className="ml-auto rounded-md px-2 py-0.5 text-xs font-medium" style={{ background: "rgba(52,211,153,0.12)", color: "#34d399" }}>
            Live
          </span>
        )}
      </div>

      {/* ── Resource cards ─────────────────────────────────────────────── */}
      {stats ? (
        <div className="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="CPU"
            value={`${stats.cpu_percent}%`}
            subtitle={`Load: ${stats.load_avg.join(", ")}`}
            percent={stats.cpu_percent}
            color="#38bdf8"
          />
          <StatCard
            label="Memory"
            value={formatBytes(stats.mem_used_gb)}
            subtitle={`of ${formatBytes(stats.mem_total_gb)}`}
            percent={stats.mem_percent}
            color="#a78bfa"
          />
          <StatCard
            label="Disk"
            value={formatBytes(stats.disk_total_gb - stats.disk_free_gb)}
            subtitle={`${formatBytes(stats.disk_free_gb)} free`}
            percent={stats.disk_percent}
            color="#f97316"
          />
          <StatCard
            label="Uptime"
            value={formatUptime(stats.uptime_s)}
            color="#34d399"
          />
        </div>
      ) : (
        <div className="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-28 rounded-xl border" style={{ borderColor: "var(--border-subtle)" }} />
          ))}
        </div>
      )}

      {/* ── Containers ──────────────────────────────────────────────────── */}
      {stats && stats.containers.length > 0 && (
        <section className="mb-7">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-secondary)" }}>
            Containers ({stats.containers.length})
          </h2>
          <div className="grid gap-2">
            {stats.containers.map((c) => (
              <ContainerRow key={c.name} {...c} />
            ))}
          </div>
        </section>
      )}

      {/* ── Active Tunnels ──────────────────────────────────────────────── */}
      <section className="mb-7">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-secondary)" }}>
          Active Tunnels ({tunnels.length})
        </h2>
        {tunnels.length === 0 ? (
          <div
            className="rounded-xl border px-4 py-6 text-center text-sm"
            style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)", color: "var(--text-muted)" }}
          >
            No active tunnels
          </div>
        ) : (
          <div className="grid gap-2">
            {tunnels.map((t) => (
              <TunnelRow
                key={t.id}
                tunnel={t}
                onKill={() => killMutation.mutate(t.id)}
                killing={killMutation.isPending && killMutation.variables === t.id}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Audit Log ──────────────────────────────────────────────────── */}
      <section className="mb-7">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-secondary)" }}>
          Recent Activity
        </h2>
        {auditLogs.length === 0 ? (
          <div
            className="rounded-xl border px-4 py-6 text-center text-sm"
            style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)", color: "var(--text-muted)" }}
          >
            No audit logs yet
          </div>
        ) : (
          <>
            <div className="space-y-1 overflow-y-auto max-h-[400px]">
              {auditLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs"
                style={{ background: "var(--bg-card)" }}
              >
                <span className="shrink-0 font-mono" style={{ color: "var(--text-muted)", minWidth: "130px" }}>
                  {new Date(log.created_at + "Z").toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}
                </span>
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 font-medium"
                  style={{ background: "rgba(249,115,22,0.12)", color: "#f97316" }}
                >
                  {log.action}
                </span>
                {log.entity && (
                  <span style={{ color: "var(--text-secondary)" }}>
                    {log.entity}
                    {log.entity_id ? ` ${log.entity_id.slice(0, 8)}` : ""}
                  </span>
                )}
                {log.detail && (
                  <span className="truncate" style={{ color: "var(--text-muted)" }}>
                    {log.detail}
                  </span>
                )}
              </div>
            ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}

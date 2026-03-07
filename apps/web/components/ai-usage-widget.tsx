"use client";

import { useQuery } from "@tanstack/react-query";
import { getAIUsage } from "@/lib/api";

export default function AIUsageWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ["ai-usage"],
    queryFn: async () => {
      const res = await getAIUsage();
      return res.ok ? res.data : null;
    },
    refetchInterval: 60_000,
  });

  if (isLoading || !data) return null;

  const { today, week } = data;
  const used = today.cap - today.remaining;
  const capPct = today.cap > 0 ? Math.round((used / today.cap) * 100) : 0;

  return (
    <div
      className="mb-5 overflow-hidden rounded-2xl border"
      style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
    >
      {/* accent bar */}
      <div
        className="h-0.5 w-full"
        style={{ background: "linear-gradient(90deg, #a855f7, #7c3aed44, transparent)" }}
      />
      <div className="px-5 py-4">
        {/* header row */}
        <div className="mb-4 flex items-center gap-2">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
            style={{
              background: "rgba(168,85,247,0.12)",
              border: "1px solid rgba(168,85,247,0.2)",
              color: "#a855f7",
            }}
          >
            ✦
          </div>
          <span
            className="text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: "#a855f7" }}
          >
            AI Usage
          </span>
          <span className="ml-auto text-[10px]" style={{ color: "var(--text-muted)" }}>
            resets daily · {today.remaining} calls remaining
          </span>
        </div>

        {/* stat cards */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            {
              label: "Calls today",
              value: today.calls,
              sub: `of ${today.cap} cap`,
              color: "#a855f7",
            },
            {
              label: "Avg latency",
              value: today.avgLatencyMs > 0 ? `${today.avgLatencyMs}ms` : "—",
              sub: "per request",
              color: "var(--text-primary)",
            },
            {
              label: "Errors today",
              value: today.errors,
              sub: today.errors === 0 ? "all clear" : "check logs",
              color: today.errors > 0 ? "#f87171" : "#22c55e",
            },
            {
              label: "This week",
              value: week.calls,
              sub: `${week.errors} error${week.errors !== 1 ? "s" : ""}`,
              color: "var(--text-primary)",
            },
          ].map(({ label, value, sub, color }) => (
            <div
              key={label}
              className="rounded-xl border px-3 py-2.5"
              style={{
                borderColor: "var(--border-subtle)",
                background: "var(--bg-elevated)",
              }}
            >
              <p
                className="mb-1 text-[10px] font-medium uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                {label}
              </p>
              <p className="text-lg font-bold tabular-nums" style={{ color }}>
                {value}
              </p>
              {sub && (
                <p className="mt-0.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {sub}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* daily cap bar */}
        {today.cap > 0 && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between">
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                Daily cap
              </span>
              <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                {used}/{today.cap} ({capPct}%)
              </span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full"
              style={{ background: "var(--bg-elevated)" }}
            >
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(capPct, 100)}%`,
                  background: capPct >= 90 ? "#f87171" : capPct >= 70 ? "#fbbf24" : "#a855f7",
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

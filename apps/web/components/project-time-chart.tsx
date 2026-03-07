"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getProjectActivity } from "@/lib/api";

export default function ProjectTimeChart({ slug }: { slug: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["project-activity", slug],
    queryFn: async () => {
      const res = await getProjectActivity(slug, 30);
      return res.ok ? res.data : [];
    },
    enabled: !!slug,
    staleTime: 60_000,
  });

  const { bars, maxMinutes, totalMinutes, totalDays } = useMemo(() => {
    const map = new Map<string, number>();
    let max = 0;
    let total = 0;
    let active = 0;

    for (const d of data ?? []) {
      map.set(d.date, d.minutes);
      if (d.minutes > max) max = d.minutes;
      total += d.minutes;
      if (d.minutes > 0) active++;
    }

    // Generate last 30 days
    const days: { date: string; minutes: number; label: string }[] = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      days.push({
        date: dateStr,
        minutes: map.get(dateStr) ?? 0,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
      });
    }

    return { bars: days, maxMinutes: max || 1, totalMinutes: total, totalDays: active };
  }, [data]);

  if (isLoading) {
    return (
      <div className="rounded-xl border p-4" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}>
        <div className="skeleton h-32 rounded-lg" />
      </div>
    );
  }

  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">📊</span>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Time (30 days)</h3>
        </div>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {hours > 0 ? `${hours}h ${mins}m` : `${mins}m`} across {totalDays} {totalDays === 1 ? "day" : "days"}
        </p>
      </div>

      {totalMinutes === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          No activity recorded yet. Activity is tracked via heartbeat from code-server.
        </p>
      ) : (
        <div className="flex items-end gap-[3px]" style={{ height: "100px" }}>
          {bars.map((bar) => {
            const height = bar.minutes > 0 ? Math.max(4, (bar.minutes / maxMinutes) * 100) : 2;
            return (
              <div
                key={bar.date}
                className="flex-1 rounded-t-sm transition-colors"
                style={{
                  height: `${height}%`,
                  background: bar.minutes > 0
                    ? "linear-gradient(to top, #f97316, #fb923c)"
                    : "rgba(255,255,255,0.04)",
                  minWidth: "2px",
                }}
                title={`${bar.label}: ${bar.minutes}m`}
              />
            );
          })}
        </div>
      )}

      {/* X-axis labels (every 5 days) */}
      {totalMinutes > 0 && (
        <div className="mt-1 flex justify-between">
          {bars.filter((_, i) => i % 5 === 0).map((bar) => (
            <span key={bar.date} className="text-[9px]" style={{ color: "var(--text-muted)" }}>
              {bar.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

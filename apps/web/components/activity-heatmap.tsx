"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getActivityHeatmap } from "@/lib/api";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS_LABEL = ["", "Mon", "", "Wed", "", "Fri", ""];

function getColor(count: number): string {
  if (count === 0) return "var(--heatmap-empty)";
  if (count < 30) return "var(--heatmap-l1)";
  if (count < 60) return "var(--heatmap-l2)";
  if (count < 120) return "var(--heatmap-l3)";
  return "var(--heatmap-l4)";
}

export default function ActivityHeatmap() {
  const { data, isLoading } = useQuery({
    queryKey: ["activity-heatmap"],
    queryFn: async () => {
      const res = await getActivityHeatmap(365);
      return res.ok ? res.data : [];
    },
    staleTime: 60_000,
  });

  const { grid, monthLabels, totalMinutes, totalDays } = useMemo(() => {
    const map = new Map<string, number>();
    let total = 0;
    let activeDays = 0;

    for (const d of data ?? []) {
      map.set(d.date, d.count);
      total += d.count;
      if (d.count > 0) activeDays++;
    }

    const today = new Date();
    const weeks: { date: string; count: number; dayOfWeek: number }[][] = [];
    const labels: { label: string; weekIndex: number }[] = [];

    // Go back ~52 weeks from today
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 364);
    // Align to Sunday
    startDate.setDate(startDate.getDate() - startDate.getDay());

    let currentWeek: { date: string; count: number; dayOfWeek: number }[] = [];
    let lastMonth = -1;

    const cursor = new Date(startDate);
    while (cursor <= today) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const dayOfWeek = cursor.getDay();
      const month = cursor.getMonth();

      if (dayOfWeek === 0 && currentWeek.length > 0) {
        weeks.push(currentWeek);
        currentWeek = [];
      }

      if (month !== lastMonth) {
        labels.push({ label: MONTHS[month], weekIndex: weeks.length });
        lastMonth = month;
      }

      currentWeek.push({ date: dateStr, count: map.get(dateStr) ?? 0, dayOfWeek });
      cursor.setDate(cursor.getDate() + 1);
    }
    if (currentWeek.length > 0) weeks.push(currentWeek);

    return { grid: weeks, monthLabels: labels, totalMinutes: total, totalDays: activeDays };
  }, [data]);

  if (isLoading) {
    return (
      <div className="rounded-xl border p-4" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}>
        <div className="skeleton h-28 rounded-lg" />
      </div>
    );
  }

  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">🔥</span>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Activity</h3>
        </div>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {hours > 0 ? `${hours}h ${mins}m` : `${mins}m`} across {totalDays} {totalDays === 1 ? "day" : "days"}
        </p>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-flex flex-col gap-0.5" style={{ minWidth: "max-content" }}>
          {/* Month labels */}
          <div className="relative pl-7" style={{ height: "14px" }}>
            {monthLabels.map(({ label, weekIndex }, i) => {
              const nextIndex = monthLabels[i + 1]?.weekIndex ?? grid.length;
              const span = nextIndex - weekIndex;
              return (
                <span
                  key={`${label}-${weekIndex}`}
                  className="absolute text-[10px]"
                  style={{
                    color: "var(--text-muted)",
                    left: `${weekIndex * 13}px`,
                    width: `${span * 13}px`,
                    overflow: "hidden",
                  }}
                >
                  {span >= 2 ? label : ""}
                </span>
              );
            })}
          </div>

          {/* Grid rows (7 days) */}
          {Array.from({ length: 7 }).map((_, dayIdx) => (
            <div key={dayIdx} className="flex items-center gap-0.5">
              <span className="w-6 text-right text-[10px]" style={{ color: "var(--text-muted)" }}>
                {DAYS_LABEL[dayIdx]}
              </span>
              {grid.map((week, weekIdx) => {
                const cell = week.find((c) => c.dayOfWeek === dayIdx);
                if (!cell) {
                  return <div key={weekIdx} className="h-[11px] w-[11px]" />;
                }
                return (
                  <div
                    key={weekIdx}
                    className="h-[11px] w-[11px] rounded-[2px] transition-colors"
                    style={{ background: getColor(cell.count) }}
                    title={`${cell.date}: ${cell.count}m`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-2 flex items-center justify-end gap-1.5">
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Less</span>
        {[0, 15, 45, 90, 150].map((v) => (
          <div
            key={v}
            className="h-[10px] w-[10px] rounded-[2px]"
            style={{ background: getColor(v) }}
          />
        ))}
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>More</span>
      </div>
    </div>
  );
}

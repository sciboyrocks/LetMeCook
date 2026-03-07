"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getWeeklySummary } from "@/lib/api";

export default function WeeklyWrappedBanner() {
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery({
    queryKey: ["weekly-summary"],
    queryFn: async () => {
      const res = await getWeeklySummary();
      return res.ok ? res.data : null;
    },
    staleTime: 5 * 60_000,
  });

  if (dismissed || !data || data.totalMinutes === 0) return null;

  const hours = Math.floor(data.totalMinutes / 60);
  const mins = data.totalMinutes % 60;
  const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return (
    <div
      className="mb-5 rounded-xl border p-4"
      style={{
        borderColor: "rgba(139,92,246,0.2)",
        background: "linear-gradient(135deg, rgba(139,92,246,0.06) 0%, rgba(168,85,247,0.03) 100%)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="shrink-0 text-lg mt-0.5">📈</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
              Weekly Dev Wrapped
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <StatPill label="Total" value={timeStr} color="#8b5cf6" />
              <StatPill label="Streak" value={`${data.streak}d`} color="#f97316" />
              <StatPill label="Projects" value={String(data.projectsWorkedOn)} color="#34d399" />
              {data.topProject && (
                <StatPill label="Top" value={data.topProject.name} color="#38bdf8" />
              )}
            </div>
          </div>
        </div>

        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded-lg px-2 py-1 text-xs transition-opacity hover:opacity-70"
          style={{ color: "var(--text-muted)" }}
          title="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
      <span>{label}:</span>
      <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{value}</span>
    </span>
  );
}

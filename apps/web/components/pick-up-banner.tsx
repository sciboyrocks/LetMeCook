"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLastActive } from "@/lib/api";

export default function PickUpBanner() {
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery({
    queryKey: ["last-active"],
    queryFn: async () => {
      const res = await getLastActive();
      return res.ok ? res.data : null;
    },
    staleTime: 60_000,
  });

  if (dismissed || !data) return null;

  // Only show if last active today or yesterday
  const lastDate = new Date(data.date + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((today.getTime() - lastDate.getTime()) / 86_400_000);
  if (diffDays > 1) return null;

  const hours = Math.floor(data.minutes / 60);
  const mins = data.minutes % 60;
  const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return (
    <div
      className="mb-5 flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
      style={{
        borderColor: "rgba(249,115,22,0.2)",
        background: "linear-gradient(90deg, rgba(249,115,22,0.06) 0%, rgba(234,88,12,0.03) 100%)",
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="shrink-0 text-lg">👋</span>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
            Pick up where you left off
          </p>
          <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
            <span className="font-medium" style={{ color: "#f97316" }}>{data.name}</span>
            {" · "}{timeStr} {diffDays === 0 ? "today" : "yesterday"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => window.open(`/open/${data.projectId}`, "_blank")}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: "linear-gradient(135deg, #f97316, #ea580c)" }}
        >
          Open
          <svg className="h-3 w-3 -rotate-45" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12h15m0 0l-6.75-6.75M19.5 12l-6.75 6.75" />
          </svg>
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="rounded-lg px-2 py-1.5 text-xs transition-opacity hover:opacity-70"
          style={{ color: "var(--text-muted)" }}
          title="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

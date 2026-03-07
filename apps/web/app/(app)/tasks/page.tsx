"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { getAllTasks, updateTask, deleteTask, type TaskWithProject } from "@/lib/api";

const PRIORITY_META = {
  1: { label: "High", color: "#ef4444", bg: "rgba(239,68,68,0.1)" },
  2: { label: "Medium", color: "#f97316", bg: "rgba(249,115,22,0.1)" },
  3: { label: "Low", color: "#22c55e", bg: "rgba(34,197,94,0.1)" },
} as const;

const STATUS_META = {
  todo: { label: "To Do", color: "#6b7280", icon: "○" },
  doing: { label: "Doing", color: "#f97316", icon: "◐" },
  done: { label: "Done", color: "#22c55e", icon: "●" },
} as const;

type Filter = "all" | "todo" | "doing";
type Sort = "priority" | "project" | "recent";

export default function TasksPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("priority");

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["all-tasks"],
    queryFn: async () => {
      const res = await getAllTasks();
      return res.ok ? res.data : [];
    },
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<TaskWithProject, "status">> }) =>
      updateTask(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-tasks"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTask(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-tasks"] });
    },
  });

  const filtered = useMemo(() => {
    let list = tasks;
    if (filter === "todo") list = list.filter((t) => t.status === "todo");
    if (filter === "doing") list = list.filter((t) => t.status === "doing");

    if (sort === "priority") {
      list = [...list].sort((a, b) => a.priority - b.priority);
    } else if (sort === "project") {
      list = [...list].sort((a, b) => a.project_name.localeCompare(b.project_name) || a.priority - b.priority);
    } else if (sort === "recent") {
      list = [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    return list;
  }, [tasks, filter, sort]);

  const todoCount = tasks.filter((t) => t.status === "todo").length;
  const doingCount = tasks.filter((t) => t.status === "doing").length;

  // Group by project when sort is "project"
  const grouped = useMemo(() => {
    if (sort !== "project") return null;
    const map = new Map<string, { name: string; slug: string; color: string; tasks: TaskWithProject[] }>();
    for (const task of filtered) {
      if (!map.has(task.project_slug)) {
        map.set(task.project_slug, { name: task.project_name, slug: task.project_slug, color: task.project_color, tasks: [] });
      }
      map.get(task.project_slug)!.tasks.push(task);
    }
    return Array.from(map.values());
  }, [filtered, sort]);

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: "rgba(56,189,248,0.1)", color: "#38bdf8" }}
          >
            <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Tasks</h1>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              All open tasks across projects
              <span className="ml-2 inline-flex items-center gap-2">
                <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(107,114,128,0.12)", color: "#6b7280" }}>
                  {todoCount} to do
                </span>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(249,115,22,0.12)", color: "#f97316" }}>
                  {doingCount} in progress
                </span>
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Filters + Sort */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {/* Filter pills */}
        <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--border-subtle)" }}>
          {(
            [
              { key: "all", label: "All", count: tasks.length },
              { key: "todo", label: "To Do", count: todoCount },
              { key: "doing", label: "Doing", count: doingCount },
            ] as const
          ).map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                color: filter === f.key ? "#fff" : "var(--text-secondary)",
                background: filter === f.key ? "rgba(56,189,248,0.8)" : "transparent",
              }}
            >
              {f.label} ({f.count})
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Sort:</span>
          <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--border-subtle)" }}>
            {(
              [
                { key: "priority", label: "Priority" },
                { key: "project", label: "Project" },
                { key: "recent", label: "Recent" },
              ] as const
            ).map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className="px-2.5 py-1 text-[11px] font-medium transition-colors"
                style={{
                  color: sort === s.key ? "#fff" : "var(--text-muted)",
                  background: sort === s.key ? "rgba(107,114,128,0.6)" : "transparent",
                }}
              >
                {s.label}
              </button>
            ))}
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
          <span className="text-sm">Loading tasks…</span>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filtered.length === 0 && (
        <div
          className="flex flex-col items-center justify-center rounded-xl border py-16"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
        >
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "rgba(107,114,128,0.1)" }}>
            <svg className="h-6 w-6" style={{ color: "var(--text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
            {filter === "all" ? "No open tasks" : `No ${filter === "todo" ? "to-do" : "in-progress"} tasks`}
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>Add tasks from project pages</p>
        </div>
      )}

      {/* Task list — grouped by project */}
      {!isLoading && grouped && grouped.length > 0 && (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.slug}>
              {/* Project header */}
              <button
                onClick={() => router.push(`/projects/${group.slug}`)}
                className="mb-2 flex items-center gap-2 transition-opacity hover:opacity-80"
              >
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: group.color }} />
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{group.name}</span>
                <span className="text-[10px] font-medium rounded-full px-2 py-0.5" style={{ background: `${group.color}18`, color: group.color }}>
                  {group.tasks.length}
                </span>
              </button>
              <div className="space-y-1.5">
                {group.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} onAdvance={patchMutation} onDelete={deleteMutation} router={router} showProject={false} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Task list — flat */}
      {!isLoading && !grouped && filtered.length > 0 && (
        <div className="space-y-1.5">
          {filtered.map((task) => (
            <TaskRow key={task.id} task={task} onAdvance={patchMutation} onDelete={deleteMutation} router={router} showProject />
          ))}
        </div>
      )}
    </>
  );
}

// ── Task Row Component ─────────────────────────────────────────────────────

function TaskRow({
  task,
  onAdvance,
  onDelete,
  router,
  showProject,
}: {
  task: TaskWithProject;
  onAdvance: { mutate: (vars: { id: string; patch: Partial<Pick<TaskWithProject, "status">> }) => void };
  onDelete: { mutate: (id: string) => void };
  router: ReturnType<typeof useRouter>;
  showProject: boolean;
}) {
  const status = STATUS_META[task.status];
  const prio = PRIORITY_META[task.priority];
  const nextStatus = task.status === "todo" ? "doing" : task.status === "doing" ? "done" : null;
  const prevStatus = task.status === "doing" ? "todo" : null;

  return (
    <div
      className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/[0.03]"
      style={{ borderLeft: `3px solid ${prio.color}40` }}
    >
      {/* Status action button */}
      {nextStatus ? (
        <button
          onClick={() => onAdvance.mutate({ id: task.id, patch: { status: nextStatus } })}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all hover:scale-110"
          style={{ borderColor: `${status.color}60`, color: status.color }}
          title={nextStatus === "doing" ? "Start" : "Mark done"}
        >
          {task.status === "todo" ? (
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l14 9-14 9V3z" />
            </svg>
          ) : (
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
      ) : (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-sm" style={{ color: "#22c55e" }}>✓</span>
      )}

      {/* Task info */}
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug truncate" style={{ color: "var(--text-primary)" }}>
          {task.title}
        </p>
        {showProject && (
          <button
            onClick={() => router.push(`/projects/${task.project_slug}`)}
            className="mt-0.5 text-[11px] transition-colors hover:underline"
            style={{ color: task.project_color }}
          >
            {task.project_name}
          </button>
        )}
      </div>

      {/* Priority badge */}
      <span
        className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
        style={{ background: prio.bg, color: prio.color }}
      >
        {prio.label}
      </span>

      {/* Status badge */}
      <span
        className="hidden sm:inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
        style={{ background: `${status.color}15`, color: status.color }}
      >
        {status.icon} {status.label}
      </span>

      {/* Back button */}
      {prevStatus && (
        <button
          onClick={() => onAdvance.mutate({ id: task.id, patch: { status: prevStatus } })}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: "var(--text-muted)" }}
          title="Move back to To Do"
        >
          ← Back
        </button>
      )}

      {/* Delete button */}
      <button
        onClick={() => onDelete.mutate(task.id)}
        className="shrink-0 rounded p-0.5 text-red-400/50 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-400"
        title="Delete task"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
        </svg>
      </button>
    </div>
  );
}

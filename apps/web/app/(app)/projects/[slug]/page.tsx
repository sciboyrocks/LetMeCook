"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createProjectTask,
  deleteTask,
  getProjectBySlug,
  getProjectTasks,
  updateProject,
  updateTask,
  type Task,
} from "@/lib/api";
import ProjectTimeChart from "@/components/project-time-chart";

const COLUMNS: Array<{ key: Task["status"]; label: string }> = [
  { key: "todo", label: "To Do" },
  { key: "doing", label: "Doing" },
  { key: "done", label: "Done" },
];

export default function ProjectDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";
  const queryClient = useQueryClient();
  const router = useRouter();

  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<1 | 2 | 3>(2);
  const [milestoneName, setMilestoneName] = useState("");
  const [targetDate, setTargetDate] = useState("");

  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ["project", slug],
    queryFn: async () => {
      const res = await getProjectBySlug(slug);
      if (!res.ok) throw new Error(res.error.message || "Failed to load project");
      return res.data;
    },
    enabled: !!slug,
  });

  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ["project-tasks", slug],
    queryFn: async () => {
      const res = await getProjectTasks(slug);
      if (!res.ok) throw new Error(res.error.message || "Failed to load tasks");
      return res.data;
    },
    enabled: !!slug,
  });

  useEffect(() => {
    if (!project) return;
    setMilestoneName(project.milestone_name ?? "");
    setTargetDate(project.target_date ?? "");
  }, [project]);

  const createTaskMutation = useMutation({
    mutationFn: () => createProjectTask(slug, { title: newTaskTitle.trim(), priority: newTaskPriority }),
    onSuccess: async () => {
      setNewTaskTitle("");
      await queryClient.invalidateQueries({ queryKey: ["project-tasks", slug] });
    },
  });

  const patchTaskMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<Task, "status" | "title" | "priority" | "position">> }) =>
      updateTask(id, patch),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project-tasks", slug] });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: string) => deleteTask(taskId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project-tasks", slug] });
    },
  });

  const milestoneMutation = useMutation({
    mutationFn: () => {
      if (!project) return Promise.reject(new Error("Project not loaded"));
      return updateProject(project.id, {
        milestoneName: milestoneName.trim(),
        targetDate: targetDate.trim() || null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", slug] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const grouped = useMemo(() => {
    const base: Record<Task["status"], Task[]> = { todo: [], doing: [], done: [] };
    for (const task of tasks) base[task.status].push(task);
    for (const key of Object.keys(base) as Task["status"][]) {
      base[key].sort((a, b) => a.position - b.position || a.priority - b.priority);
    }
    return base;
  }, [tasks]);

  const color = project?.color ?? "#f97316";

  const PRIORITY_META = {
    1: { label: "High",   color: "#ef4444" },
    2: { label: "Medium", color: "#f97316" },
    3: { label: "Low",    color: "#22c55e" },
  } as const;

  const COL_META: Record<Task["status"], { color: string }> = {
    todo:  { color: "#6b7280" },
    doing: { color: "#f97316" },
    done:  { color: "#22c55e" },
  };

  if (projectLoading || tasksLoading) {
    const shimmer = "animate-pulse rounded bg-[var(--border-subtle)]";
    return (
      <div className="space-y-6">
        {/* Back button skeleton */}
        <div className={`${shimmer} h-4 w-36`} />

        {/* Header card skeleton */}
        <div className="relative overflow-hidden rounded-2xl border p-5" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}>
          <div className="absolute inset-x-0 top-0 h-[3px] rounded-t-2xl" style={{ background: "var(--border-subtle)" }} />
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <div className={`${shimmer} h-6 w-48`} />
                <div className={`${shimmer} h-5 w-16 rounded-full`} />
              </div>
              <div className={`${shimmer} h-3 w-28`} />
              <div className={`${shimmer} h-4 w-72`} />
            </div>
            <div className="flex shrink-0 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className={`${shimmer} h-6 w-8`} />
                  <div className={`${shimmer} h-3 w-10`} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Add task skeleton */}
        <div className="rounded-xl border p-4" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}>
          <div className={`${shimmer} h-4 w-20 mb-3`} />
          <div className={`${shimmer} h-10 w-full rounded-lg mb-3`} />
          <div className="flex items-center gap-2">
            <div className={`${shimmer} h-6 w-14`} />
            <div className={`${shimmer} h-8 w-40 rounded-lg`} />
            <div className={`${shimmer} ml-auto h-8 w-24 rounded-lg`} />
          </div>
        </div>

        {/* Kanban columns skeleton */}
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((col) => (
            <div key={col} className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}>
              <div className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor: "var(--border-subtle)" }}>
                <div className={`${shimmer} h-2 w-2 rounded-full`} />
                <div className={`${shimmer} h-4 w-14`} />
                <div className={`${shimmer} ml-auto h-4 w-6 rounded-full`} />
              </div>
              <div className="p-2 space-y-2">
                {Array.from({ length: col === 1 ? 3 : 2 }).map((_, i) => (
                  <div key={i} className="rounded-lg px-3 py-2.5" style={{ background: "var(--bg-elevated)", borderLeft: "3px solid var(--border-subtle)" }}>
                    <div className={`${shimmer} h-4 w-full mb-1.5`} />
                    <div className={`${shimmer} h-3 w-2/3`} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!project) {
    return <p className="text-sm" style={{ color: "#ef4444" }}>Project not found</p>;
  }

  return (
    <>
      {/* ── Back button ── */}
      <button
        onClick={() => router.push("/dashboard")}
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium transition-colors hover:opacity-80"
        style={{ color: "var(--text-muted)" }}
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to Dashboard
      </button>

      {/* ── Header card ── */}
      <div className="relative mb-6 overflow-hidden rounded-2xl border p-5" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}>
        <div className="absolute inset-x-0 top-0 h-[3px] rounded-t-2xl" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-xl font-bold truncate" style={{ color: "var(--text-primary)" }}>{project.name}</h1>
              <span className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider" style={{ background: `${color}22`, color }}>
                {project.status}
              </span>
            </div>
            <p className="font-mono text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>{project.slug}</p>
            {project.description && (
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>{project.description}</p>
            )}
          </div>
          <div className="flex shrink-0 gap-4">
            {([
              { label: "Total",  count: tasks.length,          color },
              { label: "Done",   count: grouped.done.length,   color: "#22c55e" },
              { label: "Active", count: grouped.doing.length,  color: "#f97316" },
            ] as const).map(({ label, count, color: c }) => (
              <div key={label} className="flex flex-col items-center gap-0.5">
                <span className="text-xl font-bold tabular-nums" style={{ color: c }}>{count}</span>
                <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Add task ── */}
      <div className="mb-5 rounded-xl border p-4" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}>
        <h2 className="mb-3 text-sm font-semibold">Add task</h2>
        <div className="space-y-3">
          <input
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newTaskTitle.trim() && !createTaskMutation.isPending) createTaskMutation.mutate();
            }}
            placeholder="What needs to be done?"
            className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
            style={{ borderColor: "var(--input-border)", background: "var(--input-bg)", color: "var(--text-primary)" }}
          />
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium shrink-0" style={{ color: "var(--text-muted)" }}>Priority</span>
            <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--border-subtle)" }}>
              {([
                { value: 1, label: "High",   color: "#ef4444" },
                { value: 2, label: "Medium", color: "#f97316" },
                { value: 3, label: "Low",    color: "#22c55e" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setNewTaskPriority(opt.value)}
                  className="px-3 py-1.5 text-xs font-semibold transition-colors"
                  style={{
                    color:      newTaskPriority === opt.value ? "#fff"        : opt.color,
                    background: newTaskPriority === opt.value ? opt.color     : "transparent",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => createTaskMutation.mutate()}
              disabled={!newTaskTitle.trim() || createTaskMutation.isPending}
              className="ml-auto rounded-lg px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50 transition-opacity"
              style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}
            >
              {createTaskMutation.isPending ? "Adding…" : "Add task"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Kanban ── */}
      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map((column) => {
          const colTasks = grouped[column.key];
          const colColor = COL_META[column.key].color;
          return (
            <section key={column.key} className="flex flex-col rounded-xl border overflow-hidden" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}>
              {/* Column header */}
              <div className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor: "var(--border-subtle)" }}>
                <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: colColor }} />
                <span className="text-sm font-semibold">{column.label}</span>
                <span className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums" style={{ background: `${colColor}22`, color: colColor }}>
                  {colTasks.length}
                </span>
              </div>
              {/* Task list */}
              <div className="flex-1 p-2 space-y-2">
                {colTasks.map((task) => {
                  const prio = PRIORITY_META[task.priority];
                  const isDone = column.key === "done";
                  return (
                    <div
                      key={task.id}
                      className="group relative rounded-lg px-3 py-2.5 transition-colors"
                      style={{
                        background: "var(--bg-elevated)",
                        borderLeft: `3px solid ${prio.color}55`,
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <p
                          className="flex-1 text-sm leading-snug"
                          style={{
                            color: isDone ? "var(--text-muted)" : "var(--text-primary)",
                            textDecoration: isDone ? "line-through" : "none",
                          }}
                        >
                          {task.title}
                        </p>
                        {/* Delete — hidden until hover */}
                        <button
                          onClick={() => deleteTaskMutation.mutate(task.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 p-0.5 rounded text-red-400/60 hover:text-red-400"
                          title="Delete task"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                          </svg>
                        </button>
                      </div>
                      {/* Footer row */}
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[10px] font-semibold" style={{ color: prio.color }}>{prio.label}</span>
                        <div className="flex items-center gap-1">
                          {task.status !== "todo" && (
                            <button
                              onClick={() => patchTaskMutation.mutate({ id: task.id, patch: { status: task.status === "doing" ? "todo" : "doing" } })}
                              className="rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-white/5"
                              style={{ color: "var(--text-muted)" }}
                            >
                              ← Back
                            </button>
                          )}
                          {task.status !== "done" && (
                            <button
                              onClick={() => patchTaskMutation.mutate({ id: task.id, patch: { status: task.status === "todo" ? "doing" : "done" } })}
                              className="rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors hover:bg-white/5"
                              style={{ color: colColor }}
                            >
                              {task.status === "todo" ? "Start →" : "Done ✓"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {colTasks.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-8 gap-1">
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>No tasks</span>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* ── Milestone ── */}
      <div className="mt-8 mb-5 rounded-xl border p-4" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}>
        <div className="flex items-center gap-2 mb-4">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color }}>
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
          </svg>
          <h2 className="text-sm font-semibold">Milestone</h2>
          {project.milestone_name && (
            <span className="rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ background: `${color}18`, color }}>
              {project.milestone_name}
            </span>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Name</label>
            <input
              value={milestoneName}
              onChange={(e) => setMilestoneName(e.target.value)}
              placeholder="e.g. v1 Launch"
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors"
              style={{ borderColor: "var(--input-border)", background: "var(--input-bg)", color: "var(--text-primary)" }}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Target date</label>
            <input
              type="date"
              value={targetDate || ""}
              onChange={(e) => setTargetDate(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ borderColor: "var(--input-border)", background: "var(--input-bg)", color: "var(--text-primary)" }}
            />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <button
              onClick={() => milestoneMutation.mutate()}
              disabled={milestoneMutation.isPending}
              className="rounded-lg px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60 transition-opacity"
              style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}
            >
              {milestoneMutation.isPending ? "Saving…" : "Save milestone"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Time chart ── */}
      <div className="mt-5">
        <ProjectTimeChart slug={slug} />
      </div>
    </>
  );
}

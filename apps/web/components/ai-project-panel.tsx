"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  aiAsk,
  aiNextTask,
  aiPlan,
  aiRecap,
  aiBootstrap,
  type AIBootstrapPlan,
} from "@/lib/api";

type AITab = "ask" | "next-task" | "plan" | "recap" | "bootstrap";

const TABS: { key: AITab; label: string }[] = [
  { key: "ask", label: "Ask AI" },
  { key: "next-task", label: "Next Task" },
  { key: "plan", label: "Plan Tasks" },
  { key: "recap", label: "Session Recap" },
  { key: "bootstrap", label: "Bootstrap" },
];

const AI_DISABLED_MSG =
  "AI features are not enabled. Set the feature_ai flag to 1 in settings.";

function featureDisabled(code: string): boolean {
  return code === "FEATURE_DISABLED";
}

interface Props {
  slug: string;
  projectColor: string;
}

export default function AIProjectPanel({ slug, projectColor }: Props) {
  const [activeTab, setActiveTab] = useState<AITab>("ask");
  const queryClient = useQueryClient();

  // ── Ask ──────────────────────────────────────────────────────────────────
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ text: string; error?: boolean } | null>(null);

  const askMutation = useMutation({
    mutationFn: () => aiAsk(slug, question.trim()),
    onSuccess: (res) => {
      if (res.ok) setAnswer({ text: res.data.answer });
      else setAnswer({ text: featureDisabled(res.error.code) ? AI_DISABLED_MSG : res.error.message, error: true });
    },
  });

  // ── Next Task ─────────────────────────────────────────────────────────────
  const [nextTaskSuggestion, setNextTaskSuggestion] = useState<{ text: string; error?: boolean } | null>(null);

  const nextTaskMutation = useMutation({
    mutationFn: () => aiNextTask(slug),
    onSuccess: (res) => {
      if (res.ok) setNextTaskSuggestion({ text: res.data.suggestion });
      else setNextTaskSuggestion({ text: featureDisabled(res.error.code) ? AI_DISABLED_MSG : res.error.message, error: true });
    },
  });

  // ── Plan ──────────────────────────────────────────────────────────────────
  const [planGoal, setPlanGoal] = useState("");
  const [planResult, setPlanResult] = useState<{ tasks: string[]; saved: { id: string; title: string }[] } | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  const planMutation = useMutation({
    mutationFn: () => aiPlan(planGoal.trim(), slug),
    onSuccess: (res) => {
      if (res.ok) {
        setPlanResult({ tasks: res.data.tasks, saved: res.data.saved });
        setPlanError(null);
        if (res.data.saved.length > 0) {
          queryClient.invalidateQueries({ queryKey: ["project-tasks", slug] });
        }
      } else {
        setPlanError(featureDisabled(res.error.code) ? AI_DISABLED_MSG : res.error.message);
        setPlanResult(null);
      }
    },
  });

  // ── Recap ─────────────────────────────────────────────────────────────────
  const [recapDraft, setRecapDraft] = useState<string | null>(null);
  const [recapSaved, setRecapSaved] = useState(false);
  const [recapError, setRecapError] = useState<string | null>(null);

  const recapGenMutation = useMutation({
    mutationFn: () => aiRecap(slug),
    onSuccess: (res) => {
      if (res.ok) { setRecapDraft(res.data.draft); setRecapError(null); setRecapSaved(false); }
      else setRecapError(featureDisabled(res.error.code) ? AI_DISABLED_MSG : res.error.message);
    },
  });

  const recapSaveMutation = useMutation({
    mutationFn: () => aiRecap(slug, true),
    onSuccess: (res) => {
      if (res.ok && res.data.saved) setRecapSaved(true);
      else if (!res.ok) setRecapError(featureDisabled(res.error.code) ? AI_DISABLED_MSG : res.error.message);
    },
  });

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  const [prdText, setPrdText] = useState("");
  const [bootstrapPlan, setBootstrapPlan] = useState<{ plan: AIBootstrapPlan | null; savedTasks: { id: string; title: string }[] } | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const bootstrapMutation = useMutation({
    mutationFn: () => aiBootstrap(prdText.trim(), slug),
    onSuccess: (res) => {
      if (res.ok) {
        setBootstrapPlan({ plan: res.data.plan, savedTasks: res.data.savedTasks });
        setBootstrapError(null);
        if (res.data.savedTasks.length > 0) {
          queryClient.invalidateQueries({ queryKey: ["project-tasks", slug] });
        }
      } else {
        setBootstrapError(featureDisabled(res.error.code) ? AI_DISABLED_MSG : res.error.message);
        setBootstrapPlan(null);
      }
    },
  });

  const btnStyle = {
    background: "linear-gradient(135deg, #a855f7, #7c3aed)",
  };

  return (
    <div
      className="mt-6 rounded-xl border overflow-hidden"
      style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2.5 px-4 py-3 border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div
          className="flex h-6 w-6 items-center justify-center rounded-lg text-xs font-bold"
          style={{
            background: "rgba(168,85,247,0.12)",
            border: "1px solid rgba(168,85,247,0.25)",
            color: "#a855f7",
          }}
        >
          ✦
        </div>
        <span
          className="text-xs font-semibold uppercase tracking-widest"
          style={{ color: "#a855f7" }}
        >
          AI Assistant
        </span>
      </div>

      {/* Tab bar */}
      <div
        className="flex overflow-x-auto border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-colors shrink-0"
            style={{
              color: activeTab === tab.key ? "#a855f7" : "var(--text-secondary)",
              borderBottom:
                activeTab === tab.key ? "2px solid #a855f7" : "2px solid transparent",
              background:
                activeTab === tab.key ? "rgba(168,85,247,0.05)" : "transparent",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="p-4">
        {/* ── Ask AI ─────────────────────────────────────────────────────── */}
        {activeTab === "ask" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Ask anything about this project — architecture, tasks, git history, file structure.
            </p>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && question.trim() && !askMutation.isPending) {
                  e.preventDefault();
                  askMutation.mutate();
                }
              }}
              placeholder="e.g. What are the main components? What should I work on next?"
              rows={3}
              className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none resize-none"
              style={{
                borderColor: "var(--input-border)",
                background: "var(--input-bg)",
                color: "var(--text-primary)",
              }}
            />
            <button
              onClick={() => askMutation.mutate()}
              disabled={!question.trim() || askMutation.isPending}
              className="self-start rounded-lg px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
              style={btnStyle}
            >
              {askMutation.isPending ? "Thinking…" : "Ask"}
            </button>
            {answer && (
              <div
                className="rounded-xl border p-4 text-sm leading-relaxed"
                style={{
                  borderColor: answer.error ? "rgba(248,113,113,0.25)" : "rgba(168,85,247,0.2)",
                  background: answer.error ? "rgba(248,113,113,0.05)" : "rgba(168,85,247,0.04)",
                  color: answer.error ? "#f87171" : "var(--text-primary)",
                }}
              >
                {answer.error ? answer.text : (
                  <div className="prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {answer.text}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Next Task ──────────────────────────────────────────────────── */}
        {activeTab === "next-task" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              AI reviews your open tasks, git status, and project context to pick the single most
              impactful thing to work on right now.
            </p>
            <button
              onClick={() => nextTaskMutation.mutate()}
              disabled={nextTaskMutation.isPending}
              className="self-start rounded-lg px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
              style={btnStyle}
            >
              {nextTaskMutation.isPending ? "Thinking…" : "Suggest next task"}
            </button>
            {nextTaskSuggestion && (
              <div
                className="rounded-xl border p-4"
                style={{
                  borderColor: nextTaskSuggestion.error
                    ? "rgba(248,113,113,0.25)"
                    : "rgba(168,85,247,0.2)",
                  background: nextTaskSuggestion.error
                    ? "rgba(248,113,113,0.05)"
                    : "rgba(168,85,247,0.04)",
                }}
              >
                {!nextTaskSuggestion.error && (
                  <p
                    className="text-[10px] font-semibold uppercase tracking-wide mb-2"
                    style={{ color: "#a855f7" }}
                  >
                    Suggested next task
                  </p>
                )}
                <p
                  className="text-sm leading-relaxed"
                  style={{
                    color: nextTaskSuggestion.error ? "#f87171" : "var(--text-primary)",
                  }}
                >
                  {nextTaskSuggestion.error ? nextTaskSuggestion.text : (
                    <div className="prose prose-sm prose-invert max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {nextTaskSuggestion.text}
                      </ReactMarkdown>
                    </div>
                  )}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Plan Tasks ─────────────────────────────────────────────────── */}
        {activeTab === "plan" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Describe a goal and AI generates an actionable task checklist, automatically saved to
              this project.
            </p>
            <input
              value={planGoal}
              onChange={(e) => setPlanGoal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && planGoal.trim() && !planMutation.isPending)
                  planMutation.mutate();
              }}
              placeholder="e.g. Add user authentication with JWT tokens"
              className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
              style={{
                borderColor: "var(--input-border)",
                background: "var(--input-bg)",
                color: "var(--text-primary)",
              }}
            />
            <button
              onClick={() => planMutation.mutate()}
              disabled={!planGoal.trim() || planMutation.isPending}
              className="self-start rounded-lg px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
              style={btnStyle}
            >
              {planMutation.isPending ? "Generating…" : "Generate tasks"}
            </button>
            {planError && <p className="text-xs" style={{ color: "#f87171" }}>{planError}</p>}
            {planResult && (
              <div
                className="rounded-xl border p-4 flex flex-col gap-3"
                style={{
                  borderColor: "rgba(168,85,247,0.2)",
                  background: "rgba(168,85,247,0.04)",
                }}
              >
                <p className="text-xs font-semibold" style={{ color: "#a855f7" }}>
                  {planResult.saved.length > 0
                    ? `${planResult.saved.length} tasks saved to project ✓`
                    : `${planResult.tasks.length} tasks generated`}
                </p>
                <ul className="space-y-2">
                  {planResult.tasks.map((task, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm"
                      style={{ color: "var(--text-primary)" }}
                    >
                      <span
                        className="mt-1 h-1.5 w-1.5 rounded-full flex-shrink-0"
                        style={{
                          background:
                            planResult.saved.find((s) => s.title === task)
                              ? "#22c55e"
                              : "#a855f7",
                        }}
                      />
                      {task}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ── Session Recap ──────────────────────────────────────────────── */}
        {activeTab === "recap" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Generate a session recap based on today&apos;s git activity and project state, then
              save it as a dev journal entry.
            </p>
            <button
              onClick={() => recapGenMutation.mutate()}
              disabled={recapGenMutation.isPending || recapSaveMutation.isPending}
              className="self-start rounded-lg px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
              style={btnStyle}
            >
              {recapGenMutation.isPending ? "Generating…" : "Generate recap"}
            </button>
            {recapError && <p className="text-xs" style={{ color: "#f87171" }}>{recapError}</p>}
            {recapDraft && !recapSaved && (
              <>
                <div
                  className="rounded-xl border p-4"
                  style={{
                    borderColor: "rgba(168,85,247,0.2)",
                    background: "rgba(168,85,247,0.04)",
                  }}
                >
                  <p
                    className="text-[10px] font-semibold uppercase tracking-wide mb-2"
                    style={{ color: "#a855f7" }}
                  >
                    Draft journal entry
                  </p>
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: "var(--text-primary)" }}
                  >
                    <div className="prose prose-sm prose-invert max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {recapDraft}
                      </ReactMarkdown>
                    </div>
                  </p>
                </div>
                <button
                  onClick={() => recapSaveMutation.mutate()}
                  disabled={recapSaveMutation.isPending}
                  className="self-start rounded-lg px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)" }}
                >
                  {recapSaveMutation.isPending ? "Saving…" : "Save to journal ✓"}
                </button>
              </>
            )}
            {recapSaved && (
              <div
                className="rounded-xl border px-4 py-3"
                style={{
                  borderColor: "rgba(34,197,94,0.25)",
                  background: "rgba(34,197,94,0.06)",
                }}
              >
                <p className="text-xs font-semibold" style={{ color: "#22c55e" }}>
                  ✓ Saved to journal
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Bootstrap ──────────────────────────────────────────────────── */}
        {activeTab === "bootstrap" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Paste a PRD or project description. AI generates a tech stack, task list (auto-saved),
              milestone, and README outline.
            </p>
            <textarea
              value={prdText}
              onChange={(e) => setPrdText(e.target.value)}
              placeholder="Paste your product requirements or project description here…"
              rows={6}
              className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none resize-none"
              style={{
                borderColor: "var(--input-border)",
                background: "var(--input-bg)",
                color: "var(--text-primary)",
              }}
            />
            <div className="flex items-center gap-3">
              <button
                onClick={() => bootstrapMutation.mutate()}
                disabled={!prdText.trim() || prdText.length > 10000 || bootstrapMutation.isPending}
                className="rounded-lg px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
                style={btnStyle}
              >
                {bootstrapMutation.isPending ? "Bootstrapping…" : "Generate plan"}
              </button>
              {prdText.length > 7000 && (
                <span
                  className="text-[10px] font-mono"
                  style={{ color: prdText.length > 10000 ? "#f87171" : "#fbbf24" }}
                >
                  {prdText.length} / 10000
                </span>
              )}
            </div>
            {bootstrapError && (
              <p className="text-xs" style={{ color: "#f87171" }}>
                {bootstrapError}
              </p>
            )}
            {bootstrapPlan?.plan && !bootstrapPlan.plan.raw && (
              <div
                className="rounded-xl border p-4 flex flex-col gap-4"
                style={{
                  borderColor: "rgba(168,85,247,0.2)",
                  background: "rgba(168,85,247,0.04)",
                }}
              >
                {bootstrapPlan.plan.summary && (
                  <div>
                    <p
                      className="text-[10px] font-semibold uppercase tracking-wide mb-1"
                      style={{ color: "#a855f7" }}
                    >
                      Summary
                    </p>
                    <p className="text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>
                      {bootstrapPlan.plan.summary}
                    </p>
                  </div>
                )}
                {bootstrapPlan.plan.techStack && bootstrapPlan.plan.techStack.length > 0 && (
                  <div>
                    <p
                      className="text-[10px] font-semibold uppercase tracking-wide mb-2"
                      style={{ color: "#a855f7" }}
                    >
                      Tech Stack
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {bootstrapPlan.plan.techStack.map((t, i) => (
                        <span
                          key={i}
                          className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                          style={{
                            background: "rgba(168,85,247,0.12)",
                            color: "#a855f7",
                            border: "1px solid rgba(168,85,247,0.2)",
                          }}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {(bootstrapPlan.plan.milestone || bootstrapPlan.plan.milestoneDate) && (
                  <div className="flex items-start gap-6">
                    {bootstrapPlan.plan.milestone && (
                      <div>
                        <p
                          className="text-[10px] font-semibold uppercase tracking-wide mb-0.5"
                          style={{ color: "#a855f7" }}
                        >
                          Milestone
                        </p>
                        <p
                          className="text-sm font-semibold"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {bootstrapPlan.plan.milestone}
                        </p>
                      </div>
                    )}
                    {bootstrapPlan.plan.milestoneDate && (
                      <div>
                        <p
                          className="text-[10px] font-semibold uppercase tracking-wide mb-0.5"
                          style={{ color: "#a855f7" }}
                        >
                          Target date
                        </p>
                        <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                          {bootstrapPlan.plan.milestoneDate}
                        </p>
                      </div>
                    )}
                  </div>
                )}
                {bootstrapPlan.savedTasks.length > 0 && (
                  <div>
                    <p
                      className="text-[10px] font-semibold uppercase tracking-wide mb-2"
                      style={{ color: "#a855f7" }}
                    >
                      Tasks ({bootstrapPlan.savedTasks.length} saved ✓)
                    </p>
                    <ul className="space-y-1.5">
                      {bootstrapPlan.savedTasks.map((task) => (
                        <li
                          key={task.id}
                          className="flex items-start gap-2 text-sm"
                          style={{ color: "var(--text-primary)" }}
                        >
                          <span
                            className="mt-1 h-1.5 w-1.5 rounded-full flex-shrink-0"
                            style={{ background: "#22c55e" }}
                          />
                          {task.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {bootstrapPlan.plan.readmeOutline && (
                  <div>
                    <p
                      className="text-[10px] font-semibold uppercase tracking-wide mb-2"
                      style={{ color: "#a855f7" }}
                    >
                      README Outline
                    </p>
                    <pre
                      className="text-xs font-mono leading-relaxed overflow-x-auto p-3 rounded-lg"
                      style={{
                        background: "var(--bg-base)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {bootstrapPlan.plan.readmeOutline}
                    </pre>
                  </div>
                )}
              </div>
            )}
            {bootstrapPlan?.plan?.raw && (
              <div
                className="rounded-xl border p-4"
                style={{ borderColor: "var(--border-subtle)", background: "var(--bg-elevated)" }}
              >
                <p className="text-xs font-semibold mb-2" style={{ color: "#a855f7" }}>
                  AI Response
                </p>
                <pre
                  className="text-xs font-mono whitespace-pre-wrap"
                  style={{ color: "var(--text-primary)" }}
                >
                  <div className="prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {bootstrapPlan.plan.raw}
                    </ReactMarkdown>
                  </div>
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

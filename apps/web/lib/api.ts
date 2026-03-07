/**
 * Typed API client — all calls go through Next.js rewrites (/api → Fastify).
 * Credentials are included so the session cookie is forwarded.
 */

const BASE = "/api";

// ── Generic response shapes ──────────────────────────────────────────────────
export interface ApiOk<T> {
  ok: true;
  data: T;
}
export interface ApiErr {
  ok: false;
  error: { code: string; message: string };
}
export type ApiResult<T> = ApiOk<T> | ApiErr;

async function request<T>(
  path: string,
  init?: RequestInit
): Promise<ApiResult<T>> {
  const hasBody = init?.body != null;
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    ...init,
  });
  const json = (await res.json()) as ApiResult<T>;
  return json;
}

// ── Auth ─────────────────────────────────────────────────────────────────────
export interface AuthStatus {
  authenticated: boolean;
  setupComplete: boolean;
}
export const getAuthStatus = () =>
  request<AuthStatus>("/auth/status");

export const login = (token: string) =>
  request<{ success: boolean }>("/login", {
    method: "POST",
    body: JSON.stringify({ token }),
  });

export const logout = () =>
  request<{ success: boolean }>("/logout", { method: "POST" });

export const setup = () =>
  request<{ secret: string; qrDataUrl: string; otpauth: string }>("/setup", {
    method: "POST",
  });

export const resetTotp = (currentToken: string) =>
  request<{ secret: string; qrDataUrl: string; otpauth: string }>(
    "/reset-totp",
    { method: "POST", body: JSON.stringify({ currentToken }) }
  );

// ── Projects ─────────────────────────────────────────────────────────────────
export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string;
  color: string;
  status: "idea" | "active" | "paused" | "maintenance" | "done" | "graveyard";
  pinned: number;
  tags: string;
  milestone_name?: string;
  target_date?: string | null;
  last_opened_at: string | null;
  created_at: string;
  updated_at: string;
  fileCount: number;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  status: "todo" | "doing" | "done";
  priority: 1 | 2 | 3;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface TaskWithProject extends Task {
  project_name: string;
  project_slug: string;
  project_color: string;
}

export interface JobSnapshot {
  id: string;
  type: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  timeoutMs: number;
  cancelRequested: boolean;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface JobLog {
  id: number;
  level: string;
  message: string;
  created_at: string;
}

export interface EnqueuedJob {
  jobId: string;
  status: "queued";
  timeoutMs: number;
}

export const getProjects = () => request<Project[]>("/projects");

export const getProjectBySlug = (slug: string) => request<Project>(`/projects/${encodeURIComponent(slug)}`);

export const createProject = (body: {
  name: string;
  description?: string;
  color?: string;
  milestoneName?: string;
  targetDate?: string | null;
}) =>
  request<Project>("/projects", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const updateProject = (
  id: string,
  body: Partial<Pick<Project, "name" | "description" | "color" | "status">> & {
    pinned?: boolean;
    milestoneName?: string;
    targetDate?: string | null;
  }
) =>
  request<Project>(`/projects/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });

export const deleteProject = (id: string) =>
  request<{ success: boolean }>(`/projects/${id}`, { method: "DELETE" });

export const enqueueCloneProject = (body: {
  repoUrl: string;
  name?: string;
  description?: string;
  color?: string;
  branch?: string;
}) =>
  request<EnqueuedJob>("/projects/clone", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const enqueueScaffoldProject = (body: {
  template: "nextjs" | "vite-react" | "express" | "node-ts" | "python" | "go";
  name: string;
  description?: string;
  color?: string;
}) =>
  request<EnqueuedJob>("/projects/scaffold", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const getJob = (id: string) => request<{ job: JobSnapshot; logs: JobLog[] }>(`/jobs/${id}`);

export const cancelJob = (id: string) => request<{ id: string; cancelRequested: boolean }>(`/jobs/${id}/cancel`, {
  method: "POST",
});

// ── Health ────────────────────────────────────────────────────────────────────
export interface HealthData {
  status: string;
  uptime_s: number;
  db_ok: boolean;
  disk_free_gb: number;
  project_count: number;
  version: string;
}
export const getHealth = () => request<HealthData>("/health");

// ── GitHub ────────────────────────────────────────────────────────────────────
export interface GithubStatus {
  configured: boolean;
  username: string | null;
  gitInstalled?: boolean;
  ghInstalled?: boolean;
}
export const getGithubStatus = () => request<GithubStatus>("/github/status");

export interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  cloneUrl: string;
  defaultBranch: string;
  updatedAt: string;
}
export const getGithubRepos = () => request<GithubRepo[]>("/github/repos");

export interface GithubProfile {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
  bio: string | null;
  publicRepos: number;
  privateRepos: number;
  totalRepos: number;
  followers: number;
  following: number;
}
export const getGithubProfile = () => request<GithubProfile>("/github/profile");

export interface GithubBranches {
  owner: string;
  repo: string;
  defaultBranch: string | null;
  branches: string[];
}
export const getGithubBranches = (repoUrl: string) =>
  request<GithubBranches>(`/github/branches?repoUrl=${encodeURIComponent(repoUrl)}`);

export const startGithubLogin = () =>
  request<{ alreadyAuthenticated: boolean; redirectUrl: string | null; userCode: string | null; username: string | null }>(
    "/github/login/start",
    { method: "POST" }
  );

export const disconnectGithub = () =>
  request<{ success: boolean }>("/github/disconnect", { method: "POST" });

// ── Settings / Focus ─────────────────────────────────────────────────────────
export const getFocus = () =>
  request<{ goal: string }>("/settings/focus");

export const setFocus = (goal: string) =>
  request<{ goal: string }>("/settings/focus", {
    method: "PATCH",
    body: JSON.stringify({ goal }),
  });

export const getFlag = (name: string) =>
  request<{ name: string; enabled: boolean }>(`/settings/flags/${encodeURIComponent(name)}`);

export const setFlag = (name: string, enabled: boolean) =>
  request<{ name: string; enabled: boolean }>(`/settings/flags/${encodeURIComponent(name)}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });

// ── Notes / Scratchpad ────────────────────────────────────────────────────────
export const getGlobalNotes = () =>
  request<{ content: string }>("/notes/global");

export const saveGlobalNotes = (content: string) =>
  request<{ content: string }>("/notes/global", {
    method: "PATCH",
    body: JSON.stringify({ content }),
  });

// ── Project tags ─────────────────────────────────────────────────────────────
export const updateProjectTags = (id: string, tags: string[]) =>
  request<Project>(`/projects/${id}/tags`, {
    method: "PATCH",
    body: JSON.stringify({ tags }),
  });

// ── Tasks ───────────────────────────────────────────────────────────────────
export const getAllTasks = (status?: string) =>
  request<TaskWithProject[]>(`/tasks${status ? `?status=${status}` : ""}`);

export const getProjectTasks = (slug: string) =>
  request<Task[]>(`/projects/${encodeURIComponent(slug)}/tasks`);

export const createProjectTask = (slug: string, body: { title: string; priority?: 1 | 2 | 3 }) =>
  request<Task>(`/projects/${encodeURIComponent(slug)}/tasks`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const updateTask = (
  id: string,
  body: Partial<Pick<Task, "title" | "status" | "priority" | "position">>
) =>
  request<Task>(`/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const deleteTask = (id: string) =>
  request<{ success: boolean }>(`/tasks/${id}`, { method: "DELETE" });

// ── Export / ZIP ─────────────────────────────────────────────────────────────
/**
 * Triggers a zip download for the project folder.
 * Uses fetch with credentials so the session cookie is included,
 * then creates a temporary blob: URL for the browser to download.
 */
export async function exportProject(idOrSlug: string, filename: string): Promise<void> {
  const enqueue = await request<EnqueuedJob>(`/projects/${idOrSlug}/export`);
  if (!enqueue.ok) throw new Error(enqueue.error.message || "Failed to queue export job");

  const startedAt = Date.now();
  let state: JobSnapshot | null = null;

  while (Date.now() - startedAt < 5 * 60_000) {
    const status = await getJob(enqueue.data.jobId);
    if (!status.ok) throw new Error(status.error.message || "Failed to read export job status");

    state = status.data.job;
    if (state.status === "completed") break;
    if (state.status === "failed" || state.status === "cancelled") {
      throw new Error(state.error?.message || `Export ${state.status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (!state || state.status !== "completed") {
    throw new Error("Export timed out");
  }

  const res = await fetch(`/api/jobs/${enqueue.data.jobId}/download`, { credentials: "include" });
  if (!res.ok) throw new Error("Export download failed");

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Activity ─────────────────────────────────────────────────────────────────
export interface HeatmapDay {
  date: string;
  count: number;
}

export interface ProjectActivity {
  date: string;
  minutes: number;
}

export interface LastActive {
  projectId: string;
  name: string;
  slug: string;
  date: string;
  minutes: number;
}

export interface WeeklySummary {
  totalMinutes: number;
  topProject: { name: string; slug: string; minutes: number } | null;
  projectsWorkedOn: number;
  streak: number;
}

export const sendHeartbeat = (projectId: string) =>
  request<{ date: string; minutes: number }>("/activity/heartbeat", {
    method: "POST",
    body: JSON.stringify({ projectId }),
  });

export const getActivityHeatmap = (days = 365) =>
  request<HeatmapDay[]>(`/activity/heatmap?days=${days}`);

export const getProjectActivity = (slug: string, days = 30) =>
  request<ProjectActivity[]>(`/activity/project/${encodeURIComponent(slug)}?days=${days}`);

export const getLastActive = () =>
  request<LastActive | null>("/activity/last-active");

export const getWeeklySummary = () =>
  request<WeeklySummary>("/activity/weekly-summary");

// ── Journal ──────────────────────────────────────────────────────────────────
export interface JournalImage {
  id: string;
  entry_id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size: number;
  created_at: string;
}

export interface JournalEntry {
  id: string;
  content: string;
  mood: string | null;
  tags: string;
  images: JournalImage[];
  created_at: string;
  updated_at: string;
}

export interface CalendarData {
  year: number;
  month: number;
  days: Record<string, { count: number; moods: string[] }>;
  entries: JournalEntry[];
}

export const getJournalEntries = (limit = 30, offset = 0) =>
  request<JournalEntry[]>(`/journal?limit=${limit}&offset=${offset}`);

export const getJournalCalendar = (year: number, month: number) =>
  request<CalendarData>(`/journal/calendar?year=${year}&month=${month}`);

export const createJournalEntry = (body: { content: string; mood?: string; tags?: string[] }) =>
  request<JournalEntry>("/journal", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const updateJournalEntry = (id: string, body: { content?: string; mood?: string; tags?: string[] }) =>
  request<JournalEntry>(`/journal/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const deleteJournalEntry = (id: string) =>
  request<{ success: boolean }>(`/journal/${id}`, { method: "DELETE" });

export async function uploadJournalImages(entryId: string, files: File[]): Promise<ApiResult<JournalImage[]>> {
  const formData = new FormData();
  for (const file of files) formData.append("images", file);
  const res = await fetch(`/api/journal/${entryId}/images`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  return (await res.json()) as ApiResult<JournalImage[]>;
}

export const deleteJournalImage = (imageId: string) =>
  request<{ success: boolean }>(`/journal/images/${imageId}`, { method: "DELETE" });

// ── Tunnels ──────────────────────────────────────────────────────────────────
export interface Tunnel {
  id: string;
  projectId: string | null;
  port: number;
  url: string | null;
  pid: number | null;
  status: "starting" | "active" | "stopped" | "error";
  errorMsg: string | null;
  createdAt: string;
  updatedAt: string;
}

export const exposeTunnel = (port: number, projectId?: string) =>
  request<Tunnel>("/tunnels/expose", {
    method: "POST",
    body: JSON.stringify({ port, projectId }),
  });

export const getTunnels = () => request<Tunnel[]>("/tunnels");

export const getActiveTunnels = () => request<Tunnel[]>("/tunnels/active");

export const killTunnel = (id: string) =>
  request<{ id: string; status: string }>(`/tunnels/${id}`, { method: "DELETE" });

export const getTunnelLogs = (id: string) =>
  request<{ lines: string[] }>(`/tunnels/${id}/logs`);

// ── System Stats ─────────────────────────────────────────────────────────────
export interface SystemStats {
  cpu_percent: number;
  mem_used_gb: number;
  mem_total_gb: number;
  mem_percent: number;
  disk_free_gb: number;
  disk_total_gb: number;
  disk_percent: number;
  uptime_s: number;
  load_avg: number[];
  containers: Array<{ name: string; status: string; image: string }>;
  timestamp: string;
}

export const getSystemStats = () => request<SystemStats>("/system/stats");

export interface AuditLog {
  id: number;
  action: string;
  entity: string | null;
  entity_id: string | null;
  detail: string | null;
  ip: string | null;
  created_at: string;
}

export const getAuditLogs = () => request<AuditLog[]>("/system/audit-logs");

// ── Backups ──────────────────────────────────────────────────────────────────
export interface Backup {
  id: string;
  filename: string;
  sizeBytes: number;
  status: "pending" | "uploading" | "completed" | "failed";
  createdAt: string;
}

export const startBackup = (slug: string) =>
  request<EnqueuedJob>(`/projects/${encodeURIComponent(slug)}/backup`, {
    method: "POST",
  });

export const assignToAIAgent = (slug: string, instruction: string) =>
  request<EnqueuedJob>(`/projects/${encodeURIComponent(slug)}/ai-agent`, {
    method: "POST",
    body: JSON.stringify({ instruction }),
  });

export const getActiveAIAgentJobs = () =>
  request<JobSnapshot[]>("/jobs?type=ai-agent&status=queued,running");

export const getWorkerLogs = () =>
  request<JobSnapshot[]>("/jobs?limit=20");

export const getProjectBackups = (slug: string) =>
  request<Backup[]>(`/projects/${encodeURIComponent(slug)}/backups`);

export const getLatestBackups = () =>
  request<Record<string, string>>("/backups/latest");

// ── Google Drive ──────────────────────────────────────────────────────────────
export interface GdriveStatus {
  configured: boolean;
  method: "oauth2" | "service_account" | "none";
  folderId: string | null;
  folderName: string | null;
  hasToken: boolean;
}

export const getGdriveStatus = () => request<GdriveStatus>("/system/gdrive/status");

export const getGdriveAuthUrl = () =>
  request<{ url: string }>("/system/gdrive/auth-url");

export const exchangeGdriveCode = (code: string) =>
  request<{ message: string }>("/system/gdrive/exchange", {
    method: "POST",
    body: JSON.stringify({ code }),
  });

// ── Quick Links ───────────────────────────────────────────────────────────────
export interface QuickLink {
  id: string;
  title: string;
  url: string;
  faviconUrl?: string;
}

export const getQuickLinks = () =>
  request<QuickLink[]>("/quick-links");

export const addQuickLink = (title: string, url: string, faviconUrl?: string) =>
  request<QuickLink>("/quick-links", {
    method: "POST",
    body: JSON.stringify({ title, url, faviconUrl }),
  });

export const deleteQuickLink = (id: string) =>
  request<QuickLink[]>(`/quick-links/${encodeURIComponent(id)}`, { method: "DELETE" });

// ── AI ────────────────────────────────────────────────────────────────────────
export interface AIProviderInfo {
  id: string;
  name: string;
  type: "cli" | "api";
  active: boolean;
  availability?: {
    ok: boolean;
    detail?: string;
  };
}
export interface AIUsageStats {
  today: { calls: number; errors: number; avgLatencyMs: number; cap: number; remaining: number };
  week: { calls: number; errors: number };
}
export interface AIPlanResult {
  tasks: string[];
  saved: { id: string; title: string }[];
  runId: string;
  providerId: string;
}
export interface AINextTaskResult { suggestion: string; runId: string; providerId: string; }
export interface AIAskResult { answer: string; runId: string; providerId: string; }
export interface AIBootstrapPlan {
  summary?: string;
  techStack?: string[];
  tasks?: string[];
  milestone?: string;
  milestoneDate?: string;
  readmeOutline?: string;
  raw?: string;
}
export interface AIBootstrapResult {
  plan: AIBootstrapPlan | null;
  savedTasks: { id: string; title: string }[];
  runId: string;
  providerId: string;
}
export interface AIRecapResult {
  saved: boolean;
  entryId?: string;
  draft: string;
  runId: string;
  providerId: string;
}
export interface AICommitResult { messages: string[]; runId: string; providerId: string; }

export const getAIProviders = () => request<AIProviderInfo[]>("/ai/providers");
export const setAIProvider = (providerId: string) =>
  request<{ activeProviderId: string }>("/ai/providers/active", {
    method: "PUT",
    body: JSON.stringify({ providerId }),
  });
export const getAIUsage = () => request<AIUsageStats>("/ai/usage");

export const aiPlan = (goal: string, projectSlug?: string) =>
  request<AIPlanResult>("/ai/plan", { method: "POST", body: JSON.stringify({ goal, projectSlug }) });
export const aiNextTask = (slug: string) =>
  request<AINextTaskResult>(`/ai/projects/${encodeURIComponent(slug)}/next-task`);
export const aiAsk = (slug: string, question: string) =>
  request<AIAskResult>(`/ai/projects/${encodeURIComponent(slug)}/ask`, {
    method: "POST",
    body: JSON.stringify({ question }),
  });
export const aiBootstrap = (prd: string, projectSlug?: string) =>
  request<AIBootstrapResult>("/ai/bootstrap", { method: "POST", body: JSON.stringify({ prd, projectSlug }) });
export const aiRecap = (slug: string, confirm?: boolean) =>
  request<AIRecapResult>(`/ai/projects/${encodeURIComponent(slug)}/recap`, {
    method: "POST",
    body: JSON.stringify({ confirm }),
  });
export const aiCommitMessage = (projectSlug?: string, diff?: string) =>
  request<AICommitResult>("/ai/git/commit-message", {
    method: "POST",
    body: JSON.stringify({ projectSlug, diff }),
  });

// ── Gemini CLI management ───────────────────────────────────────────────────
export interface GeminiCliStatus {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
}
export const getGeminiCliStatus = () =>
  request<GeminiCliStatus>("/ai/gemini-cli/status");
export const getGeminiCliAuthUrl = () =>
  request<{ url: string | null; rawOutput: string }>("/ai/gemini-cli/auth-url", { method: "POST" });
export const submitGeminiCliAuthCode = (code: string) =>
  request<{ success: boolean; rawOutput: string }>("/ai/gemini-cli/auth-code", {
    method: "POST",
    body: JSON.stringify({ code }),
  });

// ── API Key management ──────────────────────────────────────────────────────
export interface ApiKeyStatus {
  providerId: string;
  hasKey: boolean;
  maskedKey: string | null;
}
export const getApiKeyStatus = (providerId: string) =>
  request<ApiKeyStatus>(`/ai/api-keys/${encodeURIComponent(providerId)}`);
export const setApiKey = (providerId: string, apiKey: string) =>
  request<{ providerId: string; maskedKey: string }>(`/ai/api-keys/${encodeURIComponent(providerId)}`, {
    method: "PUT",
    body: JSON.stringify({ apiKey }),
  });
export const clearApiKey = (providerId: string) =>
  request<{ providerId: string; hasKey: boolean }>(`/ai/api-keys/${encodeURIComponent(providerId)}`, {
    method: "DELETE",
  });

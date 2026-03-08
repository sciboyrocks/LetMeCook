/**
 * AI Routes (Phase 8.3–8.11)
 *
 * All routes are behind the `feature_ai` flag.
 * Feature flag can be toggled via PATCH /api/settings (existing route).
 *
 * Endpoints:
 *   GET  /api/ai/providers              — list providers + availability
 *   PUT  /api/ai/providers/active       — switch active provider
 *   GET  /api/ai/usage                  — usage stats for dashboard widget
 *
 *   POST /api/ai/plan                   — goal → task checklist (8.4)
 *   GET  /api/ai/projects/:slug/next-task — next best task suggestion (8.5)
 *   POST /api/ai/git/commit-message     — staged diff → 3 message options (8.6)
 *   POST /api/ai/projects/:slug/ask     — repo chat (8.7)
 *   POST /api/ai/bootstrap              — PRD → scaffold plan (8.8)
 *   POST /api/ai/projects/:slug/recap   — session recap → journal draft (8.9)
 */
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Module-level ref to the pending gemini auth process so we can feed it the auth code later
let pendingAuthProcess: ChildProcess | null = null;
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { getFlag } from '../lib/flags.js';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';
import {
  getAllProviderInfo,
  getActiveProviderId,
  setActiveProvider,
  getProviderById,
  getMaskedApiKey,
  setProviderApiKey,
  clearProviderApiKey,
  hasProviderApiKey,
} from '../lib/ai/provider-registry.js';
import { aiRun, getAIUsageStats, AIRateLimitError } from '../lib/ai/adapter.js';
import { buildProjectContext } from '../lib/ai/context.js';
import { enqueueJob } from '../lib/jobs.js';
import { cacheGet, cacheSet, cacheDel } from '../lib/redis.js';

const requireAuth = (req: FastifyRequest, reply: FastifyReply) =>
  (req.server as FastifyInstance).requireAuth(req, reply);

// ─── Helpers ────────────────────────────────────────────────────────────────

function featureGate(reply: FastifyReply): boolean {
  if (!getFlag(db, 'ai')) {
    reply.status(403).send({
      ok: false,
      error: { code: 'FEATURE_DISABLED', message: 'AI feature is disabled. Enable it via PATCH /api/settings { key:"feature_ai", value:"1" }' },
    });
    return false;
  }
  return true;
}

function findProject(slugOrId: string) {
  return db
    .prepare<[string, string], { id: string; slug: string; name: string; status: string }>(
      'SELECT id, slug, name, status FROM projects WHERE slug = ? OR id = ? LIMIT 1'
    )
    .get(slugOrId, slugOrId);
}

function handleAIError(err: unknown, reply: FastifyReply) {
  const e = err as Error;
  if (e.name === 'AIRateLimitError') {
    return reply.status(429).send({ ok: false, error: { code: 'AI_RATE_LIMITED', message: e.message } });
  }
  throw err; // let fastify error handler deal with it
}

function contextToString(ctx: ReturnType<typeof buildProjectContext>): string {
  if (!ctx) return '';
  const parts: string[] = [
    `Project: ${ctx.project.name} (${ctx.project.slug}) — status: ${ctx.project.status}`,
    ctx.project.description ? `Description: ${ctx.project.description}` : '',
    ctx.project.tags.length ? `Tags: ${ctx.project.tags.join(', ')}` : '',
  ];
  if (ctx.tasks.length) {
    parts.push('\nOpen tasks:');
    for (const t of ctx.tasks) {
      parts.push(`  [${t.status}] (priority ${t.priority}) ${t.title}`);
    }
  }
  if (ctx.gitStatus) parts.push(`\nGit status:\n${ctx.gitStatus}`);
  if (ctx.recentCommits) parts.push(`\nRecent commits:\n${ctx.recentCommits}`);
  if (ctx.fileTree) parts.push(`\nFile tree:\n${ctx.fileTree}`);
  if (ctx.fileSnippets.length) {
    parts.push('\nFile snippets:');
    for (const s of ctx.fileSnippets) {
      parts.push(`\n--- ${s.path} ---\n${s.content}`);
    }
  }
  return parts.filter(Boolean).join('\n');
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export async function aiRoutes(fastify: FastifyInstance) {

  // GET /api/ai/providers — list all registered providers with availability
  fastify.get(
    '/api/ai/providers',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      const providers = await getAllProviderInfo();
      return reply.send({ ok: true, data: providers });
    }
  );

  // PUT /api/ai/providers/active — switch active provider
  fastify.put<{ Body: { providerId?: string } }>(
    '/api/ai/providers/active',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { providerId } = req.body ?? {};
      if (!providerId || typeof providerId !== 'string') {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_BODY', message: 'providerId is required' } });
      }
      if (!getProviderById(providerId)) {
        return reply.status(404).send({ ok: false, error: { code: 'PROVIDER_NOT_FOUND', message: `Unknown provider: ${providerId}` } });
      }
      setActiveProvider(providerId);
      audit(req, 'ai_provider_switch', 'provider', providerId);
      return reply.send({ ok: true, data: { activeProviderId: providerId } });
    }
  );

  // GET /api/ai/usage — usage stats for dashboard widget (cached 60s)
  fastify.get(
    '/api/ai/usage',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      const cacheKey = 'cache:ai:usage';
      const cached = await cacheGet(cacheKey);
      if (cached) return reply.send({ ok: true, data: cached });

      const data = await getAIUsageStats();
      await cacheSet(cacheKey, data, 60);
      return reply.send({ ok: true, data });
    }
  );

  // ── 8.4  POST /api/ai/plan ────────────────────────────────────────────────
  // Goal sentence → task checklist, auto-saved to tasks table.
  fastify.post<{ Body: { goal?: string; projectSlug?: string } }>(
    '/api/ai/plan',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      if (!featureGate(reply)) return;

      const { goal, projectSlug } = req.body ?? {};
      if (!goal?.trim()) {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_BODY', message: 'goal is required' } });
      }

      let project: { id: string; slug: string } | null = null;
      if (projectSlug) {
        project = findProject(projectSlug) ?? null;
        if (!project) {
          return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
        }
      }

      let result: { text: string; runId: string; providerId: string; latencyMs: number };
      try {
        result = await aiRun({
          action: 'plan',
          projectId: project?.id ?? null,
          systemPrompt: 'You are a technical project planner. Given a goal, output ONLY a numbered list of actionable development tasks. Each task on its own line, starting with a number and period. No preamble, no explanation.',
          userPrompt: `Goal: ${goal.trim()}`,
          maxTokens: 1024,
        });
      } catch (err) { return handleAIError(err, reply); }

      // Parse numbered list into tasks
      const taskTitles = result.text
        .split('\n')
        .map((l) => l.replace(/^\d+\.\s*/, '').trim())
        .filter((l) => l.length > 3 && l.length < 240);

      const saved: { id: string; title: string }[] = [];
      if (project && taskTitles.length) {
        let position = db
          .prepare<[string], { maxPos: number }>('SELECT COALESCE(MAX(position),0) as maxPos FROM tasks WHERE project_id = ?')
          .get(project.id)?.maxPos ?? 0;

        for (const title of taskTitles) {
          const id = uuidv4();
          db.prepare(
            'INSERT INTO tasks (id, project_id, title, status, priority, position) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(id, project.id, title, 'todo', 2, ++position);
          saved.push({ id, title });
        }
        audit(req, 'ai_plan', 'project', project.id, `${saved.length} tasks created`);
      }

      return reply.send({
        ok: true,
        data: { tasks: taskTitles, saved, runId: result.runId, providerId: result.providerId },
      });
    }
  );

  // ── 8.5  GET /api/ai/projects/:slug/next-task ─────────────────────────────
  fastify.get<{ Params: { slug: string } }>(
    '/api/ai/projects/:slug/next-task',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      if (!featureGate(reply)) return;

      const project = findProject(req.params.slug);
      if (!project) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
      }

      const ctx = buildProjectContext(project.slug);
      let result: { text: string; runId: string; providerId: string; latencyMs: number };
      try {
        result = await aiRun({
          action: 'next-task',
          projectId: project.id,
          systemPrompt: 'You are a senior engineer helping prioritize work. Given project context, output only the single most impactful next task to work on. One sentence, no preamble.',
          userPrompt: ctx ? contextToString(ctx) : `Project: ${project.name}`,
          maxTokens: 256,
        });
      } catch (err) { return handleAIError(err, reply); }

      return reply.send({ ok: true, data: { suggestion: result.text.trim(), runId: result.runId, providerId: result.providerId } });
    }
  );

  // ── 8.6  POST /api/ai/git/commit-message ─────────────────────────────────
  // Staged git diff → 3 commit message options.
  fastify.post<{ Body: { projectSlug?: string; diff?: string } }>(
    '/api/ai/git/commit-message',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      if (!featureGate(reply)) return;

      const { projectSlug, diff: rawDiff } = req.body ?? {};
      let diff = rawDiff?.trim() ?? '';

      if (!diff && projectSlug) {
        // Try getting diff from the project directory
        const projectDir = join(config.projectsDir, projectSlug);
        try {
          diff = execSync('git diff --cached', { cwd: projectDir, encoding: 'utf-8', timeout: 5_000 }).trim();
        } catch {
          diff = '';
        }
      }

      let project: { id: string } | null = null;
      if (projectSlug) project = findProject(projectSlug) ?? null;

      if (!diff) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'NO_DIFF', message: 'No staged diff found. Stage some changes first or pass diff in body.' },
        });
      }

      // Cap diff size to avoid huge prompts
      const cappedDiff = diff.length > 8_000 ? diff.slice(0, 8_000) + '\n...[diff truncated]' : diff;

      let result: { text: string; runId: string; providerId: string; latencyMs: number };
      try {
        result = await aiRun({
          action: 'commit-message',
          projectId: project?.id ?? null,
          systemPrompt: `You are a git commit message expert. Given a diff, output exactly 3 commit message options separated by "---".
Option 1: Conventional commit format (feat/fix/chore/refactor etc.)
Option 2: Plain, clear English sentence
Option 3: WIP-style short message
No preamble. No numbering. Just the three messages separated by "---".`,
          userPrompt: cappedDiff,
          maxTokens: 512,
        });
      } catch (err) { return handleAIError(err, reply); }

      const messages = result.text
        .split(/\n---\n|^---$/m)
        .map((m) => m.trim())
        .filter(Boolean)
        .slice(0, 3);

      return reply.send({ ok: true, data: { messages, runId: result.runId, providerId: result.providerId } });
    }
  );

  // ── 8.7  POST /api/ai/projects/:slug/ask ─────────────────────────────────
  // Repo explainer chat.
  fastify.post<{ Params: { slug: string }; Body: { question?: string } }>(
    '/api/ai/projects/:slug/ask',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      if (!featureGate(reply)) return;

      const project = findProject(req.params.slug);
      if (!project) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
      }

      const question = req.body?.question?.trim();
      if (!question) {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_BODY', message: 'question is required' } });
      }
      if (question.length > 2_000) {
        return reply.status(400).send({ ok: false, error: { code: 'QUESTION_TOO_LONG', message: 'Question is too long (max 2000 chars)' } });
      }

      const ctx = buildProjectContext(project.slug);
      const contextStr = ctx ? contextToString(ctx) : `Project: ${project.name}`;

      let result: { text: string; runId: string; providerId: string; latencyMs: number };
      try {
        result = await aiRun({
          action: 'ask',
          projectId: project.id,
          systemPrompt: `You are a helpful code assistant. You have access to the following project context:\n\n${contextStr}\n\nAnswer the user's question based on this context. Be concise and practical.`,
          userPrompt: question,
          maxTokens: 2048,
        });
      } catch (err) { return handleAIError(err, reply); }

      return reply.send({ ok: true, data: { answer: result.text.trim(), runId: result.runId, providerId: result.providerId } });
    }
  );

  // ── 8.8  POST /api/ai/bootstrap ──────────────────────────────────────────
  // PRD text → scaffold plan + tasks + milestone + README outline.
  fastify.post<{ Body: { prd?: string; projectSlug?: string } }>(
    '/api/ai/bootstrap',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      if (!featureGate(reply)) return;

      const { prd, projectSlug } = req.body ?? {};
      if (!prd?.trim()) {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_BODY', message: 'prd (product requirements document) text is required' } });
      }
      if (prd.length > 10_000) {
        return reply.status(400).send({ ok: false, error: { code: 'PRD_TOO_LONG', message: 'PRD text is too long (max 10000 chars)' } });
      }

      let project: { id: string; slug: string } | null = null;
      if (projectSlug) project = findProject(projectSlug) ?? null;

      let result: { text: string; runId: string; providerId: string; latencyMs: number };
      try {
        result = await aiRun({
          action: 'bootstrap',
          projectId: project?.id ?? null,
          systemPrompt: `You are a senior software architect. Given a PRD, output a structured JSON response with these exact keys:
{
  "summary": "one sentence project summary",
  "techStack": ["recommended", "technologies"],
  "tasks": ["task 1", "task 2", ...],
  "milestone": "first milestone name",
  "milestoneDate": "YYYY-MM-DD (realistic estimate)",
  "readmeOutline": "markdown outline for README"
}
Output only valid JSON. No markdown code fences.`,
          userPrompt: prd.trim(),
          maxTokens: 2048,
        });
      } catch (err) { return handleAIError(err, reply); }

      let plan: Record<string, unknown> | null = null;
      try {
        plan = JSON.parse(result.text.trim()) as Record<string, unknown>;
      } catch {
        // Fallback: return raw text if JSON parse fails
        plan = { raw: result.text.trim() };
      }

      // Auto-save tasks if project is linked
      const savedTasks: { id: string; title: string }[] = [];
      if (project && Array.isArray(plan?.tasks)) {
        let position = db
          .prepare<[string], { maxPos: number }>('SELECT COALESCE(MAX(position),0) as maxPos FROM tasks WHERE project_id = ?')
          .get(project.id)?.maxPos ?? 0;

        for (const taskTitle of (plan.tasks as string[]).slice(0, 30)) {
          const title = String(taskTitle).trim();
          if (!title || title.length > 240) continue;
          const id = uuidv4();
          db.prepare(
            'INSERT INTO tasks (id, project_id, title, status, priority, position) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(id, project.id, title, 'todo', 2, ++position);
          savedTasks.push({ id, title });
        }

        // Save milestone to project
        if (plan.milestone && plan.milestoneDate) {
          db.prepare('UPDATE projects SET milestone_name = ?, target_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(String(plan.milestone), String(plan.milestoneDate), project.id);
        }

        audit(req, 'ai_bootstrap', 'project', project.id, `${savedTasks.length} tasks bootstrapped`);
      }

      return reply.send({
        ok: true,
        data: { plan, savedTasks, runId: result.runId, providerId: result.providerId },
      });
    }
  );

  // ── 8.9  POST /api/ai/projects/:slug/recap ───────────────────────────────
  // Session recap → journal entry draft for user to confirm.
  fastify.post<{ Params: { slug: string }; Body: { confirm?: boolean } }>(
    '/api/ai/projects/:slug/recap',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      if (!featureGate(reply)) return;

      const project = findProject(req.params.slug);
      if (!project) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
      }

      const ctx = buildProjectContext(project.slug);
      const contextStr = ctx ? contextToString(ctx) : `Project: ${project.name}`;
      const today = new Date().toISOString().slice(0, 10);

      let result: { text: string; runId: string; providerId: string; latencyMs: number };
      try {
        result = await aiRun({
          action: 'recap',
          projectId: project.id,
          systemPrompt: `You are a helpful dev diary assistant. Given a project's current state, write a short journal entry in first person describing what was worked on today. Max 3 paragraphs. Present tense. Practical tone.`,
          userPrompt: `Today is ${today}.\n\n${contextStr}`,
          maxTokens: 512,
        });
      } catch (err) { return handleAIError(err, reply); }

      const draft = result.text.trim();

      // If user confirmed, save as journal entry
      if (req.body?.confirm === true) {
        const entryId = uuidv4();
        db.prepare(
          'INSERT OR IGNORE INTO journal_entries (id, date, content, project_id) VALUES (?, ?, ?, ?)'
        ).run(entryId, today, draft, project.id);
        audit(req, 'ai_recap_saved', 'journal', entryId);
        return reply.send({ ok: true, data: { saved: true, entryId, draft, runId: result.runId, providerId: result.providerId } });
      }

      return reply.send({ ok: true, data: { saved: false, draft, runId: result.runId, providerId: result.providerId } });
    }
  );

  // POST /api/projects/:slug/ai-agent — enqueue an AI agent background job
  fastify.post<{ Params: { slug: string }; Body: { instruction?: string } }>(
    '/api/projects/:slug/ai-agent',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      if (!featureGate(reply)) return;

      const instruction = req.body?.instruction?.trim();
      if (!instruction) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'BAD_REQUEST', message: '`instruction` is required' },
        });
      }

      const project = findProject(req.params.slug);
      if (!project) {
        return reply.status(404).send({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }

      const job = await enqueueJob('ai-agent', {
        projectId: project.id,
        projectSlug: project.slug,
        instruction,
      });

      audit(req, 'ai_agent.start', 'project', project.id, project.slug);

      return reply.send({ ok: true, data: { jobId: job.id, status: job.status, timeoutMs: job.timeoutMs } });
    }
  );

  // ── Gemini CLI management ─────────────────────────────────────────────────

  // GET /api/ai/gemini-cli/status — check if gemini CLI is installed & authenticated
  fastify.get(
    '/api/ai/gemini-cli/status',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      let installed = false;
      let version: string | null = null;
      let authenticated = false;

      try {
        const out = execSync('gemini --version', { encoding: 'utf-8', timeout: 5_000 }).trim();
        installed = true;
        version = out.split('\n')[0] ?? out;
        authenticated = existsSync('/root/.gemini/oauth_creds.json');
      } catch {
        installed = false;
      }

      return reply.send({ ok: true, data: { installed, version, authenticated } });
    }
  );

  // POST /api/ai/gemini-cli/auth-start — spawn interactive auth, return the URL
  fastify.post(
    '/api/ai/gemini-cli/auth-url',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      // Kill any leftover auth process
      if (pendingAuthProcess) {
        pendingAuthProcess.kill('SIGTERM');
        pendingAuthProcess = null;
      }

      return new Promise<void>((resolve) => {
        const child = spawn('gemini', ['-p', 'ping'], {
          env: { ...process.env, NO_BROWSER: 'true', BROWSER: 'none' },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let output = '';
        let urlSent = false;

        const onData = (chunk: Buffer) => {
          output += chunk.toString();
          if (urlSent) return;
          const urlMatch = output.match(/https?:\/\/[^\s]+/);
          if (urlMatch) {
            urlSent = true;
            pendingAuthProcess = child;
            reply.send({ ok: true, data: { url: urlMatch[0], rawOutput: output.trim() } });
            resolve();
          }
        };

        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);

        // Timeout — if no URL appears within 15s, give up
        const timer = setTimeout(() => {
          if (!urlSent) {
            urlSent = true;
            child.kill('SIGTERM');
            pendingAuthProcess = null;
            reply.send({ ok: true, data: { url: null, rawOutput: output.trim() || 'Timed out waiting for auth URL' } });
            resolve();
          }
        }, 15_000);

        child.on('close', () => {
          clearTimeout(timer);
          if (!urlSent) {
            urlSent = true;
            pendingAuthProcess = null;
            reply.send({ ok: true, data: { url: null, rawOutput: output.trim() || 'Process exited without producing a URL' } });
            resolve();
          }
          // If URL was sent, the process closing means auth completed or was aborted
          pendingAuthProcess = null;
        });

        child.on('error', (err) => {
          clearTimeout(timer);
          if (!urlSent) {
            urlSent = true;
            pendingAuthProcess = null;
            reply.status(500).send({ ok: false, error: { code: 'AUTH_FAILED', message: err.message } });
            resolve();
          }
        });
      });
    }
  );

  // POST /api/ai/gemini-cli/auth-code — feed the authorization code to the waiting process
  fastify.post<{ Body: { code?: string } }>(
    '/api/ai/gemini-cli/auth-code',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { code } = req.body ?? {};
      if (!code || typeof code !== 'string' || !code.trim()) {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_BODY', message: 'Authorization code is required' } });
      }

      if (!pendingAuthProcess || !pendingAuthProcess.stdin || pendingAuthProcess.killed) {
        return reply.status(409).send({
          ok: false,
          error: { code: 'NO_PENDING_AUTH', message: 'No pending auth session. Start auth first via POST /api/ai/gemini-cli/auth-url' },
        });
      }

      return new Promise<void>((resolve) => {
        let output = '';
        const child = pendingAuthProcess!;

        const onData = (chunk: Buffer) => {
          output += chunk.toString();
        };
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);

        child.on('close', (exitCode) => {
          pendingAuthProcess = null;
          const success = exitCode === 0 || output.toLowerCase().includes('success') || output.toLowerCase().includes('authenticated');
          reply.send({ ok: true, data: { success, rawOutput: output.trim() } });
          resolve();
        });

        // Write the auth code + newline to stdin
        child.stdin!.write(code.trim() + '\n');
        child.stdin!.end();

        // Timeout: if process doesn't close within 30s, kill it
        setTimeout(() => {
          if (pendingAuthProcess === child) {
            child.kill('SIGTERM');
            pendingAuthProcess = null;
            reply.send({ ok: true, data: { success: false, rawOutput: output.trim() || 'Auth process timed out' } });
            resolve();
          }
        }, 30_000);
      });
    }
  );

  // ── API Key management ────────────────────────────────────────────────────────────

  const ALLOWED_KEY_PROVIDERS = ['gemini-api', 'openai', 'anthropic'];

  // GET /api/ai/api-keys/:providerId — get masked API key status
  fastify.get<{ Params: { providerId: string } }>(
    '/api/ai/api-keys/:providerId',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { providerId } = req.params;
      if (!ALLOWED_KEY_PROVIDERS.includes(providerId)) {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_PROVIDER', message: `API keys are not applicable for provider: ${providerId}` } });
      }
      const masked = getMaskedApiKey(providerId);
      return reply.send({ ok: true, data: { providerId, hasKey: !!masked, maskedKey: masked } });
    }
  );

  // PUT /api/ai/api-keys/:providerId — set API key
  fastify.put<{ Params: { providerId: string }; Body: { apiKey?: string } }>(
    '/api/ai/api-keys/:providerId',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { providerId } = req.params;
      if (!ALLOWED_KEY_PROVIDERS.includes(providerId)) {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_PROVIDER', message: `API keys are not applicable for provider: ${providerId}` } });
      }
      const { apiKey } = req.body ?? {};
      if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_BODY', message: 'apiKey is required' } });
      }
      setProviderApiKey(providerId, apiKey.trim());
      audit(req, 'ai_api_key_set', 'provider', providerId);
      return reply.send({ ok: true, data: { providerId, maskedKey: getMaskedApiKey(providerId) } });
    }
  );

  // DELETE /api/ai/api-keys/:providerId — clear API key
  fastify.delete<{ Params: { providerId: string } }>(
    '/api/ai/api-keys/:providerId',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { providerId } = req.params;
      if (!ALLOWED_KEY_PROVIDERS.includes(providerId)) {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_PROVIDER', message: `API keys are not applicable for provider: ${providerId}` } });
      }
      clearProviderApiKey(providerId);
      audit(req, 'ai_api_key_cleared', 'provider', providerId);
      // Check if env var fallback still provides a key
      const stillHasKey = hasProviderApiKey(providerId);
      return reply.send({ ok: true, data: { providerId, hasKey: stillHasKey } });
    }
  );

}

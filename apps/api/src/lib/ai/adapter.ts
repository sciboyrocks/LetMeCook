/**
 * AI Adapter — main orchestrator (8.1, 8.11)
 *
 * - Secret redaction before prompts go out
 * - Usage tracking in ai_runs table
 * - Per-project + global daily rate limiting
 * - Delegates to the active provider via registry
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/index.js';
import { getActiveProvider } from './provider-registry.js';
import type { AICompleteOptions } from './providers/base.js';

// ─── Safety limits ─────────────────────────────────────────────────────────
// Override via settings table: key = 'ai_daily_cap' / key = 'ai_project_daily_cap'
const DEFAULT_GLOBAL_DAILY_CAP = 200;
const DEFAULT_PROJECT_DAILY_CAP = 30;

// Patterns of secrets to redact from outgoing prompts
const SECRET_PATTERNS: RegExp[] = [
  /([A-Za-z0-9_-]{20,}\.)?[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,  // JWT-like
  /ghp_[A-Za-z0-9]{36}/g,             // GitHub PAT
  /sk-[A-Za-z0-9]{48}/g,              // OpenAI key
  /AIza[A-Za-z0-9_-]{35}/g,           // Google API key
  /[A-Za-z0-9+/]{40,}={0,2}/g,        // possible base64 secret
];

export function redactSecrets(text: string): string {
  let safe = text;
  for (const pattern of SECRET_PATTERNS) {
    safe = safe.replace(pattern, '[REDACTED]');
  }
  return safe;
}

// ─── Rate limiting ─────────────────────────────────────────────────────────

function getSettingInt(key: string, defaultVal: number): number {
  const row = db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?').get(key);
  const n = parseInt(row?.value ?? '', 10);
  return isNaN(n) ? defaultVal : n;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export class AIRateLimitError extends Error {
  constructor(message = 'AI rate limit reached') {
    super(message);
    this.name = 'AIRateLimitError';
  }
}

function checkAndIncrementGlobal(): void {
  const today = todayDate();
  const cap = getSettingInt('ai_daily_cap', DEFAULT_GLOBAL_DAILY_CAP);

  db.prepare(`
    INSERT INTO ai_global_limits (date, calls) VALUES (?, 1)
    ON CONFLICT (date) DO UPDATE SET calls = calls + 1
  `).run(today);

  const row = db
    .prepare<[string], { calls: number }>('SELECT calls FROM ai_global_limits WHERE date = ?')
    .get(today);

  if ((row?.calls ?? 0) > cap) {
    throw new AIRateLimitError(`Global AI daily cap (${cap}) reached. Try again tomorrow.`);
  }
}

function checkAndIncrementProject(projectId: string): void {
  const today = todayDate();
  const cap = getSettingInt('ai_project_daily_cap', DEFAULT_PROJECT_DAILY_CAP);

  db.prepare(`
    INSERT INTO ai_project_limits (project_id, date, calls) VALUES (?, ?, 1)
    ON CONFLICT (project_id, date) DO UPDATE SET calls = calls + 1
  `).run(projectId, today);

  const row = db
    .prepare<[string, string], { calls: number }>(
      'SELECT calls FROM ai_project_limits WHERE project_id = ? AND date = ?'
    )
    .get(projectId, today);

  if ((row?.calls ?? 0) > cap) {
    throw new AIRateLimitError(`Project AI daily cap (${cap}) reached. Try again tomorrow.`);
  }
}

// ─── Core run ──────────────────────────────────────────────────────────────

export interface AIRunOptions extends AICompleteOptions {
  /** Logged in ai_runs as the action type */
  action: string;
  /** Optional project ID for per-project rate limiting + run tracking */
  projectId?: string | null;
}

export interface AIRunResult {
  text: string;
  runId: string;
  providerId: string;
  latencyMs: number;
}

export async function aiRun(opts: AIRunOptions): Promise<AIRunResult> {
  const { action, projectId, systemPrompt, userPrompt, timeoutMs, maxTokens } = opts;
  const provider = getActiveProvider();

  // Rate limit checks
  checkAndIncrementGlobal();
  if (projectId) checkAndIncrementProject(projectId);

  // Redact secrets from prompts before they leave the server
  const safeSystem = systemPrompt ? redactSecrets(systemPrompt) : undefined;
  const safeUser = redactSecrets(userPrompt);

  const runId = uuidv4();
  const start = Date.now();

  let text = '';
  let status: 'ok' | 'error' | 'timeout' | 'rate_limited' = 'ok';
  let errorMsg: string | null = null;

  try {
    text = await provider.complete({
      systemPrompt: safeSystem,
      userPrompt: safeUser,
      timeoutMs,
      maxTokens,
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === 'AbortError' || e.message.includes('timed out') || e.name === 'JobTimeoutError') {
      status = 'timeout';
    } else if (e.name === 'AIRateLimitError') {
      status = 'rate_limited';
    } else {
      status = 'error';
    }
    errorMsg = e.message.slice(0, 500);
    throw err;
  } finally {
    const latencyMs = Date.now() - start;
    db.prepare(`
      INSERT INTO ai_runs (id, provider_id, action, project_id, prompt_chars, output_chars, latency_ms, status, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      provider.id,
      action,
      projectId ?? null,
      (safeSystem?.length ?? 0) + safeUser.length,
      text.length,
      latencyMs,
      status,
      errorMsg,
    );
  }

  return { text, runId, providerId: provider.id, latencyMs: Date.now() - start };
}

// ─── Usage stats (for dashboard widget) ──────────────────────────────────

export function getAIUsageStats() {
  const today = todayDate();
  const thisWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const todayStats = db
    .prepare<[string], { total: number; errors: number; avg_latency: number }>(
      "SELECT COUNT(*) as total, SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) as errors, AVG(latency_ms) as avg_latency FROM ai_runs WHERE date(created_at) = ?"
    )
    .get(today);

  const weekStats = db
    .prepare<[string], { total: number; errors: number }>(
      "SELECT COUNT(*) as total, SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) as errors FROM ai_runs WHERE date(created_at) >= ?"
    )
    .get(thisWeek);

  const globalCap = getSettingInt('ai_daily_cap', DEFAULT_GLOBAL_DAILY_CAP);
  const globalToday = db
    .prepare<[string], { calls: number }>('SELECT calls FROM ai_global_limits WHERE date = ?')
    .get(today);

  return {
    today: {
      calls: todayStats?.total ?? 0,
      errors: todayStats?.errors ?? 0,
      avgLatencyMs: Math.round(todayStats?.avg_latency ?? 0),
      cap: globalCap,
      remaining: Math.max(0, globalCap - (globalToday?.calls ?? 0)),
    },
    week: {
      calls: weekStats?.total ?? 0,
      errors: weekStats?.errors ?? 0,
    },
  };
}

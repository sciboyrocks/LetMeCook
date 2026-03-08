import type { FastifyRequest } from 'fastify';
import { db } from '../db/index.js';
import { redis } from './redis.js';

const AUDIT_KEY = 'audit:buffer';
const FLUSH_INTERVAL_MS = 30_000; // 30 seconds

/**
 * Write a structured audit log entry.
 * Buffers in Redis and periodically flushes to SQLite in batch.
 * This removes the synchronous DB write from the request critical path.
 */
export function audit(
  req: FastifyRequest | null,
  action: string,
  entity?: string,
  entityId?: string,
  detail?: string
) {
  const ip = req?.ip ?? null;
  const entry = JSON.stringify({
    action,
    entity: entity ?? null,
    entityId: entityId ?? null,
    detail: detail ?? null,
    ip,
    timestamp: new Date().toISOString(),
  });
  // Fire-and-forget push to Redis list
  redis.lpush(AUDIT_KEY, entry).catch(() => {
    // Fallback: write directly to SQLite if Redis is unavailable
    db.prepare(
      'INSERT INTO audit_logs (action, entity, entity_id, detail, ip) VALUES (?, ?, ?, ?, ?)'
    ).run(action, entity ?? null, entityId ?? null, detail ?? null, ip);
  });
}

/**
 * Flush all buffered audit entries from Redis to SQLite in a single transaction.
 */
export async function flushAuditLogs(): Promise<void> {
  // Atomically grab up to 500 entries
  const entries: string[] = [];
  for (let i = 0; i < 500; i++) {
    const entry = await redis.rpop(AUDIT_KEY);
    if (!entry) break;
    entries.push(entry);
  }

  if (entries.length === 0) return;

  const insert = db.prepare(
    'INSERT INTO audit_logs (action, entity, entity_id, detail, ip) VALUES (?, ?, ?, ?, ?)'
  );

  db.transaction(() => {
    for (const raw of entries) {
      try {
        const e = JSON.parse(raw) as {
          action: string;
          entity: string | null;
          entityId: string | null;
          detail: string | null;
          ip: string | null;
        };
        insert.run(e.action, e.entity, e.entityId, e.detail, e.ip);
      } catch {}
    }
  })();
}

// Start periodic flusher
let _flushTimer: ReturnType<typeof setInterval> | null = null;

export function startAuditFlusher(): void {
  if (_flushTimer) return;
  _flushTimer = setInterval(() => {
    flushAuditLogs().catch((err) => console.error('[audit-flush]', err));
  }, FLUSH_INTERVAL_MS);
}

export function stopAuditFlusher(): void {
  if (_flushTimer) {
    clearInterval(_flushTimer);
    _flushTimer = null;
  }
}

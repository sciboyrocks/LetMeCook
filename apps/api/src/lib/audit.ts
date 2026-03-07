import type { FastifyRequest } from 'fastify';
import { db } from '../db/index.js';

/**
 * Write a structured audit log entry.
 * Call from any route handler to record critical actions.
 */
export function audit(
  req: FastifyRequest | null,
  action: string,
  entity?: string,
  entityId?: string,
  detail?: string
) {
  const ip = req?.ip ?? null;
  db.prepare(
    'INSERT INTO audit_logs (action, entity, entity_id, detail, ip) VALUES (?, ?, ?, ?, ?)'
  ).run(action, entity ?? null, entityId ?? null, detail ?? null, ip);
}

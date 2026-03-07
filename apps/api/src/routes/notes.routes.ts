/**
 * notes.routes.ts — Global scratchpad / TIL notepad (Phase 2.10)
 * Stored in the settings table under key "global_notes".
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/index.js';

const requireAuth = (req: FastifyRequest, reply: FastifyReply) =>
  (req.server as FastifyInstance).requireAuth(req, reply);

export async function notesRoutes(fastify: FastifyInstance) {
  // GET /api/notes/global
  fastify.get(
    '/api/notes/global',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      const row = db
        .prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
        .get('global_notes');
      return reply.send({ ok: true, data: { content: row?.value ?? '' } });
    }
  );

  // PATCH /api/notes/global
  fastify.patch<{ Body: { content: string } }>(
    '/api/notes/global',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { content } = req.body ?? {};
      db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).run('global_notes', content ?? '');
      return reply.send({ ok: true, data: { content: content ?? '' } });
    }
  );
}

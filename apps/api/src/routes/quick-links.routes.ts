/**
 * quick-links.routes.ts — User-defined sidebar quick links
 * Stored in the settings table under key "quick_links" as a JSON array.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/index.js';

interface QuickLink {
  id: string;
  title: string;
  url: string;
  faviconUrl?: string;
}

const requireAuth = (req: FastifyRequest, reply: FastifyReply) =>
  (req.server as FastifyInstance).requireAuth(req, reply);

function getLinks(): QuickLink[] {
  const row = db
    .prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
    .get('quick_links');
  try {
    return row ? (JSON.parse(row.value) as QuickLink[]) : [];
  } catch {
    return [];
  }
}

function setLinks(links: QuickLink[]): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run('quick_links', JSON.stringify(links));
}

export async function quickLinksRoutes(fastify: FastifyInstance) {
  // GET /api/quick-links
  fastify.get(
    '/api/quick-links',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      return reply.send({ ok: true, data: getLinks() });
    }
  );

  // POST /api/quick-links — add a link
  fastify.post<{ Body: { title: string; url: string; faviconUrl?: string } }>(
    '/api/quick-links',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { title, url, faviconUrl } = req.body ?? {};
      if (!title?.trim() || !url?.trim()) {
        return reply.status(400).send({ ok: false, error: { code: 'BAD_REQUEST', message: 'title and url are required' } });
      }
      const links = getLinks();
      const newLink: QuickLink = { id: Date.now().toString(), title: title.trim(), url: url.trim(), faviconUrl: faviconUrl?.trim() || undefined };
      links.push(newLink);
      setLinks(links);
      return reply.status(201).send({ ok: true, data: newLink });
    }
  );

  // DELETE /api/quick-links/:id — remove a link
  fastify.delete<{ Params: { id: string } }>(
    '/api/quick-links/:id',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { id } = req.params;
      const links = getLinks();
      const filtered = links.filter((l) => l.id !== id);
      if (filtered.length === links.length) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Link not found' } });
      }
      setLinks(filtered);
      return reply.send({ ok: true, data: filtered });
    }
  );
}

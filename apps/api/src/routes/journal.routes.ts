/**
 * journal.routes.ts — Dev Journal CRUD + Image attachments
 * "What did you build today?" entries with mood, tags, and images.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { createWriteStream, existsSync, mkdirSync, unlinkSync, createReadStream, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { db } from '../db/index.js';
import { config } from '../config.js';

const requireAuth = (req: FastifyRequest, reply: FastifyReply) =>
  (req.server as FastifyInstance).requireAuth(req, reply);

const IMAGES_DIR = join(config.dataDir, 'journal-images');
mkdirSync(IMAGES_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

type JournalRow = {
  id: string;
  content: string;
  mood: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
};

type ImageRow = {
  id: string;
  entry_id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size: number;
  created_at: string;
};

export async function journalRoutes(fastify: FastifyInstance) {
  // Register multipart for image uploads
  await fastify.register(import('@fastify/multipart'), {
    limits: { fileSize: MAX_FILE_SIZE, files: 5 },
  });

  /** Helper: attach images array to entries */
  function attachImages(entries: JournalRow[]) {
    if (entries.length === 0) return [];
    const ids = entries.map((e) => e.id);
    const placeholders = ids.map(() => '?').join(',');
    const images = db
      .prepare<string[], ImageRow>(
        `SELECT id, entry_id, filename, original_name, mime_type, size, created_at FROM journal_images WHERE entry_id IN (${placeholders}) ORDER BY created_at ASC`
      )
      .all(...ids);
    const imageMap = new Map<string, ImageRow[]>();
    for (const img of images) {
      if (!imageMap.has(img.entry_id)) imageMap.set(img.entry_id, []);
      imageMap.get(img.entry_id)!.push(img);
    }
    return entries.map((e) => ({ ...e, images: imageMap.get(e.id) ?? [] }));
  }

  /**
   * GET /api/journal?limit=N&offset=N
   * List journal entries, newest first, with images.
   */
  fastify.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/api/journal',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const limit = Math.min(Math.max(1, Number(req.query.limit) || 30), 100);
      const offset = Math.max(0, Number(req.query.offset) || 0);

      const entries = db
        .prepare<[number, number], JournalRow>(
          'SELECT id, content, mood, tags, created_at, updated_at FROM journal_entries ORDER BY created_at DESC LIMIT ? OFFSET ?'
        )
        .all(limit, offset);

      return reply.send({ ok: true, data: attachImages(entries) });
    }
  );

  /**
   * GET /api/journal/calendar?year=Y&month=M
   * Returns entries for a given month with images, plus metadata for calendar dots.
   */
  fastify.get<{ Querystring: { year?: string; month?: string } }>(
    '/api/journal/calendar',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const now = new Date();
      const year = Number(req.query.year) || now.getFullYear();
      const month = Number(req.query.month) || now.getMonth() + 1;
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endMonth = month === 12 ? 1 : month + 1;
      const endYear = month === 12 ? year + 1 : year;
      const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

      const entries = db
        .prepare<[string, string], JournalRow>(
          `SELECT id, content, mood, tags, created_at, updated_at FROM journal_entries
           WHERE created_at >= ? AND created_at < ?
           ORDER BY created_at ASC`
        )
        .all(startDate, endDate);

      // Build daily summary for calendar dots
      const days: Record<string, { count: number; moods: string[] }> = {};
      for (const e of entries) {
        const day = e.created_at.slice(0, 10);
        if (!days[day]) days[day] = { count: 0, moods: [] };
        days[day].count++;
        if (e.mood) days[day].moods.push(e.mood);
      }

      return reply.send({
        ok: true,
        data: { year, month, days, entries: attachImages(entries) },
      });
    }
  );

  /**
   * POST /api/journal
   * Body: { content: string, mood?: string, tags?: string[] }
   */
  fastify.post<{ Body: { content?: string; mood?: string; tags?: string[] } }>(
    '/api/journal',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const content = (req.body.content ?? '').trim();
      if (!content) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'EMPTY_CONTENT', message: 'Journal entry content is required' },
        });
      }
      if (content.length > 10_000) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'CONTENT_TOO_LONG', message: 'Journal entry is too long (max 10,000 chars)' },
        });
      }

      const mood = req.body.mood?.trim() || null;
      const tags = JSON.stringify(Array.isArray(req.body.tags) ? req.body.tags.slice(0, 10) : []);
      const id = uuidv4();

      db.prepare(
        'INSERT INTO journal_entries (id, content, mood, tags) VALUES (?, ?, ?, ?)'
      ).run(id, content, mood, tags);

      const entry = db
        .prepare<[string], JournalRow>(
          'SELECT id, content, mood, tags, created_at, updated_at FROM journal_entries WHERE id = ?'
        )
        .get(id);

      return reply.status(201).send({ ok: true, data: { ...entry!, images: [] } });
    }
  );

  /**
   * PATCH /api/journal/:id
   * Body: { content?: string, mood?: string, tags?: string[] }
   */
  fastify.patch<{ Params: { id: string }; Body: { content?: string; mood?: string; tags?: string[] } }>(
    '/api/journal/:id',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const existing = db
        .prepare<[string], JournalRow>(
          'SELECT id, content, mood, tags, created_at, updated_at FROM journal_entries WHERE id = ?'
        )
        .get(req.params.id);

      if (!existing) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Journal entry not found' } });
      }

      const content = req.body.content !== undefined ? req.body.content.trim() : existing.content;
      if (!content) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'EMPTY_CONTENT', message: 'Journal entry content cannot be empty' },
        });
      }
      if (content.length > 10_000) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'CONTENT_TOO_LONG', message: 'Journal entry is too long (max 10,000 chars)' },
        });
      }

      const mood = req.body.mood !== undefined ? (req.body.mood.trim() || null) : existing.mood;
      const tags = req.body.tags !== undefined
        ? JSON.stringify(Array.isArray(req.body.tags) ? req.body.tags.slice(0, 10) : [])
        : existing.tags;

      db.prepare(
        'UPDATE journal_entries SET content = ?, mood = ?, tags = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(content, mood, tags, req.params.id);

      const entry = db
        .prepare<[string], JournalRow>(
          'SELECT id, content, mood, tags, created_at, updated_at FROM journal_entries WHERE id = ?'
        )
        .get(req.params.id);

      return reply.send({ ok: true, data: attachImages([entry!])[0] });
    }
  );

  /**
   * DELETE /api/journal/:id
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api/journal/:id',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const existing = db
        .prepare<[string], { id: string }>('SELECT id FROM journal_entries WHERE id = ?')
        .get(req.params.id);

      if (!existing) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Journal entry not found' } });
      }

      // Delete associated image files from disk
      const images = db
        .prepare<[string], { filename: string }>('SELECT filename FROM journal_images WHERE entry_id = ?')
        .all(req.params.id);
      for (const img of images) {
        const filePath = join(IMAGES_DIR, img.filename);
        try { unlinkSync(filePath); } catch { /* file may already be gone */ }
      }

      db.prepare('DELETE FROM journal_entries WHERE id = ?').run(req.params.id);
      return reply.send({ ok: true, data: { success: true } });
    }
  );

  // ── Image routes ─────────────────────────────────────────────────────────

  /**
   * POST /api/journal/:id/images
   * Upload images to a journal entry (multipart/form-data).
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/journal/:id/images',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const entry = db
        .prepare<[string], { id: string }>('SELECT id FROM journal_entries WHERE id = ?')
        .get(req.params.id);

      if (!entry) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Journal entry not found' } });
      }

      const parts = req.files();
      const uploaded: ImageRow[] = [];

      for await (const part of parts) {
        if (!ALLOWED_MIME.has(part.mimetype)) continue;

        const id = uuidv4();
        const ext = extname(part.filename) || '.bin';
        // Sanitize: only allow alphanumeric + dot + hyphen + underscore in filename
        const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '');
        const filename = `${id}${safeExt}`;
        const filePath = join(IMAGES_DIR, filename);

        await pipeline(part.file, createWriteStream(filePath));

        // Check if file was truncated (exceeded size limit)
        if (part.file.truncated) {
          try { unlinkSync(filePath); } catch { /* ignore */ }
          continue;
        }

        const stat = statSync(filePath);

        db.prepare(
          'INSERT INTO journal_images (id, entry_id, filename, original_name, mime_type, size) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(id, req.params.id, filename, part.filename, part.mimetype, stat.size);

        const row = db
          .prepare<[string], ImageRow>(
            'SELECT id, entry_id, filename, original_name, mime_type, size, created_at FROM journal_images WHERE id = ?'
          )
          .get(id);

        if (row) uploaded.push(row);
      }

      return reply.send({ ok: true, data: uploaded });
    }
  );

  /**
   * GET /api/journal/images/:filename
   * Serve a journal image file.
   */
  fastify.get<{ Params: { filename: string } }>(
    '/api/journal/images/:filename',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const filename = req.params.filename;
      // Prevent path traversal
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID', message: 'Invalid filename' } });
      }

      const row = db
        .prepare<[string], { mime_type: string }>('SELECT mime_type FROM journal_images WHERE filename = ?')
        .get(filename);

      if (!row) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Image not found' } });
      }

      const filePath = join(IMAGES_DIR, filename);
      if (!existsSync(filePath)) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Image file missing' } });
      }

      return reply
        .header('Content-Type', row.mime_type)
        .header('Cache-Control', 'private, max-age=86400')
        .send(createReadStream(filePath));
    }
  );

  /**
   * DELETE /api/journal/images/:imageId
   * Delete a single image attachment.
   */
  fastify.delete<{ Params: { imageId: string } }>(
    '/api/journal/images/:imageId',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const image = db
        .prepare<[string], ImageRow>(
          'SELECT id, entry_id, filename, original_name, mime_type, size, created_at FROM journal_images WHERE id = ?'
        )
        .get(req.params.imageId);

      if (!image) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Image not found' } });
      }

      const filePath = join(IMAGES_DIR, image.filename);
      try { unlinkSync(filePath); } catch { /* file may already be gone */ }

      db.prepare('DELETE FROM journal_images WHERE id = ?').run(req.params.imageId);
      return reply.send({ ok: true, data: { success: true } });
    }
  );
}

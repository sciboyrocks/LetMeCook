import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { mkdirSync, existsSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { slugify } from '../lib/slugify.js';
import { enqueueJob } from '../lib/jobs.js';
import { cacheGet, cacheSet, cacheDel } from '../lib/redis.js';

const FILE_COUNT_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'build',
  'coverage',
]);

function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (FILE_COUNT_IGNORED_DIRS.has(entry.name)) continue;
    if (entry.isFile()) count++;
    else if (entry.isDirectory() && !entry.name.startsWith('.')) {
      count += countFiles(join(dir, entry.name));
    }
  }
  return count;
}

const PROJECT_DISCOVERY_TTL_MS = 60_000;
const FILE_COUNT_TTL_MS = 5 * 60_000;
const FILE_COUNT_WARMUP_BATCH_SIZE = 2;
let lastProjectDiscoveryAt = 0;
const fileCountCache = new Map<string, { value: number; expiresAt: number }>();
let fileCountWarmupInFlight = false;

function getFileCountCached(projectSlugOrId: string): number {
  const now = Date.now();
  const cached = fileCountCache.get(projectSlugOrId);
  if (cached && cached.expiresAt > now) return cached.value;

  const value = countFiles(join(config.projectsDir, projectSlugOrId));
  fileCountCache.set(projectSlugOrId, { value, expiresAt: now + FILE_COUNT_TTL_MS });
  return value;
}

function maybeDiscoverProjectsFromDisk() {
  const now = Date.now();
  if (now - lastProjectDiscoveryAt < PROJECT_DISCOVERY_TTL_MS) return;
  lastProjectDiscoveryAt = now;

  try {
    const entries = readdirSync(config.projectsDir, { withFileTypes: true });
    const knownSlugs = new Set(
      db.prepare<[], { slug: string }>('SELECT slug FROM projects').all().map((r) => r.slug)
    );

    for (const entry of entries) {
      if (!entry.isDirectory() || knownSlugs.has(entry.name)) continue;
      const displayName = entry.name
        .replace(/[-_]+/g, ' ')
        .replace(/\.\w+$/, '')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim() || entry.name;

      db.prepare('INSERT INTO projects (id, name, slug, description, color) VALUES (?, ?, ?, ?, ?)').run(
        uuidv4(), displayName, entry.name, '', '#6366f1'
      );
    }
  } catch {}
}

function warmFileCountCache(projects: Array<Record<string, unknown>>) {
  if (fileCountWarmupInFlight) return;
  fileCountWarmupInFlight = true;

  const queue = projects.map((p) => (p.slug ?? p.id) as string);

  const processBatch = () => {
    const now = Date.now();
    let hasMore = false;
    try {
      for (let i = 0; i < FILE_COUNT_WARMUP_BATCH_SIZE; i++) {
        const key = queue.shift();
        if (!key) break;

        const cached = fileCountCache.get(key);
        if (cached && cached.expiresAt > now) continue;

        const value = countFiles(join(config.projectsDir, key));
        fileCountCache.set(key, { value, expiresAt: now + FILE_COUNT_TTL_MS });
      }

      hasMore = queue.length > 0;
      if (hasMore) {
        setImmediate(processBatch);
        return;
      }
    } finally {
      if (!hasMore) fileCountWarmupInFlight = false;
    }
  };

  setImmediate(processBatch);
}

function chownProjectDirAsync(projectDir: string) {
  // Avoid blocking request latency with sync chown operations.
  if (typeof process.getuid === 'function' && process.getuid() !== 0) return;
  const child = spawn('chown', ['-R', '1000:1000', projectDir], {
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
}

function uniqueSlug(slug: string, excludeId?: string): string {
  let candidate = slug;
  let i = 1;
  while (true) {
    const existing = excludeId
      ? db.prepare<[string, string], { id: string }>('SELECT id FROM projects WHERE slug = ? AND id != ?').get(candidate, excludeId)
      : db.prepare<[string], { id: string }>('SELECT id FROM projects WHERE slug = ?').get(candidate);
    if (!existing) return candidate;
    i++;
    candidate = `${slug}-${i}`;
  }
}

const requireAuth = (req: FastifyRequest, reply: FastifyReply) =>
  (req.server as FastifyInstance).requireAuth(req, reply);

export async function projectsRoutes(fastify: FastifyInstance) {
  const PROJECTS_CACHE_KEY = 'cache:projects:list';

  // GET /api/projects (cached 30s)
  fastify.get('/api/projects', { preHandler: [fastify.requireAuth as typeof requireAuth] }, async (_req, reply) => {
    // Check Redis cache first
    const cached = await cacheGet(PROJECTS_CACHE_KEY);
    if (cached) return reply.send({ ok: true, data: cached });

    // Auto-discovery is throttled to avoid expensive disk scans on every list request.
    maybeDiscoverProjectsFromDisk();

    const projects = db.prepare('SELECT * FROM projects ORDER BY pinned DESC, last_opened_at DESC, updated_at DESC').all();
    warmFileCountCache(projects as Array<Record<string, unknown>>);
    const enriched = (projects as Array<Record<string, unknown>>).map((p) => ({
      ...p,
      fileCount: fileCountCache.get((p.slug ?? p.id) as string)?.value ?? 0,
    }));

    await cacheSet(PROJECTS_CACHE_KEY, enriched, 30); // 30s cache
    return reply.send({ ok: true, data: enriched });
  });

  // POST /api/projects
  fastify.post<{ Body: { name: string; description?: string; color?: string; milestoneName?: string; targetDate?: string | null } }>(
    '/api/projects',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { name, description, color, milestoneName, targetDate } = req.body;
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_NAME', message: 'Project name is required' } });
      }
      if (name.length > 100) {
        return reply.status(400).send({ ok: false, error: { code: 'NAME_TOO_LONG', message: 'Name too long' } });
      }

      const id = uuidv4();
      const slug = uniqueSlug(slugify(name));
      const projectDir = join(config.projectsDir, slug);
      mkdirSync(projectDir, { recursive: true });
      chownProjectDirAsync(projectDir);

      writeFileSync(join(projectDir, 'README.md'), `# ${name.trim()}\n\n${description ?? ''}\n`);

      db.prepare(
        'INSERT INTO projects (id, name, slug, description, color, milestone_name, target_date) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        id,
        name.trim(),
        slug,
        (description ?? '').trim(),
        color ?? '#6366f1',
        (milestoneName ?? '').trim(),
        targetDate ?? null
      );

      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
      fileCountCache.set(slug, { value: 1, expiresAt: Date.now() + FILE_COUNT_TTL_MS });
      await cacheDel(PROJECTS_CACHE_KEY);
      return reply.status(201).send({ ok: true, data: project });
    }
  );

  // PUT /api/projects/:id
  fastify.put<{ Params: { id: string }; Body: { name?: string; description?: string; color?: string; status?: string; pinned?: boolean; milestoneName?: string; targetDate?: string | null } }>(
    '/api/projects/:id',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { id } = req.params;
      const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (!existing) return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });

      const { name, description, color, status, pinned, milestoneName, targetDate } = req.body;
      const newName = (name ?? (existing.name as string)).trim();

      db.prepare(
        'UPDATE projects SET name = ?, description = ?, color = ?, status = ?, pinned = ?, milestone_name = ?, target_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(
        newName,
        (description !== undefined ? description : (existing.description as string)).trim(),
        color ?? existing.color,
        status ?? existing.status,
        pinned !== undefined ? (pinned ? 1 : 0) : existing.pinned,
        milestoneName !== undefined ? milestoneName.trim() : ((existing.milestone_name as string | null) ?? ''),
        targetDate !== undefined ? targetDate : ((existing.target_date as string | null) ?? null),
        id
      );

      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
      await cacheDel(PROJECTS_CACHE_KEY);
      return reply.send({ ok: true, data: project });
    }
  );

  // GET /api/projects/:slug — single project details by slug
  fastify.get<{ Params: { slug: string } }>(
    '/api/projects/:slug',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(req.params.slug) as Record<string, unknown> | undefined;
      if (!project) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
      }

      return reply.send({
        ok: true,
        data: {
          ...project,
          fileCount: getFileCountCached((project.slug ?? project.id) as string),
        },
      });
    }
  );

  // DELETE /api/projects/:id
  fastify.delete<{ Params: { id: string } }>(
    '/api/projects/:id',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { id } = req.params;
      const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (!existing) return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });

      const projectDir = join(config.projectsDir, (existing.slug ?? id) as string);
      if (existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true });

      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
      fileCountCache.delete((existing.slug ?? id) as string);
      await cacheDel(PROJECTS_CACHE_KEY);
      return reply.send({ ok: true, data: { success: true } });
    }
  );

  // GET /open/:projectId — stamp last_opened + redirect to code-server
  fastify.get<{ Params: { projectId: string } }>(
    '/open/:projectId',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { projectId } = req.params;
      const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<string, unknown> | undefined;
      if (!existing) return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });

      db.prepare('UPDATE projects SET last_opened_at = CURRENT_TIMESTAMP WHERE id = ?').run(projectId);
      const folder = existing.slug ?? projectId;
      return reply.redirect(`/code/${projectId}/?folder=/projects/${folder}`);
    }
  );

  // POST /api/projects/clone — git clone a repo, register as a project
  fastify.post<{
    Body: { repoUrl: string; name?: string; description?: string; color?: string; branch?: string };
  }>(
    '/api/projects/clone',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { repoUrl, name, description, color, branch } = req.body;

      if (!repoUrl || typeof repoUrl !== 'string' || !repoUrl.trim()) {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_URL', message: 'Repository URL is required' } });
      }
      if (repoUrl.startsWith('file://') || repoUrl.startsWith('/') || repoUrl.startsWith('../')) {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_URL', message: 'Local file clone URLs are not allowed' } });
      }

      const job = await enqueueJob('clone', {
        repoUrl: repoUrl.trim(),
        name: name?.trim(),
        description: description?.trim(),
        color,
        branch: branch?.trim(),
      });

      return reply.status(202).send({
        ok: true,
        data: { jobId: job.id, status: job.status, timeoutMs: job.timeoutMs },
      });
    }
  );

  // POST /api/projects/scaffold — create a project from a template using npx/uvx/etc.
  fastify.post<{
    Body: { template: string; name: string; description?: string; color?: string };
  }>(
    '/api/projects/scaffold',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { template, name, description, color } = req.body;

      if (!name?.trim()) {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_NAME', message: 'Name is required' } });
      }

      const TEMPLATES: Record<string, string[]> = {
        'nextjs':    ['npx', '--yes', 'create-next-app@latest', '{dir}', '--typescript', '--tailwind', '--eslint', '--app', '--no-src-dir', '--import-alias', '@/*', '--no-turbopack'],
        'vite-react':['npm', 'create', 'vite@latest', '{dir}', '--', '--template', 'react-ts'],
        'express':   ['npx', '--yes', 'express-generator', '--no-view', '{dir}'],
        'node-ts':   ['npx', '--yes', 'create-ts-project@latest', '{dir}'],
        'python':    ['python3', '-m', 'venv', '.venv'],  // handled specially below
        'go':        ['go', 'mod', 'init', '{module}'],    // handled specially below
      };

      if (!TEMPLATES[template]) {
        return reply.status(400).send({ ok: false, error: { code: 'UNKNOWN_TEMPLATE', message: `Unknown template: ${template}` } });
      }

      const job = await enqueueJob('scaffold', {
        template: template as 'nextjs' | 'vite-react' | 'express' | 'node-ts' | 'python' | 'go',
        name: name.trim(),
        description: description?.trim(),
        color,
      });

      return reply.status(202).send({
        ok: true,
        data: { jobId: job.id, status: job.status, timeoutMs: job.timeoutMs },
      });
    }
  );

  // PATCH /api/projects/:id/tags — update tech stack tags
  fastify.patch<{ Params: { id: string }; Body: { tags: string[] } }>(
    '/api/projects/:id/tags',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { id } = req.params;
      const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
      if (!existing) return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });

      const tags = Array.isArray(req.body?.tags) ? req.body.tags : [];
      const tagsJson = JSON.stringify(tags.slice(0, 12)); // cap at 12 icons

      db.prepare(
        'UPDATE projects SET tags = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(tagsJson, id);

      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
      return reply.send({ ok: true, data: project });
    }
  );

  // GET /api/projects/:id/export — stream project folder as zip
  fastify.get<{ Params: { id: string } }>(
    '/api/projects/:id/export',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { id } = req.params;
      const project = db
        .prepare<[string, string], { id: string }>('SELECT id FROM projects WHERE id = ? OR slug = ?')
        .get(id, id);

      if (!project) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
      }

      const job = await enqueueJob('export-zip', { projectIdOrSlug: id });

      return reply.status(202).send({
        ok: true,
        data: { jobId: job.id, status: job.status, timeoutMs: job.timeoutMs },
      });
    }
  );
}

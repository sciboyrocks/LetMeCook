import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { enqueueJob } from '../lib/jobs.js';
import { audit } from '../lib/audit.js';

const requireAuth = (req: FastifyRequest, reply: FastifyReply) =>
  (req.server as FastifyInstance).requireAuth(req, reply);

type BackupRow = {
  id: string;
  project_id: string;
  filename: string;
  size_bytes: number;
  drive_id: string | null;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  error_msg: string | null;
  created_at: string;
};

export async function backupsRoutes(fastify: FastifyInstance) {
  // POST /api/projects/:slug/backup  — enqueue a backup job
  fastify.post<{ Params: { slug: string } }>(
    '/api/projects/:slug/backup',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const project = db
        .prepare<[string], { id: string; slug: string; name: string }>(
          'SELECT id, slug, name FROM projects WHERE slug = ?'
        )
        .get(req.params.slug);

      if (!project) {
        return reply.status(404).send({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }

      const job = await enqueueJob('backup', {
        projectId: project.id,
        projectSlug: project.slug,
      });

      audit(req, 'backup.start', 'project', project.id, project.slug);

      return reply.send({ ok: true, data: { jobId: job.id, status: job.status, timeoutMs: job.timeoutMs } });
    }
  );

  // GET /api/projects/:slug/backups  — list backups for a project
  fastify.get<{ Params: { slug: string } }>(
    '/api/projects/:slug/backups',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const project = db
        .prepare<[string], { id: string }>('SELECT id FROM projects WHERE slug = ?')
        .get(req.params.slug);

      if (!project) {
        return reply.status(404).send({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }

      const rows = db
        .prepare<[string], BackupRow>(
          'SELECT * FROM backups WHERE project_id = ? ORDER BY created_at DESC LIMIT 20'
        )
        .all(project.id);

      return reply.send({
        ok: true,
        data: rows.map((b) => ({
          id: b.id,
          filename: b.filename,
          sizeBytes: b.size_bytes,
          status: b.status,
          createdAt: b.created_at,
        })),
      });
    }
  );

  // GET /api/backups/latest  — last backup per project (for dashboard badges)
  fastify.get(
    '/api/backups/latest',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      const rows = db
        .prepare<[], { project_id: string; created_at: string }>(
          `SELECT project_id, MAX(created_at) as created_at
           FROM backups WHERE status = 'completed'
           GROUP BY project_id`
        )
        .all();

      const map: Record<string, string> = {};
      for (const row of rows) {
        map[row.project_id] = row.created_at;
      }
      return reply.send({ ok: true, data: map });
    }
  );
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';

const requireAuth = (req: FastifyRequest, reply: FastifyReply) =>
  (req.server as FastifyInstance).requireAuth(req, reply);

type TaskRow = {
  id: string;
  project_id: string;
  title: string;
  status: 'todo' | 'doing' | 'done';
  priority: number;
  position: number;
  created_at: string;
  updated_at: string;
};

function findProjectBySlug(slug: string): { id: string; slug: string } | undefined {
  return db
    .prepare<[string], { id: string; slug: string }>('SELECT id, slug FROM projects WHERE slug = ?')
    .get(slug);
}

export async function tasksRoutes(fastify: FastifyInstance) {
  // GET /api/tasks — all non-done tasks across all projects, with project info
  fastify.get<{ Querystring: { status?: string } }>(
    '/api/tasks',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const statusFilter = req.query.status;
      const validStatuses = ['todo', 'doing', 'done'];

      let tasks: (TaskRow & { project_name: string; project_slug: string; project_color: string })[];

      if (statusFilter && validStatuses.includes(statusFilter)) {
        tasks = db
          .prepare<[string], TaskRow & { project_name: string; project_slug: string; project_color: string }>(
            `SELECT t.id, t.project_id, t.title, t.status, t.priority, t.position, t.created_at, t.updated_at,
                    p.name AS project_name, p.slug AS project_slug, p.color AS project_color
             FROM tasks t
             JOIN projects p ON p.id = t.project_id
             WHERE t.status = ?
             ORDER BY t.priority ASC, t.created_at DESC`
          )
          .all(statusFilter);
      } else {
        tasks = db
          .prepare<[], TaskRow & { project_name: string; project_slug: string; project_color: string }>(
            `SELECT t.id, t.project_id, t.title, t.status, t.priority, t.position, t.created_at, t.updated_at,
                    p.name AS project_name, p.slug AS project_slug, p.color AS project_color
             FROM tasks t
             JOIN projects p ON p.id = t.project_id
             WHERE t.status IN ('todo', 'doing')
             ORDER BY t.priority ASC, t.created_at DESC`
          )
          .all();
      }

      return reply.send({ ok: true, data: tasks });
    }
  );

  fastify.get<{ Params: { slug: string } }>(
    '/api/projects/:slug/tasks',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const project = findProjectBySlug(req.params.slug);
      if (!project) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
      }

      const tasks = db
        .prepare<[string], TaskRow>(
          'SELECT id, project_id, title, status, priority, position, created_at, updated_at FROM tasks WHERE project_id = ? ORDER BY CASE status WHEN \'todo\' THEN 1 WHEN \'doing\' THEN 2 ELSE 3 END, position ASC, created_at DESC'
        )
        .all(project.id);

      return reply.send({ ok: true, data: tasks });
    }
  );

  fastify.post<{ Params: { slug: string }; Body: { title?: string; priority?: number } }>(
    '/api/projects/:slug/tasks',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const project = findProjectBySlug(req.params.slug);
      if (!project) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
      }

      const title = (req.body.title ?? '').trim();
      if (!title) {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_TITLE', message: 'Task title is required' } });
      }
      if (title.length > 240) {
        return reply.status(400).send({ ok: false, error: { code: 'TITLE_TOO_LONG', message: 'Task title is too long' } });
      }

      const priority = req.body.priority === 1 || req.body.priority === 2 || req.body.priority === 3 ? req.body.priority : 3;
      const positionRow = db
        .prepare<[string], { max_position: number | null }>('SELECT MAX(position) AS max_position FROM tasks WHERE project_id = ? AND status = \'todo\'')
        .get(project.id);
      const nextPosition = (positionRow?.max_position ?? -1) + 1;

      const id = uuidv4();
      db.prepare(
        'INSERT INTO tasks (id, project_id, title, status, priority, position) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, project.id, title, 'todo', priority, nextPosition);

      const task = db
        .prepare<[string], TaskRow>('SELECT id, project_id, title, status, priority, position, created_at, updated_at FROM tasks WHERE id = ?')
        .get(id);

      return reply.status(201).send({ ok: true, data: task });
    }
  );

  fastify.patch<{
    Params: { id: string };
    Body: { title?: string; status?: 'todo' | 'doing' | 'done'; priority?: number; position?: number };
  }>(
    '/api/tasks/:id',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const existing = db
        .prepare<[string], TaskRow>('SELECT id, project_id, title, status, priority, position, created_at, updated_at FROM tasks WHERE id = ?')
        .get(req.params.id);

      if (!existing) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Task not found' } });
      }

      const nextTitle = req.body.title !== undefined ? req.body.title.trim() : existing.title;
      if (!nextTitle) {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_TITLE', message: 'Task title cannot be empty' } });
      }

      const nextStatus = req.body.status ?? existing.status;
      if (!['todo', 'doing', 'done'].includes(nextStatus)) {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_STATUS', message: 'Invalid task status' } });
      }

      const nextPriority = req.body.priority === 1 || req.body.priority === 2 || req.body.priority === 3
        ? req.body.priority
        : existing.priority;

      const nextPosition = typeof req.body.position === 'number' && Number.isFinite(req.body.position)
        ? Math.max(0, Math.floor(req.body.position))
        : existing.position;

      db.prepare(
        'UPDATE tasks SET title = ?, status = ?, priority = ?, position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(nextTitle, nextStatus, nextPriority, nextPosition, req.params.id);

      const task = db
        .prepare<[string], TaskRow>('SELECT id, project_id, title, status, priority, position, created_at, updated_at FROM tasks WHERE id = ?')
        .get(req.params.id);

      return reply.send({ ok: true, data: task });
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/api/tasks/:id',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const existing = db.prepare<[string], { id: string }>('SELECT id FROM tasks WHERE id = ?').get(req.params.id);
      if (!existing) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Task not found' } });
      }

      db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
      return reply.send({ ok: true, data: { success: true } });
    }
  );
}

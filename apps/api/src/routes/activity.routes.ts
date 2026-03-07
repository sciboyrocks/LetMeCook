/**
 * activity.routes.ts — Activity tracking: heartbeat upsert + heatmap + per-project breakdown
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/index.js';

const requireAuth = (req: FastifyRequest, reply: FastifyReply) =>
  (req.server as FastifyInstance).requireAuth(req, reply);

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function activityRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/activity/heartbeat
   * Body: { projectId: string }
   * Upserts +2 minutes for the given project on today's date.
   */
  fastify.post<{ Body: { projectId?: string } }>(
    '/api/activity/heartbeat',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const projectId = (req.body.projectId ?? '').trim();
      if (!projectId) {
        return reply.status(400).send({ ok: false, error: { code: 'MISSING_PROJECT', message: 'projectId is required' } });
      }

      const project = db
        .prepare<[string], { id: string }>('SELECT id FROM projects WHERE id = ?')
        .get(projectId);
      if (!project) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
      }

      const date = todayDateStr();

      db.prepare(
        `INSERT INTO activity_logs (project_id, date, minutes)
         VALUES (?, ?, 2)
         ON CONFLICT(project_id, date) DO UPDATE SET
           minutes = minutes + 2,
           updated_at = CURRENT_TIMESTAMP`
      ).run(projectId, date);

      // Also touch last_opened_at on the project
      db.prepare('UPDATE projects SET last_opened_at = CURRENT_TIMESTAMP WHERE id = ?').run(projectId);

      const row = db
        .prepare<[string, string], { minutes: number }>(
          'SELECT minutes FROM activity_logs WHERE project_id = ? AND date = ?'
        )
        .get(projectId, date);

      return reply.send({ ok: true, data: { date, minutes: row?.minutes ?? 2 } });
    }
  );

  /**
   * GET /api/activity/heatmap?days=N
   * Returns daily totals for the last N days (default 365).
   * Shape: { date: string; count: number }[]
   */
  fastify.get<{ Querystring: { days?: string } }>(
    '/api/activity/heatmap',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const days = Math.min(Math.max(1, Number(req.query.days) || 365), 730);

      const rows = db
        .prepare<[number], { date: string; count: number }>(
          `SELECT date, SUM(minutes) as count
           FROM activity_logs
           WHERE date >= date('now', '-' || ? || ' days')
           GROUP BY date
           ORDER BY date ASC`
        )
        .all(days);

      return reply.send({ ok: true, data: rows });
    }
  );

  /**
   * GET /api/activity/project/:slug?days=N
   * Returns per-day minutes for a single project (last N days, default 30).
   */
  fastify.get<{ Params: { slug: string }; Querystring: { days?: string } }>(
    '/api/activity/project/:slug',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const project = db
        .prepare<[string], { id: string }>('SELECT id FROM projects WHERE slug = ?')
        .get(req.params.slug);
      if (!project) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
      }

      const days = Math.min(Math.max(1, Number(req.query.days) || 30), 365);

      const rows = db
        .prepare<[string, number], { date: string; minutes: number }>(
          `SELECT date, minutes
           FROM activity_logs
           WHERE project_id = ? AND date >= date('now', '-' || ? || ' days')
           ORDER BY date ASC`
        )
        .all(project.id, days);

      return reply.send({ ok: true, data: rows });
    }
  );

  /**
   * GET /api/activity/last-active
   * Returns the most recently active project (by heartbeat).
   */
  fastify.get(
    '/api/activity/last-active',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      const row = db
        .prepare<[], { project_id: string; date: string; minutes: number; name: string; slug: string }>(
          `SELECT a.project_id, a.date, a.minutes, p.name, p.slug
           FROM activity_logs a
           JOIN projects p ON p.id = a.project_id
           ORDER BY a.updated_at DESC
           LIMIT 1`
        )
        .get();

      if (!row) {
        return reply.send({ ok: true, data: null });
      }

      return reply.send({
        ok: true,
        data: {
          projectId: row.project_id,
          name: row.name,
          slug: row.slug,
          date: row.date,
          minutes: row.minutes,
        },
      });
    }
  );

  /**
   * GET /api/activity/weekly-summary
   * Returns stats for the current week: total minutes, top project, streak, projects worked on.
   * Used by the "Weekly Dev Wrapped" banner.
   */
  fastify.get(
    '/api/activity/weekly-summary',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      // Current week = last 7 days
      const totalRow = db
        .prepare<[], { total: number }>(
          `SELECT COALESCE(SUM(minutes), 0) as total
           FROM activity_logs
           WHERE date >= date('now', '-7 days')`
        )
        .get();

      const topProject = db
        .prepare<[], { project_id: string; name: string; slug: string; total: number }>(
          `SELECT a.project_id, p.name, p.slug, SUM(a.minutes) as total
           FROM activity_logs a
           JOIN projects p ON p.id = a.project_id
           WHERE a.date >= date('now', '-7 days')
           GROUP BY a.project_id
           ORDER BY total DESC
           LIMIT 1`
        )
        .get();

      const projectsWorkedOn = db
        .prepare<[], { cnt: number }>(
          `SELECT COUNT(DISTINCT project_id) as cnt
           FROM activity_logs
           WHERE date >= date('now', '-7 days')`
        )
        .get();

      // Streak: consecutive days with activity going backwards from today
      const recentDays = db
        .prepare<[], { date: string }>(
          `SELECT DISTINCT date FROM activity_logs
           WHERE date <= date('now')
           ORDER BY date DESC
           LIMIT 365`
        )
        .all()
        .map((r) => r.date);

      let streak = 0;
      const today = new Date();
      for (let i = 0; i < 365; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        if (recentDays.includes(dateStr)) {
          streak++;
        } else {
          break;
        }
      }

      return reply.send({
        ok: true,
        data: {
          totalMinutes: totalRow?.total ?? 0,
          topProject: topProject
            ? { name: topProject.name, slug: topProject.slug, minutes: topProject.total }
            : null,
          projectsWorkedOn: projectsWorkedOn?.cnt ?? 0,
          streak,
        },
      });
    }
  );
}

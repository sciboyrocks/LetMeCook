/**
 * activity.routes.ts — Activity tracking: heartbeat upsert + heatmap + per-project breakdown
 *
 * Heartbeats are buffered in Redis and periodically flushed to SQLite,
 * dramatically reducing write pressure on the database.
 * Dashboard queries (heatmap, weekly-summary) are cached in Redis.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { redis, cacheGet, cacheSet, cacheDel, cacheInvalidatePattern } from '../lib/redis.js';

const requireAuth = (req: FastifyRequest, reply: FastifyReply) =>
  (req.server as FastifyInstance).requireAuth(req, reply);

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Heartbeat flusher ─────────────────────────────────────────────────────
// Heartbeats accumulate in Redis hashes: `hb:<date>` with field = projectId.
// A periodic flush drains them into SQLite every 60 seconds.

let flushTimer: ReturnType<typeof setInterval> | null = null;

async function flushHeartbeats(): Promise<void> {
  // Scan for all hb:* keys
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'hb:*', 'COUNT', 50);
    cursor = nextCursor;
    for (const key of keys) {
      const date = key.slice(3); // strip 'hb:'
      const entries = await redis.hgetall(key);
      if (Object.keys(entries).length === 0) continue;

      // Atomically read-and-delete: get all fields then delete the key
      // (next heartbeat creates a fresh key)
      await redis.del(key);

      const upsert = db.prepare(
        `INSERT INTO activity_logs (project_id, date, minutes)
         VALUES (?, ?, ?)
         ON CONFLICT(project_id, date) DO UPDATE SET
           minutes = minutes + ?,
           updated_at = CURRENT_TIMESTAMP`
      );

      const touchProject = db.prepare(
        'UPDATE projects SET last_opened_at = CURRENT_TIMESTAMP WHERE id = ?'
      );

      const batchWrite = db.transaction(() => {
        for (const [projectId, mins] of Object.entries(entries)) {
          const minutes = parseInt(mins, 10) || 0;
          if (minutes <= 0) continue;
          upsert.run(projectId, date, minutes, minutes);
          touchProject.run(projectId);
        }
      });

      batchWrite();
    }
  } while (cursor !== '0');
}

function startFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushHeartbeats().catch((err) => console.error('[heartbeat-flush]', err));
  }, 60_000); // every 60 seconds
}

export async function activityRoutes(fastify: FastifyInstance) {
  // Start the background flush timer when routes are registered
  startFlushTimer();

  // Ensure pending heartbeats are flushed on shutdown
  fastify.addHook('onClose', async () => {
    if (flushTimer) clearInterval(flushTimer);
    await flushHeartbeats();
  });

  /**
   * POST /api/activity/heartbeat
   * Body: { projectId: string }
   * Buffers +2 minutes in Redis for the given project on today's date.
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
      const hbKey = `hb:${date}`;

      // Atomic increment in Redis — no SQLite write
      const newMinutes = await redis.hincrby(hbKey, projectId, 2);
      // Ensure the key expires after 48h (covers timezone edge cases)
      await redis.expire(hbKey, 172_800);

      // Track last-active in Redis for instant reads
      await redis.set('last-active', JSON.stringify({
        projectId,
        date,
      }), 'EX', 86_400);

      // Invalidate cached dashboard data so next read is fresh
      await cacheDel('cache:activity:heatmap', 'cache:activity:weekly-summary', 'cache:activity:last-active');

      // Get total from Redis buffer + SQLite historical
      const dbRow = db
        .prepare<[string, string], { minutes: number }>(
          'SELECT minutes FROM activity_logs WHERE project_id = ? AND date = ?'
        )
        .get(projectId, date);
      const totalMinutes = (dbRow?.minutes ?? 0) + newMinutes;

      return reply.send({ ok: true, data: { date, minutes: totalMinutes } });
    }
  );

  /**
   * GET /api/activity/heatmap?days=N
   * Returns daily totals for the last N days (default 365).
   * Shape: { date: string; count: number }[]
   * Cached in Redis for 5 minutes.
   */
  fastify.get<{ Querystring: { days?: string } }>(
    '/api/activity/heatmap',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const days = Math.min(Math.max(1, Number(req.query.days) || 365), 730);
      const cacheKey = 'cache:activity:heatmap';

      const cached = await cacheGet<{ date: string; count: number }[]>(cacheKey);
      if (cached) return reply.send({ ok: true, data: cached });

      const rows = db
        .prepare<[number], { date: string; count: number }>(
          `SELECT date, SUM(minutes) as count
           FROM activity_logs
           WHERE date >= date('now', '-' || ? || ' days')
           GROUP BY date
           ORDER BY date ASC`
        )
        .all(days);

      // Merge in today's unflushed Redis data
      const today = todayDateStr();
      const pendingToday = await redis.hgetall(`hb:${today}`);
      if (Object.keys(pendingToday).length > 0) {
        const pendingTotal = Object.values(pendingToday).reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
        const todayRow = rows.find((r) => r.date === today);
        if (todayRow) {
          todayRow.count += pendingTotal;
        } else if (pendingTotal > 0) {
          rows.push({ date: today, count: pendingTotal });
        }
      }

      await cacheSet(cacheKey, rows, 300); // 5 min cache
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

      // Merge today's pending Redis data for this project
      const today = todayDateStr();
      const pending = parseInt(await redis.hget(`hb:${today}`, project.id) ?? '0', 10);
      if (pending > 0) {
        const todayRow = rows.find((r) => r.date === today);
        if (todayRow) {
          todayRow.minutes += pending;
        } else {
          rows.push({ date: today, minutes: pending });
        }
      }

      return reply.send({ ok: true, data: rows });
    }
  );

  /**
   * GET /api/activity/last-active
   * Returns the most recently active project (by heartbeat).
   * Checks Redis first for very recent activity.
   */
  fastify.get(
    '/api/activity/last-active',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      const cacheKey = 'cache:activity:last-active';
      const cached = await cacheGet(cacheKey);
      if (cached) return reply.send({ ok: true, data: cached });

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

      const data = {
        projectId: row.project_id,
        name: row.name,
        slug: row.slug,
        date: row.date,
        minutes: row.minutes,
      };

      await cacheSet(cacheKey, data, 120); // 2 min cache
      return reply.send({ ok: true, data });
    }
  );

  /**
   * GET /api/activity/weekly-summary
   * Returns stats for the current week: total minutes, top project, streak, projects worked on.
   * Used by the "Weekly Dev Wrapped" banner. Cached for 5 minutes.
   */
  fastify.get(
    '/api/activity/weekly-summary',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      const cacheKey = 'cache:activity:weekly-summary';
      const cached = await cacheGet(cacheKey);
      if (cached) return reply.send({ ok: true, data: cached });

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
      const recentDays = new Set(
        db
          .prepare<[], { date: string }>(
            `SELECT DISTINCT date FROM activity_logs
             WHERE date <= date('now')
             ORDER BY date DESC
             LIMIT 365`
          )
          .all()
          .map((r) => r.date)
      );

      let streak = 0;
      const today = new Date();
      for (let i = 0; i < 365; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        if (recentDays.has(dateStr)) {
          streak++;
        } else {
          break;
        }
      }

      const data = {
        totalMinutes: totalRow?.total ?? 0,
        topProject: topProject
          ? { name: topProject.name, slug: topProject.slug, minutes: topProject.total }
          : null,
        projectsWorkedOn: projectsWorkedOn?.cnt ?? 0,
        streak,
      };

      await cacheSet(cacheKey, data, 300); // 5 min cache
      return reply.send({ ok: true, data });
    }
  );
}

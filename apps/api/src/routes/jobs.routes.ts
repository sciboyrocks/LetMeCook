import { createReadStream, existsSync } from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db/index.js';
import { redis, redisSub } from '../lib/redis.js';

const requireAuth = (req: FastifyRequest, reply: FastifyReply) =>
  (req.server as FastifyInstance).requireAuth(req, reply);

type JobRow = {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  timeout_ms: number;
  cancel_requested: number;
  payload_json: string;
  result_json: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
};

type JobLogRow = {
  id: number;
  level: string;
  message: string;
  created_at: string;
};

function readJob(jobId: string): JobRow | undefined {
  return db.prepare<[string], JobRow>('SELECT * FROM jobs WHERE id = ?').get(jobId);
}

function readLogs(jobId: string, lastId = 0): JobLogRow[] {
  return db
    .prepare<[string, number], JobLogRow>(
      'SELECT id, level, message, created_at FROM job_logs WHERE job_id = ? AND id > ? ORDER BY id ASC LIMIT 250'
    )
    .all(jobId, lastId);
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function serializeJob(job: JobRow) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    timeoutMs: job.timeout_ms,
    cancelRequested: Boolean(job.cancel_requested),
    payload: parseJson<Record<string, unknown>>(job.payload_json),
    result: parseJson<Record<string, unknown>>(job.result_json),
    error: job.error_message
      ? {
          code: job.error_code ?? 'JOB_FAILED',
          message: job.error_message,
        }
      : null,
    createdAt: job.created_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    updatedAt: job.updated_at,
  };
}

export async function jobsRoutes(fastify: FastifyInstance) {
  // GET /api/jobs — list jobs, optionally filtered by type and status
  fastify.get<{ Querystring: { type?: string; status?: string; limit?: string } }>(
    '/api/jobs',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { type, status } = req.query;
      const statusList = status ? status.split(',').map((s) => s.trim()).filter(Boolean) : null;
      const limit = Math.min(Math.max(1, parseInt(req.query.limit ?? '50', 10) || 50), 100);

      let jobs: JobRow[];
      if (type && statusList?.length) {
        const params = [type, ...statusList, limit];
        jobs = db
          .prepare(
            `SELECT * FROM jobs WHERE type = ? AND status IN (${statusList.map(() => '?').join(', ')}) ORDER BY created_at DESC LIMIT ?`
          )
          .all(...params) as JobRow[];
      } else if (type) {
        jobs = db
          .prepare<[string, number], JobRow>('SELECT * FROM jobs WHERE type = ? ORDER BY created_at DESC LIMIT ?')
          .all(type, limit);
      } else {
        jobs = db
          .prepare<[number], JobRow>('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?')
          .all(limit);
      }

      return reply.send({ ok: true, data: jobs.map(serializeJob) });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/api/jobs/:id',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const job = readJob(req.params.id);
      if (!job) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Job not found' } });
      }

      const logs = db
        .prepare<[string], JobLogRow>(
          'SELECT id, level, message, created_at FROM job_logs WHERE job_id = ? ORDER BY id DESC LIMIT 300'
        )
        .all(job.id)
        .reverse();

      return reply.send({
        ok: true,
        data: {
          job: serializeJob(job),
          logs,
        },
      });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/api/jobs/:id/cancel',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const job = readJob(req.params.id);
      if (!job) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Job not found' } });
      }
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        return reply.status(409).send({
          ok: false,
          error: { code: 'JOB_ALREADY_FINISHED', message: `Cannot cancel a ${job.status} job` },
        });
      }

      db.prepare(
        `UPDATE jobs
         SET cancel_requested = 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(job.id);

      // Also set cancel signal in Redis for fast worker pickup
      await redis.set(`job:cancel:${job.id}`, '1', 'EX', 3600);

      db.prepare('INSERT INTO job_logs (job_id, level, message) VALUES (?, ?, ?)').run(
        job.id,
        'warn',
        'Cancellation requested'
      );

      return reply.send({ ok: true, data: { id: job.id, cancelRequested: true } });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/api/jobs/:id/stream',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const jobId = req.params.id;
      const existing = readJob(jobId);
      if (!existing) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Job not found' } });
      }

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.hijack();

      const emit = (event: string, payload: unknown) => {
        reply.raw.write(`event: ${event}\n`);
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      // Send initial snapshot from DB (includes full log history)
      let lastLogId = 0;
      {
        const newLogs = readLogs(jobId, lastLogId);
        for (const log of newLogs) {
          lastLogId = log.id;
          emit('log', log);
        }
        emit('job', serializeJob(existing));

        if (existing.status === 'completed' || existing.status === 'failed' || existing.status === 'cancelled') {
          emit('done', { status: existing.status });
          reply.raw.end();
          return;
        }
      }

      emit('ready', { jobId });

      // Subscribe to Redis channel for real-time updates from the worker
      const channel = `job:${jobId}`;
      const sub = redisSub.duplicate();
      await sub.subscribe(channel);

      const onMessage = (ch: string, message: string) => {
        if (ch !== channel) return;
        try {
          const parsed = JSON.parse(message) as { event: string; data: unknown };
          emit(parsed.event, parsed.data);

          // Check if this is a terminal state
          if (parsed.event === 'job') {
            const patch = parsed.data as Record<string, unknown>;
            if (patch.status === 'completed' || patch.status === 'failed' || patch.status === 'cancelled') {
              emit('done', { status: patch.status });
              cleanup();
            }
          }
        } catch {}
      };

      sub.on('message', onMessage);

      // Fallback: poll every 5 seconds in case pub/sub misses something (e.g. reconnect)
      const fallback = setInterval(() => {
        try {
          const job = readJob(jobId);
          if (!job) {
            cleanup();
            return;
          }
          if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
            // Emit any final logs we missed
            const newLogs = readLogs(jobId, lastLogId);
            for (const log of newLogs) {
              lastLogId = log.id;
              emit('log', log);
            }
            emit('job', serializeJob(job));
            emit('done', { status: job.status });
            cleanup();
          }
        } catch {
          cleanup();
        }
      }, 5000);

      function cleanup() {
        clearInterval(fallback);
        sub.unsubscribe(channel).catch(() => {});
        sub.disconnect();
        try { reply.raw.end(); } catch {}
      }

      req.raw.on('close', () => {
        cleanup();
      });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/api/jobs/:id/download',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const job = readJob(req.params.id);
      if (!job) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Job not found' } });
      }
      if (job.type !== 'export-zip') {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_JOB_TYPE', message: 'Job is not an export-zip job' } });
      }
      if (job.status !== 'completed') {
        return reply.status(409).send({ ok: false, error: { code: 'JOB_NOT_READY', message: 'Export is not ready yet' } });
      }

      const result = parseJson<{ zipPath?: string; filename?: string }>(job.result_json);
      const zipPath = result?.zipPath;
      if (!zipPath || !existsSync(zipPath)) {
        return reply.status(404).send({ ok: false, error: { code: 'ZIP_NOT_FOUND', message: 'Export archive not found' } });
      }

      const filename = result?.filename ?? `${job.id}.zip`;
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(createReadStream(zipPath));
    }
  );
}
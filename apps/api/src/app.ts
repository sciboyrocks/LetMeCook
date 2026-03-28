import Fastify from 'fastify';
import securityPlugin from './plugins/security.plugin.js';
import authPlugin from './plugins/auth.plugin.js';
import { authRoutes } from './routes/auth.routes.js';
import { projectsRoutes } from './routes/projects.routes.js';
import { systemRoutes } from './routes/system.routes.js';
import { githubRoutes } from './routes/github.routes.js';
import { notesRoutes } from './routes/notes.routes.js';
import { quickLinksRoutes } from './routes/quick-links.routes.js';
import { jobsRoutes } from './routes/jobs.routes.js';
import { tasksRoutes } from './routes/tasks.routes.js';
import { activityRoutes } from './routes/activity.routes.js';
import { journalRoutes } from './routes/journal.routes.js';
import { backupsRoutes } from './routes/backups.routes.js';
import { codeServerProxy } from './proxy/code-server.js';
import { config } from './config.js';
import { startAuditFlusher, stopAuditFlusher, flushAuditLogs } from './lib/audit.js';
import { closeRedis } from './lib/redis.js';

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: config.isProd ? 'info' : 'debug',
      transport: config.isProd ? undefined : { target: 'pino-pretty' },
    },
    trustProxy: true,
  });

  // Plugins (order matters: security → auth → routes)
  await fastify.register(securityPlugin);
  await fastify.register(authPlugin);

  // Start background flushers
  startAuditFlusher();

  // Graceful shutdown: flush buffers + close Redis
  fastify.addHook('onClose', async () => {
    stopAuditFlusher();
    await flushAuditLogs();
    await closeRedis();
  });

  // Routes
  await fastify.register(authRoutes);
  await fastify.register(projectsRoutes);
  await fastify.register(systemRoutes);
  await fastify.register(githubRoutes);
  await fastify.register(notesRoutes);
  await fastify.register(quickLinksRoutes);
  await fastify.register(tasksRoutes);
  await fastify.register(activityRoutes);
  await fastify.register(journalRoutes);
  await fastify.register(backupsRoutes);
  await fastify.register(jobsRoutes);
  await fastify.register(codeServerProxy);

  // Standard 404
  fastify.setNotFoundHandler((_req, reply) => {
    return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  // Standard error handler
  fastify.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
    fastify.log.error(err);
    const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.status(statusCode).send({
      ok: false,
      error: { code: err.code ?? 'INTERNAL_ERROR', message: err.message ?? 'Internal server error' },
    });
  });

  return fastify;
}

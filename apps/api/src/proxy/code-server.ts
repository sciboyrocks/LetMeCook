import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { db } from '../db/index.js';
import { config } from '../config.js';

const CODE_SERVER_HOST = config.codeServerHost;
const CODE_SERVER_PORT = config.codeServerPort;

function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  return (req.server as FastifyInstance).requireAuth(req, reply);
}

/**
 * Registers the /code/:projectId proxy routes.
 * WebSocket upgrade is handled in index.ts via the raw http.Server.
 */
export async function codeServerProxy(fastify: FastifyInstance) {
  fastify.all<{ Params: { projectId: string } }>(
    '/code/:projectId',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { projectId } = req.params;

      const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
      if (!existing) return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });

      const targetPath = `/${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
      await proxyRequest(req, reply, targetPath);
    }
  );

  // Prevalidate project exists for initial page load, then stream everything else
  fastify.all<{ Params: { projectId: string; '*': string } }>(
    '/code/:projectId/*',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { projectId } = req.params;
      const restPath = (req.params as Record<string, string>)['*'] ?? '';

      // On the root load, verify the project
      if (restPath === '' || restPath === '/') {
        const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
        if (!existing) return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
      }

      const targetPath = `/${restPath}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;

      await proxyRequest(req, reply, targetPath);
    }
  );

  // code-server static asset routes
  for (const prefix of ['/stable-', '/vscode-remote-resource', '/_static', '/out']) {
    fastify.all<{ Params: { '*': string } }>(
      `${prefix}/*`,
      { preHandler: [fastify.requireAuth as typeof requireAuth] },
      async (req, reply) => {
        await proxyRequest(req, reply, req.url);
      }
    );
  }
}

async function proxyRequest(req: FastifyRequest, reply: FastifyReply, targetPath: string): Promise<void> {
  return new Promise((resolve) => {
    const options = {
      hostname: CODE_SERVER_HOST,
      port: CODE_SERVER_PORT,
      path: targetPath || '/',
      method: req.method,
      headers: {
        ...req.headers,
        host: `${CODE_SERVER_HOST}:${CODE_SERVER_PORT}`,
      },
    };

    const proxyReq = httpRequest(options, (proxyRes) => {
      delete (proxyRes.headers as Record<string, unknown>)['content-security-policy'];
      delete (proxyRes.headers as Record<string, unknown>)['x-frame-options'];

      reply.raw.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
      proxyRes.pipe(reply.raw, { end: true });
      proxyRes.on('end', resolve);
    });

    proxyReq.on('error', (err) => {
      req.log.error(`Proxy error: ${err.message}`);
      if (!reply.sent) {
        reply.status(502).send('code-server is starting up... please refresh.');
      }
      resolve();
    });

    if (req.body && typeof req.body === 'object') {
      const body = JSON.stringify(req.body);
      proxyReq.write(body);
    }
    proxyReq.end();
  });
}

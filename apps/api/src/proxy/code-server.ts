import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db/index.js';
import { config } from '../config.js';

const CODE_SERVER_HOST = config.codeServerHost;
const CODE_SERVER_PORT = config.codeServerPort;

// Pre-load the logo for favicon serving.
const __dirname = dirname(fileURLToPath(import.meta.url));
const logoCandidates = [
  join(__dirname, '..', 'logo.png'),
  join(__dirname, '..', '..', '..', 'web', 'public', 'logo.png'),
  join(__dirname, '..', '..', '..', '..', 'web', 'public', 'logo.png'),
  join(process.cwd(), '..', 'web', 'public', 'logo.png'),
  join(process.cwd(), 'apps', 'web', 'public', 'logo.png'),
];
const logoPath = logoCandidates.find((candidate) => existsSync(candidate));
const logoBuf = logoPath ? readFileSync(logoPath) : null;

function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  return (req.server as FastifyInstance).requireAuth(req, reply);
}

/**
 * Registers the /code/:projectId proxy routes.
 * WebSocket upgrade is handled in index.ts via the raw http.Server.
 */
export async function codeServerProxy(fastify: FastifyInstance) {
  // code-server's built-in port-forwarding proxy routes (/proxy/<port> and
  // /absproxy/<port>).  These must be registered before the parametric
  // /code/:projectId routes so that "/code/proxy/3000" isn't misinterpreted
  // as projectId="proxy".  Fastify gives static segments priority over
  // parametric ones at the same tree level, so these will match first.
  for (const proxyPrefix of ['proxy', 'absproxy']) {
    fastify.all<{ Params: { '*': string } }>(
      `/code/${proxyPrefix}/*`,
      { preHandler: [fastify.requireAuth as typeof requireAuth] },
      async (req, reply) => {
        const rest = (req.params as Record<string, string>)['*'] ?? '';
        const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        const targetPath = `/${proxyPrefix}/${rest}${qs}`;
        await proxyRequest(req, reply, targetPath);
      }
    );
  }

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

  // Serve the LetMeCook logo as the favicon (no auth required for browser fetches)
  fastify.get('/favicon.ico', { config: { rawBody: false } }, async (_req, reply) => {
    if (logoBuf) {
      return reply.header('cache-control', 'public, max-age=86400').type('image/png').send(logoBuf);
    }
    return reply.status(404).send();
  });

  fastify.get('/logo.png', { config: { rawBody: false } }, async (_req, reply) => {
    if (logoBuf) {
      return reply.header('cache-control', 'public, max-age=86400').type('image/png').send(logoBuf);
    }
    return reply.status(404).send();
  });
}

async function proxyRequest(req: FastifyRequest, reply: FastifyReply, targetPath: string): Promise<void> {
  // Tell Fastify we're handling the response ourselves (prevents Helmet CSP injection)
  reply.hijack();

  return new Promise((resolve) => {
    const options = {
      hostname: CODE_SERVER_HOST,
      port: CODE_SERVER_PORT,
      path: targetPath || '/',
      method: req.method,
      headers: {
        ...req.headers,
        host: `${CODE_SERVER_HOST}:${CODE_SERVER_PORT}`,
        // Remove accept-encoding so code-server sends uncompressed responses
        // (needed for HTML injection of favicon link)
        'accept-encoding': 'identity',
      },
    };

    const proxyReq = httpRequest(options, (proxyRes) => {
      delete (proxyRes.headers as Record<string, unknown>)['content-security-policy'];
      delete (proxyRes.headers as Record<string, unknown>)['x-frame-options'];

      const contentType = proxyRes.headers['content-type'] || '';
      const isHtml = contentType.includes('text/html');

      if (isHtml && logoBuf) {
        // Buffer HTML responses to inject our favicon
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf-8');
          // Remove CSP meta tags (the HTTP header is already stripped above)
          // so the injected favicon can load without being blocked.
          html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>\s*/gi, '');
          // Remove existing icon links and inject the LetMeCook favicon.
          html = html.replace(/<link[^>]+rel=["'](?:icon|shortcut icon|alternate icon)["'][^>]*>\s*/gi, '');
          const iconTags = '<link rel="icon" type="image/png" href="/favicon.ico"><link rel="shortcut icon" href="/favicon.ico">';
          if (/<\/head>/i.test(html)) {
            html = html.replace(/<\/head>/i, `${iconTags}</head>`);
          } else {
            html = `${iconTags}${html}`;
          }
          const buf = Buffer.from(html, 'utf-8');
          const headers = { ...proxyRes.headers };
          delete (headers as Record<string, unknown>)['transfer-encoding'];
          headers['content-length'] = String(buf.length);
          reply.raw.writeHead(proxyRes.statusCode ?? 200, headers);
          reply.raw.end(buf);
          resolve();
        });
      } else {
        reply.raw.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
        proxyRes.pipe(reply.raw, { end: true });
        proxyRes.on('end', resolve);
      }
    });

    proxyReq.on('error', (err) => {
      req.log.error(`Proxy error: ${err.message}`);
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(502, { 'content-type': 'text/plain' });
        reply.raw.end('code-server is starting up... please refresh.');
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

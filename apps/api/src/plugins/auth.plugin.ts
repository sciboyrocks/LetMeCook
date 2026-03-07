import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import { db } from '../db/index.js';
import { config } from '../config.js';

declare module 'fastify' {
  interface Session {
    authenticated: boolean;
    loginTime: number;
    ip: string;
  }
}

async function authPlugin(fastify: FastifyInstance) {
  await fastify.register(fastifyCookie);
  await fastify.register(fastifySession, {
    secret: config.sessionSecret,
    cookieName: '__lmc_sid',
    cookie: {
      secure: config.isProd,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24h
      sameSite: 'lax',
      ...(config.isProd && { domain: config.domain }),
    },
    saveUninitialized: false,
  });

  // Decorator: requireAuth — use as a preHandler hook
  // Accepts either a valid session cookie OR a matching X-API-Key header.
  fastify.decorate(
    'requireAuth',
    async function (req: FastifyRequest, reply: FastifyReply) {
      // API key auth (for VS Code extension and automated clients)
      const apiKey = req.headers['x-api-key'];
      if (config.apiKey && typeof apiKey === 'string' && apiKey === config.apiKey) {
        return; // authorized via API key
      }

      if (!req.session?.authenticated) {
        return reply.status(401).send({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      }
    }
  );
}

export default fp(authPlugin, { name: 'auth' });

// Helper exported for routes
export function getTotpSecret(): string | null {
  const row = db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?').get('totp_secret');
  return row?.value ?? null;
}

export function setTotpSecret(secret: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('totp_secret', secret);
}

export function isSetupComplete(): boolean {
  return getTotpSecret() !== null;
}

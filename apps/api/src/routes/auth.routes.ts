import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import { db } from '../db/index.js';
import { getTotpSecret, setTotpSecret, isSetupComplete } from '../plugins/auth.plugin.js';

// Helpers
function normalizeIP(req: FastifyRequest): string {
  const ip = req.ip ?? '0.0.0.0';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export async function authRoutes(fastify: FastifyInstance) {
  // Rate limiter config for login endpoints
  const loginRateLimit = { max: 5, timeWindow: '15 minutes', skipSuccessfulRequests: true };

  // POST /api/setup
  fastify.post('/api/setup', async (_req, reply) => {
    if (isSetupComplete()) {
      return reply.status(400).send({ ok: false, error: { code: 'ALREADY_SETUP', message: 'Already set up' } });
    }
    const secret = generateSecret();
    setTotpSecret(secret);
    const otpauth = generateURI({ issuer: 'LetMeCook', label: 'admin', secret });
    const qrDataUrl = await QRCode.toDataURL(otpauth);
    return reply.send({ ok: true, data: { secret, qrDataUrl, otpauth } });
  });

  // POST /api/login
  fastify.post<{ Body: { token: string } }>(
    '/api/login',
    { config: { rateLimit: loginRateLimit } },
    async (req, reply) => {
      const { token } = req.body;
      const secret = getTotpSecret();

      if (!secret) {
        return reply.status(400).send({ ok: false, error: { code: 'NOT_SETUP', message: 'TOTP not set up. Visit /setup first.' } });
      }

      if (!token || typeof token !== 'string' || token.length !== 6) {
        db.prepare('INSERT INTO login_attempts (ip, success) VALUES (?, 0)').run(normalizeIP(req));
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_TOKEN_FORMAT', message: 'Invalid token format' } });
      }

      const result = verifySync({ secret, token });

      db.prepare('INSERT INTO login_attempts (ip, success) VALUES (?, ?)').run(normalizeIP(req), result.valid ? 1 : 0);

      if (!result.valid) {
        const recentFails = db
          .prepare<[string], { cnt: number }>(
            "SELECT COUNT(*) as cnt FROM login_attempts WHERE ip = ? AND success = 0 AND attempted_at > datetime('now', '-1 hour')"
          )
          .get(normalizeIP(req));
        return reply.status(401).send({
          ok: false,
          error: { code: 'INVALID_CODE', message: 'Invalid TOTP code' },
          remaining: Math.max(0, 5 - (recentFails?.cnt ?? 0)),
        });
      }

      await req.session.regenerate();
      req.session.authenticated = true;
      req.session.loginTime = Date.now();
      req.session.ip = normalizeIP(req);

      return reply.send({ ok: true, data: { success: true } });
    }
  );

  // POST /api/logout
  fastify.post('/api/logout', async (req, reply) => {
    await req.session.destroy();
    return reply.send({ ok: true, data: { success: true } });
  });

  // GET /api/auth/status
  fastify.get('/api/auth/status', async (req, reply) => {
    return reply.send({
      ok: true,
      data: {
        authenticated: !!req.session?.authenticated,
        setupComplete: isSetupComplete(),
      },
    });
  });

  // POST /api/reset-totp  (requires auth + valid current token)
  fastify.post<{ Body: { currentToken: string } }>(
    '/api/reset-totp',
    {
      preHandler: [fastify.requireAuth as (req: FastifyRequest, reply: FastifyReply) => Promise<void>],
      config: { rateLimit: loginRateLimit },
    },
    async (req, reply) => {
      const { currentToken } = req.body;
      const secret = getTotpSecret();
      if (!secret) return reply.status(400).send({ ok: false, error: { code: 'NOT_SETUP', message: 'Not set up' } });

      const check = verifySync({ secret, token: currentToken });
      if (!check.valid) {
        return reply.status(401).send({ ok: false, error: { code: 'INVALID_CODE', message: 'Current TOTP invalid' } });
      }

      const newSecret = generateSecret();
      setTotpSecret(newSecret);
      const otpauth = generateURI({ issuer: 'LetMeCook', label: 'admin', secret: newSecret });
      const qrDataUrl = await QRCode.toDataURL(otpauth);

      return reply.send({ ok: true, data: { secret: newSecret, qrDataUrl, otpauth } });
    }
  );
}

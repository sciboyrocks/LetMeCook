import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import fastifyHelmet from '@fastify/helmet';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import { config } from '../config.js';
import { redis } from '../lib/redis.js';

async function securityPlugin(fastify: FastifyInstance) {
  await fastify.register(fastifyHelmet, {
    strictTransportSecurity: config.isProd
      ? { maxAge: 15552000, includeSubDomains: true, preload: true }
      : false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://static.cloudflareinsights.com'],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'", 'ws:', 'wss:', `wss://${config.domain}`, `https://${config.domain}`],
        frameSrc: ["'self'"],
        frameAncestors: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        childSrc: ["'self'", 'blob:'],
        mediaSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false,
  });

  await fastify.register(fastifyCors, {
    origin: config.isProd ? [`https://${config.domain}`] : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key'],
  });

  await fastify.register(fastifyRateLimit, {
    global: true,
    max: 2000,
    timeWindow: '15 minutes',
    redis,
    skipOnError: true,
    keyGenerator: (req) => {
      const ip = req.ip ?? '0.0.0.0';
      return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    },
    errorResponseBuilder: () => ({
      ok: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' },
    }),
  });
}

export default fp(securityPlugin, { name: 'security' });

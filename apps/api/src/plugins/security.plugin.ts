import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import fastifyHelmet from '@fastify/helmet';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import { config } from '../config.js';

async function securityPlugin(fastify: FastifyInstance) {
  await fastify.register(fastifyHelmet, {
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
  });

  await fastify.register(fastifyRateLimit, {
    global: true,
    max: 300,
    timeWindow: '15 minutes',
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

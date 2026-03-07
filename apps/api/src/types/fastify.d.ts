import type { FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}

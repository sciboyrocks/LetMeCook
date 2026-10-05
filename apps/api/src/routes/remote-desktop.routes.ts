import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import net from 'node:net';
import { db } from '../db/index.js';
import { encryptSecret, decryptSecret } from '../lib/vault.js';
import { createVncTicket } from '../proxy/vnc-proxy.js';

const requireAuth = (req: FastifyRequest, reply: FastifyReply) =>
  (req.server as FastifyInstance).requireAuth(req, reply);

const PERFORMANCE_MODES = ['fast', 'balanced', 'quality', 'custom'];

interface ConnectionRow {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password_cipher: string | null;
  color: string;
  view_only: number;
  quality: number;
  compression: number;
  scale_mode: string;
  performance_mode: string;
  show_dot_cursor: number;
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
}

function formatConnection(row: ConnectionRow) {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    hasPassword: Boolean(row.password_cipher),
    color: row.color,
    viewOnly: Boolean(row.view_only),
    quality: row.quality,
    compression: row.compression,
    scaleMode: row.scale_mode,
    performanceMode: row.performance_mode,
    showDotCursor: Boolean(row.show_dot_cursor),
    lastConnectedAt: row.last_connected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function remoteDesktopRoutes(fastify: FastifyInstance) {
  // GET /api/remote-desktop/connections
  fastify.get(
    '/api/remote-desktop/connections',
    { preHandler: [requireAuth] },
    async (_req, reply) => {
      const rows = db
        .prepare<[], ConnectionRow>(
          'SELECT * FROM remote_desktop_connections ORDER BY updated_at DESC'
        )
        .all();
      return reply.send({ ok: true, data: rows.map(formatConnection) });
    }
  );

  // POST /api/remote-desktop/connections
  fastify.post<{
    Body: {
      name?: string;
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      color?: string;
      viewOnly?: boolean;
      quality?: number;
      compression?: number;
      scaleMode?: string;
      performanceMode?: string;
      showDotCursor?: boolean;
    };
  }>(
    '/api/remote-desktop/connections',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const {
        name,
        host,
        port = 5900,
        username = '',
        password,
        color = '#f97316',
        viewOnly = false,
        quality = 2,
        compression = 1,
        scaleMode = 'fit',
        performanceMode = 'fast',
        showDotCursor = true,
      } = req.body ?? {};

      const trimmedName = (name ?? '').trim();
      const trimmedHost = (host ?? '').trim();

      if (!trimmedName) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'INVALID_NAME', message: 'Connection name is required' },
        });
      }

      if (!trimmedHost) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'INVALID_HOST', message: 'Host address is required' },
        });
      }

      const parsedPort = Number(port);
      if (isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'INVALID_PORT', message: 'Port must be between 1 and 65535' },
        });
      }

      const id = uuidv4();
      const passwordCipher = password ? encryptSecret(password) : null;

      const numQuality = Number(quality);
      const numCompression = Number(compression);
      const safeQuality = Math.min(9, Math.max(0, isNaN(numQuality) ? 2 : Math.round(numQuality)));
      const safeCompression = Math.min(9, Math.max(0, isNaN(numCompression) ? 1 : Math.round(numCompression)));

      db.prepare(
        `INSERT INTO remote_desktop_connections (
          id, name, host, port, username, password_cipher,
          color, view_only, quality, compression, scale_mode,
          performance_mode, show_dot_cursor, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).run(
        id,
        trimmedName,
        trimmedHost,
        parsedPort,
        (username ?? '').trim(),
        passwordCipher,
        color,
        viewOnly ? 1 : 0,
        safeQuality,
        safeCompression,
        ['fit', 'original', 'stretch'].includes(scaleMode) ? scaleMode : 'fit',
        PERFORMANCE_MODES.includes(performanceMode) ? performanceMode : 'fast',
        showDotCursor ? 1 : 0
      );

      const created = db
        .prepare<[string], ConnectionRow>(
          'SELECT * FROM remote_desktop_connections WHERE id = ?'
        )
        .get(id);

      if (!created) {
        return reply.status(500).send({
          ok: false,
          error: { code: 'INSERT_FAILED', message: 'Failed to create connection' },
        });
      }

      return reply.status(201).send({ ok: true, data: formatConnection(created) });
    }
  );

  // GET /api/remote-desktop/connections/:id
  fastify.get<{ Params: { id: string } }>(
    '/api/remote-desktop/connections/:id',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const { id } = req.params;
      const row = db
        .prepare<[string], ConnectionRow>(
          'SELECT * FROM remote_desktop_connections WHERE id = ?'
        )
        .get(id);

      if (!row) {
        return reply.status(404).send({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Connection not found' },
        });
      }

      return reply.send({ ok: true, data: formatConnection(row) });
    }
  );

  // PUT /api/remote-desktop/connections/:id
  fastify.post<{
    Params: { id: string };
    Body: {
      name?: string;
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      clearPassword?: boolean;
      color?: string;
      viewOnly?: boolean;
      quality?: number;
      compression?: number;
      scaleMode?: string;
      performanceMode?: string;
      showDotCursor?: boolean;
    };
  }>(
    '/api/remote-desktop/connections/:id',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const { id } = req.params;
      const existing = db
        .prepare<[string], ConnectionRow>(
          'SELECT * FROM remote_desktop_connections WHERE id = ?'
        )
        .get(id);

      if (!existing) {
        return reply.status(404).send({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Connection not found' },
        });
      }

      const body = req.body ?? {};
      const name = body.name !== undefined ? body.name.trim() : existing.name;
      const host = body.host !== undefined ? body.host.trim() : existing.host;

      if (!name) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'INVALID_NAME', message: 'Connection name cannot be empty' },
        });
      }
      if (!host) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'INVALID_HOST', message: 'Host cannot be empty' },
        });
      }

      let port = existing.port;
      if (body.port !== undefined) {
        const parsed = Number(body.port);
        if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
          return reply.status(400).send({
            ok: false,
            error: { code: 'INVALID_PORT', message: 'Port must be between 1 and 65535' },
          });
        }
        port = parsed;
      }

      let passwordCipher = existing.password_cipher;
      if (body.clearPassword) {
        passwordCipher = null;
      } else if (body.password) {
        passwordCipher = encryptSecret(body.password);
      }

      const username = body.username !== undefined ? body.username.trim() : existing.username;
      const color = body.color !== undefined ? body.color : existing.color;
      const viewOnly = body.viewOnly !== undefined ? (body.viewOnly ? 1 : 0) : existing.view_only;
      const quality = body.quality !== undefined
        ? Math.min(9, Math.max(0, isNaN(Number(body.quality)) ? 2 : Math.round(Number(body.quality))))
        : existing.quality;
      const compression = body.compression !== undefined
        ? Math.min(9, Math.max(0, isNaN(Number(body.compression)) ? 1 : Math.round(Number(body.compression))))
        : existing.compression;
      const scaleMode = body.scaleMode !== undefined && ['fit', 'original', 'stretch'].includes(body.scaleMode)
        ? body.scaleMode
        : existing.scale_mode;
      const performanceMode = body.performanceMode !== undefined && PERFORMANCE_MODES.includes(body.performanceMode)
        ? body.performanceMode
        : existing.performance_mode;
      const showDotCursor = body.showDotCursor !== undefined ? (body.showDotCursor ? 1 : 0) : existing.show_dot_cursor;

      db.prepare(
        `UPDATE remote_desktop_connections SET
          name = ?, host = ?, port = ?, username = ?,
          password_cipher = ?, color = ?, view_only = ?,
          quality = ?, compression = ?, scale_mode = ?,
          performance_mode = ?, show_dot_cursor = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`
      ).run(
        name,
        host,
        port,
        username,
        passwordCipher,
        color,
        viewOnly,
        quality,
        compression,
        scaleMode,
        performanceMode,
        showDotCursor,
        id
      );

      const updated = db
        .prepare<[string], ConnectionRow>(
          'SELECT * FROM remote_desktop_connections WHERE id = ?'
        )
        .get(id);

      return reply.send({ ok: true, data: formatConnection(updated!) });
    }
  );

  // DELETE /api/remote-desktop/connections/:id
  fastify.delete<{ Params: { id: string } }>(
    '/api/remote-desktop/connections/:id',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const { id } = req.params;
      const res = db
        .prepare('DELETE FROM remote_desktop_connections WHERE id = ?')
        .run(id);

      if (res.changes === 0) {
        return reply.status(404).send({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Connection not found' },
        });
      }

      return reply.send({ ok: true, data: { success: true } });
    }
  );

  // POST /api/remote-desktop/connections/:id/token
  // Issues a short-lived one-time ticket to establish WebSocket connection and
  // retrieves saved decrypted credentials for the authenticated session.
  fastify.post<{ Params: { id: string } }>(
    '/api/remote-desktop/connections/:id/token',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const { id } = req.params;
      const row = db
        .prepare<[string], ConnectionRow>(
          'SELECT * FROM remote_desktop_connections WHERE id = ?'
        )
        .get(id);

      if (!row) {
        return reply.status(404).send({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Connection not found' },
        });
      }

      let password: string | null = null;
      if (row.password_cipher) {
        try {
          password = decryptSecret(row.password_cipher);
        } catch {
          password = null;
        }
      }

      const token = createVncTicket(row.id, {
        host: row.host,
        port: row.port,
        username: row.username || '',
      });

      return reply.send({
        ok: true,
        data: {
          token,
          connection: {
            ...formatConnection(row),
            password,
          },
        },
      });
    }
  );

  // POST /api/remote-desktop/test
  // TCP connectivity probe to test if VNC host:port is reachable
  fastify.post<{
    Body: { host: string; port?: number };
  }>(
    '/api/remote-desktop/test',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const { host, port = 5900 } = req.body ?? {};
      const trimmedHost = (host ?? '').trim();
      const parsedPort = Number(port) || 5900;

      if (!trimmedHost) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'INVALID_HOST', message: 'Host is required' },
        });
      }

      const startTime = Date.now();

      try {
        const result = await new Promise<{
          reachable: boolean;
          banner?: string;
          latencyMs: number;
          error?: string;
        }>((resolve) => {
          const socket = net.createConnection({ host: trimmedHost, port: parsedPort });
          socket.setTimeout(4000);

          let resolved = false;
          let banner = '';

          const done = (data: { reachable: boolean; banner?: string; latencyMs: number; error?: string }) => {
            if (resolved) return;
            resolved = true;
            try { socket.destroy(); } catch {}
            resolve(data);
          };

          socket.on('connect', () => {
            // Wait up to 1000ms for RFB handshake banner
            const timer = setTimeout(() => {
              done({
                reachable: true,
                banner: banner || 'Port open',
                latencyMs: Date.now() - startTime,
              });
            }, 1000);

            socket.on('data', (chunk) => {
              clearTimeout(timer);
              banner += chunk.toString('utf8');
              done({
                reachable: true,
                banner: banner.trim(),
                latencyMs: Date.now() - startTime,
              });
            });
          });

          socket.on('timeout', () => {
            done({
              reachable: false,
              latencyMs: Date.now() - startTime,
              error: 'Connection timed out (4s)',
            });
          });

          socket.on('error', (err) => {
            done({
              reachable: false,
              latencyMs: Date.now() - startTime,
              error: err.message,
            });
          });
        });

        return reply.send({
          ok: true,
          data: result,
        });
      } catch (err: any) {
        return reply.send({
          ok: true,
          data: {
            reachable: false,
            latencyMs: Date.now() - startTime,
            error: err.message ?? 'Unknown error',
          },
        });
      }
    }
  );
}

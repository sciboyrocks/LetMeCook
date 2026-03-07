import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { spawn, type ChildProcess } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { audit } from '../lib/audit.js';

const requireAuth = (req: FastifyRequest, reply: FastifyReply) =>
  (req.server as FastifyInstance).requireAuth(req, reply);

type TunnelRow = {
  id: string;
  project_id: string | null;
  port: number;
  url: string | null;
  pid: number | null;
  status: 'starting' | 'active' | 'stopped' | 'error';
  error_msg: string | null;
  created_at: string;
  updated_at: string;
};

// In-memory map of active child processes keyed by tunnel ID
const tunnelProcesses = new Map<string, ChildProcess>();

// In-memory log buffer: up to 500 lines per tunnel
const tunnelLogs = new Map<string, string[]>();
const MAX_LOG_LINES = 500;

function appendLog(tunnelId: string, line: string) {
  let lines = tunnelLogs.get(tunnelId);
  if (!lines) {
    lines = [];
    tunnelLogs.set(tunnelId, lines);
  }
  lines.push(line);
  if (lines.length > MAX_LOG_LINES) lines.splice(0, lines.length - MAX_LOG_LINES);
}

function cleanupProcess(tunnelId: string) {
  const proc = tunnelProcesses.get(tunnelId);
  if (proc && !proc.killed) {
    proc.kill('SIGTERM');
  }
  tunnelProcesses.delete(tunnelId);
}

export async function tunnelsRoutes(fastify: FastifyInstance) {
  // POST /api/tunnels/expose — start a new cloudflared quick tunnel
  fastify.post<{ Body: { port: number; projectId?: string } }>(
    '/api/tunnels/expose',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { port, projectId } = req.body ?? {};

      if (!port || !Number.isInteger(port) || port < 1 || port > 65535) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'INVALID_PORT', message: 'Port must be an integer between 1 and 65535' },
        });
      }

      // Check for duplicate active tunnel on the same port
      const existing = db
        .prepare<[number], TunnelRow>(
          "SELECT * FROM tunnels WHERE port = ? AND status IN ('starting', 'active')"
        )
        .get(port);
      if (existing) {
        return reply.status(409).send({
          ok: false,
          error: { code: 'PORT_ALREADY_TUNNELED', message: `Port ${port} already has an active tunnel` },
        });
      }

      // Validate project if provided
      if (projectId) {
        const proj = db.prepare<[string], { id: string }>('SELECT id FROM projects WHERE id = ?').get(projectId);
        if (!proj) {
          return reply.status(404).send({
            ok: false,
            error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
          });
        }
      }

      const id = uuidv4();
      db.prepare(
        'INSERT INTO tunnels (id, project_id, port, status) VALUES (?, ?, ?, ?)'
      ).run(id, projectId ?? null, port, 'starting');

      // Spawn cloudflared in the background
      const child = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`, '--http2-origin'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      tunnelProcesses.set(id, child);

      if (child.pid) {
        db.prepare('UPDATE tunnels SET pid = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(child.pid, id);
      }

      let urlFound = false;

      const handleOutput = (chunk: Buffer) => {
        const text = chunk.toString();
        // Store each line in the log buffer
        text.split('\n').forEach((line) => {
          const trimmed = line.trim();
          if (trimmed) appendLog(id, trimmed);
        });
        // cloudflared outputs the URL to stderr typically
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match && !urlFound) {
          urlFound = true;
          db.prepare(
            "UPDATE tunnels SET url = ?, status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
          ).run(match[0], id);
        }
      };

      child.stdout?.on('data', handleOutput);
      child.stderr?.on('data', handleOutput);

      child.on('close', (code) => {
        tunnelProcesses.delete(id);
        const current = db.prepare<[string], TunnelRow>('SELECT * FROM tunnels WHERE id = ?').get(id);
        if (current && current.status !== 'stopped') {
          db.prepare(
            "UPDATE tunnels SET status = ?, error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
          ).run(
            code === 0 ? 'stopped' : 'error',
            code !== 0 ? `cloudflared exited with code ${code}` : null,
            id
          );
        }
      });

      child.on('error', (err) => {
        tunnelProcesses.delete(id);
        db.prepare(
          "UPDATE tunnels SET status = 'error', error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).run(err.message, id);
      });

      audit(req, 'tunnel.expose', 'tunnel', id, `port=${port}`);

      // Wait for URL to appear (cloudflared typically outputs it within 5–8s)
      await new Promise((resolve) => {
        const deadline = Date.now() + 12_000;
        const check = () => {
          if (urlFound || Date.now() > deadline) return resolve(undefined);
          setTimeout(check, 500);
        };
        check();
      });

      const tunnel = db.prepare<[string], TunnelRow>('SELECT * FROM tunnels WHERE id = ?').get(id);
      return reply.send({ ok: true, data: serializeTunnel(tunnel!) });
    }
  );

  // GET /api/tunnels — list all tunnels
  fastify.get(
    '/api/tunnels',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      const rows = db
        .prepare<[], TunnelRow>('SELECT * FROM tunnels ORDER BY created_at DESC')
        .all();
      return reply.send({ ok: true, data: rows.map(serializeTunnel) });
    }
  );

  // GET /api/tunnels/active — list only active tunnels
  fastify.get(
    '/api/tunnels/active',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      const rows = db
        .prepare<[], TunnelRow>(
          "SELECT * FROM tunnels WHERE status IN ('starting', 'active') ORDER BY created_at DESC"
        )
        .all();
      return reply.send({ ok: true, data: rows.map(serializeTunnel) });
    }
  );

  // GET /api/tunnels/:id/logs — return buffered log lines for a tunnel
  fastify.get<{ Params: { id: string } }>(
    '/api/tunnels/:id/logs',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const tunnel = db
        .prepare<[string], TunnelRow>('SELECT id FROM tunnels WHERE id = ?')
        .get(req.params.id);
      if (!tunnel) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Tunnel not found' } });
      }
      const lines = tunnelLogs.get(req.params.id) ?? [];
      return reply.send({ ok: true, data: { lines } });
    }
  );

  // DELETE /api/tunnels/:id — kill a tunnel
  fastify.delete<{ Params: { id: string } }>(
    '/api/tunnels/:id',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const tunnel = db
        .prepare<[string], TunnelRow>('SELECT * FROM tunnels WHERE id = ?')
        .get(req.params.id);

      if (!tunnel) {
        return reply.status(404).send({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Tunnel not found' },
        });
      }

      cleanupProcess(tunnel.id);

      // Also try killing by PID if process map doesn't have it (e.g., after restart)
      if (tunnel.pid) {
        try {
          process.kill(tunnel.pid, 'SIGTERM');
        } catch {
          // Process may already be dead
        }
      }

      db.prepare(
        "UPDATE tunnels SET status = 'stopped', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(tunnel.id);

      audit(req, 'tunnel.kill', 'tunnel', tunnel.id, `port=${tunnel.port}`);

      return reply.send({ ok: true, data: { id: tunnel.id, status: 'stopped' } });
    }
  );

  // Cleanup all tunnels on server shutdown
  fastify.addHook('onClose', () => {
    for (const [id] of tunnelProcesses) {
      cleanupProcess(id);
      db.prepare(
        "UPDATE tunnels SET status = 'stopped', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(id);
    }
  });
}

function serializeTunnel(t: TunnelRow) {
  return {
    id: t.id,
    projectId: t.project_id,
    port: t.port,
    url: t.url,
    pid: t.pid,
    status: t.status,
    errorMsg: t.error_msg,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

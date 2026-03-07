import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { statfsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import os from 'node:os';
import { google } from 'googleapis';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { getFlag, setFlag } from '../lib/flags.js';

const requireAuth = (req: FastifyRequest, reply: FastifyReply) =>
  (req.server as FastifyInstance).requireAuth(req, reply);

export async function systemRoutes(fastify: FastifyInstance) {
  // GET /api/health  (public — used by Docker healthcheck)
  fastify.get('/api/health', async (_req, reply) => {
    let dbOk = false;
    try {
      db.prepare('SELECT 1').get();
      dbOk = true;
    } catch {}

    let diskFreeGb = 0;
    try {
      const stat = statfsSync(config.dataDir);
      diskFreeGb = parseFloat(((stat.bfree * stat.bsize) / 1e9).toFixed(2));
    } catch {}

    const projectCount = (db.prepare<[], { cnt: number }>('SELECT COUNT(*) as cnt FROM projects').get()?.cnt ?? 0);
    const uptimeSec = Math.floor(process.uptime());

    return reply.send({
      ok: true,
      data: {
        status: 'ok',
        uptime_s: uptimeSec,
        db_ok: dbOk,
        disk_free_gb: diskFreeGb,
        project_count: projectCount,
        version: process.env.npm_package_version ?? '0.0.1',
      },
    });
  });

  // GET /api/security/logs  (auth required)
  fastify.get(
    '/api/security/logs',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      const logs = db.prepare('SELECT * FROM login_attempts ORDER BY attempted_at DESC LIMIT 50').all();
      return reply.send({ ok: true, data: logs });
    }
  );

  // GET /api/settings/focus  (auth required)
  fastify.get(
    '/api/settings/focus',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      const row = db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?').get('focus_goal');
      return reply.send({ ok: true, data: { goal: row?.value ?? '' } });
    }
  );

  // PATCH /api/settings/focus  (auth required)
  fastify.patch<{ Body: { goal: string } }>(
    '/api/settings/focus',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { goal } = req.body ?? {};
      db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).run('focus_goal', goal ?? '');
      return reply.send({ ok: true, data: { goal: goal ?? '' } });
    }
  );

  // GET /api/settings/flags/:name  (auth required)
  fastify.get<{ Params: { name: string } }>(
    '/api/settings/flags/:name',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { name } = req.params;
      return reply.send({ ok: true, data: { name, enabled: getFlag(db, name) } });
    }
  );

  // PATCH /api/settings/flags/:name  (auth required)
  fastify.patch<{ Params: { name: string }; Body: { enabled: boolean } }>(
    '/api/settings/flags/:name',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const { name } = req.params;
      const { enabled } = req.body ?? {};
      if (typeof enabled !== 'boolean') {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_BODY', message: 'enabled (boolean) is required' } });
      }
      setFlag(db, name, enabled);
      return reply.send({ ok: true, data: { name, enabled } });
    }
  );

  // GET /api/system/stats  (auth required — CPU, RAM, disk, containers)
  fastify.get(
    '/api/system/stats',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      return reply.send({ ok: true, data: collectStats() });
    }
  );

  // GET /api/system/stats/stream  (auth required — SSE for live stats)
  fastify.get(
    '/api/system/stats/stream',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.hijack();

      const emit = (payload: unknown) => {
        reply.raw.write(`event: stats\n`);
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      // Initial snapshot
      emit(collectStats());

      const interval = setInterval(() => {
        try {
          emit(collectStats());
        } catch {
          clearInterval(interval);
          try { reply.raw.end(); } catch {}
        }
      }, 2000);

      req.raw.on('close', () => {
        clearInterval(interval);
      });
    }
  );

  // GET /api/system/audit-logs  (auth required)
  fastify.get(
    '/api/system/audit-logs',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      const rows = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100').all();
      return reply.send({ ok: true, data: rows });
    }
  );

  // ── Google Drive OAuth2 setup ─────────────────────────────────────────────

  // GET /api/system/gdrive/auth-url  — returns the URL the user must visit
  fastify.get(
    '/api/system/gdrive/auth-url',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      if (!config.gdriveOAuthClientId || !config.gdriveOAuthClientSecret) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'MISSING_CONFIG', message: 'GDRIVE_OAUTH_CLIENT_ID and GDRIVE_OAUTH_CLIENT_SECRET must be set in .env' },
        });
      }

      const oAuth2Client = new google.auth.OAuth2(
        config.gdriveOAuthClientId,
        config.gdriveOAuthClientSecret,
        'urn:ietf:wg:oauth:2.0:oob'  // out-of-band: user copies the code manually
      );

      const url = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/drive.file'],
      });

      return reply.send({ ok: true, data: { url } });
    }
  );

  // POST /api/system/gdrive/exchange  — exchange auth code → refresh token + persist it
  fastify.post<{ Body: { code: string } }>(
    '/api/system/gdrive/exchange',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      if (!config.gdriveOAuthClientId || !config.gdriveOAuthClientSecret) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'MISSING_CONFIG', message: 'GDRIVE_OAUTH_CLIENT_ID and GDRIVE_OAUTH_CLIENT_SECRET must be set in .env' },
        });
      }

      const { code } = req.body ?? {};
      if (!code || typeof code !== 'string') {
        return reply.status(400).send({ ok: false, error: { code: 'MISSING_CODE', message: 'code is required' } });
      }

      const oAuth2Client = new google.auth.OAuth2(
        config.gdriveOAuthClientId,
        config.gdriveOAuthClientSecret,
        'urn:ietf:wg:oauth:2.0:oob'
      );

      let refreshToken: string;
      try {
        const { tokens } = await oAuth2Client.getToken(code);
        if (!tokens.refresh_token) {
          return reply.status(400).send({
            ok: false,
            error: { code: 'NO_REFRESH_TOKEN', message: 'No refresh_token returned — make sure you requested offline access and prompted consent' },
          });
        }
        refreshToken = tokens.refresh_token;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ ok: false, error: { code: 'EXCHANGE_FAILED', message: msg } });
      }

      // Persist the refresh token in the settings table so it survives restarts
      db.prepare(
        "INSERT INTO settings (key, value) VALUES ('gdrive_refresh_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).run(refreshToken);

      // Auto-create (or reuse) the backups folder in Google Drive
      let folderName = 'LetMeCook Backups';
      try {
        const oAuth2ForFolder = new google.auth.OAuth2(
          config.gdriveOAuthClientId,
          config.gdriveOAuthClientSecret,
          'urn:ietf:wg:oauth:2.0:oob'
        );
        oAuth2ForFolder.setCredentials({ refresh_token: refreshToken });
        const drive = google.drive({ version: 'v3', auth: oAuth2ForFolder });

        const existingRow = db.prepare<[string], { value: string }>(
          'SELECT value FROM settings WHERE key = ?'
        ).get('gdrive_folder_id');

        if (existingRow?.value) {
          // Folder already created — just fetch its name in case it changed
          const existingNameRow = db.prepare<[string], { value: string }>(
            'SELECT value FROM settings WHERE key = ?'
          ).get('gdrive_folder_name');
          folderName = existingNameRow?.value ?? folderName;
        } else {
          const folderRes = await drive.files.create({
            requestBody: {
              name: folderName,
              mimeType: 'application/vnd.google-apps.folder',
            },
            fields: 'id,name',
          });
          const newFolderId = folderRes.data.id;
          if (newFolderId) {
            folderName = folderRes.data.name ?? folderName;
            db.prepare(
              "INSERT INTO settings (key, value) VALUES ('gdrive_folder_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
            ).run(newFolderId);
            db.prepare(
              "INSERT INTO settings (key, value) VALUES ('gdrive_folder_name', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
            ).run(folderName);
          }
        }
      } catch (folderErr) {
        // Non-fatal — token is saved, folder creation will be retried on next auth
        fastify.log.warn('Failed to create Drive backup folder: ' + (folderErr instanceof Error ? folderErr.message : String(folderErr)));
      }

      return reply.send({ ok: true, data: { message: `Google Drive connected. Backups folder: "${folderName}"` } });
    }
  );

  // GET /api/system/gdrive/status
  fastify.get(
    '/api/system/gdrive/status',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      const row = db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?').get('gdrive_refresh_token');
      const hasToken = !!row?.value || !!config.gdriveOAuthRefreshToken;
      const hasServiceAccount = !!config.gdriveCredentialsPath;

      const folderIdRow = db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?').get('gdrive_folder_id');
      const folderNameRow = db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?').get('gdrive_folder_name');
      const folderId = folderIdRow?.value ?? null;
      const folderName = folderNameRow?.value || null;

      return reply.send({
        ok: true,
        data: {
          configured: !!folderId && (hasToken || hasServiceAccount),
          method: hasToken ? 'oauth2' : hasServiceAccount ? 'service_account' : 'none',
          folderId,
          folderName,
          hasToken,
        },
      });
    }
  );
}

function getCpuPercent(): number {
  try {
    const content = readFileSync('/proc/stat', 'utf-8');
    const line = content.split('\n').find((l) => l.startsWith('cpu '));
    if (!line) return 0;
    const parts = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = parts[3] ?? 0;
    const total = parts.reduce((a, b) => a + b, 0);
    if (total === 0) return 0;
    return parseFloat((((total - idle) / total) * 100).toFixed(1));
  } catch {
    // Fallback: use os module (averaged across CPUs)
    const cpus = os.cpus();
    if (cpus.length === 0) return 0;
    let totalIdle = 0;
    let totalTick = 0;
    for (const cpu of cpus) {
      const { user, nice, sys, idle, irq } = cpu.times;
      totalTick += user + nice + sys + idle + irq;
      totalIdle += idle;
    }
    return parseFloat((((totalTick - totalIdle) / totalTick) * 100).toFixed(1));
  }
}

function getContainers(): Array<{ name: string; status: string; image: string }> {
  try {
    const out = execSync(
      'docker ps --format "{{.Names}}\\t{{.Status}}\\t{{.Image}}" 2>/dev/null',
      { encoding: 'utf-8', timeout: 3000 }
    );
    return out
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, status, image] = line.split('\t');
        return { name: name ?? '', status: status ?? '', image: image ?? '' };
      });
  } catch {
    return [];
  }
}

function collectStats() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  let diskFreeGb = 0;
  let diskTotalGb = 0;
  try {
    const stat = statfsSync(config.dataDir);
    diskFreeGb = parseFloat(((stat.bfree * stat.bsize) / 1e9).toFixed(2));
    diskTotalGb = parseFloat(((stat.blocks * stat.bsize) / 1e9).toFixed(2));
  } catch {}

  return {
    cpu_percent: getCpuPercent(),
    mem_used_gb: parseFloat((usedMem / 1e9).toFixed(2)),
    mem_total_gb: parseFloat((totalMem / 1e9).toFixed(2)),
    mem_percent: parseFloat(((usedMem / totalMem) * 100).toFixed(1)),
    disk_free_gb: diskFreeGb,
    disk_total_gb: diskTotalGb,
    disk_percent: diskTotalGb > 0
      ? parseFloat((((diskTotalGb - diskFreeGb) / diskTotalGb) * 100).toFixed(1))
      : 0,
    uptime_s: Math.floor(process.uptime()),
    load_avg: os.loadavg().map((v) => parseFloat(v.toFixed(2))),
    containers: getContainers(),
    timestamp: new Date().toISOString(),
  };
}

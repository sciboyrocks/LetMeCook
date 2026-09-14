import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { generateSync, createGuardrails } from 'otplib';
import { db } from '../db/index.js';
import { decryptSecret, encryptSecret } from '../lib/vault.js';

const requireAuth = (req: FastifyRequest, reply: FastifyReply) =>
  (req.server as FastifyInstance).requireAuth(req, reply);

type PasswordRow = {
  id: string;
  title: string;
  username: string;
  website: string;
  notes: string;
  password_cipher: string | null;
  totp_cipher: string | null;
  created_at: string;
  updated_at: string;
};

type TotpStatus = 'ok' | 'invalid_secret' | 'decrypt_failed';

type PasswordPatchBody = {
  title?: unknown;
  username?: unknown;
  website?: unknown;
  notes?: unknown;
  password?: unknown;
  totpSecret?: unknown;
  clearPassword?: unknown;
  clearTotp?: unknown;
};

function cleanOptionalText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function parseTotpInput(input: string): string {
  const raw = input.trim();
  if (!raw) return '';

  if (raw.startsWith('otpauth://')) {
    try {
      const url = new URL(raw);
      return (url.searchParams.get('secret') ?? '').replace(/\s+/g, '').toUpperCase();
    } catch {
      return '';
    }
  }

  return raw.replace(/\s+/g, '').toUpperCase();
}

function getTotpSnapshot(secret: string): { code: string; period: number; expiresIn: number } {
  const period = 30;
  const now = Math.floor(Date.now() / 1000);
  const code = generateSync({
    strategy: 'totp',
    secret,
    guardrails: createGuardrails({ MIN_SECRET_BYTES: 1 }),
  });
  return {
    code,
    period,
    expiresIn: period - (now % period),
  };
}

export async function passwordsRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/api/passwords',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      const rows = db
        .prepare<[], PasswordRow>(
          'SELECT id, title, username, website, notes, password_cipher, totp_cipher, created_at, updated_at FROM passwords ORDER BY updated_at DESC'
        )
        .all();

      const data = rows.map((row) => {
        let totp: { code: string; period: number; expiresIn: number } | null = null;
        let totpStatus: TotpStatus | undefined;

        if (row.totp_cipher) {
          let secret = '';

          try {
            secret = decryptSecret(row.totp_cipher);
          } catch {
            totpStatus = 'decrypt_failed';
          }

          if (!totpStatus) {
            if (!secret) {
              totpStatus = 'invalid_secret';
            } else {
              try {
                totp = getTotpSnapshot(secret);
                totpStatus = 'ok';
              } catch {
                totpStatus = 'invalid_secret';
              }
            }
          }
        }

        return {
          id: row.id,
          title: row.title,
          username: row.username,
          website: row.website,
          notes: row.notes,
          password: (() => {
            if (!row.password_cipher) return '';
            try {
              return decryptSecret(row.password_cipher);
            } catch {
              return '';
            }
          })(),
          hasTotp: !!row.totp_cipher,
          totp,
          totpStatus,
          created_at: row.created_at,
          updated_at: row.updated_at,
        };
      });

      return reply.send({ ok: true, data });
    }
  );

  fastify.post<{
    Body: {
      title?: string;
      username?: string;
      website?: string;
      notes?: string;
      password?: string;
      totpSecret?: string;
    };
  }>(
    '/api/passwords',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const title = cleanOptionalText(req.body.title, 140);
      if (!title) {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_TITLE', message: 'Title is required' } });
      }

      const username = cleanOptionalText(req.body.username, 200);
      const website = cleanOptionalText(req.body.website, 300);
      const notes = cleanOptionalText(req.body.notes, 4000);
      const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 4000) : '';
      const totpSecret = parseTotpInput(typeof req.body.totpSecret === 'string' ? req.body.totpSecret : '');

      if (typeof req.body.totpSecret === 'string' && req.body.totpSecret.trim() && !totpSecret) {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_TOTP', message: 'TOTP secret or otpauth URL is invalid' } });
      }

      const id = uuidv4();

      db.prepare(
        'INSERT INTO passwords (id, title, username, website, notes, password_cipher, totp_cipher) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        id,
        title,
        username,
        website,
        notes,
        password ? encryptSecret(password) : null,
        totpSecret ? encryptSecret(totpSecret) : null
      );

      return reply.status(201).send({ ok: true, data: { id } });
    }
  );

  fastify.patch<{
    Params: { id: string };
    Body: PasswordPatchBody;
  }>(
    '/api/passwords/:id',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const body = (req.body ?? {}) as PasswordPatchBody;
      const hasPatchField =
        body.title !== undefined ||
        body.username !== undefined ||
        body.website !== undefined ||
        body.notes !== undefined ||
        body.password !== undefined ||
        body.totpSecret !== undefined ||
        body.clearPassword !== undefined ||
        body.clearTotp !== undefined;

      if (!hasPatchField) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'EMPTY_PATCH', message: 'No updatable fields were provided' },
        });
      }

      if (body.clearPassword !== undefined && typeof body.clearPassword !== 'boolean') {
        return reply.status(400).send({
          ok: false,
          error: { code: 'INVALID_CLEAR_PASSWORD', message: 'clearPassword must be a boolean' },
        });
      }

      if (body.clearTotp !== undefined && typeof body.clearTotp !== 'boolean') {
        return reply.status(400).send({
          ok: false,
          error: { code: 'INVALID_CLEAR_TOTP', message: 'clearTotp must be a boolean' },
        });
      }

      const row = db
        .prepare<[string], PasswordRow>(
          'SELECT id, title, username, website, notes, password_cipher, totp_cipher, created_at, updated_at FROM passwords WHERE id = ?'
        )
        .get(req.params.id);

      if (!row) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Entry not found' } });
      }

      const title = body.title !== undefined ? cleanOptionalText(body.title, 140) : row.title;
      if (!title) {
        return reply.status(400).send({ ok: false, error: { code: 'INVALID_TITLE', message: 'Title is required' } });
      }

      const username = body.username !== undefined ? cleanOptionalText(body.username, 200) : row.username;
      const website = body.website !== undefined ? cleanOptionalText(body.website, 300) : row.website;
      const notes = body.notes !== undefined ? cleanOptionalText(body.notes, 4000) : row.notes;

      let passwordCipher = row.password_cipher;
      if (body.clearPassword) {
        passwordCipher = null;
      } else if (body.password !== undefined) {
        if (typeof body.password !== 'string') {
          return reply.status(400).send({ ok: false, error: { code: 'INVALID_PASSWORD', message: 'Password must be a string' } });
        }
        const value = body.password.slice(0, 4000);
        passwordCipher = value ? encryptSecret(value) : null;
      }

      let totpCipher = row.totp_cipher;
      if (body.clearTotp) {
        totpCipher = null;
      } else if (body.totpSecret !== undefined) {
        if (typeof body.totpSecret !== 'string') {
          return reply.status(400).send({ ok: false, error: { code: 'INVALID_TOTP', message: 'TOTP secret must be a string' } });
        }
        const secret = parseTotpInput(body.totpSecret);
        if (body.totpSecret.trim() && !secret) {
          return reply.status(400).send({ ok: false, error: { code: 'INVALID_TOTP', message: 'TOTP secret or otpauth URL is invalid' } });
        }
        totpCipher = secret ? encryptSecret(secret) : null;
      }

      db.prepare(
        'UPDATE passwords SET title = ?, username = ?, website = ?, notes = ?, password_cipher = ?, totp_cipher = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(title, username, website, notes, passwordCipher, totpCipher, req.params.id);

      return reply.send({ ok: true, data: { id: req.params.id } });
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/api/passwords/:id',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const existing = db.prepare<[string], { id: string }>('SELECT id FROM passwords WHERE id = ?').get(req.params.id);
      if (!existing) {
        return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Entry not found' } });
      }

      db.prepare('DELETE FROM passwords WHERE id = ?').run(req.params.id);
      return reply.send({ ok: true, data: { success: true } });
    }
  );
}

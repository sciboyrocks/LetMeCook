import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';

process.env.DATA_DIR ??= mkdtempSync(join(tmpdir(), 'lmc-vnc-'));
process.env.SESSION_SECRET ??= 'test-secret-test-secret-test-secret';
const { createVncTicket, handleVncUpgrade } = await import('../src/proxy/vnc-proxy.js');
const { db } = await import('../src/db/index.js');

async function servers(t: test.TestContext) {
  const host = net.createServer((sock) => sock.end('RFB 003.008\n'));
  host.listen(0, '127.0.0.1');
  await once(host, 'listening');
  const api = http.createServer();
  api.on('upgrade', handleVncUpgrade);
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  t.after(() => {
    api.close();
    host.close();
  });
  return {
    hostPort: (host.address() as net.AddressInfo).port,
    url: (query: string) => `ws://127.0.0.1:${(api.address() as net.AddressInfo).port}/api/vnc/ws?${query}`,
  };
}

function open(url: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; banner?: string }>((resolve) => {
    const ws = new WebSocket(url, ['binary'], { headers });
    ws.once('message', (data) => {
      resolve({ status: 101, banner: data.toString() });
      ws.terminate();
    });
    ws.once('unexpected-response', (_req, res) => resolve({ status: res.statusCode ?? 0 }));
    ws.once('error', () => {});
  });
}

test('a ticket opens one session to its host', { timeout: 10_000 }, async (t) => {
  const s = await servers(t);
  const token = createVncTicket('c1', { host: '127.0.0.1', port: s.hostPort });
  assert.deepEqual(await open(s.url(`token=${token}`)), { status: 101, banner: 'RFB 003.008\n' });
  assert.equal((await open(s.url(`token=${token}`))).status, 401);
});

test('a session cookie and connection id alone are rejected', { timeout: 10_000 }, async (t) => {
  const s = await servers(t);
  db.prepare('INSERT OR REPLACE INTO remote_desktop_connections (id, name, host, port) VALUES (?, ?, ?, ?)')
    .run('c1', 'Host', '127.0.0.1', s.hostPort);
  assert.equal((await open(s.url('id=c1'), { Cookie: '__lmc_sid=anything' })).status, 401);
  assert.equal((await open(s.url('token=vnc_tkt_unknown'))).status, 401);
});

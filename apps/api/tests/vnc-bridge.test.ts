import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { setupVncBridge } from '../src/proxy/vnc-bridge.js';

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'condition timed out');
    await delay(5);
  }
}

async function fixture(t: TestContext, username = '', heartbeatMs?: number, autoPong = true) {
  const host = net.createServer();
  host.listen(0, '127.0.0.1');
  await once(host, 'listening');
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1', perMessageDeflate: false });
  await once(wss, 'listening');
  const upstreamReady = once(host, 'connection');
  let relay!: net.Socket;
  let bridgeWs!: WebSocket;
  wss.on('connection', (ws) => {
    bridgeWs = ws;
    relay = setupVncBridge(ws, '127.0.0.1', (host.address() as net.AddressInfo).port, username, heartbeatMs);
  });
  const client = new WebSocket(`ws://127.0.0.1:${(wss.address() as net.AddressInfo).port}`, { autoPong });
  const received: Buffer[] = [];
  client.on('message', (data) => received.push(data as Buffer));
  await once(client, 'open');
  const [upstream] = await upstreamReady as [net.Socket];
  const input: Buffer[] = [];
  upstream.on('data', (data) => input.push(data));
  t.after(() => {
    client.terminate();
    bridgeWs.terminate();
    relay.destroy();
    upstream.destroy();
    wss.close();
    host.close();
  });
  const output = () => Buffer.concat(received);
  const inputs = () => Buffer.concat(input);
  return { upstream, relay, bridgeWs, client, output, inputs };
}

async function handshake(f: Awaited<ReturnType<typeof fixture>>, minor = '008') {
  f.upstream.write('RFB 003.');
  await until(() => f.output().length === 8);
  f.upstream.write('889\n');
  await until(() => f.output().length === 12);
  f.client.send('RFB 003.');
  await until(() => f.inputs().length === 8);
  f.client.send(`${minor}\n`);
  await until(() => f.inputs().length === 12);
}

test('fragmented RFB 3.8 handshake filters ARD only for password authentication', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  await handshake(f);
  f.upstream.write(Buffer.from([3, 30]));
  await delay(10);
  assert.equal(f.output().length, 12);
  f.upstream.write(Buffer.from([2, 1, 99, 100]));
  await until(() => f.output().length === 17);
  assert.deepEqual(f.output().subarray(12), Buffer.from([2, 2, 1, 99, 100]));
});

test('preserves ARD when a username was supplied', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, 'mac-user');
  await handshake(f);
  const security = Buffer.from([2, 30, 2]);
  f.upstream.write(security);
  await until(() => f.output().length === 15);
  assert.deepEqual(f.output().subarray(12), security);
});

test('RFB 3.3 security word and following bytes pass through untouched', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  await handshake(f, '003');
  const security = Buffer.from([0, 0, 0, 2, 30, 2, 42]);
  f.upstream.write(security.subarray(0, 2));
  await until(() => f.output().length === 14);
  f.upstream.write(security.subarray(2));
  await until(() => f.output().length === 19);
  assert.deepEqual(f.output().subarray(12), security);
});

test('flushes the final authentication failure before orderly close', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  await handshake(f);
  const failure = Buffer.from([0, 0, 0, 0, 4, 110, 111, 112, 101]);
  const closed = once(f.client, 'close');
  f.upstream.end(failure);
  await closed;
  assert.deepEqual(f.output().subarray(12), failure);
});

test('slow WebSocket drains pause screen reads, preserve bytes, and leave input responsive', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  await handshake(f);
  f.upstream.write(Buffer.from([1, 2]));
  await until(() => f.output().length === 14);

  // Hold send completions to simulate a congested browser link deterministically.
  const originalSend = f.bridgeWs.send.bind(f.bridgeWs);
  const completions: (() => void)[] = [];
  let outstanding = 0;
  let peak = 0;
  f.bridgeWs.send = ((data: Buffer, options: object, callback: (err?: Error) => void) => {
    outstanding += data.length;
    peak = Math.max(peak, outstanding);
    originalSend(data, options, (error) => {
      completions.push(() => {
        outstanding -= data.length;
        callback(error);
      });
    });
  }) as typeof f.bridgeWs.send;

  const screen = Buffer.alloc(4 * 1024 * 1024);
  for (let i = 0; i < screen.length; i++) screen[i] = i % 251;
  f.upstream.write(screen);
  await until(() => f.relay.isPaused());
  assert.ok(peak <= 320 * 1024, `screen queue grew to ${peak} bytes`);
  const pointer = Buffer.from([5, 0, 0, 20, 0, 30]);
  f.client.send(pointer);
  await until(() => f.inputs().length === 18);
  assert.deepEqual(f.inputs().subarray(12), pointer);

  const deadline = Date.now() + 5000;
  while (f.output().length < screen.length + 14 || outstanding > 0) {
    assert.ok(Date.now() < deadline, 'screen stream stalled');
    for (const complete of completions.splice(0)) complete();
    await delay(5);
  }
  assert.deepEqual(f.output().subarray(14), screen);
  assert.ok(peak <= 320 * 1024, `screen queue grew to ${peak} bytes`);
  await until(() => !f.relay.isPaused());
  f.client.close();
  await until(() => f.relay.destroyed);
});

test('heartbeat keeps an idle session open while the browser answers pings', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, '', 20);
  await handshake(f);
  let pings = 0;
  f.client.on('ping', () => pings++);
  await until(() => pings >= 6);
  assert.equal(f.relay.destroyed, false);
  f.upstream.write(Buffer.from([0, 0, 0, 0]));
  await until(() => f.output().length === 16);
});

test('heartbeat closes the host socket when the browser stops answering', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, '', 20, false);
  await handshake(f);
  const closed = once(f.client, 'close');
  await until(() => f.relay.destroyed);
  await closed;
});

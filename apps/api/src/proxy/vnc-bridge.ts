import net from 'node:net';
import { WebSocket } from 'ws';

const BATCH_BYTES = 64 * 1024;
const HIGH_WATER_BYTES = 256 * 1024;
const LOW_WATER_BYTES = 64 * 1024;
// Idle desktops send nothing; pings keep proxies from timing out the socket and expose dead browsers.
const HEARTBEAT_MS = 15_000;
// A pong can queue behind screen data on a congested link, so allow several intervals.
const MAX_MISSED_HEARTBEATS = 3;

/** Ordered, lossless RFB relay. Never drop bytes: rectangles can depend on prior updates. */
export function setupVncBridge(
  ws: WebSocket,
  host: string,
  port: number,
  username = '',
  heartbeatMs = HEARTBEAT_MS
) {
  const tcp = net.createConnection({ host, port });
  tcp.setNoDelay(true);
  tcp.setKeepAlive(true, 10_000);
  tcp.setTimeout(10_000);
  tcp.once('connect', () => tcp.setTimeout(0));

  let closed = false;
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let inFlightBytes = 0;
  let flushTimer: NodeJS.Immediate | undefined;
  let stage: 'server-version' | 'client-version' | 'security' | 'stream' = 'server-version';
  let serverVersionBytes = 0;
  let clientVersion = Buffer.alloc(0);
  let security = Buffer.alloc(0);
  let missedHeartbeats = 0;

  const heartbeat = setInterval(() => {
    if (missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
      cleanup();
      return;
    }
    missedHeartbeats++;
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, heartbeatMs);
  ws.on('pong', () => {
    missedHeartbeats = 0;
  });

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    if (flushTimer) clearImmediate(flushTimer);
    pending = [];
    pendingBytes = 0;
    tcp.destroy();
    if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
  };

  const resume = () => {
    if (!closed && tcp.isPaused() && inFlightBytes + pendingBytes <= LOW_WATER_BYTES) {
      tcp.resume();
    }
  };

  const flush = () => {
    if (flushTimer) clearImmediate(flushTimer);
    flushTimer = undefined;
    if (closed || pendingBytes === 0 || ws.readyState !== WebSocket.OPEN) return;
    const payload = pending.length === 1 ? pending[0] : Buffer.concat(pending, pendingBytes);
    pending = [];
    pendingBytes = 0;
    inFlightBytes += payload.length;
    if (inFlightBytes >= HIGH_WATER_BYTES) tcp.pause();
    // Send completion provides flow control without a polling timer or private ws socket access.
    ws.send(payload, { binary: true, compress: false }, (error) => {
      inFlightBytes -= payload.length;
      if (error) cleanup();
      else resume();
    });
  };

  const send = (chunk: Buffer) => {
    if (closed || chunk.length === 0) return;
    pending.push(chunk);
    pendingBytes += chunk.length;
    if (pendingBytes + inFlightBytes >= HIGH_WATER_BYTES) tcp.pause();
    if (pendingBytes >= BATCH_BYTES) flush();
    else if (!flushTimer) flushTimer = setImmediate(flush);
  };

  tcp.on('data', (chunk: Buffer) => {
    if (stage === 'server-version') {
      // TCP packets are not protocol messages; a 12-byte banner may arrive in fragments.
      serverVersionBytes += chunk.length;
      if (serverVersionBytes >= 12) stage = 'client-version';
      send(chunk);
      return;
    }
    if (stage !== 'security') {
      send(chunk);
      return;
    }

    security = Buffer.concat([security, chunk]);
    const count = security[0];
    if (security.length < count + 1) return;
    // A zero count starts a failure reason, which must pass through unchanged.
    const types = [...security.subarray(1, count + 1)];
    if (!username && types.includes(30) && types.includes(2)) {
      const filtered = types.filter((type) => type !== 30);
      send(Buffer.from([filtered.length, ...filtered]));
      send(security.subarray(count + 1));
    } else {
      send(security);
    }
    security = Buffer.alloc(0);
    stage = 'stream';
  });

  ws.on('message', (message) => {
    missedHeartbeats = 0;
    if (closed || !tcp.writable) return;
    const data = Buffer.isBuffer(message) ? message
      : Array.isArray(message) ? Buffer.concat(message) : Buffer.from(message);
    if (stage === 'client-version') {
      const needed = 12 - clientVersion.length;
      clientVersion = Buffer.concat([clientVersion, data.subarray(0, needed)]);
      if (clientVersion.length === 12) {
        // RFB 3.3 sends a 32-bit security type, not a counted list.
        const minor = Number(clientVersion.toString('ascii', 8, 11));
        stage = minor >= 7 ? 'security' : 'stream';
        clientVersion = Buffer.alloc(0);
      }
    }
    if (!tcp.write(data) && !ws.isPaused) {
      ws.pause();
      tcp.once('drain', () => {
        if (!closed && ws.readyState === WebSocket.OPEN) ws.resume();
      });
    }
  });

  // Queue the close frame after all remaining bytes, including authentication errors.
  tcp.on('end', () => {
    flush();
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });
  tcp.on('close', () => {
    if (ws.readyState === WebSocket.OPEN) cleanup();
  });
  tcp.on('timeout', cleanup);
  tcp.on('error', cleanup);
  ws.on('error', cleanup);
  ws.on('close', cleanup);
  return tcp;
}

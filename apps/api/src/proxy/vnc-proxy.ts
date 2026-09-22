import { WebSocketServer } from 'ws';
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { db } from '../db/index.js';
import { setupVncBridge } from './vnc-bridge.js';

interface VncTicket {
  connectionId: string;
  host: string;
  port: number;
  username?: string;
  expiresAt: number;
}

const tickets = new Map<string, VncTicket>();

// Periodic cleanup of expired tickets every 30s
setInterval(() => {
  const now = Date.now();
  for (const [token, ticket] of tickets.entries()) {
    if (ticket.expiresAt < now) {
      tickets.delete(token);
    }
  }
}, 30_000).unref();

export function createVncTicket(
  connectionId: string,
  details: { host: string; port: number; username?: string }
): string {
  const token = `vnc_tkt_${crypto.randomUUID()}`;
  tickets.set(token, {
    connectionId,
    host: details.host,
    port: details.port,
    username: details.username?.trim() || '',
    expiresAt: Date.now() + 60_000, // 60 seconds TTL
  });
  return token;
}

const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
  handleProtocols: (protocols) => {
    if (protocols.has('binary')) return 'binary';
    return Array.from(protocols)[0] || false;
  },
});

export function isVncUpgrade(req: http.IncomingMessage): boolean {
  const url = req.url ?? '';
  return url.startsWith('/api/vnc/ws') || url.startsWith('/vnc/ws');
}

export function handleVncUpgrade(
  req: http.IncomingMessage,
  socket: net.Socket,
  head: Buffer
): void {
  const reqUrl = new URL(req.url ?? '/', 'http://localhost');
  const token = reqUrl.searchParams.get('token');
  const connectionId = reqUrl.searchParams.get('id');

  let targetHost = '';
  let targetPort = 5900;
  let targetUsername = '';
  let connId = '';

  if (token && tickets.has(token)) {
    const ticket = tickets.get(token)!;
    if (ticket.expiresAt >= Date.now()) {
      targetHost = ticket.host;
      targetPort = ticket.port;
      targetUsername = ticket.username || '';
      connId = ticket.connectionId;
      // Allow re-connection within 15 seconds grace period for rapid retries
      ticket.expiresAt = Math.min(ticket.expiresAt, Date.now() + 15_000);
    }
  }

  // Fallback: validate session cookie & connection id
  if (!targetHost && connectionId) {
    const cookies: Record<string, string> = {};
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k) cookies[k.trim()] = v.join('=');
    }
    const sessionCookie = cookies['__lmc_sid'];
    if (sessionCookie) {
      const row = db
        .prepare('SELECT id, host, port, username FROM remote_desktop_connections WHERE id = ?')
        .get(connectionId) as { id: string; host: string; port: number; username?: string } | undefined;
      if (row) {
        targetHost = row.host;
        targetPort = row.port || 5900;
        targetUsername = row.username || '';
        connId = row.id;
      }
    }
  }

  if (!targetHost) {
    socket.write(
      'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\nUnauthorized or invalid connection ticket\r\n'
    );
    socket.destroy();
    return;
  }

  socket.setNoDelay(true);
  socket.setKeepAlive(true, 10_000);
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (connId) {
      try {
        db.prepare(
          'UPDATE remote_desktop_connections SET last_connected_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).run(connId);
      } catch {}
    }
    setupVncBridge(ws, targetHost, targetPort, targetUsername);
  });
}

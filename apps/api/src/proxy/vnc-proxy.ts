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
  username: string;
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
  const token = reqUrl.searchParams.get('token') ?? '';
  const ticket = tickets.get(token);
  // Tickets are single use: every connect and auto-reconnect requests a fresh one, so a leaked
  // URL (proxy logs, history) cannot open another session.
  tickets.delete(token);

  if (!ticket || ticket.expiresAt < Date.now()) {
    socket.write(
      'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\nUnauthorized or invalid connection ticket\r\n'
    );
    socket.destroy();
    return;
  }

  socket.setNoDelay(true);
  socket.setKeepAlive(true, 10_000);
  wss.handleUpgrade(req, socket, head, (ws) => {
    try {
      db.prepare(
        'UPDATE remote_desktop_connections SET last_connected_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(ticket.connectionId);
    } catch {}
    setupVncBridge(ws, ticket.host, ticket.port, ticket.username);
  });
}

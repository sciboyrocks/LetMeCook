import { mkdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { buildApp } from './app.js';
import { config } from './config.js';

// Ensure required directories exist
mkdirSync(config.dataDir, { recursive: true });
mkdirSync(config.projectsDir, { recursive: true });

const fastify = await buildApp();

try {
  await fastify.listen({ port: config.port, host: '0.0.0.0' });
  fastify.log.info(`🚀 LetMeCook API running on http://0.0.0.0:${config.port}`);
  fastify.log.info(`🌐 Domain: ${config.domain}`);
  fastify.log.info(`📁 Projects: ${config.projectsDir}`);
  fastify.log.info(`🔗 code-server: ${config.codeServerUrl}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

// WebSocket upgrade handler — proxy all WS connections to code-server
// Sessions are cookie-based; we do a lightweight check here.
fastify.server.on('upgrade', (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
  const cookies: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=');
  }

  const sessionCookie = cookies['__lmc_sid'];
  if (!sessionCookie) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  // Forward WS to code-server
  // Strip the /code/<projectId> prefix so code-server sees a root-relative path.
  // /code/proxy/* and /code/absproxy/* are code-server's port-forwarding
  // routes and need to be forwarded as /proxy/* and /absproxy/*.
  let wsPath = req.url ?? '/';
  const proxyPortMatch = wsPath.match(/^\/code\/((?:abs)?proxy)\/(.*)/);
  if (proxyPortMatch) {
    wsPath = `/${proxyPortMatch[1]}/${proxyPortMatch[2]}`;
  } else {
    // /code/<projectId>/rest → /rest
    wsPath = wsPath.replace(/^\/code\/[^/]+/, '');
    if (!wsPath) wsPath = '/';
  }

  const proxyReq = http.request({
    hostname: config.codeServerHost,
    port: config.codeServerPort,
    path: wsPath,
    method: req.method,
    headers: { ...req.headers, host: `${config.codeServerHost}:${config.codeServerPort}` },
  });

  proxyReq.on('error', () => { try { socket.destroy(); } catch {} });

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
      Object.entries(proxyRes.headers)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join('\r\n') +
      '\r\n\r\n'
    );
    if (proxyHead?.length) proxySocket.unshift(proxyHead);
    proxySocket.pipe(socket).pipe(proxySocket);
    socket.on('error', () => { try { proxySocket.destroy(); } catch {} });
    proxySocket.on('error', () => { try { socket.destroy(); } catch {} });
  });

  if (head?.length) proxyReq.write(head);
  proxyReq.end();
});

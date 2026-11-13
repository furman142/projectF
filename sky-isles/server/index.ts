import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Rooms, type Timings } from './rooms.ts';
import type { ClientMsg } from '../shared/protocol.ts';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

/** Starts the HTTP + WebSocket server. Exported so tests can run it on a free port. */
export function startServer(opts: { port: number; timings?: Partial<Timings>; quiet?: boolean }) {
const rooms = new Rooms(opts.timings);

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.count }));
    return;
  }
  // Serve the built client (production). Unknown paths fall back to index.html.
  let file = path.join(DIST, path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, ''));
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Client not built. Run "npm run build" first, or use "npm run dev".');
    return;
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
server.on('upgrade', (req, socket, head) => {
  if (!(req.url ?? '').split('?')[0].endsWith('/ws')) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  let alive = true;
  ws.on('pong', () => (alive = true));
  const ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 25_000);
  ws.on('message', (data) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    try { rooms.handle(ws, msg); } catch (e) { console.error('message failed', e); }
  });
  ws.on('close', () => { clearInterval(ping); rooms.closed(ws); });
});

return new Promise<{ port: number; rooms: Rooms; close: () => Promise<void> }>((resolve) => {
  server.listen(opts.port, () => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : opts.port;
    if (!opts.quiet) console.log(`Sky Isles server on http://localhost:${port}`);
    resolve({
      port,
      rooms,
      close: () => new Promise<void>((done) => {
        rooms.shutdown();
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        server.close(() => done());
      }),
    });
  });
});
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) void startServer({ port: Number(process.env.PORT ?? 8787) });

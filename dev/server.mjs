// Serwer dev: statyczne pwa/ + atrapa API pod POST /api. Bez zależności.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from './mock-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'pwa');
const PORT = Number(process.env.PORT) || 8080;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...extra });
  res.end(body);
}

async function readBody(req) {
  let s = '';
  for await (const c of req) s += c;
  return s;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api') {
      if (req.method !== 'POST') return send(res, 405, 'Method Not Allowed');
      if (process.env.MOCK_OFFLINE === '1') return send(res, 503, 'offline');
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { body = null; }
      const out = handle(body);
      console.log(`[api] ${body && body.action} -> ${out.ok ? 'ok' : out.code}`);
      return send(res, 200, JSON.stringify(out), 'application/json; charset=utf-8');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(ROOT, rel);
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');
    const data = await fs.readFile(file);
    send(res, 200, req.method === 'HEAD' ? '' : data, MIME[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'EISDIR')) return send(res, 404, 'Not found');
    console.error(e);
    send(res, 500, 'Server error');
  }
});

server.listen(PORT, () => console.log(`Dev: http://localhost:${PORT}  (PIN 1111 pracownik, 9999 admin${process.env.MOCK_OFFLINE === '1' ? ', MOCK_OFFLINE' : ''})`));

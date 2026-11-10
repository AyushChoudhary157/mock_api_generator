// Tiny local server that mimics Vercel routing: static files from /public + the /api handlers.
//   npm run dev          -> uses NEON_DATABASE_URL from your environment / .env
//   npm run dev:local    -> embedded Postgres (PGlite), no Neon account needed
import './_env.js';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml' };

const routes = [
  ['/api/manage/', '../api/manage/[...path].js'],
  ['/api/v1/', '../api/v1/[...path].js'],
  ['/api/cron/cleanup', '../api/cron/cleanup.js'],
];
const handlers = new Map();
async function load(rel) {
  if (!handlers.has(rel)) handlers.set(rel, (await import(pathToFileURL(path.join(root, 'scripts', rel)).href)).default);
  return handlers.get(rel);
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    const route = routes.find(([prefix]) => pathname.startsWith(prefix) || pathname === prefix.replace(/\/$/, ''));
    if (route) return await (await load(route[1]))(req, res);

    let file = pathname === '/' || pathname === '/tools/mock-api-generator' ? '/index.html' : pathname;
    const full = path.normalize(path.join(root, 'public', file));
    if (!full.startsWith(path.join(root, 'public'))) { res.statusCode = 403; return res.end('Forbidden'); }
    if (!(await stat(full).catch(() => null))?.isFile()) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', MIME[path.extname(full)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(await readFile(full));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) { res.statusCode = 500; res.end('Server error'); }
  }
});

if (process.env.LOCAL_DB === 'pglite') {
  const { runMigrations } = await import('./lib-migrate.js');
  await runMigrations(() => {});
}

const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`Mock API Generator running on http://localhost:${port}  (db: ${process.env.LOCAL_DB || 'neon'})`));

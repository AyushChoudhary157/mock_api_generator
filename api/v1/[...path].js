// /api/v1/<project-id>/<resource>[/<id>[/<child-resource>]]  — the public, CORS-enabled mock API.
import { createHash } from 'node:crypto';
import { query } from '../_lib/db.js';
import { config } from '../_lib/env.js';
import { ApiError, wrap, sendJson, readJson, requireObject, parseUrl, publicCors, clientIp, baseUrl } from '../_lib/http.js';
import { hitMany } from '../_lib/ratelimit.js';
import { mergeSettings, validateBody } from '../_lib/schema.js';
import { listRecords, getRecord, insertMany, replaceRecord, patchRecord, deleteRecord } from '../_lib/records.js';
import { log } from '../_lib/log.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ipHash = (ip) => createHash('sha256').update(`${config.ipSalt}:${ip}`).digest('hex').slice(0, 16);

/** Loads project + one resource in a single round trip. */
async function loadContext(projectId, resourceName) {
  const rows = await query(
    `SELECT p.id AS pid, p.name AS pname, p.settings AS psettings, p.last_active_at,
            r.id AS rid, r.name AS rname, r.schema, r.settings AS rsettings
     FROM projects p LEFT JOIN resources r ON r.project_id = p.id AND r.name = $2
     WHERE p.id = $1`, [projectId, resourceName ?? '']);
  return rows[0];
}

const asResource = (ctx) => ({ id: ctx.rid, project_id: ctx.pid, name: ctx.rname, schema: ctx.schema, settings: ctx.rsettings });

function logRequest(entry) {
  log('info', 'mock_request', entry);
  return query(
    `INSERT INTO request_logs (project_id, resource, method, path, status, duration_ms, simulated, ip_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [entry.project, entry.resource ?? null, entry.method, entry.path.slice(0, 300), entry.status, entry.ms, entry.simulated, entry.ip],
  ).catch((e) => log('warn', 'request_log_failed', { error: String(e) }));
}

export default wrap(async (req, res) => {
  publicCors(req, res);
  if (req.method === 'OPTIONS') return sendJson(res, 204);

  const started = Date.now();
  const { segs, query: qs, pathname } = parseUrl(req, '/api/v1');
  const method = req.method;
  const ip = clientIp(req);
  const [projectId, resourceName, recordId, childName] = segs;

  if (!projectId) {
    return sendJson(res, 200, { name: 'FrugalTesting Mock API', usage: '/api/v1/<project-id>/<resource>' });
  }
  if (!/^[a-z0-9]{6,20}$/.test(projectId) || segs.length > 4) {
    throw new ApiError(404, 'not_found', 'Unknown endpoint. Expected /api/v1/<project-id>/<resource>[/<id>[/<child>]].');
  }

  const ctx = await loadContext(projectId, resourceName);
  if (!ctx) {
    await hitMany([{ key: `ip:${ip}`, windowSec: 60 }]).catch(() => {});
    throw new ApiError(404, 'project_not_found', 'This mock project does not exist (or has expired after 30 days of inactivity).');
  }

  // ---- rate limiting: per-IP per-minute + per-project daily quota in one round trip ----
  const [ipHit, dayHit] = await hitMany([
    { key: `ip:${ip}`, windowSec: 60 },
    { key: `pd:${ctx.pid}`, windowSec: 86400 },
  ]);
  const rl = {
    'X-RateLimit-Limit': String(config.maxRequestsPerDay),
    'X-RateLimit-Remaining': String(Math.max(0, config.maxRequestsPerDay - dayHit.count)),
    'X-RateLimit-Reset': String(dayHit.resetSec),
  };
  for (const [k, v] of Object.entries(rl)) res.setHeader(k, v);
  if (ipHit.count > config.rateIpPerMin) {
    throw new ApiError(429, 'rate_limited', 'Too many requests from your IP. Slow down for a minute.', undefined, { 'Retry-After': String(ipHit.resetSec) });
  }
  if (dayHit.count > config.maxRequestsPerDay) {
    throw new ApiError(429, 'daily_quota_exceeded',
      `This project reached its free-tier limit of ${config.maxRequestsPerDay} requests/day. It resets at 00:00 UTC.`, undefined, { 'Retry-After': String(dayHit.resetSec) });
  }
  if (Date.now() - new Date(ctx.last_active_at).getTime() > 3600_000) {
    query('UPDATE projects SET last_active_at = now() WHERE id = $1', [ctx.pid]).catch(() => {});
  }

  // ---- project index ----
  if (!resourceName) {
    const rows = await query('SELECT name FROM resources WHERE project_id = $1 ORDER BY created_at', [ctx.pid]);
    return sendJson(res, 200, {
      project: ctx.pname,
      endpoints: rows.map((r) => `${baseUrl(req)}/api/v1/${ctx.pid}/${r.name}`),
    });
  }
  if (!ctx.rid) throw new ApiError(404, 'resource_not_found', `Resource "${resourceName}" does not exist in this project.`);

  const resource = asResource(ctx);
  const sim = mergeSettings(ctx.psettings, ctx.rsettings);
  const customHeaders = Object.keys(sim.headers);
  if (customHeaders.length) publicCors(req, res, customHeaders);
  for (const [k, v] of Object.entries(sim.headers)) res.setHeader(k, v);

  const done = (status, simulated = false) => {
    void logRequest({ project: ctx.pid, resource: resourceName, method, path: pathname, status, ms: Date.now() - started, simulated, ip: ipHash(ip) });
  };

  // ---- simulation: delay + random failures ----
  if (sim.delay_ms > 0) await sleep(Math.min(sim.delay_ms, config.maxDelayMs));
  if (sim.error_rate > 0 && Math.random() * 100 < sim.error_rate) {
    res.setHeader('X-Mock-Simulated', 'error');
    await logRequest({ project: ctx.pid, resource: resourceName, method, path: pathname, status: sim.error_status, ms: Date.now() - started, simulated: true, ip: ipHash(ip) });
    return sendJson(res, sim.error_status, { error: { code: 'simulated_error', message: `Simulated failure (${sim.error_rate}% error rate configured).` } });
  }
  const okStatus = (fallback) => sim.status_codes[method] ?? fallback;

  let status = 200;
  let payload;
  let extra = {};

  const readBody = async () => requireObject(await readJson(req, config.maxBodyBytes));
  const notFound = (what = 'Record') => new ApiError(404, 'record_not_found', `${what} not found.`);
  const noMethod = (allow) => { res.setHeader('Allow', allow); return new ApiError(405, 'method_not_allowed', `Method not allowed. Allowed: ${allow}.`); };

  try {
    if (!recordId) {
      // ---------- collection ----------
      if (method === 'GET') {
        const r = await listRecords(resource, qs);
        extra = pageHeaders(req, pathname, qs, r);
        status = okStatus(200);
        payload = qs.get('envelope') === 'true'
          ? { data: r.items, meta: { total: r.total, page: r.page, limit: r.limit, total_pages: r.totalPages } }
          : r.items;
      } else if (method === 'POST') {
        const clean = validateBody(resource.schema, await readBody());
        [payload] = await insertMany(resource, [clean]);
        status = okStatus(201);
      } else throw noMethod('GET, POST, OPTIONS');
    } else if (!childName) {
      // ---------- single record ----------
      if (method === 'GET') {
        payload = await getRecord(resource, recordId);
        if (!payload) throw notFound();
        status = okStatus(200);
      } else if (method === 'PUT' || method === 'PATCH') {
        const clean = validateBody(resource.schema, await readBody(), { partial: method === 'PATCH' });
        payload = method === 'PUT' ? await replaceRecord(resource, recordId, clean) : await patchRecord(resource, recordId, clean);
        if (!payload) throw notFound();
        status = okStatus(200);
      } else if (method === 'DELETE') {
        payload = await deleteRecord(resource, recordId);
        if (!payload) throw notFound();
        status = okStatus(200);
      } else throw noMethod('GET, PUT, PATCH, DELETE, OPTIONS');
    } else {
      // ---------- one-to-many: /users/:id/posts ----------
      const parent = await getRecord(resource, recordId);
      if (!parent) throw notFound('Parent record');
      const childCtx = await loadContext(projectId, childName);
      if (!childCtx?.rid) throw new ApiError(404, 'resource_not_found', `Resource "${childName}" does not exist in this project.`);
      const child = asResource(childCtx);
      const fk = child.schema.find((f) => f.type === 'ref' && f.ref === resourceName);
      if (!fk) {
        throw new ApiError(404, 'relation_not_found',
          `"${childName}" has no field of type "ref" pointing to "${resourceName}". Add one (e.g. ${resourceName.replace(/s$/, '')}Id) to enable this route.`);
      }
      if (method === 'GET') {
        const r = await listRecords(child, qs, [{ field: fk.name, values: [String(parent.id)] }]);
        extra = pageHeaders(req, pathname, qs, r);
        status = okStatus(200);
        payload = qs.get('envelope') === 'true'
          ? { data: r.items, meta: { total: r.total, page: r.page, limit: r.limit, total_pages: r.totalPages } }
          : r.items;
      } else if (method === 'POST') {
        const clean = validateBody(child.schema, await readBody());
        clean[fk.name] = parent.id;
        [payload] = await insertMany(child, [clean]);
        status = okStatus(201);
      } else throw noMethod('GET, POST, OPTIONS');
    }
  } catch (err) {
    done(err instanceof ApiError ? err.status : 500);
    throw err;
  }

  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  done(status);
  if (status === 204 || status === 205) return sendJson(res, status);
  return sendJson(res, status, payload);
});

function pageHeaders(req, pathname, qs, r) {
  const link = (page, rel) => {
    const u = new URLSearchParams(qs);
    u.set('page', String(page));
    u.set('limit', String(r.limit));
    return `<${baseUrl(req)}${pathname}?${u}>; rel="${rel}"`;
  };
  const links = [];
  if (r.page > 1) links.push(link(r.page - 1, 'prev'));
  if (r.page < r.totalPages) links.push(link(r.page + 1, 'next'));
  const h = { 'X-Total-Count': String(r.total), 'X-Page': String(r.page), 'X-Limit': String(r.limit), 'X-Total-Pages': String(r.totalPages) };
  if (links.length) h.Link = links.join(', ');
  return h;
}

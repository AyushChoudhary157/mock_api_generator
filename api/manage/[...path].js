// /api/manage/*  — project & resource management. Every route except /limits needs the
// anonymous management token in the `X-Owner-Token` header.
import { query } from '../_lib/db.js';
import { config, publicLimits } from '../_lib/env.js';
import { ApiError, wrap, sendJson, readJson, requireObject, parseUrl, manageCors, clientIp, baseUrl } from '../_lib/http.js';
import { ownerFromReq, getOwnedProject } from '../_lib/auth.js';
import { hitMany } from '../_lib/ratelimit.js';
import { cleanName, normalizeFields, normalizeSettings, validateResourceName, validateBody } from '../_lib/schema.js';
import { listRecords, getRecord, insertMany, replaceRecord, deleteRecord } from '../_lib/records.js';
import { createProject, createResource, regenerate, applySchema, importResources, exportProject } from '../_lib/service.js';
import { generateSchema } from '../_lib/ai.js';

const todayStart = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };

// ---------- DTOs ----------
const projectDTO = (req, p, extra = {}) => ({
  id: p.id, name: p.name, settings: p.settings, created_at: p.created_at, last_active_at: p.last_active_at,
  base_url: `${baseUrl(req)}/api/v1/${p.id}`, ...extra,
});
const resourceDTO = (req, r) => ({
  id: r.id, project_id: r.project_id, name: r.name, schema: r.schema, settings: r.settings,
  record_count: r.record_count ?? undefined, created_at: r.created_at, updated_at: r.updated_at,
  url: `${baseUrl(req)}/api/v1/${r.project_id}/${r.name}`,
});

async function getResource(project, rid) {
  const rows = await query(
    `SELECT r.*, (SELECT count(*) FROM records x WHERE x.resource_id = r.id)::int AS record_count
     FROM resources r WHERE r.id = $1 AND r.project_id = $2`, [rid, project.id]);
  if (!rows[0]) throw new ApiError(404, 'resource_not_found', 'Resource not found.');
  return rows[0];
}

async function projectUsage(projectId) {
  const rows = await query(
    `SELECT COALESCE((SELECT count FROM rate_limit_counters WHERE key = $1 AND window_start = $2::timestamptz), 0)::int AS requests_today`,
    [`pd:${projectId}`, todayStart()]);
  return rows[0].requests_today;
}

async function touch(projectId) {
  await query('UPDATE projects SET last_active_at = now() WHERE id = $1 AND last_active_at < now() - interval \'10 minutes\'', [projectId]);
}

// ---------- handler ----------
export default wrap(async (req, res) => {
  manageCors(req, res);
  if (req.method === 'OPTIONS') return sendJson(res, 204);

  const { segs, query: qs } = parseUrl(req, '/api/manage');
  const method = req.method;
  const ip = clientIp(req);

  // per-IP throttle for the whole management surface
  const [ipHit] = await hitMany([{ key: `m:${ip}`, windowSec: 60 }]);
  if (ipHit.count > config.rateManagePerMin) {
    throw new ApiError(429, 'rate_limited', 'Too many requests. Please slow down.', undefined, { 'Retry-After': String(ipHit.resetSec) });
  }

  // GET /limits (public)
  if (segs[0] === 'limits' && method === 'GET') return sendJson(res, 200, publicLimits());

  const owner = ownerFromReq(req);
  const bodyLimit = config.manageMaxBodyBytes;
  const body = async () => requireObject(await readJson(req, bodyLimit));

  if (segs[0] !== 'projects') throw new ApiError(404, 'not_found', 'Unknown management endpoint.');

  // ----- /projects -----
  if (segs.length === 1) {
    if (method === 'GET') {
      const projects = await query(
        `SELECT p.*,
           (SELECT count(*) FROM records x WHERE x.project_id = p.id)::int AS record_count,
           COALESCE((SELECT count FROM rate_limit_counters c WHERE c.key = 'pd:' || p.id AND c.window_start = $2::timestamptz), 0)::int AS requests_today
         FROM projects p WHERE p.owner_hash = $1 ORDER BY p.created_at`, [owner, todayStart()]);
      const resources = await query(
        `SELECT r.*, (SELECT count(*) FROM records x WHERE x.resource_id = r.id)::int AS record_count
         FROM resources r JOIN projects p ON p.id = r.project_id WHERE p.owner_hash = $1 ORDER BY r.created_at`, [owner]);
      return sendJson(res, 200, {
        limits: publicLimits(),
        projects: projects.map((p) => projectDTO(req, p, {
          record_count: p.record_count, requests_today: p.requests_today,
          resources: resources.filter((r) => r.project_id === p.id).map((r) => resourceDTO(req, r)),
        })),
      });
    }
    if (method === 'POST') {
      const [create] = await hitMany([{ key: `pc:${ip}`, windowSec: 86400 }]);
      if (create.count > config.projectCreatesPerIpDay) {
        throw new ApiError(429, 'rate_limited', 'Project creation limit reached for today. Try again tomorrow.', undefined, { 'Retry-After': String(create.resetSec) });
      }
      const b = await body();
      const project = await createProject(owner, b.name);
      return sendJson(res, 201, { project: projectDTO(req, project, { record_count: 0, requests_today: 0, resources: [] }) });
    }
    throw methodNotAllowed(res, 'GET, POST');
  }

  const project = await getOwnedProject(owner, segs[1]);
  touch(project.id).catch(() => {});

  // ----- /projects/:pid -----
  if (segs.length === 2) {
    if (method === 'GET') {
      const resources = await query(
        `SELECT r.*, (SELECT count(*) FROM records x WHERE x.resource_id = r.id)::int AS record_count
         FROM resources r WHERE r.project_id = $1 ORDER BY r.created_at`, [project.id]);
      return sendJson(res, 200, { project: projectDTO(req, project, { requests_today: await projectUsage(project.id), resources: resources.map((r) => resourceDTO(req, r)) }) });
    }
    if (method === 'PATCH') {
      const b = await body();
      const name = b.name !== undefined ? cleanName(b.name, 'Project name') : project.name;
      const settings = b.settings !== undefined ? normalizeSettings(b.settings) : project.settings;
      const rows = await query('UPDATE projects SET name=$2, settings=$3::jsonb WHERE id=$1 RETURNING *', [project.id, name, JSON.stringify(settings)]);
      return sendJson(res, 200, { project: projectDTO(req, rows[0]) });
    }
    if (method === 'DELETE') {
      await query('DELETE FROM projects WHERE id = $1', [project.id]);
      return sendJson(res, 200, { deleted: true });
    }
    throw methodNotAllowed(res, 'GET, PATCH, DELETE');
  }

  const section = segs[2];

  // ----- /projects/:pid/resources -----
  if (section === 'resources' && segs.length === 3) {
    if (method === 'GET') {
      const rows = await query(
        `SELECT r.*, (SELECT count(*) FROM records x WHERE x.resource_id = r.id)::int AS record_count
         FROM resources r WHERE r.project_id = $1 ORDER BY r.created_at`, [project.id]);
      return sendJson(res, 200, { resources: rows.map((r) => resourceDTO(req, r)) });
    }
    if (method === 'POST') {
      const b = await body();
      const { resource, ai } = await createResource(project, b, { ownerHash: owner, useAI: Boolean(b.useAI) });
      return sendJson(res, 201, { resource: resourceDTO(req, await getResource(project, resource.id)), ai });
    }
    throw methodNotAllowed(res, 'GET, POST');
  }

  // ----- /projects/:pid/resources/:rid[/...] -----
  if (section === 'resources') {
    const resource = await getResource(project, segs[3]);
    const sub = segs[4];

    if (!sub) {
      if (method === 'GET') return sendJson(res, 200, { resource: resourceDTO(req, resource) });
      if (method === 'PATCH') {
        const b = await body();
        const name = b.name !== undefined ? validateResourceName(b.name) : resource.name;
        const schema = b.schema !== undefined ? normalizeFields(b.schema) : resource.schema;
        const settings = b.settings !== undefined ? normalizeSettings(b.settings) : resource.settings;
        try {
          await query('UPDATE resources SET name=$2, schema=$3::jsonb, settings=$4::jsonb, updated_at=now() WHERE id=$1',
            [resource.id, name, JSON.stringify(schema), JSON.stringify(settings)]);
        } catch (e) {
          if (String(e?.message).includes('resources_project_id_name_key') || e?.code === '23505') {
            throw new ApiError(409, 'resource_exists', `A resource named "${name}" already exists.`);
          }
          throw e;
        }
        return sendJson(res, 200, { resource: resourceDTO(req, await getResource(project, resource.id)) });
      }
      if (method === 'DELETE') {
        await query('DELETE FROM resources WHERE id = $1', [resource.id]);
        return sendJson(res, 200, { deleted: true });
      }
      throw methodNotAllowed(res, 'GET, PATCH, DELETE');
    }

    if (sub === 'generate' && method === 'POST') {
      const b = await body();
      const out = await regenerate(project, resource, {
        count: b.count, replace: b.replace !== false, seed: typeof b.seed === 'string' ? b.seed.slice(0, 60) : undefined,
        useAI: Boolean(b.useAI), ownerHash: owner,
      });
      return sendJson(res, 200, { resource: resourceDTO(req, await getResource(project, resource.id)), ai: out.ai });
    }

    if (sub === 'records') {
      const rid = segs[5];
      if (!rid) {
        if (method === 'GET') {
          const r = await listRecords(resource, qs);
          return sendJson(res, 200, { items: r.items, total: r.total, page: r.page, limit: r.limit, total_pages: r.totalPages });
        }
        if (method === 'POST') {
          const clean = validateBody(resource.schema, await body());
          const [rec] = await insertMany(resource, [clean]);
          return sendJson(res, 201, { record: rec });
        }
        throw methodNotAllowed(res, 'GET, POST');
      }
      if (method === 'GET') {
        const rec = await getRecord(resource, rid);
        if (!rec) throw new ApiError(404, 'record_not_found', 'Record not found.');
        return sendJson(res, 200, { record: rec });
      }
      if (method === 'PUT') {
        const rec = await replaceRecord(resource, rid, validateBody(resource.schema, await body()));
        if (!rec) throw new ApiError(404, 'record_not_found', 'Record not found.');
        return sendJson(res, 200, { record: rec });
      }
      if (method === 'DELETE') {
        const rec = await deleteRecord(resource, rid);
        if (!rec) throw new ApiError(404, 'record_not_found', 'Record not found.');
        return sendJson(res, 200, { record: rec });
      }
      throw methodNotAllowed(res, 'GET, PUT, DELETE');
    }
    throw new ApiError(404, 'not_found', 'Unknown management endpoint.');
  }

  // ----- apply an (AI or manual) multi-resource schema -----
  if (section === 'apply-schema' && method === 'POST') {
    const b = await body();
    const out = await applySchema(project, b.resources, { ownerHash: owner, useAI: Boolean(b.useAI) });
    const rows = await query(
      `SELECT r.*, (SELECT count(*) FROM records x WHERE x.resource_id = r.id)::int AS record_count
       FROM resources r WHERE r.project_id = $1 ORDER BY r.created_at`, [project.id]);
    return sendJson(res, 201, { resources: rows.map((r) => resourceDTO(req, r)), ai: out.ai });
  }

  // ----- AI: describe your API -----
  if (section === 'ai' && segs[3] === 'schema' && method === 'POST') {
    const b = await body();
    const [hit] = await hitMany([{ key: `ai:${owner}`, windowSec: 86400 }]);
    if (hit.count > config.aiDailyLimit) {
      throw new ApiError(429, 'ai_limit_reached', `Daily AI limit reached (${config.aiDailyLimit}). Build your schema manually or try again tomorrow.`, { fallback: 'manual' }, { 'Retry-After': String(hit.resetSec) });
    }
    const out = await generateSchema(b.prompt);
    return sendJson(res, 200, out);
  }

  // ----- import / export / logs -----
  if (section === 'import' && method === 'POST') {
    const b = await body();
    const out = await importResources(project, b.resources, { replace: Boolean(b.replace) });
    return sendJson(res, 201, { resources: out.resources.map((r) => resourceDTO(req, r)), notes: out.notes });
  }
  if (section === 'export' && method === 'GET') {
    return sendJson(res, 200, await exportProject(project), {
      'Content-Disposition': `attachment; filename="${project.id}-export.json"`,
    });
  }
  if (section === 'logs' && method === 'GET') {
    const rows = await query(
      `SELECT method, resource, path, status, duration_ms, simulated, created_at FROM request_logs
       WHERE project_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50`, [project.id]);
    return sendJson(res, 200, { logs: rows });
  }

  throw new ApiError(404, 'not_found', 'Unknown management endpoint.');
});

function methodNotAllowed(res, allow) {
  res.setHeader('Allow', allow);
  return new ApiError(405, 'method_not_allowed', `Method not allowed. Allowed: ${allow}.`);
}

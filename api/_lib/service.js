// Business logic shared by the management API and the seed script.
import { query, tx } from './db.js';
import { config } from './env.js';
import { ApiError } from './http.js';
import { newId } from './auth.js';
import { generateRecords } from './faker.js';
import { insertMany, allRecords } from './records.js';
import { collectRefs, normalizeFields, validateResourceName, inferFields, remapRecord, normalizeSettings, cleanName } from './schema.js';
import { generateValues } from './ai.js';
import { hitMany } from './ratelimit.js';
import { log } from './log.js';

export const DEFAULT_FIELDS = [
  { name: 'id', type: 'id' },
  { name: 'name', type: 'name' },
  { name: 'email', type: 'email' },
  { name: 'createdAt', type: 'date' },
];

export async function createProject(ownerHash, name) {
  const clean = cleanName(name, 'Project name');
  const [{ n }] = await query('SELECT count(*)::int AS n FROM projects WHERE owner_hash = $1', [ownerHash]);
  if (n >= config.maxProjects) {
    throw new ApiError(403, 'project_limit_reached', `The free tier allows ${config.maxProjects} projects. Delete one to create another.`);
  }
  for (let i = 0; i < 4; i++) {
    const id = newId(10);
    const rows = await query(
      'INSERT INTO projects (id, name, owner_hash) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING RETURNING *',
      [id, clean, ownerHash],
    );
    if (rows[0]) return rows[0];
  }
  throw new ApiError(500, 'id_collision', 'Could not allocate a project id, please retry.');
}

async function loadRefIds(project, fields) {
  const refs = [...collectRefs(fields)];
  const out = {};
  for (const name of refs) {
    const rows = await query(
      `SELECT x.id FROM records x JOIN resources r ON r.id = x.resource_id
       WHERE r.project_id = $1 AND r.name = $2 ORDER BY x.id LIMIT 100`,
      [project.id, name],
    );
    out[name] = rows.map((r) => r.id);
  }
  return out;
}

/** Calls the LLM (cached, batched) for fields carrying an aiHint. Never throws: falls back locally. */
async function loadAiValues(fields, count, ownerHash) {
  const hinted = fields.filter((f) => f.aiHint);
  const result = { values: {}, used: false, fallback: false };
  if (!hinted.length) return result;
  result.used = true;
  const [{ count: n, resetSec }] = await hitMany([{ key: `ai:${ownerHash}`, windowSec: 86400 }]);
  if (n > config.aiDailyLimit) {
    result.fallback = true;
    result.message = `Daily AI limit reached (${config.aiDailyLimit}). Used the built-in generator instead. Resets in ~${Math.ceil(resetSec / 3600)}h.`;
    return result;
  }
  await Promise.all(hinted.map(async (f) => {
    try { result.values[f.name] = await generateValues(f.aiHint, count); } catch (e) {
      result.fallback = true;
      log('warn', 'ai_values_fallback', { field: f.name, error: e.code || String(e) });
    }
  }));
  if (result.fallback && !result.message) result.message = 'AI was unavailable for some fields; used the built-in generator instead.';
  return result;
}

function clampCount(count, fallback = 10) {
  const n = Number.parseInt(count ?? fallback, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(config.maxRecords, Math.max(0, n));
}

async function buildBodies(project, resource, count, { seed, useAI, ownerHash }) {
  const refIds = await loadRefIds(project, resource.schema);
  const ai = useAI ? await loadAiValues(resource.schema, count, ownerHash) : { values: {}, used: false, fallback: false };
  const bodies = generateRecords(resource.schema, count, {
    seed: seed || `${project.id}:${resource.name}`, refIds, aiValues: ai.values,
  });
  return { bodies, ai };
}

/** Creates a resource (and optionally seeds it). */
export async function createResource(project, def, { ownerHash, useAI = false } = {}) {
  const name = validateResourceName(def.name);
  const fields = def.fields ? normalizeFields(def.fields) : DEFAULT_FIELDS;
  const settings = normalizeSettings(def.settings);
  const count = clampCount(def.count, 10);
  const [{ n }] = await query('SELECT count(*)::int AS n FROM resources WHERE project_id = $1', [project.id]);
  if (n >= config.maxResources) {
    throw new ApiError(403, 'resource_limit_reached', `The free tier allows ${config.maxResources} resources per project.`);
  }
  const rows = await query(
    `INSERT INTO resources (id, project_id, name, schema, settings) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
     ON CONFLICT (project_id, name) DO NOTHING RETURNING *`,
    [newId(8, 'r_'), project.id, name, JSON.stringify(fields), JSON.stringify(settings)],
  );
  if (!rows[0]) throw new ApiError(409, 'resource_exists', `A resource named "${name}" already exists in this project.`);
  const resource = rows[0];
  let ai = { used: false, fallback: false };
  if (count > 0) {
    const built = await buildBodies(project, resource, count, { seed: def.seed, useAI, ownerHash });
    ai = built.ai;
    await insertMany(resource, built.bodies);
  }
  return { resource, ai };
}

/** (Re)generates records for a resource. `replace` wipes existing records first. */
export async function regenerate(project, resource, { count, replace = true, seed, useAI = false, ownerHash }) {
  const n = clampCount(count, 10);
  if (n < 1) throw new ApiError(400, 'invalid_count', `Count must be between 1 and ${config.maxRecords}.`);
  // Appending with the same seed would duplicate existing rows, so mix in the id counter.
  const effectiveSeed = seed || (replace ? undefined : `${project.id}:${resource.name}:${resource.next_id}`);
  const { bodies, ai } = await buildBodies(project, resource, n, { seed: effectiveSeed, useAI, ownerHash });
  if (replace) {
    await tx(async (q) => {
      await q('DELETE FROM records WHERE resource_id = $1', [resource.id]);
      await q('UPDATE resources SET next_id = 1 WHERE id = $1', [resource.id]);
      await insertMany(resource, bodies, q);
    });
  } else {
    await insertMany(resource, bodies);
  }
  return { ai, count: n };
}

/** Orders resource definitions so parents (ref targets) are created before children. */
function topoSort(defs) {
  const byName = new Map(defs.map((d) => [d.name, d]));
  const out = []; const state = new Map();
  const visit = (d) => {
    if (state.get(d.name)) return;
    state.set(d.name, 1);
    for (const ref of collectRefs(d.fields)) if (byName.has(ref) && byName.get(ref) !== d) visit(byName.get(ref));
    out.push(d);
  };
  defs.forEach(visit);
  return out;
}

/** Applies a multi-resource proposal (from the AI or an import) to a project. */
export async function applySchema(project, defs, opts = {}) {
  if (!Array.isArray(defs) || !defs.length) throw new ApiError(400, 'invalid_schema', 'Provide at least one resource.');
  const names = defs.map((d) => validateResourceName(d.name));
  if (new Set(names).size !== names.length) throw new ApiError(400, 'invalid_schema', 'Duplicate resource names in the proposal.');
  const existing = await query('SELECT count(*)::int AS n FROM resources WHERE project_id = $1', [project.id]);
  if (existing[0].n + defs.length > config.maxResources) {
    throw new ApiError(403, 'resource_limit_reached', `This would exceed the ${config.maxResources}-resource free-tier limit.`);
  }
  const created = [];
  let ai = { used: false, fallback: false };
  for (const def of topoSort(defs.map((d, i) => ({ ...d, name: names[i] })))) {
    const r = await createResource(project, def, opts);
    created.push(r.resource);
    if (r.ai.used) ai = { used: true, fallback: ai.fallback || r.ai.fallback, message: r.ai.message || ai.message };
  }
  return { resources: created, ai };
}

/** Import already-shaped data: infer a schema when none is supplied, then seed the records. */
export async function importResources(project, items, { replace = false } = {}) {
  if (!Array.isArray(items) || !items.length) throw new ApiError(400, 'invalid_import', 'Nothing to import.');
  const notes = [];
  const out = [];
  for (const item of items) {
    const name = validateResourceName(item.name);
    const records = Array.isArray(item.records) ? item.records : [];
    if (!records.length && !item.fields) throw new ApiError(400, 'invalid_import', `"${name}" has no records to import.`);
    let rows = records.map(remapRecord);
    if (rows.length > config.maxRecords) {
      notes.push(`"${name}": only the first ${config.maxRecords} of ${rows.length} records were imported (free-tier limit).`);
      rows = rows.slice(0, config.maxRecords);
    }
    const fields = normalizeFields(item.fields ?? inferFields(rows));
    const found = (await query('SELECT * FROM resources WHERE project_id=$1 AND name=$2', [project.id, name]))[0];
    if (found && !replace) throw new ApiError(409, 'resource_exists', `"${name}" already exists. Enable "replace existing" to overwrite it.`);
    let resource = found;
    if (found) {
      resource = (await query('UPDATE resources SET schema=$2::jsonb, settings = COALESCE($3::jsonb, settings), updated_at=now() WHERE id=$1 RETURNING *',
        [found.id, JSON.stringify(fields), item.settings ? JSON.stringify(normalizeSettings(item.settings)) : null]))[0];
    } else {
      const [{ n }] = await query('SELECT count(*)::int AS n FROM resources WHERE project_id = $1', [project.id]);
      if (n >= config.maxResources) throw new ApiError(403, 'resource_limit_reached', `The free tier allows ${config.maxResources} resources per project.`);
      resource = (await query(
        'INSERT INTO resources (id, project_id, name, schema, settings) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb) RETURNING *',
        [newId(8, 'r_'), project.id, name, JSON.stringify(fields), JSON.stringify(normalizeSettings(item.settings))],
      ))[0];
    }
    const bodies = rows.map((r) => { const c = { ...r }; delete c.id; return c; });
    await tx(async (q) => {
      await q('DELETE FROM records WHERE resource_id = $1', [resource.id]);
      await q('UPDATE resources SET next_id = 1 WHERE id = $1', [resource.id]);
      await insertMany(resource, bodies, q);
    });
    out.push(resource);
  }
  return { resources: out, notes };
}

export async function exportProject(project) {
  const resources = await query('SELECT * FROM resources WHERE project_id = $1 ORDER BY created_at', [project.id]);
  const items = [];
  for (const r of resources) {
    items.push({ name: r.name, fields: r.schema, settings: r.settings, records: await allRecords(r) });
  }
  return { version: 1, exported_at: new Date().toISOString(), project: { name: project.name, settings: project.settings }, resources: items };
}

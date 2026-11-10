// Record storage + query engine. Every statement is parameterised; field names coming from the
// URL are only used after being matched against the resource schema (and even then are bound as
// parameters, never concatenated into SQL).
import { query } from './db.js';
import { config } from './env.js';
import { ApiError } from './http.js';
import { orderRecord } from './faker.js';

const present = (resource, row) => orderRecord(resource.schema, row.data);

const NUMERIC_TYPES = new Set(['id', 'int', 'float', 'ref']);

function parseId(raw) {
  const s = String(raw);
  return /^\d{1,9}$/.test(s) ? Number(s) : null;
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * Lists records with pagination, sorting, filtering and search.
 * `extraFilters` lets the relationship route add `fk = parentId`.
 */
export async function listRecords(resource, params, extraFilters = []) {
  const fields = resource.schema;
  const byName = new Map(fields.map((f) => [f.name, f]));
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const rawLimit = Number.parseInt(params.get('limit') ?? '10', 10);
  const limit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 10));

  const args = [resource.project_id, resource.id];
  const where = ['project_id = $1', 'resource_id = $2'];
  const bind = (v) => { args.push(v); return `$${args.length}`; };

  // exact-match filters: ?field=value (repeat the param for OR / IN semantics)
  const RESERVED = new Set(['page', 'limit', 'sortBy', 'order', 'search', 'envelope']);
  const filters = [...extraFilters];
  for (const key of new Set(params.keys())) {
    if (RESERVED.has(key) || !byName.has(key)) continue;
    filters.push({ field: key, values: params.getAll(key).slice(0, 20) });
  }
  for (const flt of filters) {
    const ors = flt.values.map((v) => `data->>${bind(flt.field)}::text = ${bind(String(v))}::text`);
    where.push(`(${ors.join(' OR ')})`);
  }

  const search = (params.get('search') ?? '').trim().slice(0, 100);
  if (search) where.push(`data::text ILIKE ${bind(`%${escapeLike(search)}%`)}`);

  const whereSql = where.join(' AND ');
  const whereArgs = [...args]; // the count query must only receive parameters it references

  // sorting
  let orderBy = 'id ASC';
  const sortBy = params.get('sortBy');
  const dir = String(params.get('order') || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  if (sortBy) {
    const f = byName.get(sortBy);
    if (!f) throw new ApiError(400, 'invalid_sort', `Unknown sortBy field "${sortBy}".`, { fields: [...byName.keys()] });
    if (f.name === 'id') orderBy = `id ${dir}`;
    else if (NUMERIC_TYPES.has(f.type)) {
      const p = bind(f.name);
      orderBy = `CASE WHEN jsonb_typeof(data->${p}::text) = 'number' THEN (data->>${p}::text)::numeric END ${dir} NULLS LAST, id ASC`;
    } else orderBy = `data->>${bind(f.name)}::text ${dir} NULLS LAST, id ASC`;
  }

  const offset = (page - 1) * limit;
  const limP = bind(limit);
  const offP = bind(offset);
  const [rows, countRows] = await Promise.all([
    query(`SELECT data FROM records WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ${limP} OFFSET ${offP}`, args),
    query(`SELECT count(*)::int AS n FROM records WHERE ${whereSql}`, whereArgs),
  ]);
  const total = countRows[0]?.n ?? 0;
  return { items: rows.map((r) => present(resource, r)), total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export async function getRecord(resource, rawId) {
  const id = parseId(rawId);
  if (id === null) return null;
  const rows = await query('SELECT data FROM records WHERE project_id=$1 AND resource_id=$2 AND id=$3', [resource.project_id, resource.id, id]);
  return rows[0] ? present(resource, rows[0]) : null;
}

/**
 * Atomically allocates ids and inserts bodies, enforcing the per-resource record cap in the same
 * statement. `q` can be a transaction runner; defaults to a plain query.
 */
export async function insertMany(resource, bodies, q = query) {
  if (!bodies.length) return [];
  const rows = await q(
    `WITH r AS (
       UPDATE resources SET next_id = next_id + $3::int, updated_at = now()
       WHERE id = $2::text AND project_id = $1::text
         AND (SELECT count(*) FROM records WHERE resource_id = $2::text) + $3::int <= $4::int
       RETURNING next_id - $3::int AS start
     )
     INSERT INTO records (project_id, resource_id, id, data)
     SELECT $1::text, $2::text, (r.start + t.ord - 1)::int,
            jsonb_set(t.elem, '{id}', to_jsonb((r.start + t.ord - 1)::int))
     FROM r, jsonb_array_elements($5::jsonb) WITH ORDINALITY AS t(elem, ord)
     RETURNING id, data`,
    [resource.project_id, resource.id, bodies.length, config.maxRecords, JSON.stringify(bodies)],
  );
  if (!rows.length) {
    throw new ApiError(409, 'record_limit_reached',
      `This resource can hold at most ${config.maxRecords} records on the free tier. Delete some records first.`);
  }
  return rows.sort((a, b) => a.id - b.id).map((r) => present(resource, r));
}

export async function replaceRecord(resource, rawId, body) {
  const id = parseId(rawId);
  if (id === null) return null;
  const rows = await query(
    `UPDATE records SET data = jsonb_set($4::jsonb, '{id}', to_jsonb(id)), updated_at = now()
     WHERE project_id=$1 AND resource_id=$2 AND id=$3 RETURNING data`,
    [resource.project_id, resource.id, id, JSON.stringify(body)],
  );
  return rows[0] ? present(resource, rows[0]) : null;
}

export async function patchRecord(resource, rawId, body) {
  const id = parseId(rawId);
  if (id === null) return null;
  const rows = await query(
    `UPDATE records SET data = jsonb_set(data || $4::jsonb, '{id}', to_jsonb(id)), updated_at = now()
     WHERE project_id=$1 AND resource_id=$2 AND id=$3 RETURNING data`,
    [resource.project_id, resource.id, id, JSON.stringify(body)],
  );
  return rows[0] ? present(resource, rows[0]) : null;
}

export async function deleteRecord(resource, rawId) {
  const id = parseId(rawId);
  if (id === null) return null;
  const rows = await query(
    'DELETE FROM records WHERE project_id=$1 AND resource_id=$2 AND id=$3 RETURNING data',
    [resource.project_id, resource.id, id],
  );
  return rows[0] ? present(resource, rows[0]) : null;
}

export async function allRecords(resource) {
  const rows = await query('SELECT data FROM records WHERE project_id=$1 AND resource_id=$2 ORDER BY id', [resource.project_id, resource.id]);
  return rows.map((r) => present(resource, r));
}

// Schema normalisation / validation, record validation, simulation-settings validation,
// and schema inference from sample data (JSON / CSV import).
import { ApiError } from './http.js';
import { config } from './env.js';

export const FIELD_TYPES = ['id', 'string', 'text', 'int', 'float', 'boolean', 'date', 'email', 'name', 'phone',
  'address', 'avatar', 'uuid', 'url', 'company', 'enum', 'object', 'array', 'ref'];
const STRING_TYPES = new Set(['string', 'text', 'email', 'name', 'phone', 'address', 'avatar', 'uuid', 'url', 'company']);
const SCALAR_FOR_ARRAY = FIELD_TYPES.filter((t) => !['id', 'ref'].includes(t));

const FIELD_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
export const RESOURCE_NAME_RE = /^[a-z][a-z0-9_-]{0,29}$/;
const MAX_FIELDS = 30;
const MAX_DEPTH = 3;

const invalid = (message, details) => new ApiError(400, 'invalid_schema', message, details);
const num = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));

/** Cleans one field definition (drops unknown keys, clamps options). Throws on bad input. */
function normalizeField(raw, depth, path) {
  if (!raw || typeof raw !== 'object') throw invalid(`${path}: field must be an object.`);
  const name = String(raw.name ?? '').trim();
  if (!FIELD_NAME_RE.test(name)) {
    throw invalid(`${path || 'field'}: name "${name}" is invalid. Use letters, numbers and underscores (max 40, cannot start with a number).`);
  }
  const where = path ? `${path}.${name}` : name;
  const type = String(raw.type ?? '');
  if (!FIELD_TYPES.includes(type)) throw invalid(`${where}: unknown type "${type}".`);
  const f = { name, type };

  if (typeof raw.aiHint === 'string' && raw.aiHint.trim() && STRING_TYPES.has(type)) {
    f.aiHint = raw.aiHint.trim().slice(0, 80);
  }
  switch (type) {
    case 'string': if (num(raw.words) !== undefined) f.words = Math.min(12, Math.max(1, Math.round(num(raw.words)))); break;
    case 'int': case 'float': {
      const min = num(raw.min); const max = num(raw.max);
      if (min !== undefined && !Number.isFinite(min)) throw invalid(`${where}: min must be a number.`);
      if (max !== undefined && !Number.isFinite(max)) throw invalid(`${where}: max must be a number.`);
      if (min !== undefined && max !== undefined && min > max) throw invalid(`${where}: min cannot be greater than max.`);
      if (min !== undefined) f.min = min;
      if (max !== undefined) f.max = max;
      if (type === 'float' && num(raw.decimals) !== undefined) f.decimals = Math.min(6, Math.max(0, Math.round(num(raw.decimals))));
      break;
    }
    case 'date':
      if (raw.format === 'date' || raw.format === 'datetime') f.format = raw.format;
      for (const k of ['from', 'to']) {
        if (raw[k]) {
          if (!Number.isFinite(Date.parse(raw[k]))) throw invalid(`${where}: "${k}" is not a valid date.`);
          f[k] = String(raw[k]).slice(0, 30);
        }
      }
      break;
    case 'enum': {
      const values = Array.isArray(raw.values) ? raw.values : String(raw.values ?? '').split(',');
      const clean = [...new Set(values.map((v) => String(v).trim()).filter(Boolean).map((v) => v.slice(0, 40)))].slice(0, 20);
      if (!clean.length) throw invalid(`${where}: enum needs at least one value.`);
      f.values = clean;
      break;
    }
    case 'ref': {
      const ref = String(raw.ref ?? '').trim().toLowerCase();
      if (!RESOURCE_NAME_RE.test(ref)) throw invalid(`${where}: choose the resource this field points to.`);
      f.ref = ref;
      break;
    }
    case 'object':
      if (depth >= MAX_DEPTH) throw invalid(`${where}: objects can be nested at most ${MAX_DEPTH} levels deep.`);
      f.fields = normalizeFields(raw.fields ?? [], { depth: depth + 1, path: where, allowEmpty: false, implicitId: false });
      break;
    case 'array': {
      if (depth >= MAX_DEPTH) throw invalid(`${where}: arrays can be nested at most ${MAX_DEPTH} levels deep.`);
      const of = raw.of ?? { type: 'string' };
      const ofType = String(of.type ?? 'string');
      if (!SCALAR_FOR_ARRAY.includes(ofType)) throw invalid(`${where}: array items cannot be "${ofType}".`);
      f.of = normalizeField({ ...of, name: 'item' }, depth + 1, where);
      delete f.of.name;
      f.min = Math.min(10, Math.max(0, Math.round(num(raw.min) ?? 1)));
      f.max = Math.min(10, Math.max(f.min, Math.round(num(raw.max) ?? 3)));
      break;
    }
    default: break;
  }
  return f;
}

/**
 * Normalises a list of fields. The top level always starts with a locked `id` field.
 * @returns {object[]} clean fields
 */
export function normalizeFields(input, { depth = 0, path = '', allowEmpty = true, implicitId = true } = {}) {
  if (!Array.isArray(input)) throw invalid('Schema must be an array of fields.');
  if (input.length > MAX_FIELDS) throw invalid(`A schema can have at most ${MAX_FIELDS} fields.`);
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    const f = normalizeField(raw, depth, path);
    if (seen.has(f.name)) throw invalid(`Duplicate field name "${f.name}".`);
    seen.add(f.name);
    if (f.type === 'id') { if (depth === 0 && f.name !== 'id') throw invalid('The id field must be called "id".'); }
    out.push(f);
  }
  if (!allowEmpty && !out.length) throw invalid(`${path || 'schema'}: add at least one field.`);
  if (implicitId && depth === 0) {
    const rest = out.filter((f) => f.name !== 'id');
    return [{ name: 'id', type: 'id' }, ...rest];
  }
  return out;
}

export function validateResourceName(name) {
  const n = String(name ?? '').trim().toLowerCase();
  if (!RESOURCE_NAME_RE.test(n)) {
    throw new ApiError(400, 'invalid_name',
      'Resource names must start with a letter and use only lowercase letters, numbers, "-" or "_" (max 30).');
  }
  return n;
}

export function cleanName(name, label = 'Name') {
  const n = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!n) throw new ApiError(400, 'invalid_name', `${label} is required.`);
  if (n.length > 60) throw new ApiError(400, 'invalid_name', `${label} must be 60 characters or fewer.`);
  return n;
}

export function slugify(s) {
  const slug = String(s ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/g, '').slice(0, 30);
  return slug;
}

/** Names of resources referenced through `ref` fields (nested included). */
export function collectRefs(fields, acc = new Set()) {
  for (const f of fields || []) {
    if (f.type === 'ref') acc.add(f.ref);
    if (f.type === 'object') collectRefs(f.fields, acc);
  }
  return acc;
}

// ---------- simulation settings ----------
const BLOCKED_HEADERS = /^(content-length|content-type|host|connection|transfer-encoding|set-cookie|cookie|upgrade|te|trailer|access-control-.*|vary|cache-control)$/i;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Validates simulation settings. Unset keys are omitted so resource settings can inherit. */
export function normalizeSettings(raw) {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError(400, 'invalid_settings', 'Settings must be an object.');
  const out = {};
  const bad = (m) => new ApiError(400, 'invalid_settings', m);

  const delay = num(raw.delay_ms);
  if (delay !== undefined) {
    if (!Number.isFinite(delay) || delay < 0 || delay > config.maxDelayMs) throw bad(`Delay must be between 0 and ${config.maxDelayMs} ms.`);
    out.delay_ms = Math.round(delay);
  }
  const rate = num(raw.error_rate);
  if (rate !== undefined) {
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw bad('Error rate must be between 0 and 100 %.');
    out.error_rate = Math.round(rate * 10) / 10;
  }
  const es = num(raw.error_status);
  if (es !== undefined) {
    if (!Number.isInteger(es) || es < 400 || es > 599) throw bad('Error status must be an HTTP code from 400 to 599.');
    out.error_status = es;
  }
  if (raw.status_codes && typeof raw.status_codes === 'object') {
    const sc = {};
    for (const m of METHODS) {
      const v = num(raw.status_codes[m]);
      if (v === undefined) continue;
      if (!Number.isInteger(v) || v < 200 || v > 299) throw bad(`Custom status for ${m} must be a 2xx code.`);
      sc[m] = v;
    }
    if (Object.keys(sc).length) out.status_codes = sc;
  }
  if (raw.headers && typeof raw.headers === 'object' && !Array.isArray(raw.headers)) {
    const entries = Object.entries(raw.headers).filter(([k, v]) => String(k).trim() && v !== '' && v != null);
    if (entries.length > 10) throw bad('You can set at most 10 custom headers.');
    const h = {};
    for (const [k, v] of entries) {
      const name = String(k).trim();
      const value = String(v);
      if (!/^[A-Za-z0-9-]{1,40}$/.test(name)) throw bad(`Header name "${name}" is invalid.`);
      if (BLOCKED_HEADERS.test(name)) throw bad(`Header "${name}" cannot be overridden.`);
      if (value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) throw bad(`Header "${name}" has an invalid value.`);
      h[name] = value;
    }
    if (Object.keys(h).length) out.headers = h;
  }
  return out;
}

/** Resource settings override project settings key by key (headers/status codes are merged). */
export function mergeSettings(project = {}, resource = {}) {
  return {
    delay_ms: resource.delay_ms ?? project.delay_ms ?? 0,
    error_rate: resource.error_rate ?? project.error_rate ?? 0,
    error_status: resource.error_status ?? project.error_status ?? 500,
    status_codes: { ...(project.status_codes || {}), ...(resource.status_codes || {}) },
    headers: { ...(project.headers || {}), ...(resource.headers || {}) },
  };
}

// ---------- record validation ----------
function typeError(f, v) {
  if (v === null) return null; // null is always accepted
  switch (f.type) {
    case 'int': return Number.isInteger(v) ? null : 'must be an integer';
    case 'float': return typeof v === 'number' && Number.isFinite(v) ? null : 'must be a number';
    case 'boolean': return typeof v === 'boolean' ? null : 'must be true or false';
    case 'date': return typeof v === 'string' && Number.isFinite(Date.parse(v)) ? null : 'must be an ISO date string';
    case 'enum': return f.values.includes(v) ? null : `must be one of: ${f.values.join(', ')}`;
    case 'ref': return Number.isInteger(v) || typeof v === 'string' ? null : 'must be an id';
    case 'object': return v && typeof v === 'object' && !Array.isArray(v) ? null : 'must be an object';
    case 'array': return Array.isArray(v) ? null : 'must be an array';
    case 'id': return null;
    default: return typeof v === 'string' ? null : 'must be a string';
  }
}

function depthOf(v, d = 0) {
  if (d > 8) return d;
  if (Array.isArray(v)) return v.reduce((m, x) => Math.max(m, depthOf(x, d + 1)), d);
  if (v && typeof v === 'object') return Object.values(v).reduce((m, x) => Math.max(m, depthOf(x, d + 1)), d);
  return d;
}

/**
 * Validates a request body against a resource schema. Unknown keys are allowed (like most mock
 * servers) but known keys must have the right type. Returns the cleaned body.
 */
export function validateBody(fields, body, { partial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'invalid_body', 'Request body must be a JSON object.');
  }
  if (Object.keys(body).length > 60) throw new ApiError(400, 'invalid_body', 'Too many keys in body (max 60).');
  if (depthOf(body) > 8) throw new ApiError(400, 'invalid_body', 'Body is nested too deeply (max 8 levels).');
  const errors = [];
  const check = (list, obj, prefix) => {
    for (const f of list) {
      if (f.type === 'id') continue;
      if (!(f.name in obj)) continue;
      const v = obj[f.name];
      const msg = typeError(f, v);
      if (msg) { errors.push({ field: prefix + f.name, message: `${prefix}${f.name} ${msg}` }); continue; }
      if (f.type === 'object' && v && f.fields) check(f.fields, v, `${prefix}${f.name}.`);
      if (f.type === 'array' && Array.isArray(v) && f.of) {
        v.forEach((item, i) => { const m = typeError(f.of, item); if (m) errors.push({ field: `${prefix}${f.name}[${i}]`, message: `${prefix}${f.name}[${i}] ${m}` }); });
      }
    }
  };
  check(fields, body, '');
  void partial;
  if (errors.length) throw new ApiError(400, 'validation_error', 'Body does not match the resource schema.', errors);
  const clean = { ...body };
  delete clean.id; // ids are always assigned by the server
  return clean;
}

// ---------- schema inference (import) ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const URL_RE = /^https?:\/\/\S+$/i;
const PHONE_RE = /^\+?[\d\s().-]{7,20}$/;

function sanitizeKey(k) {
  const s = String(k).trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return /^[A-Za-z_]/.test(s) ? s : s ? `f_${s}`.slice(0, 40) : '';
}

function inferType(values) {
  const vals = values.filter((v) => v !== null && v !== undefined && v !== '');
  if (!vals.length) return { type: 'string' };
  if (vals.every((v) => typeof v === 'boolean')) return { type: 'boolean' };
  if (vals.every((v) => typeof v === 'number')) {
    const ints = vals.every(Number.isInteger);
    const min = Math.min(...vals); const max = Math.max(...vals);
    return ints ? { type: 'int', min, max } : { type: 'float', min, max, decimals: 2 };
  }
  if (vals.every((v) => Array.isArray(v))) {
    const items = vals.flat().slice(0, 50);
    const of = inferType(items);
    if (of.type === 'object' || of.type === 'array') return { type: 'array', of: { type: 'string' } };
    return { type: 'array', of, min: 0, max: 5 };
  }
  if (vals.every((v) => v && typeof v === 'object' && !Array.isArray(v))) {
    return { type: 'object', fields: inferFields(vals, 1) };
  }
  const strs = vals.map(String);
  if (strs.every((s) => EMAIL_RE.test(s))) return { type: 'email' };
  if (strs.every((s) => UUID_RE.test(s))) return { type: 'uuid' };
  if (strs.every((s) => ISO_RE.test(s)) && strs.every((s) => Number.isFinite(Date.parse(s)))) {
    return { type: 'date', format: strs.every((s) => s.length === 10) ? 'date' : 'datetime' };
  }
  if (strs.every((s) => URL_RE.test(s))) return { type: 'url' };
  if (strs.every((s) => PHONE_RE.test(s) && /\d{7,}/.test(s.replace(/\D/g, '')) && /[+()\- ]/.test(s))) return { type: 'phone' };
  const distinct = [...new Set(strs)];
  if (strs.length >= 8 && distinct.length <= 5 && distinct.every((s) => s.length <= 30)) return { type: 'enum', values: distinct };
  return { type: 'string' };
}

/** Infers a normalised-ish field list from sample records. */
export function inferFields(records, depth = 0) {
  const keys = [];
  for (const rec of records.slice(0, 100)) {
    if (rec && typeof rec === 'object' && !Array.isArray(rec)) for (const k of Object.keys(rec)) if (!keys.includes(k)) keys.push(k);
  }
  const fields = [];
  const used = new Set();
  for (const key of keys.slice(0, MAX_FIELDS)) {
    const name = key === 'id' && depth === 0 ? 'id' : sanitizeKey(key);
    if (!name || used.has(name)) continue;
    used.add(name);
    if (name === 'id' && depth === 0) { fields.push({ name: 'id', type: 'id' }); continue; }
    const f = { name, ...inferType(records.map((r) => r?.[key])) };
    if (f.type === 'object' && depth + 1 >= MAX_DEPTH) f.type = 'string';
    fields.push(f);
  }
  return fields;
}

/** Renames record keys to match sanitised field names (so imported data lines up with the schema). */
export function remapRecord(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return {};
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    const name = k === 'id' ? 'id' : sanitizeKey(k);
    if (name && !(name in out)) out[name] = v;
  }
  return out;
}

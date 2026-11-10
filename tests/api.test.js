// End-to-end API tests against the dev server + embedded Postgres.   npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 3191;
const B = `http://localhost:${PORT}`;
const TOKEN = `mat_${'cd'.repeat(24)}`;
const OTHER = `mat_${'ef'.repeat(24)}`;
let server;
let pid;
let usersId;

const json = { 'Content-Type': 'application/json' };
const mg = (path, { method = 'GET', body, token = TOKEN } = {}) =>
  fetch(`${B}/api/manage${path}`, { method, headers: { ...json, 'X-Owner-Token': token }, body: body ? JSON.stringify(body) : undefined });
const v1 = (path, { method = 'GET', body, raw, headers } = {}) =>
  fetch(`${B}/api/v1/${pid}${path}`, { method, headers: { ...json, ...headers }, body: raw ?? (body ? JSON.stringify(body) : undefined) });

before(async () => {
  server = spawn(process.execPath, ['scripts/dev-server.js', '--local'], {
    env: { ...process.env, PORT: String(PORT), PGLITE_DIR: 'memory://', MAX_RECORDS_PER_RESOURCE: '20', MAX_REQUESTS_PER_DAY: '60', MAX_RESOURCES_PER_PROJECT: '3' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${B}/api/manage/limits`)).ok) return; } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('server did not start');
});
after(() => server?.kill());

test('management requires a valid token', async () => {
  assert.equal((await fetch(`${B}/api/manage/projects`)).status, 401);
  assert.equal((await mg('/projects', { token: 'nope' })).status, 401);
});

test('create project and resource with seeded data', async () => {
  const p = await (await mg('/projects', { method: 'POST', body: { name: 'Test shop' } })).json();
  pid = p.project.id;
  assert.match(pid, /^[a-z0-9]{10}$/);
  const r = await mg(`/projects/${pid}/resources`, { method: 'POST', body: {
    name: 'users', count: 12,
    fields: [{ name: 'name', type: 'name' }, { name: 'email', type: 'email' }, { name: 'age', type: 'int', min: 18, max: 60 },
      { name: 'role', type: 'enum', values: ['admin', 'user'] }, { name: 'active', type: 'boolean' }],
  } });
  assert.equal(r.status, 201);
  const body = await r.json();
  usersId = body.resource.id;
  assert.equal(body.resource.record_count, 12);
  assert.equal(body.resource.schema[0].name, 'id');
});

test('other owners cannot see or change the project', async () => {
  assert.equal((await mg(`/projects/${pid}`, { token: OTHER })).status, 404);
  assert.equal((await mg(`/projects/${pid}`, { method: 'DELETE', token: OTHER })).status, 404);
});

test('GET list: pagination headers, sorting, filtering, search, envelope', async () => {
  const res = await v1('/users?limit=5&page=2&sortBy=age&order=desc');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-total-count'), '12');
  assert.equal(res.headers.get('x-total-pages'), '3');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const rows = await res.json();
  assert.equal(rows.length, 5);
  const ages = (await (await v1('/users?sortBy=age&order=desc&limit=100')).json()).map((r) => r.age);
  assert.deepEqual(ages, [...ages].sort((a, b) => b - a));
  const admins = await (await v1('/users?role=admin&limit=100')).json();
  assert.ok(admins.every((r) => r.role === 'admin'));
  const env = await (await v1('/users?envelope=true&limit=2')).json();
  assert.equal(env.data.length, 2);
  assert.equal(env.meta.total, 12);
  const hit = await (await v1(`/users?search=${encodeURIComponent(rows[0].name.split(' ')[0])}`)).json();
  assert.ok(hit.length >= 1);
  assert.equal((await v1('/users?sortBy=bogus')).status, 400);
});

test('field order follows the schema (not JSONB key order)', async () => {
  const [first] = await (await v1('/users?limit=1')).json();
  assert.deepEqual(Object.keys(first), ['id', 'name', 'email', 'age', 'role', 'active']);
});

test('generation is deterministic for the same seed', async () => {
  const gen = () => mg(`/projects/${pid}/resources/${usersId}/generate`, { method: 'POST', body: { count: 4, seed: 'abc' } });
  assert.equal((await gen()).status, 200);
  const a = await (await v1('/users?limit=100')).json();
  await gen();
  const b = await (await v1('/users?limit=100')).json();
  assert.deepEqual(a, b);
  assert.equal(a.length, 4);
});

test('POST / GET one / PUT / PATCH / DELETE', async () => {
  const created = await v1('/users', { method: 'POST', body: { name: 'Ada', email: 'ada@example.com', age: 36, role: 'admin', active: true, id: 999 } });
  assert.equal(created.status, 201);
  const rec = await created.json();
  assert.notEqual(rec.id, 999); // client supplied ids are ignored
  assert.equal((await (await v1(`/users/${rec.id}`)).json()).name, 'Ada');
  const put = await (await v1(`/users/${rec.id}`, { method: 'PUT', body: { name: 'Ada L.' } })).json();
  assert.equal(put.name, 'Ada L.');
  assert.equal(put.email, undefined);
  const patched = await (await v1(`/users/${rec.id}`, { method: 'PATCH', body: { age: 37 } })).json();
  assert.equal(patched.name, 'Ada L.');
  assert.equal(patched.age, 37);
  const del = await v1(`/users/${rec.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await v1(`/users/${rec.id}`)).status, 404);
  assert.equal((await v1('/users/abc')).status, 404);
});

test('validation errors are specific', async () => {
  const res = await v1('/users', { method: 'POST', body: { age: 'old', role: 'root' } });
  assert.equal(res.status, 400);
  const err = (await res.json()).error;
  assert.equal(err.code, 'validation_error');
  assert.equal(err.details.length, 2);
});

test('abuse protection: non-JSON, oversize and malformed bodies', async () => {
  assert.equal((await v1('/users', { method: 'POST', raw: 'a=b', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await v1('/users', { method: 'POST', raw: JSON.stringify({ name: 'x'.repeat(20000) }) })).status, 413);
  assert.equal((await v1('/users', { method: 'POST', raw: '{bad json' })).status, 400);
  assert.equal((await v1('/users', { method: 'POST', raw: '[1,2]' })).status, 400);
});

test('record cap per resource is enforced', async () => {
  const have = Number((await v1('/users?limit=1')).headers.get('x-total-count'));
  for (let i = have; i < 20; i++) assert.equal((await v1('/users', { method: 'POST', body: { name: `n${i}` } })).status, 201);
  const over = await v1('/users', { method: 'POST', body: { name: 'overflow' } });
  assert.equal(over.status, 409);
  assert.equal((await over.json()).error.code, 'record_limit_reached');
  assert.equal((await mg(`/projects/${pid}/resources/${usersId}/generate`, { method: 'POST', body: { count: 500 } })).status, 200); // clamped to 20
});

test('one-to-many relationship route', async () => {
  const mk = await mg(`/projects/${pid}/resources`, { method: 'POST', body: {
    name: 'posts', count: 10, fields: [{ name: 'userId', type: 'ref', ref: 'users' }, { name: 'title', type: 'string' }] } });
  assert.equal(mk.status, 201);
  const posts = await (await v1('/users/1/posts?limit=100')).json();
  assert.ok(posts.every((p) => p.userId === 1));
  const created = await (await v1('/users/2/posts', { method: 'POST', body: { title: 'Hello' } })).json();
  assert.equal(created.userId, 2);
  assert.equal((await v1('/posts/1/users')).status, 404); // users has no ref to posts
});

test('resource limit and name validation', async () => {
  assert.equal((await mg(`/projects/${pid}/resources`, { method: 'POST', body: { name: 'Bad Name!' } })).status, 400);
  assert.equal((await mg(`/projects/${pid}/resources`, { method: 'POST', body: { name: 'users' } })).status, 409);
  assert.equal((await mg(`/projects/${pid}/resources`, { method: 'POST', body: { name: 'third' } })).status, 201);
  assert.equal((await mg(`/projects/${pid}/resources`, { method: 'POST', body: { name: 'fourth' } })).status, 403);
});

test('simulation: custom headers, custom status, error rate', async () => {
  const ok = await mg(`/projects/${pid}/resources/${usersId}`, { method: 'PATCH', body: { settings: {
    headers: { 'X-Env': 'staging' }, status_codes: { POST: 202 }, delay_ms: 150 } } });
  assert.equal(ok.status, 200);
  const t0 = Date.now();
  const r = await v1('/users?limit=1');
  assert.ok(Date.now() - t0 >= 140, 'delay applied');
  assert.equal(r.headers.get('x-env'), 'staging');
  await mg(`/projects/${pid}/resources/${usersId}`, { method: 'PATCH', body: { settings: { error_rate: 100, error_status: 503 } } });
  const bad = await v1('/users');
  assert.equal(bad.status, 503);
  assert.equal(bad.headers.get('x-mock-simulated'), 'error');
  await mg(`/projects/${pid}/resources/${usersId}`, { method: 'PATCH', body: { settings: {} } });
  assert.equal((await mg(`/projects/${pid}/resources/${usersId}`, { method: 'PATCH', body: { settings: { delay_ms: 999999 } } })).status, 400);
  assert.equal((await mg(`/projects/${pid}/resources/${usersId}`, { method: 'PATCH', body: { settings: { headers: { 'Set-Cookie': 'x=1' } } } })).status, 400);
});

test('import infers a schema from JSON and seeds records', async () => {
  const proj = await (await mg('/projects', { method: 'POST', body: { name: 'Imp' } })).json();
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: i + 100, 'Full Name': `Person ${i}`, mail: `p${i}@example.com`, score: i * 1.5, ok: i % 2 === 0, joined: '2024-01-0' + ((i % 9) + 1) }));
  const r = await mg(`/projects/${proj.project.id}/import`, { method: 'POST', body: { resources: [{ name: 'people', records: rows }] } });
  assert.equal(r.status, 201);
  const out = await r.json();
  const types = Object.fromEntries(out.resources[0].schema.map((f) => [f.name, f.type]));
  assert.deepEqual(types, { id: 'id', Full_Name: 'string', mail: 'email', score: 'float', ok: 'boolean', joined: 'date' });
  const list = await (await fetch(`${B}/api/v1/${proj.project.id}/people`)).json();
  assert.equal(list.length, 10);
  assert.equal(list[0].id, 1); // ids are re-assigned
  const exp = await (await mg(`/projects/${proj.project.id}/export`)).json();
  assert.equal(exp.resources[0].records.length, 10);
});

test('project daily quota returns 429 with Retry-After', async () => {
  let last;
  for (let i = 0; i < 70 && (!last || last.status !== 429); i++) last = await v1('/posts?limit=1');
  assert.equal(last.status, 429);
  assert.ok(last.headers.get('retry-after'));
  assert.equal((await last.json()).error.code, 'daily_quota_exceeded');
});

test('OPTIONS preflight is cheap and CORS enabled', async () => {
  const res = await fetch(`${B}/api/v1/${pid}/users`, { method: 'OPTIONS', headers: { 'Access-Control-Request-Headers': 'x-custom' } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-headers'), 'x-custom');
});

test('AI endpoint degrades gracefully when not configured', async () => {
  const res = await mg(`/projects/${pid}/ai/schema`, { method: 'POST', body: { prompt: 'e-commerce with users and orders' } });
  assert.equal(res.status, 503);
  const err = (await res.json()).error;
  assert.equal(err.code, 'ai_unavailable');
  assert.equal(err.details.fallback, 'manual');
});

test('deleting a project removes its API', async () => {
  assert.equal((await mg(`/projects/${pid}`, { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(`${B}/api/v1/${pid}/users`)).status, 404);
});

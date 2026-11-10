// AI client behaviour with a stubbed OpenRouter (no network, no key needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENROUTER_API_KEY = 'test-key';
process.env.OPENROUTER_MODEL = 'primary/model';
process.env.OPENROUTER_FALLBACK_MODEL = 'fallback/model';
process.env.OPENROUTER_MAX_RETRIES = '1';
process.env.OPENROUTER_TIMEOUT_MS = '500';
const { generateSchema } = await import('../api/_lib/ai.js');

const reply = (content, status = 200) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
const good = { resources: [
  { name: 'users', count: 5, fields: [{ name: 'id', type: 'id' }, { name: 'email', type: 'email' }] },
  { name: 'orders', fields: [{ name: 'userId', type: 'ref', ref: 'users' }, { name: 'ghost', type: 'ref', ref: 'nope' }, { name: 'total', type: 'float', min: 1, max: 99 }] },
] };

test('valid output is validated, normalised and dangling refs are neutralised', async () => {
  const calls = [];
  globalThis.fetch = async (_url, init) => { calls.push(JSON.parse(init.body)); return reply('```json\n' + JSON.stringify(good) + '\n```'); };
  const out = await generateSchema('e-commerce with users and orders');
  assert.equal(out.resources.length, 2);
  assert.equal(out.resources[1].fields[0].name, 'id'); // id injected
  const ghost = out.resources[1].fields.find((f) => f.name === 'ghost');
  assert.equal(ghost.type, 'int'); // ref to a resource that is not in the proposal
  assert.equal(calls[0].response_format.type, 'json_object');
  assert.equal(calls[0].model, 'primary/model');
});

test('schema that fails JSON-Schema validation triggers one repair attempt', async () => {
  let n = 0;
  globalThis.fetch = async () => reply(JSON.stringify(n++ === 0 ? { resources: [{ name: 'Bad Name', fields: [] }] } : good));
  const out = await generateSchema('anything goes here');
  assert.equal(n, 2);
  assert.equal(out.resources[0].name, 'users');
});

test('falls back to the second model after the primary keeps failing', async () => {
  const models = [];
  globalThis.fetch = async (_u, init) => {
    const { model } = JSON.parse(init.body);
    models.push(model);
    return model === 'primary/model' ? new Response('boom', { status: 500 }) : reply(JSON.stringify(good));
  };
  const out = await generateSchema('blog with posts');
  assert.equal(out.model, 'fallback/model');
  assert.deepEqual(models, ['primary/model', 'primary/model', 'fallback/model']);
});

test('total failure becomes a graceful 503 pointing to manual creation', async () => {
  globalThis.fetch = async () => { throw new Error('network down'); };
  await assert.rejects(() => generateSchema('some api idea'), (e) => e.status === 503 && e.code === 'ai_unavailable' && e.details.fallback === 'manual');
});

test('timeouts abort and fall through', async () => {
  globalThis.fetch = (_u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  await assert.rejects(() => generateSchema('slow api idea'), (e) => e.code === 'ai_unavailable');
});

test('too-short prompts are rejected before any network call', async () => {
  globalThis.fetch = async () => { throw new Error('should not be called'); };
  await assert.rejects(() => generateSchema('hi'), (e) => e.status === 400);
});

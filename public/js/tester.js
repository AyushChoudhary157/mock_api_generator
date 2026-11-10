// Test tab: build a request, send it from the browser to the live public API, and get code snippets.
import { h, clear, icon, toast, withLoading, copyButton, jsonNodes, pretty, field } from './util.js';
import { api } from './api.js';
import { SNIPPETS } from './snippets.js';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function sampleBody(resource) {
  const o = {};
  for (const f of resource.schema) {
    if (f.type === 'id') continue;
    switch (f.type) {
      case 'int': o[f.name] = f.min ?? 1; break;
      case 'float': o[f.name] = f.min ?? 9.99; break;
      case 'boolean': o[f.name] = true; break;
      case 'date': o[f.name] = '2025-01-15T10:00:00Z'; break;
      case 'email': o[f.name] = 'jane@example.com'; break;
      case 'name': o[f.name] = 'Jane Doe'; break;
      case 'enum': o[f.name] = f.values?.[0] ?? ''; break;
      case 'ref': o[f.name] = 1; break;
      case 'array': o[f.name] = []; break;
      case 'object': o[f.name] = {}; break;
      default: o[f.name] = 'Sample';
    }
  }
  return pretty(o);
}

export function createTester({ project, resource }) {
  const url0 = resource.url;
  const state = { method: 'GET', url: `${url0}?limit=5`, headers: '', body: '', snippet: 'curl' };
  const root = h('div', { class: 'tab-panel tester' });

  // ----- presets -----
  const presets = [
    { label: 'List', method: 'GET', url: () => `${url0}?page=1&limit=5` },
    { label: 'Get one', method: 'GET', url: () => `${url0}/1` },
    { label: 'Create', method: 'POST', url: () => url0, body: true },
    { label: 'Replace (PUT)', method: 'PUT', url: () => `${url0}/1`, body: true },
    { label: 'Update (PATCH)', method: 'PATCH', url: () => `${url0}/1`, body: true },
    { label: 'Delete', method: 'DELETE', url: () => `${url0}/1` },
    { label: 'Search & sort', method: 'GET', url: () => `${url0}?search=a&sortBy=id&order=desc&limit=5` },
  ];

  const methodSel = h('select', { id: 'tt-method', value: state.method, 'aria-label': 'HTTP method', onChange: (e) => { state.method = e.target.value; syncBodyVisibility(); updateSnippet(); } },
    METHODS.map((m) => h('option', { value: m }, m)));
  const urlInput = h('input', { id: 'tt-url', type: 'url', value: state.url, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Request URL', onInput: (e) => { state.url = e.target.value; updateSnippet(); } });
  const headersTa = h('textarea', { id: 'tt-headers', rows: 3, spellcheck: 'false', class: 'mono', placeholder: 'Authorization: Bearer demo\nX-Request-Id: 123', onInput: (e) => { state.headers = e.target.value; updateSnippet(); } });
  const bodyTa = h('textarea', { id: 'tt-body', rows: 8, spellcheck: 'false', class: 'mono', placeholder: '{ "name": "Jane" }', onInput: (e) => { state.body = e.target.value; updateSnippet(); } });
  const bodyField = field({ label: 'Request body (JSON)', input: bodyTa });
  const headersField = field({ label: 'Headers (one per line, “Name: value”)', input: headersTa });
  const urlErr = h('p', { class: 'field-err', role: 'alert', hidden: true });

  function syncBodyVisibility() { bodyField.el.hidden = !['POST', 'PUT', 'PATCH'].includes(state.method); }
  function parsedHeaders() {
    const out = {};
    for (const line of state.headers.split('\n')) {
      const i = line.indexOf(':');
      if (i > 0) { const k = line.slice(0, i).trim(); const v = line.slice(i + 1).trim(); if (k) out[k] = v; }
    }
    return out;
  }
  const currentReq = () => ({ method: state.method, url: state.url, headers: parsedHeaders(), body: state.body });

  const presetRow = h('div', { class: 'chips', role: 'group', 'aria-label': 'Request presets' }, presets.map((p) => h('button', { type: 'button', class: 'chip chip-btn', onClick: () => {
    state.method = p.method; methodSel.value = p.method; state.url = p.url(); urlInput.value = state.url;
    if (p.body) { state.body = sampleBody(resource); bodyTa.value = state.body; }
    syncBodyVisibility(); updateSnippet();
  } }, `${p.method} · ${p.label}`)));

  // ----- response -----
  const statusPill = h('span', { class: 'pill' });
  const timeEl = h('span', { class: 'meta' });
  const sizeEl = h('span', { class: 'meta' });
  const respMeta = h('div', { class: 'resp-meta', hidden: true }, statusPill, timeEl, sizeEl);
  const headersBox = h('details', { class: 'resp-headers', hidden: true }, h('summary', {}, 'Response headers'), h('div', { class: 'hdr-table' }));
  const bodyBox = h('div', { class: 'code-box resp-body', tabindex: '0', role: 'region', 'aria-label': 'Response body' },
    h('p', { class: 'placeholder' }, 'Send a request to see the response here.'));
  let lastBody = '';
  const copyResp = copyButton(() => lastBody, { label: 'Copy response', ariaLabel: 'Copy response body' });
  copyResp.hidden = true;

  async function send(btn) {
    urlErr.hidden = true;
    let target;
    try { target = new URL(state.url); if (!/^https?:$/.test(target.protocol)) throw new Error(); } catch { urlErr.textContent = 'Enter a full URL starting with http:// or https://'; urlErr.hidden = false; urlInput.focus(); return; }
    const opts = { method: state.method, headers: { ...parsedHeaders() } };
    if (['POST', 'PUT', 'PATCH'].includes(state.method)) {
      if (state.body.trim()) { opts.body = state.body; if (!Object.keys(opts.headers).some((k) => k.toLowerCase() === 'content-type')) opts.headers['Content-Type'] = 'application/json'; }
    }
    const t0 = performance.now();
    await withLoading(btn, async () => {
      try {
        const res = await fetch(target, opts);
        const text = await res.text();
        const ms = Math.round(performance.now() - t0);
        showResponse(res, text, ms);
      } catch {
        showNetworkError();
      }
    }, 'Sending…');
    loadLogs();
  }

  function showResponse(res, text, ms) {
    respMeta.hidden = false;
    statusPill.textContent = `${res.status} ${res.statusText || ''}`.trim();
    statusPill.className = `pill ${res.ok ? 'pill-ok' : res.status >= 500 ? 'pill-bad' : 'pill-warn'}`;
    timeEl.textContent = `${ms} ms`;
    sizeEl.textContent = `${new Blob([text]).size} bytes`;
    const table = headersBox.querySelector('.hdr-table');
    clear(table);
    [...res.headers.entries()].sort().forEach(([k, v]) => table.append(h('div', { class: 'hdr-row' }, h('span', { class: 'hdr-k' }, k), h('span', { class: 'hdr-v' }, v))));
    headersBox.hidden = false;
    let shown = text;
    try { shown = pretty(JSON.parse(text)); } catch { /* not JSON */ }
    lastBody = shown;
    clear(bodyBox).append(h('pre', {}, h('code', {}, shown ? jsonNodes(shown) : h('span', { class: 'muted' }, '(empty body)'))));
    copyResp.hidden = false;
    if (res.status === 429) toast('Rate limit reached. Check the Retry-After header.', 'error');
  }
  function showNetworkError() {
    respMeta.hidden = false;
    statusPill.textContent = 'Network error';
    statusPill.className = 'pill pill-bad';
    timeEl.textContent = '';
    sizeEl.textContent = '';
    headersBox.hidden = true;
    lastBody = '';
    copyResp.hidden = true;
    clear(bodyBox).append(h('p', { class: 'notice notice-warn' }, 'The request could not be completed. Check the URL and your connection. Browsers also block mixed http/https calls.'));
  }

  // ----- snippets -----
  const snippetTabs = h('div', { class: 'seg seg-sm', role: 'tablist', 'aria-label': 'Code snippet language' });
  const snippetPre = h('pre', {}, h('code', {}));
  const snippetCopy = copyButton(() => SNIPPETS.find((s) => s.id === state.snippet).build(currentReq()), { label: 'Copy code', ariaLabel: 'Copy code snippet' });
  function updateSnippet() {
    clear(snippetTabs);
    SNIPPETS.forEach((s) => snippetTabs.append(h('button', { type: 'button', role: 'tab', class: `seg-btn ${state.snippet === s.id ? 'is-active' : ''}`, 'aria-selected': String(state.snippet === s.id),
      onClick: () => { state.snippet = s.id; updateSnippet(); } }, s.label)));
    snippetPre.querySelector('code').textContent = SNIPPETS.find((s) => s.id === state.snippet).build(currentReq());
  }

  // ----- request log -----
  const logBox = h('div', { class: 'log-box' });
  async function loadLogs() {
    try {
      const { logs } = await api(`/projects/${project.id}/logs`);
      clear(logBox);
      if (!logs.length) { logBox.append(h('p', { class: 'fine' }, 'No requests yet. Requests you send to your public API appear here.')); return; }
      logBox.append(h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Recent requests' }, h('table', { class: 'data-table log-table' },
        h('thead', {}, h('tr', {}, ['Time', 'Method', 'Path', 'Status', 'ms'].map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', {}, logs.slice(0, 12).map((l) => h('tr', {},
          h('td', {}, new Date(l.created_at).toLocaleTimeString()), h('td', {}, h('span', { class: 'mth' }, l.method)),
          h('td', { class: 'path' }, l.path.replace(/^\/api\/v1\/[a-z0-9]+/, '') || '/'),
          h('td', {}, h('span', { class: `pill pill-sm ${l.status < 400 ? 'pill-ok' : l.status >= 500 ? 'pill-bad' : 'pill-warn'}` }, String(l.status), l.simulated ? ' (sim)' : '')),
          h('td', { class: 'num' }, String(l.duration_ms))))))));
    } catch { clear(logBox).append(h('p', { class: 'fine' }, 'Could not load recent requests.')); }
  }

  const sendBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg', onClick: (e) => send(e.currentTarget) }, icon('send', 16), 'Send request');

  root.append(
    h('div', { class: 'panel-head' }, h('div', {}, h('h3', {}, 'API tester'), h('p', { class: 'fine' }, 'Requests go to your live public endpoint and count toward the daily free-tier quota.'))),
    presetRow,
    h('div', { class: 'req-line' },
      h('div', { class: 'fe-cell req-method' }, h('label', { for: 'tt-method' }, 'Method'), methodSel),
      h('div', { class: 'fe-cell fe-grow' }, h('label', { for: 'tt-url' }, 'URL'), urlInput),
      sendBtn),
    urlErr,
    h('div', { class: 'grid-2 tester-grid' }, headersField.el, bodyField.el),
    h('div', { class: 'resp-head' }, h('h4', {}, 'Response'), respMeta, copyResp),
    headersBox, bodyBox,
    h('div', { class: 'snip' }, h('div', { class: 'snip-head' }, h('h4', {}, 'Code snippets'), snippetTabs, snippetCopy),
      h('div', { class: 'code-box', tabindex: '0', role: 'region', 'aria-label': 'Code snippet' }, snippetPre)),
    h('div', { class: 'log-head' }, h('h4', {}, 'Recent requests'), h('button', { type: 'button', class: 'btn btn-sm', onClick: loadLogs }, icon('refresh', 14), 'Refresh')),
    logBox);
  syncBodyVisibility();
  updateSnippet();
  loadLogs();
  return { el: root };
}

// Data tab: generate / append / browse / edit records. Uses the management API so browsing here
// never counts against the project's public request quota.
import { h, clear, field, icon, toast, withLoading, openDialog, confirmDialog, debounce, jsonNodes, pretty, skeleton, emptyState, fmt } from './util.js';
import { api, describeError } from './api.js';

const PAGE = 10;

function sampleFor(f) {
  switch (f.type) {
    case 'int': return f.min ?? 1;
    case 'float': return f.min ?? 1.5;
    case 'boolean': return true;
    case 'date': return new Date().toISOString();
    case 'enum': return f.values?.[0] ?? '';
    case 'object': return Object.fromEntries((f.fields || []).map((x) => [x.name, sampleFor(x)]));
    case 'array': return [];
    case 'ref': return 1;
    case 'email': return 'jane@example.com';
    default: return '';
  }
}

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function createDataView({ project, resource, limits, onChanged }) {
  let page = 1;
  let search = '';
  let view = 'table';
  let data = { items: [], total: 0, total_pages: 1 };
  let loading = true;
  const max = limits?.max_records ?? 100;
  const columns = resource.schema.map((f) => f.name);

  const root = h('div', { class: 'tab-panel data-view' });
  const results = h('div', { class: 'data-results', 'aria-live': 'polite' });
  const statEl = h('p', { class: 'fine' });

  // ----- toolbar -----
  const countInput = h('input', { type: 'number', min: 1, max, value: Math.min(10, max), inputmode: 'numeric', 'aria-label': 'Number of records' });
  const hasHints = resource.schema.some((f) => f.aiHint);
  const aiBox = h('input', { type: 'checkbox', id: 'dv-ai', disabled: !limits?.ai_enabled });
  const seedInput = h('input', { type: 'text', maxlength: 60, placeholder: 'optional seed', 'aria-label': 'Seed for deterministic data' });

  async function generate(replace, btn) {
    const n = Number(countInput.value);
    if (!Number.isInteger(n) || n < 1 || n > max) { toast(`Enter a number of records between 1 and ${max}.`, 'error'); countInput.focus(); return; }
    if (replace && resource.record_count > 0) {
      const ok = await confirmDialog({ title: 'Replace all records?', message: `This deletes the ${resource.record_count} current records in /${resource.name} and creates ${n} new ones.`, confirmLabel: 'Replace records', danger: true });
      if (!ok) return;
    }
    try {
      const out = await withLoading(btn, () => api(`/projects/${project.id}/resources/${resource.id}/generate`, { method: 'POST',
        body: { count: n, replace, seed: seedInput.value.trim() || undefined, useAI: aiBox.checked } }), replace ? 'Generating…' : 'Appending…');
      resource.record_count = out.resource.record_count;
      toast(`${replace ? 'Generated' : 'Added'} ${n} records`, 'success');
      if (out.ai?.fallback) toast(out.ai.message || 'AI unavailable; used the built-in generator.', 'info', 6000);
      page = 1;
      await load();
      onChanged();
    } catch (err) { toast(describeError(err), 'error', 6000); }
  }

  const genBtn = h('button', { type: 'button', class: 'btn btn-primary', onClick: (e) => generate(true, e.currentTarget) }, icon('refresh', 16), 'Generate (replace)');
  const addBtn = h('button', { type: 'button', class: 'btn', onClick: (e) => generate(false, e.currentTarget) }, icon('plus', 16), 'Append');

  const searchInput = h('input', { type: 'search', placeholder: 'Search records…', 'aria-label': 'Search records',
    onInput: debounce((e) => { search = e.target.value.trim(); page = 1; load(); }, 300) });

  const toolbar = h('div', { class: 'toolbar' },
    h('div', { class: 'toolbar-group' },
      h('div', { class: 'fe-cell fe-narrow' }, h('label', { for: 'dv-count' }, `Records (1–${max})`), (countInput.id = 'dv-count', countInput)),
      h('div', { class: 'fe-cell' }, h('label', { for: 'dv-seed' }, 'Seed'), (seedInput.id = 'dv-seed', seedInput)),
      genBtn, addBtn),
    hasHints ? h('div', { class: 'check' }, aiBox, h('label', { for: 'dv-ai' }, 'Use AI for fields with an AI hint'),
      !limits?.ai_enabled ? h('span', { class: 'fine' }, ' (AI is not enabled on this server)') : null) : null);

  // ----- record editing -----
  function recordDialog(record) {
    const isNew = !record;
    const template = record ? { ...record } : Object.fromEntries(resource.schema.filter((f) => f.type !== 'id').map((f) => [f.name, sampleFor(f)]));
    if (isNew) delete template.id;
    const ta = h('textarea', { rows: 14, spellcheck: 'false', class: 'mono', 'aria-label': 'Record JSON' });
    ta.value = pretty(template);
    const f = field({ label: isNew ? 'New record (JSON)' : `Edit record #${record.id} (JSON)`, input: ta, hint: 'The id is assigned by the server and cannot be changed.' });
    openDialog({ title: isNew ? 'Add record' : `Edit record #${record.id}`, size: 'lg', body: f.el, actions: [
      { label: 'Cancel' },
      { label: isNew ? 'Add record' : 'Save changes', primary: true, onClick: async ({ button }) => {
        let body;
        try { body = JSON.parse(ta.value); } catch (e) { f.setError(`Invalid JSON: ${e.message}`); return true; }
        if (!body || typeof body !== 'object' || Array.isArray(body)) { f.setError('The record must be a JSON object.'); return true; }
        try {
          await withLoading(button, () => api(`/projects/${project.id}/resources/${resource.id}/records${isNew ? '' : `/${record.id}`}`, { method: isNew ? 'POST' : 'PUT', body }), 'Saving…');
          toast(isNew ? 'Record added' : 'Record updated', 'success');
          await load();
          onChanged();
          return false;
        } catch (err) { f.setError(describeError(err)); return true; }
      } },
    ] });
  }

  async function removeRecord(record) {
    const ok = await confirmDialog({ title: `Delete record #${record.id}?`, message: 'This cannot be undone.', confirmLabel: 'Delete record', danger: true });
    if (!ok) return;
    try {
      await api(`/projects/${project.id}/resources/${resource.id}/records/${record.id}`, { method: 'DELETE' });
      toast('Record deleted', 'success');
      await load();
      onChanged();
    } catch (err) { toast(describeError(err), 'error'); }
  }

  // ----- rendering -----
  function tableView() {
    const head = h('tr', {}, columns.map((c) => h('th', { scope: 'col' }, c)), h('th', { scope: 'col', class: 'col-actions' }, h('span', { class: 'sr-only' }, 'Actions')));
    const rows = data.items.map((rec) => h('tr', {},
      columns.map((c) => {
        const text = cellText(rec[c]);
        return h('td', { title: text.length > 40 ? text : null, class: typeof rec[c] === 'number' ? 'num' : '' }, text.length > 70 ? `${text.slice(0, 70)}…` : text);
      }),
      h('td', { class: 'col-actions' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit record ${rec.id}`, onClick: () => recordDialog(rec) }, icon('edit', 16)),
        h('button', { type: 'button', class: 'icon-btn icon-danger', 'aria-label': `Delete record ${rec.id}`, onClick: () => removeRecord(rec) }, icon('trash', 16)))));
    return h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': `Records of ${resource.name}` },
      h('table', { class: 'data-table' }, h('thead', {}, head), h('tbody', {}, rows)));
  }

  function jsonView() {
    return h('div', { class: 'json-list', role: 'region', 'aria-label': 'Records as JSON', tabindex: '0' }, data.items.map((rec) => h('article', { class: 'json-rec' },
      h('div', { class: 'json-rec-head' }, h('span', { class: 'chip' }, `id ${rec.id}`),
        h('div', {},
          h('button', { type: 'button', class: 'btn btn-sm', 'aria-label': `Edit record ${rec.id}`, onClick: () => recordDialog(rec) }, icon('edit', 14), 'Edit'),
          h('button', { type: 'button', class: 'btn btn-sm btn-danger', 'aria-label': `Delete record ${rec.id}`, onClick: () => removeRecord(rec) }, icon('trash', 14), 'Delete'))),
      h('pre', {}, h('code', {}, jsonNodes(pretty(rec)))))));
  }

  function pager() {
    const total = data.total_pages;
    return h('nav', { class: 'pager', 'aria-label': 'Pagination' },
      h('button', { type: 'button', class: 'btn btn-sm', disabled: page <= 1, onClick: () => { page--; load(); } }, 'Previous'),
      h('span', { class: 'pager-info' }, `Page ${page} of ${total}`),
      h('button', { type: 'button', class: 'btn btn-sm', disabled: page >= total, onClick: () => { page++; load(); } }, 'Next'));
  }

  function draw() {
    clear(results);
    if (loading) { results.append(skeleton(5)); return; }
    statEl.textContent = `${fmt(data.total)} record${data.total === 1 ? '' : 's'}${search ? ` matching “${search}”` : ''} · free tier allows ${max} per resource`;
    if (!data.items.length) {
      results.append(emptyState({
        title: search ? 'No records match your search' : 'No records yet',
        text: search ? 'Try a different search term.' : 'Generate sample data with the button above, or add a record by hand.',
      }));
      return;
    }
    results.append(view === 'table' ? tableView() : jsonView());
    if (data.total_pages > 1) results.append(pager());
  }

  async function load() {
    loading = true;
    draw();
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(PAGE) });
      if (search) qs.set('search', search);
      data = await api(`/projects/${project.id}/resources/${resource.id}/records?${qs}`);
    } catch (err) {
      toast(describeError(err), 'error');
      data = { items: [], total: 0, total_pages: 1 };
    }
    loading = false;
    draw();
  }

  const viewToggle = h('div', { class: 'seg seg-sm', role: 'group', 'aria-label': 'View' },
    ['table', 'json'].map((v) => h('button', { type: 'button', class: `seg-btn ${view === v ? 'is-active' : ''}`, 'aria-pressed': String(view === v),
      onClick: (e) => { view = v; viewToggle.querySelectorAll('button').forEach((b) => { const on = b === e.currentTarget; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); }); draw(); } }, v === 'table' ? 'Table' : 'JSON')));

  root.append(
    h('div', { class: 'panel-head' }, h('div', {}, h('h3', {}, 'Data'), statEl)),
    toolbar,
    h('div', { class: 'toolbar toolbar-light' },
      h('div', { class: 'search-wrap' }, searchInput),
      h('div', { class: 'toolbar-group' }, viewToggle,
        h('button', { type: 'button', class: 'btn btn-sm', onClick: () => recordDialog(null) }, icon('plus', 14), 'Add record'))),
    results);
  load();
  return { el: root };
}

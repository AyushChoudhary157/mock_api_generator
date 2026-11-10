// Settings tab: simulation controls (delay, random errors, status codes, headers) for one
// resource, project-wide defaults, and project housekeeping (rename, export, delete).
import { h, clear, field, icon, toast, withLoading, confirmDialog, copyButton } from './util.js';
import { api, describeError } from './api.js';
import { openImportDialog } from './import.js';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const STATUS_OPTIONS = ['', '200', '201', '202', '204'];

/** Form for one settings object. `inherit` shows placeholder text for values coming from the project. */
function simulationForm({ settings, limits, scope, inherit = {}, onSave }) {
  const s = settings || {};
  const maxDelay = limits?.max_delay_ms ?? 5000;
  const delay = h('input', { type: 'number', min: 0, max: maxDelay, step: 50, inputmode: 'numeric', value: s.delay_ms ?? '', placeholder: inherit.delay_ms !== undefined ? String(inherit.delay_ms) : '0' });
  const rate = h('input', { type: 'number', min: 0, max: 100, step: 1, inputmode: 'decimal', value: s.error_rate ?? '', placeholder: inherit.error_rate !== undefined ? String(inherit.error_rate) : '0' });
  const errStatus = h('select', { value: String(s.error_status ?? '') },
    h('option', { value: '' }, inherit.error_status ? `Inherit (${inherit.error_status})` : 'Default (500)'),
    [400, 401, 403, 404, 408, 409, 422, 429, 500, 502, 503, 504].map((c) => h('option', { value: String(c) }, String(c))));
  const delayF = field({ label: 'Response delay (ms)', input: delay, hint: `0 to ${maxDelay} ms. Simulates a slow network or server.` });
  const rateF = field({ label: 'Random error rate (%)', input: rate, hint: 'Share of requests that fail on purpose. 0 = never, 100 = always.' });
  const errF = field({ label: 'Status code for simulated errors', input: errStatus, hint: 'Returned when the random error triggers.' });

  const statusSelects = Object.fromEntries(METHODS.map((m) => [m, h('select', { id: `sc-${scope}-${m}`, value: String(s.status_codes?.[m] ?? ''), 'aria-label': `Success status for ${m}` },
    STATUS_OPTIONS.map((c) => h('option', { value: c }, c ? c : 'Default')))]));
  const statusGrid = h('div', { class: 'status-grid' }, METHODS.map((m) => h('div', { class: 'fe-cell' }, h('label', { for: `sc-${scope}-${m}` }, m), statusSelects[m])));

  const headerRows = h('div', { class: 'kv-list' });
  const headerModel = Object.entries(s.headers || {}).map(([k, v]) => ({ k, v }));
  function drawHeaders() {
    clear(headerRows);
    if (!headerModel.length) headerRows.append(h('p', { class: 'fine' }, 'No custom headers. Add some to mimic your real API (e.g. X-Environment).'));
    headerModel.forEach((row, i) => headerRows.append(h('div', { class: 'kv-row' },
      h('div', { class: 'fe-cell' }, h('label', { for: `hk-${scope}-${i}` }, 'Header name'), h('input', { id: `hk-${scope}-${i}`, type: 'text', value: row.k, maxlength: 40, placeholder: 'X-Environment', autocomplete: 'off', onInput: (e) => { row.k = e.target.value; } })),
      h('div', { class: 'fe-cell fe-grow' }, h('label', { for: `hv-${scope}-${i}` }, 'Value'), h('input', { id: `hv-${scope}-${i}`, type: 'text', value: row.v, maxlength: 200, placeholder: 'staging', autocomplete: 'off', onInput: (e) => { row.v = e.target.value; } })),
      h('button', { type: 'button', class: 'icon-btn icon-danger', 'aria-label': `Remove header ${row.k || i + 1}`, onClick: () => { headerModel.splice(i, 1); drawHeaders(); } }, icon('trash', 16)))));
  }
  drawHeaders();

  const errBox = h('p', { class: 'field-err', role: 'alert', hidden: true });
  const save = h('button', { type: 'button', class: 'btn btn-primary' }, 'Save settings');
  save.addEventListener('click', async () => {
    errBox.hidden = true;
    const out = {};
    if (delay.value !== '') out.delay_ms = Number(delay.value);
    if (rate.value !== '') out.error_rate = Number(rate.value);
    if (errStatus.value) out.error_status = Number(errStatus.value);
    const sc = {};
    METHODS.forEach((m) => { if (statusSelects[m].value) sc[m] = Number(statusSelects[m].value); });
    if (Object.keys(sc).length) out.status_codes = sc;
    const headers = {};
    for (const { k, v } of headerModel) if (k.trim() && v.trim()) headers[k.trim()] = v.trim();
    if (Object.keys(headers).length) out.headers = headers;
    try { await withLoading(save, () => onSave(out), 'Saving…'); toast(`${scope === 'project' ? 'Project defaults' : 'Resource settings'} saved`, 'success'); } catch (err) { errBox.textContent = describeError(err); errBox.hidden = false; }
  });

  return h('div', { class: 'sim-form' },
    h('div', { class: 'grid-3' }, delayF.el, rateF.el, errF.el),
    h('fieldset', { class: 'fieldset' }, h('legend', {}, 'Custom success status codes'), h('p', { class: 'field-hint' }, 'Override the status returned for successful requests (e.g. POST → 202).'), statusGrid),
    h('fieldset', { class: 'fieldset' }, h('legend', {}, 'Custom response headers'), headerRows,
      h('button', { type: 'button', class: 'btn btn-sm', onClick: () => { if (headerModel.length >= 10) { toast('Up to 10 custom headers.', 'error'); return; } headerModel.push({ k: '', v: '' }); drawHeaders(); } }, icon('plus', 14), 'Add header')),
    errBox, h('div', { class: 'row-actions' }, save));
}

export function createSettingsView({ project, resource, limits, reload, onProjectDeleted, onResourceDeleted }) {
  const root = h('div', { class: 'tab-panel settings-view' });

  const sections = [];

  if (resource) {
    sections.push(h('section', { class: 'card', 'aria-labelledby': 'st-res' },
      h('h3', { id: 'st-res' }, `/${resource.name} behavior`),
      h('p', { class: 'lead' }, 'Applies only to this resource and overrides the project defaults below. Leave a field empty to inherit.'),
      simulationForm({ settings: resource.settings, limits, scope: 'resource', inherit: project.settings,
        onSave: async (settings) => { await api(`/projects/${project.id}/resources/${resource.id}`, { method: 'PATCH', body: { settings } }); await reload(); } })));
  }

  sections.push(h('section', { class: 'card', 'aria-labelledby': 'st-proj' },
    h('h3', { id: 'st-proj' }, 'Project defaults'),
    h('p', { class: 'lead' }, 'Applied to every resource in this project unless a resource sets its own value.'),
    simulationForm({ settings: project.settings, limits, scope: 'project',
      onSave: async (settings) => { await api(`/projects/${project.id}`, { method: 'PATCH', body: { settings } }); await reload(); } })));

  // project housekeeping
  const nameInput = h('input', { type: 'text', maxlength: 60, value: project.name });
  const nameF = field({ label: 'Project name', input: nameInput });
  const rename = h('button', { type: 'button', class: 'btn', onClick: async (e) => {
    nameF.setError('');
    if (!nameInput.value.trim()) { nameF.setError('The name cannot be empty.'); return; }
    try { await withLoading(e.currentTarget, () => api(`/projects/${project.id}`, { method: 'PATCH', body: { name: nameInput.value.trim() } }), 'Saving…'); toast('Project renamed', 'success'); await reload(); } catch (err) { nameF.setError(describeError(err)); }
  } }, 'Rename');

  async function exportAll(btn) {
    try {
      const data = await withLoading(btn, () => api(`/projects/${project.id}/export`), 'Preparing…');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `${project.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'project'}-export.json` });
      document.body.append(a);
      a.click();
      a.remove();
      toast('Export downloaded', 'success');
    } catch (err) { toast(describeError(err), 'error'); }
  }

  sections.push(h('section', { class: 'card', 'aria-labelledby': 'st-act' },
    h('h3', { id: 'st-act' }, 'Project'),
    h('div', { class: 'inline-form' }, nameF.el, rename),
    h('div', { class: 'row-actions wrap' },
      h('button', { type: 'button', class: 'btn', onClick: (e) => exportAll(e.currentTarget) }, icon('download', 16), 'Export schema & data (JSON)'),
      h('button', { type: 'button', class: 'btn', onClick: () => openImportDialog({ project, onDone: async () => { await reload(true); } }) }, icon('upload', 16), 'Import JSON / CSV'),
      resource ? h('button', { type: 'button', class: 'btn', onClick: (e) => exportResource(e.currentTarget) }, icon('download', 16), `Export /${resource.name} only`) : null),
    h('p', { class: 'fine' }, 'Base URL'),
    h('div', { class: 'endpoint-row' }, h('code', { class: 'url' }, project.base_url), copyButton(() => project.base_url, { label: 'Copy', ariaLabel: 'Copy project base URL' }))));

  async function exportResource(btn) {
    try {
      const all = await withLoading(btn, () => api(`/projects/${project.id}/export`), 'Preparing…');
      const one = all.resources.find((r) => r.name === resource.name);
      const blob = new Blob([JSON.stringify(one.records, null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `${resource.name}.json` });
      document.body.append(a); a.click(); a.remove();
      toast(`Exported ${one.records.length} records`, 'success');
    } catch (err) { toast(describeError(err), 'error'); }
  }

  const danger = [];
  if (resource) {
    danger.push(h('div', { class: 'danger-row' }, h('div', {}, h('strong', {}, `Delete /${resource.name}`), h('p', { class: 'fine' }, 'Removes the endpoint and all of its records.')),
      h('button', { type: 'button', class: 'btn btn-danger', onClick: async () => {
        if (!(await confirmDialog({ title: `Delete /${resource.name}?`, message: 'The endpoint stops working immediately and its records are deleted.', confirmLabel: 'Delete resource', danger: true }))) return;
        try { await api(`/projects/${project.id}/resources/${resource.id}`, { method: 'DELETE' }); toast('Resource deleted', 'success'); await onResourceDeleted(); } catch (err) { toast(describeError(err), 'error'); }
      } }, 'Delete resource')));
  }
  danger.push(h('div', { class: 'danger-row' }, h('div', {}, h('strong', {}, 'Delete project'), h('p', { class: 'fine' }, 'Permanently removes every resource, record and the public URL.')),
    h('button', { type: 'button', class: 'btn btn-danger', onClick: async () => {
      if (!(await confirmDialog({ title: `Delete “${project.name}”?`, message: 'All resources and data are permanently deleted. This cannot be undone.', confirmLabel: 'Delete project', danger: true }))) return;
      try { await api(`/projects/${project.id}`, { method: 'DELETE' }); toast('Project deleted', 'success'); await onProjectDeleted(); } catch (err) { toast(describeError(err), 'error'); }
    } }, 'Delete project')));
  sections.push(h('section', { class: 'card card-danger', 'aria-labelledby': 'st-dng' }, h('h3', { id: 'st-dng' }, 'Danger zone'), danger));

  root.append(h('div', { class: 'panel-head' }, h('div', {}, h('h3', {}, 'Settings'), h('p', { class: 'fine' }, 'Simulate real-world conditions: slow responses, flaky servers and custom headers.'))), ...sections);
  return { el: root };
}


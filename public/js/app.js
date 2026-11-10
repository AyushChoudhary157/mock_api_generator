// App shell: loads projects, renders sidebar + main panel, wires navigation, theme and dialogs.
import { h, $, clear, icon, toast, confirmDialog, skeleton, emptyState, copyButton } from './util.js';
import { api, describeError } from './api.js';
import { state, currentProject, currentResource, saveSelection, loadSelection, getTheme, setTheme, getToken } from './store.js';
import { renderSidebar } from './sidebar.js';
import { createWizard } from './wizard.js';
import { createSchemaView } from './schema-view.js';
import { createDataView } from './data-view.js';
import { createSettingsView } from './settings-view.js';
import { createTester } from './tester.js';
import { openAccessKeyDialog } from './access-key.js';

const sidebarEl = $('#sidebar');
const mainEl = $('#main');
const sbToggle = $('#sb-toggle');
let activeView = null;
let wizardProjectId = null;

const TABS = [['schema', 'Schema'], ['data', 'Data'], ['settings', 'Settings'], ['test', 'Test']];

// ---------- data loading ----------
async function load() {
  try {
    getToken(); // make sure a token exists before the first request
    const out = await api('/projects');
    state.projects = out.projects;
    state.limits = out.limits;
    state.loadError = null;
  } catch (err) {
    state.loadError = describeError(err);
  }
  state.loading = false;
  ensureSelection();
}

function ensureSelection() {
  const saved = loadSelection();
  if (!state.projects.some((p) => p.id === state.projectId)) {
    state.projectId = state.projects.some((p) => p.id === saved.p) ? saved.p : state.projects[0]?.id ?? null;
    if (saved.t && TABS.some(([id]) => id === saved.t)) state.tab = saved.t;
  }
  const p = currentProject();
  if (!p) { state.resourceId = null; return; }
  if (!p.resources.some((r) => r.id === state.resourceId)) {
    state.resourceId = p.resources.some((r) => r.id === saved.r) ? saved.r : p.resources[0]?.id ?? null;
  }
}

async function reloadSidebarOnly() { await load(); drawSidebar(); }
async function reloadAll() { await load(); drawSidebar(); drawMain(); }

// ---------- navigation ----------
async function guardDirty() {
  if (activeView?.isDirty?.()) {
    return confirmDialog({ title: 'Discard unsaved changes?', message: 'You have unsaved schema changes. If you leave now they will be lost.', confirmLabel: 'Discard changes', danger: true });
  }
  return true;
}
function closeMobileSidebar() { sidebarEl.classList.remove('is-open'); sbToggle.setAttribute('aria-expanded', 'false'); }

const actions = {
  async selectProject(id) {
    if (!(await guardDirty())) return;
    state.projectId = id;
    state.resourceId = null;
    state.mode = 'dashboard';
    ensureSelection();
    saveSelection();
    drawSidebar(); drawMain();
    if (!currentProject()?.resources.length) closeMobileSidebar();
  },
  async selectResource(pid, rid) {
    if (!(await guardDirty())) return;
    state.projectId = pid; state.resourceId = rid; state.mode = 'dashboard';
    saveSelection();
    drawSidebar(); drawMain();
    closeMobileSidebar();
    mainEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
  },
  async newProject() {
    if (!(await guardDirty())) return;
    if (state.projects.length >= (state.limits?.max_projects ?? 5)) { toast(`The free tier allows ${state.limits.max_projects} projects. Delete one first.`, 'error', 5000); return; }
    wizardProjectId = null; state.mode = 'wizard';
    drawSidebar(); drawMain(); closeMobileSidebar();
  },
  async newResource(pid) {
    if (!(await guardDirty())) return;
    state.projectId = pid; wizardProjectId = pid; state.mode = 'wizard';
    drawSidebar(); drawMain(); closeMobileSidebar();
  },
  accessKey() { openAccessKeyDialog({ onRestored: async () => { state.projectId = null; state.resourceId = null; state.loading = true; drawSidebar(); await reloadAll(); } }); },
};

// ---------- rendering ----------
function drawSidebar() { renderSidebar(sidebarEl, actions); }

function drawMain() {
  clear(mainEl);
  activeView = null;
  if (state.loading) { mainEl.append(h('div', { class: 'main-pad' }, skeleton(6))); return; }
  if (state.loadError) {
    mainEl.append(h('div', { class: 'main-pad' }, emptyState({
      title: 'We could not load your projects', text: state.loadError,
      action: h('button', { type: 'button', class: 'btn btn-primary', onClick: async () => { state.loading = true; drawMain(); await reloadAll(); } }, icon('refresh', 16), 'Try again'),
    })));
    return;
  }
  const p = currentProject();
  const wizardWanted = state.mode === 'wizard' || !p || !p.resources.length;
  if (wizardWanted) { mainEl.append(drawWizard(p)); return; }

  const r = currentResource() || p.resources[0];
  state.resourceId = r.id;
  mainEl.append(drawDashboard(p, r));
}

function drawWizard(p) {
  const forProject = state.mode === 'wizard' ? (wizardProjectId ? state.projects.find((x) => x.id === wizardProjectId) : null) : p;
  const wiz = createWizard({
    project: forProject || null,
    limits: state.limits,
    onProjectCreated: async (name) => {
      const out = await api('/projects', { method: 'POST', body: { name } });
      await load();
      state.projectId = out.project.id;
      wizardProjectId = out.project.id;
      drawSidebar();
      return state.projects.find((x) => x.id === out.project.id);
    },
    reload: reloadSidebarOnly,
    onFinish: async (rid, tab) => {
      await load();
      state.mode = 'dashboard';
      if (rid) state.resourceId = rid;
      state.tab = tab || 'schema';
      saveSelection();
      drawSidebar(); drawMain();
    },
    onCancel: state.projects.length && (forProject?.resources?.length || state.mode === 'wizard') ? () => { state.mode = 'dashboard'; ensureSelection(); drawSidebar(); drawMain(); } : null,
  });
  return h('div', { class: 'main-pad' }, wiz.el);
}

function drawDashboard(project, resource) {
  const panel = h('div', { id: 'tab-panel', role: 'tabpanel', 'aria-labelledby': `tab-${state.tab}`, tabindex: '0' });
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Resource sections' });

  function mountTab() {
    clear(panel);
    panel.setAttribute('aria-labelledby', `tab-${state.tab}`);
    const common = { project, resource, limits: state.limits };
    let view;
    if (state.tab === 'data') view = createDataView({ ...common, onChanged: reloadSidebarOnly });
    else if (state.tab === 'settings') view = createSettingsView({ ...common, reload: async () => { await reloadAll(); }, onProjectDeleted: async () => { state.projectId = null; state.resourceId = null; state.mode = 'dashboard'; await reloadAll(); }, onResourceDeleted: async () => { state.resourceId = null; await reloadAll(); } });
    else if (state.tab === 'test') view = createTester(common);
    else view = createSchemaView({ ...common, reload: async () => { await reloadAll(); } });
    activeView = view;
    panel.append(view.el);
  }

  async function switchTab(id) {
    if (id === state.tab) return;
    if (!(await guardDirty())) return;
    state.tab = id;
    saveSelection();
    drawTabs();
    mountTab();
  }

  function drawTabs() {
    clear(tabs);
    TABS.forEach(([id, label]) => tabs.append(h('button', {
      type: 'button', role: 'tab', id: `tab-${id}`, class: `tab ${state.tab === id ? 'is-active' : ''}`,
      'aria-selected': String(state.tab === id), 'aria-controls': 'tab-panel', tabindex: state.tab === id ? '0' : '-1',
      onClick: () => switchTab(id),
      onKeydown: (e) => {
        const i = TABS.findIndex(([t]) => t === state.tab);
        let n = null;
        if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
        else if (e.key === 'ArrowLeft') n = (i + TABS.length - 1) % TABS.length;
        else if (e.key === 'Home') n = 0;
        else if (e.key === 'End') n = TABS.length - 1;
        if (n !== null) { e.preventDefault(); switchTab(TABS[n][0]).then(() => document.getElementById(`tab-${TABS[n][0]}`)?.focus()); }
      },
    }, label)));
  }

  drawTabs();
  mountTab();

  return h('div', { class: 'dash' },
    h('header', { class: 'dash-head' },
      h('div', { class: 'dash-title' }, h('p', { class: 'eyebrow' }, project.name), h('h2', {}, `/${resource.name}`)),
      h('div', { class: 'endpoint-row', role: 'group', 'aria-label': 'Live endpoint' },
        h('span', { class: 'method-badge' }, 'GET'), h('code', { class: 'url' }, resource.url),
        copyButton(() => resource.url, { label: 'Copy URL', ariaLabel: `Copy endpoint URL for ${resource.name}` }))),
    h('div', { class: 'endpoint-extra fine' },
      `Also available: `, h('code', {}, `/${resource.name}/:id`), ' · ', h('code', {}, '?page=&limit='), ' · ', h('code', {}, '?sortBy=&order='), ' · ', h('code', {}, '?search='),
      ' · filters like ', h('code', {}, '?field=value'), ' · CORS enabled'),
    tabs, panel);
}

// ---------- theme + mobile sidebar ----------
function initTheme() {
  const btn = $('#theme-toggle');
  const apply = (t) => {
    setTheme(t);
    btn.setAttribute('aria-pressed', String(t === 'dark'));
    btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    clear(btn).append(icon(t === 'dark' ? 'sun' : 'moon', 18), h('span', { class: 'theme-label' }, t === 'dark' ? 'Light' : 'Dark'));
  };
  apply(getTheme());
  btn.addEventListener('click', () => apply(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
}

sbToggle.addEventListener('click', () => {
  const open = sidebarEl.classList.toggle('is-open');
  sbToggle.setAttribute('aria-expanded', String(open));
});

// ---------- boot ----------
initTheme();
drawSidebar();
drawMain();
await reloadAll();

// App state + the anonymous management token (kept only in this browser's localStorage).

let memoryToken = null;
const mem = {};

function lsGet(key) { try { return localStorage.getItem(key); } catch { return mem[key] ?? null; } }
function lsSet(key, val) { try { localStorage.setItem(key, val); } catch { mem[key] = val; } }

export const TOKEN_RE = /^mat_[a-f0-9]{48}$/;

function makeToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `mat_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function getToken() {
  let t = lsGet('fm.token') || memoryToken;
  if (!t || !TOKEN_RE.test(t)) { t = makeToken(); setToken(t); }
  return t;
}
export function setToken(t) { memoryToken = t; lsSet('fm.token', t); }

export function getTheme() {
  const saved = lsGet('fm.theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function setTheme(theme) {
  lsSet('fm.theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
}

export const state = {
  loading: true,
  loadError: null,
  limits: null,
  projects: [],
  projectId: null,
  resourceId: null,
  tab: 'schema',
  mode: 'dashboard', // 'dashboard' | 'wizard'
};

export function saveSelection() {
  lsSet('fm.sel', JSON.stringify({ p: state.projectId, r: state.resourceId, t: state.tab }));
}
export function loadSelection() {
  try { return JSON.parse(lsGet('fm.sel') || '{}'); } catch { return {}; }
}

export const currentProject = () => state.projects.find((p) => p.id === state.projectId) || null;
export const currentResource = () => currentProject()?.resources.find((r) => r.id === state.resourceId) || null;

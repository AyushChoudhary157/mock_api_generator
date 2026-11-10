// Small DOM + UX helpers. All rendering goes through h() which only ever uses textContent /
// setAttribute, so user supplied strings can never inject markup (XSS-safe by construction).

const PROP_KEYS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'readOnly', 'multiple', 'required']);

/** h('button', {class:'btn', onClick: fn, 'aria-label':'x'}, 'Label', childNode) */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  const late = {};
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (/^on[A-Z]/.test(k) && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (PROP_KEYS.has(k)) late[k] = v; // set after children so <select value> works
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, kids);
  for (const [k, v] of Object.entries(late)) el[k] = v;
  return el;
}

export function append(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const fmt = (n) => new Intl.NumberFormat('en-US').format(n ?? 0);
let uidCounter = 0;
export const uid = (p = 'id') => `${p}-${++uidCounter}`;

/** Inline SVG icon from a tiny built-in set (no icon font, no network). */
const ICONS = {
  copy: 'M9 9h10v10H9zM5 15V5h10',
  check: 'M5 12l5 5 9-10',
  plus: 'M12 5v14M5 12h14',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  up: 'M6 14l6-6 6 6',
  down: 'M6 10l6 6 6-6',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  send: 'M4 12l16-8-6 16-3-7z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
  key: 'M14 10a4 4 0 11-3 6.7L4 17v-3l2-1v-2l2-1 1.3-1.3A4 4 0 0114 10z',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 9l5-5 5 5M5 20h14',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 5v6h-6',
  folder: 'M3 6h6l2 2h10v11H3z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  x: 'M6 6l12 12M18 6L6 18',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0011 18.7l1-1',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
};
export function icon(name, size = 16) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name] || ICONS.link);
  svg.append(path);
  return svg;
}

// ---------- clipboard + toasts ----------
export async function copyText(text, label = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { 'aria-hidden': 'true', style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
  }
  toast(label, 'success');
}

/** A button that copies `getText()` and briefly confirms. */
export function copyButton(getText, { label = 'Copy', small = true, ariaLabel } = {}) {
  const text = h('span', {}, label);
  const btn = h('button', {
    type: 'button', class: `btn ${small ? 'btn-sm' : ''}`, 'aria-label': ariaLabel || label,
    onClick: async () => {
      await copyText(typeof getText === 'function' ? getText() : getText);
      text.textContent = 'Copied';
      setTimeout(() => { text.textContent = label; }, 1400);
    },
  }, icon('copy', 14), text);
  return btn;
}

export function toast(message, kind = 'info', ms = 3800) {
  let host = $('#toasts');
  if (!host) { host = h('div', { id: 'toasts', 'aria-live': 'polite', 'aria-atomic': 'false' }); document.body.append(host); }
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast-msg' }, message),
    h('button', { type: 'button', class: 'toast-x', 'aria-label': 'Dismiss notification', onClick: () => el.remove() }, icon('x', 14)));
  host.append(el);
  setTimeout(() => el.remove(), ms);
}

// ---------- dialogs (native <dialog>: focus trap + Esc for free) ----------
export function openDialog({ title, body, actions = [], size = 'md', onClose }) {
  const titleId = uid('dlg-title');
  const dlg = h('dialog', { class: `modal modal-${size}`, 'aria-labelledby': titleId });
  const close = () => { if (dlg.open) dlg.close(); };
  const footer = actions.length ? h('div', { class: 'modal-foot' }, actions.map((a) => h('button', {
    type: 'button', class: `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}`,
    onClick: async (e) => {
      const btn = e.currentTarget;
      const keepOpen = a.onClick ? await a.onClick({ close, button: btn }) : false;
      if (keepOpen !== true) close();
    },
  }, a.label))) : null;
  dlg.append(
    h('div', { class: 'modal-head' },
      h('h2', { id: titleId }, title),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close dialog', onClick: close }, icon('x', 18))),
    h('div', { class: 'modal-body' }, body),
    footer,
  );
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); }); // backdrop click
  document.body.append(dlg);
  dlg.showModal();
  return { el: dlg, close };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    openDialog({
      title, size: 'sm', body: h('p', { class: 'modal-text' }, message),
      actions: [{ label: 'Cancel' }, { label: confirmLabel, primary: !danger, danger, onClick: () => { result = true; } }],
      onClose: () => resolve(result),
    });
  });
}

/** Sets a button into a loading state while `fn` runs. */
export async function withLoading(btn, fn, busyLabel) {
  const original = [...btn.childNodes];
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  clear(btn).append(h('span', { class: 'spinner', 'aria-hidden': 'true' }), busyLabel || 'Working…');
  try { return await fn(); } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    clear(btn).append(...original);
  }
}

// ---------- JSON highlighting (no innerHTML) ----------
export function jsonNodes(text) {
  const frag = document.createDocumentFragment();
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    if (m[1]) {
      frag.append(h('span', { class: m[2] ? 't-key' : 't-str' }, m[1]));
      if (m[2]) frag.append(m[2]);
    } else frag.append(h('span', { class: m[3] ? 't-kw' : 't-num' }, m[0]));
    last = re.lastIndex;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

export const pretty = (v) => JSON.stringify(v, null, 2);

export function skeleton(lines = 3) {
  return h('div', { class: 'skeleton-wrap', 'aria-hidden': 'true' },
    Array.from({ length: lines }, (_, i) => h('div', { class: 'skeleton', style: { width: `${92 - i * 14}%` } })));
}

export function emptyState({ title, text, action }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-art', 'aria-hidden': 'true' }, icon('folder', 28)),
    h('h3', {}, title), text ? h('p', {}, text) : null, action || null);
}

/** Labelled form field with optional hint + error slot. Returns {el, input, setError}. */
export function field({ label, input, hint, id = uid('f') }) {
  input.id = input.id || id;
  const err = h('p', { class: 'field-err', id: `${input.id}-err`, role: 'alert', hidden: true });
  const hintEl = hint ? h('p', { class: 'field-hint', id: `${input.id}-hint` }, hint) : null;
  input.setAttribute('aria-describedby', [hintEl && hintEl.id, err.id].filter(Boolean).join(' '));
  const el = h('div', { class: 'field' }, h('label', { for: input.id }, label), input, hintEl, err);
  return {
    el, input,
    setError(msg) {
      err.textContent = msg || '';
      err.hidden = !msg;
      input.toggleAttribute('aria-invalid', Boolean(msg));
    },
  };
}

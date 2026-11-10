// Left sidebar: projects & resources, plus free-tier usage meters for the selected project.
import { h, clear, icon, fmt, skeleton } from './util.js';
import { state, currentProject } from './store.js';

function meter(label, used, limit) {
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const level = pct >= 90 ? 'is-high' : pct >= 70 ? 'is-mid' : '';
  return h('div', { class: 'meter-row' },
    h('div', { class: 'meter-label' }, h('span', {}, label), h('span', { class: 'meter-num' }, `${fmt(used)} / ${fmt(limit)}`)),
    h('div', { class: `meter ${level}`, role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': limit, 'aria-valuenow': used, 'aria-valuetext': `${used} of ${limit} used` },
      h('span', { style: { width: `${pct}%` } })));
}

export function renderSidebar(el, actions) {
  clear(el);
  const limits = state.limits || {};
  el.append(h('div', { class: 'sb-head' },
    h('h2', { id: 'sb-title' }, 'Projects'),
    h('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: actions.newProject }, icon('plus', 14), 'New')));

  if (state.loading) { el.append(skeleton(4)); return; }

  const nav = h('nav', { 'aria-labelledby': 'sb-title' });
  if (!state.projects.length) {
    nav.append(h('p', { class: 'sb-empty' }, 'No projects yet. Create your first one to get a live API URL.'));
  }
  const list = h('ul', { class: 'proj-list' });
  for (const p of state.projects) {
    const open = p.id === state.projectId;
    const resList = h('ul', { class: 'res-list' });
    if (open) {
      p.resources.forEach((r) => resList.append(h('li', {}, h('button', {
        type: 'button', class: `res-btn ${r.id === state.resourceId && state.mode === 'dashboard' ? 'is-active' : ''}`,
        'aria-current': r.id === state.resourceId && state.mode === 'dashboard' ? 'true' : null,
        onClick: () => actions.selectResource(p.id, r.id),
      }, h('span', { class: 'res-name' }, `/${r.name}`), h('span', { class: 'count', 'aria-label': `${r.record_count} records` }, String(r.record_count ?? 0))))));
      resList.append(h('li', {}, h('button', { type: 'button', class: 'res-add', disabled: p.resources.length >= (limits.max_resources ?? 10), onClick: () => actions.newResource(p.id) },
        icon('plus', 14), p.resources.length >= (limits.max_resources ?? 10) ? 'Resource limit reached' : 'Add resource')));
    }
    list.append(h('li', { class: `proj ${open ? 'is-open' : ''}` },
      h('button', { type: 'button', class: 'proj-btn', 'aria-expanded': String(open), onClick: () => actions.selectProject(p.id) },
        icon('folder', 16), h('span', { class: 'proj-name' }, p.name), h('span', { class: 'count', 'aria-label': `${p.resources.length} resources` }, String(p.resources.length))),
      open ? resList : null));
  }
  nav.append(list);
  el.append(nav);

  const p = currentProject();
  if (p) {
    el.append(h('section', { class: 'usage', 'aria-labelledby': 'usage-h' },
      h('h3', { id: 'usage-h' }, 'Free-tier usage'),
      meter('Resources', p.resources.length, limits.max_resources ?? 10),
      meter('Requests today', p.requests_today ?? 0, limits.max_requests_per_day ?? 1000),
      meter('Projects', state.projects.length, limits.max_projects ?? 5),
      h('p', { class: 'fine' }, `Up to ${limits.max_records ?? 100} records per resource. Daily request quota resets at 00:00 UTC.`)));
  } else if (!state.loading) {
    el.append(h('section', { class: 'usage' }, h('h3', {}, 'Free-tier limits'),
      h('ul', { class: 'limit-list' },
        h('li', {}, `${limits.max_projects ?? 5} projects`), h('li', {}, `${limits.max_resources ?? 10} resources per project`),
        h('li', {}, `${limits.max_records ?? 100} records per resource`), h('li', {}, `${fmt(limits.max_requests_per_day ?? 1000)} requests per day`))));
  }

  el.append(h('button', { type: 'button', class: 'btn btn-ghost btn-block', onClick: actions.accessKey }, icon('key', 16), 'Access key & backup'));
}

// Three-step onboarding: 1) Create project -> 2) Define resource (AI / manual / import) -> 3) Copy endpoint.
import { h, clear, field, withLoading, toast, icon, copyButton } from './util.js';
import { api, describeError, ApiError } from './api.js';
import { createFieldEditor } from './schema-editor.js';
import { presets, AI_EXAMPLES } from './presets.js';
import { openImportDialog } from './import.js';

const STEPS = ['Create project', 'Define resource', 'Copy your endpoint'];

export function stepper(active) {
  return h('ol', { class: 'stepper', 'aria-label': 'Setup progress' }, STEPS.map((label, i) => h('li', {
    class: `step ${i + 1 < active ? 'is-done' : ''} ${i + 1 === active ? 'is-active' : ''}`, 'aria-current': i + 1 === active ? 'step' : null,
  }, h('span', { class: 'step-dot', 'aria-hidden': 'true' }, i + 1 < active ? icon('check', 14) : String(i + 1)), h('span', { class: 'step-label' }, label))));
}

/**
 * @param {object} ctx
 * @param {object|null} ctx.project existing project (skips step 1)
 * @param {object} ctx.limits
 * @param {(p)=>Promise<void>} ctx.onProjectCreated reload hook, receives new project
 * @param {()=>Promise<object>} ctx.reload refreshes state, returns the project list
 * @param {(rid:string)=>void} ctx.onFinish open the dashboard
 * @param {()=>void} [ctx.onCancel]
 */
export function createWizard(ctx) {
  let project = ctx.project;
  let step = project ? 2 : 1;
  let createdResources = [];
  const root = h('div', { class: 'wizard' });

  function show() {
    clear(root);
    root.append(stepper(step));
    root.append(step === 1 ? step1() : step === 2 ? step2() : step3());
    root.querySelector('h2')?.setAttribute('tabindex', '-1');
    root.querySelector('h2')?.focus({ preventScroll: true });
  }

  // ---------- step 1 ----------
  function step1() {
    const name = h('input', { type: 'text', maxlength: 60, placeholder: 'e.g. Shop backend', autocomplete: 'off', required: true });
    const f = field({ label: 'Project name', input: name, hint: 'Just a label for you. Your public API URL is generated automatically.' });
    const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, 'Create project');
    const form = h('form', { class: 'wiz-form', novalidate: true, onSubmit: async (e) => {
      e.preventDefault();
      f.setError('');
      if (!name.value.trim()) { f.setError('Give your project a name to continue.'); name.focus(); return; }
      try {
        await withLoading(submit, async () => { project = await ctx.onProjectCreated(name.value.trim()); }, 'Creating…');
        step = 2;
        show();
      } catch (err) { f.setError(describeError(err)); }
    } }, f.el, submit);
    setTimeout(() => name.focus(), 0);
    return h('section', { class: 'wiz-card', 'aria-labelledby': 'wiz-h' },
      h('h2', { id: 'wiz-h' }, 'Name your project'),
      h('p', { class: 'lead' }, 'A project groups related resources (like /users and /orders) under one public base URL. No sign-up needed.'),
      form,
      h('p', { class: 'fine' }, `Free tier: ${ctx.limits?.max_projects ?? 5} projects, ${ctx.limits?.max_resources ?? 10} resources per project, ${ctx.limits?.max_records ?? 100} records per resource.`));
  }

  // ---------- step 2 ----------
  function step2() {
    let mode = ctx.limits?.ai_enabled ? 'ai' : 'manual';
    const body = h('div', { class: 'wiz-body' });
    const tabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'How do you want to define your resource?' });
    const defs = [['ai', 'Describe with AI'], ['manual', 'Build manually'], ['import', 'Import data']];

    function renderTabs() {
      clear(tabs);
      defs.forEach(([id, label]) => tabs.append(h('button', {
        type: 'button', role: 'tab', id: `wt-${id}`, class: `seg-btn ${mode === id ? 'is-active' : ''}`, 'aria-selected': String(mode === id), tabindex: mode === id ? '0' : '-1',
        onClick: () => { mode = id; renderTabs(); renderBody(); },
        onKeydown: (e) => {
          const i = defs.findIndex((d) => d[0] === mode);
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); mode = defs[(i + (e.key === 'ArrowRight' ? 1 : defs.length - 1)) % defs.length][0]; renderTabs(); renderBody(); document.getElementById(`wt-${mode}`).focus(); }
        },
      }, id === 'ai' ? icon('sparkle', 14) : null, label)));
    }
    function renderBody() {
      clear(body);
      body.setAttribute('role', 'tabpanel');
      body.setAttribute('aria-labelledby', `wt-${mode}`);
      body.append(mode === 'ai' ? aiPanel() : mode === 'manual' ? manualPanel() : importPanel());
    }

    function afterCreate(resources) {
      createdResources = resources;
      ctx.reload?.(); // refresh sidebar counts in the background
      step = 3;
      show();
    }

    // --- AI ---
    function aiPanel() {
      const ta = h('textarea', { rows: 3, maxlength: 600, placeholder: 'e.g. E-commerce with users, products and orders', 'aria-label': 'Describe your API' });
      const results = h('div', { class: 'ai-results', 'aria-live': 'polite' });
      const go = h('button', { type: 'button', class: 'btn btn-primary' }, icon('sparkle', 16), 'Generate schema');
      const notice = ctx.limits?.ai_enabled ? null : h('div', { class: 'notice notice-info' }, 'AI generation is not enabled on this server yet. Switch to “Build manually” or “Import data”; everything else works.');
      if (!ctx.limits?.ai_enabled) go.disabled = true;
      go.addEventListener('click', async () => {
        clear(results);
        if (ta.value.trim().length < 4) { results.append(h('p', { class: 'field-err' }, 'Describe your API in a few words first.')); ta.focus(); return; }
        try {
          const out = await withLoading(go, () => api(`/projects/${project.id}/ai/schema`, { method: 'POST', body: { prompt: ta.value } }), 'Designing your API…');
          results.append(proposal(out.resources));
        } catch (err) {
          const manual = err instanceof ApiError && (err.code === 'ai_unavailable' || err.code === 'ai_limit_reached');
          results.append(h('div', { class: 'notice notice-warn', role: 'alert' }, describeError(err),
            manual ? h('div', { class: 'notice-actions' }, h('button', { type: 'button', class: 'btn btn-sm', onClick: () => { mode = 'manual'; renderTabs(); renderBody(); } }, 'Build manually instead')) : null));
        }
      });
      return h('div', {},
        h('p', { class: 'lead' }, 'Describe what you are building. The AI proposes resources, fields and relations. You review everything before it is created.'),
        notice, h('label', { class: 'sr-only', for: 'ai-prompt' }, 'Describe your API'),
        (ta.id = 'ai-prompt', ta),
        h('div', { class: 'chips', 'aria-label': 'Examples' }, AI_EXAMPLES.map((ex) => h('button', { type: 'button', class: 'chip chip-btn', onClick: () => { ta.value = ex; ta.focus(); } }, ex))),
        h('div', { class: 'row-actions' }, go), results);
    }

    function proposal(resources) {
      const create = h('button', { type: 'button', class: 'btn btn-primary' }, `Create ${resources.length} resource${resources.length > 1 ? 's' : ''}`);
      create.addEventListener('click', async () => {
        try {
          const hasHints = resources.some((r) => r.fields.some((f) => f.aiHint));
          const out = await withLoading(create, () => api(`/projects/${project.id}/apply-schema`, { method: 'POST', body: { resources, useAI: hasHints } }), 'Creating…');
          if (out.ai?.fallback) toast(out.ai.message || 'Some AI values fell back to the built-in generator.', 'info');
          afterCreate(out.resources.filter((r) => resources.some((x) => x.name === r.name)));
        } catch (err) { toast(describeError(err), 'error', 6000); }
      });
      return h('div', { class: 'proposal' },
        h('h3', {}, 'Proposed schema'),
        h('div', { class: 'proposal-grid' }, resources.map((r) => h('article', { class: 'mini-card' },
          h('h4', {}, `/${r.name}`, h('span', { class: 'chip' }, `${r.count} records`)),
          h('ul', { class: 'field-list' }, r.fields.map((f) => h('li', {}, h('span', { class: 'fname' }, f.name), h('span', { class: 'ftype' }, f.type === 'ref' ? `ref → ${f.ref}` : f.type))))))),
        h('div', { class: 'row-actions' }, create, h('p', { class: 'fine' }, 'You can edit every field afterwards in the Schema tab.')));
    }

    // --- manual ---
    function manualPanel() {
      const existing = project.resources.map((r) => r.name);
      const nameInput = h('input', { type: 'text', maxlength: 30, placeholder: 'users', autocomplete: 'off', spellcheck: 'false' });
      const nameField = field({ label: 'Resource name', input: nameInput, hint: 'Becomes the URL path, e.g. /users. Lowercase letters, numbers, - and _.' });
      const countInput = h('input', { type: 'number', min: 0, max: ctx.limits?.max_records ?? 100, value: 10, inputmode: 'numeric' });
      const countField = field({ label: 'Sample records to generate', input: countInput, hint: `0 to ${ctx.limits?.max_records ?? 100}. You can regenerate anytime.` });
      let editor = createFieldEditor({ fields: presets(existing)[0].fields, resourceNames: existing });
      const editorHost = h('div', {}, editor.el);
      const chips = h('div', { class: 'chips' }, presets(existing).map((p) => h('button', { type: 'button', class: 'chip chip-btn', onClick: () => {
        editor = createFieldEditor({ fields: p.fields, resourceNames: existing });
        clear(editorHost).append(editor.el);
        if (p.name && !existing.includes(p.name)) nameInput.value = p.name;
      } }, p.label)));
      nameInput.value = existing.includes('users') ? 'posts' : 'users';
      if (existing.includes('users')) { editor = createFieldEditor({ fields: presets(existing)[2].fields, resourceNames: existing }); clear(editorHost).append(editor.el); }
      const submit = h('button', { type: 'button', class: 'btn btn-primary btn-lg' }, 'Create resource');
      submit.addEventListener('click', async () => {
        nameField.setError('');
        const name = nameInput.value.trim().toLowerCase();
        if (!/^[a-z][a-z0-9_-]{0,29}$/.test(name)) { nameField.setError('Start with a letter; use only lowercase letters, numbers, - or _ (max 30).'); nameInput.focus(); return; }
        if (!editor.validate()) { toast('Fix the highlighted fields first.', 'error'); return; }
        try {
          const out = await withLoading(submit, () => api(`/projects/${project.id}/resources`, { method: 'POST',
            body: { name, count: Number(countInput.value) || 0, fields: editor.getFields() } }), 'Creating…');
          afterCreate([out.resource]);
        } catch (err) { nameField.setError(describeError(err)); nameInput.focus(); }
      });
      return h('div', {}, h('p', { class: 'lead' }, 'Pick a starting point, then add, remove and reorder fields.'),
        chips, h('div', { class: 'grid-2' }, nameField.el, countField.el), editorHost, h('div', { class: 'row-actions' }, submit));
    }

    // --- import ---
    function importPanel() {
      return h('div', {}, h('p', { class: 'lead' }, 'Already have sample data? Paste JSON or upload a CSV/JSON file. We infer the schema and seed your records.'),
        h('button', { type: 'button', class: 'btn btn-primary', onClick: () => openImportDialog({ project, onDone: async (resources) => { afterCreate(resources); } }) }, icon('upload', 16), 'Import JSON or CSV'));
    }

    renderTabs();
    renderBody();
    return h('section', { class: 'wiz-card', 'aria-labelledby': 'wiz-h' },
      h('h2', { id: 'wiz-h' }, project.resources.length ? 'Add another resource' : 'Define your first resource'),
      h('p', { class: 'fine' }, `Project “${project.name}”`), tabs, body,
      ctx.onCancel ? h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-ghost', onClick: ctx.onCancel }, 'Cancel')) : null);
  }

  // ---------- step 3 ----------
  function step3() {
    const first = createdResources[0];
    return h('section', { class: 'wiz-card wiz-done', 'aria-labelledby': 'wiz-h' },
      h('h2', { id: 'wiz-h' }, 'Your live API is ready 🎉'),
      h('p', { class: 'lead' }, 'These URLs are public and work from any browser, app or test script. CORS is enabled.'),
      h('ul', { class: 'endpoint-list' }, createdResources.map((r) => h('li', {},
        h('code', { class: 'url' }, r.url), copyButton(() => r.url, { label: 'Copy URL', ariaLabel: `Copy URL for ${r.name}` })))),
      first ? h('div', { class: 'terminal', role: 'group', 'aria-label': 'Try it' }, h('div', { class: 'terminal-bar' }, 'Try it in your terminal', copyButton(() => `curl "${first.url}?limit=3"`, { label: 'Copy' })),
        h('pre', {}, h('code', {}, `curl "${first.url}?limit=3"`))) : null,
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn btn-primary btn-lg', onClick: () => ctx.onFinish(first?.id, 'test') }, icon('send', 16), 'Open in API tester'),
        h('button', { type: 'button', class: 'btn btn-lg', onClick: () => ctx.onFinish(first?.id, 'schema') }, 'Go to dashboard')));
  }

  show();
  return { el: root };
}

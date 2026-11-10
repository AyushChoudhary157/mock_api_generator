// Schema tab: edit fields, then save (optionally regenerating data to match).
import { h, toast, withLoading, icon, confirmDialog } from './util.js';
import { api, describeError } from './api.js';
import { createFieldEditor } from './schema-editor.js';

export function createSchemaView({ project, resource, reload }) {
  const siblings = project.resources.filter((r) => r.id !== resource.id).map((r) => r.name);
  let dirty = false;
  const editor = createFieldEditor({ fields: resource.schema, resourceNames: siblings, onChange: () => { dirty = true; saveBtn.disabled = false; status.textContent = 'Unsaved changes'; } });

  const status = h('span', { class: 'fine', role: 'status' }, '');
  const errBox = h('p', { class: 'field-err', role: 'alert', hidden: true });

  async function save(regenerate, btn) {
    errBox.hidden = true;
    if (!editor.validate()) { toast('Fix the highlighted fields first.', 'error'); return; }
    try {
      await withLoading(btn, async () => {
        await api(`/projects/${project.id}/resources/${resource.id}`, { method: 'PATCH', body: { schema: editor.getFields() } });
        if (regenerate) {
          await api(`/projects/${project.id}/resources/${resource.id}/generate`, { method: 'POST', body: { count: Math.max(1, resource.record_count || 10), replace: true } });
        }
      }, 'Saving…');
      dirty = false;
      toast(regenerate ? 'Schema saved and data regenerated' : 'Schema saved', 'success');
      await reload();
    } catch (err) { errBox.textContent = describeError(err); errBox.hidden = false; }
  }

  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary', disabled: true, onClick: (e) => save(false, e.currentTarget) }, 'Save schema');
  const regenBtn = h('button', { type: 'button', class: 'btn', onClick: async (e) => {
    const btn = e.currentTarget; // must be read before any await: it is null afterwards
    if (resource.record_count > 0 && !(await confirmDialog({ title: 'Save and regenerate data?', message: `The ${resource.record_count} existing records in /${resource.name} will be replaced with new ones that match this schema.`, confirmLabel: 'Save & regenerate', danger: true }))) return;
    save(true, btn);
  } }, icon('refresh', 16), 'Save & regenerate data');

  const root = h('div', { class: 'tab-panel schema-view' },
    h('div', { class: 'panel-head' }, h('div', {}, h('h3', {}, 'Schema'),
      h('p', { class: 'fine' }, 'Define the fields of each record. Drag the handle (or use the arrow buttons) to reorder.'))),
    h('div', { class: 'notice notice-info' }, 'Saving a schema does not rewrite existing records. Use “Save & regenerate data” to create new sample records that match.'),
    siblings.length ? h('p', { class: 'fine' }, `Tip: add a “Relation (ref)” field that points to another resource (${siblings.map((s) => `/${s}`).join(', ')}) to unlock nested routes like /${siblings[0]}/1/${resource.name}.`) : null,
    editor.el, errBox,
    h('div', { class: 'sticky-actions' }, saveBtn, regenBtn, status));
  window.addEventListener('beforeunload', (e) => { if (dirty && root.isConnected) { e.preventDefault(); e.returnValue = ''; } });
  return { el: root, isDirty: () => dirty };
}

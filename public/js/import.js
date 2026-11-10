// Import dialog: paste JSON or upload a CSV/JSON file; schema is inferred server-side.
import { h, openDialog, field, toast, icon, withLoading, clear } from './util.js';
import { api, describeError } from './api.js';
import { toImportItems } from './csv.js';

const MAX_FILE_BYTES = 200 * 1024;

export function openImportDialog({ project, onDone }) {
  let items = null;
  let filename = '';
  const text = h('textarea', { rows: 9, spellcheck: 'false', placeholder: '[\n  { "name": "Ada", "email": "ada@example.com", "age": 36 }\n]', 'aria-label': 'JSON or CSV data' });
  const textField = field({ label: 'Paste JSON or CSV', input: text, hint: 'An array of objects, an object of arrays ({"users":[…],"posts":[…]}) or CSV with a header row.' });
  const nameInput = h('input', { type: 'text', maxlength: 30, value: 'items', autocomplete: 'off' });
  const nameField = field({ label: 'Resource name (single list only)', input: nameInput, hint: 'Used when you paste one array or a CSV file.' });
  const replace = h('input', { type: 'checkbox', id: 'imp-replace' });
  const preview = h('div', { class: 'import-preview', 'aria-live': 'polite' });
  const fileInput = h('input', { type: 'file', accept: '.json,.csv,application/json,text/csv', id: 'imp-file', class: 'sr-only-input',
    onChange: async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) { textField.setError(`That file is ${(file.size / 1024).toFixed(0)} KB. The limit is ${MAX_FILE_BYTES / 1024} KB.`); return; }
      filename = file.name;
      text.value = await file.text();
      nameInput.value = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z]+/, '').slice(0, 30) || 'items';
      parse();
    } });

  function parse() {
    textField.setError('');
    clear(preview);
    items = null;
    if (!text.value.trim()) return false;
    try {
      items = toImportItems(text.value, filename, nameInput.value.trim() || 'items');
      if (items.length === 1 && !filename) items[0].name = nameInput.value.trim().toLowerCase() || items[0].name;
      if (items.length === 1 && filename) items[0].name = nameInput.value.trim().toLowerCase() || items[0].name;
      preview.append(h('p', { class: 'fine' }, 'Ready to import:'), h('ul', { class: 'field-list' }, items.map((i) => h('li', {}, h('span', { class: 'fname' }, `/${i.name}`), h('span', { class: 'ftype' }, `${i.records.length} records`)))));
      return true;
    } catch (err) { textField.setError(err.message); return false; }
  }
  text.addEventListener('input', () => { filename = ''; parse(); });
  nameInput.addEventListener('input', () => { if (text.value.trim()) parse(); });

  const body = h('div', { class: 'import' },
    h('div', { class: 'file-pick' }, fileInput, h('label', { for: 'imp-file', class: 'btn' }, icon('upload', 16), 'Choose a .csv or .json file'), h('span', { class: 'fine' }, 'or paste below')),
    textField.el, nameField.el,
    h('div', { class: 'check' }, replace, h('label', { for: 'imp-replace' }, 'Replace resources that already exist')),
    h('p', { class: 'fine' }, 'Imported records get new sequential ids. Only the first 100 records per resource are kept on the free tier.'),
    preview);

  const dlg = openDialog({ title: 'Import data', body, size: 'lg', actions: [
    { label: 'Cancel' },
    { label: 'Import', primary: true, onClick: async ({ button }) => {
      if (!parse() || !items) { if (!text.value.trim()) textField.setError('Paste some data or choose a file first.'); return true; }
      try {
        const out = await withLoading(button, () => api(`/projects/${project.id}/import`, { method: 'POST', body: { resources: items, replace: replace.checked } }), 'Importing…');
        (out.notes || []).forEach((n) => toast(n, 'info', 6000));
        toast(`Imported ${out.resources.length} resource${out.resources.length > 1 ? 's' : ''}`, 'success');
        await onDone(out.resources);
        return false;
      } catch (err) { textField.setError(describeError(err)); return true; }
    } },
  ] });
  return dlg;
}

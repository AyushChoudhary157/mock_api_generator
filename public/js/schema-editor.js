// Visual schema builder. Drag handles AND up/down buttons reorder fields (keyboard accessible).
// Text typing never re-renders the list (so focus is kept); structural changes do.
import { h, icon, uid, clear } from './util.js';

export const TYPE_META = [
  { type: 'string', label: 'String', hint: 'Random words' },
  { type: 'text', label: 'Paragraph', hint: 'Long text' },
  { type: 'int', label: 'Integer', hint: 'Whole number' },
  { type: 'float', label: 'Float', hint: 'Decimal number' },
  { type: 'boolean', label: 'Boolean', hint: 'true / false' },
  { type: 'date', label: 'Date', hint: 'ISO date' },
  { type: 'email', label: 'Email', hint: '' },
  { type: 'name', label: 'Full name', hint: '' },
  { type: 'phone', label: 'Phone', hint: '' },
  { type: 'address', label: 'Address', hint: '' },
  { type: 'avatar', label: 'Avatar URL', hint: '' },
  { type: 'uuid', label: 'UUID', hint: '' },
  { type: 'url', label: 'URL', hint: '' },
  { type: 'company', label: 'Company', hint: '' },
  { type: 'enum', label: 'Enum', hint: 'Pick from list' },
  { type: 'object', label: 'Nested object', hint: '' },
  { type: 'array', label: 'Array', hint: '' },
  { type: 'ref', label: 'Relation (ref)', hint: 'Links to another resource' },
];
const AI_TYPES = new Set(['string', 'text', 'name', 'company', 'address', 'url']);
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;

const numOrEmpty = (v) => (v === undefined || v === null ? '' : String(v));

function toRow(f) {
  const row = { uid: uid('fld'), name: f.name, type: f.type, aiHint: f.aiHint || '', showAi: Boolean(f.aiHint),
    words: numOrEmpty(f.words), min: numOrEmpty(f.min), max: numOrEmpty(f.max), decimals: numOrEmpty(f.decimals),
    format: f.format || 'datetime', values: (f.values || []).join(', '), ref: f.ref || '', open: false, children: null,
    ofType: f.of?.type || 'string', ofWords: numOrEmpty(f.of?.words), ofValues: (f.of?.values || []).join(', '),
    ofMin: numOrEmpty(f.of?.min), ofMax: numOrEmpty(f.of?.max), ofRef: f.of?.ref || '',
    arrMin: numOrEmpty(f.min), arrMax: numOrEmpty(f.max) };
  if (f.type === 'array') { row.min = ''; row.max = ''; }
  if (f.type === 'object') row.children = (f.fields || []).map(toRow);
  return row;
}

const num = (v) => (v === '' || v === undefined ? undefined : Number(v));
function setIf(o, k, v) { if (v !== undefined && !Number.isNaN(v)) o[k] = v; }

function fromRow(r) {
  const f = { name: r.name.trim(), type: r.type };
  if (r.aiHint.trim() && AI_TYPES.has(r.type)) f.aiHint = r.aiHint.trim();
  switch (r.type) {
    case 'string': setIf(f, 'words', num(r.words)); break;
    case 'int': setIf(f, 'min', num(r.min)); setIf(f, 'max', num(r.max)); break;
    case 'float': setIf(f, 'min', num(r.min)); setIf(f, 'max', num(r.max)); setIf(f, 'decimals', num(r.decimals)); break;
    case 'date': f.format = r.format; break;
    case 'enum': f.values = r.values.split(',').map((s) => s.trim()).filter(Boolean); break;
    case 'ref': f.ref = r.ref; break;
    case 'object': f.fields = (r.children || []).map(fromRow); break;
    case 'array': {
      const of = { type: r.ofType };
      if (r.ofType === 'string') setIf(of, 'words', num(r.ofWords));
      if (r.ofType === 'enum') of.values = r.ofValues.split(',').map((s) => s.trim()).filter(Boolean);
      if (r.ofType === 'int' || r.ofType === 'float') { setIf(of, 'min', num(r.ofMin)); setIf(of, 'max', num(r.ofMax)); }
      f.of = of;
      setIf(f, 'min', num(r.arrMin)); setIf(f, 'max', num(r.arrMax));
      break;
    }
    default: break;
  }
  return f;
}

/**
 * @param {object} opts
 * @param {object[]} opts.fields initial schema (top level starts with the id field)
 * @param {string[]} opts.resourceNames resources a `ref` field can point to
 * @param {number} [opts.depth]
 */
export function createFieldEditor({ fields, resourceNames = [], depth = 0, onChange }) {
  const withId = depth === 0;
  let rows = (fields || []).filter((f) => !(withId && f.name === 'id')).map(toRow);
  const root = h('div', { class: `fe ${depth ? 'fe-nested' : ''}` });
  let dragIndex = null;

  const touch = () => onChange?.();
  const validateRow = (row, siblings) => {
    if (!NAME_RE.test(row.name.trim())) return 'Use letters, numbers and _ (max 40). Cannot start with a number.';
    if ((withId && row.name.trim() === 'id') || siblings.filter((s) => s.name.trim() === row.name.trim()).length > 1) return 'Field names must be unique.';
    if (row.type === 'enum' && !row.values.split(',').some((s) => s.trim())) return 'Add at least one value, separated by commas.';
    if (row.type === 'ref' && !row.ref) return 'Choose which resource this field points to.';
    if (row.type === 'object' && !(row.children || []).length) return 'Add at least one nested field.';
    const lo = num(row.min); const hi = num(row.max);
    if ((row.type === 'int' || row.type === 'float') && lo !== undefined && hi !== undefined && lo > hi) return 'Min cannot be greater than max.';
    return '';
  };

  function numberInput(label, value, onInput, { min, max, step, width } = {}) {
    const id = uid('n');
    return h('div', { class: 'fe-cell fe-narrow', style: width ? { '--w': width } : null },
      h('label', { for: id }, label),
      h('input', { id, type: 'number', value, min, max, step, inputmode: 'decimal', onInput: (e) => { onInput(e.target.value); touch(); } }));
  }

  function optionsCell(row, i) {
    const cells = [];
    switch (row.type) {
      case 'string': cells.push(numberInput('Words', row.words, (v) => { row.words = v; }, { min: 1, max: 12 })); break;
      case 'int': case 'float':
        cells.push(numberInput('Min', row.min, (v) => { row.min = v; }, { step: 'any' }), numberInput('Max', row.max, (v) => { row.max = v; }, { step: 'any' }));
        if (row.type === 'float') cells.push(numberInput('Decimals', row.decimals, (v) => { row.decimals = v; }, { min: 0, max: 6 }));
        break;
      case 'date':
        cells.push(h('div', { class: 'fe-cell' }, h('label', { for: `${row.uid}-fmt` }, 'Format'),
          h('select', { id: `${row.uid}-fmt`, value: row.format, onChange: (e) => { row.format = e.target.value; touch(); } },
            h('option', { value: 'datetime' }, 'Date & time'), h('option', { value: 'date' }, 'Date only'))));
        break;
      case 'enum':
        cells.push(h('div', { class: 'fe-cell fe-grow' }, h('label', { for: `${row.uid}-vals` }, 'Values (comma separated)'),
          h('input', { id: `${row.uid}-vals`, type: 'text', value: row.values, placeholder: 'active, pending, closed', onInput: (e) => { row.values = e.target.value; touch(); } })));
        break;
      case 'ref':
        cells.push(h('div', { class: 'fe-cell fe-grow' }, h('label', { for: `${row.uid}-ref` }, 'Points to resource'),
          h('select', { id: `${row.uid}-ref`, value: row.ref, onChange: (e) => { row.ref = e.target.value; touch(); } },
            h('option', { value: '' }, 'Choose…'), resourceNames.map((n) => h('option', { value: n }, n)))));
        break;
      case 'object':
        cells.push(h('div', { class: 'fe-cell' }, h('span', { class: 'lbl-spacer' }, 'Nested'),
          h('button', { type: 'button', class: 'btn btn-sm', 'aria-expanded': String(row.open), onClick: () => { row.open = !row.open; render(); } },
            row.open ? 'Hide fields' : `Edit fields (${(row.children || []).length})`)));
        break;
      case 'array':
        cells.push(
          h('div', { class: 'fe-cell' }, h('label', { for: `${row.uid}-of` }, 'Item type'),
            h('select', { id: `${row.uid}-of`, value: row.ofType, onChange: (e) => { row.ofType = e.target.value; render(); } },
              TYPE_META.filter((t) => !['object', 'array', 'ref'].includes(t.type)).map((t) => h('option', { value: t.type }, t.label)))),
          numberInput('Min items', row.arrMin, (v) => { row.arrMin = v; }, { min: 0, max: 10 }),
          numberInput('Max items', row.arrMax, (v) => { row.arrMax = v; }, { min: 0, max: 10 }));
        if (row.ofType === 'enum') {
          cells.push(h('div', { class: 'fe-cell fe-grow' }, h('label', { for: `${row.uid}-ofv` }, 'Item values'),
            h('input', { id: `${row.uid}-ofv`, type: 'text', value: row.ofValues, placeholder: 'red, green, blue', onInput: (e) => { row.ofValues = e.target.value; touch(); } })));
        }
        break;
      default:
        cells.push(h('div', { class: 'fe-cell fe-auto' }, h('span', { class: 'muted' }, 'Generated automatically')));
    }
    void i;
    return h('div', { class: 'fe-options' }, cells);
  }

  function rowEl(row, i) {
    const errEl = h('p', { class: 'field-err', role: 'alert', hidden: true });
    const showErr = () => { const msg = validateRow(row, rows); errEl.textContent = msg; errEl.hidden = !msg; nameInput.toggleAttribute('aria-invalid', Boolean(msg)); return !msg; };
    const nameInput = h('input', {
      id: `${row.uid}-name`, type: 'text', value: row.name, placeholder: 'fieldName', maxlength: 40, autocomplete: 'off', spellcheck: 'false',
      onInput: (e) => { row.name = e.target.value; touch(); }, onBlur: showErr,
    });
    row._validate = showErr;
    const minIndex = 0;
    const el = h('div', { class: 'fe-row', role: 'group', 'aria-label': `Field ${row.name || i + 1}`, 'data-index': i },
      h('div', { class: 'fe-main' },
        h('div', { class: 'fe-handle' },
          h('button', { type: 'button', class: 'icon-btn drag', draggable: 'true', 'aria-label': `Drag to reorder ${row.name || 'field'}`, title: 'Drag to reorder',
            onDragstart: (e) => { dragIndex = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); el.classList.add('is-dragging'); },
            onDragend: () => { dragIndex = null; el.classList.remove('is-dragging'); } }, icon('grip', 16))),
        h('div', { class: 'fe-cell fe-name' }, h('label', { for: nameInput.id }, 'Field name'), nameInput),
        h('div', { class: 'fe-cell fe-type' }, h('label', { for: `${row.uid}-type` }, 'Type'),
          h('select', { id: `${row.uid}-type`, value: row.type, onChange: (e) => { row.type = e.target.value; if (row.type === 'object' && !row.children?.length) { row.children = [toRow({ name: 'value', type: 'string' })]; row.open = true; } if (row.type === 'ref' && !row.ref && resourceNames.length === 1) row.ref = resourceNames[0]; render(); touch(); } },
            TYPE_META.map((t) => h('option', { value: t.type }, t.label)))),
        optionsCell(row, i),
        h('div', { class: 'fe-actions' },
          AI_TYPES.has(row.type) && depth === 0 ? h('button', { type: 'button', class: `btn btn-sm btn-ghost ${row.showAi ? 'is-on' : ''}`, 'aria-pressed': String(row.showAi), title: 'Use AI for realistic domain-specific values',
            onClick: () => { row.showAi = !row.showAi; render(); } }, icon('sparkle', 14), 'AI') : null,
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Move ${row.name || 'field'} up`, disabled: i <= minIndex, onClick: () => move(i, i - 1) }, icon('up', 16)),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Move ${row.name || 'field'} down`, disabled: i >= rows.length - 1, onClick: () => move(i, i + 1) }, icon('down', 16)),
          h('button', { type: 'button', class: 'icon-btn icon-danger', 'aria-label': `Delete ${row.name || 'field'}`, onClick: () => { rows.splice(i, 1); render(); touch(); } }, icon('trash', 16)))),
      row.showAi && AI_TYPES.has(row.type) && depth === 0 ? h('div', { class: 'fe-ai' },
        h('label', { for: `${row.uid}-ai` }, 'AI hint'),
        h('input', { id: `${row.uid}-ai`, type: 'text', maxlength: 80, value: row.aiHint, placeholder: 'e.g. ICD-10 diagnosis name, Indian bank branch, SaaS plan name',
          onInput: (e) => { row.aiHint = e.target.value; touch(); } }),
        h('p', { class: 'field-hint' }, 'When you generate data with “Use AI”, values for this field come from the AI. Results are cached; without AI the built-in generator is used.')) : null,
      errEl,
      row.type === 'object' && row.open ? nestedEditor(row) : null);
    el.addEventListener('dragover', (e) => { if (dragIndex === null) return; e.preventDefault(); el.classList.add('is-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('is-over'));
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('is-over'); if (dragIndex !== null && dragIndex !== i) move(dragIndex, i); });
    return el;
  }

  function nestedEditor(row) {
    const sub = createFieldEditor({
      fields: (row.children || []).map(fromRow), resourceNames, depth: depth + 1, onChange: touch,
    });
    row._sub = sub;
    row.children = sub.getRows(); // share the live array so getFields() always sees edits
    return h('div', { class: 'fe-nest' }, h('p', { class: 'fe-nest-title' }, `Fields inside “${row.name || 'object'}”`), sub.el);
  }

  function move(from, to) {
    if (to < 0 || to >= rows.length) return;
    const [r] = rows.splice(from, 1);
    rows.splice(to, 0, r);
    render();
    touch();
    root.querySelector(`[data-index="${to}"] .icon-btn[aria-label^="Move"]:not([disabled])`)?.focus?.();
  }

  function render() {
    clear(root);
    const header = h('div', { class: 'fe-header', 'aria-hidden': 'true' }, h('span', {}, ''), h('span', {}, 'Field name'), h('span', {}, 'Type'), h('span', {}, 'Options'), h('span', {}, 'Actions'));
    const list = h('div', { class: 'fe-list' });
    if (withId) {
      list.append(h('div', { class: 'fe-row fe-locked' }, h('div', { class: 'fe-main' },
        h('div', { class: 'fe-handle' }),
        h('div', { class: 'fe-cell fe-name' }, h('label', { for: 'fe-id-name' }, 'Field name'), h('input', { id: 'fe-id-name', type: 'text', value: 'id', disabled: true })),
        h('div', { class: 'fe-cell fe-type' }, h('label', { for: 'fe-id-type' }, 'Type'), h('select', { id: 'fe-id-type', disabled: true }, h('option', {}, 'ID (auto-increment)'))),
        h('div', { class: 'fe-options' }, h('div', { class: 'fe-cell fe-auto' }, h('span', { class: 'muted' }, 'Assigned by the server'))),
        h('div', { class: 'fe-actions' }, h('span', { class: 'chip' }, 'Locked')))));
    }
    rows.forEach((r, i) => list.append(rowEl(r, i)));
    if (depth === 0) root.append(header);
    root.append(list,
      h('div', { class: 'fe-add' }, h('button', { type: 'button', class: 'btn btn-sm', onClick: () => addField() }, icon('plus', 14), depth ? 'Add nested field' : 'Add field')));
  }

  function addField(f) {
    const base = 'field';
    let n = rows.length + 1;
    const names = new Set(rows.map((r) => r.name));
    while (names.has(`${base}${n}`)) n++;
    const row = toRow(f || { name: `${base}${n}`, type: 'string' });
    rows.push(row);
    render();
    touch();
    document.getElementById(`${row.uid}-name`)?.select?.();
    root.querySelector(`#${row.uid}-name`)?.focus();
  }

  render();
  return {
    el: root,
    getRows: () => rows,
    /** Returns clean fields (without the implicit id for nested editors). */
    getFields() { return [...(withId ? [{ name: 'id', type: 'id' }] : []), ...rows.map(fromRow)]; },
    /** Marks every invalid row; returns true when everything is valid. */
    validate() {
      let ok = true;
      const walk = (list) => {
        for (const r of list) {
          if (r._validate && !r._validate()) ok = false;
          if (r.type === 'object') {
            if (r._sub) { if (!r._sub.validate()) ok = false; } else if (!(r.children || []).length) ok = false;
          }
        }
      };
      walk(rows);
      if (!rows.length && withId) return true; // an id-only schema is allowed
      return ok;
    },
    setFields(next) { rows = (next || []).filter((f) => !(withId && f.name === 'id')).map(toRow); render(); },
  };
}

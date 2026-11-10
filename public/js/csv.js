// Dependency-free CSV parser (RFC 4180 style: quotes, escaped quotes, newlines inside quotes)
// plus conversion of imported text into typed values.

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  if (rows.length < 2) throw new Error('The CSV needs a header row and at least one data row.');
  const header = rows[0].map((x) => x.trim());
  if (header.some((x) => !x)) throw new Error('Every CSV column needs a header name.');
  return rows.slice(1).map((r) => Object.fromEntries(header.map((k, i) => [k, coerce(r[i] ?? '')])));
}

/** CSV cells are text; turn obvious numbers/booleans into real types so the inferred schema is useful. */
function coerce(v) {
  const s = v.trim();
  if (s === '') return null;
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
  if (/^-?\d+$/.test(s) && s.replace('-', '').length < 16 && !(s.length > 1 && s.startsWith('0'))) return Number(s);
  if (/^-?\d*\.\d+$/.test(s)) return Number(s);
  return v;
}

/**
 * Normalises pasted/uploaded JSON or CSV into [{name, records, fields?}].
 * Accepts: an array of objects, {users:[...], posts:[...]}, or this tool's own export format.
 */
export function toImportItems(text, filename = '', defaultName = 'items') {
  const isCsv = /\.csv$/i.test(filename) || (!/^\s*[\[{]/.test(text) && text.includes(','));
  const base = filename.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z]+/, '').slice(0, 30);
  const name = base || defaultName;
  if (isCsv) return [{ name, records: parseCsv(text) }];
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(`That is not valid JSON: ${e.message}`); }
  if (Array.isArray(data)) {
    if (!data.length || !data.every((x) => x && typeof x === 'object' && !Array.isArray(x))) throw new Error('Provide a non-empty array of objects.');
    return [{ name, records: data }];
  }
  if (data && Array.isArray(data.resources)) {
    return data.resources.map((r) => ({ name: r.name, fields: r.fields, settings: r.settings, records: r.records || [] }));
  }
  if (data && typeof data === 'object') {
    const items = Object.entries(data).filter(([, v]) => Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object'))
      .map(([k, v]) => ({ name: k.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z]+/, '').slice(0, 30) || defaultName, records: v }));
    if (items.length) return items;
  }
  throw new Error('Could not find any arrays of objects to import.');
}

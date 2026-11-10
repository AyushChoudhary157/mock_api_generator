// Generates copy-paste code for the request currently built in the tester.

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;          // shell single-quote
const js = (s) => JSON.stringify(String(s));                          // JS / Python string literal

function bodyText(req) {
  return req.body && !['GET', 'DELETE'].includes(req.method) && req.body.trim() ? req.body.trim() : '';
}
function headerPairs(req) {
  const h = { ...req.headers };
  if (bodyText(req) && !Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['Content-Type'] = 'application/json';
  return Object.entries(h);
}

export function curlSnippet(req) {
  const lines = [`curl -X ${req.method} ${q(req.url)}`];
  for (const [k, v] of headerPairs(req)) lines.push(`  -H ${q(`${k}: ${v}`)}`);
  const b = bodyText(req);
  if (b) {
    let compact = b;
    try { compact = JSON.stringify(JSON.parse(b)); } catch { /* send as typed */ }
    lines.push(`  -d ${q(compact)}`);
  }
  return lines.join(' \\\n');
}

export function fetchSnippet(req) {
  const opts = [`  method: ${js(req.method)}`];
  const hp = headerPairs(req);
  if (hp.length) opts.push(`  headers: {\n${hp.map(([k, v]) => `    ${js(k)}: ${js(v)}`).join(',\n')}\n  }`);
  const b = bodyText(req);
  if (b) {
    let obj = null;
    try { obj = JSON.parse(b); } catch { /* keep raw */ }
    opts.push(`  body: ${obj !== null ? `JSON.stringify(${JSON.stringify(obj, null, 2).replace(/\n/g, '\n  ')})` : js(b)}`);
  }
  return `const response = await fetch(${js(req.url)}, {\n${opts.join(',\n')}\n});\nconst data = await response.json();\nconsole.log(response.status, data);`;
}

export function axiosSnippet(req) {
  const parts = [`  method: ${js(req.method.toLowerCase())}`, `  url: ${js(req.url)}`];
  const hp = headerPairs(req);
  if (hp.length) parts.push(`  headers: {\n${hp.map(([k, v]) => `    ${js(k)}: ${js(v)}`).join(',\n')}\n  }`);
  const b = bodyText(req);
  if (b) {
    let obj = null;
    try { obj = JSON.parse(b); } catch { /* keep raw */ }
    parts.push(`  data: ${obj !== null ? JSON.stringify(obj, null, 2).replace(/\n/g, '\n  ') : js(b)}`);
  }
  return `import axios from "axios";\n\nconst { status, data } = await axios({\n${parts.join(',\n')}\n});\nconsole.log(status, data);`;
}

function pyValue(v, indent = 0) {
  const pad = '    '.repeat(indent + 1);
  const end = '    '.repeat(indent);
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return js(v);
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => pad + pyValue(x, indent + 1)).join(',\n')}\n${end}]` : '[]';
  const entries = Object.entries(v);
  return entries.length ? `{\n${entries.map(([k, x]) => `${pad}${js(k)}: ${pyValue(x, indent + 1)}`).join(',\n')}\n${end}}` : '{}';
}

export function pythonSnippet(req) {
  const lines = ['import requests', ''];
  const hp = headerPairs(req);
  if (hp.length) lines.push(`headers = {\n${hp.map(([k, v]) => `    ${js(k)}: ${js(v)}`).join(',\n')}\n}`);
  const b = bodyText(req);
  let args = `${js(req.url)}`;
  if (hp.length) args += ', headers=headers';
  if (b) {
    let obj;
    try { obj = JSON.parse(b); } catch { obj = undefined; }
    if (obj !== undefined) { lines.push(`payload = ${pyValue(obj)}`); args += ', json=payload'; } else args += `, data=${js(b)}`;
  }
  lines.push(`response = requests.${req.method.toLowerCase()}(${args})`, 'print(response.status_code, response.json())');
  return lines.join('\n');
}

export const SNIPPETS = [
  { id: 'curl', label: 'cURL', build: curlSnippet },
  { id: 'fetch', label: 'fetch', build: fetchSnippet },
  { id: 'axios', label: 'axios', build: axiosSnippet },
  { id: 'python', label: 'Python', build: pythonSnippet },
];

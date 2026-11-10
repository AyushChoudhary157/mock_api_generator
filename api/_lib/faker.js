// Offline, deterministic Faker-style generator.
// Same seed + same schema => byte-identical data. No network, no dependencies.

// ---------- seeded PRNG (mulberry32 + string hash) ----------
export function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function makeRng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashSeed(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (r, min, max) => Math.floor(r() * (max - min + 1)) + min;
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- word lists ----------
const FIRST = ['Olivia', 'Liam', 'Emma', 'Noah', 'Ava', 'Ethan', 'Sophia', 'Mason', 'Isabella', 'Lucas', 'Mia', 'Aarav',
  'Priya', 'Rohan', 'Ananya', 'Vikram', 'Meera', 'Arjun', 'Kavya', 'Rahul', 'Sara', 'Omar', 'Layla', 'Yusuf', 'Chen',
  'Mei', 'Hiro', 'Yuki', 'Carlos', 'Lucia', 'Mateo', 'Valentina', 'Elena', 'Dmitri', 'Anya', 'Kofi', 'Amara', 'Tariq',
  'Fatima', 'Jack', 'Grace', 'Henry', 'Chloe', 'Daniel', 'Zoe', 'Samuel', 'Nora', 'Leo', 'Ruby', 'Felix'];
const LAST = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Patel', 'Sharma', 'Singh',
  'Gupta', 'Kumar', 'Nguyen', 'Kim', 'Lee', 'Wang', 'Tanaka', 'Suzuki', 'Rossi', 'Muller', 'Schmidt', 'Ivanov',
  'Okafor', 'Mensah', 'Hassan', 'Khan', 'Ali', 'Silva', 'Santos', 'Fernandez', 'Lopez', 'Martin', 'Thompson', 'Clark',
  'Walker', 'Young', 'Hall', 'Allen', 'Wright', 'Reddy', 'Iyer', 'Nair', 'Das', 'Bose', 'Ortiz', 'Moreau', 'Novak'];
const CITIES = [['Springfield', 'IL', 'USA'], ['Austin', 'TX', 'USA'], ['Portland', 'OR', 'USA'], ['Denver', 'CO', 'USA'],
  ['Boston', 'MA', 'USA'], ['Seattle', 'WA', 'USA'], ['Toronto', 'ON', 'Canada'], ['Vancouver', 'BC', 'Canada'],
  ['London', 'England', 'UK'], ['Manchester', 'England', 'UK'], ['Bengaluru', 'KA', 'India'], ['Mumbai', 'MH', 'India'],
  ['Hyderabad', 'TS', 'India'], ['Delhi', 'DL', 'India'], ['Sydney', 'NSW', 'Australia'], ['Berlin', 'BE', 'Germany'],
  ['Paris', 'IDF', 'France'], ['Madrid', 'MD', 'Spain'], ['Singapore', 'SG', 'Singapore'], ['Dubai', 'DU', 'UAE']];
const STREETS = ['Maple', 'Oak', 'Pine', 'Cedar', 'Elm', 'Lake', 'Hill', 'Sunset', 'Park', 'River', 'Church', 'Mill',
  'High', 'Station', 'Garden', 'Forest', 'Meadow', 'Willow'];
const STREET_TYPES = ['Street', 'Avenue', 'Road', 'Lane', 'Boulevard', 'Drive', 'Court'];
const COMPANY_A = ['Blue', 'Bright', 'Nova', 'Apex', 'Quantum', 'Vertex', 'Summit', 'Pixel', 'Cloud', 'Terra', 'Zen',
  'Orbit', 'Lumen', 'Atlas', 'Nimbus', 'Delta', 'Helix', 'Prime'];
const COMPANY_B = ['Labs', 'Systems', 'Works', 'Dynamics', 'Solutions', 'Logic', 'Networks', 'Industries', 'Analytics',
  'Robotics', 'Digital', 'Ventures'];
const COMPANY_SUFFIX = ['Inc', 'LLC', 'Ltd', 'Group', 'Co', 'GmbH'];
const LOREM = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore '
  + 'magna aliqua enim minim veniam quis nostrud exercitation ullamco laboris nisi aliquip commodo consequat duis aute '
  + 'irure reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident '
  + 'sunt culpa officia deserunt mollit anim').split(' ');
const EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net', 'mail.example', 'test.example'];

// ---------- primitive generators ----------
export function words(r, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(pick(r, LOREM));
  return out.join(' ');
}
const sentence = (r, n = int(r, 5, 11)) => `${cap(words(r, n))}.`;
const paragraph = (r) => Array.from({ length: int(r, 2, 4) }, () => sentence(r)).join(' ');
const firstName = (r) => pick(r, FIRST);
const lastName = (r) => pick(r, LAST);
const fullName = (r) => `${firstName(r)} ${lastName(r)}`;
const company = (r) => `${pick(r, COMPANY_A)} ${pick(r, COMPANY_B)} ${pick(r, COMPANY_SUFFIX)}`;

function email(r) {
  const f = firstName(r).toLowerCase();
  const l = lastName(r).toLowerCase();
  const sep = pick(r, ['.', '_', '']);
  const num = r() < 0.4 ? int(r, 1, 99) : '';
  return `${f}${sep}${l}${num}@${pick(r, EMAIL_DOMAINS)}`;
}

function phone(r) {
  const a = int(r, 201, 989);
  const b = int(r, 200, 999);
  const c = int(r, 1000, 9999);
  return pick(r, [`+1 (${a}) ${b}-${c}`, `+1-${a}-${b}-${c}`, `+91 ${int(r, 70000, 99999)} ${int(r, 10000, 99999)}`,
    `+44 7${int(r, 100, 999)} ${int(r, 100000, 999999)}`]);
}

function address(r) {
  const [city, state, country] = pick(r, CITIES);
  return `${int(r, 1, 9999)} ${pick(r, STREETS)} ${pick(r, STREET_TYPES)}, ${city}, ${state} ${int(r, 10000, 99999)}, ${country}`;
}

function uuid(r) {
  const hex = (n) => Array.from({ length: n }, () => int(r, 0, 15).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${pick(r, ['8', '9', 'a', 'b'])}${hex(3)}-${hex(12)}`;
}

function isoDate(r, from, to, format) {
  const a = Date.parse(from || '2020-01-01T00:00:00Z');
  const b = Date.parse(to || '2025-12-31T23:59:59Z');
  const lo = Number.isFinite(a) ? a : 1577836800000;
  const hi = Number.isFinite(b) && b >= lo ? b : lo + 86400000;
  const d = new Date(lo + Math.floor(r() * (hi - lo)));
  const s = d.toISOString();
  return format === 'date' ? s.slice(0, 10) : s.replace(/\.\d{3}Z$/, 'Z');
}

// ---------- field generation ----------
/**
 * Generates one value for a field definition.
 * ctx: { refIds: {resource: number[]}, aiValues: {field: string[]}, index, count }
 */
export function genValue(field, r, ctx = {}, top = false) {
  if (top && ctx.aiValues?.[field.name]?.length) {
    const list = ctx.aiValues[field.name];
    return list[(ctx.index ?? 0) % list.length];
  }
  switch (field.type) {
    case 'id': return undefined; // assigned by the database
    case 'string': return cap(words(r, clamp(field.words ?? 3, 1, 12)));
    case 'text': return paragraph(r);
    case 'int': {
      const min = Number.isFinite(field.min) ? field.min : 1;
      const max = Number.isFinite(field.max) ? field.max : 1000;
      return int(r, Math.min(min, max), Math.max(min, max));
    }
    case 'float': {
      const min = Number.isFinite(field.min) ? field.min : 0;
      const max = Number.isFinite(field.max) ? field.max : 1000;
      const dec = clamp(field.decimals ?? 2, 0, 6);
      return Number((min + r() * (max - min)).toFixed(dec));
    }
    case 'boolean': return r() < 0.5;
    case 'date': return isoDate(r, field.from, field.to, field.format);
    case 'email': return email(r);
    case 'name': return fullName(r);
    case 'phone': return phone(r);
    case 'address': return address(r);
    case 'avatar': return `https://i.pravatar.cc/150?img=${int(r, 1, 70)}`;
    case 'uuid': return uuid(r);
    case 'url': return `https://www.${pick(r, COMPANY_A).toLowerCase()}${pick(r, COMPANY_B).toLowerCase()}.com/${pick(r, LOREM)}`;
    case 'company': return company(r);
    case 'enum': return field.values?.length ? pick(r, field.values) : null;
    case 'object': {
      const out = {};
      for (const f of field.fields || []) out[f.name] = genValue(f, r, ctx);
      return out;
    }
    case 'array': {
      const min = clamp(field.min ?? 1, 0, 10);
      const max = clamp(field.max ?? 3, min, 10);
      const n = int(r, min, max);
      const of = field.of || { type: 'string' };
      return Array.from({ length: n }, () => genValue(of, r, ctx));
    }
    case 'ref': {
      const ids = ctx.refIds?.[field.ref];
      return ids?.length ? pick(r, ids) : int(r, 1, Math.max(1, ctx.count || 10));
    }
    default: return null;
  }
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

/** Generates `count` record bodies (without ids). */
export function generateRecords(fields, count, { seed = 'seed', refIds = {}, aiValues = {} } = {}) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const r = makeRng(`${seed}:${i}`);
    const rec = {};
    for (const f of fields) {
      if (f.type === 'id') continue;
      rec[f.name] = genValue(f, r, { refIds, aiValues, index: i, count }, true);
    }
    out.push(rec);
  }
  return out;
}

/** Re-orders keys of a stored (JSONB sorts keys) record to match the schema order. */
export function orderRecord(fields, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const out = {};
  for (const f of fields) {
    if (!(f.name in data)) continue;
    const v = data[f.name];
    out[f.name] = f.type === 'object' && f.fields ? orderRecord(f.fields, v) : v;
  }
  for (const k of Object.keys(data)) if (!(k in out)) out[k] = data[k];
  return out;
}

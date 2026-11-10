// Fixed-window counters in Postgres. One round-trip increments several counters at once.
import { query } from './db.js';

/**
 * @param {{key:string, windowSec:number}[]} items
 * @returns {Promise<{count:number, resetSec:number}[]>}
 */
export async function hitMany(items) {
  const now = Date.now();
  const params = [];
  const ctes = [];
  const resets = items.map((it, i) => {
    const w = it.windowSec * 1000;
    const start = Math.floor(now / w) * w;
    params.push(it.key, new Date(start).toISOString());
    ctes.push(`a${i} AS (INSERT INTO rate_limit_counters AS c (key, window_start, count)
      VALUES ($${i * 2 + 1}::text, $${i * 2 + 2}::timestamptz, 1)
      ON CONFLICT (key, window_start) DO UPDATE SET count = c.count + 1 RETURNING count)`);
    return Math.max(1, Math.ceil((start + w - now) / 1000));
  });
  const select = items.map((_, i) => `(SELECT count FROM a${i})::int AS c${i}`).join(', ');
  const rows = await query(`WITH ${ctes.join(', ')} SELECT ${select}`, params);
  return items.map((_, i) => ({ count: rows[0][`c${i}`], resetSec: resets[i] }));
}

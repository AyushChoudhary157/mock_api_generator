// Database access. Production: Neon serverless (HTTP for single statements, pooled WebSocket
// connections for transactions). Local dev: optional embedded Postgres (PGlite) via LOCAL_DB=pglite.
import { config } from './env.js';

let httpSql;
let pool;
let local;

async function getLocal() {
  if (!local) {
    const { PGlite } = await import('@electric-sql/pglite');
    local = new PGlite(process.env.PGLITE_DIR || './.data/pglite');
    await local.waitReady;
  }
  return local;
}

function requireUrl() {
  if (!config.dbUrl) throw new Error('NEON_DATABASE_URL is not set');
  return config.dbUrl;
}

async function getPool() {
  if (!pool) {
    const { Pool, neonConfig } = await import('@neondatabase/serverless');
    if (typeof WebSocket === 'undefined') neonConfig.webSocketConstructor = (await import('ws')).default;
    pool = new Pool({ connectionString: requireUrl() });
  }
  return pool;
}

/** Run one parameterised statement; resolves to an array of row objects. */
export async function query(text, params = []) {
  if (config.localDb === 'pglite') {
    const db = await getLocal();
    return (await db.query(text, params)).rows;
  }
  if (!httpSql) {
    const { neon } = await import('@neondatabase/serverless');
    httpSql = neon(requireUrl());
  }
  return httpSql.query(text, params);
}

/** Run several statements atomically. `fn` receives a `q(text, params)` helper. */
export async function tx(fn) {
  if (config.localDb === 'pglite') {
    const db = await getLocal();
    return db.transaction((t) => fn(async (text, params = []) => (await t.query(text, params)).rows));
  }
  const client = await (await getPool()).connect();
  try {
    await client.query('BEGIN');
    const out = await fn(async (text, params = []) => (await client.query(text, params)).rows);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Execute a multi-statement SQL script (used by migrations only). */
export async function exec(script) {
  if (config.localDb === 'pglite') return void (await (await getLocal()).exec(script));
  const client = await (await getPool()).connect();
  try { await client.query(script); } finally { client.release(); }
}

export async function closeDb() {
  if (pool) await pool.end();
  if (local) await local.close();
}

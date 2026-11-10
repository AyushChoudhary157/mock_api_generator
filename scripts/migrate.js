// Applies SQL files in /migrations in order, once each.
//   npm run migrate            (Neon, uses NEON_DATABASE_URL)
//   npm run migrate:local      (embedded PGlite)
import './_env.js';
import { runMigrations } from './lib-migrate.js';
import { closeDb } from '../api/_lib/db.js';

await runMigrations();
await closeDb();
console.log('migrations up to date');

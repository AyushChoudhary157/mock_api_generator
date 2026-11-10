// Anonymous ownership: the browser keeps a random management token in localStorage. We only
// ever store its SHA-256 hash, so a database leak does not leak working tokens.
import { createHash, randomBytes } from 'node:crypto';
import { ApiError } from './http.js';
import { query } from './db.js';

const TOKEN_RE = /^mat_[a-f0-9]{48}$/;

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function newToken() { return `mat_${randomBytes(24).toString('hex')}`; }

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function newId(len = 10, prefix = '') {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return prefix + out;
}

/** Returns the owner hash for the request or throws 401. */
export function ownerFromReq(req) {
  const token = String(req.headers['x-owner-token'] || '').trim();
  if (!TOKEN_RE.test(token)) {
    throw new ApiError(401, 'unauthorized', 'Missing or invalid management token (X-Owner-Token).');
  }
  return sha256(token);
}

/** Loads a project the caller owns. Unknown and foreign projects both look like 404. */
export async function getOwnedProject(ownerHash, projectId) {
  const rows = await query('SELECT * FROM projects WHERE id = $1 AND owner_hash = $2', [projectId, ownerHash]);
  if (!rows[0]) throw new ApiError(404, 'project_not_found', 'Project not found.');
  return rows[0];
}

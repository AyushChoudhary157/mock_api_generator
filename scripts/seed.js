// Creates a demo project (users -> posts, products) and prints its URLs + management token.
// Usage: npm run seed   (or npm run seed:local)
import './_env.js';
import { newToken, sha256 } from '../api/_lib/auth.js';
import { createProject, applySchema } from '../api/_lib/service.js';
import { closeDb } from '../api/_lib/db.js';

const token = newToken();
const project = await createProject(sha256(token), 'Demo Shop');

await applySchema(project, [
  { name: 'users', count: 10, fields: [
    { name: 'id', type: 'id' }, { name: 'name', type: 'name' }, { name: 'email', type: 'email' },
    { name: 'phone', type: 'phone' }, { name: 'avatar', type: 'avatar' },
    { name: 'role', type: 'enum', values: ['admin', 'editor', 'viewer'] },
    { name: 'address', type: 'object', fields: [{ name: 'city', type: 'string', words: 1 }, { name: 'full', type: 'address' }] },
    { name: 'createdAt', type: 'date' },
  ] },
  { name: 'products', count: 20, fields: [
    { name: 'id', type: 'id' }, { name: 'title', type: 'string', words: 3 },
    { name: 'price', type: 'float', min: 5, max: 500, decimals: 2 }, { name: 'inStock', type: 'boolean' },
    { name: 'tags', type: 'array', of: { type: 'string', words: 1 }, min: 1, max: 4 },
  ] },
  { name: 'posts', count: 25, fields: [
    { name: 'id', type: 'id' }, { name: 'userId', type: 'ref', ref: 'users' },
    { name: 'title', type: 'string', words: 5 }, { name: 'body', type: 'text' },
  ] },
]);

console.log('Seeded demo project');
console.log(`  base URL : /api/v1/${project.id}`);
console.log(`  try      : /api/v1/${project.id}/users?limit=5`);
console.log(`  relation : /api/v1/${project.id}/users/1/posts`);
console.log(`  token    : ${token}   (paste into the UI under "Restore access")`);
await closeDb();

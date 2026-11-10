// One-click starting points for the schema builder.
export function presets(existingNames = []) {
  const hasUsers = existingNames.includes('users');
  return [
    { id: 'users', label: 'Users', name: 'users', fields: [
      { name: 'id', type: 'id' }, { name: 'name', type: 'name' }, { name: 'email', type: 'email' }, { name: 'phone', type: 'phone' },
      { name: 'avatar', type: 'avatar' }, { name: 'role', type: 'enum', values: ['admin', 'editor', 'viewer'] },
      { name: 'address', type: 'address' }, { name: 'createdAt', type: 'date' }] },
    { id: 'products', label: 'Products', name: 'products', fields: [
      { name: 'id', type: 'id' }, { name: 'title', type: 'string', words: 3 }, { name: 'description', type: 'text' },
      { name: 'price', type: 'float', min: 5, max: 500, decimals: 2 }, { name: 'category', type: 'enum', values: ['electronics', 'books', 'clothing', 'home'] },
      { name: 'inStock', type: 'boolean' }, { name: 'tags', type: 'array', of: { type: 'string', words: 1 }, min: 1, max: 4 }] },
    { id: 'posts', label: hasUsers ? 'Posts (linked to users)' : 'Posts', name: 'posts', fields: [
      { name: 'id', type: 'id' }, hasUsers ? { name: 'userId', type: 'ref', ref: 'users' } : { name: 'userId', type: 'int', min: 1, max: 10 },
      { name: 'title', type: 'string', words: 5 }, { name: 'body', type: 'text' }, { name: 'publishedAt', type: 'date' }] },
    { id: 'todos', label: 'Todos', name: 'todos', fields: [
      { name: 'id', type: 'id' }, { name: 'title', type: 'string', words: 4 }, { name: 'completed', type: 'boolean' },
      { name: 'priority', type: 'enum', values: ['low', 'medium', 'high'] }, { name: 'dueDate', type: 'date', format: 'date' }] },
    { id: 'blank', label: 'Blank', name: '', fields: [{ name: 'id', type: 'id' }, { name: 'name', type: 'string', words: 2 }] },
  ];
}

export const AI_EXAMPLES = [
  'E-commerce with users, products and orders',
  'Hospital with patients, doctors and appointments',
  'Banking app with customers, accounts and transactions',
  'Blog with authors, posts and comments',
];

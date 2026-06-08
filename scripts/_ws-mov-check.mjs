import mysql from 'mysql2/promise';

const pid = '7b5c23a2-a38b-479a-9553-3fda49c5d5e7';
const conn = await mysql.createConnection({
  host: '127.0.0.1',
  port: 3306,
  user: 'flowgen',
  password: 'FlowgenDb@2026',
  database: 'flowgen',
});
const [users] = await conn.query(
  'SELECT user_id, version, LENGTH(payload) len FROM flowgen_workspace_slices WHERE project_id=?',
  [pid]
);
console.log('slices', users);
for (const u of users) {
  const [r] = await conn.query(
    'SELECT payload FROM flowgen_workspace_slices WHERE project_id=? AND user_id=?',
    [pid, u.user_id]
  );
  const p = typeof r[0].payload === 'string' ? JSON.parse(r[0].payload) : r[0].payload;
  const nodes = p?.graph?.nodes || [];
  const movs = nodes.filter((n) => n.type === 'movNode');
  const empty = movs.filter((n) => !String(n.data?.imagePreview || '').trim());
  console.log('user', u.user_id.slice(0, 8), 'nodes', nodes.length, 'movs', movs.length, 'emptyMov', empty.length);
  if (movs[0]) {
    console.log('sample', movs[0].id, (movs[0].data?.imagePreview || '').slice(0, 90));
  }
}
const [cov] = await conn.query('SELECT cover_image FROM flowgen_projects WHERE id=?', [pid]);
console.log('cover', cov[0]?.cover_image);
await conn.end();

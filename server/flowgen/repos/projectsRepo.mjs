import { getPool } from '../db.mjs';
import { parseJsonCol, stringifyJsonCol, toSqlDatetime } from './jsonCol.mjs';

function rowToProject(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status || 'active',
    coverImage: row.cover_image || null,
    extendedJson: parseJsonCol(row.extended_json, {}) || {},
    createdBy: row.created_by,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export async function listAllProjects() {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM flowgen_projects ORDER BY created_at ASC');
  return rows.map(rowToProject);
}

export async function findProjectById(id) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM flowgen_projects WHERE id = ? LIMIT 1', [id]);
  return rows[0] ? rowToProject(rows[0]) : null;
}

export async function syncAllProjects(projects) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query('SELECT id FROM flowgen_projects');
    const keep = new Set(projects.map((p) => p.id));
    for (const row of existing) {
      if (!keep.has(row.id)) await conn.query('DELETE FROM flowgen_projects WHERE id = ?', [row.id]);
    }
    for (const p of projects) {
      let cover = p.coverImage || null;
      if (typeof cover === 'string' && (cover.startsWith('data:') || cover.startsWith('blob:'))) cover = null;
      if (typeof cover === 'string' && cover.startsWith('flowgen-local:')) cover = null;
      await conn.query(
        `INSERT INTO flowgen_projects
          (id, name, status, cover_image, extended_json, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          status = VALUES(status),
          cover_image = VALUES(cover_image),
          extended_json = VALUES(extended_json),
          updated_at = VALUES(updated_at)`,
        [
          p.id,
          p.name,
          p.status || 'active',
          cover,
          stringifyJsonCol(p.extendedJson || {}),
          p.createdBy,
          toSqlDatetime(p.createdAt),
          toSqlDatetime(p.updatedAt),
        ]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function deleteProjectById(projectId) {
  const pool = getPool();
  await pool.query('DELETE FROM flowgen_projects WHERE id = ?', [projectId]);
}

export async function updateProjectCoverImage(projectId, coverImage) {
  const pool = getPool();
  const now = new Date().toISOString().slice(0, 23).replace('T', ' ');
  await pool.query('UPDATE flowgen_projects SET cover_image = ?, updated_at = ? WHERE id = ?', [
    coverImage,
    now,
    projectId,
  ]);
}

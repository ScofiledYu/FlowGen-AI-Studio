import { getPool } from '../db.mjs';

function rowToMember(row) {
  return {
    projectId: row.project_id,
    userId: row.user_id,
    role: row.role,
  };
}

export async function listAllMembers() {
  const pool = getPool();
  const [rows] = await pool.query('SELECT project_id, user_id, role FROM flowgen_members');
  return rows.map(rowToMember);
}

export async function syncAllMembers(members) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM flowgen_members');
    for (const m of members) {
      await conn.query(
        'INSERT INTO flowgen_members (project_id, user_id, role) VALUES (?, ?, ?)',
        [m.projectId, m.userId, m.role]
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

export async function deleteMembersByProjectId(projectId) {
  const pool = getPool();
  await pool.query('DELETE FROM flowgen_members WHERE project_id = ?', [projectId]);
}

export async function deleteMembersByUserId(userId) {
  const pool = getPool();
  await pool.query('DELETE FROM flowgen_members WHERE user_id = ?', [userId]);
}

import { getPool } from '../db.mjs';
import { parseJsonCol, stringifyJsonCol } from './jsonCol.mjs';

export async function getFieldDefinitions() {
  const pool = getPool();
  const [rows] = await pool.query('SELECT scope, payload FROM flowgen_field_definitions');
  const out = { user: [], project: [] };
  for (const row of rows) {
    const payload = parseJsonCol(row.payload, []);
    if (row.scope === 'user') out.user = Array.isArray(payload) ? payload : [];
    if (row.scope === 'project') out.project = Array.isArray(payload) ? payload : [];
  }
  return out;
}

export async function setFieldDefinitions(fieldDefinitions) {
  const pool = getPool();
  const now = new Date().toISOString().slice(0, 23).replace('T', ' ');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const scope of ['user', 'project']) {
      const payload = fieldDefinitions?.[scope] || [];
      await conn.query(
        `INSERT INTO flowgen_field_definitions (scope, payload, updated_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = VALUES(updated_at)`,
        [scope, stringifyJsonCol(payload), now]
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

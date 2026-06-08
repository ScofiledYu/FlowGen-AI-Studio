import { getPool } from '../db.mjs';
import { parseJsonCol, stringifyJsonCol, toSqlDatetime } from './jsonCol.mjs';

function rowToUser(row) {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status || 'active',
    extendedJson: parseJsonCol(row.extended_json, {}) || {},
    mustChangePassword: !!row.must_change_password,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export async function listAllUsers() {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM flowgen_users ORDER BY created_at ASC');
  return rows.map(rowToUser);
}

export async function findUserById(id) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM flowgen_users WHERE id = ? LIMIT 1', [id]);
  return rows[0] ? rowToUser(rows[0]) : null;
}

export async function findUserByUsername(username) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM flowgen_users WHERE username = ? LIMIT 1', [
    String(username),
  ]);
  return rows[0] ? rowToUser(rows[0]) : null;
}

export async function insertUser(user) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO flowgen_users
      (id, username, password_hash, role, status, extended_json, must_change_password, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user.id,
      user.username,
      user.passwordHash,
      user.role,
      user.status || 'active',
      stringifyJsonCol(user.extendedJson || {}),
      user.mustChangePassword ? 1 : 0,
      toSqlDatetime(user.createdAt),
      toSqlDatetime(user.updatedAt),
    ]
  );
}

export async function updateUser(user) {
  const pool = getPool();
  await pool.query(
    `UPDATE flowgen_users SET
      username = ?, password_hash = ?, role = ?, status = ?, extended_json = ?,
      must_change_password = ?, updated_at = ?
     WHERE id = ?`,
    [
      user.username,
      user.passwordHash,
      user.role,
      user.status || 'active',
      stringifyJsonCol(user.extendedJson || {}),
      user.mustChangePassword ? 1 : 0,
      toSqlDatetime(user.updatedAt),
      user.id,
    ]
  );
}

export async function deleteUserById(id) {
  const pool = getPool();
  await pool.query('DELETE FROM flowgen_users WHERE id = ?', [id]);
}

/** Replace all users (metadata sync after in-memory admin edits) */
export async function syncAllUsers(users) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query('SELECT id FROM flowgen_users');
    const keep = new Set(users.map((u) => u.id));
    for (const row of existing) {
      if (!keep.has(row.id)) await conn.query('DELETE FROM flowgen_users WHERE id = ?', [row.id]);
    }
    for (const user of users) {
      await conn.query(
        `INSERT INTO flowgen_users
          (id, username, password_hash, role, status, extended_json, must_change_password, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          username = VALUES(username),
          password_hash = VALUES(password_hash),
          role = VALUES(role),
          status = VALUES(status),
          extended_json = VALUES(extended_json),
          must_change_password = VALUES(must_change_password),
          updated_at = VALUES(updated_at)`,
        [
          user.id,
          user.username,
          user.passwordHash,
          user.role,
          user.status || 'active',
          stringifyJsonCol(user.extendedJson || {}),
          user.mustChangePassword ? 1 : 0,
          toSqlDatetime(user.createdAt),
          toSqlDatetime(user.updatedAt),
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

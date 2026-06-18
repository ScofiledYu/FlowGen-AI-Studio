import { getPool } from '../db.mjs';
import { toSqlDatetime } from './jsonCol.mjs';

function rowToAsset(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    category: row.category || 'OTHER',
    episode: row.episode || '',
    sequence: row.sequence || '',
    mime: row.mime,
    fileName: row.file_name,
    createdBy: row.created_by,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export async function listAllAssets() {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM flowgen_assets ORDER BY created_at ASC');
  return rows.map(rowToAsset);
}

export async function findAssetById(id) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM flowgen_assets WHERE id = ? LIMIT 1', [id]);
  return rows[0] ? rowToAsset(rows[0]) : null;
}

export async function insertAsset(asset) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO flowgen_assets
      (id, project_id, name, category, episode, sequence, mime, file_name, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      asset.id,
      asset.projectId,
      asset.name,
      asset.category || 'OTHER',
      asset.episode || null,
      asset.sequence || null,
      asset.mime,
      asset.fileName,
      asset.createdBy || null,
      toSqlDatetime(asset.createdAt),
      toSqlDatetime(asset.updatedAt),
    ]
  );
}

export async function updateAsset(asset) {
  const pool = getPool();
  await pool.query(
    `UPDATE flowgen_assets SET
      name = ?, category = ?, episode = ?, sequence = ?, mime = ?, file_name = ?, updated_at = ?
     WHERE id = ?`,
    [
      asset.name,
      asset.category || 'OTHER',
      asset.episode || null,
      asset.sequence || null,
      asset.mime,
      asset.fileName,
      toSqlDatetime(asset.updatedAt),
      asset.id,
    ]
  );
}

export async function deleteAssetById(id) {
  const pool = getPool();
  await pool.query('DELETE FROM flowgen_assets WHERE id = ?', [id]);
}

export async function deleteAssetsByProjectId(projectId) {
  const pool = getPool();
  await pool.query('DELETE FROM flowgen_assets WHERE project_id = ?', [projectId]);
}

export async function syncAllAssets(assets) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query('SELECT id FROM flowgen_assets');
    const keep = new Set(assets.map((a) => a.id));
    for (const row of existing) {
      if (!keep.has(row.id)) await conn.query('DELETE FROM flowgen_assets WHERE id = ?', [row.id]);
    }
    for (const a of assets) {
      await conn.query(
        `INSERT INTO flowgen_assets
          (id, project_id, name, category, episode, sequence, mime, file_name, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          category = VALUES(category),
          episode = VALUES(episode),
          sequence = VALUES(sequence),
          mime = VALUES(mime),
          file_name = VALUES(file_name),
          updated_at = VALUES(updated_at)`,
        [
          a.id,
          a.projectId,
          a.name,
          a.category || 'OTHER',
          a.episode || null,
          a.sequence || null,
          a.mime,
          a.fileName,
          a.createdBy || null,
          toSqlDatetime(a.createdAt),
          toSqlDatetime(a.updatedAt),
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

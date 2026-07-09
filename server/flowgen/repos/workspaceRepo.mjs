import { getPool, isMysqlConnectionError, resetPool } from '../db.mjs';
import { parseJsonCol, stringifyJsonCol } from './jsonCol.mjs';
import {
  encodeWorkspacePayloadForDb,
  decodeWorkspacePayloadFromDb,
} from '../workspacePayloadCodec.mjs';
import {
  graphNodeCountFromPayload,
  resolveUserWorkspaceSliceView,
  shouldRejectEmptyWorkspaceOverwrite,
} from '../workspaceSliceView.mjs';

/**
 * @param {string} projectId
 * @param {string} userId
 */
export async function getUserWorkspaceView(projectId, userId) {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT user_id, version, payload, updated_at FROM flowgen_workspace_slices WHERE project_id = ?',
    [projectId]
  );
  if (!rows.length) return { version: 0, payload: null };

  const slices = await Promise.all(
    rows.map(async (row) => ({
      userId: String(row.user_id),
      version: Number(row.version) || 0,
      payload: await decodeWorkspacePayloadFromDb(parseJsonCol(row.payload, null)),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    }))
  );
  return resolveUserWorkspaceSliceView(slices, userId);
}

/**
 * @param {string} projectId
 * @param {string} userId
 * @param {{ payload: unknown; version?: number; allowEmptyGraph?: boolean }} body
 */
export async function putUserWorkspaceSlice(projectId, userId, body) {
  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await putUserWorkspaceSliceOnce(projectId, userId, body);
    } catch (e) {
      lastErr = e;
      if (!isMysqlConnectionError(e) || attempt >= maxAttempts) throw e;
      await resetPool();
      await new Promise((r) => setTimeout(r, 150 * attempt));
    }
  }
  throw lastErr;
}

async function putUserWorkspaceSliceOnce(projectId, userId, body) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      'SELECT version, payload FROM flowgen_workspace_slices WHERE project_id = ? AND user_id = ? FOR UPDATE',
      [projectId, userId]
    );
    const prevVersion = rows.length ? Number(rows[0].version) || 0 : 0;
    const prevPayloadRaw = rows.length ? parseJsonCol(rows[0].payload, null) : null;
    const prevPayload = await decodeWorkspacePayloadFromDb(prevPayloadRaw);
    const clientVersion = body.version;
    if (clientVersion !== undefined && clientVersion !== prevVersion) {
      const err = new Error('版本冲突');
      err.code = 'VERSION_CONFLICT';
      err.serverVersion = prevVersion;
      throw err;
    }
    if (
      shouldRejectEmptyWorkspaceOverwrite(prevPayload, body.payload ?? null, {
        allowEmptyGraph: !!body.allowEmptyGraph,
      })
    ) {
      const err = new Error('拒绝用空画布覆盖非空工程');
      err.code = 'EMPTY_GRAPH_REJECTED';
      err.serverNodeCount = graphNodeCountFromPayload(prevPayload);
      throw err;
    }
    const nextVersion = prevVersion + 1;
    const now = new Date().toISOString().slice(0, 23).replace('T', ' ');
    const { stored, storedBytes, uncompressedBytes } = await encodeWorkspacePayloadForDb(
      body.payload ?? null
    );
    const payloadStr = stringifyJsonCol(stored);
    await conn.query(
      `INSERT INTO flowgen_workspace_slices
        (project_id, user_id, version, payload, payload_bytes, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        version = VALUES(version),
        payload = VALUES(payload),
        payload_bytes = VALUES(payload_bytes),
        updated_at = VALUES(updated_at),
        updated_by = VALUES(updated_by)`,
      [projectId, userId, nextVersion, payloadStr, uncompressedBytes, now, userId]
    );
    await conn.commit();
    return {
      version: nextVersion,
      payload: body.payload ?? null,
      updatedAt: now,
    };
  } catch (e) {
    try {
      await conn.rollback();
    } catch {
      /* 连接已断开时 rollback 会失败，勿因此拖垮进程 */
    }
    throw e;
  } finally {
    try {
      conn.release();
    } catch {
      /* ignore */
    }
  }
}

export async function deleteSlicesByProjectId(projectId) {
  const pool = getPool();
  await pool.query('DELETE FROM flowgen_workspace_slices WHERE project_id = ?', [projectId]);
}

export async function bulkImportSlice(projectId, userId, slice) {
  const pool = getPool();
  const version = typeof slice.version === 'number' ? slice.version : 0;
  const now =
    typeof slice.updatedAt === 'string'
      ? slice.updatedAt.slice(0, 23).replace('T', ' ')
      : new Date().toISOString().slice(0, 23).replace('T', ' ');
  const { stored, uncompressedBytes } = await encodeWorkspacePayloadForDb(slice.payload ?? null);
  const storedStr = stringifyJsonCol(stored);
  await pool.query(
    `INSERT INTO flowgen_workspace_slices
      (project_id, user_id, version, payload, payload_bytes, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      version = VALUES(version),
      payload = VALUES(payload),
      payload_bytes = VALUES(payload_bytes),
      updated_at = VALUES(updated_at),
      updated_by = VALUES(updated_by)`,
    [projectId, userId, version, storedStr, uncompressedBytes, now, slice.updatedBy || userId]
  );
}

/** Import slices from snapshot store.workspaces */
export async function importWorkspaceSlicesFromSnapshot(workspaces) {
  if (!workspaces || typeof workspaces !== 'object') return 0;
  let count = 0;
  for (const [projectId, ws] of Object.entries(workspaces)) {
    if (!ws || typeof ws !== 'object') continue;
    if (ws.v === 2 && ws.byUser && typeof ws.byUser === 'object') {
      for (const [userId, slice] of Object.entries(ws.byUser)) {
        if (!slice || typeof slice !== 'object') continue;
        await bulkImportSlice(projectId, userId, slice);
        count += 1;
      }
      continue;
    }
    const legacyPayload = ws.payload ?? null;
    const legacyBy = ws.updatedBy ? String(ws.updatedBy) : null;
    if (legacyPayload != null && legacyBy) {
      await bulkImportSlice(projectId, legacyBy, {
        version: ws.version,
        payload: legacyPayload,
        updatedAt: ws.updatedAt,
        updatedBy: legacyBy,
      });
      count += 1;
    }
  }
  return count;
}

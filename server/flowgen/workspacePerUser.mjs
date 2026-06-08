/**
 * 工程 workspace 按用户隔离：store.workspaces[projectId] 为 v2 信封，内含 byUser[userId]。
 */
import {
  resolveUserWorkspaceSliceView,
  shouldRejectEmptyWorkspaceOverwrite,
} from './workspaceSliceView.mjs';

/** @typedef {{ version: number; payload: unknown; updatedAt?: string; updatedBy?: string | null }} UserWorkspaceSlice */

/**
 * @param {unknown} ws
 * @returns {boolean}
 */
export function isPerUserWorkspaceEnvelope(ws) {
  return !!(ws && typeof ws === 'object' && ws.v === 2 && ws.byUser && typeof ws.byUser === 'object');
}

/**
 * @param {Record<string, unknown>} store
 * @param {string} projectId
 */
export function ensureWorkspaceEnvelope(store, projectId) {
  let ws = store.workspaces[projectId];
  if (isPerUserWorkspaceEnvelope(ws)) return ws;

  const legacyPayload = ws && typeof ws === 'object' ? ws.payload ?? null : null;
  const legacyVersion = ws && typeof ws === 'object' && typeof ws.version === 'number' ? ws.version : 0;
  const legacyUpdatedAt =
    ws && typeof ws === 'object' && typeof ws.updatedAt === 'string' ? ws.updatedAt : new Date().toISOString();
  const legacyUpdatedBy =
    ws && typeof ws === 'object' && ws.updatedBy ? String(ws.updatedBy) : null;

  /** @type {Record<string, UserWorkspaceSlice>} */
  const byUser = {};
  if (legacyPayload != null && legacyUpdatedBy) {
    byUser[legacyUpdatedBy] = {
      version: legacyVersion,
      payload: legacyPayload,
      updatedAt: legacyUpdatedAt,
      updatedBy: legacyUpdatedBy,
    };
  }

  const next = {
    v: 2,
    byUser,
    ...(legacyPayload != null && !legacyUpdatedBy
      ? { _legacyPayload: legacyPayload, _legacyVersion: legacyVersion, _legacyUpdatedAt: legacyUpdatedAt }
      : {}),
  };
  store.workspaces[projectId] = next;
  return next;
}

/**
 * @param {ReturnType<typeof ensureWorkspaceEnvelope>} envelope
 * @param {string} userId
 * @returns {{ version: number; payload: unknown; updatedAt?: string }}
 */
export function getUserWorkspaceView(envelope, userId) {
  const uid = String(userId || '');
  let slice = envelope.byUser[uid];
  if (!slice && envelope._legacyPayload != null) {
    slice = {
      version: typeof envelope._legacyVersion === 'number' ? envelope._legacyVersion : 0,
      payload: envelope._legacyPayload,
      updatedAt:
        typeof envelope._legacyUpdatedAt === 'string' ? envelope._legacyUpdatedAt : new Date().toISOString(),
      updatedBy: uid,
    };
    envelope.byUser[uid] = slice;
    delete envelope._legacyPayload;
    delete envelope._legacyVersion;
    delete envelope._legacyUpdatedAt;
  }

  const slices = Object.entries(envelope.byUser || {})
    .map(([sliceUserId, s]) => {
      if (!s || typeof s !== 'object') return null;
      return {
        userId: sliceUserId,
        version: typeof s.version === 'number' ? s.version : 0,
        payload: s.payload ?? null,
        updatedAt: s.updatedAt,
      };
    })
    .filter(Boolean);

  if (slice) {
    const hasMine = slices.some((s) => s.userId === uid);
    if (!hasMine) {
      slices.push({
        userId: uid,
        version: typeof slice.version === 'number' ? slice.version : 0,
        payload: slice.payload ?? null,
        updatedAt: slice.updatedAt,
      });
    }
  }

  return resolveUserWorkspaceSliceView(slices, userId);
}

/**
 * @param {Record<string, unknown>} store
 * @param {string} projectId
 * @param {string} userId
 * @param {{ payload: unknown; version?: number; allowEmptyGraph?: boolean }} body
 * @returns {{ version: number; payload: unknown; updatedAt: string }}
 */
export function putUserWorkspaceSlice(store, projectId, userId, body) {
  const envelope = ensureWorkspaceEnvelope(store, projectId);
  const uid = String(userId || '');
  const prev = envelope.byUser[uid] || { version: 0, payload: null };
  const clientVersion = body.version;
  const prevVersion = typeof prev.version === 'number' ? prev.version : 0;
  if (clientVersion !== undefined && clientVersion !== prevVersion) {
    const err = new Error('版本冲突');
    err.code = 'VERSION_CONFLICT';
    err.serverVersion = prevVersion;
    throw err;
  }
  if (
    shouldRejectEmptyWorkspaceOverwrite(prev.payload ?? null, body.payload ?? null, {
      allowEmptyGraph: !!body.allowEmptyGraph,
    })
  ) {
    const err = new Error('拒绝用空画布覆盖非空工程');
    err.code = 'EMPTY_GRAPH_REJECTED';
    throw err;
  }
  const nextVersion = prevVersion + 1;
  const now = new Date().toISOString();
  const nextSlice = {
    version: nextVersion,
    payload: body.payload ?? null,
    updatedAt: now,
    updatedBy: uid,
  };
  envelope.byUser[uid] = nextSlice;
  if (envelope._legacyPayload != null) {
    delete envelope._legacyPayload;
    delete envelope._legacyVersion;
    delete envelope._legacyUpdatedAt;
  }
  return {
    version: nextSlice.version,
    payload: nextSlice.payload,
    updatedAt: nextSlice.updatedAt,
  };
}

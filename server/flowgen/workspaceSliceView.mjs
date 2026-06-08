/**
 * 工作区 slice 读取策略（relational / JSON 信封共用）。
 * 规则：当前用户已有 slice 时，payload 与 version 必须同源，禁止混用他人旧图 + 自己的 version。
 */

/** @param {unknown} payload */
export function graphNodeCountFromPayload(payload) {
  const nodes = payload && typeof payload === 'object' ? payload.graph?.nodes : null;
  return Array.isArray(nodes) ? nodes.length : 0;
}

/**
 * 防止误用空画布覆盖已有节点（如 SPA 离开页面后延迟保存读到空 getNodes）。
 * @param {unknown} prevPayload
 * @param {unknown} nextPayload
 * @param {{ allowEmptyGraph?: boolean }} [opts]
 */
export function shouldRejectEmptyWorkspaceOverwrite(prevPayload, nextPayload, opts = {}) {
  if (opts.allowEmptyGraph) return false;
  const prev = graphNodeCountFromPayload(prevPayload);
  const next = graphNodeCountFromPayload(nextPayload);
  return prev > 0 && next === 0;
}

/**
 * @param {Array<{ userId: string; version?: number; payload?: unknown; updatedAt?: string }>} slices
 * @param {string} userId
 * @returns {{ version: number; payload: unknown; updatedAt?: string }}
 */
export function resolveUserWorkspaceSliceView(slices, userId) {
  const uid = String(userId || '');
  const mine = slices.find((s) => String(s.userId) === uid);
  if (mine) {
    return {
      version: typeof mine.version === 'number' ? mine.version : Number(mine.version) || 0,
      payload: mine.payload ?? null,
      updatedAt: mine.updatedAt,
    };
  }
  // 严格隔离：当前用户没有自己的 slice 时，不回退到他人数据。
  return { version: 0, payload: null };
}

/**
 * AITOP100 服务端 API 客户端（项目列表等）。
 * @see https://docs.qingque.cn/d/home/eZQA2UGOKwvFp1-_Np_AoD-tJ
 */

const DEFAULT_BASE_URL = 'https://aitop100-api.hytch.com';

export function getAitopBaseUrl() {
  return (process.env.AITOP_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

export function getAitopApiKey() {
  return (
    process.env.AITOP_API_KEY ||
    process.env.AITOP_API_KEY_FALLBACK ||
    'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma'
  );
}

function buildHeaders(domainAccount) {
  const headers = {
    'api-key': getAitopApiKey(),
    'Content-Type': 'application/json',
  };
  const da = String(domainAccount || '').trim();
  if (da) headers['domain-account'] = da;
  return headers;
}

/**
 * @param {string} domainAccount 登录用户名（域账号）
 * @returns {Promise<{ success: boolean; data?: unknown[]; message?: string; code?: number }>}
 */
export async function fetchAitopAuthorizedProjects(domainAccount) {
  const da = String(domainAccount || '').trim();
  if (!da) {
    return { success: false, message: '缺少域账号（用户名）' };
  }
  const url = `${getAitopBaseUrl()}/api/v1/project/list`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(da),
    signal: AbortSignal.timeout(30_000),
  });
  let body;
  try {
    body = await resp.json();
  } catch {
    const text = await resp.text().catch(() => '');
    return {
      success: false,
      message: `AITOP 响应非 JSON（HTTP ${resp.status}）${text ? `: ${text.slice(0, 200)}` : ''}`,
    };
  }
  if (!resp.ok) {
    return {
      success: false,
      code: body?.code,
      message: body?.message || body?.msg || `HTTP ${resp.status}`,
    };
  }
  if (!body?.success) {
    return {
      success: false,
      code: body?.code,
      message: body?.message || body?.msg || 'AITOP project/list 失败',
    };
  }
  const data = Array.isArray(body.data) ? body.data : [];
  return { success: true, data, code: body.code };
}

/**
 * 公司全部项目（需域账号；通常管理员/超管在 FlowGen 用此接口同步「所有项目」）
 * GET /api/v1/project/listAll
 * @param {string} domainAccount
 */
export async function fetchAitopCompanyAllProjects(domainAccount) {
  const da = String(domainAccount || '').trim();
  if (!da) {
    return { success: false, message: '缺少域账号（用户名）' };
  }
  const url = `${getAitopBaseUrl()}/api/v1/project/listAll`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(da),
    signal: AbortSignal.timeout(30_000),
  });
  let body;
  try {
    body = await resp.json();
  } catch {
    const text = await resp.text().catch(() => '');
    return {
      success: false,
      message: `AITOP 响应非 JSON（HTTP ${resp.status}）${text ? `: ${text.slice(0, 200)}` : ''}`,
    };
  }
  if (!resp.ok) {
    return {
      success: false,
      code: body?.code,
      message: body?.message || body?.msg || `HTTP ${resp.status}`,
    };
  }
  if (!body?.success) {
    return {
      success: false,
      code: body?.code,
      message: body?.message || body?.msg || 'AITOP project/listAll 失败',
    };
  }
  const data = Array.isArray(body.data) ? body.data : [];
  return { success: true, data, code: body.code };
}

/** 将 AITOP 项目项转为列表展示 { id, name } */
export function mapAitopProjectRows(items) {
  const out = [];
  const seen = new Set();
  for (const item of items || []) {
    const id = String(item?.projectId ?? item?.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = String(item?.projectName ?? item?.name ?? id).trim() || id;
    out.push({ id, name });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return out;
}

/**
 * 按域账号查询 AITOP 有权限项目（只读，不写本地 store）
 * @param {string} domainAccount
 */
export async function fetchAitopProjectRowsForUser(domainAccount) {
  const resp = await fetchAitopAuthorizedProjects(domainAccount);
  if (!resp.success) {
    const err = new Error(resp.message || 'AITOP 项目列表获取失败');
    err.code = resp.code;
    throw err;
  }
  return mapAitopProjectRows(resp.data);
}

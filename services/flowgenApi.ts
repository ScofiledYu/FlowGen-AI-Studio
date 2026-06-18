import { uiCategoryToKlingSubjectTag } from './aitop';
import { remoteMediaUrlPreferSameOriginProxy } from '../utils/remoteMediaFetch';
import { normalizeAssetMime } from '../utils/assetMime';

const BASE = '/flowgen-api';

export const FLOWGEN_TOKEN_KEY = 'flowgen_token';
export const FLOWGEN_USER_KEY = 'flowgen_user';

export type FlowgenUserListResponse = {
  users: FlowgenUser[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary?: {
    totalUsers: number;
    admins: number;
    active: number;
    disabled: number;
  };
  facets?: {
    centers: string[];
    departments: string[];
    baseLocations: string[];
  };
};

export type FlowgenUser = {
  id: string;
  username: string;
  role: string;
  displayName?: string;
  center?: string;
  department?: string;
  baseLocation?: string;
  status?: string;
  extendedJson?: Record<string, unknown>;
  mustChangePassword?: boolean;
  /** 管理员列表接口附带：该用户所在项目（与 /projects/:id/members 同源） */
  projects?: Array<{ id: string; name: string }>;
};

export type ListUsersParams = {
  q?: string;
  role?: string;
  center?: string;
  department?: string;
  baseLocation?: string;
  status?: string;
  page?: number;
  pageSize?: number;
};

function authHeaders(): HeadersInit {
  const t = typeof localStorage !== 'undefined' ? localStorage.getItem(FLOWGEN_TOKEN_KEY) : null;
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

function assetDebugEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('flowgen_debug_assets') === '1';
  } catch {
    return false;
  }
}

function logAssetDebug(...args: unknown[]) {
  if (assetDebugEnabled()) {
    console.warn('[flowgen:assets]', ...args);
  }
}

export async function flowgenFetch<T = unknown>(
  path: string,
  init?: RequestInit & { json?: unknown }
): Promise<T> {
  const { json, headers, ...rest } = init || {};
  const res = await fetch(`${BASE}${path.startsWith('/') ? path : `/${path}`}`, {
    ...rest,
    cache: rest.cache ?? 'no-store',
    headers: { ...authHeaders(), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (res.ok) {
    if (typeof data === 'string' && /^\s*</.test(data)) {
      throw new Error(
        '收到 HTML 而非接口数据：请确认已启动 FlowGen API（开发环境需 npm run dev:full 或同时运行 Vite 与 3001 端口 API），且 /flowgen-api 已正确代理。'
      );
    }
  }
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error?: string }).error)
        : res.statusText;
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return data as T;
}

export function getStoredToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(FLOWGEN_TOKEN_KEY);
}

/** 将 API 返回的相对路径转为当前站点绝对 URL */
export function resolveFlowgenAssetUrl(apiPath: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  if (apiPath.startsWith('http://') || apiPath.startsWith('https://')) return apiPath;
  if (apiPath.startsWith('/')) return `${origin}${apiPath}`;
  return `${origin}/${apiPath}`;
}

/** 供 <img src> 使用：鉴权素材/缩略图 GET（浏览器无法带 Authorization 头） */
export function withAssetAccessToken(apiPath: string): string {
  const full = resolveFlowgenAssetUrl(apiPath);
  const t = getStoredToken();
  if (!t) return full;
  try {
    const u = new URL(full);
    u.searchParams.set('access_token', t);
    return u.toString();
  } catch {
    return full;
  }
}

/** 项目素材库 /assets/:id/file（JWT），<img> 不能带 Authorization 头 */
export function isFlowgenProtectedAssetFileUrl(url: string): boolean {
  if (!url?.trim()) return false;
  const probe = url.trim();
  try {
    const pathname = probe.startsWith('http') ? new URL(probe).pathname : probe.split('?')[0];
    return (
      /\/flowgen-api\/projects\/[^/]+\/assets\/[^/]+\/(?:file|thumb)$/i.test(pathname) ||
      /\/flowgen-api\/projects\/[^/]+\/node-media\/[^/]+\/file$/i.test(pathname) ||
      /\/flowgen-api\/projects\/[^/]+\/cover\/file$/i.test(pathname)
    );
  } catch {
    return (
      probe.includes('/flowgen-api/') &&
      probe.includes('/assets/') &&
      /\/file(?:\?|$)/i.test(probe)
    );
  }
}

/** 是否为项目素材缩略图 URL（画布预览用，不宜直接送 Seedance 等生成接口） */
export function isFlowgenAssetThumbUrl(url: string): boolean {
  if (!url?.trim()) return false;
  const probe = url.trim();
  try {
    const pathname = probe.startsWith('http') ? new URL(probe).pathname : probe.split('?')[0];
    return /\/flowgen-api\/projects\/[^/]+\/assets\/[^/]+\/thumb$/i.test(pathname);
  } catch {
    return probe.includes('/flowgen-api/') && probe.includes('/assets/') && /\/thumb(?:\?|$)/i.test(probe);
  }
}

/** 将素材 thumb 链转为原图 file 链（上传/生成应走 file） */
export function flowgenAssetFileUrlFromMediaUrl(url: string): string {
  const bare = stripAssetAccessTokenFromUrl(url?.trim() || '');
  if (!bare || !isFlowgenAssetThumbUrl(bare)) return bare;
  return bare.replace(/\/thumb(\?.*)?$/i, (_m, qs: string | undefined) => `/file${qs || ''}`);
}

/** 持久化前去掉 URL 上的 access_token，避免 token 过期后工程里全是失效链接 */
export function stripAssetAccessTokenFromUrl(url: string): string {
  if (!url?.trim() || !/[?&](access_token|token)=/i.test(url)) return url;
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const u = new URL(url.trim(), origin);
    u.searchParams.delete('access_token');
    u.searchParams.delete('token');
    const qs = u.searchParams.toString();
    if (url.trim().startsWith('/') && !/^https?:\/\//i.test(url.trim())) {
      return u.pathname + (qs ? `?${qs}` : '');
    }
    return `${u.origin}${u.pathname}${qs ? `?${qs}` : ''}`;
  } catch {
    return url
      .replace(/([?&])(?:access_token|token)=[^&]*/gi, '$1')
      .replace(/\?&/g, '?')
      .replace(/[?&]$/g, '');
  }
}

/** 画布节点 / 侧栏主预览：<img src> 用；数据层仍存无 token 的 /flowgen-api/... 短链 */
export function resolveDisplayMediaUrl(url: string | undefined | null): string {
  if (!url?.trim()) return '';
  let s = url.trim();
  if (s.startsWith('data:') || s.startsWith('blob:')) return s;
  if (s.includes('/proxy-file?') || s.includes('/proxy-image?')) {
    try {
      const p = new URL(s, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
      const inner = p.searchParams.get('url') || '';
      if (inner) {
        const innerTrimmed = inner.trim();
        const innerBare = stripAssetAccessTokenFromUrl(innerTrimmed);
        // 旧工程可能持久化为 /proxy-image?url=/flowgen-api/...；展示时优先直出带 token 的受保护地址
        if (isFlowgenProtectedAssetFileUrl(innerBare)) {
          return resolveDisplayMediaUrl(innerTrimmed);
        }
        // 非受保护资源保持原代理 URL，避免出现 /proxy-file?url=/proxy-image?... 的嵌套
        return s;
      }
    } catch {
      return s;
    }
    return s;
  }
  if (typeof window !== 'undefined' && /^https?:\/\//i.test(s)) {
    try {
      if (new URL(s, window.location.origin).origin === window.location.origin) {
        /* 同源相对路径或绝对路径，继续走素材鉴权逻辑 */
      } else if (remoteMediaUrlPreferSameOriginProxy(s)) {
        return `/proxy-image?url=${encodeURIComponent(s)}`;
      }
    } catch {
      if (remoteMediaUrlPreferSameOriginProxy(s)) {
        return `/proxy-image?url=${encodeURIComponent(s)}`;
      }
    }
  }
  /** 缩略图链需鉴权且部分环境 thumb 不可用，展示统一走 /file */
  if (isFlowgenAssetThumbUrl(s)) {
    s = flowgenAssetFileUrlFromMediaUrl(s);
  }
  if (!isFlowgenProtectedAssetFileUrl(s)) return s;
  if (/[?&](access_token|token)=/i.test(s)) return s;
  const bare = stripAssetAccessTokenFromUrl(s);
  const apiPath = bare.startsWith('http')
    ? (() => {
        try {
          return new URL(bare).pathname;
        } catch {
          return bare;
        }
      })()
    : bare.split('?')[0];
  const out = withAssetAccessToken(apiPath);
  try {
    const src = new URL(s.trim(), typeof window !== 'undefined' ? window.location.origin : 'http://local');
    const bust = src.searchParams.get('v') || src.searchParams.get('t');
    if (!bust) return out;
    const u = new URL(out);
    u.searchParams.set('v', bust);
    return u.toString();
  } catch {
    return out;
  }
}

/** 项目列表封面：<img> 用 updatedAt 破缓存，避免换图后仍显示旧 project-cover.* */
export function projectCoverDisplayUrl(
  coverImage: string | null | undefined,
  updatedAt?: string | null
): string {
  const base = resolveDisplayMediaUrl(coverImage);
  if (!base) return base;
  /** data:/blob: 不能追加 ?v=，否则会破坏编码导致裂图 */
  if (base.startsWith('data:') || base.startsWith('blob:')) return base;
  if (!updatedAt) return base;
  try {
    const u = new URL(base, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    u.searchParams.set('v', updatedAt);
    return u.toString();
  } catch {
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}v=${encodeURIComponent(updatedAt)}`;
  }
}

export function getStoredUser(): FlowgenUser | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(FLOWGEN_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FlowgenUser;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: FlowgenUser) {
  localStorage.setItem(FLOWGEN_TOKEN_KEY, token);
  localStorage.setItem(FLOWGEN_USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(FLOWGEN_TOKEN_KEY);
  localStorage.removeItem(FLOWGEN_USER_KEY);
}

export async function login(username: string, password: string) {
  const out = await flowgenFetch<{ token: string; user: FlowgenUser }>('/auth/login', {
    method: 'POST',
    json: { username, password },
  });
  setSession(out.token, out.user);
  return out;
}

export async function fetchMe() {
  return flowgenFetch<FlowgenUser>('/auth/me');
}

export async function changePassword(currentPassword: string | undefined, newPassword: string) {
  return flowgenFetch('/auth/change-password', {
    method: 'POST',
    json: { currentPassword, newPassword },
  });
}

export async function listProjects(q?: string) {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  return flowgenFetch<{ projects: Array<{ 
    id: string; 
    name: string; 
    status: string;
    coverImage?: string | null;
    extendedJson?: Record<string, unknown>;
    createdAt?: string;
    updatedAt?: string;
  }> }>(
    `/projects${qs}`
  );
}

export async function updateProject(
  projectId: string,
  payload: { name?: string; status?: string; coverImage?: string | null }
) {
  const pid = encodeURIComponent(projectId);
  return flowgenFetch<{ id: string; name: string; status: string; coverImage?: string | null }>(
    `/projects/${pid}`,
    { method: 'PATCH', json: payload }
  );
}

/** 项目列表封面：落盘到服务器，任意浏览器可通过 /cover/file 访问 */
export async function uploadProjectCover(projectId: string, file: File): Promise<{ url: string; coverImage: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const t = getStoredToken();
  const headers: Record<string, string> = {};
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectId)}/cover`, {
    method: 'POST',
    cache: 'no-store',
    headers,
    body: fd,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; url?: string; coverImage?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  const url = data.url || data.coverImage || '';
  if (!url) throw new Error('封面上传未返回 url');
  return { url, coverImage: url };
}

export async function clearProjectCover(projectId: string) {
  const pid = encodeURIComponent(projectId);
  return flowgenFetch<{ ok: boolean; coverImage: null }>(`/projects/${pid}/cover`, { method: 'DELETE' });
}

/** @deprecated 项目由 AITOP 管理，服务端已禁用 DELETE /projects */
export async function deleteProject(projectId: string) {
  const pid = encodeURIComponent(projectId);
  return flowgenFetch<{ ok: true }>(`/projects/${pid}`, { method: 'DELETE' });
}

export async function getWorkspace(projectId: string) {
  return flowgenFetch<{ version: number; payload: unknown; updatedAt?: string }>(
    `/projects/${encodeURIComponent(projectId)}/workspace`
  );
}

export async function putWorkspace(
  projectId: string,
  body: { payload: unknown; version: number; allowEmptyGraph?: boolean; keepalive?: boolean }
) {
  const { keepalive, ...jsonBody } = body;
  return flowgenFetch<{ version: number; payload: unknown }>(
    `/projects/${encodeURIComponent(projectId)}/workspace`,
    {
      method: 'PUT',
      keepalive: !!keepalive,
      json: {
        payload: jsonBody.payload,
        version: jsonBody.version,
        ...(jsonBody.allowEmptyGraph ? { allowEmptyGraph: true } : {}),
      },
    }
  );
}

export async function listAssets(projectId: string) {
  return flowgenFetch<{
    assets: Array<{
      id: string;
      name: string;
      category?: string;
      episode?: string;
      sequence?: string;
      url: string;
      thumbUrl?: string;
      mime: string;
      createdAt: string;
    }>;
  }>(`/projects/${encodeURIComponent(projectId)}/assets`);
}

export type FlowgenAssetMeta = {
  id: string;
  name: string;
  category?: string;
  episode?: string;
  sequence?: string;
  url: string;
  mime: string;
  createdAt: string;
  createdBy?: string | null;
};

/**
 * 单条素材元数据（需服务端提供 GET .../assets/:assetId；未部署该路由时会 404）。
 */
export async function getAssetMeta(projectId: string, assetId: string) {
  const pid = encodeURIComponent(projectId);
  const aid = encodeURIComponent(String(assetId).trim());
  return flowgenFetch<{ asset: FlowgenAssetMeta }>(`/projects/${pid}/assets/${aid}`);
}

export async function uploadAsset(
  projectId: string,
  file: File,
  name?: string,
  category?: string,
  meta?: { episode?: string; sequence?: string }
) {
  const fd = new FormData();
  const assetName = String(name ?? '').trim() || file.name || 'asset';
  /**
   * 与可灵主体库一致：multipart 传文件与名称；分类优先走 URL `?flowgen_asset_tag=`（ASCII），与 kLingMainLibrary/save 的 tag 同源；
   * 旧实例未识别 query 时再第二步 PATCH（tag 字段）。
   */
  const labelZh = String(category ?? '').trim() || '其他';
  const tag = uiCategoryToKlingSubjectTag(labelZh);
  fd.append('name', assetName);
  fd.append('flowgen_asset_tag', tag);
  if (meta?.episode) fd.append('episode', meta.episode);
  if (meta?.sequence) fd.append('sequence', meta.sequence);
  fd.append('file', file);
  const t = getStoredToken();
  const qs = new URLSearchParams();
  qs.set('flowgen_asset_tag', tag);
  const url = `${BASE}/projects/${encodeURIComponent(projectId)}/assets?${qs.toString()}`;
  logAssetDebug('upload POST（文件 + flowgen_asset_tag）', { projectId, tag, url });
  const headers: Record<string, string> = {
    /** ASCII 枚举，供未解析 multipart 字段时的兜底（routes 读取 x-asset-category） */
    'X-Asset-Category': tag,
  };
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers,
    body: fd,
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    id?: string;
    category?: string;
    name?: string;
    url?: string;
    mime?: string;
    createdAt?: string;
  };
  if (!res.ok) throw new Error(data.error || res.statusText);
  logAssetDebug('upload POST 响应', { id: data.id, category: data.category, expectTag: tag });
  if (!data.id) {
    throw new Error(
      '创建接口未返回素材 id，无法同步标签。请确认已运行 npm run dev:full（Vite 代理 /flowgen-api → 3001），且未单独只开 Vite。'
    );
  }
  const normCat = (c: string | undefined) => String(c ?? '').trim().toUpperCase();

  /**
   * 与可灵 kLingMainLibrary/save 一致：单次 multipart 即写入 tag（query + form 字段 + X-Asset-Category），
   * 不再请求 PATCH/POST …/meta（避免网关 404 刷屏；编辑素材仍走 patchAsset）。
   */
  if (normCat(data.category) === tag.toUpperCase()) {
    logAssetDebug('upload 分类已由创建请求写入', { id: data.id, category: data.category });
    console.info('[flowgen] 素材创建完成', {
      assetId: data.id,
      selectedLabel: labelZh,
      storedTag: tag,
      createResponseCategory: data.category,
      mode: 'single_step',
    });
    return {
      ...data,
      category: data.category,
      mime: normalizeAssetMime(data.mime, assetName),
    };
  }

  console.warn(
    '[flowgen] 创建接口返回的分类与所选不一致（通常为运行中的 API 未包含 flowgen_asset_tag 解析，请重启 dev:api）。界面暂按所选展示。',
    { assetId: data.id, expectedTag: tag, createResponseCategory: data.category }
  );
  return { ...data, category: tag, mime: normalizeAssetMime(data.mime, assetName) };
}

/** 画布节点预览落盘（data/flowgen/uploads/.../node-media），返回可写入 workspace 的短 URL */
export async function uploadNodeMedia(
  projectId: string,
  file: Blob,
  filename = 'image.png'
): Promise<{ url: string; localPath?: string; mediaId?: string }> {
  const fd = new FormData();
  fd.append('file', file, filename);
  const t = getStoredToken();
  const headers: Record<string, string> = {};
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectId)}/node-media`, {
    method: 'POST',
    cache: 'no-store',
    headers,
    body: fd,
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    url?: string;
    localPath?: string;
    mediaId?: string;
  };
  if (!res.ok) throw new Error(data.error || res.statusText);
  if (!data.url) throw new Error('node-media 未返回 url');
  return { url: data.url, localPath: data.localPath, mediaId: data.mediaId };
}

/** 鉴权素材文件二进制（供缩略图管线与 Blob URL 封装复用） */
export async function getAssetFileBlob(assetUrlFromApi: string): Promise<Blob> {
  const t = getStoredToken();
  const res = await fetch(resolveFlowgenAssetUrl(assetUrlFromApi), {
    headers: t ? { Authorization: `Bearer ${t}` } : {},
    cache: 'default',
  });
  if (!res.ok) throw new Error('加载素材预览失败');
  return res.blob();
}

/**
 * 资产文件 URL 受 JWT 保护；img/video 的 src 无法带 Authorization，需拉取为 Blob URL 再展示。
 */
export async function getAssetFileBlobUrl(assetUrlFromApi: string): Promise<string> {
  const blob = await getAssetFileBlob(assetUrlFromApi);
  return URL.createObjectURL(blob);
}

function parseFlowgenJsonBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function throwIfHtmlInsteadOfJson(data: unknown): void {
  if (typeof data === 'string' && /^\s*</.test(data)) {
    throw new Error(
      '收到 HTML 而非接口数据：请确认已启动 FlowGen API（开发环境需 npm run dev:full 或同时运行 Vite 与 3001 端口 API），且 /flowgen-api 已正确代理。'
    );
  }
}

function errorMessageFromFlowgenResponse(res: Response, data: unknown): string {
  if (data && typeof data === 'object' && data !== null && 'error' in data) {
    return String((data as { error?: string }).error);
  }
  return res.statusText;
}

/**
 * 更新素材名称/标签。优先 PATCH（当前服务端与代理普遍可用）；404/405 时再尝试 POST .../meta、POST 同路径。
 * body 同时传 category 与 tag（ASCII 枚举），服务端 applyAssetMeta 任取其一。
 */
export async function patchAsset(
  projectId: string,
  assetId: string,
  body: { name?: string; category?: string; tag?: string; episode?: string; sequence?: string }
) {
  const pid = encodeURIComponent(projectId);
  const aid = encodeURIComponent(assetId);
  const assetUrl = `${BASE}/projects/${pid}/assets/${aid}`;
  const cat = body.category ?? body.tag;
  const jsonPayload: Record<string, string> = {};
  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (n) jsonPayload.name = n;
  }
  if (cat !== undefined) {
    const c = String(cat).trim();
    jsonPayload.category = c;
    jsonPayload.tag = c;
  }
  if (body.episode !== undefined) jsonPayload.episode = String(body.episode).trim();
  if (body.sequence !== undefined) jsonPayload.sequence = String(body.sequence).trim();

  const run = async (url: string, method: string) => {
    const res = await fetch(url, {
      method,
      cache: 'no-store',
      headers: authHeaders(),
      body: JSON.stringify(jsonPayload),
    });
    const text = await res.text();
    const data = parseFlowgenJsonBody(text);
    return { res, data };
  };

  /** 写入分类时期望服务端返回含 category 的 JSON（与 applyAssetMeta 一致）；空对象 / 仅 ok 等一律视为无效，继续换路径重试 */
  const needsCategoryInResponse = Boolean(jsonPayload.category && String(jsonPayload.category).trim());

  function normalizeAssetMetaPayload(data: unknown): { id: string; name: string; category: string } | null {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
    const o = data as Record<string, unknown>;
    const id = o.id;
    const name = o.name;
    const category = o.category;
    if (typeof id !== 'string' || !id.trim()) return null;
    if (typeof name !== 'string') return null;
    if (typeof category !== 'string' || !String(category).trim()) return null;
    return { id, name, category: String(category).trim() };
  }

  let { res, data } = await run(assetUrl, 'PATCH');
  if (res.ok) {
    throwIfHtmlInsteadOfJson(data);
    const normalized = normalizeAssetMetaPayload(data);
    if (normalized && (!needsCategoryInResponse || normalized.category)) {
      return normalized;
    }
    logAssetDebug('PATCH 200 但响应无可用的 category/json，尝试 POST .../meta', { projectId, assetId });
  } else if (res.status !== 404 && res.status !== 405) {
    throw new Error(errorMessageFromFlowgenResponse(res, data) || `HTTP ${res.status}`);
  }

  ({ res, data } = await run(`${assetUrl}/meta`, 'POST'));
  if (res.ok) {
    throwIfHtmlInsteadOfJson(data);
    const normalized = normalizeAssetMetaPayload(data);
    if (normalized && (!needsCategoryInResponse || normalized.category)) {
      return normalized;
    }
    logAssetDebug('POST .../meta 200 但响应无效，尝试 POST /assets/:id', { projectId, assetId });
  } else if (res.status !== 404 && res.status !== 405) {
    throw new Error(errorMessageFromFlowgenResponse(res, data) || `HTTP ${res.status}`);
  }

  ({ res, data } = await run(assetUrl, 'POST'));
  if (res.ok) {
    throwIfHtmlInsteadOfJson(data);
    const normalized = normalizeAssetMetaPayload(data);
    if (normalized && (!needsCategoryInResponse || normalized.category)) {
      return normalized;
    }
    throw new Error('素材标签已提交但服务端返回格式异常（缺少 id/name/category）。请确认 FlowGen API 为最新版本并已重启。');
  }

  if (res.status === 404 || res.status === 405) {
    throw new Error(
      '无法更新素材分类：PATCH 与 POST 均不可用。请确认已部署 server/flowgen/routes.mjs 并已重启 API（dev:api / dev:full）。'
    );
  }

  throw new Error(errorMessageFromFlowgenResponse(res, data) || `HTTP ${res.status}`);
}

/** 替换素材文件（保留 id / 名称等业务字段，仅更新磁盘文件与 mime） */
export async function replaceAssetFile(projectId: string, assetId: string, file: File) {
  const fd = new FormData();
  fd.append('file', file);
  const t = getStoredToken();
  const res = await fetch(
    `${BASE}/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/file`,
    {
      method: 'PUT',
      headers: t ? { Authorization: `Bearer ${t}` } : {},
      body: fd,
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data as { ok: boolean; mime: string; url: string };
}

export async function deleteAsset(projectId: string, assetId: string) {
  return flowgenFetch(`/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`, {
    method: 'DELETE',
  });
}

/** --- Admin --- */

export async function listUsers(params?: ListUsersParams) {
  const p = new URLSearchParams();
  if (params?.q) p.set('q', params.q);
  if (params?.role) p.set('role', params.role);
  if (params?.center) p.set('center', params.center);
  if (params?.department) p.set('department', params.department);
  if (params?.baseLocation) p.set('baseLocation', params.baseLocation);
  if (params?.status) p.set('status', params.status);
  if (params?.page) p.set('page', String(params.page));
  if (params?.pageSize) p.set('pageSize', String(params.pageSize));
  const qs = p.toString();
  return flowgenFetch<FlowgenUserListResponse>(`/users${qs ? `?${qs}` : ''}`);
}

export async function createUser(body: {
  username: string;
  password: string;
  role?: string;
  center?: string;
  department?: string;
  baseLocation?: string;
  status?: string;
  extendedJson?: Record<string, unknown>;
}) {
  return flowgenFetch('/users', { method: 'POST', json: body });
}

export async function patchUser(
  id: string,
  body: {
    password?: string;
    role?: string;
    center?: string;
    department?: string;
    baseLocation?: string;
    status?: string;
    extendedJson?: Record<string, unknown>;
    mustChangePassword?: boolean;
  }
) {
  return flowgenFetch(`/users/${encodeURIComponent(id)}`, { method: 'PATCH', json: body });
}

export async function deleteUser(id: string) {
  return flowgenFetch(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function importUsers(rows: Record<string, unknown>[]) {
  return flowgenFetch<{ imported: number; errors: Array<{ row: number; message: string }> }>(
    '/users/import',
    { method: 'POST', json: { rows } }
  );
}

export async function createProject(name: string, extendedJson?: Record<string, unknown>) {
  return flowgenFetch<{ id: string; name: string }>('/projects', {
    method: 'POST',
    json: { name, extendedJson },
  });
}

export async function patchProject(
  projectId: string,
  body: { name?: string; status?: string; coverImage?: string | null; extendedJson?: Record<string, unknown> }
) {
  return flowgenFetch(`/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', json: body });
}

export async function importProjects(rows: Record<string, unknown>[]) {
  return flowgenFetch<{ imported: number; errors: Array<{ row: number; message: string }> }>(
    '/projects/import',
    { method: 'POST', json: { rows } }
  );
}

export async function listMembers(projectId: string) {
  return flowgenFetch<{
    members: Array<{ userId: string; username: string; displayName?: string; role: string }>;
  }>(`/projects/${encodeURIComponent(projectId)}/members`);
}

export async function listMemberCandidates(projectId: string) {
  return flowgenFetch<{
    users: Array<{ id: string; username: string; displayName?: string; role: string }>;
  }>(`/projects/${encodeURIComponent(projectId)}/member-candidates`);
}

export async function addMember(projectId: string, userId: string, role = 'editor') {
  return flowgenFetch(`/projects/${encodeURIComponent(projectId)}/members`, {
    method: 'POST',
    json: { userId, role },
  });
}

export async function removeMember(projectId: string, userId: string) {
  return flowgenFetch(
    `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' }
  );
}

export async function patchMemberRole(projectId: string, userId: string, role: string) {
  return flowgenFetch(
    `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
    { method: 'PATCH', json: { role } }
  );
}

export async function createUserInProject(
  projectId: string,
  body: { username: string; password: string; role?: string; memberRole?: string }
) {
  return flowgenFetch(`/projects/${encodeURIComponent(projectId)}/users`, {
    method: 'POST',
    json: body,
  });
}

export {
  FLOWGEN_ROLES,
  canManageAssignedProject,
  canManageProjectAssets,
  globalRoleLabel,
  isAdminRole,
  isGlobalAdminRole,
  isProjectAdminRole,
  normalizeGlobalRoleInput,
} from '../utils/flowgenRoles';

// ================== Qwen 聊天记录 API ==================
export type ChatHistoryMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  imageUrl?: string;
  imageUrls?: string[];
  tableRows?: string[][];
};

export type ChatHistoryRecord = {
  chatId: string;
  modelId: string;
  messages: ChatHistoryMessage[];
  updatedAt: string;
  projectId?: string | null;
  userId?: string | null;
};

export async function listChatHistory(projectId?: string): Promise<{
  sessions: Array<{
    chatId: string;
    modelId: string;
    updatedAt: string;
    messageCount: number;
    firstMessage: string;
    projectId?: string | null;
  }>;
}> {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  return flowgenFetch(`/chat-history${qs}`, { method: 'GET' });
}

export async function getChatHistory(
  chatId: string,
  opts?: { projectId?: string | null }
): Promise<ChatHistoryRecord> {
  const qs = opts?.projectId ? `?projectId=${encodeURIComponent(opts.projectId)}` : '';
  return flowgenFetch(`/chat-history/${encodeURIComponent(chatId)}${qs}`, { method: 'GET' });
}

export async function saveChatHistory(
  chatId: string,
  modelId: string,
  messages: ChatHistoryMessage[],
  opts?: { projectId?: string | null }
): Promise<{ ok: boolean; chatId: string }> {
  return flowgenFetch(`/chat-history/${encodeURIComponent(chatId)}`, {
    method: 'POST',
    json: {
      modelId,
      messages: messages.slice(0, 200),
      ...(opts?.projectId ? { projectId: opts.projectId } : {}),
    },
  });
}

export async function deleteChatHistory(
  chatId: string,
  opts?: { projectId?: string | null }
): Promise<{ ok: boolean }> {
  const qs = opts?.projectId ? `?projectId=${encodeURIComponent(opts.projectId)}` : '';
  return flowgenFetch(`/chat-history/${encodeURIComponent(chatId)}${qs}`, { method: 'DELETE' });
}

const ASSET_LIBRARY_PATH_RE =
  /\/flowgen-api\/projects\/([^/]+)\/assets\/([^/]+)\/(?:file|thumb)$/i;

function isAssetLibraryPath(pathname: string): boolean {
  return ASSET_LIBRARY_PATH_RE.test(pathname);
}

function isEphemeralMediaUrl(url: string): boolean {
  const s = url.trim();
  return s.startsWith('blob:') || s.startsWith('data:') || s.startsWith('flowgen-local:');
}

/** 项目素材库 file/thumb（不含 node-media、外链 COS） */
export function isProjectAssetLibraryImageUrl(url: string): boolean {
  const s = url.trim();
  if (!s || isEphemeralMediaUrl(s)) return false;
  try {
    const pathname = s.startsWith('http') ? new URL(s).pathname : s.split('?')[0];
    return isAssetLibraryPath(pathname);
  } catch {
    return ASSET_LIBRARY_PATH_RE.test(s);
  }
}

/** 从 /assets/…/file|thumb 链解析项目与素材 id */
export function parseProjectAssetIdsFromMediaUrl(
  url: string | undefined
): { projectId: string; assetId: string } | null {
  const s = stripAssetAccessTokenFromUrl((url || '').trim());
  if (!s) return null;
  try {
    const pathname = s.startsWith('http') ? new URL(s, 'http://localhost').pathname : s.split('?')[0];
    const m = pathname.match(ASSET_LIBRARY_PATH_RE);
    if (!m) return null;
    return { projectId: m[1], assetId: m[2] };
  } catch {
    const m = s.match(ASSET_LIBRARY_PATH_RE);
    if (!m) return null;
    return { projectId: m[1], assetId: m[2] };
  }
}

function stripAssetAccessTokenFromUrl(url: string): string {
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

function assetThumbToFileUrl(url: string): string {
  const bare = stripAssetAccessTokenFromUrl(url.trim());
  if (!bare || !/\/thumb(\?|$)/i.test(bare.split('?')[0])) return bare;
  return bare.replace(/\/thumb(\?.*)?$/i, (_m, qs: string | undefined) => `/file${qs || ''}`);
}

/** 画布节点持久化用的资产库原图链（无 token） */
export function canonicalProjectAssetFileUrl(projectId: string, assetId: string): string {
  const pid = String(projectId || '').trim();
  const aid = String(assetId || '').trim();
  if (!pid || !aid) return '';
  return `/flowgen-api/projects/${pid}/assets/${aid}/file`;
}

/**
 * 资产库拖入 / 分镜模板：优先使用 /assets/…/file（不用 thumb、blob、data）。
 * 有 assetId 时即使 url 异常也可拼出标准链。
 */
export function resolveCanonicalProjectAssetPreviewUrl(
  fileUrl: string | undefined,
  projectId: string | undefined,
  assetId: string | undefined
): string {
  const stripped = stripAssetAccessTokenFromUrl((fileUrl || '').trim());
  if (
    stripped &&
    (stripped.startsWith('/flowgen-api/') || /^https?:\/\//i.test(stripped)) &&
    !stripped.startsWith('blob:') &&
    !stripped.startsWith('data:')
  ) {
    const filePath = assetThumbToFileUrl(stripped);
    if (isAssetLibraryPath(filePath.split('?')[0])) {
      return filePath;
    }
  }
  if (projectId && assetId) {
    return canonicalProjectAssetFileUrl(projectId, assetId);
  }
  return stripped;
}

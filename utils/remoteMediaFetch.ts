/**
 * 判断远程媒体 URL 是否应在浏览器侧优先走同源 `/proxy-file` 拉取。
 * 对象存储、短时签名链等通常不返回 Access-Control-Allow-Origin，
 * 先 fetch 直连会在控制台产生 CORS 报错并可能长时间挂起后才失败。
 */

function browserOrigin(): string {
  return typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
}

/** 剥开嵌套的 /proxy-file?url=… /proxy-image?url=…，得到真实上游 URL */
export function resolveInnerMediaUrl(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw, browserOrigin());
    const p = u.pathname.toLowerCase();
    if ((p === '/proxy-file' || p === '/proxy-image') && u.searchParams.get('url')) {
      return resolveInnerMediaUrl(u.searchParams.get('url') || '');
    }
    return u.toString();
  } catch {
    return raw;
  }
}

export function isVideoLikeMediaUrl(url: string): boolean {
  const inner = resolveInnerMediaUrl(url);
  return (
    /\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(inner) ||
    /mime_type=video/i.test(inner) ||
    /\/video\//i.test(inner) ||
    /kechuangai\.com\/ksc2\//i.test(inner)
  );
}

/**
 * 下载时应 fetch 的同源 URL：视频不走 /proxy-image（易 504），远程 COS 走 /proxy-file。
 */
export function resolveDownloadFetchUrl(src: string): string {
  const raw = String(src || '').trim();
  if (!raw || raw.startsWith('blob:') || raw.startsWith('data:')) return raw;

  try {
    const u = new URL(raw, browserOrigin());
    const p = u.pathname.toLowerCase();
    if (p === '/proxy-image' || p === '/proxy-file') {
      const inner = (u.searchParams.get('url') || '').trim();
      if (!inner) return raw;
      if (p === '/proxy-image' && isVideoLikeMediaUrl(inner)) {
        return `/proxy-file?url=${encodeURIComponent(inner)}`;
      }
      if (remoteMediaUrlPreferSameOriginProxy(inner)) {
        return `/proxy-file?url=${encodeURIComponent(inner)}`;
      }
      return inner;
    }
  } catch {
    // fall through
  }

  if (remoteMediaUrlPreferSameOriginProxy(raw)) {
    return `/proxy-file?url=${encodeURIComponent(raw)}`;
  }
  return raw;
}

export function remoteMediaUrlPreferSameOriginProxy(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return false;
  return (
    /aigc-cloud\.com/i.test(u) ||
    /kechuangai\.com/i.test(u) ||
    /aitop100app-/i.test(u) ||
    /aitop100/i.test(u) ||
    /\/ksc2\//i.test(u) ||
    /tos-cn-v-/i.test(u) ||
    /\.tos\./i.test(u) ||
    /volces\.com/i.test(u) ||
    /amazonaws\.com(\.cn)?/i.test(u) ||
    /X-Tos-/i.test(u) ||
    /X-Amz-/i.test(u) ||
    /dy_q=/i.test(u)
  );
}

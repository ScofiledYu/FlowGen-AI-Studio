import { remoteMediaUrlPreferSameOriginProxy } from './remoteMediaFetch';

/** 读取远程 PNG IHDR，返回如 1536x864；失败则 undefined */
export async function probeRemotePngDimensions(src: string): Promise<string | undefined> {
  const url = String(src || '').trim();
  if (!url || url.startsWith('data:')) return undefined;

  const resolveFetchUrl = (): string => {
    if (url.startsWith('blob:') || url.startsWith('/')) return url;
    if (remoteMediaUrlPreferSameOriginProxy(url)) {
      return `/proxy-file?url=${encodeURIComponent(url)}`;
    }
    return url;
  };

  const fetchUrl = resolveFetchUrl();
  try {
    const res = await fetch(fetchUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-31' },
      credentials: fetchUrl.startsWith('/') ? 'same-origin' : 'omit',
      cache: 'no-store',
    });
    if (!res.ok && res.status !== 206) return undefined;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 24) return undefined;
    const view = new DataView(buf);
    if (view.getUint8(0) !== 0x89 || view.getUint8(1) !== 0x50) return undefined;
    const w = view.getUint32(16);
    const h = view.getUint32(20);
    if (!w || !h) return undefined;
    return `${w}x${h}`;
  } catch {
    return undefined;
  }
}

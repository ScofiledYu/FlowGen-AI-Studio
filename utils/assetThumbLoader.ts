import { getAssetFileBlob, withAssetAccessToken } from '../services/flowgenApi';

const GRID_THUMB_MAX_PX = 320;
const MAX_CONCURRENT = 12;
const CACHE_MAX = 400;

const displayUrlCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
let running = 0;
const waitQueue: Array<() => void> = [];

function runNextQueued(): void {
  if (running >= MAX_CONCURRENT || waitQueue.length === 0) return;
  const next = waitQueue.shift();
  next?.();
}

function withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      running += 1;
      fn()
        .then(resolve, reject)
        .finally(() => {
          running = Math.max(0, running - 1);
          runNextQueued();
        });
    };
    if (running < MAX_CONCURRENT) run();
    else waitQueue.push(run);
  });
}

function cacheKey(fileUrl: string, thumbUrl?: string): string {
  return thumbUrl || fileUrl;
}

async function blobToGridDisplayUrl(blob: Blob, mime: string): Promise<string> {
  if (!mime.startsWith('image/') || typeof createImageBitmap !== 'function') {
    return URL.createObjectURL(blob);
  }
  try {
    const bitmap = await createImageBitmap(blob);
    let w = bitmap.width;
    let h = bitmap.height;
    const max = GRID_THUMB_MAX_PX;
    if (w > max || h > max) {
      if (w >= h) {
        h = Math.round((h * max) / w);
        w = max;
      } else {
        w = Math.round((w * max) / h);
        h = max;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return URL.createObjectURL(blob);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const thumbBlob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, 'image/jpeg', 0.78)
    );
    if (thumbBlob && thumbBlob.size > 0) return URL.createObjectURL(thumbBlob);
  } catch {
    /* 降级为原图 blob */
  }
  return URL.createObjectURL(blob);
}

function rememberDisplayUrl(key: string, displayUrl: string): string {
  const prev = displayUrlCache.get(key);
  if (prev && prev !== displayUrl && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
  if (displayUrlCache.size >= CACHE_MAX && !displayUrlCache.has(key)) {
    const oldest = displayUrlCache.keys().next().value;
    if (oldest) {
      const u = displayUrlCache.get(oldest)!;
      if (u.startsWith('blob:')) URL.revokeObjectURL(u);
      displayUrlCache.delete(oldest);
    }
  }
  displayUrlCache.set(key, displayUrl);
  return displayUrl;
}

/** 服务端缩略图 URL（小 JPEG + 浏览器 HTTP 缓存），最快路径 */
export function getDirectAssetThumbSrc(thumbUrl: string | undefined, mime: string): string | undefined {
  if (!thumbUrl || !mime.startsWith('image/')) return undefined;
  return withAssetAccessToken(thumbUrl);
}

export function getCachedAssetThumbDisplayUrl(fileUrl: string, thumbUrl?: string): string | undefined {
  return displayUrlCache.get(cacheKey(fileUrl, thumbUrl));
}

/** 视频或无 thumb 时：拉原文件并本地缩小；图片优先用 getDirectAssetThumbSrc */
export function loadAssetThumbDisplayUrl(
  fileUrl: string,
  mime: string,
  thumbUrl?: string
): Promise<string> {
  const direct = getDirectAssetThumbSrc(thumbUrl, mime);
  if (direct) {
    rememberDisplayUrl(cacheKey(fileUrl, thumbUrl), direct);
    return Promise.resolve(direct);
  }

  const key = cacheKey(fileUrl, thumbUrl);
  const cached = displayUrlCache.get(key);
  if (cached) return Promise.resolve(cached);

  let pending = inflight.get(key);
  if (!pending) {
    pending = withConcurrencyLimit(async () => {
      const blob = await getAssetFileBlob(fileUrl);
      const displayUrl = await blobToGridDisplayUrl(blob, mime);
      return rememberDisplayUrl(key, displayUrl);
    }).finally(() => {
      inflight.delete(key);
    }) as Promise<string>;
    inflight.set(key, pending);
  }
  return pending;
}

export function primeAssetThumbUrls(
  items: Array<{ url: string; thumbUrl?: string; mime: string }>,
  limit = 32
): void {
  for (const a of items.slice(0, limit)) {
    const direct = getDirectAssetThumbSrc(a.thumbUrl, a.mime);
    if (direct) {
      rememberDisplayUrl(cacheKey(a.url, a.thumbUrl), direct);
      continue;
    }
    void loadAssetThumbDisplayUrl(a.url, a.mime, a.thumbUrl).catch(() => {});
  }
}

export function pruneAssetThumbCache(keepKeys: Iterable<string>): void {
  const keep = new Set(keepKeys);
  for (const [url, blobUrl] of displayUrlCache) {
    if (!keep.has(url)) {
      if (blobUrl.startsWith('blob:')) URL.revokeObjectURL(blobUrl);
      displayUrlCache.delete(url);
    }
  }
}

export function clearAssetThumbCache(): void {
  for (const u of displayUrlCache.values()) {
    if (u.startsWith('blob:')) URL.revokeObjectURL(u);
  }
  displayUrlCache.clear();
  inflight.clear();
}

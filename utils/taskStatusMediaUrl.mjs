/** 与 utils/taskStatusImageUrl.ts + taskStatusVideoUrl.ts 一致，供 server.js / vite 开发中转使用 */

function tryStr(v) {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

function accept(s) {
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s) || s.startsWith('blob:') || s.startsWith('data:')) return s;
  return undefined;
}

function pickFromObject(sd) {
  if (!sd || typeof sd !== 'object') return undefined;
  const flat = [
    sd.resourceUrl,
    sd.resultUrl,
    sd.imageUrl,
    sd.image_url,
    sd.videoUrl,
    sd.outputUrl,
    sd.url,
    sd.video_url,
    typeof sd.result === 'string' ? sd.result : undefined,
  ];
  for (const c of flat) {
    const s = accept(tryStr(c));
    if (s) return s;
  }
  for (const arr of [sd.imageUrls, sd.resourceUrls, sd.images, sd.outputs]) {
    if (!Array.isArray(arr) || arr.length === 0) continue;
    for (const item of arr) {
      if (typeof item === 'string') {
        const s = accept(tryStr(item));
        if (s) return s;
      } else if (item && typeof item === 'object') {
        for (const c of [item.url, item.resourceUrl, item.imageUrl, item.image_url, item.videoUrl, item.outputUrl]) {
          const s = accept(tryStr(c));
          if (s) return s;
        }
      }
    }
  }
  return undefined;
}

/** 从 AiTop task-status 响应中提取可下载的图片或视频 URL */
export function pickMediaResourceUrlFromTaskStatus(statusData) {
  if (!statusData || typeof statusData !== 'object') return undefined;
  const sd = statusData;
  const direct = pickFromObject(sd);
  if (direct) return direct;
  const inner = sd.data;
  if (inner && typeof inner === 'object') {
    const nested = pickFromObject(inner);
    if (nested) return nested;
  }
  return undefined;
}

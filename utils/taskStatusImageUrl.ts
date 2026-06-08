import { pickVideoResourceUrlFromTaskStatus } from './taskStatusVideoUrl';

/**
 * AiTop 任务状态中的图片结果 URL（Nano / image2 等）。
 */
export function pickImageResourceUrlFromTaskStatus(statusData: unknown): string | undefined {
  if (!statusData || typeof statusData !== 'object') return undefined;
  const sd = statusData as Record<string, unknown>;
  const tryStr = (v: unknown) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined);
  const accept = (s: string | undefined) => {
    if (!s) return undefined;
    if (/^https?:\/\//i.test(s) || s.startsWith('blob:') || s.startsWith('data:')) return s;
    return undefined;
  };

  const flatCandidates = [
    sd.resourceUrl,
    sd.resultUrl,
    sd.imageUrl,
    sd.image_url,
    sd.url,
  ];
  for (const c of flatCandidates) {
    const s = accept(tryStr(c));
    if (s) return s;
  }

  const arrayCandidates = [sd.imageUrls, sd.resourceUrls, sd.images, sd.outputs];
  for (const arr of arrayCandidates) {
    if (!Array.isArray(arr) || arr.length === 0) continue;
    for (const item of arr) {
      if (typeof item === 'string') {
        const s = accept(tryStr(item));
        if (s) return s;
      } else if (item && typeof item === 'object') {
        const it = item as Record<string, unknown>;
        for (const c of [it.url, it.resourceUrl, it.imageUrl, it.image_url]) {
          const s = accept(tryStr(c));
          if (s) return s;
        }
      }
    }
  }

  const inner = sd.data;
  if (inner && typeof inner === 'object') {
    const it = inner as Record<string, unknown>;
    for (const c of [it.resourceUrl, it.resultUrl, it.imageUrl, it.image_url, it.url]) {
      const s = accept(tryStr(c));
      if (s) return s;
    }
    for (const arr of [it.imageUrls, it.resourceUrls, it.images, it.outputs]) {
      if (!Array.isArray(arr) || arr.length === 0) continue;
      for (const item of arr) {
        if (typeof item === 'string') {
          const s = accept(tryStr(item));
          if (s) return s;
        } else if (item && typeof item === 'object') {
          const row = item as Record<string, unknown>;
          for (const c of [row.url, row.resourceUrl, row.imageUrl, row.image_url]) {
            const s = accept(tryStr(c));
            if (s) return s;
          }
        }
      }
    }
  }
  return undefined;
}

/** 图片或视频结果 URL（轮询恢复、下载刷新共用） */
export function pickMediaResourceUrlFromTaskStatus(statusData: unknown): string | undefined {
  return pickImageResourceUrlFromTaskStatus(statusData) || pickVideoResourceUrlFromTaskStatus(statusData);
}

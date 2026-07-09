/** 与 utils/taskStatusImageUrl.ts + taskStatusVideoUrl.ts 一致，供 server.js / vite 开发中转使用 */

function tryStr(v) {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

function accept(s) {
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s) || s.startsWith('blob:') || s.startsWith('data:')) return s;
  return undefined;
}

/** imagesGenerations 成品优先于 openApi 上传/中间链 */
function rankAitopResultUrl(url) {
  const u = String(url || '').trim().toLowerCase();
  if (u.includes('/imagesgenerations/')) return 300;
  if (u.includes('/videosgenerations/')) return 280;
  if (u.includes('/openapi/')) return 50;
  return 100;
}

function collectFromObject(sd, out) {
  if (!sd || typeof sd !== 'object') return;
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
    if (s) out.push(s);
  }
  for (const arr of [sd.imageUrls, sd.resourceUrls, sd.images, sd.outputs, sd.videos]) {
    if (!Array.isArray(arr) || arr.length === 0) continue;
    for (const item of arr) {
      if (typeof item === 'string') {
        const s = accept(tryStr(item));
        if (s) out.push(s);
      } else if (item && typeof item === 'object') {
        for (const c of [item.url, item.resourceUrl, item.imageUrl, item.image_url, item.videoUrl, item.outputUrl]) {
          const s = accept(tryStr(c));
          if (s) out.push(s);
        }
      }
    }
  }
}

function pickBestRanked(candidates) {
  const uniq = [...new Set(candidates.filter(Boolean))];
  if (!uniq.length) return undefined;
  uniq.sort((a, b) => rankAitopResultUrl(b) - rankAitopResultUrl(a));
  return uniq[0];
}

/** 从 AiTop task-status 响应中提取可下载的图片或视频 URL */
export function pickMediaResourceUrlFromTaskStatus(statusData) {
  if (!statusData || typeof statusData !== 'object') return undefined;
  const candidates = [];
  collectFromObject(statusData, candidates);
  if (statusData.data && typeof statusData.data === 'object') {
    collectFromObject(statusData.data, candidates);
  }
  return pickBestRanked(candidates);
}

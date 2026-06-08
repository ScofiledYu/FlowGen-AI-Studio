/**
 * AiTop / 网关任务状态里视频结果 URL 字段名因模型略有差异，统一提取（供 FlowEditor 轮询、开发下载中转等复用）。
 */
export function pickVideoResourceUrlFromTaskStatus(statusData: unknown): string | undefined {
  if (!statusData || typeof statusData !== 'object') return undefined;
  const sd = statusData as Record<string, unknown>;
  const tryStr = (v: unknown) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined);
  const accept = (s: string | undefined) => {
    if (!s) return undefined;
    if (/^https?:\/\//i.test(s) || s.startsWith('blob:') || s.startsWith('data:')) return s;
    return undefined;
  };
  const flat = [
    sd.resourceUrl,
    sd.resultUrl,
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
  const nested = sd.data;
  if (nested && typeof nested === 'object') {
    const inner = nested as Record<string, unknown>;
    const innerFlat = [
      inner.resourceUrl,
      inner.resultUrl,
      inner.videoUrl,
      inner.outputUrl,
      inner.url,
      inner.video_url,
      typeof inner.result === 'string' ? inner.result : undefined,
    ];
    for (const c of innerFlat) {
      const s = accept(tryStr(c));
      if (s) return s;
    }
  }
  const outputs = sd.outputs;
  if (Array.isArray(outputs)) {
    for (const o of outputs) {
      if (!o || typeof o !== 'object') continue;
      const ob = o as Record<string, unknown>;
      for (const c of [ob.url, ob.resourceUrl, ob.videoUrl, ob.outputUrl]) {
        const s = accept(tryStr(c));
        if (s) return s;
      }
    }
  }
  return undefined;
}

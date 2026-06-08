/**
 * 合并 data + generationParams 的 referenceImages 后，按顺序去重（用于首/尾帧从 [0]/[1] 回退）。
 * http(s) 按去 query/hash 的路径比较；data:/blob: 用整条字符串，避免误合并不同本地预览。
 */
export function dedupeReferenceImageUrlsForSlotFallback(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let s of urls) {
    if (s == null) continue;
    s = String(s).trim();
    if (!s) continue;
    const key =
      s.startsWith('data:') || s.startsWith('blob:')
        ? s
        : (() => {
            const base = s.split('#')[0].split('?')[0];
            return base.replace(/\/+$/, '').toLowerCase();
          })();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * 根据图片尺寸计算最接近的豆包/Seedance 允许比例，避免「首帧图片比例不一致」报错。
 * 豆包可选：21:9、16:9、4:3、1:1、3:4、9:16、9:21（参考 doubao_video_test.py）
 */

const RATIO_VALUES: { value: number; label: string }[] = [
  { value: 21 / 9, label: '21:9' },
  { value: 16 / 9, label: '16:9' },
  { value: 4 / 3, label: '4:3' },
  { value: 1.0, label: '1:1' },
  { value: 3 / 4, label: '3:4' },
  { value: 9 / 16, label: '9:16' },
  { value: 9 / 21, label: '9:21' },
];

export type DoubaoRatio = '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '9:21';

/**
 * 同源拉取远程图再读 naturalWidth，避免 COS 等未配 CORS 时 `crossOrigin=anonymous` 整图加载失败，
 * 进而误回退 1:1 导致 Seedance「首帧图片比例不一致」。
 */
function resolveImageUrlForAspectDetection(src: string): string {
  if (typeof window === 'undefined') return src;
  if (!src || typeof src !== 'string') return src;
  if (src.startsWith('data:') || src.startsWith('blob:')) return src;
  if (src.includes('/proxy-file?') || src.includes('/proxy-image?')) return src;
  if (!/^https?:\/\//i.test(src)) {
    try {
      const u = new URL(src, window.location.href);
      if (u.origin === window.location.origin) return src;
    } catch {
      return src;
    }
    return src;
  }
  try {
    const parsed = new URL(src);
    if (parsed.origin === window.location.origin) return src;
  } catch {
    return src;
  }
  return `/proxy-file?url=${encodeURIComponent(src)}`;
}

/**
 * 根据图片地址（data URL 或 blob URL 或 http(s) URL）加载图片，用宽高比匹配最接近的豆包 ratio。
 * 若无法读取尺寸（跨域、加载失败等）则返回 "1:1"。
 */
export function getImageAspectRatioFromSource(src: string): Promise<DoubaoRatio> {
  return new Promise((resolve) => {
    if (!src || (typeof src !== 'string')) {
      resolve('1:1');
      return;
    }
    const loadUrl = resolveImageUrlForAspectDetection(src);
    /** 走同源代理时不要设 crossOrigin，否则部分环境反不利于解码 */
    const viaSameOriginProxy =
      loadUrl.startsWith('/proxy-file') || loadUrl.startsWith('/proxy-image');

    const img = new Image();
    const timeout = setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      img.src = '';
      resolve('1:1');
    }, 10000);
    img.onload = () => {
      clearTimeout(timeout);
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      if (w <= 0 || h <= 0) {
        resolve('1:1');
        return;
      }
      const aspect = w / h;
      const best = RATIO_VALUES.reduce((prev, curr) =>
        Math.abs(curr.value - aspect) < Math.abs(prev.value - aspect) ? curr : prev
      );
      resolve(best.label as DoubaoRatio);
    };
    img.onerror = () => {
      clearTimeout(timeout);
      resolve('1:1');
    };
    if (!viaSameOriginProxy) {
      img.crossOrigin = 'anonymous';
    }
    img.src = loadUrl;
  });
}

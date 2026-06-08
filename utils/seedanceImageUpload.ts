/**
 * Seedance / 豆包图生、参考生：上传前将图片约束到接口规格。
 * 文档边长为开区间 (300, 6000) px；上传最长边与画布本地拖入一致用 1536，避免贴顶 6000 仍被拒。
 */

/** 文档 (300, 6000) 开区间，单边实际上限取 5999 */
export const SEEDANCE_IMAGE_MIN_SIDE = 301;
export const SEEDANCE_IMAGE_MAX_SIDE = 5999;
/** 与 prepareCanvasNodeImagePreview 最长边一致，本地拖入能过、资产库原图也走同一档 */
export const SEEDANCE_IMAGE_UPLOAD_MAX_DIMENSION = 1536;
export const SEEDANCE_IMAGE_MIN_ASPECT = 0.4;
export const SEEDANCE_IMAGE_MAX_ASPECT = 2.5;
export const SEEDANCE_IMAGE_MAX_BYTES = 30 * 1024 * 1024;

function resolveImageUrlForLoad(src: string): string {
  if (typeof window === 'undefined') return src;
  if (!src || typeof src !== 'string') return src;
  if (src.startsWith('data:') || src.startsWith('blob:')) return src;
  if (src.includes('/proxy-file?') || src.includes('/proxy-image?')) return src;
  if (src.startsWith('/flowgen-api/')) return src;
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

function loadImageElement(input: File | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const viaProxy =
      typeof input === 'string' &&
      (input.startsWith('/proxy-file') || input.startsWith('/proxy-image'));
    if (!viaProxy && typeof input === 'string' && /^https?:\/\//i.test(input)) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    if (typeof input === 'string') {
      img.src = resolveImageUrlForLoad(input);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        img.src = reader.result as string;
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(input);
    }
  });
}

function canvasToJpegDataUrl(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<{ dataUrl: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('toBlob failed'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () =>
          resolve({ dataUrl: reader.result as string, bytes: blob.size });
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      },
      'image/jpeg',
      quality
    );
  });
}

export type SeedanceImageFitResult = {
  dataUrl: string;
  width: number;
  height: number;
  resized: boolean;
  bytes?: number;
};

const TARGET_RATIO_BY_LABEL: Record<string, number> = {
  '21:9': 21 / 9,
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '3:4': 3 / 4,
  '9:16': 9 / 16,
  '9:21': 9 / 21,
};

function targetAspectFromLabel(label?: string | null): number | undefined {
  const t = String(label || '').trim();
  if (!t || t === '自动匹配') return undefined;
  return TARGET_RATIO_BY_LABEL[t];
}

/** 将图片裁切/缩放到 Seedance 允许的像素与宽高比范围，返回 JPEG data URL */
export async function prepareImageForSeedanceModelUpload(
  input: File | string,
  options?: { targetRatioLabel?: string | null }
): Promise<SeedanceImageFitResult> {
  const img = await loadImageElement(input);
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh) throw new Error('Invalid image dimensions');

  let sx = 0;
  let sy = 0;
  let sw = nw;
  let sh = nh;
  const ar = nw / nh;
  if (ar > SEEDANCE_IMAGE_MAX_ASPECT + 1e-6) {
    sw = Math.round(nh * SEEDANCE_IMAGE_MAX_ASPECT);
    sx = Math.floor((nw - sw) / 2);
  } else if (ar < SEEDANCE_IMAGE_MIN_ASPECT - 1e-6) {
    sh = Math.round(nw / SEEDANCE_IMAGE_MIN_ASPECT);
    sy = Math.floor((nh - sh) / 2);
  }

  const targetAr = targetAspectFromLabel(options?.targetRatioLabel);
  if (targetAr != null && Number.isFinite(targetAr) && targetAr > 0) {
    const curAr = sw / sh;
    if (curAr > targetAr + 0.008) {
      const newSw = Math.max(1, Math.round(sh * targetAr));
      sx = sx + Math.floor((sw - newSw) / 2);
      sw = newSw;
    } else if (curAr < targetAr - 0.008) {
      const newSh = Math.max(1, Math.round(sw / targetAr));
      sy = sy + Math.floor((sh - newSh) / 2);
      sh = newSh;
    }
  }

  let tw = sw;
  let th = sh;
  const longest = Math.max(tw, th);
  if (longest > SEEDANCE_IMAGE_UPLOAD_MAX_DIMENSION) {
    const s = SEEDANCE_IMAGE_UPLOAD_MAX_DIMENSION / longest;
    tw = Math.max(1, Math.round(tw * s));
    th = Math.max(1, Math.round(th * s));
  }
  const scaleDown = Math.min(1, SEEDANCE_IMAGE_MAX_SIDE / tw, SEEDANCE_IMAGE_MAX_SIDE / th);
  tw = Math.max(1, Math.round(tw * scaleDown));
  th = Math.max(1, Math.round(th * scaleDown));

  if (tw < SEEDANCE_IMAGE_MIN_SIDE || th < SEEDANCE_IMAGE_MIN_SIDE) {
    const scaleUp = Math.max(SEEDANCE_IMAGE_MIN_SIDE / tw, SEEDANCE_IMAGE_MIN_SIDE / th);
    const capped = Math.min(scaleUp, SEEDANCE_IMAGE_MAX_SIDE / tw, SEEDANCE_IMAGE_MAX_SIDE / th);
    tw = Math.max(1, Math.round(tw * capped));
    th = Math.max(1, Math.round(th * capped));
  }

  const resized = tw !== nw || th !== nh || sw !== nw || sh !== nh;

  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2d not available');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, tw, th);

  const qualities = [0.92, 0.85, 0.78, 0.7, 0.62, 0.54, 0.46, 0.38];
  let best: { dataUrl: string; bytes: number } | null = null;
  for (const q of qualities) {
    const out = await canvasToJpegDataUrl(canvas, q);
    best = out;
    if (out.bytes <= SEEDANCE_IMAGE_MAX_BYTES) {
      return {
        dataUrl: out.dataUrl,
        width: tw,
        height: th,
        resized,
        bytes: out.bytes,
      };
    }
  }
  if (!best) throw new Error('prepareImageForSeedanceModelUpload failed');
  return { dataUrl: best.dataUrl, width: tw, height: th, resized, bytes: best.bytes };
}

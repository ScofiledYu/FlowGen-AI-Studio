/**
 * 图片压缩工具：展示/持久化用压缩图，上传时由 FlowEditor 优先使用原图（同会话内外都拖入的 File）。
 * 常规预览：限制最长边 + JPEG 质量。
 * 超大图（>30MB）：保持像素尺寸，仅降低 JPEG 质量直至 ≤30MB（对齐 Seedance 单图上限，减轻画布序列化卡顿）。
 */

/** 画布节点主预览：超过此体积则触发「保尺寸压到该上限」 */
export const CANVAS_PREVIEW_MAX_BYTES = 30 * 1024 * 1024;

const DEFAULT_MAX_DIMENSION = 1536;
const DEFAULT_QUALITY = 0.82;

/**
 * 将 File 或 dataURL 压缩后返回 dataURL。
 * @param input File 或 dataURL 字符串
 * @param options maxDimension 最长边像素，quality JPEG 质量 0-1
 */
export function compressImageForPreview(
  input: File | string,
  options?: { maxDimension?: number; quality?: number }
): Promise<string> {
  const maxDimension = options?.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const quality = options?.quality ?? DEFAULT_QUALITY;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w <= maxDimension && h <= maxDimension) {
          w = img.naturalWidth;
          h = img.naturalHeight;
        } else {
          if (w > h) {
            h = Math.round((h * maxDimension) / w);
            w = maxDimension;
          } else {
            w = Math.round((w * maxDimension) / h);
            h = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2d not available'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('toBlob failed'));
              return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          },
          'image/jpeg',
          quality
        );
      } catch (e) {
        reject(e);
      }
    };

    img.onerror = () => reject(new Error('Image load failed'));

    if (typeof input === 'string') {
      img.src = input;
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

/**
 * 判断是否已是小图（可跳过压缩）：dataURL 长度小于约 200KB 或已是 jpeg 且较短。
 */
export function shouldSkipCompress(dataUrl: string, thresholdBytes = 200 * 1024): boolean {
  if (!dataUrl || !dataUrl.startsWith('data:')) return true;
  return estimateDataUrlBytes(dataUrl) <= thresholdBytes;
}

/** 侧栏/参考区写入：blob 转 dataURL，大图压缩，避免 blob 被清理或失效后裂图 */
export async function normalizeInspectorIngestImageUrl(url: string): Promise<string> {
  const u = (url || '').trim();
  if (!u) return u;
  if (u.startsWith('blob:') || !shouldSkipCompress(u)) {
    try {
      return await compressImageForPreview(u);
    } catch {
      return u;
    }
  }
  return u;
}

export function estimateDataUrlBytes(dataUrl: string): number {
  if (!dataUrl || !dataUrl.startsWith('data:')) return 0;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return 0;
  const base64Length = dataUrl.length - comma - 1;
  return Math.floor((base64Length * 3) / 4);
}

function loadImageElement(input: File | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    if (typeof input === 'string') {
      img.src = input;
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

/**
 * 保持原始宽高，通过调节 JPEG 质量将体积压到 maxBytes 以下（用于 >30MB 的本地/资产库入画布）。
 */
export async function compressImagePreserveDimensionsToMaxBytes(
  input: File | string,
  maxBytes: number = CANVAS_PREVIEW_MAX_BYTES
): Promise<string> {
  const img = await loadImageElement(input);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error('Invalid image dimensions');

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2d not available');
  ctx.drawImage(img, 0, 0, w, h);

  let best: { dataUrl: string; bytes: number } | null = null;
  const qualities = [0.92, 0.85, 0.78, 0.7, 0.62, 0.54, 0.46, 0.38, 0.3, 0.22, 0.15];
  for (const q of qualities) {
    const out = await canvasToJpegDataUrl(canvas, q);
    best = out;
    if (out.bytes <= maxBytes) return out.dataUrl;
  }

  if (best) {
    console.warn(
      `[flowgen] 图片已压至最低质量仍约 ${(best.bytes / 1024 / 1024).toFixed(1)}MB（目标 ≤${(maxBytes / 1024 / 1024).toFixed(0)}MB），已使用最小体积版本`
    );
    return best.dataUrl;
  }
  throw new Error('compressImagePreserveDimensionsToMaxBytes failed');
}

import { isPersistableMediaUrl } from './workspaceMediaPersist';

/**
 * 画布新建/替换主预览：常规最长边压缩；已是 /flowgen-api 或 http(s) 时原样返回。
 * 不再对 >30MB 本地图做「保尺寸压到 30MB」的二次压缩。
 */
export async function prepareCanvasNodeImagePreview(input: File | string): Promise<string> {
  if (typeof input === 'string') {
    if (isPersistableMediaUrl(input)) return input.trim();
    if (!input.startsWith('data:')) return input;
    return shouldSkipCompress(input) ? input : compressImageForPreview(input);
  }
  return compressImageForPreview(input);
}

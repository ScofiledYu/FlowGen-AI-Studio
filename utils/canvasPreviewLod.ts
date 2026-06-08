import { isFlowgenProtectedAssetFileUrl, resolveDisplayMediaUrl } from '../services/flowgenApi';

/** 画布节点主预览 LOD：越远越轻（thumb + 无 blur），近处全清 */
export type CanvasPreviewLod = 'low' | 'medium' | 'high';

/** 量化 zoom，减少滚轮时全图节点频繁换档 */
export function quantizeCanvasZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1;
  if (zoom < 0.28) return 0.2;
  if (zoom < 0.55) return 0.45;
  return 1;
}

export function zoomToCanvasPreviewLod(zoom: number, selected = false): CanvasPreviewLod {
  if (selected) return 'high';
  const z = quantizeCanvasZoom(zoom);
  if (z < 0.28) return 'low';
  if (z < 0.55) return 'medium';
  return 'high';
}

function flowgenFilePathOnly(raw: string): string {
  const pathOnly = (() => {
    try {
      return raw.startsWith('http') ? new URL(raw).pathname : raw.split('?')[0];
    } catch {
      return raw.split('?')[0];
    }
  })();
  if (!isFlowgenProtectedAssetFileUrl(pathOnly)) return '';
  let path = pathOnly;
  if (/\/thumb$/i.test(path)) {
    path = path.replace(/\/thumb$/i, '/file');
  }
  return path;
}

/** 低档位优先 thumb（更小），中/高用 file；平移时由 CSS 再降级 */
export function resolveLodNodePreviewSrc(
  storedPreview: string | undefined | null,
  lod: CanvasPreviewLod
): string {
  const raw = typeof storedPreview === 'string' ? storedPreview.trim() : '';
  if (!raw) return '';
  if (raw.startsWith('blob:') || raw.startsWith('data:')) {
    return raw;
  }
  const filePath = flowgenFilePathOnly(raw);
  if (filePath) {
    const path =
      lod === 'low' ? filePath.replace(/\/file$/i, '/thumb') : filePath;
    return resolveDisplayMediaUrl(path);
  }
  return resolveDisplayMediaUrl(raw);
}

/** 不用 blur 滤镜（多节点时 GPU 卡顿）；靠 thumb + 透明度区分档位 */
export function canvasPreviewLodImageClass(lod: CanvasPreviewLod): string {
  switch (lod) {
    case 'low':
      return 'opacity-80';
    case 'medium':
      return 'opacity-92';
    default:
      return '';
  }
}

export function shouldRenderNodeThumbnailStrip(lod: CanvasPreviewLod): boolean {
  return lod !== 'low';
}

export function maxThumbnailsForLod(lod: CanvasPreviewLod, total: number): number {
  if (total <= 0) return 0;
  if (lod === 'low') return 0;
  if (lod === 'medium') return Math.min(2, total);
  return total;
}

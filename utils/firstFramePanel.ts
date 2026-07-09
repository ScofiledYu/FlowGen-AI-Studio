import type { NodeData } from '../types';
import {
  flowgenAssetFileUrlFromMediaUrl,
  isFlowgenAssetThumbUrl,
  resolveDisplayMediaUrl,
} from '../services/flowgenApi';
import { isLikelyMainVideoUrl } from './promptMediaRefs';
import { isEphemeralMediaUrl, isPersistableMediaUrl } from './workspaceMediaPersist';
import { projectAssetDisplayNameFromUrl, type ProjectAssetLabelRow } from './referenceImageSlotLabels';

export type FirstFramePanelContext = {
  seedanceMode?: string;
  klingOmniTab?: string;
  projectAssets?: ProjectAssetLabelRow[];
};

/** 首尾帧类模型当前面板是否应展示/维护首帧槽 */
export function needsFirstFramePanelModel(
  data: Partial<NodeData>,
  ctx: FirstFramePanelContext = {}
): boolean {
  const model = String(data.selectedModel || '').trim();
  if (
    model === '可灵 2.5 Turbo' ||
    model === 'vidu 2.0' ||
    model === 'seedance1.5-pro' ||
    model === '即梦3.0 Pro'
  ) {
    return true;
  }
  if (
    (model === 'seedance2.0 (高质量版)' || model === 'seedance2.0 (急速版)') &&
    (ctx.seedanceMode || data.seedanceGenerationMode || 'text') === 'image'
  ) {
    return true;
  }
  if (model === '可灵3.0 Omni' && (ctx.klingOmniTab || data.klingOmniTab || 'multi') === 'frames') {
    return true;
  }
  return false;
}

/** 首尾帧槽展示：本地 blob/data 优先，避免残留 COS URL 盖住新上传图导致裂图 */
export function resolveFirstFramePanelPreviewUrl(
  imageUrl?: string | null,
  imageData?: string | null,
  fallbackMainPreview?: string | null
): string | undefined {
  const url = String(imageUrl || '').trim();
  const data = String(imageData || '').trim();
  const fallback = String(fallbackMainPreview || '').trim();
  const fallbackResolved =
    fallback && !isLikelyMainVideoUrl(fallback)
      ? resolveDisplayMediaUrl(
          isFlowgenAssetThumbUrl(fallback) ? flowgenAssetFileUrlFromMediaUrl(fallback) : fallback
        )
      : undefined;

  if (data && data.startsWith('blob:')) {
    if (fallbackResolved && isPersistableMediaUrl(fallback)) return fallbackResolved;
    return data;
  }
  if (data && /^data:image\//i.test(data)) {
    const resolved = resolveDisplayMediaUrl(data);
    if (resolved) return resolved;
  }
  if (url && isPersistableMediaUrl(url)) {
    const resolved = resolveDisplayMediaUrl(url);
    if (resolved) return resolved;
  }
  if (data) {
    const resolved = resolveDisplayMediaUrl(data);
    if (resolved) return resolved;
  }
  if (url && url.startsWith('blob:')) {
    if (fallbackResolved && isPersistableMediaUrl(fallback)) return fallbackResolved;
    return url;
  }
  if (url) {
    const resolved = resolveDisplayMediaUrl(url);
    if (resolved) return resolved;
  }
  if (fallbackResolved) return fallbackResolved;
  return undefined;
}

export function hasFirstFramePanelSlot(data: Partial<NodeData>): boolean {
  return Boolean(
    String(data.firstFrameImage || '').trim() ||
      String(data.firstFrameImageUrl || '').trim() ||
      String(data.firstFrameLocalRef || '').trim()
  );
}

export function isFirstFramePanelRenderable(
  data: Partial<NodeData>,
  fallbackMainPreview?: string | null
): boolean {
  const first = String(data.firstFrameImage || '').trim();
  const firstUrl = String(data.firstFrameImageUrl || '').trim();
  const main = String(fallbackMainPreview || data.imagePreview || '').trim();

  if (String(data.firstFrameLocalRef || '').trim()) {
    return Boolean(resolveFirstFramePanelPreviewUrl(data.firstFrameImageUrl, data.firstFrameImage));
  }

  const resolved = resolveFirstFramePanelPreviewUrl(data.firstFrameImageUrl, data.firstFrameImage);
  if (!resolved) return false;

  if (
    first.startsWith('blob:') &&
    main &&
    !main.startsWith('blob:') &&
    !/^data:/i.test(main)
  ) {
    return false;
  }

  if (
    !firstUrl &&
    first.startsWith('blob:') &&
    main &&
    (/^https?:\/\//i.test(main) || main.startsWith('/flowgen-api/'))
  ) {
    return false;
  }

  return true;
}

export function patchFirstFrameFromPreviewUpdate(img?: string): {
  firstFrameImage?: string;
  firstFrameImageUrl?: string;
  firstFrameLocalRef?: string;
} {
  if (!img) {
    return {
      firstFrameImage: undefined,
      firstFrameImageUrl: undefined,
      firstFrameLocalRef: undefined,
    };
  }
  if (/^https?:\/\//i.test(img) || img.startsWith('/flowgen-api/')) {
    return { firstFrameImage: img, firstFrameImageUrl: img, firstFrameLocalRef: undefined };
  }
  return { firstFrameImage: img, firstFrameImageUrl: undefined, firstFrameLocalRef: undefined };
}

/** 主预览为图片且首帧槽为空/不可渲染时，写入首帧默认 patch（不覆盖用户已有可渲染首帧） */
export function buildFirstFrameDefaultFillPatch(
  data: Partial<NodeData>,
  ctx: FirstFramePanelContext = {}
): Partial<NodeData> | null {
  const main = String(data.imagePreview || '').trim();
  const localMainRef = String(data.imageLocalRef || '').trim();
  if ((!main && !localMainRef) || (main && isLikelyMainVideoUrl(main))) return null;
  if (!needsFirstFramePanelModel(data, ctx)) return null;

  const hasSlot = hasFirstFramePanelSlot(data);
  const renderable = isFirstFramePanelRenderable(data, main);
  if (hasSlot && renderable) return null;

  const frameMain = main
    ? isFlowgenAssetThumbUrl(main)
      ? flowgenAssetFileUrlFromMediaUrl(main)
      : main
    : '';
  const patch: Partial<NodeData> = {};

  if (
    localMainRef &&
    (!main || main.startsWith('blob:') || isEphemeralMediaUrl(main, 'firstFrameImage'))
  ) {
    patch.firstFrameLocalRef = localMainRef;
    patch.firstFrameImage = undefined;
    patch.firstFrameImageUrl = undefined;
  } else if (frameMain) {
    Object.assign(patch, patchFirstFrameFromPreviewUpdate(frameMain));
  } else {
    return null;
  }

  const frameLabel =
    projectAssetDisplayNameFromUrl(frameMain, ctx.projectAssets) ||
    projectAssetDisplayNameFromUrl(main, ctx.projectAssets) ||
    '';
  if (frameLabel) patch.firstFrameImageLabel = frameLabel;

  return Object.keys(patch).length > 0 ? patch : null;
}

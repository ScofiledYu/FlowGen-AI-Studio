/**
 * Generated Outputs 历史：Node Details 打开时用左右键切换相邻条目。
 * 切换时必须用该条缩略图上的 generationParams 快照重建整份 Details（非仅换左侧预览）。
 */

export type GeneratedThumbNavItem = {
  id: string;
  url: string;
  type: 'image' | 'video';
  nodeId?: string;
  name?: string;
  generationParams?: Record<string, unknown> | null;
  posterDataUrl?: string;
};

export type PreviewIdentity = {
  id?: string;
  imagePreview?: string;
  /** 打开预览时记录的 thumb.id，优先用于定位当前历史项 */
  activeThumbId?: string | null;
};

/** 当前预览对应哪一张历史缩略图 */
export function findGeneratedThumbIndex(
  thumbs: GeneratedThumbNavItem[] | undefined,
  preview: PreviewIdentity | null | undefined
): number {
  if (!thumbs?.length || !preview) return -1;
  const activeThumbId = String(preview.activeThumbId || '').trim();
  if (activeThumbId) {
    const byActive = thumbs.findIndex((t) => t.id === activeThumbId);
    if (byActive >= 0) return byActive;
  }
  const pid = String(preview.id || '').trim();
  if (pid) {
    const byId = thumbs.findIndex((t) => t.id === pid);
    if (byId >= 0) return byId;
    const byNodeId = thumbs.findIndex((t) => t.nodeId && t.nodeId === pid);
    if (byNodeId >= 0) return byNodeId;
  }
  const url = String(preview.imagePreview || '').trim();
  if (url) {
    const byUrl = thumbs.findIndex((t) => String(t.url || '').trim() === url);
    if (byUrl >= 0) return byUrl;
  }
  return -1;
}

export type ThumbNavDirection = 'prev' | 'next';

/**
 * 计算左右键目标下标。
 * @param wrap 默认 true：到头循环（2 条历史时左右都能切）
 */
export function resolveAdjacentGeneratedThumbIndex(
  length: number,
  currentIndex: number,
  direction: ThumbNavDirection,
  wrap = true
): number | null {
  if (length < 2 || currentIndex < 0 || currentIndex >= length) return null;
  if (direction === 'prev') {
    if (currentIndex > 0) return currentIndex - 1;
    return wrap ? length - 1 : null;
  }
  if (currentIndex < length - 1) return currentIndex + 1;
  return wrap ? 0 : null;
}

/** 在拥有 generatedThumbnails 的源节点上，根据当前预览解析导航目标缩略图 */
export function resolveGeneratedThumbNavTarget(
  thumbs: GeneratedThumbNavItem[] | undefined,
  preview: PreviewIdentity | null | undefined,
  direction: ThumbNavDirection,
  wrap = true
): GeneratedThumbNavItem | null {
  if (!thumbs?.length) return null;
  const cur = findGeneratedThumbIndex(thumbs, preview);
  const next = resolveAdjacentGeneratedThumbIndex(thumbs.length, cur, direction, wrap);
  if (next == null) return null;
  return thumbs[next] || null;
}

export type BuiltHistoryPreviewNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
};

/**
 * 用历史缩略图快照构建整份 Node Details 用的预览节点（不依赖画布上 MOV 的当前态）。
 * Details 的 prompt / 参考图 / Used Parameters 全部来自 thumb.generationParams。
 */
export function buildNodeDetailsPreviewFromGeneratedThumb(
  thumb: GeneratedThumbNavItem,
  opts?: { position?: { x: number; y: number }; fallbackModel?: string }
): BuiltHistoryPreviewNode {
  const gp = (thumb.generationParams && typeof thumb.generationParams === 'object'
    ? { ...thumb.generationParams }
    : {}) as Record<string, unknown>;
  const isVideo = thumb.type === 'video';
  const displayName =
    (thumb.name && String(thumb.name).trim()) ||
    (isVideo ? 'Video.mov' : 'Generated.png');
  const model =
    String(gp.model || opts?.fallbackModel || '').trim() || undefined;
  const taskId = String(gp.taskId || '').trim() || undefined;
  const poster = String(thumb.posterDataUrl || gp.videoPosterDataUrl || '').trim();

  return {
    id: thumb.id,
    type: isVideo ? 'movNode' : 'outputNode',
    position: opts?.position || { x: 0, y: 0 },
    data: {
      label: isVideo ? 'Output Mov Node' : 'Output Picture Node',
      imagePreview: thumb.url,
      imageName: displayName,
      customName: displayName,
      selectedModel: model,
      generationParams: gp,
      taskId,
      status: 'completed',
      ...(poster ? { videoPosterDataUrl: poster } : {}),
      // 面板字段从 gp 展开，保证 Details 右侧整页与该条历史一致
      prompt: gp.prompt,
      negativePrompt: gp.negativePrompt,
      referenceImages: gp.referenceImages,
      referenceImageLabels: gp.referenceImageLabels,
      referenceMovs: gp.referenceMovs,
      referenceAudios: gp.referenceAudios,
      firstFrameImage: gp.firstFrameImage,
      lastFrameImage: gp.lastFrameImage,
      firstFrameImageUrl: gp.firstFrameImageUrl,
      lastFrameImageUrl: gp.lastFrameImageUrl,
      jimengImages: gp.jimengImages,
      seedanceGenerationMode: gp.seedanceGenerationMode,
      seedanceAspectRatio: gp.seedanceAspectRatio,
      seedanceResolution: gp.seedanceResolution,
      seedanceDuration: gp.seedanceDuration,
      numberOfImages: gp.numberOfImages,
      aspectRatio: gp.aspectRatio,
      resolution: gp.resolution,
      generatedAt: gp.generatedAt,
      klingOmniTab: gp.klingOmniTab,
      jimengGenerationMode: gp.jimengGenerationMode,
    },
  };
}

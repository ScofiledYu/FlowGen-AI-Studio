import type { GenerationParams, NodeData } from '../types';
import {
  MODEL_IMAGE_2,
  MODEL_NANO_BANANA_2,
  NodeType,
  isImage2Model,
  isNanoBanana2Model,
} from '../types';
import {
  getSeedanceDefaultResolution,
  normalizeSeedanceAspectForTextRef,
} from './seedanceAspectRatio';
import { SEEDANCE_DURATION_DEFAULT_LABEL } from './seedanceDuration';
import {
  buildReferenceImageDetailItemsFromPanel,
  isDuplicateOfMainImagePreview,
  isLikelyMainVideoUrl,
  panelReferenceSlotLabel,
  promptMentionsMainImageForNodeData,
  type ReferenceImageDetailItem,
} from './promptMediaRefs';
import {
  panelRefDisplayDedupeKey,
  projectAssetMediaPairKeyFromUrl,
  resolvePanelReferenceSlotDisplayUrl,
  type ProjectAssetLabelRow,
} from './referenceImageSlotLabels';
import { parseProjectAssetIdsFromMediaUrl } from './projectAssetPreview';

export type { ReferenceImageDetailItem };

function normalizeDetailImageUrlKey(url: string): string {
  const u = String(url || '').trim();
  if (!u) return '';
  const pair = projectAssetMediaPairKeyFromUrl(u);
  if (pair) return pair.toLowerCase();
  const m = u.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (m) return m[0].toLowerCase();
  return u
    .split('?')[0]
    .split('#')[0]
    .replace(/\/thumb(\?.*)?$/i, '/file$1')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function poolIndexForLabeledAsset(
  label: string,
  pool: string[],
  used: Set<number>,
  projectAssets?: ProjectAssetLabelRow[]
): number {
  const cap = label.trim();
  if (!cap || !projectAssets?.length) return -1;
  const row = projectAssets.find((a) => a.slug === cap || a.name.trim() === cap);
  const lib = row?.url?.trim();
  if (!lib) return -1;
  const libKey = projectAssetMediaPairKeyFromUrl(lib);
  const libNk = normalizeDetailImageUrlKey(lib);
  let idx = pool.findIndex(
    (p, i) => !used.has(i) && normalizeDetailImageUrlKey(p) === normalizeDetailImageUrlKey(lib)
  );
  if (idx < 0) {
    idx = pool.findIndex((p, i) => !used.has(i) && normalizeDetailImageUrlKey(p) === libNk);
  }
  if (idx < 0 && libKey) {
    idx = pool.findIndex((p, i) => {
      if (used.has(i)) return false;
      const ids = parseProjectAssetIdsFromMediaUrl(p);
      return Boolean(ids && `${ids.projectId}/${ids.assetId}` === libKey);
    });
  }
  return idx;
}

function isNamedAssetDetailLabel(label: string): boolean {
  const cap = label.trim();
  return Boolean(cap) && !/^(图片\d+|主图|主视频|首帧图|尾帧图)$/.test(cap);
}

function detailUrlKeysMatch(
  a: string,
  aLabel: string | undefined,
  b: string,
  bLabel: string | undefined,
  projectAssets?: ProjectAssetLabelRow[]
): boolean {
  const ka = panelRefDisplayDedupeKey(a, aLabel, projectAssets);
  const kb = panelRefDisplayDedupeKey(b, bLabel, projectAssets);
  return Boolean(ka && kb && ka === kb);
}

/** 多图参考模型且未 @主图、面板已隐藏主图格（误拖主预览仅作画布/聊天兜底，不进 Details/API 池） */
export function nodeUsesHiddenMainPreviewSlot(data: Partial<NodeData>): boolean {
  if (data.panelMainSlotVisible !== false) return false;
  if (promptMentionsMainImageForNodeData(data)) return false;
  const model = String(data.selectedModel || '').trim();
  if (model === MODEL_NANO_BANANA_2 || model === MODEL_IMAGE_2) return true;
  return (
    (model === 'seedance2.0 (高质量版)' || model === 'seedance2.0 (急速版)') &&
    (data.seedanceGenerationMode || 'text') === 'reference'
  );
}

/** 未 @主图且主图格已隐藏时，不把 imagePreview 并入 Details 的 url 池 */
export function shouldIncludeImagePreviewInNodeDetailsUrlPool(data: Partial<NodeData>): boolean {
  if (!nodeUsesHiddenMainPreviewSlot(data)) return true;
  return false;
}

/**
 * Node Details 左侧大图：参考生且主图格已隐藏时，不展示与参考列表无关的 imagePreview（如误拖入的健身房图）。
 */
export function resolveNodeDetailsHeroImageUrl(
  data: Partial<NodeData>,
  options?: {
    referenceImageDetailItems?: ReferenceImageDetailItem[];
    projectAssets?: ProjectAssetLabelRow[];
  }
): string | undefined {
  const main = String(data.imagePreview || '').trim();
  if (!nodeUsesHiddenMainPreviewSlot(data)) return main || undefined;

  const items = options?.referenceImageDetailItems || [];
  if (!main) return items[0]?.url?.trim() || undefined;
  if (!items.length) return undefined;

  const pa = options?.projectAssets;
  const mainKey = panelRefDisplayDedupeKey(main, data.imageName, pa);
  const inRefs = items.some((it) => {
    const k = panelRefDisplayDedupeKey(it.url, it.label, pa);
    return Boolean(mainKey && k && mainKey === k);
  });
  if (inRefs) return main;
  return items[0]?.url?.trim() || undefined;
}

/** 画布选中 / 聊天侧栏节点预览：与 Node Details 大图同一套规则，避免误拖主预览（如猫图）盖住 @ 参考图 */
export function resolveNodeSelectionPreviewUrl(
  data: Partial<NodeData>,
  projectAssets?: ProjectAssetLabelRow[]
): string | undefined {
  const items = buildReferenceImageDetailItemsFromPanel(data, { projectAssets });
  return resolveNodeDetailsHeroImageUrl(data, {
    referenceImageDetailItems: items,
    projectAssets,
  });
}

/** 用运行快照 / 合并池中的 URL 替换面板项，保留属性面板标签与顺序 */
export function resolveReferenceImageDetailItemsWithUrlPool(
  items: ReferenceImageDetailItem[],
  urlPool: string[],
  options?: { projectAssets?: ProjectAssetLabelRow[] }
): ReferenceImageDetailItem[] {
  const pool = urlPool.map((u) => String(u || '').trim()).filter(Boolean);
  const used = new Set<number>();
  return items.map((item) => {
    const correctedUrl = options?.projectAssets?.length
      ? resolvePanelReferenceSlotDisplayUrl(item.url, item.label, options.projectAssets)
      : item.url;

    const byLabel = poolIndexForLabeledAsset(item.label, pool, used, options?.projectAssets);
    if (byLabel >= 0) {
      const poolUrl = pool[byLabel];
      if (
        detailUrlKeysMatch(
          correctedUrl,
          item.label,
          poolUrl,
          item.label,
          options?.projectAssets
        )
      ) {
        used.add(byLabel);
        return { ...item, url: poolUrl };
      }
    }

    const nk = normalizeDetailImageUrlKey(correctedUrl);
    const idx = pool.findIndex((p, i) => !used.has(i) && normalizeDetailImageUrlKey(p) === nk);
    if (idx >= 0) {
      const poolUrl = pool[idx];
      if (
        isNamedAssetDetailLabel(item.label) &&
        options?.projectAssets?.length &&
        !detailUrlKeysMatch(correctedUrl, item.label, poolUrl, item.label, options.projectAssets)
      ) {
        return { ...item, url: correctedUrl };
      }
      used.add(idx);
      return { ...item, url: poolUrl };
    }
    return { ...item, url: correctedUrl };
  });
}

/** Node Details：面板顺序 + 底栏标签 + 用 urlPool 解析为运行后 COS URL */
export function buildNodeDetailsReferencePreview(input: {
  panelSource: Partial<NodeData>;
  urlPool: string[];
  filterItem?: (item: ReferenceImageDetailItem) => boolean;
  maxItems?: number;
  projectAssets?: ProjectAssetLabelRow[];
}): { referenceImages: string[]; referenceImageDetailItems: ReferenceImageDetailItem[] } {
  let detailItems = buildReferenceImageDetailItemsFromPanel(input.panelSource, {
    projectAssets: input.projectAssets,
  });
  detailItems = resolveReferenceImageDetailItemsWithUrlPool(detailItems, input.urlPool, {
    projectAssets: input.projectAssets,
  });
  if (input.filterItem) {
    detailItems = detailItems.filter(input.filterItem);
  }
  if (input.maxItems != null && input.maxItems > 0) {
    detailItems = detailItems.slice(0, input.maxItems);
  }
  return {
    referenceImages: detailItems.map((i) => i.url),
    referenceImageDetailItems: detailItems,
  };
}

/** Node Details / 运行快照：referenceMovs 的 poster 须为可渲染图片，不能是视频 URL 或与视频同 URL */
export function isUsableReferenceMovPoster(poster?: string, videoUrl?: string): boolean {
  const p = String(poster || '').trim();
  if (!p) return false;
  const v = String(videoUrl || '').trim();
  if (v && p === v) return false;
  if (isLikelyMainVideoUrl(p)) return false;
  if (/^data:image\//i.test(p)) return true;
  if (/^data:video\//i.test(p)) return false;
  if (/\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/i.test(p)) return true;
  if (p.startsWith('blob:')) return true;
  if (/^https?:\/\//i.test(p)) {
    if (/video/i.test(p) && !/\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(p)) return false;
    return true;
  }
  return /^data:/i.test(p) && !/^data:video\//i.test(p);
}

export function pickReferenceMovPoster(
  videoUrl: string,
  ...candidates: (string | undefined)[]
): string | undefined {
  const v = String(videoUrl || '').trim();
  if (!v) return undefined;
  for (const c of candidates) {
    if (isUsableReferenceMovPoster(c, v)) return String(c).trim();
  }
  return undefined;
}

export function hasDetailValue(v: unknown): boolean {
  return v !== undefined && v !== null && !(typeof v === 'string' && !v.trim());
}

export type NodeDetailsPickContext = {
  isOutputLike: boolean;
  runGp: GenerationParams;
  upstreamGp: GenerationParams;
  ancestorData?: Partial<NodeData>;
  selfData: Partial<NodeData>;
};

/** 与 FlowEditor Node Details 中 pickNodeDetailsParam 一致 */
export function pickNodeDetailsParam<T>(
  ctx: NodeDetailsPickContext,
  key: keyof NodeData & keyof GenerationParams
): T | undefined {
  const { isOutputLike, runGp, upstreamGp, ancestorData, selfData } = ctx;
  const fromRun = runGp[key as keyof GenerationParams] as T | undefined;
  const fromUpstreamGp = upstreamGp[key as keyof GenerationParams] as T | undefined;
  const fromUpstream = ancestorData?.[key as keyof NodeData] as T | undefined;
  const fromSelf = selfData[key as keyof NodeData] as T | undefined;
  if (isOutputLike) {
    if (hasDetailValue(fromRun)) return fromRun;
    if (hasDetailValue(fromUpstreamGp)) return fromUpstreamGp;
    if (hasDetailValue(fromUpstream)) return fromUpstream;
    return hasDetailValue(fromSelf) ? fromSelf : undefined;
  }
  if (hasDetailValue(fromSelf)) return fromSelf;
  if (hasDetailValue(fromRun)) return fromRun;
  return hasDetailValue(fromUpstream) ? fromUpstream : undefined;
}

/** 运行完成时写入 generationParams，保证输出节点 Node Details 能还原上游面板参数 */
export function applyRunPanelFieldsToGenerationParams(
  generationParams: GenerationParams,
  snap: Partial<NodeData>,
  model: string
): void {
  generationParams.model = model;
  if (snap.prompt != null) generationParams.prompt = snap.prompt;
  if (snap.negativePrompt != null) generationParams.negativePrompt = snap.negativePrompt;
  if (snap.numberOfImages != null) generationParams.numberOfImages = snap.numberOfImages;
  if (isNanoBanana2Model(model)) {
    generationParams.aspectRatio = snap.aspectRatio || '1:1';
    generationParams.resolution = snap.resolution || '1K';
  } else if (isImage2Model(model)) {
    generationParams.image2AspectRatio = snap.image2AspectRatio || '1:1';
    generationParams.image2ImageSize = snap.image2ImageSize || '1024x1024';
    generationParams.image2Style = snap.image2Style === 'natural' ? 'natural' : 'vivid';
    generationParams.aspectRatio = generationParams.image2AspectRatio;
    generationParams.resolution = generationParams.image2ImageSize;
  }
}

export type BuildRunGenerationParamsOptions = {
  /** 与 handleNodeRun 中 runCaptureForGp 一致（如 Seedance 图生实际比例） */
  runCapture?: Partial<GenerationParams>;
  jimengMergedImages?: string[];
  jimengFirstFrameUrlForUi?: string;
};

/**
 * 模拟 handleNodeRun 写入 output.generationParams 的模型分支（不含 reference 上传合并）。
 */
export function buildGenerationParamsFromRunSnapshot(
  snap: Partial<NodeData>,
  modelName: string,
  options: BuildRunGenerationParamsOptions = {}
): GenerationParams {
  const generationParams: GenerationParams = {
    model: modelName,
    prompt: snap.prompt,
    negativePrompt: snap.negativePrompt,
  };
  const runCapture = options.runCapture || {};

  if (modelName === '可灵3.0 Omni') {
    const kt = snap.klingOmniTab || 'multi';
    generationParams.prompt =
      kt === 'multi'
        ? (snap.klingOmniMultiPrompt ?? snap.prompt ?? '')
        : kt === 'instruction'
          ? (snap.klingOmniInstructionPrompt ?? snap.prompt ?? '')
          : kt === 'video'
            ? (snap.klingOmniVideoPrompt ?? snap.prompt ?? '')
            : (snap.klingOmniFramesPrompt ?? snap.prompt ?? '');
    generationParams.negativePrompt =
      kt === 'multi'
        ? (snap.klingOmniMultiNegativePrompt ?? snap.negativePrompt ?? '')
        : kt === 'instruction'
          ? (snap.klingOmniInstructionNegativePrompt ?? snap.negativePrompt ?? '')
          : kt === 'video'
            ? (snap.klingOmniVideoNegativePrompt ?? snap.negativePrompt ?? '')
            : (snap.klingOmniFramesNegativePrompt ?? snap.negativePrompt ?? '');
    (generationParams as GenerationParams & { klingOmniTab?: string }).klingOmniTab = kt;
    if (snap.klingOmniInstructionVideoUrl || snap.klingOmniInstructionVideoPreviewUrl) {
      (generationParams as GenerationParams & { klingOmniInstructionVideoUrl?: string }).klingOmniInstructionVideoUrl =
        snap.klingOmniInstructionVideoUrl || snap.klingOmniInstructionVideoPreviewUrl;
    }
    if (snap.klingOmniVideoUrl || snap.klingOmniVideoPreviewUrl) {
      (generationParams as GenerationParams & { klingOmniVideoUrl?: string }).klingOmniVideoUrl =
        snap.klingOmniVideoUrl || snap.klingOmniVideoPreviewUrl;
    }
  }

  if (modelName.includes('即梦')) {
    generationParams.duration = snap.duration || '5s';
    generationParams.jimengResolution = snap.jimengResolution || '1080p';
    generationParams.jimengVideoRatio = snap.jimengVideoRatio || '自动匹配';
    generationParams.jimengGenerationMode = snap.jimengGenerationMode || 'image';
    generationParams.quality = snap.jimengResolution === '720p' ? '720p' : '1080p';
    generationParams.firstFrameImage =
      snap.firstFrameImage || snap.firstFrameImageUrl || undefined;
    generationParams.firstFrameImageUrl =
      options.jimengFirstFrameUrlForUi ||
      snap.firstFrameImageUrl ||
      undefined;
    generationParams.jimengImages = options.jimengMergedImages?.length
      ? [...options.jimengMergedImages]
      : snap.jimengImages
        ? [...snap.jimengImages]
        : [];
  } else if (modelName.includes('可灵') || modelName.includes('Keling')) {
    generationParams.quality = snap.quality || '高质量';
    generationParams.duration = snap.duration || '5s';
    generationParams.aspectRatio = snap.aspectRatio || '1:1';
    generationParams.klingAudioSync = snap.klingAudioSync;
    generationParams.firstFrameImage = snap.firstFrameImage;
    generationParams.lastFrameImage = snap.lastFrameImage;
    generationParams.firstFrameImageUrl = snap.firstFrameImageUrl;
    generationParams.lastFrameImageUrl = snap.lastFrameImageUrl;
  } else if (modelName === 'vidu 2.0') {
    generationParams.aspectRatio = snap.aspectRatio || '16:9';
    generationParams.numberOfImages = snap.numberOfImages || '1条';
    generationParams.viduDuration = snap.viduDuration || '4s';
    generationParams.viduClarity = snap.viduClarity || '1080p';
    generationParams.viduMotionRange = snap.viduMotionRange || '自动';
    generationParams.firstFrameImage = snap.firstFrameImage;
    generationParams.lastFrameImage = snap.lastFrameImage;
    generationParams.firstFrameImageUrl = snap.firstFrameImageUrl;
    generationParams.lastFrameImageUrl = snap.lastFrameImageUrl;
  } else if (['seedance1.5-pro', 'seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(modelName)) {
    const isSeedance20Model = ['seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(modelName);
    const modeSnap = (snap.seedanceGenerationMode || 'text') as 'text' | 'image' | 'reference';
    const rawAsp = snap.seedanceAspectRatio;
    const appliedAsp =
      typeof runCapture.seedanceAspectRatio === 'string' ? runCapture.seedanceAspectRatio : undefined;
    generationParams.numberOfImages = snap.numberOfImages || '1条';
    generationParams.seedanceResolution =
      snap.seedanceResolution || getSeedanceDefaultResolution(modelName);
    generationParams.seedanceAspectRatio =
      isSeedance20Model && modeSnap !== 'image'
        ? normalizeSeedanceAspectForTextRef(
            appliedAsp || (rawAsp === '自动匹配' || !rawAsp ? undefined : rawAsp)
          )
        : rawAsp || '自动匹配';
    generationParams.seedanceDuration = snap.seedanceDuration || SEEDANCE_DURATION_DEFAULT_LABEL;
    generationParams.seedanceGenerateAudio = snap.seedanceGenerateAudio ?? false;
    generationParams.seedanceFixedCamera = isSeedance20Model
      ? undefined
      : (snap.seedanceFixedCamera ?? false);
    generationParams.seedanceGenerationMode = snap.seedanceGenerationMode || 'text';
    generationParams.seedanceReferenceRatioMode = isSeedance20Model
      ? (snap.seedanceReferenceRatioMode || 'force')
      : undefined;
    generationParams.seedanceReferenceWebSearch = isSeedance20Model
      ? (snap.seedanceReferenceWebSearch ??
          (snap as { seedanceImageWebSearch?: boolean }).seedanceImageWebSearch ??
          false)
      : undefined;
    generationParams.firstFrameImage = snap.firstFrameImage;
    generationParams.lastFrameImage = snap.lastFrameImage;
    generationParams.firstFrameImageUrl = snap.firstFrameImageUrl;
    generationParams.lastFrameImageUrl = snap.lastFrameImageUrl;
  } else if (isImage2Model(modelName)) {
    generationParams.image2AspectRatio = snap.image2AspectRatio || '1:1';
    generationParams.image2ImageSize = snap.image2ImageSize || '1024x1024';
    generationParams.image2Style = snap.image2Style === 'natural' ? 'natural' : 'vivid';
    generationParams.referenceImages = snap.referenceImages ? [...snap.referenceImages] : undefined;
  } else {
    generationParams.aspectRatio = snap.aspectRatio || '1:1';
    generationParams.resolution = snap.resolution || '1K';
  }

  applyRunPanelFieldsToGenerationParams(generationParams, snap, modelName);
  return generationParams;
}

export type NodeDetailsBaseParams = {
  prompt: string;
  negativePrompt: string;
  model: string;
  aspectRatio: string;
  resolution: string;
  numberOfImages: string;
  quality?: string;
  duration?: string;
  jimengResolution?: string;
  jimengVideoRatio?: string;
  jimengGenerationMode?: 'text' | 'image';
  viduDuration?: string;
  viduClarity?: string;
  viduMotionRange?: string;
  klingAudioSync?: boolean;
  seedanceResolution?: string;
  seedanceAspectRatio?: string;
  seedanceDuration?: string;
  seedanceGenerateAudio?: boolean;
  seedanceFixedCamera?: boolean;
  seedanceGenerationMode?: 'text' | 'image' | 'reference';
  seedanceReferenceWebSearch?: boolean;
  klingOmniTab?: 'multi' | 'instruction' | 'video' | 'frames';
};

function resolveOmniPromptForDetails(
  isOmni: boolean,
  isOutputLike: boolean,
  omniTab: string | undefined,
  d: Partial<NodeData>,
  g: GenerationParams,
  ancestorData?: Partial<NodeData>,
  upstreamGp?: GenerationParams
): { prompt: string; negativePrompt: string } {
  const pickNonEmpty = (...vals: Array<string | undefined>): string => {
    for (const v of vals) {
      if (typeof v === 'string' && v.trim().length > 0) return v;
    }
    return '';
  };
  if (!isOmni) {
    if (isOutputLike) {
      return {
        prompt: pickNonEmpty(g.prompt, ancestorData?.prompt, upstreamGp?.prompt),
        negativePrompt: pickNonEmpty(g.negativePrompt, ancestorData?.negativePrompt, upstreamGp?.negativePrompt),
      };
    }
    return {
      prompt: pickNonEmpty(g.prompt, d.prompt),
      negativePrompt: pickNonEmpty(g.negativePrompt, d.negativePrompt),
    };
  }
  const promptFromTab = () => {
    if (omniTab === 'multi') return d.klingOmniMultiPrompt ?? d.prompt ?? '';
    if (omniTab === 'instruction') return d.klingOmniInstructionPrompt ?? d.prompt ?? '';
    if (omniTab === 'video') return d.klingOmniVideoPrompt ?? d.prompt ?? '';
    return d.klingOmniFramesPrompt ?? d.prompt ?? '';
  };
  const negFromTab = () => {
    if (omniTab === 'multi') return d.klingOmniMultiNegativePrompt ?? d.negativePrompt ?? '';
    if (omniTab === 'instruction') return d.klingOmniInstructionNegativePrompt ?? d.negativePrompt ?? '';
    if (omniTab === 'video') return d.klingOmniVideoNegativePrompt ?? d.negativePrompt ?? '';
    return d.klingOmniFramesNegativePrompt ?? d.negativePrompt ?? '';
  };
  if (isOutputLike) {
    return {
      prompt: pickNonEmpty(g.prompt, promptFromTab()),
      negativePrompt: pickNonEmpty(g.negativePrompt, negFromTab()),
    };
  }
  // 上游运行节点：只用当前 tab 面板 prompt，忽略 processor 上残留的 generationParams
  return {
    prompt: String(promptFromTab()).trim(),
    negativePrompt: String(negFromTab()).trim(),
  };
}

/** 与 FlowEditor previewParams.baseParams 核心字段一致（不含参考图合并） */
export function buildNodeDetailsBaseParams(input: {
  previewNodeData: Partial<NodeData>;
  nodeType: NodeType;
  ancestorData?: Partial<NodeData>;
}): NodeDetailsBaseParams {
  const { previewNodeData: d, nodeType, ancestorData } = input;
  const gp = (d.generationParams || {}) as GenerationParams;
  const upstreamGp = (ancestorData?.generationParams || {}) as GenerationParams;
  const isOutputLike = nodeType === NodeType.MOV || nodeType === NodeType.OUTPUT;
  const ctx: NodeDetailsPickContext = {
    isOutputLike,
    runGp: gp,
    upstreamGp,
    ancestorData,
    selfData: d,
  };
  const isOmni =
    String(gp.model || '').includes('可灵3.0 Omni') ||
    String(d.selectedModel || '').includes('可灵3.0 Omni');
  const omniTab = (pickNodeDetailsParam<string>(ctx, 'klingOmniTab' as keyof NodeData & keyof GenerationParams) ??
    gp.klingOmniTab ??
    ancestorData?.klingOmniTab) as string | undefined;
  const { prompt, negativePrompt } = resolveOmniPromptForDetails(
    isOmni,
    isOutputLike,
    omniTab,
    d,
    gp,
    ancestorData,
    upstreamGp
  );

  const model = (() => {
    const snap = gp.model;
    const fromSnap = typeof snap === 'string' && snap.trim() ? snap.trim() : '';
    if (fromSnap) return fromSnap;
    const fromUp = typeof upstreamGp.model === 'string' && upstreamGp.model.trim() ? upstreamGp.model.trim() : '';
    if (isOutputLike && fromUp) return fromUp;
    const fromSel = (d.selectedModel || '').trim();
    return fromSel || MODEL_NANO_BANANA_2;
  })();

  return {
    prompt,
    negativePrompt,
    model,
    aspectRatio: pickNodeDetailsParam<string>(ctx, 'aspectRatio') || '1:1',
    resolution: pickNodeDetailsParam<string>(ctx, 'resolution') || '1K',
    numberOfImages: pickNodeDetailsParam<string>(ctx, 'numberOfImages') || '1张',
    quality: pickNodeDetailsParam<string>(ctx, 'quality'),
    duration: pickNodeDetailsParam<string>(ctx, 'duration'),
    jimengResolution: pickNodeDetailsParam<string>(ctx, 'jimengResolution'),
    jimengVideoRatio: pickNodeDetailsParam<string>(ctx, 'jimengVideoRatio'),
    jimengGenerationMode: pickNodeDetailsParam<'text' | 'image'>(ctx, 'jimengGenerationMode'),
    viduDuration: pickNodeDetailsParam<string>(ctx, 'viduDuration'),
    viduClarity: pickNodeDetailsParam<string>(ctx, 'viduClarity'),
    viduMotionRange: pickNodeDetailsParam<string>(ctx, 'viduMotionRange'),
    klingAudioSync: pickNodeDetailsParam<boolean>(ctx, 'klingAudioSync'),
    seedanceResolution: pickNodeDetailsParam<string>(ctx, 'seedanceResolution'),
    seedanceAspectRatio: pickNodeDetailsParam<string>(ctx, 'seedanceAspectRatio'),
    seedanceDuration:
      pickNodeDetailsParam<string>(ctx, 'seedanceDuration') ?? SEEDANCE_DURATION_DEFAULT_LABEL,
    seedanceGenerateAudio: pickNodeDetailsParam<boolean>(ctx, 'seedanceGenerateAudio'),
    seedanceFixedCamera: pickNodeDetailsParam<boolean>(ctx, 'seedanceFixedCamera'),
    seedanceGenerationMode: pickNodeDetailsParam<'text' | 'image' | 'reference'>(ctx, 'seedanceGenerationMode'),
    seedanceReferenceWebSearch:
      pickNodeDetailsParam<boolean>(ctx, 'seedanceReferenceWebSearch') ??
      (d as { seedanceImageWebSearch?: boolean }).seedanceImageWebSearch ??
      (d.generationParams as { seedanceImageWebSearch?: boolean } | undefined)?.seedanceImageWebSearch,
    klingOmniTab: omniTab as NodeDetailsBaseParams['klingOmniTab'],
  };
}

/** 各图生/参考生模型：Node Details 参考图（含 @主图 + 面板 @图片n；旧快照缺主图时从上游补全） */
export function buildPromptReferencedDetailsImages(input: {
  snapRefs: string[];
  fallbackRefs: string[];
  prompt: string;
  isOutputLike: boolean;
  ancestorData?: Partial<NodeData>;
  outputReferenceImages?: string[];
  isRunSnapshotRef?: (url: string) => boolean;
  isSameAsOutput?: (refUrl: string, outputUrl: string) => boolean;
  outputImagePreview?: string;
}): string[] {
  const {
    snapRefs,
    fallbackRefs,
    prompt,
    isOutputLike,
    ancestorData,
    outputReferenceImages,
    isRunSnapshotRef,
    isSameAsOutput,
    outputImagePreview,
  } = input;
  let raw = snapRefs.length > 0 ? [...snapRefs] : [...fallbackRefs];
  const p = prompt.trim();
  const needsMain = /@主图|@主体/.test(p);
  const needsPanelImg = /@图片\d+|@图片(?!\d)/.test(p);
  const legacyIncomplete = needsMain && needsPanelImg && raw.length <= 1;
  if (isOutputLike && p && legacyIncomplete) {
    const enrich: string[] = [];
    if (needsMain) {
      const main = String(ancestorData?.imagePreview || '').trim();
      if (main) enrich.push(main);
    }
    if (needsPanelImg) {
      const tabRefs = (ancestorData as { seedanceTabConfigs?: { reference?: { referenceImages?: string[] } } })
        ?.seedanceTabConfigs?.reference?.referenceImages;
      for (const u of [
        ...(ancestorData?.referenceImages || []),
        ...(Array.isArray(tabRefs) ? tabRefs : []),
        ...(outputReferenceImages || []),
      ]) {
        const s = String(u || '').trim();
        if (s) enrich.push(s);
      }
    }
    if (enrich.length) {
      const seen = new Set<string>();
      raw = [...enrich, ...raw].filter((u) => {
        const k = u.trim();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
  }
  if (!isOutputLike || !outputImagePreview) return raw;
  return raw.filter((u) => {
    if (isRunSnapshotRef?.(u)) return true;
    if (isSameAsOutput?.(u, outputImagePreview)) return false;
    return true;
  });
}

export const buildNanoBananaDetailsReferenceImages = buildPromptReferencedDetailsImages;

function dedupeUrlList(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const s = String(u || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** 可灵 Omni 多图/指令/视频 tab：Node Details 对齐面板槽位 */
/**
 * 可灵 Omni 指令变换 / 视频参考：Node Details 参考图。
 * 面板槽为空时回退 generationParams.referenceImages（运行实际上传后的 URL）。
 */
export function buildOmniInstructionVideoTabDetailsReferencePreview(input: {
  panelSource: Partial<NodeData>;
  omniTab: 'instruction' | 'video';
  urlPool: string[];
  snapshotRefs: string[];
  movUrlSet: Set<string>;
  projectAssets?: ProjectAssetLabelRow[];
}): { referenceImages: string[]; referenceImageDetailItems: ReferenceImageDetailItem[] } {
  const refKey =
    input.omniTab === 'instruction'
      ? 'klingOmniInstructionReferenceImages'
      : 'klingOmniVideoReferenceImages';
  let panel: Partial<NodeData> = { ...input.panelSource, klingOmniTab: input.omniTab };
  const slotRefs = ((panel[refKey as keyof NodeData] as string[] | undefined) || []).filter(Boolean);
  const snapRefs = sanitizeDetailsReferenceImageUrls(
    input.snapshotRefs.filter((u) => u && !input.movUrlSet.has(u))
  );
  if (slotRefs.length === 0 && snapRefs.length > 0) {
    panel = { ...panel, [refKey]: snapRefs };
  }
  const preview = buildNodeDetailsReferencePreview({
    panelSource: panel,
    urlPool: input.urlPool.filter((u) => !input.movUrlSet.has(u)),
    projectAssets: input.projectAssets,
    filterItem: (it) => Boolean(it.url) && !input.movUrlSet.has(it.url),
  });
  if (preview.referenceImages.length > 0) return preview;
  if (!snapRefs.length) return preview;
  const labels = panel.referenceImageLabels || [];
  return {
    referenceImages: snapRefs,
    referenceImageDetailItems: snapRefs.map((url, i) => ({
      url,
      label:
        String(labels[i] || '').trim() ||
        panelReferenceSlotLabel(i, snapRefs, panel.imagePreview, 'panelSlot'),
    })),
  };
}

export function mergeOmniMultiTabReferenceImagesForDetails(input: {
  nodeData: Partial<NodeData>;
  generationParams?: GenerationParams;
  ancestorData?: Partial<NodeData>;
  isOutputLike: boolean;
  isRunSnapshotRef?: (url: string) => boolean;
  isSameAsOutput?: (refUrl: string, outputUrl: string) => boolean;
  outputImagePreview?: string;
}): string[] {
  const d = input.nodeData;
  const g = (input.generationParams || d.generationParams || {}) as GenerationParams;
  const gb = Array.isArray(g.referenceImages) ? g.referenceImages.filter(Boolean) : [];

  if (input.isOutputLike && gb.length > 0) {
    const omniPrompt = String(
      g.prompt ?? d.klingOmniMultiPrompt ?? d.prompt ?? input.ancestorData?.prompt ?? ''
    ).trim();
    const refs = buildPromptReferencedDetailsImages({
      snapRefs: gb,
      fallbackRefs: [],
      prompt: omniPrompt,
      isOutputLike: true,
      ancestorData: input.ancestorData,
      outputReferenceImages: d.klingOmniMultiReferenceImages,
      isRunSnapshotRef: input.isRunSnapshotRef,
      isSameAsOutput: input.isSameAsOutput,
      outputImagePreview: input.outputImagePreview,
    });
    return sanitizeDetailsReferenceImageUrls(refs);
  }

  const panel = Array.isArray(d.klingOmniMultiReferenceImages)
    ? d.klingOmniMultiReferenceImages.filter(Boolean)
    : [];
  const prompt = String(d.klingOmniMultiPrompt ?? d.prompt ?? input.ancestorData?.prompt ?? '').trim();
  let refs = dedupeUrlList([...panel]);
  const mainForOmni = /@主图|@主体/.test(prompt)
    ? String(d.imagePreview || '').trim()
    : '';
  if (mainForOmni && !isLikelyMainVideoUrl(mainForOmni)) {
    refs = [mainForOmni, ...refs.filter((u) => !isDuplicateOfMainImagePreview(u, mainForOmni))];
  }
  const sanitized = sanitizeDetailsReferenceImageUrls(refs);
  // @主图 且主预览为 data:/blob: 时，即使已有 https 参考图也保留主图（与面板一致）
  if (
    mainForOmni &&
    (/^data:/i.test(mainForOmni) || mainForOmni.startsWith('blob:')) &&
    !sanitized.some((u) => isDuplicateOfMainImagePreview(u, mainForOmni))
  ) {
    return [mainForOmni, ...sanitized];
  }
  return sanitized;
}

/**
 * 从项目 JSON 节点 data 推导「上游运行节点」Node Details 应展示的参考图。
 */
export function expectedProcessorReferenceImagesFromPanel(data: Partial<NodeData>): string[] {
  const model = String(data.selectedModel || '').trim();
  if (
    model === '可灵3.0 Omni' ||
    model === 'Nano Banana 2.0' ||
    model === 'image 2' ||
    model === '即梦3.0 Pro' ||
    model === '可灵 2.5 Turbo' ||
    model === 'vidu 2.0' ||
    model === 'seedance1.5-pro' ||
    ['seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(model)
  ) {
    return buildReferenceImageDetailItemsFromPanel(data).map((i) => i.url);
  }
  return dedupeUrlList(data.referenceImages || []);
}

/** Node Details 展示：去掉视频 URL、blob 临时预览（已有 https 时）、同图重复 */
export function sanitizeDetailsReferenceImageUrls(urls: string[]): string[] {
  const list = urls.map((u) => String(u || '').trim()).filter(Boolean);
  const withoutVideo = list.filter((u) => !isLikelyMainVideoUrl(u));
  const hasHttps = withoutVideo.some((u) => /^https?:\/\//i.test(u));
  const pool = hasHttps
    ? withoutVideo.filter((u) => !u.startsWith('blob:') && !/^data:/i.test(u))
    : withoutVideo;
  const keyOf = (u: string): string => {
    const m = u.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (m) return m[0].toLowerCase();
    return u.split('?')[0].split('#')[0].replace(/\/+$/, '').toLowerCase();
  };
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of pool) {
    const k = keyOf(u);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
  }
  return out;
}

/** Seedance 图生：Node Details 仅展示本次 API 首尾帧 */
export function mergeSeedanceImageModeDetailsReferenceImages(input: {
  nodeData: Partial<NodeData>;
  generationParams?: GenerationParams;
  mergedPool?: string[];
}): string[] {
  const d = input.nodeData;
  const g = (input.generationParams || d.generationParams || {}) as GenerationParams;
  const gpRefs = Array.isArray(g.referenceImages) ? g.referenceImages.filter(Boolean) : [];
  if (gpRefs.length >= 1 && gpRefs.length <= 2) {
    return sanitizeDetailsReferenceImageUrls(gpRefs);
  }
  const pool = input.mergedPool || [];
  const first = String(d.firstFrameImageUrl || d.firstFrameImage || '').trim();
  const last = String(d.lastFrameImageUrl || d.lastFrameImage || '').trim();
  const keyOf = (u: string) => normalizeDetailImageUrlKey(u);
  const pick = (target: string): string | undefined => {
    if (!target) return undefined;
    const tk = keyOf(target);
    return pool.find((u) => keyOf(u) === tk) || target;
  };
  const out: string[] = [];
  const f = pick(first);
  const l = pick(last);
  if (f) out.push(f);
  if (l && (!f || keyOf(l) !== keyOf(f))) out.push(l);
  return sanitizeDetailsReferenceImageUrls(out);
}

export function resolveOmniTabPromptFromData(
  d: Partial<NodeData>,
  tab?: 'multi' | 'instruction' | 'video' | 'frames'
): { prompt: string; negativePrompt: string } {
  const t = tab || (d.klingOmniTab as 'multi' | 'instruction' | 'video' | 'frames') || 'multi';
  if (t === 'multi') {
    return {
      prompt: String(d.klingOmniMultiPrompt ?? d.prompt ?? '').trim(),
      negativePrompt: String(d.klingOmniMultiNegativePrompt ?? d.negativePrompt ?? '').trim(),
    };
  }
  if (t === 'instruction') {
    return {
      prompt: String(d.klingOmniInstructionPrompt ?? d.prompt ?? '').trim(),
      negativePrompt: String(d.klingOmniInstructionNegativePrompt ?? d.negativePrompt ?? '').trim(),
    };
  }
  if (t === 'video') {
    return {
      prompt: String(d.klingOmniVideoPrompt ?? d.prompt ?? '').trim(),
      negativePrompt: String(d.klingOmniVideoNegativePrompt ?? d.negativePrompt ?? '').trim(),
    };
  }
  return {
    prompt: String(d.klingOmniFramesPrompt ?? d.prompt ?? '').trim(),
    negativePrompt: String(d.klingOmniFramesNegativePrompt ?? d.negativePrompt ?? '').trim(),
  };
}

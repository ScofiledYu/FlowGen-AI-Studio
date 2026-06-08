import type { NodeData } from '../types';
import { parseProjectAssetIdsFromMediaUrl } from './projectAssetPreview';
import { resolveNodeSelectionPreviewUrl } from './nodeDetailsPreview';
import type { ProjectAssetLabelRow } from './referenceImageSlotLabels';
import type {
  ReferencedCollectedImageRef,
  ReferencedCollectedVideoRef,
  ReferencedMediaPlan,
  ResolvePromptPlaceholdersOptions,
} from './promptMediaRefs';
import {
  buildReferenceIndexOptionsFromPlan,
  collectReferencedMediaFromPrompt,
  isDuplicateOfMainImagePreview,
  panelLabelSlotMatchesAssetLib,
  resolvePictureTokenSlotIndex,
  stripPanelRefsDuplicateOfMain,
} from './promptMediaRefs';
import { referenceMediaAlreadyInSlots } from './referenceImageSlotLabels';

/** 各模型运行上传时：与面板参考格一致的 URL 列表（供 uploadReferencedImageEntry 校验槽位 File） */
export function panelReferenceImagesForUpload(data: Partial<NodeData>): string[] | undefined {
  const m = String(data.selectedModel || '').trim();
  if (m === '可灵3.0 Omni') {
    const tab = (data.klingOmniTab || 'multi') as 'multi' | 'instruction' | 'video' | 'frames';
    if (tab === 'multi') return data.klingOmniMultiReferenceImages;
    if (tab === 'instruction') return data.klingOmniInstructionReferenceImages;
    if (tab === 'video') return data.klingOmniVideoReferenceImages;
    return data.referenceImages;
  }
  return data.referenceImages;
}

export type PanelReferenceSlotMatchOptions = {
  /** slug → 资产库 file/thumb URL，用于面板 thumb 与 @资产 解析 URL 不一致时按 assetId 对齐槽位 */
  projectAssetSlugToUrl?: Map<string, string>;
  /** 面板参考格底栏资产名，用于 @资产:展示名 与 thumb/file 双轨时仍能定位槽位 */
  referenceImageLabels?: string[];
  /** 节点主预览：@资产 与主图同素材但未在参考格时，分配空槽/槽0 写回上传结果 */
  imagePreview?: string;
  panelMainSlotVisible?: boolean;
};

export {
  buildReferenceIndexOptionsFromPlan,
  collectReferencedMediaFromPrompt,
} from './promptMediaRefs';

export const END_FRAME_REF_TOKENS = new Set(['@尾帧图', '@图片2']);
export const START_FRAME_REF_TOKENS = new Set(['@主图', '@主体', '@首帧图', '@图片1', '@图片']);
/** 可灵3.0 Omni「多图参考」tab：仅这些 token 共用 API 首帧 URL；@图片1 为参考格，须单独上传 */
export const OMNI_MULTI_FIRST_FRAME_TOKENS = new Set(['@主图', '@主体', '@首帧图']);
export const MAIN_IMAGE_REF_TOKENS = new Set(['@主图', '@主体']);

/** 创意描述是否 @ 到主图（属性面板「主图」格 / imagePreview） */
export function promptMentionsMainImageInText(prompt: string | undefined): boolean {
  return /@主图|@主体/.test(String(prompt || '').trim());
}

export function promptPlanReferencesMainImage(
  planImages: ReferencedCollectedImageRef[]
): boolean {
  return planImages.some((e) => MAIN_IMAGE_REF_TOKENS.has(e.token));
}

/** 本次 plan 中第一个非主图 @ 的上传 URL（按 plan.images 顺序） */
export function firstUploadedNonMainImageFromPlan(
  planImages: ReferencedCollectedImageRef[],
  uploadedByToken: Map<string, string>
): string | undefined {
  for (const entry of planImages) {
    if (MAIN_IMAGE_REF_TOKENS.has(entry.token)) continue;
    const up = uploadedByToken.get(entry.token);
    if (up) return up;
  }
  return undefined;
}

/**
 * 属性面板「主图」格：有主预览且未被运行结果标记隐藏时展示（拖入后默认可见，运行后未 @主图 则隐藏）。
 */
export function shouldShowPanelMainImageSlot(data: Partial<NodeData>): boolean {
  const preview = String(data.imagePreview || '').trim();
  if (!preview) return false;
  return data.panelMainSlotVisible !== false;
}

/** 未 @主图 时 imagePreview 仅作画布大图，参考格勿再按「与主图重复」隐藏 */
export function shouldDedupePanelRefsAgainstMainPreview(data: Partial<NodeData>): boolean {
  return shouldShowPanelMainImageSlot(data);
}

/** 参考格底栏标签用：未展示主图格时不把 imagePreview 当作「主图」去重命名 */
export function panelReferenceLabelImagePreview(data: Partial<NodeData>): string | undefined {
  if (!shouldShowPanelMainImageSlot(data)) return undefined;
  const p = String(data.imagePreview || '').trim();
  return p || undefined;
}

/**
 * 运行后 imagePreview：@主图 → 主图上传 URL；未 @主图 → 节点大图用首个 @ 参考图。
 * panelMainSlotVisible：未 @主图 时 false，面板去掉主图格；编辑中 undefined 则仍展示主图。
 */
export type PanelImagePreviewPatchAfterRunOptions = {
  nodeData?: Partial<NodeData>;
  mergedPanelRefs?: string[];
  mergedPanelLabels?: string[];
  projectAssets?: ProjectAssetLabelRow[];
};

export function buildPanelImagePreviewPatchAfterRun(
  planImages: ReferencedCollectedImageRef[],
  uploadedByToken: Map<string, string>,
  options?: PanelImagePreviewPatchAfterRunOptions
): Partial<Pick<NodeData, 'imagePreview' | 'panelMainSlotVisible'>> {
  const mentionsMain = promptPlanReferencesMainImage(planImages);
  if (mentionsMain) {
    const main =
      uploadedByToken.get('@主图') ?? uploadedByToken.get('@主体');
    return {
      ...(main ? { imagePreview: main } : {}),
      panelMainSlotVisible: true,
    };
  }
  if (options?.mergedPanelRefs?.length && options.nodeData) {
    const preview = resolveNodeSelectionPreviewUrl(
      {
        ...options.nodeData,
        imagePreview: undefined,
        referenceImages: options.mergedPanelRefs,
        referenceImageLabels: options.mergedPanelLabels ?? options.nodeData.referenceImageLabels,
        panelMainSlotVisible: false,
      },
      options.projectAssets
    );
    return {
      ...(preview ? { imagePreview: preview } : { imagePreview: undefined }),
      panelMainSlotVisible: false,
    };
  }
  const first = firstUploadedNonMainImageFromPlan(planImages, uploadedByToken);
  return {
    ...(first ? { imagePreview: first } : { imagePreview: undefined }),
    panelMainSlotVisible: false,
  };
}

/** 运行后节点大图：先走 @主图/参考图规则，否则用首尾帧上传结果（按 plan 是否 @ 到） */
export function buildRunNodeImagePreviewPatch(
  planImages: ReferencedCollectedImageRef[],
  uploadedByToken: Map<string, string>,
  frameUploaded?: FrameUploadUrls
): Partial<Pick<NodeData, 'imagePreview'>> {
  const fromRefs = buildPanelImagePreviewPatchAfterRun(planImages, uploadedByToken);
  if (fromRefs.imagePreview) return fromRefs;
  if (!frameUploaded) return fromRefs;
  const framePatch = buildFirstLastFramePanelPatchFromPlan(planImages, frameUploaded);
  if (promptPlanReferencesStartFrame(planImages) && framePatch.firstFrameImageUrl) {
    return { imagePreview: framePatch.firstFrameImageUrl };
  }
  if (promptPlanReferencesEndFrame(planImages) && framePatch.lastFrameImageUrl) {
    return { imagePreview: framePatch.lastFrameImageUrl };
  }
  return fromRefs;
}

/** 合并/裁剪参考槽时：未 @主图 勿把 imagePreview 当主图去重，避免参考格被掏空 */
export function panelMergeOptionsForReferencedUpload(
  planImages: ReferencedCollectedImageRef[],
  uploadedByToken: Map<string, string>,
  currentImagePreview?: string,
  projectAssetSlugToUrl?: Map<string, string>,
  referenceImageLabels?: string[],
  panelMainSlotVisible?: boolean
): { uploadedMainUrl?: string; imagePreview?: string } & PanelReferenceSlotMatchOptions {
  const base: { uploadedMainUrl?: string; imagePreview?: string } & PanelReferenceSlotMatchOptions =
    {
      ...(projectAssetSlugToUrl?.size ? { projectAssetSlugToUrl } : {}),
      ...(referenceImageLabels?.length ? { referenceImageLabels } : {}),
      ...(currentImagePreview?.trim() ? { imagePreview: currentImagePreview } : {}),
      ...(panelMainSlotVisible !== undefined ? { panelMainSlotVisible } : {}),
    };
  if (promptPlanReferencesMainImage(planImages)) {
    const uploadedMainUrl =
      uploadedByToken.get('@主图') ?? uploadedByToken.get('@主体');
    return { ...base, uploadedMainUrl, imagePreview: currentImagePreview };
  }
  return base;
}

/** 参考生视频上传后拆分：@主图 → imagePreview，@图片n → referenceImages（互不重复） */
export function splitSeedanceUploadedReferenceImages(
  plan: ReferencedMediaPlan,
  uploadedImgs: string[]
): { mainImageUrl?: string; referenceOnlyImages: string[] } {
  let mainImageUrl: string | undefined;
  const referenceOnlyImages: string[] = [];
  for (let i = 0; i < plan.images.length; i++) {
    const entry = plan.images[i];
    const url = uploadedImgs[i];
    if (!url) continue;
    if (MAIN_IMAGE_REF_TOKENS.has(entry.token)) {
      mainImageUrl = url;
    } else {
      referenceOnlyImages.push(url);
    }
  }
  return { mainImageUrl, referenceOnlyImages };
}

export function assignStartEndUrlsFromImagePlan(
  plan: ReferencedMediaPlan,
  uploadedByToken: Map<string, string>
): { startUrl?: string; endUrl?: string } {
  let startUrl: string | undefined;
  let endUrl: string | undefined;
  for (const img of plan.images) {
    const url = uploadedByToken.get(img.token);
    if (!url) continue;
    if (END_FRAME_REF_TOKENS.has(img.token)) {
      endUrl = url;
    } else if (START_FRAME_REF_TOKENS.has(img.token)) {
      if (!startUrl) startUrl = url;
    }
  }
  if (!startUrl && plan.images.length > 0) {
    const first = plan.images[0];
    if (!END_FRAME_REF_TOKENS.has(first.token)) {
      startUrl = uploadedByToken.get(first.token);
    }
  }
  return { startUrl, endUrl };
}

export type FrameUploadUrls = { startUrl?: string; endUrl?: string };

export function promptPlanReferencesStartFrame(
  planImages: ReferencedCollectedImageRef[]
): boolean {
  return planImages.some((e) => START_FRAME_REF_TOKENS.has(e.token));
}

export function promptPlanReferencesEndFrame(
  planImages: ReferencedCollectedImageRef[]
): boolean {
  return planImages.some((e) => END_FRAME_REF_TOKENS.has(e.token));
}

/** 创意描述是否 @ 到首尾帧（@首帧图 / @尾帧图 / @图片1·2 等） */
export function promptPlanReferencesFirstLastFrames(
  planImages: ReferencedCollectedImageRef[]
): boolean {
  return (
    promptPlanReferencesStartFrame(planImages) ||
    promptPlanReferencesEndFrame(planImages)
  );
}

/**
 * 运行后：属性面板只保留提示词中 @ 到的首帧/尾帧；未 @ 的槽位清空（标签仍为「首帧图」「尾帧图」）。
 * uploaded 为本次上传后的 URL；API 入参可仍用 assignStartEndUrlsFromImagePlan，面板与 Details 用本 patch。
 */
export function buildFirstLastFramePanelPatchFromPlan(
  planImages: ReferencedCollectedImageRef[],
  uploaded: FrameUploadUrls
): Partial<NodeData> {
  const shouldPrune = promptPlanReferencesFirstLastFrames(planImages);
  const refsStart = promptPlanReferencesStartFrame(planImages);
  const refsEnd = promptPlanReferencesEndFrame(planImages);
  const patch: Partial<NodeData> = {};

  if (!shouldPrune) {
    if (uploaded.startUrl) {
      patch.firstFrameImage = uploaded.startUrl;
      patch.firstFrameImageUrl = uploaded.startUrl;
      patch.firstFrameLocalRef = undefined;
    }
    if (uploaded.endUrl) {
      patch.lastFrameImage = uploaded.endUrl;
      patch.lastFrameImageUrl = uploaded.endUrl;
      patch.lastFrameLocalRef = undefined;
    }
    return patch;
  }

  if (refsStart && uploaded.startUrl) {
    patch.firstFrameImage = uploaded.startUrl;
    patch.firstFrameImageUrl = uploaded.startUrl;
    patch.firstFrameLocalRef = undefined;
  } else if (!refsStart) {
    patch.firstFrameImage = undefined;
    patch.firstFrameImageUrl = undefined;
    patch.firstFrameLocalRef = undefined;
  }

  if (refsEnd && uploaded.endUrl) {
    patch.lastFrameImage = uploaded.endUrl;
    patch.lastFrameImageUrl = uploaded.endUrl;
    patch.lastFrameLocalRef = undefined;
  } else if (!refsEnd) {
    patch.lastFrameImage = undefined;
    patch.lastFrameImageUrl = undefined;
    patch.lastFrameLocalRef = undefined;
  }

  return patch;
}

export type UploadReferencedImageContext = {
  originals: {
    main?: File | null;
    referenceImages?: Array<File | null | undefined>;
    firstFrame?: File | null;
    lastFrame?: File | null;
    jimengImages?: Array<File | null | undefined>;
  };
  /** 运行前面板槽 URL：与 plan 解析出的 entry.url 不一致时勿用槽位本地 File（避免「标签对、图错」） */
  panelReferenceImages?: string[];
  projectAssetSlugToUrl?: Map<string, string>;
  projectAssets?: Array<{ slug: string; name: string; url: string }>;
  fileToDataUrlCached: (f: File) => Promise<string>;
  prepareLocalImageSrcCached: (
    src: string,
    opts?: { seedanceRatioLabel?: string }
  ) => Promise<string>;
  uploadImageCached: (src: string) => Promise<string | null>;
  flowgenAssetFileUrlFromMediaUrl: (url: string) => string;
  isFlowgenAssetThumbUrl: (url: string) => boolean;
  base64ToUrl?: (dataUrl: string) => Promise<string>;
  seedanceRatioLabel?: string;
};

/**
 * 面板槽内 URL 与本次 @ 解析出的 entry.url 不是同一资产时，槽位本地 File 可能是误拖图，应改用 entry.url。
 */
export function slotOriginalFileConflictsWithPlanEntry(
  entry: ReferencedCollectedImageRef,
  slotUrl: string | undefined
): boolean {
  const entryUrl = String(entry.url || '').trim();
  const slot = String(slotUrl || '').trim();
  if (entry.refImageSlotIndex == null || !entryUrl) return false;
  const entryKey = projectAssetPairKey(entryUrl);
  const slotKey = projectAssetPairKey(slot);
  if (entryKey && slotKey) return entryKey !== slotKey;
  if (entryKey && slot && !slotKey) return true;
  if (
    entry.token.startsWith('@资产:') &&
    slot &&
    normalizeRefMediaUrlKey(entryUrl) !== normalizeRefMediaUrlKey(slot)
  ) {
    return true;
  }
  return false;
}

/** 空槽位上的本地 File 不能当作本次 @ 解析结果上传（常见于误拖图占槽但未 @） */
export function shouldUseSlotOriginalFileForUpload(
  entry: ReferencedCollectedImageRef,
  slotUrl: string | undefined,
  refFile: File | null | undefined,
  /** resolveReferencedImageUploadSource 之后实际上传源；@资产 与槽 COS 一致时仍可能应走库图 */
  resolvedUploadUrl?: string
): boolean {
  if (!refFile || entry.refImageSlotIndex == null) return false;
  // @资产 始终走资产库 URL；槽位 URL 可能已换成库地址，但 originals 里仍留着误拖 File
  if (entry.token.startsWith('@资产:')) return false;
  const slot = String(slotUrl || '').trim();
  if (!slot) return false;
  const compareUrl = String(resolvedUploadUrl || entry.url || '').trim();
  if (!compareUrl) return false;
  return !slotOriginalFileConflictsWithPlanEntry(
    { ...entry, url: compareUrl },
    slotUrl
  );
}

/** API 参考图列表：仅创意描述 plan 中非主图 token 的上传结果（顺序与 plan 一致） */
export function buildReferenceOnlyImagesForApiPayload(
  planImages: ReferencedCollectedImageRef[],
  uploadedByToken: Map<string, string>
): string[] {
  const out: string[] = [];
  for (const entry of planImages) {
    if (MAIN_IMAGE_REF_TOKENS.has(entry.token)) continue;
    const up = String(uploadedByToken.get(entry.token) || '').trim();
    if (up) out.push(up);
  }
  return out;
}

/** @资产: 上传源：有资产库条目时始终用库图，勿用槽位 COS / File（避免误拖水墨图等污染） */
export function resolveReferencedImageUploadSource(
  entry: ReferencedCollectedImageRef,
  ctx: UploadReferencedImageContext
): string {
  const uploadSrc = String(entry.url || '').trim();
  if (!entry.token.startsWith('@资产:')) return uploadSrc;
  const key = entry.token.slice('@资产:'.length).trim();
  const lib =
    ctx.projectAssetSlugToUrl?.get(key)?.trim() ||
    ctx.projectAssets
      ?.find((a) => a.slug === key || a.name.trim() === key)
      ?.url?.trim();
  if (!lib) return uploadSrc;
  return ctx.isFlowgenAssetThumbUrl(lib)
    ? ctx.flowgenAssetFileUrlFromMediaUrl(lib)
    : lib;
}

/** 上传创意描述中 @ 到的单张参考图（与 Seedance 参考生视频规则一致） */
export async function uploadReferencedImageEntry(
  entry: ReferencedCollectedImageRef,
  ctx: UploadReferencedImageContext
): Promise<string> {
  let uploadSrc = resolveReferencedImageUploadSource(entry, ctx);
  const slotIdx = entry.refImageSlotIndex;
  const slotUrl =
    slotIdx != null ? ctx.panelReferenceImages?.[slotIdx]?.trim() : undefined;
  let refFile =
    slotIdx != null ? ctx.originals.referenceImages?.[slotIdx] : undefined;
  if (!shouldUseSlotOriginalFileForUpload(entry, slotUrl, refFile, uploadSrc)) {
    refFile = undefined;
  }
  const firstFrameFile = entry.token === '@首帧图' ? ctx.originals.firstFrame : undefined;
  const useMainFile =
    (entry.token === '@主图' || entry.token === '@主体') && ctx.originals.main;
  const useMainForStartWhenNoFirstFrameFile =
    START_FRAME_REF_TOKENS.has(entry.token) &&
    !refFile &&
    !firstFrameFile &&
    ctx.originals.main;
  if (refFile) {
    try {
      uploadSrc = await ctx.fileToDataUrlCached(refFile);
    } catch {
      /* 用槽位 URL */
    }
  } else if (firstFrameFile) {
    try {
      uploadSrc = await ctx.fileToDataUrlCached(firstFrameFile);
    } catch {
      /* 用槽位 URL */
    }
  } else if (useMainFile || useMainForStartWhenNoFirstFrameFile) {
    try {
      uploadSrc = await ctx.fileToDataUrlCached(ctx.originals.main!);
    } catch {
      uploadSrc = ctx.flowgenAssetFileUrlFromMediaUrl(entry.url);
    }
  } else if (ctx.isFlowgenAssetThumbUrl(uploadSrc)) {
    uploadSrc = ctx.flowgenAssetFileUrlFromMediaUrl(uploadSrc);
  }
  uploadSrc = await ctx.prepareLocalImageSrcCached(uploadSrc, {
    seedanceRatioLabel: ctx.seedanceRatioLabel,
  });
  // @资产 禁止复用槽位遗留 COS（prepare 可能仍返回误拖图的 aitop100 URL）
  if (
    uploadSrc.includes('aitop100app-1251510006') &&
    !entry.token.startsWith('@资产:')
  ) {
    return uploadSrc;
  }
  if (uploadSrc.startsWith('data:image/') && ctx.base64ToUrl) {
    return ctx.base64ToUrl(uploadSrc);
  }
  const upUrl = await ctx.uploadImageCached(uploadSrc);
  if (!upUrl) {
    throw new Error(`参考图片上传失败（${entry.label}）`);
  }
  const libSrc = entry.token.startsWith('@资产:')
    ? resolveReferencedImageUploadSource(entry, ctx)
    : '';
  if (
    entry.token.startsWith('@资产:') &&
    libSrc &&
    !libSrc.includes('aitop100app-1251510006') &&
    slotUrl &&
    slotOriginalFileConflictsWithPlanEntry({ ...entry, url: libSrc }, slotUrl) &&
    normalizeRefMediaUrlKey(upUrl) === normalizeRefMediaUrlKey(slotUrl)
  ) {
    throw new Error(
      `参考图「${entry.label}」仍使用了面板槽内的误拖图片（与 @${entry.token} 资产库不一致）。请清空该参考槽后重新运行。`
    );
  }
  return upUrl;
}

export function buildResolveOptsFromMediaPlan(
  plan: ReferencedMediaPlan,
  base?: ResolvePromptPlaceholdersOptions
): ResolvePromptPlaceholdersOptions {
  return buildReferenceIndexOptionsFromPlan(plan, base);
}

function normalizeRefMediaUrlKey(url: string): string {
  return url.trim().replace(/\/thumb(\?.*)?$/i, '/file$1');
}

function projectAssetPairKey(url: string): string | null {
  const ids = parseProjectAssetIdsFromMediaUrl(url);
  if (!ids) return null;
  return `${ids.projectId}/${ids.assetId}`;
}

function panelAssetNameFromToken(token: string): string {
  return token.startsWith('@资产:') ? token.slice('@资产:'.length).trim() : '';
}

/** 创意描述 @资产 与 imagePreview 同素材、参考格无对应 URL 时：落到首个空槽（常为槽0） */
function panelSlotForPromptAssetOnMainPreviewOnly(
  panelRefs: string[],
  entry: ReferencedCollectedImageRef,
  options?: PanelReferenceSlotMatchOptions
): number | undefined {
  if (!entry.token.startsWith('@资产:')) return undefined;
  const prev = options?.imagePreview?.trim();
  const url = String(entry.url || '').trim();
  if (!prev || !url || !isDuplicateOfMainImagePreview(url, prev)) return undefined;
  const firstEmpty = panelRefs.findIndex((r) => !String(r || '').trim());
  if (firstEmpty >= 0) return firstEmpty;
  if (options?.panelMainSlotVisible === false) {
    const libUrl = libUrlForAssetToken(entry.token, options);
    const p0 = String(panelRefs[0] || '').trim();
    if (p0 && libUrl && !panelLabelSlotMatchesAssetLib(p0, libUrl, prev)) {
      return undefined;
    }
    return panelRefs.length > 0 ? 0 : undefined;
  }
  return undefined;
}

function libUrlForAssetToken(
  token: string,
  options?: PanelReferenceSlotMatchOptions
): string | undefined {
  if (!token.startsWith('@资产:')) return undefined;
  const key = panelAssetNameFromToken(token);
  const map = options?.projectAssetSlugToUrl;
  return (
    (key && map?.get(key)?.trim()) ||
    (key && map && [...map.entries()].find(([k]) => k.trim() === key)?.[1]?.trim())
  );
}

/** @资产 多条槽位候选时：底栏资产名 > 资产库 assetId > URL（避免 COS 误命中「图片3」槽） */
function preferredRefSlotIndexForPlanEntry(
  entry: ReferencedCollectedImageRef,
  hits: number[],
  panelRefs: string[],
  options?: PanelReferenceSlotMatchOptions
): number {
  if (hits.length <= 1) return hits[0];
  const labels = options?.referenceImageLabels || [];
  const names = new Set<string>();
  const assetName = panelAssetNameFromToken(entry.token) || entry.label?.trim();
  if (assetName) names.add(assetName);
  if (entry.label?.trim()) names.add(entry.label.trim());

  if (entry.token.startsWith('@资产:')) {
    const libUrl = libUrlForAssetToken(entry.token, options);
    for (const i of hits) {
      const cap = labels[i]?.trim();
      if (!cap || !names.has(cap)) continue;
      const p = String(panelRefs[i] || '').trim();
      if (libUrl && !panelLabelSlotMatchesAssetLib(p, libUrl, options?.imagePreview))
        continue;
      return i;
    }
    const libKey = projectAssetPairKey(libUrlForAssetToken(entry.token, options) || '');
    if (libKey) {
      for (const i of hits) {
        const p = String(panelRefs[i] || '').trim();
        if (p && projectAssetPairKey(p) === libKey) return i;
      }
    }
    return hits[0];
  }

  const pic = entry.token.match(/^@图片(\d+)$/);
  if (pic) {
    const want = `图片${pic[1]}`;
    for (const i of hits) {
      if (labels[i]?.trim() === want) return i;
    }
  }
  return hits[0];
}

function panelSlotIndexesForPlanImageEntry(
  panelRefs: string[],
  entry: ReferencedCollectedImageRef,
  keyed: Map<string, number>,
  options?: PanelReferenceSlotMatchOptions
): number[] {
  const hits: number[] = [];
  const url = String(entry.url || '').trim();
  const labels = options?.referenceImageLabels;
  const assetName = panelAssetNameFromToken(entry.token) || entry.label?.trim();
  const namesToMatch = new Set<string>();
  if (assetName) namesToMatch.add(assetName);
  const entryLabel = entry.label?.trim();
  if (entryLabel) namesToMatch.add(entryLabel);

  if (entry.token.startsWith('@资产:')) {
    const libUrl = libUrlForAssetToken(entry.token, options);
    const libKey = libUrl ? projectAssetPairKey(libUrl) : null;
    if (namesToMatch.size && labels?.length) {
      for (let i = 0; i < labels.length; i++) {
        const cap = labels[i]?.trim();
        if (!cap || !namesToMatch.has(cap) || hits.includes(i)) continue;
        const p = String(panelRefs[i] || '').trim();
        if (libUrl && !panelLabelSlotMatchesAssetLib(p, libUrl, options?.imagePreview))
          continue;
        hits.push(i);
      }
    }
    if (libKey) {
      for (let i = 0; i < panelRefs.length; i++) {
        const p = String(panelRefs[i] || '').trim();
        if (!p) continue;
        if (projectAssetPairKey(p) === libKey && !hits.includes(i)) hits.push(i);
      }
    }
    if (url && libKey) {
      const at = keyed.get(normalizeRefMediaUrlKey(url));
      if (at != null) {
        const slotP = String(panelRefs[at] || '').trim();
        if (slotP && projectAssetPairKey(slotP) === libKey && !hits.includes(at)) {
          hits.push(at);
        }
      }
    } else if (url && !libKey) {
      const at = keyed.get(normalizeRefMediaUrlKey(url));
      if (at != null && !hits.includes(at)) hits.push(at);
    }
  } else {
    const pic = entry.token.match(/^@图片(\d+)$/);
    if (pic) {
      const ord = parseInt(pic[1], 10);
      const slot = resolvePictureTokenSlotIndex(
        ord,
        panelRefs,
        labels,
        options?.imagePreview
      );
      if (slot != null && !hits.includes(slot)) hits.push(slot);
    }
    if (url) {
      const at = keyed.get(normalizeRefMediaUrlKey(url));
      if (at != null && !hits.includes(at)) hits.push(at);
    }
    if (namesToMatch.size && labels?.length) {
      for (let i = 0; i < labels.length; i++) {
        const cap = labels[i]?.trim();
        if (cap && namesToMatch.has(cap) && !hits.includes(i)) hits.push(i);
      }
    }
  }

  if (hits.length === 0 && entry.token.startsWith('@资产:')) {
    const firstEmpty = panelRefs.findIndex((r) => !String(r || '').trim());
    if (firstEmpty >= 0) hits.push(firstEmpty);
  }
  if (hits.length === 0) {
    const mainOnly = panelSlotForPromptAssetOnMainPreviewOnly(panelRefs, entry, options);
    if (mainOnly != null) hits.push(mainOnly);
  }
  return hits;
}

/** 为 plan 条目补全 refImageSlotIndex（@资产:展示名 / 底栏标签 / URL 对齐） */
export function enrichPlanImagesWithPanelSlotIndexes(
  panelRefs: string[] | undefined,
  planImages: ReferencedCollectedImageRef[],
  options?: PanelReferenceSlotMatchOptions
): ReferencedCollectedImageRef[] {
  const refs = panelRefs || [];
  const keyed = new Map<string, number>();
  refs.forEach((raw, i) => {
    const p = String(raw || '').trim();
    if (p) keyed.set(normalizeRefMediaUrlKey(p), i);
  });
  return planImages.map((entry) => {
    if (MAIN_IMAGE_REF_TOKENS.has(entry.token)) return entry;
    if (entry.refImageSlotIndex != null && entry.refImageSlotIndex >= 0) {
      if (entry.token.startsWith('@资产:')) {
        const lib = libUrlForAssetToken(entry.token, options);
        const slot = String(refs[entry.refImageSlotIndex] || '').trim();
        if (lib && slot && !panelLabelSlotMatchesAssetLib(slot, lib, options?.imagePreview)) {
          /* 重新按库图 / 空槽对齐 */
        } else {
          return entry;
        }
      } else {
        return entry;
      }
    }
    const hits = panelSlotIndexesForPlanImageEntry(refs, entry, keyed, options);
    if (hits.length === 0) return entry;
    return {
      ...entry,
      refImageSlotIndex: preferredRefSlotIndexForPlanEntry(entry, hits, refs, options),
    };
  });
}

/** 不同 @ token 不得映射到同一上传 URL（如 @萧逍 与 @图片3 均变成街景 COS） */
export function assertDistinctUploadedRefsForPlan(
  planImages: ReferencedCollectedImageRef[],
  uploadedByToken: Map<string, string>
): void {
  const seen = new Map<string, string>();
  for (const entry of planImages) {
    if (MAIN_IMAGE_REF_TOKENS.has(entry.token)) continue;
    const up = String(uploadedByToken.get(entry.token) || '').trim();
    if (!up) continue;
    const norm = normalizeRefMediaUrlKey(up);
    const prior = seen.get(norm);
    if (prior && prior !== entry.token) {
      throw new Error(
        `${prior} 与 ${entry.token} 上传后得到相同图片地址，缺少「${entry.label}」独立参考图。请清空错误槽位或重新从资产库 @${entry.label} 后运行。`
      );
    }
    seen.set(norm, entry.token);
  }
}

/** 分镜克隆等：按面板既有顺序合并 @ 解析出的 URL，不覆盖未出现在 prompt 的拖入项 */
export function mergeReferenceImageUrlsPreservingPanelOrder(
  panelRefs: string[] | undefined,
  promptOrderedUrls: string[]
): string[] {
  const panel = (panelRefs || []).map((u) => String(u || '').trim()).filter(Boolean);
  if (promptOrderedUrls.length === 0) return panel;

  const out = [...panel];
  const keyToIndex = new Map<string, number>();
  out.forEach((u, i) => keyToIndex.set(normalizeRefMediaUrlKey(u), i));

  for (const url of promptOrderedUrls) {
    const trimmed = String(url || '').trim();
    if (!trimmed) continue;
    const k = normalizeRefMediaUrlKey(trimmed);
    const idx = keyToIndex.get(k);
    if (idx != null) {
      out[idx] = trimmed;
    } else {
      keyToIndex.set(k, out.length);
      out.push(trimmed);
    }
  }
  return out;
}

/**
 * Seedance 参考生：按创意描述解析出的 refImageSlotIndex 写回面板槽，避免仅按 URL 合并导致 @图片3 落到错误格。
 */
export function applySeedanceReferencePlanToPanelSlots(
  panelRefs: string[] | undefined,
  planImages: ReferencedCollectedImageRef[],
  options?: PanelReferenceSlotMatchOptions
): string[] {
  const prev = options?.imagePreview?.trim();
  const skipMainDup = (url: string) =>
    Boolean(
      prev &&
        isDuplicateOfMainImagePreview(url, prev) &&
        shouldDedupePanelRefsAgainstMainPreview({
          imagePreview: prev,
          panelMainSlotVisible: options?.panelMainSlotVisible,
        })
    );
  const maxSlot = Math.max(
    (panelRefs || []).length - 1,
    ...planImages
      .map((e) => e.refImageSlotIndex)
      .filter((i): i is number => i != null && i >= 0),
    -1
  );
  const out: string[] = [];
  for (let i = 0; i <= maxSlot; i++) {
    out.push(String(panelRefs?.[i] || '').trim());
  }
  for (const entry of planImages) {
    if (MAIN_IMAGE_REF_TOKENS.has(entry.token)) continue;
    const url = String(entry.url || '').trim();
    if (!url) continue;
    if (skipMainDup(url)) continue;
    const idx = entry.refImageSlotIndex;
    if (idx != null && idx >= 0) {
      if (
        !referenceMediaAlreadyInSlots(out, url, {
          imagePreview: shouldDedupePanelRefsAgainstMainPreview({
            imagePreview: prev,
            panelMainSlotVisible: options?.panelMainSlotVisible,
          })
            ? prev
            : undefined,
          exceptIndex: idx,
        })
      ) {
        out[idx] = url;
      }
    }
  }
  const keyed = new Map<string, number>();
  out.forEach((u, i) => {
    if (u) keyed.set(normalizeRefMediaUrlKey(u), i);
  });
  for (const entry of planImages) {
    if (MAIN_IMAGE_REF_TOKENS.has(entry.token)) continue;
    const url = String(entry.url || '').trim();
    if (!url || skipMainDup(url)) continue;
    if (entry.refImageSlotIndex != null) continue;
    const k = normalizeRefMediaUrlKey(url);
    const at = keyed.get(k);
    if (at != null) out[at] = url;
    else {
      keyed.set(k, out.length);
      out.push(url);
    }
  }
  while (out.length > 0 && !String(out[out.length - 1] || '').trim()) out.pop();
  return out;
}

/** @资产 等无槽位 token：按原 URL 匹配面板下标，便于上传后写回同格 */
export function assignSeedanceUploadedRefsToPanelSlotsByUrlMatch(
  panelRefs: string[],
  planImages: ReferencedCollectedImageRef[],
  uploadedByToken: Map<string, string>,
  uploadedRefBySlot: Map<number, string>,
  options?: PanelReferenceSlotMatchOptions
): void {
  const keyed = new Map<string, number>();
  panelRefs.forEach((raw, i) => {
    const p = String(raw || '').trim();
    if (p) keyed.set(normalizeRefMediaUrlKey(p), i);
  });
  for (const entry of planImages) {
    if (entry.refImageSlotIndex != null) continue;
    if (MAIN_IMAGE_REF_TOKENS.has(entry.token)) continue;
    const up = uploadedByToken.get(entry.token);
    if (!up) continue;
    for (const idx of panelSlotIndexesForPlanImageEntry(panelRefs, entry, keyed, options)) {
      if (!uploadedRefBySlot.has(idx)) {
        uploadedRefBySlot.set(idx, up);
        break;
      }
    }
  }
}

/**
 * Seedance 参考生视频：运行上传后按属性面板槽位写回，保留未 @ 的拖入图与顺序。
 */
export function mergeSeedancePanelReferenceImagesAfterUpload(
  panelRefs: string[] | undefined,
  uploadedRefBySlot: Map<number, string>,
  _uploadedMainUrl?: string,
  _imagePreview?: string
): string[] {
  const refs = panelRefs || [];
  if (refs.length === 0 && uploadedRefBySlot.size === 0) return [];
  const maxIdx = Math.max(refs.length - 1, ...Array.from(uploadedRefBySlot.keys()), -1);
  const out: string[] = [];
  for (let idx = 0; idx <= maxIdx; idx++) {
    const uploaded = uploadedRefBySlot.get(idx);
    const orig = String(refs[idx] || '').trim();
    out.push(uploaded || orig);
  }
  while (out.length > 0 && !String(out[out.length - 1] || '').trim()) out.pop();
  return out;
}

/** 各模型属性面板参考图列表：按槽位写回上传结果，保留顺序与未 @ 的拖入项 */
export function mergePanelImageListAfterUpload(
  panelRefs: string[] | undefined,
  uploadedRefBySlot: Map<number, string>,
  options?: { uploadedMainUrl?: string; imagePreview?: string }
): string[] {
  const refs = panelRefs || [];
  if (refs.length === 0 && uploadedRefBySlot.size === 0) return [];

  const maxIdx = Math.max(refs.length - 1, ...Array.from(uploadedRefBySlot.keys()), -1);
  const out: string[] = [];

  for (let idx = 0; idx <= maxIdx; idx++) {
    const uploaded = uploadedRefBySlot.get(idx);
    const orig = String(refs[idx] || '').trim();
    const candidate = uploaded || orig;
    if (!candidate) continue;
    const main = options?.uploadedMainUrl || options?.imagePreview;
    if (main && isDuplicateOfMainImagePreview(candidate, main)) continue;
    out.push(candidate);
  }

  return out;
}

export function populateUploadedRefBySlotFromMediaPlan(
  planImages: ReferencedCollectedImageRef[],
  uploadedByToken: Map<string, string>,
  uploadedRefBySlot: Map<number, string>
): void {
  for (const entry of planImages) {
    if (entry.refImageSlotIndex == null) continue;
    if (MAIN_IMAGE_REF_TOKENS.has(entry.token)) continue;
    const up = uploadedByToken.get(entry.token);
    if (up) uploadedRefBySlot.set(entry.refImageSlotIndex, up);
  }
}

/** 创意描述是否 @ 到面板参考图（@图片n / @图片 / @资产:slug；不含仅 @主图） */
export function promptPlanReferencesPanelImages(
  planImages: ReferencedCollectedImageRef[]
): boolean {
  return planImages.some((e) => {
    if (MAIN_IMAGE_REF_TOKENS.has(e.token)) return false;
    return (
      /^@图片\d*$/.test(e.token) ||
      e.token === '@图片' ||
      e.token.startsWith('@资产:')
    );
  });
}

/**
 * 属性面板参考网格：跳过 prune 留下的空槽，保留下标以便底栏仍为「图片2」等。
 */
export function panelReferenceDisplaySlots(
  refs: string[] | undefined
): Array<{ url: string; slotIndex: number }> {
  return (refs || [])
    .map((raw, slotIndex) => ({ url: String(raw || '').trim(), slotIndex }))
    .filter((e) => Boolean(e.url));
}

/**
 * 运行成功后：去掉未被 @ 的参考槽，保留原下标与「图片n」名称（空串占位，显示层过滤空槽）。
 * mergedSlots 与 panelRefs 等长或更长，优先取 merged 中该槽上传后的 URL。
 */
/** 创意描述 @ 到的参考图槽位（含 @资产 按 URL / 资产库 assetId 匹配面板下标） */
export function collectReferencedPanelImageSlots(
  panelRefs: string[] | undefined,
  planImages: ReferencedCollectedImageRef[],
  options?: PanelReferenceSlotMatchOptions
): Set<number> {
  const refs = panelRefs || [];
  const referencedSlots = new Set<number>();
  const keyed = new Map<string, number>();
  refs.forEach((raw, i) => {
    const p = String(raw || '').trim();
    if (p) keyed.set(normalizeRefMediaUrlKey(p), i);
  });
  for (const entry of planImages) {
    if (MAIN_IMAGE_REF_TOKENS.has(entry.token)) continue;
    if (entry.refImageSlotIndex != null && entry.refImageSlotIndex >= 0) {
      referencedSlots.add(entry.refImageSlotIndex);
      continue;
    }
    for (const idx of panelSlotIndexesForPlanImageEntry(refs, entry, keyed, options)) {
      referencedSlots.add(idx);
    }
  }
  return referencedSlots;
}

export function prunePanelReferenceImagesToPromptRefs(
  panelRefs: string[] | undefined,
  planImages: ReferencedCollectedImageRef[],
  mergedSlots: string[] | undefined,
  options?: PanelReferenceSlotMatchOptions
): string[] {
  if (!promptPlanReferencesPanelImages(planImages)) {
    return mergedSlots?.length ? [...mergedSlots] : [...(panelRefs || [])];
  }
  const refs = panelRefs || [];
  const merged = mergedSlots || refs;
  const referencedSlots = collectReferencedPanelImageSlots(refs, planImages, options);
  if (referencedSlots.size === 0) {
    return mergedSlots?.length ? [...mergedSlots] : [...refs];
  }
  const maxIdx = Math.max(refs.length - 1, merged.length - 1, ...referencedSlots, -1);
  const out: string[] = [];
  for (let i = 0; i <= maxIdx; i++) {
    if (referencedSlots.has(i)) {
      const up = String(merged[i] ?? refs[i] ?? '').trim();
      out.push(up);
    } else {
      out.push('');
    }
  }
  while (out.length > 0 && !String(out[out.length - 1] || '').trim()) out.pop();
  return out;
}

/** 按槽位写回上传 URL（不压紧数组），供 Nano / image2 / Omni 与 Seedance 共用 */
export function mergePanelReferenceImagesPreservingSlots(
  panelRefs: string[] | undefined,
  uploadedRefBySlot: Map<number, string>
): string[] {
  return mergeSeedancePanelReferenceImagesAfterUpload(panelRefs, uploadedRefBySlot);
}

/** 上传合并后按创意描述 @ 裁剪面板参考槽（各模型运行流程共用） */
export function mergeAndPrunePanelReferenceImagesAfterUpload(
  panelRefs: string[] | undefined,
  planImages: ReferencedCollectedImageRef[],
  uploadedByToken: Map<string, string>,
  options?: { uploadedMainUrl?: string; imagePreview?: string } & PanelReferenceSlotMatchOptions
): string[] {
  const panel = panelRefs || [];
  const planWithSlots = enrichPlanImagesWithPanelSlotIndexes(panel, planImages, options);
  const uploadedRefBySlot = new Map<number, string>();
  populateUploadedRefBySlotFromMediaPlan(planWithSlots, uploadedByToken, uploadedRefBySlot);
  assignSeedanceUploadedRefsToPanelSlotsByUrlMatch(
    panel,
    planWithSlots,
    uploadedByToken,
    uploadedRefBySlot,
    options
  );
  /** prune 须与面板下标等长；勿用 stripPanelRefsDuplicateOfMain 压紧后的 merged */
  const mergedPreserving = mergePanelReferenceImagesPreservingSlots(
    panel,
    uploadedRefBySlot
  );
  return prunePanelReferenceImagesToPromptRefs(
    panel,
    planWithSlots,
    mergedPreserving,
    options
  );
}

/** 上传完成后：按面板槽位合并创意描述 @ 到的素材（API 仍只用 plan 顺序） */
export function buildPanelReferenceImagesAfterUpload(
  panelRefs: string[] | undefined,
  planImages: ReferencedCollectedImageRef[],
  uploadedByToken: Map<string, string>,
  options?: { uploadedMainUrl?: string; imagePreview?: string } & PanelReferenceSlotMatchOptions
): string[] {
  const panel = panelRefs || [];
  const planWithSlots = enrichPlanImagesWithPanelSlotIndexes(panel, planImages, options);
  const uploadedRefBySlot = new Map<number, string>();
  populateUploadedRefBySlotFromMediaPlan(planWithSlots, uploadedByToken, uploadedRefBySlot);
  assignSeedanceUploadedRefsToPanelSlotsByUrlMatch(
    panel,
    planWithSlots,
    uploadedByToken,
    uploadedRefBySlot,
    options
  );
  const merged = mergePanelReferenceImagesPreservingSlots(panel, uploadedRefBySlot);
  if (options?.uploadedMainUrl) {
    return stripPanelRefsDuplicateOfMain(
      merged,
      options?.imagePreview,
      options.uploadedMainUrl
    );
  }
  return merged;
}

export function mergeSeedancePanelReferenceMovsAfterUpload(
  panelMovs: Array<{ url: string; posterDataUrl?: string }> | undefined,
  planVideos: ReferencedCollectedVideoRef[],
  uploadedMovs: string[]
): Array<{ url: string; posterDataUrl?: string }> {
  const movs = [...(panelMovs || [])];
  for (let i = 0; i < planVideos.length; i++) {
    const entry = planVideos[i];
    const up = uploadedMovs[i];
    if (!up) continue;
    const n = parseInt(entry.label.replace(/^视频/, ''), 10) || i + 1;
    const idx = n - 1;
    if (idx >= 0 && idx < movs.length) {
      movs[idx] = { ...movs[idx], url: up };
    } else if (idx >= movs.length) {
      movs.push({ url: up });
    }
  }
  return movs.filter((m) => String(m.url || '').trim());
}

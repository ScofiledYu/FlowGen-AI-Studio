import type { NodeData, GenerationParams } from '../types';
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
  mergePanelWithPersistedRefsIfPromptNeeds,
  persistedReferenceImagesForRun,
} from './panelRefPersistence';
import {
  buildReferenceIndexOptionsFromPlan,
  collectReferencedMediaFromPrompt,
  getNodeInspectorPromptText,
  isDuplicateOfMainImagePreview,
  isLikelyMainVideoUrl,
  panelLabelSlotMatchesAssetLib,
  promptMentionsAnyImageRefForNodeData,
  promptMentionsMainImageForNodeData,
  resolvePictureTokenSlotIndex,
  stripPanelRefsDuplicateOfMain,
} from './promptMediaRefs';
import { isImage2Model, isNanoBanana2Model, MODEL_IMAGE_2, MODEL_NANO_BANANA_2 } from '../types';
import { stripImage2MainPreviewDuplicateSlots } from './image2PanelRefs';
import { referenceMediaAlreadyInSlots, normalizePanelReferenceUrlKey } from './referenceImageSlotLabels';

function livePanelReferenceImages(data: Partial<NodeData>): string[] | undefined {
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

/** 各模型运行上传时：与面板参考格一致的 URL 列表；仅当 @图片n/@资产 且面板空时才合并 gp 历史 */
export function panelReferenceImagesForUpload(data: Partial<NodeData>): string[] | undefined {
  // 参考 Banana2 方案：image2 运行上传时不再 strip 主图重复槽，保留全部拖入槽，
  // 避免运行后面板丢图/标签错位。展示层 buildImage2PanelDisplayEntries 已过滤主图重复槽。
  const panel = livePanelReferenceImages(data);
  const prompt = getNodeInspectorPromptText(data as NodeData) || String(data.prompt || '');
  const persisted = persistedReferenceImagesForRun(data);
  return mergePanelWithPersistedRefsIfPromptNeeds(panel, persisted, prompt, data.imagePreview);
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

/** Plan 中是否有 @资产:xxx 条目指向节点主图（与 imagePreview 同素材）。
 *  仅用于 Seedance 参考生视频：用户拖入资产作主图后用 @资产:名称 引用，
 *  运行后主图格不应被隐藏。其他模型仍走 @主图 判定。
 *  比对资产库 URL 而非面板槽 URL，避免误拖主预览时 panel 槽 URL 与 imagePreview 同地址导致误判。
 */
export function planImagesReferenceMainImageAsset(
  planImages: ReferencedCollectedImageRef[],
  nodeData?: Partial<NodeData>,
  projectAssets?: ProjectAssetLabelRow[]
): boolean {
  if (!nodeData) return false;
  const model = String(nodeData.selectedModel || '').trim();
  const mode = String(nodeData.seedanceGenerationMode || '').trim();
  if (!model.includes('seedance') || mode !== 'reference') return false;
  const mainUrl = String(nodeData.imagePreview || '').trim();
  if (!mainUrl || isLikelyMainVideoUrl(mainUrl)) return false;
  for (const e of planImages) {
    if (MAIN_IMAGE_REF_TOKENS.has(e.token)) continue;
    if (!e.token.startsWith('@资产:')) continue;
    const key = e.token.slice('@资产:'.length).trim();
    if (!key) continue;
    const asset = projectAssets?.find(
      (a) => a.slug === key || a.name.trim() === key
    );
    if (!asset) continue;
    const libUrl = String(asset.url || '').trim();
    if (libUrl && isDuplicateOfMainImagePreview(libUrl, mainUrl)) return true;
  }
  return false;
}

/** 从 plan 中找到指向主图（同素材）条目的上传 URL */
export function uploadedMainUrlFromPlanAssetEntry(
  planImages: ReferencedCollectedImageRef[],
  uploadedByToken: Map<string, string>,
  nodeData?: Partial<NodeData>
): string | undefined {
  const mainUrl = String(nodeData?.imagePreview || '').trim();
  if (!mainUrl || isLikelyMainVideoUrl(mainUrl)) return undefined;
  for (const e of planImages) {
    if (MAIN_IMAGE_REF_TOKENS.has(e.token)) continue;
    if (isDuplicateOfMainImagePreview(e.url, mainUrl)) {
      const up = uploadedByToken.get(e.token);
      if (up) return up;
    }
  }
  return undefined;
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

/** seedance 参考生：紧凑 API referenceImages 已含「主图」标签（勿再单独展示 imagePreview 主图格） */
export function seedanceReferenceCompactRefsIncludeMainLabel(
  data: Partial<NodeData>
): boolean {
  const model = String(data.selectedModel || data.generationParams?.model || '').trim();
  if (!['seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(model)) return false;
  const mode = (data.seedanceGenerationMode ||
    data.generationParams?.seedanceGenerationMode ||
    'text') as string;
  if (mode !== 'reference') return false;
  const { referenceImages, referenceImageLabels } = pickSeedanceReferencePanelSnapshot(data);
  if (!referenceImages.length) return false;
  return Boolean(referenceImageLabels?.some((l) => String(l || '').trim() === '主图'));
}

/** 画布节点缩略图：未 @主图 运行后保留主图（panelMainImageUrl 备份）；旧节点 imagePreview 已切到 @ 参考时仍可读 gp */
export function resolveCanvasNodePreviewUrl(
  data: Partial<NodeData>,
  projectAssets?: ProjectAssetLabelRow[]
): string | undefined {
  const backup = String(data.panelMainImageUrl || '').trim();
  const preview = String(data.imagePreview || '').trim();
  if (
    backup &&
    !isLikelyMainVideoUrl(backup) &&
    !promptMentionsMainImageForNodeData(data) &&
    promptMentionsAnyImageRefForNodeData(data)
  ) {
    if (preview && !isLikelyMainVideoUrl(preview)) return preview;
    return backup;
  }

  const gp = data.generationParams;
  const gpRefs = Array.isArray(gp?.referenceImages)
    ? gp!.referenceImages!.map((u) => String(u || '').trim()).filter(Boolean)
    : [];
  /** 仅运行后隐藏主图格（panelMainSlotVisible=false / panelMainImageUrl 备份）才用 gp 首项作画布缩略图 */
  if (
    gpRefs.length > 0 &&
    !promptMentionsMainImageForNodeData(data) &&
    promptMentionsAnyImageRefForNodeData(data) &&
    (data.panelMainSlotVisible === false || backup)
  ) {
    const first = gpRefs[0];
    if (first && !isLikelyMainVideoUrl(first)) return first;
  }
  const directMain = String(data.imagePreview || '').trim();
  if (
    directMain &&
    !isLikelyMainVideoUrl(directMain) &&
    !promptMentionsAnyImageRefForNodeData(data)
  ) {
    return directMain;
  }
  return (
    resolveNodeSelectionPreviewUrl(data, projectAssets) ||
    directMain ||
    undefined
  );
}

/** 属性面板主图格展示 URL：运行后未 @主图 时 imagePreview 可能已切到首个 @ 参考，用备份主图 */
export function resolvePanelMainSlotPreviewUrl(data: Partial<NodeData>): string | undefined {
  const backup = String(data.panelMainImageUrl || '').trim();
  if (backup && !isLikelyMainVideoUrl(backup)) return backup;
  if (data.panelMainSlotVisible === false) return undefined;
  const preview = String(data.imagePreview || '').trim();
  if (preview && !isLikelyMainVideoUrl(preview)) return preview;
  return undefined;
}

/**
 * 属性面板「主图」格：有主预览且未被运行后标记隐藏时展示。
 * - 编辑态 / 运行后：即使创意描述仅有 @图片n/@资产（未 @主图）也保留主图格
 * - 运行后未 @主图：imagePreview 可能为画布首个 @ 参考，主图格用 panelMainImageUrl 展示
 * - seedance 参考生：紧凑 API 参考图已含「主图」标签时不再单独占一格（避免与 referenceImages[0] 重复）
 */
/** seedance2.0 参考生模式（与 seedanceReferenceCompactRefsIncludeMainLabel 判定一致） */
export function isSeedance20ReferenceMode(data: Partial<NodeData>): boolean {
  const model = String(data.selectedModel || data.generationParams?.model || '').trim();
  if (!['seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(model)) return false;
  const mode = (data.seedanceGenerationMode ||
    data.generationParams?.seedanceGenerationMode ||
    'text') as string;
  return mode === 'reference';
}

/** image2 / Nano / seedance 参考生（非紧凑主图标签）：可从 imageLocalRef hydrate 主图格备份 */
export function supportsMainBackupLocalRefHydrate(data: Partial<NodeData>): boolean {
  const model = String(data.selectedModel || '').trim();
  if (isImage2Model(model) || isNanoBanana2Model(model)) return true;
  return isSeedance20ReferenceMode(data) && !seedanceReferenceCompactRefsIncludeMainLabel(data);
}

/** image2 / Nano / seedance 参考生：运行后 panelMainImageUrl 被剥离时，主图格仍可由 imageLocalRef+IDB 恢复 */
function panelMainSlotRestorableFromLocalRef(data: Partial<NodeData>): boolean {
  const localRef = String(data.imageLocalRef || '').trim();
  if (!localRef || data.panelMainSlotVisible !== false) return false;
  return supportsMainBackupLocalRefHydrate(data);
}

export function shouldShowPanelMainImageSlot(data: Partial<NodeData>): boolean {
  if (seedanceReferenceCompactRefsIncludeMainLabel(data)) return false;
  const backup = String(data.panelMainImageUrl || '').trim();
  if (backup && !isLikelyMainVideoUrl(backup)) return true;
  if (data.panelMainSlotVisible === false) {
    return panelMainSlotRestorableFromLocalRef(data);
  }
  return Boolean(resolvePanelMainSlotPreviewUrl(data));
}

/** 运行后重新选中 / 编辑创意描述：有 panelMainImageUrl 备份则须保留主图格 */
function shouldRestorePanelMainImageSlotForEditing(data: Partial<NodeData>): boolean {
  const backup = String(data.panelMainImageUrl || '').trim();
  if (backup && !isLikelyMainVideoUrl(backup)) return true;
  if (panelMainSlotRestorableFromLocalRef(data)) return true;
  const preview = String(data.imagePreview || '').trim();
  if (!preview || isLikelyMainVideoUrl(preview)) return false;
  const prompt = getNodeInspectorPromptText(data as NodeData).trim();
  if (prompt) {
    if (promptMentionsMainImageForNodeData(data)) return true;
    if (promptMentionsAnyImageRefForNodeData(data)) return false;
  }
  return true;
}

/** 编辑创意描述：legacy panelMainSlotVisible=false 但有运行前主图备份时清除隐藏标记 */
export function buildPanelMainImagePreservePatchOnEdit(
  data: Partial<NodeData>
): Partial<Pick<NodeData, 'panelMainSlotVisible'>> | undefined {
  if (data.panelMainSlotVisible !== false) return undefined;
  if (seedanceReferenceCompactRefsIncludeMainLabel(data)) return undefined;
  const backup = String(data.panelMainImageUrl || '').trim();
  if (!backup || isLikelyMainVideoUrl(backup)) return undefined;
  return { panelMainSlotVisible: undefined };
}

/** 主图格展示时参考格按主图槽 URL 去重；隐藏主图格时 imagePreview 仅作画布大图，勿去重参考槽 */
export function shouldDedupePanelRefsAgainstMainPreview(data: Partial<NodeData>): boolean {
  return shouldShowPanelMainImageSlot(data);
}

/** 参考格底栏标签用：未展示主图格时不把 imagePreview 当作「主图」去重命名 */
export function panelReferenceLabelImagePreview(data: Partial<NodeData>): string | undefined {
  if (!shouldShowPanelMainImageSlot(data)) return undefined;
  return resolvePanelMainSlotPreviewUrl(data);
}

/**
 * 运行后 imagePreview：@主图 → 主图上传 URL；未 @主图 → 画布大图=首个 @ 参考图（生成结果仅进 generatedThumbnails）。
 * 面板主图格：未 @主图 时保留，备份至 panelMainImageUrl，由 resolvePanelMainSlotPreviewUrl 展示。
 */
export type PanelImagePreviewPatchAfterRunOptions = {
  nodeData?: Partial<NodeData>;
  mergedPanelRefs?: string[];
  mergedPanelLabels?: string[];
  projectAssets?: ProjectAssetLabelRow[];
};

function panelMainImageBackupFromNode(
  nodeData?: Partial<NodeData>
): string | undefined {
  const existing = String(nodeData?.panelMainImageUrl || '').trim();
  if (existing && !isLikelyMainVideoUrl(existing)) return existing;
  const preRunMain = String(nodeData?.imagePreview || '').trim();
  const localRef = String(nodeData?.imageLocalRef || '').trim();
  if (localRef && nodeData?.panelMainSlotVisible === false && preRunMain) {
    const firstRef = String(nodeData?.referenceImages?.[0] || '').trim();
    if (firstRef && isDuplicateOfMainImagePreview(preRunMain, firstRef)) {
      // imagePreview 已是首个 @ 参考图，主图在 IDB；勿把参考 URL 误写入 panelMainImageUrl
      return undefined;
    }
  }
  if (!preRunMain || isLikelyMainVideoUrl(preRunMain)) return undefined;
  return preRunMain;
}

/** 创意描述已无 @图片 时清掉遗留 panelMainImageUrl，避免画布缩略图误走「隐藏主图→参考首项」 */
export function buildStalePanelMainBackupClearPatch(
  data: Partial<NodeData>
): Partial<Pick<NodeData, 'panelMainImageUrl' | 'panelMainSlotVisible'>> | undefined {
  const backup = String(data.panelMainImageUrl || '').trim();
  if (!backup || isLikelyMainVideoUrl(backup)) return undefined;
  if (data.panelMainSlotVisible === false) return undefined;
  if (promptMentionsAnyImageRefForNodeData(data)) return undefined;
  return { panelMainImageUrl: undefined, panelMainSlotVisible: undefined };
}

/** 运行后节点刷新：gp 含 @图片 且曾隐藏主图格时，应用 gp 首张参考图恢复画布（链式 OUTPUT 场景） */
export function runNodeShouldHydratePreviewFromGpRefs(data: Partial<NodeData>): boolean {
  const gp = data.generationParams;
  const gpRefs = Array.isArray(gp?.referenceImages)
    ? gp!.referenceImages!.map((u) => String(u || '').trim()).filter(Boolean)
    : [];
  if (!gpRefs.length) return false;
  const probe: Partial<NodeData> = {
    ...data,
    prompt: String(data.prompt || gp?.prompt || '').trim() || data.prompt,
  };
  if (!promptMentionsAnyImageRefForNodeData(probe)) return false;
  if (promptMentionsMainImageForNodeData(probe)) return false;
  if (data.panelMainSlotVisible === false) return true;
  return Boolean(String(data.panelMainImageUrl || '').trim());
}

/** 运行后生图且未 @主图：画布/ hydrate 应优先持久化参考 URL，勿用 IndexedDB blob 主图覆盖 */
export function shouldPreferRunReferencePreviewOverLocalMain(
  data: Partial<NodeData>
): boolean {
  const gp = data.generationParams;
  const refs = Array.isArray(gp?.referenceImages)
    ? gp!.referenceImages!.map((u) => String(u || '').trim()).filter(Boolean)
    : [];
  if (!refs.length) return false;
  if (promptMentionsMainImageForNodeData(data)) return false;
  if (data.panelMainSlotVisible === true) return false;
  // 画布大图保留主图（未切换成 @参考图上传 URL）时，允许从 imageLocalRef+IndexedDB 恢复主图；
  // imagePreview 为空（sanitize 剥离了 blob/data）时也允许恢复，避免运行中刷新主图丢失
  const preview = String(data.imagePreview || '').trim();
  if (!preview || !refs.some((r) => isDuplicateOfMainImagePreview(preview, r))) return false;
  if (String(data.taskId || gp?.taskId || '').trim()) return true;
  return (
    data.panelMainSlotVisible === false || Boolean(String(data.panelMainImageUrl || '').trim())
  );
}

/** 属性面板含独立「主图」格的模型场景（新模型接入多图参考时须追加并跑 test:panel-main-slot） */
export type PanelMainImageSlotScenario = {
  id: string;
  model: string;
  dataPatch?: Partial<NodeData>;
  mainPromptPatch?: Partial<NodeData>;
  emptyPromptPatch?: Partial<NodeData>;
  /** 空 prompt 时是否仍展示主图格（默认 true） */
  expectShowMainWhenEmptyPrompt?: boolean;
  /** @主图 运行后重新选中是否应恢复主图格 */
  expectRestoreWithMainPrompt?: boolean;
};

/** 表驱动场景用占位 URL（勿改为运行时依赖） */
const PANEL_MAIN_SLOT_SCENARIO_REF1 = 'https://cos.example/ref-deer.png';
const PANEL_MAIN_SLOT_SCENARIO_REF2 = 'https://cos.example/ref-goat.png';

export const PANEL_MAIN_IMAGE_SLOT_SCENARIOS: PanelMainImageSlotScenario[] = [
  { id: 'Nano Banana 2.0', model: MODEL_NANO_BANANA_2, expectRestoreWithMainPrompt: true },
  { id: 'image 2', model: MODEL_IMAGE_2, expectRestoreWithMainPrompt: true },
  {
    id: '可灵3.0 Omni multi',
    model: '可灵3.0 Omni',
    dataPatch: {
      klingOmniTab: 'multi',
      klingOmniMultiPrompt: '@图片1参考@图片2风格',
      klingOmniMultiReferenceImages: [PANEL_MAIN_SLOT_SCENARIO_REF1, PANEL_MAIN_SLOT_SCENARIO_REF2],
      prompt: '@图片1参考@图片2风格',
    },
    mainPromptPatch: { klingOmniMultiPrompt: '@主图 参考 @图片2风格' },
    emptyPromptPatch: { klingOmniMultiPrompt: '', prompt: '' },
    expectRestoreWithMainPrompt: true,
  },
  {
    id: '可灵3.0 Omni instruction',
    model: '可灵3.0 Omni',
    dataPatch: {
      klingOmniTab: 'instruction',
      klingOmniInstructionPrompt: '@图片1参考@图片2风格',
      klingOmniInstructionReferenceImages: [PANEL_MAIN_SLOT_SCENARIO_REF1, PANEL_MAIN_SLOT_SCENARIO_REF2],
      prompt: '@图片1参考@图片2风格',
    },
    mainPromptPatch: { klingOmniInstructionPrompt: '@主图 参考 @图片2风格' },
    emptyPromptPatch: { klingOmniInstructionPrompt: '', prompt: '' },
    expectRestoreWithMainPrompt: true,
  },
  {
    id: '可灵3.0 Omni video',
    model: '可灵3.0 Omni',
    dataPatch: {
      klingOmniTab: 'video',
      klingOmniVideoPrompt: '@图片1参考@图片2风格',
      klingOmniVideoReferenceImages: [PANEL_MAIN_SLOT_SCENARIO_REF1, PANEL_MAIN_SLOT_SCENARIO_REF2],
      prompt: '@图片1参考@图片2风格',
    },
    mainPromptPatch: { klingOmniVideoPrompt: '@主图 参考 @图片2风格' },
    emptyPromptPatch: { klingOmniVideoPrompt: '', prompt: '' },
    expectRestoreWithMainPrompt: true,
  },
  {
    id: 'seedance2.0 (急速版) reference',
    model: 'seedance2.0 (急速版)',
    dataPatch: { seedanceGenerationMode: 'reference' },
    expectRestoreWithMainPrompt: true,
  },
  {
    id: 'seedance2.0 (高质量版) reference',
    model: 'seedance2.0 (高质量版)',
    dataPatch: { seedanceGenerationMode: 'reference' },
    expectRestoreWithMainPrompt: true,
  },
];

/** Nano / image2 / 可灵3.0 Omni：旧版运行后曾隐藏主图格；重新选中节点时按需恢复（legacy panelMainSlotVisible=false） */
export function nodeModelUsesPanelMainImageRestore(model: string | undefined): boolean {
  const m = String(model || '').trim();
  return isNanoBanana2Model(m) || isImage2Model(m) || m === '可灵3.0 Omni';
}

/** 重新选中节点编辑：恢复运行后隐藏的主图格与备份主图（仅当创意描述仍 @主图/@主体 或尚无图片类 @ 时） */
export function buildPanelMainImageRestorePatchForEditing(
  data: Partial<NodeData>
): Partial<Pick<NodeData, 'imagePreview' | 'panelMainSlotVisible'>> | undefined {
  if (data.panelMainSlotVisible !== false) return undefined;
  if (!shouldRestorePanelMainImageSlotForEditing(data)) {
    return undefined;
  }
  const backup = String(data.panelMainImageUrl || '').trim();
  const current = String(data.imagePreview || '').trim();
  if (backup && !isLikelyMainVideoUrl(backup)) {
    return { panelMainSlotVisible: undefined, imagePreview: backup };
  }
  if (current && !isLikelyMainVideoUrl(current)) {
    return { panelMainSlotVisible: undefined };
  }
  return undefined;
}

export function buildPanelImagePreviewPatchAfterRun(
  planImages: ReferencedCollectedImageRef[],
  uploadedByToken: Map<string, string>,
  options?: PanelImagePreviewPatchAfterRunOptions
): Partial<Pick<NodeData, 'imagePreview' | 'panelMainSlotVisible' | 'panelMainImageUrl'>> {
  const mentionsMain = promptPlanReferencesMainImage(planImages);
  const mentionsMainAsset = planImagesReferenceMainImageAsset(planImages, options?.nodeData, options?.projectAssets);
  const preRunMain = panelMainImageBackupFromNode(options?.nodeData);
  const mainBackupPatch = preRunMain ? { panelMainImageUrl: preRunMain } : {};
  if (mentionsMain || mentionsMainAsset) {
    const main =
      uploadedByToken.get('@主图') ??
      uploadedByToken.get('@主体') ??
      (mentionsMainAsset
        ? uploadedMainUrlFromPlanAssetEntry(planImages, uploadedByToken, options?.nodeData)
        : undefined);
    return {
      ...(main ? { imagePreview: main } : {}),
      panelMainSlotVisible: true,
      panelMainImageUrl: undefined,
    };
  }
  if (options?.mergedPanelRefs?.length && options.nodeData) {
    // 未 @主图：画布大图=首个 @ 参考图上传 URL（§5.7 原始规则，§10.38 恢复 §10.21）；
    // 面板主图格隐藏 + 备份主图至 panelMainImageUrl（重新选中编辑可恢复）；生成结果仍进 generatedThumbnails / OUTPUT 节点
    const first = firstUploadedNonMainImageFromPlan(planImages, uploadedByToken);
    return {
      ...(first ? { imagePreview: first } : {}),
      panelMainSlotVisible: false,
      ...mainBackupPatch,
    };
  }
  const first = firstUploadedNonMainImageFromPlan(planImages, uploadedByToken);
  return {
    ...(first ? { imagePreview: first, panelMainSlotVisible: false } : {}),
    ...mainBackupPatch,
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

/** 参考生视频上传后拆分：@主图 → imagePreview，@图片n → referenceImages（互不重复）。
 *  @资产:xxx 若指向节点主图（资产库 URL 同素材），也归入 mainImageUrl 而非 referenceOnlyImages。
 */
export function splitSeedanceUploadedReferenceImages(
  plan: ReferencedMediaPlan,
  uploadedImgs: string[],
  nodeData?: Partial<NodeData>,
  projectAssets?: ProjectAssetLabelRow[]
): { mainImageUrl?: string; referenceOnlyImages: string[] } {
  const mainUrl = String(nodeData?.imagePreview || '').trim();
  let mainImageUrl: string | undefined;
  const referenceOnlyImages: string[] = [];
  for (let i = 0; i < plan.images.length; i++) {
    const entry = plan.images[i];
    const url = uploadedImgs[i];
    if (!url) continue;
    let isMainRef = MAIN_IMAGE_REF_TOKENS.has(entry.token);
    if (!isMainRef && mainUrl && !isLikelyMainVideoUrl(mainUrl) && entry.token.startsWith('@资产:')) {
      const key = entry.token.slice('@资产:'.length).trim();
      const asset = projectAssets?.find((a) => a.slug === key || a.name.trim() === key);
      const libUrl = String(asset?.url || '').trim();
      if (libUrl && isDuplicateOfMainImagePreview(libUrl, mainUrl)) isMainRef = true;
    }
    if (isMainRef) {
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
    if (img.refFrameIndex === 1 || END_FRAME_REF_TOKENS.has(img.token)) {
      endUrl = url;
    } else if (img.refFrameIndex === 0 || START_FRAME_REF_TOKENS.has(img.token)) {
      if (!startUrl) startUrl = url;
    }
  }
  if (!startUrl && plan.images.length > 0) {
    const first = plan.images[0];
    if (first.refFrameIndex !== 1 && !END_FRAME_REF_TOKENS.has(first.token)) {
      startUrl = uploadedByToken.get(first.token);
    }
  }
  return { startUrl, endUrl };
}

export type FrameUploadUrls = { startUrl?: string; endUrl?: string };

export function promptPlanReferencesStartFrame(
  planImages: ReferencedCollectedImageRef[]
): boolean {
  return planImages.some(
    (e) => e.refFrameIndex === 0 || START_FRAME_REF_TOKENS.has(e.token)
  );
}

export function promptPlanReferencesEndFrame(
  planImages: ReferencedCollectedImageRef[]
): boolean {
  return planImages.some(
    (e) => e.refFrameIndex === 1 || END_FRAME_REF_TOKENS.has(e.token)
  );
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

/** 面板槽已是远程 URL（COS/资产库）时，以槽内 URL 为准，勿用内存里可能过期的 File */
function isRemotePanelReferenceUrl(url: string): boolean {
  const s = String(url || '').trim();
  if (!s) return false;
  if (s.startsWith('blob:') || s.startsWith('data:')) return false;
  if (s.startsWith('flowgen-local:')) return false;
  return s.startsWith('http://') || s.startsWith('https://');
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
  if (
    slotOriginalFileConflictsWithPlanEntry({ ...entry, url: compareUrl }, slotUrl)
  ) {
    return false;
  }
  // 画布换图/拖入后槽位已是 COS，originals 仍可能是旧拖入 File（20260709 @图片2 串图）
  if (isRemotePanelReferenceUrl(slot) && isRemotePanelReferenceUrl(compareUrl)) {
    return false;
  }
  return true;
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

/**
 * Seedance 参考生视频 API referenceImages：与 plan.imageIndex / [图N] 展开一致，含 @主图。
 * 仅 @主图 时也必须写入 referenceImages，否则网关收不到参考图。
 */
export function buildSeedanceReferenceImagesApiPayload(
  planImages: ReferencedCollectedImageRef[],
  uploadedByToken: Map<string, string>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of planImages) {
    const up = String(uploadedByToken.get(entry.token) || '').trim();
    if (!up) continue;
    const key = normalizePanelReferenceUrlKey(up);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(up);
  }
  return out;
}

/** 与 buildSeedanceReferenceImagesApiPayload 顺序一致，供 Node Details / generationParams 标注 */
export function buildSeedanceReferenceApiLabelsFromPlan(
  planImages: ReferencedCollectedImageRef[],
  uploadedByToken: Map<string, string>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of planImages) {
    const up = String(uploadedByToken.get(entry.token) || '').trim();
    if (!up) continue;
    const key = normalizePanelReferenceUrlKey(up);
    if (seen.has(key)) continue;
    seen.add(key);
    const fromPlan = entry.label?.trim();
    if (fromPlan) {
      out.push(fromPlan);
      continue;
    }
    if (entry.token === '@主图' || entry.token === '@主体') {
      out.push('主图');
    } else if (entry.token === '@首帧图') {
      out.push('首帧图');
    } else if (entry.token === '@尾帧图') {
      out.push('尾帧图');
    } else if (entry.token === '@图片') {
      out.push('图片1');
    } else if (/^@图片\d+$/.test(entry.token)) {
      out.push(entry.token.slice(1));
    } else if (entry.token.startsWith('@资产:')) {
      out.push(entry.token.slice('@资产:'.length).trim() || `图片${out.length + 1}`);
    } else {
      out.push(`图片${out.length + 1}`);
    }
  }
  return out;
}

/** Omni multi tab：generationParams 标签与 imageList（首帧 + @图片n）API 顺序对齐 */
export function buildOmniMultiGenerationParamsLabels(
  apiRefs: string[],
  planImages: ReferencedCollectedImageRef[],
  uploadedByToken: Map<string, string>,
  firstFrameUrl?: string
): string[] {
  if (!apiRefs.length) return [];
  const labelForEntry = (entry: ReferencedCollectedImageRef): string => {
    const fromPlan = entry.label?.trim();
    if (fromPlan) return fromPlan;
    if (entry.token === '@主图' || entry.token === '@主体') return '主图';
    if (entry.token === '@首帧图') return '首帧图';
    if (entry.token === '@尾帧图') return '尾帧图';
    if (entry.token === '@图片') return '图片1';
    if (/^@图片\d+$/.test(entry.token)) return entry.token.slice(1);
    if (entry.token.startsWith('@资产:')) {
      return entry.token.slice('@资产:'.length).trim() || '图片1';
    }
    return '图片1';
  };
  const firstFrameKey = firstFrameUrl ? normalizePanelReferenceUrlKey(firstFrameUrl) : '';
  const firstFrameEntry =
    planImages.find((e) => OMNI_MULTI_FIRST_FRAME_TOKENS.has(e.token)) ??
    planImages.find((e) => e.token === '@图片1' || e.token === '@图片') ??
    planImages[0];
  const out: string[] = [];
  const matchedPlan = new Set<number>();
  for (let apiIdx = 0; apiIdx < apiRefs.length; apiIdx++) {
    const apiUrl = apiRefs[apiIdx]!;
    const apiKey = normalizePanelReferenceUrlKey(apiUrl);
    let label = '';
    if (apiIdx === 0 && firstFrameKey && apiKey === firstFrameKey && firstFrameEntry) {
      label = labelForEntry(firstFrameEntry);
    }
    if (!label) {
      for (let pi = 0; pi < planImages.length; pi++) {
        if (matchedPlan.has(pi)) continue;
        const entry = planImages[pi];
        const up = String(uploadedByToken.get(entry.token) || '').trim();
        if (!up || normalizePanelReferenceUrlKey(up) !== apiKey) continue;
        label = labelForEntry(entry);
        matchedPlan.add(pi);
        break;
      }
    }
    if (!label) label = `图片${out.length + 1}`;
    out.push(label);
  }
  return out.slice(0, apiRefs.length);
}

/** Omni multi tab：API imageList = 首帧 + @图片n；同素材勿重复（隐式首帧=@图片2 时仅 3 张） */
export function buildOmniMultiApiImageList(input: {
  firstFrameUrl: string;
  extraEntries: ReferencedCollectedImageRef[];
  uploadedByToken: Map<string, string>;
  refElementIds?: Array<string | null | undefined>;
  maxRefImages?: number;
}): Array<{ image_url: string; element_id?: string }> {
  const maxRef = input.maxRefImages ?? 6;
  const first = String(input.firstFrameUrl || '').trim();
  if (!first) return [];
  const seenKeys = new Set<string>();
  const firstKey = normalizePanelReferenceUrlKey(first);
  if (firstKey) seenKeys.add(firstKey);
  const firstAsset = parseProjectAssetIdsFromMediaUrl(first);
  const seenAssetPairs = new Set<string>();
  if (firstAsset) seenAssetPairs.add(`${firstAsset.projectId}:${firstAsset.assetId}`);

  const isDup = (url: string): boolean => {
    const u = String(url || '').trim();
    if (!u) return true;
    const key = normalizePanelReferenceUrlKey(u);
    if (key && seenKeys.has(key)) return true;
    const ids = parseProjectAssetIdsFromMediaUrl(u);
    if (ids && seenAssetPairs.has(`${ids.projectId}:${ids.assetId}`)) return true;
    if (key) seenKeys.add(key);
    if (ids) seenAssetPairs.add(`${ids.projectId}:${ids.assetId}`);
    return false;
  };

  const out: Array<{ image_url: string; element_id?: string }> = [{ image_url: first }];
  for (const entry of input.extraEntries.slice(0, maxRef)) {
    const url = String(input.uploadedByToken.get(entry.token) || '').trim();
    if (!url || isDup(url)) continue;
    const idx = entry.refImageSlotIndex ?? 0;
    const rawEid = input.refElementIds?.[idx];
    const eid =
      rawEid && !String(rawEid).startsWith('canvas:') ? String(rawEid) : undefined;
    out.push(eid ? { image_url: url, element_id: eid } : { image_url: url });
  }
  return out;
}

/** Seedance 参考生：面板/API 紧凑 referenceImages（优先 tab 快照） */
export function pickSeedanceReferencePanelSnapshot(data: Partial<NodeData>): {
  referenceImages: string[];
  referenceImageLabels?: string[];
} {
  const refTab = data.seedanceTabConfigs?.reference as
    | { referenceImages?: string[]; referenceImageLabels?: string[] }
    | undefined;
  const referenceImages = (
    refTab?.referenceImages?.length ? refTab.referenceImages : data.referenceImages
  )
    ?.map((u) => String(u || '').trim())
    .filter(Boolean);
  if (!referenceImages?.length) return { referenceImages: [] };
  const referenceImageLabels = refTab?.referenceImageLabels?.length
    ? refTab.referenceImageLabels
    : data.referenceImageLabels;
  return {
    referenceImages,
    referenceImageLabels: referenceImageLabels?.length ? [...referenceImageLabels] : undefined,
  };
}

function seedanceReferenceSnapshotUrlsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (u, i) => normalizePanelReferenceUrlKey(u) === normalizePanelReferenceUrlKey(b[i] || '')
  );
}

/**
 * 面板 referenceImages 已与 API 对齐，但 generationParams 仍残留 image2 等旧参考图时，
 * 从面板/tab 快照写回 generationParams（刷新加载 / recovery 共用）。
 */
export function repairSeedanceReferenceGenerationParamsFromPanel(
  data: Partial<NodeData>
): GenerationParams | undefined {
  const model = String(data.selectedModel || data.generationParams?.model || '').trim();
  if (!['seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(model)) return undefined;
  const mode = (data.seedanceGenerationMode ||
    data.generationParams?.seedanceGenerationMode ||
    'text') as string;
  if (mode !== 'reference') return undefined;

  const { referenceImages: panelRefs, referenceImageLabels: panelLabels } =
    pickSeedanceReferencePanelSnapshot(data);
  if (!panelRefs.length) return undefined;

  const prev = (data.generationParams || {}) as GenerationParams;
  const prevRefs = (prev.referenceImages || [])
    .map((u) => String(u || '').trim())
    .filter(Boolean);
  if (seedanceReferenceSnapshotUrlsMatch(prevRefs, panelRefs)) return undefined;

  return {
    ...prev,
    model,
    seedanceGenerationMode: 'reference',
    referenceImages: [...panelRefs],
    referenceImageLabels: panelLabels?.some((l) => String(l || '').trim())
      ? [...panelLabels]
      : undefined,
  };
}

/** 紧凑 API 参考图已含「主图」标签时，隐藏独立主图格，避免面板双主图 */
export function repairSeedanceReferencePanelMainSlotIfNeeded(
  data: Partial<NodeData>
): Partial<Pick<NodeData, 'panelMainSlotVisible'>> | undefined {
  if (data.panelMainSlotVisible === false) return undefined;
  if (!seedanceReferenceCompactRefsIncludeMainLabel(data)) return undefined;
  return { panelMainSlotVisible: false as const };
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
    entry.refFrameIndex === 0 &&
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
    const main = String(options?.imagePreview || '').trim();
    const isMainDup = (i: number) =>
      Boolean(main && isDuplicateOfMainImagePreview(String(panelRefs[i] || '').trim(), main));
    for (const i of hits) {
      if (labels[i]?.trim() === want && !isMainDup(i)) return i;
    }
    for (const i of hits) {
      if (!isMainDup(i)) return i;
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
    /** 仅 @主图：主图走 imagePreview，参考槽应为空（勿把 API 主图 URL 或历史脏槽留在「图片1」） */
    if (promptPlanReferencesMainImage(planImages)) {
      return [];
    }
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

/**
 * 上传合并后面板参考槽写回（各模型运行流程共用）。
 * 面板保留全部已拖入图片；API / generationParams / Node Details 仍仅含创意描述 @ 到的素材。
 */
export function mergeAndPrunePanelReferenceImagesAfterUpload(
  panelRefs: string[] | undefined,
  planImages: ReferencedCollectedImageRef[],
  uploadedByToken: Map<string, string>,
  options?: { uploadedMainUrl?: string; imagePreview?: string } & PanelReferenceSlotMatchOptions
): string[] {
  return buildPanelReferenceImagesAfterUpload(panelRefs, planImages, uploadedByToken, options);
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
  return merged;
}

export function mergeSeedancePanelReferenceMovsAfterUpload(
  panelMovs: Array<{ url: string; posterDataUrl?: string }> | undefined,
  planVideos: ReferencedCollectedVideoRef[],
  uploadedMovs: string[]
): Array<{ url: string; posterDataUrl?: string }> {
  // 本次 plan 无 @视频 / 参考视频槽 → 不保留面板历史 referenceMovs（避免纯图参考生误写入 gp/Details）
  if (!planVideos.length) return [];
  const panel = [...(panelMovs || [])];
  const out: Array<{ url: string; posterDataUrl?: string }> = [];
  for (let i = 0; i < planVideos.length; i++) {
    const entry = planVideos[i];
    const up = uploadedMovs[i];
    if (!up) continue;
    const n = parseInt(entry.label.replace(/^视频/, ''), 10) || i + 1;
    const idx = n - 1;
    const prev = idx >= 0 && idx < panel.length ? panel[idx] : undefined;
    out.push({ ...(prev || {}), url: up });
  }
  return out.filter((m) => String(m.url || '').trim());
}

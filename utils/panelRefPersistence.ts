import type { NodeData } from '../types';
import { NodeType } from '../types';
import {
  buildPromptPictureOrdinalRepairPatch,
  getNodeInspectorPromptText,
  isDuplicateOfMainImagePreview,
  resolvePromptMainImagePreviewForRefs,
} from './promptMediaRefs';
import { hasFirstFramePanelSlot } from './firstFramePanel';
import {
  dedupeReferenceUrlList,
  normalizePanelReferenceUrlKey,
  referenceImagesDedupePatchIfNeeded,
  syncGenericReferenceImageLabelsToSlotOrdinals,
  type ProjectAssetLabelRow,
} from './referenceImageSlotLabels';

function promptMentionsMainImage(prompt: string): boolean {
  return /@主图|@主体/.test(String(prompt || '').trim());
}

export function isOutputLikeNodeType(nodeType?: string): boolean {
  return nodeType === NodeType.OUTPUT || nodeType === NodeType.MOV;
}

function outputNodePromptText(data: Partial<NodeData>): string {
  const fromInspector = getNodeInspectorPromptText(data as NodeData);
  if (fromInspector.trim()) return fromInspector.trim();
  return String(data.generationParams?.prompt || data.prompt || '').trim();
}

function collectFramePanelUrls(data: Partial<NodeData>): Set<string> {
  const urls = [
    data.firstFrameImageUrl,
    data.firstFrameImage,
    data.lastFrameImageUrl,
    data.lastFrameImage,
    data.generationParams?.firstFrameImageUrl,
    data.generationParams?.firstFrameImage,
    data.generationParams?.lastFrameImageUrl,
    data.generationParams?.lastFrameImage,
  ];
  return new Set(
    urls.map((u) => String(u || '').trim()).filter(Boolean)
  );
}

export function isFramePanelVideoModel(model: string): boolean {
  return (
    (model.includes('可灵') && model !== '可灵3.0 Omni') ||
    model === 'vidu 2.0' ||
    model === 'seedance1.5-pro' ||
    model === '即梦3.0 Pro'
  );
}

/** Seedance 2.0 参考生：编辑阶段允许先拖参考格再写 @；gp 尚非本次 seedance 运行（含生图 OUTPUT 切模型） */
export function shouldPreserveSeedanceReferencePanelBeforePromptRefs(
  data: Partial<NodeData>,
  model: string
): boolean {
  if (model !== 'seedance2.0 (高质量版)' && model !== 'seedance2.0 (急速版)') return false;
  const mode = data.seedanceGenerationMode ?? data.generationParams?.seedanceGenerationMode;
  if (mode !== 'reference') return false;
  const gpModel = String(data.generationParams?.model || '').trim();
  return gpModel !== model;
}

/**
 * 图生图跑完或切模型后面板 referenceImages 可能被清空，但 generationParams / image2 配置仍保留参考图 URL。
 * @ 解析与运行上传需合并这些持久化槽位，否则 @图片1 无法绑定到已上传参考图。
 */
export function persistedReferenceImagesForRun(data: Partial<NodeData>): string[] {
  const urls: string[] = [];
  for (const src of [
    data.generationParams?.referenceImages,
    data.modelConfigs?.image2?.referenceImages,
  ]) {
    if (!Array.isArray(src)) continue;
    for (const u of src) {
      const t = String(u || '').trim();
      if (t) urls.push(t);
    }
  }
  return dedupeReferenceUrlList(urls);
}

/** 按面板既有顺序合并持久化参考图，保留空槽位下标，不覆盖已有槽位 URL */
export function mergePanelWithPersistedReferenceImages(
  panelRefs: string[] | undefined,
  persistedRefs: string[]
): string[] {
  const out = (panelRefs || []).map((u) => String(u || '').trim());
  if (persistedRefs.length === 0) return out;

  const keyToIndex = new Map<string, number>();
  out.forEach((u, i) => {
    if (u) keyToIndex.set(normalizePanelReferenceUrlKey(u), i);
  });

  for (const url of persistedRefs) {
    const trimmed = String(url || '').trim();
    if (!trimmed) continue;
    const k = normalizePanelReferenceUrlKey(trimmed);
    const idx = keyToIndex.get(k);
    if (idx != null) {
      out[idx] = trimmed;
      continue;
    }
    const emptyIdx = out.findIndex((u) => !u);
    if (emptyIdx >= 0) {
      out[emptyIdx] = trimmed;
      keyToIndex.set(k, emptyIdx);
    } else {
      keyToIndex.set(k, out.length);
      out.push(trimmed);
    }
  }
  return out;
}

/** 创意描述是否 @ 到面板参考格/资产（非仅 @主图/@首帧） */
export function promptNeedsPersistedPanelRefs(prompt: string): boolean {
  const p = String(prompt || '').trim();
  return /@图片\d*|@图片(?![0-9])|@资产:/.test(p);
}

/**
 * generationParams.referenceImages 为 API 上传顺序（含 @主图 时首项常为主图）。
 * 还原面板 referenceImages 槽（不含主图格）。
 */
export function panelReferenceSlotsFromGenerationParamsSnapshot(
  data: Partial<NodeData>,
  prompt: string
): string[] {
  const gpRefs = (data.generationParams?.referenceImages || [])
    .map((u) => String(u || '').trim())
    .filter(Boolean);
  if (!gpRefs.length) return [];

  const main = String(data.imagePreview || '').trim();
  const mentionsMain = promptMentionsMainImage(prompt);

  if (mentionsMain && gpRefs.length > 1) {
    const tail = gpRefs.slice(1);
    if (tail.length) return [...tail];
  }

  if (mentionsMain && main) {
    const withoutMainDup = gpRefs.filter((u) => !isDuplicateOfMainImagePreview(u, main));
    if (withoutMainDup.length > 0) return withoutMainDup;
  }

  return [...gpRefs];
}

/** 面板 referenceImages 仅剩主图重复项，或缺少 gp 里 @图片n 对应参考图 */
export function panelReferenceImagesLookStale(
  panel: string[],
  persistedRefs: string[],
  mainPreview: string | undefined,
  prompt: string
): boolean {
  if (!persistedRefs.length || !promptNeedsPersistedPanelRefs(prompt)) return false;
  const main = String(mainPreview || '').trim();
  const gpPanelRefs = panelReferenceSlotsFromGenerationParamsSnapshot(
    { generationParams: { referenceImages: persistedRefs }, imagePreview: main },
    prompt
  );
  if (!gpPanelRefs.length) return false;

  const panelNonMain = panel.filter(
    (u) => u && (!main || !isDuplicateOfMainImagePreview(u, main))
  );
  if (gpPanelRefs.filter((u) => u && (!main || !isDuplicateOfMainImagePreview(u, main))).length === 0) {
    return false;
  }

  /** 参考槽有 URL 但全部与主图重复（再点运行 @图片1 误解析为主图的典型脏数据） */
  if (panel.some(Boolean) && panelNonMain.length === 0) return true;

  /** 面板已有非主图参考槽：保留用户/Tab 拖入，勿用 gp 覆盖（Omni 等） */
  return false;
}

/** 面板槽全空或相对 gp 已脏时，合并 generationParams / modelConfigs 持久化参考 */
export function mergePanelWithPersistedRefsIfPromptNeeds(
  panelRefs: string[] | undefined,
  persistedRefs: string[],
  prompt: string,
  mainPreview?: string
): string[] {
  const panel = (panelRefs || []).map((u) => String(u || '').trim());
  if (persistedRefs.length === 0) return panel;

  const needsRefs = promptNeedsPersistedPanelRefs(prompt);
  if (!needsRefs && !promptMentionsMainImage(prompt)) return panel;

  const gpPanelSlots = panelReferenceSlotsFromGenerationParamsSnapshot(
    { generationParams: { referenceImages: persistedRefs }, imagePreview: mainPreview },
    prompt
  );
  const persistedForPanel = gpPanelSlots.length ? gpPanelSlots : persistedRefs;

  const panelHasSlots = panel.some(Boolean);
  if (!panelHasSlots) {
    if (!needsRefs) return panel;
    return mergePanelWithPersistedReferenceImages(panel, persistedForPanel);
  }

  const panelNonEmpty = panel.filter(Boolean).length;
  const persistedNonEmpty = persistedForPanel.filter(Boolean).length;
  if (panelNonEmpty > persistedNonEmpty) {
    return panel;
  }

  if (
    needsRefs &&
    panelReferenceImagesLookStale(panel, persistedRefs, mainPreview, prompt)
  ) {
    return mergePanelWithPersistedReferenceImages([], persistedForPanel);
  }

  return panel;
}

/** 重新选中节点：面板 referenceImages 与 gp 不一致时从 gp 恢复（避免再点运行 @图片1→主图） */
export function buildPanelReferenceImagesRestorePatchForEditing(
  data: Partial<NodeData>
): Partial<Pick<NodeData, 'referenceImages' | 'referenceImageLabels'>> | undefined {
  const prompt = getNodeInspectorPromptText(data as NodeData) || String(data.prompt || '');
  if (!promptNeedsPersistedPanelRefs(prompt)) return undefined;

  const panel = (data.referenceImages || []).map((u) => String(u || '').trim());
  const persisted = persistedReferenceImagesForRun(data);
  if (!persisted.length) return undefined;

  const reconciled = mergePanelWithPersistedRefsIfPromptNeeds(
    panel,
    persisted,
    prompt,
    resolvePromptMainImagePreviewForRefs(data) ?? data.imagePreview
  );
  const sameRefs =
    reconciled.length === panel.length && reconciled.every((u, i) => u === panel[i]);
  if (sameRefs) return undefined;

  const gpLabels = data.generationParams?.referenceImageLabels;
  const rawLabels = gpLabels?.some((l) => String(l || '').trim())
    ? [...gpLabels]
    : data.referenceImageLabels?.length
      ? [...data.referenceImageLabels]
      : undefined;
  return {
    referenceImages: reconciled,
    referenceImageLabels: syncGenericReferenceImageLabelsToSlotOrdinals(
      reconciled,
      rawLabels,
      data.imagePreview
    ),
  };
}

function omniActiveReferenceImagesField(
  data: NodeData
): 'klingOmniMultiReferenceImages' | 'klingOmniInstructionReferenceImages' | 'klingOmniVideoReferenceImages' | null {
  if (data.selectedModel !== '可灵3.0 Omni') return null;
  const tab = data.klingOmniTab || 'multi';
  if (tab === 'instruction') return 'klingOmniInstructionReferenceImages';
  if (tab === 'video') return 'klingOmniVideoReferenceImages';
  if (tab === 'multi') return 'klingOmniMultiReferenceImages';
  return null;
}

/** 打开面板 / 槽位变化：gp 恢复 → 去重 → 泛称标签同步 → 创意描述 @图片n 修正 */
export function buildPanelRefSlotSyncPatch(
  data: NodeData,
  options?: {
    dedupeAgainstMain?: boolean;
    projectAssets?: ProjectAssetLabelRow[];
    skipGpRestore?: boolean;
  }
): Partial<NodeData> | undefined {
  let merged = data;
  const out: Partial<NodeData> = {};

  if (!options?.skipGpRestore) {
    const gp = buildPanelReferenceImagesRestorePatchForEditing(data);
    if (gp) {
      Object.assign(out, gp);
      merged = { ...merged, ...gp };
    }
  }

  const omniField = omniActiveReferenceImagesField(merged);
  const dedupeInput =
    omniField && (merged[omniField] || []).length
      ? ({ ...merged, referenceImages: [...(merged[omniField] || [])] } as NodeData)
      : merged;
  const dedupe = referenceImagesDedupePatchIfNeeded(dedupeInput, {
    dedupeAgainstMain: options?.dedupeAgainstMain,
    projectAssets: options?.projectAssets,
    prompt: getNodeInspectorPromptText(merged),
  });
  if (dedupe) {
    if (omniField) {
      out[omniField] = dedupe.referenceImages;
      out.referenceImageLabels = dedupe.referenceImageLabels;
    } else {
      Object.assign(out, dedupe);
    }
    merged = { ...merged, ...out };
  }

  const promptPatch = buildPromptPictureOrdinalRepairPatch(merged, options?.projectAssets);
  if (promptPatch) {
    Object.assign(out, promptPatch);
    merged = { ...merged, ...promptPatch };
  }

  return Object.keys(out).length ? out : undefined;
}

/**
 * OUTPUT/MOV 侧栏参考格：一律为空。
 * 创意描述 / 图片 / 视频 / 音频 / 首尾帧参考仅存于 `generationParams` 快照（Node Details 只读），
 * 不再写回 OUTPUT/MOV 面板（含 @图片n 场景；2026-06 产品规则更新）。
 */
export function sanitizeOutputNodePanelReferenceImages(
  data: Partial<NodeData>,
  nodeType?: string
): string[] {
  if (!isOutputLikeNodeType(nodeType)) {
    return (data.referenceImages || []).map((u) => String(u || '').trim()).filter(Boolean);
  }
  return [];
}

function hasLastFramePanelSlot(data: Partial<NodeData>): boolean {
  return Boolean(
    String(data.lastFrameImage || '').trim() ||
      String(data.lastFrameImageUrl || '').trim() ||
      String(data.lastFrameLocalRef || '').trim()
  );
}

/**
 * OUTPUT/MOV 首尾帧格：一律清空（首尾帧仅作生成入参存于 generationParams / Node Details）。
 */
export function sanitizeOutputNodeFramePanelPatch(
  data: Partial<NodeData>,
  nodeType?: string
): Partial<NodeData> | undefined {
  if (!isOutputLikeNodeType(nodeType)) return undefined;
  if (!hasFirstFramePanelSlot(data) && !hasLastFramePanelSlot(data)) return undefined;

  return {
    firstFrameImage: undefined,
    firstFrameImageUrl: undefined,
    firstFrameLocalRef: undefined,
    firstFrameImageLabel: undefined,
    lastFrameImage: undefined,
    lastFrameImageUrl: undefined,
    lastFrameLocalRef: undefined,
    lastFrameImageLabel: undefined,
  };
}

/** 工程加载 / 刷新后：OUTPUT/MOV 面板态与 API 快照分离。
 *  继承的参考/首尾帧已在 spawn 时为空；用户手动拖入的参考图/首尾帧需跨刷新保留，
 *  此处不再强制清空（与参考图 §16.12 一致）。Node Details 仍只读 generationParams。 */
export function sanitizeOutputLikeNodeDataOnLoad<T extends { type?: string; data?: Partial<NodeData> }>(
  node: T
): T {
  return node;
}

/**
 * 新建 OUTPUT/MOV 时写入侧栏的 referenceImages：一律为空。
 * 创意描述 / 图片 / 视频 / 音频参考仅保留在 generationParams 快照（Node Details 只读）。
 */
export function outputNodePanelReferenceImagesFromRun(_input: {
  isImage2Run: boolean;
  isVideoModel: boolean;
  isSeedance20RefOutput: boolean;
  seedancePanelSnapshot?: string[];
  snapPanelRefs?: string[];
  image2InheritedRefs?: string[];
  inheritedRefs?: string[];
}): string[] | undefined {
  return [];
}

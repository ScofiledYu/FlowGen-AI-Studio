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
import { pickStillImageRecoveryApiReferenceImages } from './referencedMediaRun';
import { SEEDANCE_DURATION_DEFAULT_LABEL } from './seedanceDuration';
import {
  buildReferenceImageDetailItemsFromPanel,
  buildPromptMediaRefContextFromNode,
  buildPromptMediaRefLabels,
  isDuplicateOfMainImagePreview,
  isLikelyMainVideoUrl,
  isOmniTabVideoMainVideoReference,
  omniMultiImagePreviewCountsAsPromptImageRef,
  matchAllPromptMediaTokens,
  panelReferenceSlotLabel,
  promptMentionsMainImageForNodeData,
  promptMentionsAnyImageRefForNodeData,
  referenceVideoUrlsInLabelOrder,
  resolveOmniMultiReferenceSlotVideoUrl,
  type ReferenceImageDetailItem,
} from './promptMediaRefs';
import {
  panelRefDisplayDedupeKey,
  projectAssetMediaPairKeyFromUrl,
  resolvePanelReferenceSlotDisplayUrl,
  isGenericPanelRefLabel,
  type ProjectAssetLabelRow,
} from './referenceImageSlotLabels';
import { parseProjectAssetIdsFromMediaUrl } from './projectAssetPreview';
import { pickNodeGenerationResultPreviewUrl } from './generatedOutputUrl';
import { image2NormalizeQualityLevel, image2ResolveQuality } from './image2Model';

export type { ReferenceImageDetailItem };

export type ReferenceVideoDetailItem = {
  url: string;
  posterDataUrl?: string;
  label: string;
};

/** Node Details 参考视频角标：合并 gp 快照与面板字段供 @视频n / @主视频 解析 */
export function buildNodeDetailsVideoLabelSource(
  nodeData: Partial<NodeData>,
  previewParams: { prompt?: string; model?: string }
): Partial<NodeData> {
  const gp = (nodeData.generationParams || {}) as GenerationParams & {
    klingOmniInstructionPrompt?: string;
    klingOmniVideoPrompt?: string;
    klingOmniMultiPrompt?: string;
  };
  return {
    ...nodeData,
    selectedModel: previewParams.model || nodeData.selectedModel,
    prompt: previewParams.prompt ?? gp.prompt ?? nodeData.prompt,
    klingOmniTab: gp.klingOmniTab ?? nodeData.klingOmniTab,
    klingOmniInstructionPrompt: gp.klingOmniInstructionPrompt ?? nodeData.klingOmniInstructionPrompt,
    klingOmniVideoPrompt: gp.klingOmniVideoPrompt ?? nodeData.klingOmniVideoPrompt,
    klingOmniMultiPrompt: gp.klingOmniMultiPrompt ?? nodeData.klingOmniMultiPrompt,
    klingOmniInstructionVideoUrl:
      gp.klingOmniInstructionVideoUrl ?? nodeData.klingOmniInstructionVideoUrl,
    klingOmniInstructionVideoPreviewUrl:
      gp.klingOmniInstructionVideoPreviewUrl ?? nodeData.klingOmniInstructionVideoPreviewUrl,
    klingOmniVideoUrl: gp.klingOmniVideoUrl ?? nodeData.klingOmniVideoUrl,
    klingOmniVideoPreviewUrl: gp.klingOmniVideoPreviewUrl ?? nodeData.klingOmniVideoPreviewUrl,
    klingOmniInstructionReferenceImages: nodeData.klingOmniInstructionReferenceImages,
    klingOmniVideoReferenceImages: nodeData.klingOmniVideoReferenceImages,
    klingOmniMultiReferenceImages: nodeData.klingOmniMultiReferenceImages,
    referenceMovs: gp.referenceMovs ?? nodeData.referenceMovs,
    referenceImageLabels: gp.referenceImageLabels ?? nodeData.referenceImageLabels,
  };
}

/** Node Details Reference Videos：与创意描述 @视频n / @主视频 对齐的角标 */
export function buildReferenceVideoDetailItems(
  panelSource: Partial<NodeData>,
  referenceMovs: Array<{ url: string; posterDataUrl?: string }>
): ReferenceVideoDetailItem[] {
  if (!referenceMovs?.length) return [];
  const node = panelSource as NodeData;
  const ctx = buildPromptMediaRefContextFromNode(node);
  const videoLabelItems = buildPromptMediaRefLabels(node, ctx).filter(
    (i) => i.kind === 'video' || i.kind === 'mainVideo'
  );
  const urlsInOrder = referenceVideoUrlsInLabelOrder(node, ctx);
  const numberedLabels = videoLabelItems.filter((i) => i.kind === 'video');

  return referenceMovs.map((m, movIdx) => {
    const url = String(m.url || '').trim();
    let label = '视频';

    const tab = ctx.klingOmniTab;
    if (
      (tab === 'instruction' || tab === 'video') &&
      isOmniTabVideoMainVideoReference(panelSource, url, tab)
    ) {
      label = '主视频';
    } else {
      const ordIdx = urlsInOrder.findIndex((u) => isSameVideoAssetForDetails(u, url));
      if (ordIdx >= 0) {
        label = numberedLabels[ordIdx]?.label ?? `视频${ordIdx + 1}`;
      } else if (movIdx >= 0) {
        label = `视频${movIdx + 1}`;
      }
    }

    return { url: m.url, posterDataUrl: m.posterDataUrl, label };
  });
}

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

/** 多图参考模型且未 @主图：误拖主预览仅作画布/聊天兜底，不进 Details/API 池（面板可仍展示主图格） */
export function nodeUsesHiddenMainPreviewSlot(data: Partial<NodeData>): boolean {
  if (promptMentionsMainImageForNodeData(data)) return false;
  const model = String(data.selectedModel || '').trim();
  const multiRef =
    model === MODEL_NANO_BANANA_2 ||
    model === MODEL_IMAGE_2 ||
    ((model === 'seedance2.0 (高质量版)' || model === 'seedance2.0 (急速版)') &&
      (data.seedanceGenerationMode || 'text') === 'reference');
  if (!multiRef) return false;
  if (data.panelMainSlotVisible === false) return true;
  /** 仅创意描述含 @图片n/@资产 时 panelMainImageUrl 才表示「运行后隐藏主图格」 */
  if (!promptMentionsAnyImageRefForNodeData(data)) return false;
  return Boolean(String(data.panelMainImageUrl || '').trim());
}

/** 未 @主图且主图格已隐藏时，不把 imagePreview 并入 Details 的 url 池 */
export function shouldIncludeImagePreviewInNodeDetailsUrlPool(data: Partial<NodeData>): boolean {
  if (!nodeUsesHiddenMainPreviewSlot(data)) return true;
  return false;
}

/** Node Details 左侧大图：参考生且主图格已隐藏时，不展示与参考列表无关的 imagePreview（如误拖入的健身房图）。 */
export function resolveNodeDetailsHeroImageUrl(
  data: Partial<NodeData>,
  options?: {
    referenceImageDetailItems?: ReferenceImageDetailItem[];
    projectAssets?: ProjectAssetLabelRow[];
  }
): string | undefined {
  const main = String(data.imagePreview || '').trim();

  // Seedance 参考生 MOV/OUTPUT 节点：PREVIEW MODE 优先展示参考视频（@主视频），而非生成的 imagePreview
  // 但 Generated Outputs 历史预览（有 _historyOutputNodeId）应展示实际生成的视频，不走此逻辑
  const isHistoryPreview = !!(data as any)._historyOutputNodeId;
  const isSeedanceRef =
    typeof data.selectedModel === 'string' &&
    (data.selectedModel.includes('seedance2.0') || data.selectedModel.includes('seedance1.5')) &&
    data.seedanceGenerationMode === 'reference';
  if (!isHistoryPreview && isLikelyMainVideoUrl(main) && isSeedanceRef && data.referenceMovs?.length) {
    const refMovUrl = String(data.referenceMovs[0]?.url || '').trim();
    if (refMovUrl) return refMovUrl;
  }

  // 可灵3.0 Omni 指令变换/视频参考：MOV/OUTPUT 节点 PREVIEW MODE 优先展示参考视频（@主视频），而非生成的 imagePreview
  // 与 Seedance 参考生逻辑一致；generationParams.klingOmniTab 优先于节点顶层 klingOmniTab（后者可能不一致）
  const gp = data.generationParams as any;
  const omniTab = gp?.klingOmniTab || data.klingOmniTab;
  const isOmniVideoRef =
    typeof data.selectedModel === 'string' &&
    data.selectedModel === '可灵3.0 Omni' &&
    (omniTab === 'instruction' || omniTab === 'video');
  if (!isHistoryPreview && isLikelyMainVideoUrl(main) && isOmniVideoRef && data.referenceMovs?.length) {
    const refMovUrl = String(data.referenceMovs[0]?.url || '').trim();
    if (refMovUrl) return refMovUrl;
  }

  if (!nodeUsesHiddenMainPreviewSlot(data)) return main || undefined;

  const items = options?.referenceImageDetailItems || [];
  if (!main) return items[0]?.url?.trim() || undefined;
  if (!items.length) return main || undefined;

  const pa = options?.projectAssets;
  const mainKey = panelRefDisplayDedupeKey(main, data.imageName, pa);
  const inRefs = items.some((it) => {
    const k = panelRefDisplayDedupeKey(it.url, it.label, pa);
    return Boolean(mainKey && k && mainKey === k);
  });
  if (inRefs) return main;

  const backup = String(data.panelMainImageUrl || '').trim();
  if (backup) {
    const backupKey = panelRefDisplayDedupeKey(backup, data.imageName, pa);
    if (mainKey && backupKey && mainKey === backupKey) {
      return items[0]?.url?.trim() || undefined;
    }
  }

  const generationResult = pickNodeGenerationResultPreviewUrl(data);
  if (main && generationResult) {
    const genKey = panelRefDisplayDedupeKey(generationResult, data.imageName, pa);
    if (mainKey && genKey && mainKey !== genKey) {
      return main;
    }
  }

  // 非 Seedance 参考生的视频节点：imagePreview 是视频 URL 时直接返回视频，不被参考图覆盖
  if (isLikelyMainVideoUrl(main)) return main;

  return items[0]?.url?.trim() || undefined;
}

/** 画布选中 / 聊天侧栏节点预览：与 Node Details 大图同一套规则，避免误拖主预览（如猫图）盖住 @ 参考图 */
export function resolveNodeSelectionPreviewUrl(
  data: Partial<NodeData>,
  projectAssets?: ProjectAssetLabelRow[]
): string | undefined {
  const gp = data.generationParams;
  const enriched = enrichPanelSourceFromGenerationSnapshot(data, gp);
  const items = buildReferenceImageDetailItemsFromPanel(enriched, { projectAssets });
  const main = String(data.imagePreview || '').trim();
  const mainEphemeral = main.startsWith('blob:') || /^data:/i.test(main);

  if (
    mainEphemeral &&
    items.length > 0 &&
    !promptMentionsMainImageForNodeData(enriched) &&
    (String(data.taskId || gp?.taskId || '').trim() ||
      data.panelMainSlotVisible === false ||
      String(data.panelMainImageUrl || '').trim())
  ) {
    return resolveNodeDetailsHeroImageUrl(
      {
        ...enriched,
        panelMainSlotVisible: false,
        imagePreview: items[0]?.url,
      },
      { referenceImageDetailItems: items, projectAssets }
    );
  }

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
    const correctedUrl = item.url;

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

/**
 * 面板 referenceImages 被清空（如切模型）时，用 generationParams / modelConfigs 快照补回，
 * 供 Node Details 与 hydrate 画布预览一致。
 */
export function enrichPanelSourceFromGenerationSnapshot(
  panelSource: Partial<NodeData>,
  gp?: Partial<GenerationParams> | null
): Partial<NodeData> {
  const refs = panelSource.referenceImages || [];
  if (refs.some((u) => String(u || '').trim())) return panelSource;

  const model = String(gp?.model || panelSource.selectedModel || '').trim();
  const mc = panelSource.modelConfigs;
  if (mc && model) {
    const cfg = mc[model as keyof typeof mc] as
      | { referenceImages?: string[]; referenceImageLabels?: string[]; prompt?: string }
      | undefined;
    if (cfg?.referenceImages?.some((u) => String(u || '').trim())) {
      return {
        ...panelSource,
        selectedModel: model || panelSource.selectedModel,
        referenceImages: [...cfg.referenceImages!],
        ...(cfg.referenceImageLabels?.length
          ? { referenceImageLabels: [...cfg.referenceImageLabels] }
          : Array.isArray(gp?.referenceImageLabels)
            ? { referenceImageLabels: [...gp!.referenceImageLabels!] }
            : {}),
        prompt:
          String(panelSource.prompt || '').trim() ||
          cfg.prompt ||
          gp?.prompt ||
          panelSource.prompt,
      };
    }
  }

  const snapRefs = Array.isArray(gp?.referenceImages)
    ? gp!.referenceImages!.map((u) => String(u || '').trim()).filter(Boolean)
    : [];
  if (!snapRefs.length) return panelSource;

  const promptText =
    String(panelSource.prompt || '').trim() || String(gp?.prompt || '').trim();
  const inferredLabels = promptText
    ? inferSeedanceReferenceDetailLabelsFromPrompt(
        promptText,
        snapRefs.length,
        undefined
      )
    : [];
  const snapLabels = Array.isArray(gp?.referenceImageLabels)
    ? gp!.referenceImageLabels!.map((l) => String(l || '').trim())
    : [];

  return {
    ...panelSource,
    selectedModel: model || panelSource.selectedModel,
    referenceImages: snapRefs,
    referenceImageLabels:
      snapLabels.filter(Boolean).length >= snapRefs.length
        ? snapLabels.slice(0, snapRefs.length)
        : inferredLabels.length
          ? inferredLabels
          : snapLabels,
    prompt: promptText || panelSource.prompt,
  };
}

/** Node Details：面板顺序 + 底栏标签 + 用 urlPool 解析为运行后 COS URL */
export function buildNodeDetailsReferencePreview(input: {
  panelSource: Partial<NodeData>;
  urlPool: string[];
  filterItem?: (item: ReferenceImageDetailItem) => boolean;
  maxItems?: number;
  projectAssets?: ProjectAssetLabelRow[];
}): { referenceImages: string[]; referenceImageDetailItems: ReferenceImageDetailItem[] } {
  let detailItems = buildReferenceImageDetailItemsFromPanel(input.panelSource, {});
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

/** 创意描述中不重复的图片类 @ token 数（与 inferSeedance… 收集规则一致） */
function countUniquePromptImageRefTokens(
  prompt: string,
  projectAssets?: ProjectAssetLabelRow[]
): number {
  const seen = new Set<string>();
  let count = 0;
  for (const { token } of matchAllPromptMediaTokens(prompt, projectAssets)) {
    if (seen.has(token)) continue;
    const isImageToken =
      token === '@主图' ||
      token === '@主体' ||
      token === '@首帧图' ||
      token === '@尾帧图' ||
      token === '@图片' ||
      /^@图片\d+$/.test(token) ||
      token.startsWith('@资产:');
    if (!isImageToken) continue;
    seen.add(token);
    count += 1;
  }
  return count;
}

/** 面板已填槽数多于创意描述 @ 图片数时，Details 应走 gp 快照（仅 @ 到的素材） */
function omniPanelFilledCountExceedsPromptImageRefs(
  filledSlotCount: number,
  prompt: string,
  projectAssets?: ProjectAssetLabelRow[]
): boolean {
  const promptCount = countUniquePromptImageRefTokens(prompt, projectAssets);
  return promptCount > 0 && filledSlotCount > promptCount;
}

/** 旧快照缺 referenceImageLabels 时，按创意描述 @ 顺序推断与 API 参考图一致的底栏名 */
export function inferSeedanceReferenceDetailLabelsFromPrompt(
  prompt: string,
  refCount: number,
  projectAssets?: ProjectAssetLabelRow[]
): string[] {
  if (!String(prompt || '').trim() || refCount <= 0) return [];
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const { token } of matchAllPromptMediaTokens(prompt, projectAssets)) {
    if (seen.has(token)) continue;
    const isImageToken =
      token === '@主图' ||
      token === '@主体' ||
      token === '@首帧图' ||
      token === '@尾帧图' ||
      token === '@图片' ||
      /^@图片\d+$/.test(token) ||
      token.startsWith('@资产:');
    if (!isImageToken) continue;
    seen.add(token);
    if (token === '@主图' || token === '@主体') labels.push('主图');
    else if (token === '@首帧图') labels.push('首帧图');
    else if (token === '@尾帧图') labels.push('尾帧图');
    else if (token === '@图片') labels.push('图片1');
    else if (/^@图片\d+$/.test(token)) labels.push(token.slice(1));
    else if (token.startsWith('@资产:')) {
      const key = token.slice('@资产:'.length).trim();
      const row = projectAssets?.find((a) => a.slug === key || a.name.trim() === key);
      labels.push(row?.name?.trim() || key || `图片${labels.length + 1}`);
    }
    if (labels.length >= refCount) break;
  }
  while (labels.length < refCount) labels.push(`图片${labels.length + 1}`);
  return labels.slice(0, refCount);
}

/** image2 / Nano Banana OUTPUT：按 API 上传顺序 + prompt/@ 标签展示，勿用上游面板槽重排（@资产 与 @图片n 顺序易错配） */
export function buildImageGenOutputReferenceDetailsFromSnapshot(input: {
  snapshotRefs: string[];
  snapshotLabels?: string[];
  projectAssets?: ProjectAssetLabelRow[];
  prompt?: string;
  outputImagePreview?: string;
  isRunSnapshotRef?: (url: string) => boolean;
  isSameAsOutput?: (refUrl: string, outputUrl: string) => boolean;
  urlAllowed?: (url: string) => boolean;
}): { referenceImages: string[]; referenceImageDetailItems: ReferenceImageDetailItem[] } {
  const refs = input.snapshotRefs
    .map((u) => String(u || '').trim())
    .filter((u) => u && (input.urlAllowed?.(u) ?? true));
  const fromSnap = buildSeedanceReferenceDetailsFromSnapshot({
    snapshotRefs: refs,
    snapshotLabels: input.snapshotLabels,
    projectAssets: input.projectAssets,
    prompt: input.prompt,
  });
  const out = String(input.outputImagePreview || '').trim();
  if (!out || (!input.isRunSnapshotRef && !input.isSameAsOutput)) return fromSnap;
  const items = fromSnap.referenceImageDetailItems.filter((it) => {
    if (input.isRunSnapshotRef?.(it.url)) return true;
    if (input.isSameAsOutput?.(it.url, out)) return false;
    return true;
  });
  return {
    referenceImages: items.map((i) => i.url),
    referenceImageDetailItems: items,
  };
}

/**
 * Nano / image2 Node Details：优先 gp 快照；gp 空时从创意描述 @ 引用 + 面板槽解析（勿回退全量面板）。
 * §5.9.1 #2：Details 仅展示 @ 到的素材。
 */
export function buildStillImageGenNodeDetailsReferencePreview(input: {
  panelSource: Partial<NodeData>;
  snapRefs: string[];
  snapLabels?: string[];
  prompt?: string;
  projectAssets?: ProjectAssetLabelRow[];
  isOutputLike?: boolean;
  outputImagePreview?: string;
  isRunSnapshotRef?: (url: string) => boolean;
  isSameAsOutput?: (refUrl: string, outputUrl: string) => boolean;
  urlAllowed?: (url: string) => boolean;
}): { referenceImages: string[]; referenceImageDetailItems: ReferenceImageDetailItem[] } | null {
  const snapRefs = input.snapRefs.map((u) => String(u || '').trim()).filter(Boolean);
  const snapOpts = {
    snapshotLabels: input.snapLabels,
    projectAssets: input.projectAssets,
    prompt: input.prompt,
    ...(input.isOutputLike
      ? {
          outputImagePreview: input.outputImagePreview,
          isRunSnapshotRef: input.isRunSnapshotRef,
          isSameAsOutput: input.isSameAsOutput,
        }
      : {}),
    ...(input.urlAllowed ? { urlAllowed: input.urlAllowed } : {}),
  };
  if (snapRefs.length > 0) {
    return buildImageGenOutputReferenceDetailsFromSnapshot({
      snapshotRefs: snapRefs,
      ...snapOpts,
    });
  }
  const recovered = pickStillImageRecoveryApiReferenceImages(
    input.panelSource,
    input.projectAssets
  );
  if (!recovered?.referenceImages?.length) return null;
  return buildImageGenOutputReferenceDetailsFromSnapshot({
    snapshotRefs: recovered.referenceImages,
    snapshotLabels: recovered.referenceImageLabels,
    ...snapOpts,
  });
}

/** Seedance 参考生 OUTPUT/MOV：Node Details 只展示 generationParams 里本次 API 实际上传的 referenceImages */
export function buildSeedanceReferenceDetailsFromSnapshot(input: {
  snapshotRefs: string[];
  snapshotLabels?: string[];
  projectAssets?: ProjectAssetLabelRow[];
  prompt?: string;
}): { referenceImages: string[]; referenceImageDetailItems: ReferenceImageDetailItem[] } {
  const rawRefs = input.snapshotRefs;
  const rawLabels = input.snapshotLabels || [];
  // 快照 referenceImages 常为紧凑数组，但 referenceImageLabels 仍保留面板槽位（含空槽）。
  // 先按原始非空 URL 的索引对齐标签，避免标签与 URL 错位。
  const compacted: { url: string; label: string }[] = [];
  for (let i = 0; i < rawRefs.length; i++) {
    const u = String(rawRefs[i] || '').trim();
    if (!u) continue;
    compacted.push({ url: u, label: String(rawLabels[i] || '').trim() });
  }
  const promptText = String(input.prompt || '').trim();
  const pa = input.projectAssets;
  const promptImageTokenCount = promptText
    ? countUniquePromptImageRefTokens(promptText, pa)
    : 0;
  // §5.9.1 #2：Details 仅展示创意描述 @ 到的素材。
  // 面板中拖入了未被 prompt @ 引用的图片时，快照会包含多余 URL，需按 prompt 标签过滤。
  let filtered = compacted;
  if (promptImageTokenCount > 0 && compacted.length > promptImageTokenCount) {
    // @资产: token 需要 projectAssets 才能被 matchAllPromptMediaTokens 识别；
    // 若 prompt 含 @资产: 但 projectAssets 缺失，token 计数会偏小，此时不过滤避免误删。
    const hasAssetMention = promptText.includes('@资产:');
    const canReliablyFilter = !hasAssetMention || (pa?.length ?? 0) > 0;
    if (canReliablyFilter) {
      const expectedLabels = new Set(
        inferSeedanceReferenceDetailLabelsFromPrompt(
          promptText,
          promptImageTokenCount,
          pa
        ).map((l) => l.trim())
      );
      const matched = compacted.filter((c) => expectedLabels.has(c.label.trim()));
      if (matched.length > 0) {
        filtered = matched;
      }
    }
  }
  const urls = sanitizeDetailsReferenceImageUrls(filtered.map((c) => c.url));
  const labels = filtered.map((c) => c.label);
  const inferred = promptText
    ? inferSeedanceReferenceDetailLabelsFromPrompt(
        promptText,
        urls.length,
        pa
      )
    : [];
  /** @资产 与 @图片n 混排时 API 顺序≠面板槽；快照若误存面板标签会错配。
   *  标签集与 inferred 一致时：按 prompt 顺序重排 URL 与标签，避免「标签与图片错位」；
   *  标签集不一致时（gp 标签为 stale 面板数据）：沿用旧行为，用 inferred 标签直接覆盖。 */
  const preferPromptLabels =
    promptImageTokenCount > 0 &&
    promptImageTokenCount >= urls.length &&
    inferred.length === urls.length;
  // preferPromptLabels 时，按 prompt 推断顺序重排 URL 与标签
  let finalUrls = urls;
  let finalLabels = labels;
  let useInferredLabels = preferPromptLabels;
  if (preferPromptLabels) {
    const compactedLabelSet = new Set(labels.map((l) => l.trim()));
    const inferredLabelSet = new Set(inferred.map((l) => l.trim()));
    const labelSetsMatch =
      compactedLabelSet.size === inferredLabelSet.size &&
      [...compactedLabelSet].every((l) => inferredLabelSet.has(l));
    if (labelSetsMatch) {
      // 标签集一致但顺序不同：重排 URL 与标签，避免错位
      const labelToUrl = new Map<string, string>();
      for (let i = 0; i < labels.length; i++) {
        labelToUrl.set(labels[i].trim(), urls[i]);
      }
      const reorderedUrls: string[] = [];
      const reorderedLabels: string[] = [];
      for (const infLabel of inferred) {
        const trimmed = infLabel.trim();
        const url = labelToUrl.get(trimmed);
        if (url) {
          reorderedUrls.push(url);
          reorderedLabels.push(trimmed);
        }
      }
      // 兜底：保留未被 inferred 命中的原始项
      for (let i = 0; i < labels.length; i++) {
        const trimmed = labels[i].trim();
        if (!reorderedLabels.includes(trimmed)) {
          reorderedUrls.push(urls[i]);
          reorderedLabels.push(trimmed);
        }
      }
      if (reorderedUrls.length === urls.length) {
        finalUrls = reorderedUrls;
        finalLabels = reorderedLabels;
      }
      useInferredLabels = false; // 已重排，无需 inferred 覆盖
    }
    // labelSetsMatch 为 false：gp 标签为 stale 面板数据，沿用旧行为用 inferred 标签
  }
  return {
    referenceImages: finalUrls,
    referenceImageDetailItems: finalUrls.map((url, i) => {
      const label = preferPromptLabels
        ? (useInferredLabels
            ? inferred[i]?.trim() || labels[i]?.trim() || `图片${i + 1}`
            : finalLabels[i]?.trim() || inferred[i]?.trim() || `图片${i + 1}`)
        : labels[i]?.trim() || inferred[i]?.trim() || `图片${i + 1}`;
      const displayUrl = url;
      return { label, url: displayUrl, slotIndex: i };
    }),
  };
}

/** 视频 URL 规范化（Node Details 去重/与生成结果比对） */
export function normalizeVideoUrlForDetailsDedupe(url: string): string {
  const s = String(url || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s, 'http://local');
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return s.split('?')[0].replace(/\/+$/, '');
  }
}

/** 同一视频资源（COS/代理/path 变体） */
export function isSameVideoAssetForDetails(a: string, b: string): boolean {
  const na = normalizeVideoUrlForDetailsDedupe(a);
  const nb = normalizeVideoUrlForDetailsDedupe(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const base = (u: string) => u.split('/').pop() || u;
  const ba = base(na);
  const bb = base(nb);
  return ba.length > 8 && ba === bb;
}

/** 输出节点生成结果视频不得出现在 Reference Videos */
export function scrubGeneratedVideoFromReferenceMovs(
  items: Array<{ url: string; posterDataUrl?: string }>,
  outputVideoUrl?: string,
  isSame: (a: string, b: string) => boolean = isSameVideoAssetForDetails
): Array<{ url: string; posterDataUrl?: string }> {
  const out = String(outputVideoUrl || '').trim();
  if (!out) return items.filter((m) => Boolean(m?.url));
  return items.filter((m) => m?.url && !isSame(m.url, out));
}

/**
 * Seedance 2.0 参考生 OUTPUT/MOV：Reference Videos 仅以 generationParams.referenceMovs 为准。
 * 禁止从上游链路/ancestor 回填（纯图参考生误显示生成/链路视频）。
 */
export function seedanceReferenceMovsForOutputDetails(
  generationParamsMovs: Array<{ url: string; posterDataUrl?: string }> | undefined,
  outputVideoUrl?: string
): Array<{ url: string; posterDataUrl?: string }> {
  const snap = Array.isArray(generationParamsMovs) ? generationParamsMovs : [];
  return scrubGeneratedVideoFromReferenceMovs(snap, outputVideoUrl);
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
    generationParams.image2Quality = image2ResolveQuality(snap.image2Quality, snap.image2ImageSize);
    generationParams.image2QualityLevel = image2NormalizeQualityLevel(snap.image2QualityLevel);
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
    const modeSnap = (
      (runCapture.seedanceGenerationMode as 'text' | 'image' | 'reference' | undefined) ||
      snap.seedanceGenerationMode ||
      'text'
    ) as 'text' | 'image' | 'reference';
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
    generationParams.seedanceGenerationMode =
      (runCapture.seedanceGenerationMode as 'text' | 'image' | 'reference' | undefined) ||
      snap.seedanceGenerationMode ||
      'text';
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
    if (modeSnap === 'reference') {
      if (runCapture.referenceImages?.length) {
        generationParams.referenceImages = [...runCapture.referenceImages];
      }
      if (runCapture.referenceImageLabels?.length) {
        generationParams.referenceImageLabels = [...runCapture.referenceImageLabels];
      }
    }
  } else if (isImage2Model(modelName)) {
    generationParams.image2AspectRatio = snap.image2AspectRatio || '1:1';
    generationParams.image2ImageSize = snap.image2ImageSize || '1024x1024';
    generationParams.image2Style = snap.image2Style === 'natural' ? 'natural' : 'vivid';
    generationParams.image2Quality = image2ResolveQuality(snap.image2Quality, snap.image2ImageSize);
    generationParams.image2QualityLevel = image2NormalizeQualityLevel(snap.image2QualityLevel);
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
/** 指令/视频 tab：面板槽空时从 gp 快照恢复；@主图 时勿把主图 URL 塞进参考格 */
function restoreOmniInstructionVideoPanelFromSnapshot(input: {
  panel: Partial<NodeData>;
  refKey: 'klingOmniInstructionReferenceImages' | 'klingOmniVideoReferenceImages';
  snapRefs: string[];
  prompt: string;
}): Partial<NodeData> {
  const sourceRefs = resolveOmniPanelReferenceImagesForDetailsRestore(input.panel, input.snapRefs);
  const { prompt, refKey } = input;
  let panel = input.panel;
  const mentionsMain = /@主图|@主体/.test(prompt);
  const mainPreview = String(panel.imagePreview || '').trim();

  if (mentionsMain) {
    const mainFromSnap =
      sourceRefs.find((u) => u && !isLikelyMainVideoUrl(u)) ?? sourceRefs[0];
    const mainStill =
      mainPreview && !isLikelyMainVideoUrl(mainPreview) ? mainPreview : mainFromSnap;
    if (mainStill) {
      panel = { ...panel, imagePreview: mainStill };
    }
    const refSlots = sourceRefs.filter(
      (u) => !mainStill || !isDuplicateOfMainImagePreview(u, mainStill)
    );
    return { ...panel, [refKey]: refSlots };
  }

  return { ...panel, [refKey]: [...sourceRefs] };
}

/** MOV/OUTPUT：imagePreview 为生成视频时，@主图 须回退 gp 快照首帧图 */
function coerceOmniInstructionVideoMainPreviewForDetails(
  panel: Partial<NodeData>,
  snapRefs: string[],
  prompt: string
): Partial<NodeData> {
  if (!/@主图|@主体/.test(prompt) || snapRefs.length === 0) return panel;
  const mainPreview = String(panel.imagePreview || '').trim();
  if (mainPreview && !isLikelyMainVideoUrl(mainPreview)) return panel;
  const mainFromSnap =
    snapRefs.find((u) => u && !isLikelyMainVideoUrl(u)) ?? snapRefs[0];
  if (!mainFromSnap || isLikelyMainVideoUrl(mainFromSnap)) return panel;
  return { ...panel, imagePreview: mainFromSnap };
}

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
  /** MOV/OUTPUT 创意描述常在 gp，面板 tab 字段可能为空 */
  prompt?: string;
}): { referenceImages: string[]; referenceImageDetailItems: ReferenceImageDetailItem[] } {
  const refKey =
    input.omniTab === 'instruction'
      ? 'klingOmniInstructionReferenceImages'
      : 'klingOmniVideoReferenceImages';
  let panel: Partial<NodeData> = { ...input.panelSource, klingOmniTab: input.omniTab };
  const snapRefs = sanitizeDetailsReferenceImageUrls(
    input.snapshotRefs.filter((u) => u && !input.movUrlSet.has(u))
  );
  // 过滤掉 blob:/data: 等临时 URL，避免刷新后 slotRefs 计数膨胀导致 omniPanelFilledCountExceedsPromptImageRefs 误判
  let slotRefs = ((panel[refKey as keyof NodeData] as string[] | undefined) || [])
    .filter(Boolean)
    .filter((u) => !/^(blob|data):/i.test(u));
  const promptEarly = String(input.prompt ?? omniInstructionVideoTabPromptForDetails(panel)).trim();

  panel = coerceOmniInstructionVideoMainPreviewForDetails(panel, snapRefs, promptEarly);

  if (slotRefs.length === 0 && snapRefs.length > 0) {
    panel = restoreOmniInstructionVideoPanelFromSnapshot({
      panel,
      refKey,
      snapRefs,
      prompt: promptEarly,
    });
    slotRefs = ((panel[refKey as keyof NodeData] as string[] | undefined) || []).filter(Boolean);
  }

  const prompt = omniInstructionVideoTabPromptForDetails(panel);
  const assetLabels = inferOmniAssetPromptReferenceDetailLabels(prompt, input.projectAssets, {
    imageName: panel.imageName,
  });
  const urlPool = input.urlPool.filter((u) => !input.movUrlSet.has(u));
  const filterItem = (it: ReferenceImageDetailItem) =>
    Boolean(it.url) && !input.movUrlSet.has(it.url);

  const panelPreview = buildNodeDetailsReferencePreview({
    panelSource: panel,
    urlPool,
    projectAssets: input.projectAssets,
    filterItem,
  });
  if (
    panelPreview.referenceImages.length > 0 &&
    !omniPanelFilledCountExceedsPromptImageRefs(slotRefs.length, prompt, input.projectAssets)
  ) {
    return applyOmniAssetLabelsToDetailsReferencePreview(panelPreview, assetLabels);
  }

  if (!snapRefs.length) return panelPreview;

  let snapItems =
    buildOmniMultiPromptTokenReferenceItems(snapRefs, prompt, input.projectAssets) ??
    (() => {
      const labels = panel.referenceImageLabels || [];
      return snapRefs.map((url, i) => ({
        url,
        label:
          assetLabels[i]?.trim() ||
          String(labels[i] || '').trim() ||
          panelReferenceSlotLabel(i, snapRefs, panel.imagePreview, 'panelSlot'),
      }));
    })();
  snapItems = resolveReferenceImageDetailItemsWithUrlPool(snapItems, urlPool, {
    projectAssets: input.projectAssets,
  }).filter(filterItem);

  return applyOmniAssetLabelsToDetailsReferencePreview(
    {
      referenceImages: snapItems.map((i) => i.url),
      referenceImageDetailItems: snapItems,
    },
    assetLabels
  );
}

function applyOmniAssetLabelsToDetailsReferencePreview(
  preview: { referenceImages: string[]; referenceImageDetailItems: ReferenceImageDetailItem[] },
  assetLabels: string[]
): { referenceImages: string[]; referenceImageDetailItems: ReferenceImageDetailItem[] } {
  if (!assetLabels.length) return preview;
  return {
    referenceImages: preview.referenceImages,
    referenceImageDetailItems: preview.referenceImageDetailItems.map((it, i) => ({
      ...it,
      label: assetLabels[i]?.trim() || assetLabels[0] || it.label,
    })),
  };
}

function omniInstructionVideoTabPromptForDetails(panel: Partial<NodeData>): string {
  const tab = panel.klingOmniTab;
  if (tab === 'instruction') {
    return String(panel.klingOmniInstructionPrompt ?? panel.prompt ?? '').trim();
  }
  if (tab === 'video') {
    return String(panel.klingOmniVideoPrompt ?? panel.prompt ?? '').trim();
  }
  return String(panel.prompt ?? '').trim();
}

/** 创意描述仅 @资产（无 @图片n）时，Details 参考图标签用资产名而非「图片1」 */
export function inferOmniAssetPromptReferenceDetailLabels(
  prompt: string,
  projectAssets?: ProjectAssetLabelRow[],
  options?: { imageName?: string }
): string[] {
  const p = String(prompt || '').trim();
  if (!p || /@图片/.test(p)) return [];
  let keys = matchAllPromptMediaTokens(p, projectAssets)
    .filter((m) => m.token.startsWith('@资产:'))
    .map((m) => m.token.slice('@资产:'.length).trim())
    .filter(Boolean);
  const imageName = String(options?.imageName || '').trim();
  if (!keys.length && imageName && p.includes(`@资产:${imageName}`)) {
    keys = [imageName];
  }
  if (!keys.length) return [];
  return keys.map((key) => {
    const row = projectAssets?.find((a) => a.slug === key || a.name.trim() === key);
    return row?.name?.trim() || key;
  });
}

function isPromptImageRefToken(token: string): boolean {
  return (
    token === '@主图' ||
    token === '@主体' ||
    token === '@首帧图' ||
    token === '@尾帧图' ||
    token === '@图片' ||
    /^@图片\d+$/.test(token) ||
    token.startsWith('@资产:')
  );
}

function omniMultiPromptImageTokenSlotIndex(token: string): number | null {
  if (token === '@主图' || token === '@主体' || token === '@图片' || token === '@图片1') return 0;
  const m = /^@图片(\d+)$/.exec(token);
  if (m) return Math.max(0, parseInt(m[1], 10) - 1);
  if (token === '@首帧图') return 0;
  if (token === '@尾帧图') return 1;
  return null;
}

function omniMultiPromptMaxImageSlotIndex(
  prompt: string,
  projectAssets?: ProjectAssetLabelRow[]
): number {
  let max = -1;
  let assetSeq = 0;
  const seen = new Set<string>();
  for (const { token } of matchAllPromptMediaTokens(prompt, projectAssets)) {
    if (seen.has(token)) continue;
    if (!isPromptImageRefToken(token)) continue;
    seen.add(token);
    let slotIndex: number;
    if (token.startsWith('@资产:')) {
      slotIndex = assetSeq;
      assetSeq += 1;
    } else {
      const idx = omniMultiPromptImageTokenSlotIndex(token);
      if (idx == null) continue;
      slotIndex = idx;
    }
    max = Math.max(max, slotIndex);
  }
  return max;
}

/** 从面板主图 + klingOmniMultiReferenceImages 构建与创意描述 @ 槽位对齐的快照 URL 列表 */
export function buildOmniMultiPanelSnapshotRefsForPrompt(
  panel: Partial<NodeData>,
  prompt: string
): string[] {
  const main = String(panel.imagePreview || '').trim();
  let slots = (panel.klingOmniMultiReferenceImages || []).filter(Boolean);
  const mentionsMain = /@主图|@主体/.test(prompt);
  const mentionsImg1 = /@图片1|@图片(?!\d)/.test(prompt);

  if (!slots.length) {
    const top = (panel.referenceImages || []).filter(Boolean);
    if (top.length) {
      if ((mentionsMain || mentionsImg1) && main && !isLikelyMainVideoUrl(main)) {
        slots = top.filter((u) => !isDuplicateOfMainImagePreview(u, main));
      } else if (top.length > 1) {
        slots = top.slice(1);
      } else {
        slots = [...top];
      }
    }
  }

  const refs: string[] = [];
  if (mentionsMain && main && !isLikelyMainVideoUrl(main)) {
    refs.push(main);
  } else if (
    mentionsImg1 &&
    main &&
    !isLikelyMainVideoUrl(main) &&
    omniMultiImagePreviewCountsAsPromptImageRef(panel, main, prompt)
  ) {
    refs.push(main);
  }
  for (const u of slots) {
    if (main && isDuplicateOfMainImagePreview(u, main)) continue;
    refs.push(u);
  }
  return sanitizeDetailsReferenceImageUrls(refs);
}

/** 顶层 referenceImages 与 gp 快照不一致时（刷新后 omni 槽可能被清空），Details 优先面板 URL */
export function panelTopReferenceImagesConflictWithSnap(
  panel: Partial<NodeData>,
  snapRefs: string[]
): boolean {
  const top = (panel.referenceImages || []).map((u) => String(u || '').trim()).filter(Boolean);
  if (!top.length || !snapRefs.length) return false;
  const snapKeys = new Set(snapRefs.map(normalizeDetailImageUrlKey).filter(Boolean));
  return top.some((u) => !snapKeys.has(normalizeDetailImageUrlKey(u)));
}

function resolveOmniPanelReferenceImagesForDetailsRestore(
  panel: Partial<NodeData>,
  snapRefs: string[]
): string[] {
  const top = (panel.referenceImages || []).map((u) => String(u || '').trim()).filter(Boolean);
  if (top.length && panelTopReferenceImagesConflictWithSnap(panel, snapRefs)) {
    return sanitizeDetailsReferenceImageUrls(top);
  }
  return snapRefs;
}

function restoreOmniMultiPanelFromSnapshot(input: {
  panel: Partial<NodeData>;
  sourceRefs: string[];
  prompt: string;
  snapshotLabels?: string[];
  preferPanelLabels?: boolean;
}): Partial<NodeData> {
  const { sourceRefs, prompt, snapshotLabels, preferPanelLabels } = input;
  let panel = input.panel;
  const mentionsMain = /@主图|@主体/.test(prompt);
  const mentionsImg1 = /@图片1|@图片(?!\d)/.test(prompt);

  if (mentionsMain || mentionsImg1) {
    const mainPreview = String(panel.imagePreview || '').trim();
    const mainFromSource =
      sourceRefs.find((u) => u && !isLikelyMainVideoUrl(u)) ?? sourceRefs[0];
    const gpMain = String(
      (panel.generationParams as GenerationParams | undefined)?.firstFrameImageUrl ||
        (panel.generationParams as GenerationParams | undefined)?.firstFrameImage ||
        ''
    ).trim();
    const mainPreviewMatchesSource =
      (mainPreview &&
        sourceRefs.some((u) => isDuplicateOfMainImagePreview(u, mainPreview))) ||
      (gpMain && mainPreview && isDuplicateOfMainImagePreview(mainPreview, gpMain));
    let mainStill = mainFromSource;
    if (mainPreviewMatchesSource && mainPreview && !isLikelyMainVideoUrl(mainPreview)) {
      mainStill = mainPreview;
    } else if (
      !mentionsMain &&
      mainPreview &&
      !isLikelyMainVideoUrl(mainPreview) &&
      omniMultiImagePreviewCountsAsPromptImageRef(panel, mainPreview, prompt)
    ) {
      mainStill = mainPreview;
    }
    if (mainStill) {
      panel = { ...panel, imagePreview: mainStill };
    }
    const rest = sourceRefs.filter(
      (u) => !mainStill || !isDuplicateOfMainImagePreview(u, mainStill)
    );
    if (rest.length) {
      panel = { ...panel, klingOmniMultiReferenceImages: rest };
    }
    const panelLabels = (input.panel.referenceImageLabels || [])
      .map((l) => String(l || '').trim())
      .filter(Boolean);
    if (preferPanelLabels && panelLabels.length >= rest.length && rest.length > 0) {
      panel = { ...panel, referenceImageLabels: panelLabels.slice(0, rest.length) };
    } else if (rest.length && snapshotLabels && snapshotLabels.length > 1) {
      panel = { ...panel, referenceImageLabels: snapshotLabels.slice(1) };
    } else if (rest.length === 1 && snapshotLabels?.length === 1) {
      panel = { ...panel, referenceImageLabels: snapshotLabels };
    }
    return panel;
  }

  panel = { ...panel, klingOmniMultiReferenceImages: [...sourceRefs] };
  if (snapshotLabels?.length) {
    panel = { ...panel, referenceImageLabels: snapshotLabels };
  }
  return panel;
}

/** gp 快照与面板槽不一致（如上游 Nano 残留）时 Details 优先面板 URL */
function shouldPreferOmniMultiPanelSnapshotRefs(
  panelRefs: string[],
  snapRefs: string[],
  prompt: string,
  projectAssets?: ProjectAssetLabelRow[]
): boolean {
  if (panelRefs.length === 0) return false;
  const maxSlot = omniMultiPromptMaxImageSlotIndex(prompt, projectAssets);
  if (
    maxSlot >= 0 &&
    snapRefs.length > panelRefs.length &&
    maxSlot >= panelRefs.length
  ) {
    return false;
  }
  const snapKeys = new Set(snapRefs.map(normalizeDetailImageUrlKey).filter(Boolean));
  const panelKeys = panelRefs.map(normalizeDetailImageUrlKey).filter(Boolean);
  if (snapKeys.size > 0 && panelKeys.length > 0 && !panelKeys.some((k) => snapKeys.has(k))) {
    return true;
  }
  if (maxSlot >= 0 && panelRefs.length >= maxSlot + 1) return true;
  return false;
}

function omniMultiPromptImageTokenLabel(
  token: string,
  projectAssets?: ProjectAssetLabelRow[]
): string {
  if (token === '@主图' || token === '@主体') return '主图';
  if (token === '@首帧图') return '首帧图';
  if (token === '@尾帧图') return '尾帧图';
  if (token === '@图片') return '图片1';
  if (/^@图片\d+$/.test(token)) return token.slice(1);
  if (token.startsWith('@资产:')) {
    const key = token.slice('@资产:'.length).trim();
    const row = projectAssets?.find((a) => a.slug === key || a.name.trim() === key);
    return row?.name?.trim() || key || '图片';
  }
  return '图片';
}

/**
 * Omni 多图：按创意描述 @图片N 槽位从 gp.referenceImages 取 URL，跳过未 @ 的中间槽（如 API 3 张但只 @图片1 @图片3）。
 */
export function buildOmniMultiPromptTokenReferenceItems(
  snapRefs: string[],
  prompt: string,
  projectAssets?: ProjectAssetLabelRow[]
): ReferenceImageDetailItem[] | null {
  const promptTrim = String(prompt || '').trim();
  if (!promptTrim || snapRefs.length === 0) return null;

  const items: ReferenceImageDetailItem[] = [];
  const seenTokens = new Set<string>();
  const urlSeen = new Set<string>();
  const tokenEntries: Array<{ token: string; slotIndex: number; label: string }> = [];

  for (const { token } of matchAllPromptMediaTokens(promptTrim, projectAssets)) {
    if (seenTokens.has(token)) continue;
    if (!isPromptImageRefToken(token)) continue;
    seenTokens.add(token);

    let slotIndex: number;
    if (token.startsWith('@资产:')) {
      slotIndex = 0; // 临时值，后续根据非资产 token 数量调整
    } else {
      const idx = omniMultiPromptImageTokenSlotIndex(token);
      if (idx == null) continue;
      slotIndex = idx;
    }

    tokenEntries.push({
      token,
      slotIndex,
      label: omniMultiPromptImageTokenLabel(token, projectAssets),
    });
  }

  if (tokenEntries.length === 0) return null;

  // 调整 @资产: token 的 slotIndex，避免与 @图片N 冲突
  // @资产: 放在所有 @图片N 之后，确保各自映射到正确的 referenceImages 索引
  const nonAssetCount = tokenEntries.filter(e => !e.token.startsWith('@资产:')).length;
  let assetSeq = 0;
  for (const entry of tokenEntries) {
    if (entry.token.startsWith('@资产:')) {
      entry.slotIndex = nonAssetCount > 0 ? nonAssetCount + assetSeq : 1 + assetSeq;
      assetSeq += 1;
    }
  }

  const minSlot = tokenEntries.reduce((m, t) => Math.min(m, t.slotIndex), Infinity);
  /** Omni multi API：首帧 + @图片n 上传时 snapRefs 比 @ token 多 1，且最小槽位非 图片1（如 @图片2 @图片4） */
  const leadingFirstFrame =
    snapRefs.length === tokenEntries.length + 1 && minSlot > 0;
  const effectiveSnapRefs = leadingFirstFrame ? snapRefs.slice(1) : snapRefs;

  const maxSlot = tokenEntries.reduce((m, t) => Math.max(m, t.slotIndex), -1);
  const useSequential =
    maxSlot >= effectiveSnapRefs.length;
  let seqIdx = 0;

  for (const entry of tokenEntries) {
    const url = leadingFirstFrame
      ? effectiveSnapRefs[seqIdx++]
      : useSequential
        ? effectiveSnapRefs[seqIdx++]
        : effectiveSnapRefs[entry.slotIndex];
    if (!url) continue;
    const k = normalizeDetailImageUrlKey(url);
    if (!k || urlSeen.has(k)) continue;
    urlSeen.add(k);
    items.push({
      url,
      label: entry.label,
    });
  }

  return items.length > 0 ? items : null;
}

/** Node Details 参考项：同 URL 只保留首次出现（刷新后面板槽 + @图片1 易重复） */
export function dedupeReferenceImageDetailItemsByUrl(
  items: ReferenceImageDetailItem[]
): ReferenceImageDetailItem[] {
  const seen = new Set<string>();
  const out: ReferenceImageDetailItem[] = [];
  for (const it of items) {
    const k = normalizeDetailImageUrlKey(it.url);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

/** 可灵 Omni 多图 tab：OUTPUT 面板槽清空时从 gp.referenceImages 重建；@图片1 无 @主图 时首帧作图片1 */
export function buildOmniMultiTabDetailsReferencePreview(input: {
  panelSource: Partial<NodeData>;
  urlPool: string[];
  snapshotRefs: string[];
  snapshotLabels?: string[];
  prompt?: string;
  movUrlSet: Set<string>;
  projectAssets?: ProjectAssetLabelRow[];
  filterItem?: (item: ReferenceImageDetailItem) => boolean;
}): { referenceImages: string[]; referenceImageDetailItems: ReferenceImageDetailItem[] } {
  const snapRefs = sanitizeDetailsReferenceImageUrls(
    input.snapshotRefs.filter((u) => u && !input.movUrlSet.has(u))
  );
  const prompt = String(
    input.prompt ?? input.panelSource.klingOmniMultiPrompt ?? input.panelSource.prompt ?? ''
  ).trim();

  let panel: Partial<NodeData> = { ...input.panelSource, klingOmniTab: 'multi' as const };
  if (prompt) {
    panel = { ...panel, klingOmniMultiPrompt: prompt, prompt };
  }
  const restoreSourceRefs = resolveOmniPanelReferenceImagesForDetailsRestore(panel, snapRefs);
  const restoredFromPanelRefs = panelTopReferenceImagesConflictWithSnap(panel, snapRefs);

  if (!(panel.klingOmniMultiReferenceImages || []).filter(Boolean).length && restoreSourceRefs.length > 0) {
    panel = restoreOmniMultiPanelFromSnapshot({
      panel,
      sourceRefs: restoreSourceRefs,
      prompt,
      snapshotLabels: input.snapshotLabels,
      preferPanelLabels: restoredFromPanelRefs,
    });
  }

  // 过滤掉 blob:/data: 等临时 URL，避免刷新后计数膨胀导致 omniPanelFilledCountExceedsPromptImageRefs 误判
  const activeSlotRefs = (panel.klingOmniMultiReferenceImages || [])
    .filter(Boolean)
    .filter((u) => !/^(blob|data):/i.test(u));

  const filterItem =
    input.filterItem ?? ((it: ReferenceImageDetailItem) => Boolean(it.url) && !input.movUrlSet.has(it.url));
  const urlPool = input.urlPool.filter((u) => !input.movUrlSet.has(u));

  const panelSnapRefs = buildOmniMultiPanelSnapshotRefsForPrompt(panel, prompt);
  const maxPromptSlot = omniMultiPromptMaxImageSlotIndex(prompt, input.projectAssets);
  const needsSnapSlotIndex =
    maxPromptSlot >= 0 &&
    snapRefs.length > panelSnapRefs.length &&
    maxPromptSlot >= panelSnapRefs.length;
  const panelExceedsPromptRefs = omniPanelFilledCountExceedsPromptImageRefs(
    activeSlotRefs.length,
    prompt,
    input.projectAssets
  );
  const preferPanel =
    !needsSnapSlotIndex &&
    !panelExceedsPromptRefs &&
    (activeSlotRefs.length > 0 ||
      panelTopReferenceImagesConflictWithSnap(panel, snapRefs) ||
      shouldPreferOmniMultiPanelSnapshotRefs(
        panelSnapRefs,
        snapRefs,
        prompt,
        input.projectAssets
      ));

  if (preferPanel) {
    const panelPreview = buildNodeDetailsReferencePreview({
      panelSource: panel,
      urlPool,
      projectAssets: input.projectAssets,
      filterItem,
    });
    const dedupedPanel = dedupeReferenceImageDetailItemsByUrl(
      panelPreview.referenceImageDetailItems.filter(filterItem)
    );
    if (dedupedPanel.length > 0) {
      return {
        referenceImages: dedupedPanel.map((i) => i.url),
        referenceImageDetailItems: dedupedPanel,
      };
    }
  }

  const effectiveSnapRefs =
    preferPanel && panelSnapRefs.length > 0 ? panelSnapRefs : snapRefs;

  if (effectiveSnapRefs.length > 0) {
    let snapItems =
      buildOmniMultiPromptTokenReferenceItems(effectiveSnapRefs, prompt, input.projectAssets) ??
      (() => {
        const inferred = inferSeedanceReferenceDetailLabelsFromPrompt(
          prompt,
          effectiveSnapRefs.length,
          input.projectAssets
        );
        const labels =
          input.snapshotLabels?.length === effectiveSnapRefs.length
            ? input.snapshotLabels
            : inferred;
        return effectiveSnapRefs.map((url, i) => ({
          url,
          label: labels[i]?.trim() || inferred[i]?.trim() || `图片${i + 1}`,
          slotIndex: i,
        }));
      })();
    snapItems = resolveReferenceImageDetailItemsWithUrlPool(snapItems, urlPool, {
      projectAssets: input.projectAssets,
    });
    snapItems = dedupeReferenceImageDetailItemsByUrl(snapItems.filter(filterItem));
    if (snapItems.length > 0) {
      return {
        referenceImages: snapItems.map((i) => i.url),
        referenceImageDetailItems: snapItems,
      };
    }
  }

  const preview = buildNodeDetailsReferencePreview({
    panelSource: panel,
    urlPool,
    projectAssets: input.projectAssets,
    filterItem,
  });
  const dedupedPreview = dedupeReferenceImageDetailItemsByUrl(preview.referenceImageDetailItems);
  if (dedupedPreview.length > 0) {
    return {
      referenceImages: dedupedPreview.map((i) => i.url),
      referenceImageDetailItems: dedupedPreview,
    };
  }
  if (!effectiveSnapRefs.length) return preview;

  const inferred = inferSeedanceReferenceDetailLabelsFromPrompt(
    prompt,
    effectiveSnapRefs.length,
    input.projectAssets
  );
  const labels =
    input.snapshotLabels?.length === effectiveSnapRefs.length
      ? input.snapshotLabels
      : inferred;
  let items: ReferenceImageDetailItem[] = effectiveSnapRefs.map((url, i) => ({
    url,
    label: labels[i]?.trim() || inferred[i]?.trim() || `图片${i + 1}`,
    slotIndex: i,
  }));
  items = dedupeReferenceImageDetailItemsByUrl(items.filter(filterItem));
  return {
    referenceImages: items.map((i) => i.url),
    referenceImageDetailItems: items,
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

function nodeTaskIdForDetails(panel: Partial<NodeData>): string {
  return String(
    panel.taskId || (panel.generationParams as GenerationParams | undefined)?.taskId || ''
  ).trim();
}

/** ancestor 与当前 OUTPUT/MOV 同 task 才允许合并 Omni 面板槽（避免旧 MOV + 新 OUTPUT 时 BFS 到 INPUT 污染 Details） */
export function ancestorOmniPanelMergeAllowedForDetails(
  previewNodeData: Partial<NodeData>,
  ancestorData?: Partial<NodeData> | null
): boolean {
  if (!ancestorData) return false;
  const previewTaskId = nodeTaskIdForDetails(previewNodeData);
  const ancTaskId = nodeTaskIdForDetails(ancestorData);
  return Boolean(previewTaskId && ancTaskId && previewTaskId === ancTaskId);
}

/** 可灵 Omni OUTPUT/MOV：Node Details 面板源须读输出节点 tab 槽位，主图用 gp 首帧勿用生成结果 video */
export function buildOmniPanelSourceForNodeDetails(input: {
  previewNodeData: Partial<NodeData>;
  generationParams?: GenerationParams;
  ancestorData?: Partial<NodeData> | null;
  isOutputLike: boolean;
  omniTab: 'multi' | 'instruction' | 'video' | 'frames';
  modelStr: string;
  resolvedPrompt?: string;
}): Partial<NodeData> {
  const d = input.previewNodeData;
  const g = (input.generationParams || d.generationParams || {}) as GenerationParams;
  const tab = input.omniTab;
  const prompt = String(
    input.resolvedPrompt ??
      (tab === 'multi'
        ? d.klingOmniMultiPrompt ?? d.prompt
        : tab === 'instruction'
          ? d.klingOmniInstructionPrompt ?? d.prompt
          : tab === 'video'
            ? d.klingOmniVideoPrompt ?? d.prompt
            : d.klingOmniFramesPrompt ?? d.prompt) ??
      ''
  ).trim();

  if (!input.isOutputLike) {
    return { ...d, selectedModel: input.modelStr, klingOmniTab: tab };
  }

  const base: Partial<NodeData> = {
    ...d,
    selectedModel: input.modelStr,
    klingOmniTab: tab,
  };

  if (input.resolvedPrompt) {
    if (tab === 'multi') base.klingOmniMultiPrompt = input.resolvedPrompt;
    else if (tab === 'instruction') base.klingOmniInstructionPrompt = input.resolvedPrompt;
    else if (tab === 'video') base.klingOmniVideoPrompt = input.resolvedPrompt;
    else if (tab === 'frames') base.klingOmniFramesPrompt = input.resolvedPrompt;
  }

  const anc = input.ancestorData;
  if (anc && ancestorOmniPanelMergeAllowedForDetails(d, anc)) {
    const mergeStringArrayIfEmpty = (
      key:
        | 'klingOmniMultiReferenceImages'
        | 'klingOmniVideoReferenceImages'
        | 'klingOmniInstructionReferenceImages'
        | 'referenceImages'
        | 'referenceImageLabels'
    ) => {
      const cur = base[key] as string[] | undefined;
      const ancVal = anc[key] as string[] | undefined;
      if (!(cur || []).filter(Boolean).length && (ancVal || []).filter(Boolean).length) {
        (base as Record<string, unknown>)[key] = [...ancVal!];
      }
    };
    // §5.9.1 #2：Details 仅展示创意描述 @ 到的素材。
    // 当 gp 已有有效参考图时，不从祖先合并 tab 专属参考图字段，
    // 避免输出节点 Node Details 显示未 @ 引用的面板槽位（含 blob 临时图）。
    const gpHasRefImages =
      Array.isArray(g.referenceImages) && g.referenceImages.filter(Boolean).length > 0;
    if (!gpHasRefImages) {
      mergeStringArrayIfEmpty('klingOmniMultiReferenceImages');
      mergeStringArrayIfEmpty('klingOmniVideoReferenceImages');
      mergeStringArrayIfEmpty('klingOmniInstructionReferenceImages');
    }
    mergeStringArrayIfEmpty('referenceImages');
    mergeStringArrayIfEmpty('referenceImageLabels');
  }

  if (/@主图|@主体/.test(prompt)) {
    const ancestorSameRun = ancestorOmniPanelMergeAllowedForDetails(d, input.ancestorData);
    const mainStill =
      (g.firstFrameImageUrl as string | undefined) ||
      (g.firstFrameImage as string | undefined) ||
      (Array.isArray(g.referenceImages) ? g.referenceImages[0] : undefined) ||
      (ancestorSameRun ? input.ancestorData?.imagePreview : undefined);
    const main = String(mainStill || '').trim();
    if (main && !isLikelyMainVideoUrl(main)) {
      base.imagePreview = main;
    }
  }

  return base;
}

/** Omni 多图 tab：面板槽内视频（含 poster 绑定）→ Node Details Reference Videos */
export function collectOmniMultiTabReferenceMovsForDetails(input: {
  panelSource: Partial<NodeData>;
  outputResultUrl?: string;
  isSameAsOutput?: (refUrl: string, outputUrl: string) => boolean;
}): Array<{ url: string; posterDataUrl?: string }> {
  const imgs = input.panelSource.klingOmniMultiReferenceImages || [];
  const out: Array<{ url: string; posterDataUrl?: string }> = [];
  const outputUrl = String(input.outputResultUrl || '').trim();
  const same = input.isSameAsOutput ?? ((a, b) => a.trim() === b.trim());
  for (let i = 0; i < imgs.length; i++) {
    const u = String(imgs[i] || '').trim();
    if (!u) continue;
    const videoUrl = resolveOmniMultiReferenceSlotVideoUrl(input.panelSource, i, u);
    if (!videoUrl) continue;
    if (outputUrl && same(videoUrl, outputUrl)) continue;
    out.push({
      url: videoUrl,
      posterDataUrl: isLikelyMainVideoUrl(u) ? undefined : u,
    });
  }
  return out;
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

function pickPersistableFrameUrlForDetails(
  ...candidates: Array<string | undefined | null>
): string | undefined {
  for (const c of candidates) {
    const u = String(c || '').trim();
    if (!u) continue;
    if (/^https?:\/\//i.test(u) || u.startsWith('/flowgen-api/')) return u;
  }
  for (const c of candidates) {
    const u = String(c || '').trim();
    if (u && !/^blob:/i.test(u)) return u;
  }
  return undefined;
}

/** Seedance 图生：Node Details 首尾帧 URL（槽位优先于 referenceImages，避免上游参考图污染） */
export function resolveSeedanceImageModeFrameUrlsForDetails(input: {
  nodeData: Partial<NodeData>;
  generationParams?: GenerationParams;
  mergedPool?: string[];
}): { first?: string; last?: string; ordered: string[] } {
  const d = input.nodeData;
  const g = (input.generationParams || d.generationParams || {}) as GenerationParams;
  const tab = d.seedanceTabConfigs?.image;
  const keyOf = (u: string) => normalizeDetailImageUrlKey(u);
  const pool = (input.mergedPool || []).map((u) => String(u || '').trim()).filter(Boolean);
  const pickFromPool = (target: string | undefined): string | undefined => {
    if (!target) return undefined;
    const tk = keyOf(target);
    if (!tk) return target;
    return pool.find((u) => keyOf(u) === tk) || target;
  };

  let first = pickFromPool(
    pickPersistableFrameUrlForDetails(
      g.firstFrameImageUrl,
      g.firstFrameImage,
      d.firstFrameImageUrl,
      d.firstFrameImage,
      tab?.firstFrameImageUrl,
      tab?.firstFrameImage
    )
  );
  let last = pickFromPool(
    pickPersistableFrameUrlForDetails(
      g.lastFrameImageUrl,
      g.lastFrameImage,
      d.lastFrameImageUrl,
      d.lastFrameImage,
      tab?.lastFrameImageUrl,
      tab?.lastFrameImage
    )
  );

  if (!first && !last) {
    const gpRefs = Array.isArray(g.referenceImages) ? g.referenceImages.filter(Boolean) : [];
    if (gpRefs.length >= 1) {
      first = pickFromPool(String(gpRefs[0] || '').trim()) || String(gpRefs[0] || '').trim() || undefined;
    }
    if (gpRefs.length >= 2) {
      last = pickFromPool(String(gpRefs[1] || '').trim()) || String(gpRefs[1] || '').trim() || undefined;
    }
  }

  const ordered: string[] = [];
  if (first) ordered.push(first);
  if (last && (!first || keyOf(last) !== keyOf(first))) ordered.push(last);
  return { first, last, ordered: sanitizeDetailsReferenceImageUrls(ordered) };
}

/** Seedance 图生：Node Details 仅展示本次 API 首尾帧 */
export function mergeSeedanceImageModeDetailsReferenceImages(input: {
  nodeData: Partial<NodeData>;
  generationParams?: GenerationParams;
  mergedPool?: string[];
}): string[] {
  return resolveSeedanceImageModeFrameUrlsForDetails(input).ordered;
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

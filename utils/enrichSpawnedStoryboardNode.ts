import type { NodeData } from '../types';
import {
  buildPromptMediaRefContextForRun,
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
  type ReferencedCollectedImageRef,
} from './promptMediaRefs';
import {
  canonicalProjectAssetFileUrl,
  isProjectAssetLibraryImageUrl,
  resolveCanonicalProjectAssetPreviewUrl,
} from './projectAssetPreview';
import { flowgenAssetFileUrlFromMediaUrl, isFlowgenAssetThumbUrl } from '../services/flowgenApi';
import { isPersistableMediaUrl } from './workspaceMediaPersist';
import {
  applySeedanceReferencePlanToPanelSlots,
  buildFirstLastFramePanelPatchFromPlan,
  enrichPlanImagesWithPanelSlotIndexes,
  END_FRAME_REF_TOKENS,
  mergeReferenceImageUrlsPreservingPanelOrder,
  START_FRAME_REF_TOKENS,
} from './referencedMediaRun';
import {
  alignReferenceImageLabels,
  buildReferenceImageLabelsForPanel,
  dedupeReferenceImageSlots,
  dedupeReferenceUrlList,
  isGenericPanelRefLabel,
  resolveReferenceSlotDisplayLabel,
  upgradeReferenceImageLabelsFromAssets,
  type ProjectAssetLabelRow,
} from './referenceImageSlotLabels';
import type { ReferencedMediaPlan } from './promptMediaRefs';

function canonicalizeRefImageUrl(url: string, projectId?: string): string {
  const s = (url || '').trim();
  if (!s) return '';
  let out = isFlowgenAssetThumbUrl(s) ? flowgenAssetFileUrlFromMediaUrl(s) : s;
  if (projectId && isProjectAssetLibraryImageUrl(out)) {
    const canonical = resolveCanonicalProjectAssetPreviewUrl(out, projectId, undefined);
    if (canonical) out = canonical;
  }
  return out;
}

/** Seedance 图生 tab：首尾帧写入顶层 + seedanceTabConfigs.image，并清空参考生槽位 */
export function buildSeedanceImageModePanelPersistPatch(
  data: Partial<NodeData>,
  frames: { startUrl?: string; endUrl?: string; clearStart?: boolean; clearEnd?: boolean }
): Partial<NodeData> {
  const start = frames.clearStart ? '' : (frames.startUrl || '').trim();
  const end = frames.clearEnd ? '' : (frames.endUrl || '').trim();
  const tabs = { ...(data.seedanceTabConfigs || {}) } as NonNullable<NodeData['seedanceTabConfigs']>;
  const imageTab = {
    ...(tabs.image || {}),
    prompt: data.prompt,
    negativePrompt: data.negativePrompt,
    firstFrameLocalRef: data.firstFrameLocalRef,
    lastFrameLocalRef: data.lastFrameLocalRef,
  } as NonNullable<NodeData['seedanceTabConfigs']>['image'];
  if (frames.clearStart) {
    imageTab.firstFrameImage = undefined;
    imageTab.firstFrameImageUrl = undefined;
    imageTab.firstFrameLocalRef = undefined;
  } else if (start) {
    imageTab.firstFrameImageUrl = start;
    imageTab.firstFrameImage = start;
    imageTab.firstFrameLocalRef = undefined;
  }
  if (frames.clearEnd) {
    imageTab.lastFrameImage = undefined;
    imageTab.lastFrameImageUrl = undefined;
    imageTab.lastFrameLocalRef = undefined;
  } else if (end) {
    imageTab.lastFrameImageUrl = end;
    imageTab.lastFrameImage = end;
    imageTab.lastFrameLocalRef = undefined;
  }
  tabs.image = imageTab;
  const patch: Partial<NodeData> = {
    seedanceTabConfigs: tabs,
    referenceImages: [],
    referenceMovs: [],
    referenceAudios: [],
  };
  if (frames.clearStart) {
    patch.firstFrameImageUrl = undefined;
    patch.firstFrameImage = undefined;
    patch.firstFrameLocalRef = undefined;
  } else if (start) {
    patch.firstFrameImageUrl = start;
    patch.firstFrameImage = start;
    patch.firstFrameLocalRef = undefined;
  }
  if (frames.clearEnd) {
    patch.lastFrameImageUrl = undefined;
    patch.lastFrameImage = undefined;
    patch.lastFrameLocalRef = undefined;
  } else if (end) {
    patch.lastFrameImageUrl = end;
    patch.lastFrameImage = end;
    patch.lastFrameLocalRef = undefined;
  }
  return patch;
}

/** Seedance 图生：合并首尾帧面板 prune 与 tab 快照 */
export function buildSeedanceImageModePanelPersistPatchFromPlan(
  data: Partial<NodeData>,
  planImages: ReferencedCollectedImageRef[],
  uploaded: { startUrl?: string; endUrl?: string }
): Partial<NodeData> {
  const framePatch = buildFirstLastFramePanelPatchFromPlan(planImages, uploaded);
  const shouldPrune = planImages.length > 0;
  const refsStart =
    !shouldPrune ||
    planImages.some((e) => START_FRAME_REF_TOKENS.has(e.token));
  const refsEnd =
    !shouldPrune ||
    planImages.some((e) => END_FRAME_REF_TOKENS.has(e.token));
  return {
    ...framePatch,
    ...buildSeedanceImageModePanelPersistPatch(data, {
      startUrl:
        typeof framePatch.firstFrameImageUrl === 'string'
          ? framePatch.firstFrameImageUrl
          : typeof framePatch.firstFrameImage === 'string'
            ? framePatch.firstFrameImage
            : undefined,
      endUrl:
        typeof framePatch.lastFrameImageUrl === 'string'
          ? framePatch.lastFrameImageUrl
          : typeof framePatch.lastFrameImage === 'string'
            ? framePatch.lastFrameImage
            : undefined,
      clearStart: shouldPrune && !refsStart,
      clearEnd: shouldPrune && !refsEnd,
    }),
  };
}

function enrichSpawnedSeedanceImageMode(
  data: NodeData,
  projectId: string | undefined,
  projectAssetBySlug: Map<string, string>
): NodeData {
  let first = String(data.firstFrameImageUrl || data.firstFrameImage || '').trim();
  let last = String(data.lastFrameImageUrl || data.lastFrameImage || '').trim();
  const prompt = (data.prompt || '').trim();
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = prompt
    ? collectReferencedMediaFromPrompt(prompt, data, ctx, projectAssetBySlug)
    : { images: [] as ReferencedCollectedImageRef[], videos: [], audios: [] };
  if (prompt) {
    for (const entry of plan.images) {
      const url = canonicalizeRefImageUrl(entry.url, projectId);
      if (!url || !isPersistableMediaUrl(url)) continue;
      if (END_FRAME_REF_TOKENS.has(entry.token)) last = url;
      else if (START_FRAME_REF_TOKENS.has(entry.token)) first = url;
    }
  }
  const uploaded = { startUrl: first || undefined, endUrl: last || undefined };
  return {
    ...data,
    ...buildSeedanceImageModePanelPersistPatchFromPlan(data, plan.images, uploaded),
  };
}

function isSeedance20Model(model: string): boolean {
  return model === 'seedance2.0 (高质量版)' || model === 'seedance2.0 (急速版)';
}

/** 分镜克隆：取模板参考格（参考 tab 优先），URL 规范化，底栏与上游展示一致 */
export function templateReferencePanelForSpawn(
  data: NodeData,
  projectId?: string
): { referenceImages: string[]; referenceImageLabels: string[] } {
  const model = data.selectedModel || '';
  const isSeedRef =
    isSeedance20Model(model) && (data.seedanceGenerationMode || 'text') === 'reference';
  let refs: string[] = [];
  let labels: string[] = [];
  if (isSeedRef) {
    const tab = data.seedanceTabConfigs?.reference;
    if (tab?.referenceImages?.length) {
      refs = [...tab.referenceImages];
      labels = alignReferenceImageLabels(refs, tab.referenceImageLabels);
    } else {
      refs = [...(data.referenceImages || [])];
      labels = alignReferenceImageLabels(refs, data.referenceImageLabels);
    }
  } else {
    refs = [...(data.referenceImages || [])];
    labels = alignReferenceImageLabels(refs, data.referenceImageLabels);
  }
  const referenceImages = refs.map((u) => canonicalizeRefImageUrl(u, projectId) || u);
  const referenceImageLabels = upgradeReferenceImageLabelsFromAssets(
    referenceImages,
    alignReferenceImageLabels(referenceImages, labels),
    undefined
  );
  return { referenceImages, referenceImageLabels };
}

function spawnPanelLabelsPreservingTemplate(
  referenceImages: string[],
  templateLabels: string[],
  data: NodeData,
  projectAssets?: ProjectAssetLabelRow[]
): string[] {
  const resolved = referenceImages.map((_, i) =>
    resolveReferenceSlotDisplayLabel(
      i,
      referenceImages,
      templateLabels,
      data.imagePreview,
      'panelSlot',
      projectAssets,
      data.imageName
    )
  );
  return upgradeReferenceImageLabelsFromAssets(referenceImages, resolved, projectAssets);
}

/** 分镜下游：创意描述 @资产 优先写底栏名，避免模板空标签落成「图片1」 */
function spawnReferenceImageLabelsFromPrompt(
  referenceImages: string[],
  templateLabels: string[],
  data: NodeData,
  plan: ReferencedMediaPlan,
  planWithSlots: ReferencedCollectedImageRef[],
  projectAssets?: ProjectAssetLabelRow[]
): string[] {
  const mergedPlan: ReferencedMediaPlan = { ...plan, images: planWithSlots };
  const aligned = alignReferenceImageLabels(referenceImages, templateLabels);
  const built = buildReferenceImageLabelsForPanel(referenceImages, mergedPlan, projectAssets);
  let labels = referenceImages.map((_, i) => {
    const fromPlan = built[i]?.trim();
    if (fromPlan && !isGenericPanelRefLabel(fromPlan)) return fromPlan;
    const tmpl = aligned[i]?.trim();
    if (tmpl) return tmpl;
    return '';
  });
  for (const entry of planWithSlots) {
    const idx = entry.refImageSlotIndex;
    const name =
      entry.label?.trim() ||
      (entry.token.startsWith('@资产:') ? entry.token.slice('@资产:'.length).trim() : '');
    if (idx == null || idx < 0 || !name) continue;
    if (!String(referenceImages[idx] || '').trim()) continue;
    labels[idx] = name;
  }
  labels = labels.map((l, i) => {
    if (l.trim()) return l;
    const fromBuilt = built[i]?.trim();
    if (fromBuilt && !isGenericPanelRefLabel(fromBuilt)) return fromBuilt;
    return '';
  });
  return upgradeReferenceImageLabelsFromAssets(referenceImages, labels, projectAssets);
}

function syncSeedanceReferenceTabSnapshot(
  data: NodeData,
  referenceImages: string[],
  referenceImageLabels: string[]
): NodeData {
  const tabs = { ...(data.seedanceTabConfigs || {}) } as NonNullable<NodeData['seedanceTabConfigs']>;
  const refSnap = { ...(tabs.reference || {}), prompt: data.prompt, negativePrompt: data.negativePrompt };
  refSnap.referenceImages = referenceImages;
  refSnap.referenceImageLabels = referenceImageLabels;
  tabs.reference = refSnap;
  return { ...data, referenceImages, referenceImageLabels, seedanceTabConfigs: tabs };
}

function enrichSpawnedSeedanceReferenceMode(
  data: NodeData,
  projectId: string | undefined,
  projectAssetBySlug: Map<string, string>,
  projectAssets?: ProjectAssetLabelRow[]
): NodeData {
  const templatePanel = templateReferencePanelForSpawn(data, projectId);
  const templateRefs = templatePanel.referenceImages;
  const templateLabels = templatePanel.referenceImageLabels;

  const prompt = (data.prompt || '').trim();
  if (!prompt) {
    return syncSeedanceReferenceTabSnapshot(data, templateRefs, templateLabels);
  }

  const ctx = buildPromptMediaRefContextForRun(data, projectAssets);
  const plan = collectReferencedMediaFromPrompt(
    prompt,
    data,
    ctx,
    projectAssetBySlug,
    projectAssets
  );
  const planForPanel = {
    ...plan,
    images: plan.images.map((e) => ({
      ...e,
      url: canonicalizeRefImageUrl(e.url, projectId) || e.url,
    })),
  };

  const slotMatchOpts = {
    referenceImageLabels: templateLabels,
    imagePreview: data.imagePreview,
    panelMainSlotVisible: data.panelMainSlotVisible,
    ...(projectAssetBySlug.size ? { projectAssetSlugToUrl: projectAssetBySlug } : {}),
  };
  const planWithSlots = enrichPlanImagesWithPanelSlotIndexes(
    templateRefs,
    planForPanel.images,
    slotMatchOpts
  );

  let referenceImages: string[];
  if (templateRefs.length > 0) {
    referenceImages = applySeedanceReferencePlanToPanelSlots(templateRefs, planWithSlots, {
      imagePreview: data.imagePreview,
      panelMainSlotVisible: data.panelMainSlotVisible,
    });
    for (let i = 0; i < templateRefs.length; i++) {
      if (!String(referenceImages[i] || '').trim() && templateRefs[i]) {
        referenceImages[i] = templateRefs[i];
      }
    }
    while (referenceImages.length < templateRefs.length) {
      referenceImages.push(templateRefs[referenceImages.length] || '');
    }
  } else {
    referenceImages = mergeReferenceImageUrlsPreservingPanelOrder(
      [],
      planWithSlots
        .filter((e) => e.token !== '@主图' && e.token !== '@主体')
        .map((e) => e.url)
        .filter((u) => u && isPersistableMediaUrl(u))
    );
  }

  if (referenceImages.length === 0) {
    return syncSeedanceReferenceTabSnapshot(data, templateRefs, templateLabels);
  }

  const referenceImageLabels = spawnReferenceImageLabelsFromPrompt(
    referenceImages,
    templateLabels,
    data,
    planForPanel,
    planWithSlots,
    projectAssets
  );

  return syncSeedanceReferenceTabSnapshot(data, referenceImages, referenceImageLabels);
}

/** 分镜克隆：去掉槽间同素材重复（不按主图去重，保持与上游模板相同格数） */
function dedupeSpawnedStoryboardReferencePanels(data: NodeData): NodeData {
  const dedupeOpts = {
    imagePreview: data.imagePreview,
    dedupeAgainstMain: false,
  };
  let next = data;

  if (next.referenceImages?.length) {
    const r = dedupeReferenceImageSlots(
      next.referenceImages,
      next.referenceImageLabels,
      dedupeOpts
    );
    next = {
      ...next,
      referenceImages: r.referenceImages,
      referenceImageLabels: r.referenceImageLabels,
    };
  }

  const omniKeys = [
    'klingOmniMultiReferenceImages',
    'klingOmniInstructionReferenceImages',
    'klingOmniVideoReferenceImages',
  ] as const;
  for (const key of omniKeys) {
    const arr = next[key];
    if (!arr?.length) continue;
    const deduped = dedupeReferenceUrlList(arr, dedupeOpts);
    if (deduped.length !== arr.length || deduped.some((u, i) => u !== arr[i])) {
      next = { ...next, [key]: deduped };
    }
  }

  const tabs = next.seedanceTabConfigs;
  if (tabs?.reference?.referenceImages?.length) {
    const r = dedupeReferenceImageSlots(
      tabs.reference.referenceImages,
      tabs.reference.referenceImageLabels,
      dedupeOpts
    );
    next = {
      ...next,
      seedanceTabConfigs: {
        ...tabs,
        reference: {
          ...tabs.reference,
          referenceImages: r.referenceImages,
          referenceImageLabels: r.referenceImageLabels,
        },
      },
    };
  }

  return next;
}

/** 分镜表克隆下游：按创意描述 @ 引用同步面板槽，避免继承模板 blob/参考 tab 脏数据导致裂图或移位 */
function enrichSpawnedCommonReferencePanel(
  data: NodeData,
  projectId: string | undefined,
  projectAssetBySlug: Map<string, string>,
  projectAssets?: ProjectAssetLabelRow[]
): NodeData {
  const panel = templateReferencePanelForSpawn(data, projectId);
  if (!panel.referenceImages.length) return data;
  const prompt = (data.prompt || '').trim();
  if (!prompt) {
    const referenceImageLabels = spawnPanelLabelsPreservingTemplate(
      panel.referenceImages,
      panel.referenceImageLabels,
      data,
      projectAssets
    );
    return { ...data, referenceImages: panel.referenceImages, referenceImageLabels };
  }
  const ctx = buildPromptMediaRefContextForRun(data, projectAssets);
  const plan = collectReferencedMediaFromPrompt(
    prompt,
    data,
    ctx,
    projectAssetBySlug,
    projectAssets
  );
  const planWithSlots = enrichPlanImagesWithPanelSlotIndexes(
    panel.referenceImages,
    plan.images.map((e) => ({
      ...e,
      url: canonicalizeRefImageUrl(e.url, projectId) || e.url,
    })),
    {
      referenceImageLabels: panel.referenceImageLabels,
      imagePreview: data.imagePreview,
      panelMainSlotVisible: data.panelMainSlotVisible,
      ...(projectAssetBySlug.size ? { projectAssetSlugToUrl: projectAssetBySlug } : {}),
    }
  );
  const referenceImageLabels = spawnReferenceImageLabelsFromPrompt(
    panel.referenceImages,
    panel.referenceImageLabels,
    data,
    plan,
    planWithSlots,
    projectAssets
  );
  return { ...data, referenceImages: panel.referenceImages, referenceImageLabels };
}

export function enrichSpawnedStoryboardNodeData(
  data: NodeData,
  projectId: string | undefined,
  projectAssetBySlug: Map<string, string>,
  projectAssets?: ProjectAssetLabelRow[]
): NodeData {
  const model = data.selectedModel || '';
  const mode = data.seedanceGenerationMode || 'text';
  let out = data;
  if (isSeedance20Model(model)) {
    if (mode === 'image') {
      out = enrichSpawnedSeedanceImageMode(out, projectId, projectAssetBySlug);
    } else if (mode === 'reference') {
      out = enrichSpawnedSeedanceReferenceMode(
        out,
        projectId,
        projectAssetBySlug,
        projectAssets
      );
    } else {
      out = enrichSpawnedCommonReferencePanel(
        out,
        projectId,
        projectAssetBySlug,
        projectAssets
      );
    }
  } else {
    out = enrichSpawnedCommonReferencePanel(
      out,
      projectId,
      projectAssetBySlug,
      projectAssets
    );
  }
  return dedupeSpawnedStoryboardReferencePanels(out);
}

/** 属性面板参考图网格：仅展示可加载的 URL */
export function filterDisplayableReferenceImageUrls(urls: string[] | undefined): string[] {
  if (!Array.isArray(urls)) return [];
  return urls
    .map((u) => (u || '').trim())
    .filter((u) => u && isPersistableMediaUrl(u) && !u.startsWith('flowgen-local:'));
}

import type { NodeData } from '../types';
import {
  isProjectAssetLibraryImageUrl,
  parseProjectAssetIdsFromMediaUrl,
} from './projectAssetPreview';
import type { ReferencedMediaPlan } from './promptMediaRefs';
import {
  getNodeInspectorPromptText,
  isDuplicateOfMainImagePreview,
  matchAllPromptMediaTokens,
  panelReferenceHasEmptySlots,
  panelReferenceSlotLabel,
  refImageOrdinalForSlot,
  resolvePictureTokenSlotIndex,
  type PanelRefSlotLabelMode,
} from './promptMediaRefs';

export function normalizePanelReferenceUrlKey(url: string): string {
  return url
    .trim()
    .replace(/\|UP$/i, '')
    .replace(/\/thumb(\?.*)?$/i, '/file$1')
    .split('?')[0]
    .split('#')[0]
    .replace(/\/+$/, '')
    .toLowerCase();
}

function normalizeRefMediaUrlKey(url: string): string {
  return normalizePanelReferenceUrlKey(url);
}

/** 属性面板参考槽是否已有同一素材（资产库 thumb/file 或同 assetId 视为重复） */
export function panelReferencesAlreadyContainUrl(
  refs: string[] | undefined,
  incomingUrl: string
): boolean {
  const inc = String(incomingUrl || '').trim();
  if (!inc) return true;
  const incKey = normalizeRefMediaUrlKey(inc);
  const incIds = parseProjectAssetIdsFromMediaUrl(inc);
  for (const raw of refs || []) {
    const u = String(raw || '').trim();
    if (!u) continue;
    if (normalizeRefMediaUrlKey(u) === incKey) return true;
    if (incIds) {
      const exIds = parseProjectAssetIdsFromMediaUrl(u);
      if (
        exIds &&
        exIds.projectId === incIds.projectId &&
        exIds.assetId === incIds.assetId
      ) {
        return true;
      }
    }
  }
  return false;
}

export type ProjectAssetLabelRow = { slug: string; name: string; url?: string };

/** 由资产库 URL 或 assetId 解析展示名 */
export function projectAssetDisplayNameFromUrl(
  url: string,
  assets?: ProjectAssetLabelRow[]
): string | undefined {
  const s = String(url || '').trim();
  if (!s || !assets?.length) return undefined;
  const key = normalizeRefMediaUrlKey(s);
  const ids = parseProjectAssetIdsFromMediaUrl(s);
  for (const a of assets) {
    if (a.url && normalizeRefMediaUrlKey(a.url) === key) return a.name;
    if (ids && a.url) {
      const aid = parseProjectAssetIdsFromMediaUrl(a.url);
      if (aid && aid.assetId === ids.assetId) return a.name;
    }
  }
  return undefined;
}

/** 与 referenceImages 等长；缺项补空串 */
export function alignReferenceImageLabels(
  refs: string[] | undefined,
  labels: string[] | undefined
): string[] {
  const n = (refs || []).length;
  const L = labels || [];
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(String(L[i] || '').trim());
  return out;
}

/** 追加参考图时写入槽下标：优先填补空槽，避免 localRef 键与数组下标错位 */
export function firstEmptyPanelReferenceSlotIndex(refs: string[] | undefined): number {
  const arr = refs || [];
  for (let i = 0; i < arr.length; i++) {
    if (!String(arr[i] || '').trim()) return i;
  }
  return arr.length;
}

export function appendReferenceImageWithLabel(
  refs: string[],
  labels: string[] | undefined,
  url: string,
  displayName?: string
): { referenceImages: string[]; referenceImageLabels: string[] } {
  const nextRefs = [...refs, url];
  const aligned = alignReferenceImageLabels(refs, labels);
  aligned.push(String(displayName || '').trim());
  return { referenceImages: nextRefs, referenceImageLabels: aligned };
}

/** 参考槽去重：已存在则不再追加 */
/** 参考槽是否已含同一资产（URL / assetId / 展示名） */
export function panelReferencesAlreadyContainAsset(
  refs: string[] | undefined,
  labels: string[] | undefined,
  incomingUrl: string,
  incomingLabel?: string,
  projectAssets?: ProjectAssetLabelRow[]
): boolean {
  if (panelReferencesAlreadyContainUrl(refs, incomingUrl)) return true;
  const incKey = panelRefDisplayDedupeKey(incomingUrl, incomingLabel, projectAssets);
  if (!incKey) return false;
  for (let i = 0; i < (refs || []).length; i++) {
    const u = String(refs![i] || '').trim();
    if (!u) continue;
    const k = panelRefDisplayDedupeKey(u, labels?.[i], projectAssets);
    if (k === incKey) return true;
  }
  return false;
}

/** Omni 面板：记录画布源节点 id，用于 Shift+框选中键重复拖入去重（勿发给 API element_id） */
export const CANVAS_OMNI_REF_ELEMENT_PREFIX = 'canvas:';

export function canvasOmniRefElementId(sourceNodeId: string): string {
  return `${CANVAS_OMNI_REF_ELEMENT_PREFIX}${String(sourceNodeId || '').trim()}`;
}

export function isCanvasOmniRefElementId(id: string | undefined): boolean {
  return String(id || '').startsWith(CANVAS_OMNI_REF_ELEMENT_PREFIX);
}

export function panelReferencesAlreadyContainCanvasSource(
  elementIds: (string | undefined)[] | undefined,
  canvasSourceNodeId: string | undefined
): boolean {
  if (!canvasSourceNodeId?.trim()) return false;
  const want = canvasOmniRefElementId(canvasSourceNodeId);
  return (elementIds || []).some((id) => id === want);
}

/** 追加/覆盖参考槽后同步 elementIds（保留旧槽 canvas: eid；新槽写入画布源） */
export function buildPanelRefElementIdsAfterWrite(
  oldUrls: string[],
  oldEids: (string | undefined)[],
  nextUrls: string[],
  writeIndex: number,
  canvasSourceNodeId?: string
): (string | undefined)[] {
  return nextUrls.map((url, i) => {
    if (i < oldUrls.length && url === oldUrls[i] && oldEids[i]) return oldEids[i];
    if (i === writeIndex && canvasSourceNodeId?.trim()) {
      return canvasOmniRefElementId(canvasSourceNodeId);
    }
    return oldEids[i];
  });
}

/** 拖入参考槽（原 URL 或压缩后 URL）：URL / assetId / 展示名 / 可选主图去重 */
export function panelReferencesAlreadyContainIncoming(
  refs: string[] | undefined,
  labels: string[] | undefined,
  incomingUrl: string,
  options?: {
    incomingLabel?: string;
    projectAssets?: ProjectAssetLabelRow[];
    imagePreview?: string;
    dedupeAgainstMain?: boolean;
    elementIds?: (string | undefined)[];
    canvasSourceNodeId?: string;
    /** 本地拖入：hydrate 已在该槽写入 blob，同槽 data 替换而非追加 */
    targetSlotIndex?: number;
    localRefs?: string[];
  }
): boolean {
  if (
    options?.canvasSourceNodeId &&
    panelReferencesAlreadyContainCanvasSource(options.elementIds, options.canvasSourceNodeId)
  ) {
    return true;
  }
  const slotIdx = options?.targetSlotIndex;
  if (
    slotIdx != null &&
    slotIdx >= 0 &&
    String(options?.localRefs?.[slotIdx] || '').trim() &&
    String(refs?.[slotIdx] || '').trim()
  ) {
    return false;
  }
  const u = String(incomingUrl || '').trim();
  if (!u) return true;
  if (
    panelReferencesAlreadyContainAsset(
      refs,
      labels,
      u,
      options?.incomingLabel,
      options?.projectAssets
    )
  ) {
    return true;
  }
  return referenceMediaAlreadyInSlots(refs || [], u, {
    imagePreview: options?.imagePreview,
    dedupeAgainstMain: options?.dedupeAgainstMain,
    slotLabels: labels,
    incomingLabel: options?.incomingLabel,
    projectAssets: options?.projectAssets,
  });
}

export function tryAppendReferenceImageWithLabel(
  refs: string[],
  labels: string[] | undefined,
  url: string,
  displayName?: string,
  projectAssets?: ProjectAssetLabelRow[]
): { referenceImages: string[]; referenceImageLabels: string[]; added: boolean } {
  if (
    panelReferencesAlreadyContainAsset(refs, labels, url, displayName, projectAssets) ||
    panelReferencesAlreadyContainUrl(refs, url)
  ) {
    return {
      referenceImages: [...refs],
      referenceImageLabels: alignReferenceImageLabels(refs, labels),
      added: false,
    };
  }
  const next = appendReferenceImageWithLabel(refs, labels, url, displayName);
  return { ...next, added: true };
}

export function removeReferenceImageAt(
  refs: string[],
  labels: string[] | undefined,
  index: number
): { referenceImages: string[]; referenceImageLabels: string[] } {
  const nextRefs = [...refs];
  nextRefs.splice(index, 1);
  const aligned = alignReferenceImageLabels(refs, labels);
  aligned.splice(index, 1);
  return { referenceImages: nextRefs, referenceImageLabels: aligned };
}

export type FirstLastFrameSlot = 'first' | 'last';

/** 首尾帧槽当前展示用 URL（file 优先于 blob） */
export function resolveFirstLastFramePanelUrl(
  data: {
    firstFrameImage?: string;
    firstFrameImageUrl?: string;
    lastFrameImage?: string;
    lastFrameImageUrl?: string;
  },
  frame: FirstLastFrameSlot
): string {
  if (frame === 'first') {
    return String(data.firstFrameImageUrl || data.firstFrameImage || '').trim();
  }
  return String(data.lastFrameImageUrl || data.lastFrameImage || '').trim();
}

/**
 * 首尾帧格底栏：资产库同素材显示资产名，否则「首帧图」/「尾帧图」。
 */
export function resolveFirstLastFramePanelDisplayLabel(
  data: {
    firstFrameImage?: string;
    firstFrameImageUrl?: string;
    lastFrameImage?: string;
    lastFrameImageUrl?: string;
    firstFrameImageLabel?: string;
    lastFrameImageLabel?: string;
  },
  frame: FirstLastFrameSlot,
  projectAssets?: ProjectAssetLabelRow[]
): string | undefined {
  const url = resolveFirstLastFramePanelUrl(data, frame);
  if (!url) return undefined;
  const stored =
    frame === 'first'
      ? data.firstFrameImageLabel?.trim()
      : data.lastFrameImageLabel?.trim();
  if (stored) return stored;
  const fromUrl = projectAssetDisplayNameFromUrl(url, projectAssets);
  if (fromUrl) return fromUrl;
  return frame === 'first' ? '首帧图' : '尾帧图';
}

/**
 * 主图格底栏：与资产库同素材时显示资产名（URL/assetId 或 imageName 与库内名称一致），否则「主图」。
 */
export function resolveMainImagePanelDisplayLabel(
  imagePreview: string | undefined,
  options?: {
    imageName?: string;
    projectAssets?: ProjectAssetLabelRow[];
    video?: boolean;
  }
): string {
  if (options?.video) return '主视频';
  const prev = String(imagePreview || '').trim();
  if (!prev) return '主图';
  const fromUrl = projectAssetDisplayNameFromUrl(prev, options?.projectAssets);
  if (fromUrl) return fromUrl;
  const name = String(options?.imageName || '').trim();
  if (name && options?.projectAssets?.some((a) => a.name === name)) return name;
  if (name && isProjectAssetLibraryImageUrl(prev)) return name;
  return '主图';
}

/**
 * 属性面板参考格底栏：优先展示资产库名称，否则「图片n」/「主图」。
 */
export function resolveReferenceSlotDisplayLabel(
  slotIndex: number,
  urls: string[] | undefined,
  labels: string[] | undefined,
  imagePreview: string | undefined,
  mode: PanelRefSlotLabelMode = 'panelSlot',
  projectAssets?: ProjectAssetLabelRow[],
  imageName?: string
): string {
  const url = urls?.[slotIndex];
  const custom = labels?.[slotIndex]?.trim();
  if (mode === 'seedanceSlot' && custom && /^图片(\d+)$/.test(custom)) {
    return custom;
  }
  const fromAsset = url?.trim()
    ? projectAssetDisplayNameFromUrl(url, projectAssets)
    : undefined;
  if (fromAsset) return fromAsset;
  if (custom && !isGenericPanelRefLabel(custom) && !isStalePanelAssetDisplayLabel(custom, url, projectAssets)) {
    return custom;
  }
  const genericOrd = custom?.match(/^图片(\d+)$/);
  if (genericOrd) {
    const labelOrd = parseInt(genericOrd[1], 10);
    const compactOrd = refImageOrdinalForSlot(slotIndex, urls, imagePreview);
    const hasGaps = panelReferenceHasEmptySlots(urls);
    const nonEmpty = (urls || []).filter((u) => String(u || '').trim()).length;
    if (hasGaps && labelOrd > nonEmpty && compactOrd >= 1) {
      const gapsBefore = leadingGapCountBeforeSlot(urls || [], slotIndex);
      if (gapsBefore >= 2 && labelOrd > compactOrd) {
        return `图片${compactOrd}`;
      }
      if (resolvePictureTokenSlotIndex(labelOrd, urls || [], labels, imagePreview) === slotIndex) {
        return custom;
      }
      return `图片${compactOrd}`;
    }
    if (compactOrd >= 1 && labelOrd === compactOrd) return custom;
    if (!hasGaps && labelOrd === slotIndex + 1) return custom;
  }
  const fallback = panelReferenceSlotLabel(slotIndex, urls, imagePreview, mode);
  if (fallback === '主图') {
    return resolveMainImagePanelDisplayLabel(imagePreview, {
      imageName,
      projectAssets,
    });
  }
  return fallback;
}

function projectAssetPairKey(url: string): string | null {
  const ids = parseProjectAssetIdsFromMediaUrl(url);
  if (!ids) return null;
  return `${ids.projectId}/${ids.assetId}`;
}

export function projectAssetMediaPairKeyFromUrl(url: string): string | null {
  return projectAssetPairKey(url);
}

/** 属性面板展示去重键：优先 assetId，避免分镜 imageName（ep001_…）与 @资产:萧逍 拆成两项 */
export function panelRefDisplayDedupeKey(
  url: string,
  slotLabel: string | undefined,
  projectAssets?: ProjectAssetLabelRow[]
): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const cap = slotLabel?.trim();
  const displayUrl = resolvePanelReferenceSlotDisplayUrl(raw, cap, projectAssets);
  const pair = projectAssetPairKey(displayUrl) || projectAssetPairKey(raw);
  if (pair) return `asset:${pair}`;
  const assetRow = cap
    ? projectAssets?.find((a) => a.slug === cap || a.name.trim() === cap)
    : undefined;
  if (assetRow?.name) return `name:${assetRow.name.trim()}`;
  const inferred =
    projectAssetDisplayNameFromUrl(displayUrl, projectAssets) ||
    projectAssetDisplayNameFromUrl(raw, projectAssets);
  if (inferred) return `name:${inferred}`;
  if (cap && !isGenericPanelRefLabel(cap)) return `name:${cap}`;
  return `url:${normalizeRefMediaUrlKey(displayUrl || raw)}`;
}

/** 底栏为资产名但槽内 URL 与资产库不一致时，展示资产库缩略图 */
export function resolvePanelReferenceSlotDisplayUrl(
  url: string,
  slotLabel: string | undefined,
  projectAssets?: ProjectAssetLabelRow[]
): string {
  const u = url.trim();
  if (!u || !projectAssets?.length) return u;
  const cap = slotLabel?.trim();
  if (cap && !isGenericPanelRefLabel(cap)) {
    const row = projectAssets.find((a) => a.slug === cap || a.name.trim() === cap);
    const lib = row?.url?.trim();
    if (lib) {
      const libKey = projectAssetPairKey(lib);
      const urlKey = projectAssetPairKey(u);
      if (libKey && (!urlKey || urlKey !== libKey)) return lib;
    }
    return u;
  }
  const inferred = projectAssetDisplayNameFromUrl(u, projectAssets);
  if (inferred) {
    const row = projectAssets.find((a) => a.name.trim() === inferred || a.slug === inferred);
    const lib = row?.url?.trim();
    if (lib) {
      const libKey = projectAssetPairKey(lib);
      const urlKey = projectAssetPairKey(u);
      if (libKey && (!urlKey || urlKey !== libKey)) return lib;
    }
  }
  return u;
}

/** 虚拟补槽（slotIndex 超出 referenceImages）底栏用 URL/资产库解析名，避免落成「图片1」 */
export function resolvePanelReferenceDisplayCaption(
  slotIndex: number,
  displayUrl: string,
  referenceImages: string[] | undefined,
  referenceImageLabels: string[] | undefined,
  imagePreview: string | undefined,
  context: PanelRefSlotLabelMode,
  projectAssets?: ProjectAssetLabelRow[],
  imageName?: string
): string {
  if (slotIndex >= 0 && slotIndex < (referenceImages?.length ?? 0)) {
    return resolveReferenceSlotDisplayLabel(
      slotIndex,
      referenceImages,
      referenceImageLabels,
      imagePreview,
      context,
      projectAssets,
      imageName
    );
  }
  return (
    preferAssetDisplayNameOverGenericLabel('', displayUrl, projectAssets) ||
    projectAssetDisplayNameFromUrl(displayUrl, projectAssets) ||
    ''
  );
}

/** 合并 buildPanel + appendPrompt 后按资产去重，避免同资产名出现两张缩略图 */
export function dedupePanelReferenceDisplayEntries(
  entries: Array<{ url: string; slotIndex: number }>,
  referenceImageLabels?: string[],
  projectAssets?: ProjectAssetLabelRow[]
): Array<{ url: string; slotIndex: number }> {
  const seen = new Set<string>();
  const out: Array<{ url: string; slotIndex: number }> = [];
  for (const e of entries) {
    const cap = referenceImageLabels?.[e.slotIndex]?.trim();
    const key = panelRefDisplayDedupeKey(e.url, cap, projectAssets);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** 面板底栏泛称（无资产库展示名时 fallback） */
export function isGenericPanelRefLabel(label: string): boolean {
  return /^(图片\d+|主图|主视频|首帧图|尾帧图)$/.test(label.trim());
}

/** 槽位 URL 与 referenceImageLabels 中存的资产展示名是否已脱节（库中已删除该名称） */
export function isStalePanelAssetDisplayLabel(
  label: string | undefined,
  url: string | undefined,
  projectAssets?: ProjectAssetLabelRow[]
): boolean {
  const cap = String(label || '').trim();
  if (!cap || isGenericPanelRefLabel(cap)) return false;
  if (!projectAssets?.length) return false;
  const u = String(url || '').trim();
  const fromUrl = u ? projectAssetDisplayNameFromUrl(u, projectAssets) : undefined;
  if (fromUrl) return fromUrl !== cap;
  const row = projectAssets?.find((a) => a.slug === cap || a.name.trim() === cap);
  // 标签名仍在资产库：即使槽 URL 是误拖 blob/COS，也保留标签供 resolvePanelReferenceSlotDisplayUrl 映射库 URL
  if (row) return false;
  // 槽 URL 仍指向资产库 file/thumb，但库中已无该名称 → 删库残留
  if (u && parseProjectAssetIdsFromMediaUrl(u)) return true;
  // blob/data 且无库条目：视为删库后再拖或旧资产名（§10.44）；https/cos 等自定义展示名保留
  if (u && (u.startsWith('blob:') || u.startsWith('data:'))) return true;
  return false;
}

/** 资产库 URL 可解析时，用展示名覆盖「图片n」等泛称标签 */
export function preferAssetDisplayNameOverGenericLabel(
  label: string | undefined,
  url: string | undefined,
  projectAssets?: ProjectAssetLabelRow[]
): string {
  const cap = String(label || '').trim();
  const fromAsset = url?.trim()
    ? projectAssetDisplayNameFromUrl(url, projectAssets)
    : undefined;
  if (fromAsset && (!cap || isGenericPanelRefLabel(cap))) return fromAsset;
  if (cap && isStalePanelAssetDisplayLabel(cap, url, projectAssets)) return '';
  return cap;
}

/** 批量：槽位 URL 来自资产库时写入展示名，保留用户自定义非泛称标签 */
export function upgradeReferenceImageLabelsFromAssets(
  urls: string[],
  labels: string[] | undefined,
  projectAssets?: ProjectAssetLabelRow[]
): string[] {
  const aligned = alignReferenceImageLabels(urls, labels);
  return urls.map((raw, i) =>
    preferAssetDisplayNameOverGenericLabel(aligned[i], raw, projectAssets)
  );
}

/** 属性面板拖入参考图：画布节点用 图片n；资产库优先展示名 */
export function resolvePanelRefLabelForInspectorDrop(options: {
  url: string;
  incomingLabel?: string;
  fromCanvasNode?: boolean;
  slotIndex: number;
  referenceImages: string[];
  imagePreview?: string;
  projectAssets?: ProjectAssetLabelRow[];
}): string {
  const {
    url,
    incomingLabel,
    fromCanvasNode,
    slotIndex,
    referenceImages,
    imagePreview,
    projectAssets,
  } = options;
  if (!fromCanvasNode) {
    const fromAsset = projectAssetDisplayNameFromUrl(url, projectAssets);
    if (fromAsset) return fromAsset;
    const preferred = preferAssetDisplayNameOverGenericLabel(
      incomingLabel,
      url,
      projectAssets
    );
    if (preferred) return preferred;
  }
  const ord = refImageOrdinalForSlot(slotIndex, referenceImages, imagePreview);
  if (ord >= 1) return `图片${ord}`;
  return `图片${Math.max(1, slotIndex + 1)}`;
}

/** 参考槽是否已存在同一素材（URL 规范化 / assetId / 展示名 / 与主图重复） */
export function referenceMediaAlreadyInSlots(
  slots: string[],
  url: string,
  options?: {
    imagePreview?: string;
    dedupeAgainstMain?: boolean;
    exceptIndex?: number;
    slotLabels?: string[];
    incomingLabel?: string;
    projectAssets?: ProjectAssetLabelRow[];
  }
): boolean {
  const u = String(url || '').trim();
  if (!u) return true;
  if (options?.dedupeAgainstMain !== false && options?.imagePreview?.trim()) {
    if (isDuplicateOfMainImagePreview(u, options.imagePreview)) return true;
  }
  const incKey = panelRefDisplayDedupeKey(u, options?.incomingLabel, options?.projectAssets);
  const key = normalizePanelReferenceUrlKey(u);
  const assetKey = projectAssetPairKey(u);
  const inLabel = options?.incomingLabel?.trim();
  if (inLabel && !isGenericPanelRefLabel(inLabel)) {
    for (let i = 0; i < slots.length; i++) {
      if (options?.exceptIndex === i) continue;
      const prevLabel = options?.slotLabels?.[i]?.trim();
      if (prevLabel && prevLabel === inLabel) return true;
    }
  }
  for (let i = 0; i < slots.length; i++) {
    if (options?.exceptIndex === i) continue;
    const s = String(slots[i] || '').trim();
    if (!s) continue;
    if (incKey) {
      const prevKey = panelRefDisplayDedupeKey(s, options?.slotLabels?.[i], options?.projectAssets);
      if (prevKey && prevKey === incKey) return true;
    }
    if (normalizePanelReferenceUrlKey(s) === key) return true;
    const sk = projectAssetPairKey(s);
    if (assetKey && sk && sk === assetKey) return true;
  }
  return false;
}

/**
 * 参考图槽位去重：同 URL / 同 assetId / 与主图重复 → 清空该槽（保留下标，避免 @图片n 错位）。
 */
export function dedupeReferenceImageSlots(
  refs: string[],
  labels: string[] | undefined,
  options?: {
    imagePreview?: string;
    dedupeAgainstMain?: boolean;
    projectAssets?: ProjectAssetLabelRow[];
  }
): { referenceImages: string[]; referenceImageLabels: string[] } {
  const aligned = alignReferenceImageLabels(refs, labels);
  const outRefs: string[] = [];
  const outLabels: string[] = [];
  const seenKeys = new Set<string>();

  for (let i = 0; i < refs.length; i++) {
    const url = String(refs[i] || '').trim();
    if (!url) {
      outRefs.push('');
      outLabels.push('');
      continue;
    }
    const slotKey = panelRefDisplayDedupeKey(url, aligned[i], options?.projectAssets);
    if (slotKey && seenKeys.has(slotKey)) {
      outRefs.push('');
      outLabels.push('');
      continue;
    }
    if (
      referenceMediaAlreadyInSlots(outRefs, url, {
        imagePreview: options?.imagePreview,
        dedupeAgainstMain: options?.dedupeAgainstMain,
        slotLabels: outLabels,
        incomingLabel: aligned[i],
        projectAssets: options?.projectAssets,
      })
    ) {
      outRefs.push('');
      outLabels.push('');
      continue;
    }
    if (slotKey) seenKeys.add(slotKey);
    outRefs.push(url);
    outLabels.push(aligned[i] || '');
  }

  while (outRefs.length > 0 && !String(outRefs[outRefs.length - 1] || '').trim()) {
    outRefs.pop();
    outLabels.pop();
  }

  return { referenceImages: outRefs, referenceImageLabels: outLabels };
}

/**
 * 属性面板网格展示用：跳过空槽、与主图重复、与其它槽同素材（thumb/file/assetId）。
 */
export function buildPanelReferenceDisplayEntries(
  refs: string[] | undefined,
  options?: {
    imagePreview?: string;
    dedupeAgainstMain?: boolean;
    referenceImageLabels?: string[];
    projectAssets?: ProjectAssetLabelRow[];
  }
): Array<{ url: string; slotIndex: number }> {
  const labels = options?.referenceImageLabels;
  const seen: string[] = [];
  const seenLabels: string[] = [];
  const seenKeys = new Set<string>();
  const entries: Array<{ url: string; slotIndex: number }> = [];
  for (let slotIndex = 0; slotIndex < (refs || []).length; slotIndex++) {
    const raw = String(refs![slotIndex] || '').trim();
    if (!raw) continue;
    const cap = labels?.[slotIndex]?.trim();
    const url = resolvePanelReferenceSlotDisplayUrl(raw, cap, options?.projectAssets);
    const displayName =
      cap && !isGenericPanelRefLabel(cap)
        ? cap
        : projectAssetDisplayNameFromUrl(url, options?.projectAssets);
    const dedupeKey = panelRefDisplayDedupeKey(raw, cap, options?.projectAssets);
    if (dedupeKey && seenKeys.has(dedupeKey)) continue;
    if (
      referenceMediaAlreadyInSlots(seen, url, {
        imagePreview: options?.imagePreview,
        dedupeAgainstMain: options?.dedupeAgainstMain,
        slotLabels: seenLabels,
        incomingLabel: displayName || cap,
      })
    ) {
      continue;
    }
    if (displayName && seenLabels.includes(displayName)) continue;
    if (cap && !isGenericPanelRefLabel(cap) && seenLabels.includes(cap)) continue;
    seen.push(url);
    if (displayName) seenLabels.push(displayName);
    else if (cap) seenLabels.push(cap);
    if (dedupeKey) seenKeys.add(dedupeKey);
    entries.push({ url, slotIndex });
  }
  return entries;
}

/** 创意描述 @资产 在参考格无槽时，从资产库补一条展示（属性面板 / Details） */
export function appendPromptReferencedAssetDisplayEntries(
  entries: Array<{ url: string; slotIndex: number }>,
  prompt: string,
  projectAssets?: ProjectAssetLabelRow[],
  referenceImageLabels?: string[]
): Array<{ url: string; slotIndex: number }> {
  if (!prompt.trim() || !projectAssets?.length) return entries;
  const seenKeys = new Set<string>();
  for (const e of entries) {
    const cap = referenceImageLabels?.[e.slotIndex]?.trim();
    const k = panelRefDisplayDedupeKey(e.url, cap, projectAssets);
    if (k) seenKeys.add(k);
  }
  const out = [...entries];
  const re = /@资产:\s*([^\s@，。；：、,.!?／/与和及]+)/g;
  for (const m of prompt.matchAll(re)) {
    const key = m[1].trim();
    const row = projectAssets.find((a) => a.slug === key || a.name.trim() === key);
    const name = row?.name?.trim() || key;
    const lib = row?.url?.trim();
    if (!lib) continue;
    const libKey = panelRefDisplayDedupeKey(lib, name, projectAssets);
    if (libKey && seenKeys.has(libKey)) continue;
    if (
      referenceMediaAlreadyInSlots(
        out.map((e) => e.url),
        lib,
        { slotLabels: out.map((e) => referenceImageLabels?.[e.slotIndex]?.trim() || '') }
      )
    ) {
      continue;
    }
    out.push({ url: lib, slotIndex: 10_000 + out.length });
    if (libKey) seenKeys.add(libKey);
  }
  return out;
}

/**
 * Omni 视频/指令 @资产-only：主图格已展示资产库素材时，参考槽 COS 上传视为与主图重复。
 */
export function isOmniAssetMainUploadRefDuplicate(
  url: string,
  data: Pick<
    NodeData,
    | 'imagePreview'
    | 'imageName'
    | 'projectAssetId'
    | 'prompt'
    | 'selectedModel'
    | 'klingOmniTab'
    | 'klingOmniVideoPrompt'
    | 'klingOmniInstructionPrompt'
    | 'klingOmniMultiPrompt'
  >,
  projectAssets?: ProjectAssetLabelRow[]
): boolean {
  const ref = String(url || '').trim();
  const main = String(data.imagePreview || '').trim();
  if (!ref || !main || data.selectedModel !== '可灵3.0 Omni') return false;

  const prompt = getNodeInspectorPromptText(data as NodeData);
  // 含 @图片n 时走 resolvePictureTokenSlotIndex / 面板槽绑定，勿按 imagePreview 误去重（§10.43 可灵3）
  if (!prompt || /@图片\d/.test(prompt)) return false;
  if (isDuplicateOfMainImagePreview(ref, main)) return true;

  const mainName = String(data.imageName || '').trim();
  const mainAssetId = String(data.projectAssetId || '').trim();
  const mainPair = projectAssetPairKey(main);

  let mainAssetInPrompt = false;
  for (const { token } of matchAllPromptMediaTokens(prompt, projectAssets)) {
    if (!token.startsWith('@资产:')) continue;
    const key = token.slice('@资产:'.length).trim();
    const row = projectAssets?.find((a) => a.slug === key || a.name.trim() === key);
    const name = row?.name?.trim() || key;
    if (mainName && (name === mainName || key === mainName)) mainAssetInPrompt = true;
    if (mainAssetId && row?.url) {
      const aid = parseProjectAssetIdsFromMediaUrl(row.url);
      if (aid?.assetId === mainAssetId) mainAssetInPrompt = true;
    }
    if (mainPair && row?.url && projectAssetPairKey(row.url) === mainPair) {
      mainAssetInPrompt = true;
    }
  }
  if (!mainAssetInPrompt && mainName && prompt.includes(`@资产:${mainName}`)) {
    mainAssetInPrompt = true;
  }
  if (!mainAssetInPrompt && mainPair) {
    for (const { token } of matchAllPromptMediaTokens(prompt, projectAssets)) {
      if (!token.startsWith('@资产:')) continue;
      const key = token.slice('@资产:'.length).trim();
      const row = projectAssets?.find((a) => a.slug === key || a.name.trim() === key);
      if (row?.url && projectAssetPairKey(row.url) === mainPair) mainAssetInPrompt = true;
    }
  }

  return mainAssetInPrompt;
}

/** 参考槽 URL 是否与主图格重复（含 Omni @资产-only COS 上传） */
export function isPanelRefDuplicateOfMainImageSlot(
  url: string,
  data: Pick<
    NodeData,
    | 'imagePreview'
    | 'panelMainImageUrl'
    | 'panelMainSlotVisible'
    | 'imageName'
    | 'projectAssetId'
    | 'prompt'
    | 'selectedModel'
    | 'klingOmniTab'
    | 'klingOmniVideoPrompt'
    | 'klingOmniInstructionPrompt'
    | 'klingOmniMultiPrompt'
  >,
  projectAssets?: ProjectAssetLabelRow[]
): boolean {
  const backup = String(data.panelMainImageUrl || '').trim();
  if (backup && isDuplicateOfMainImagePreview(url, backup)) return true;
  // 运行后隐藏主图格（panelMainSlotVisible=false）或已有 panelMainImageUrl 备份时，imagePreview 是首个@参考图（§10.38），
  // 不按 imagePreview 去重，否则会把与 imagePreview 同 URL 的@参考槽误隐藏（Seedance/可灵 multi slot 丢图）
  const skipImagePreviewDup =
    data.panelMainSlotVisible === false ||
    (Boolean(backup) && data.panelMainSlotVisible !== true);
  if (!skipImagePreviewDup && isDuplicateOfMainImagePreview(url, data.imagePreview)) return true;
  return isOmniAssetMainUploadRefDuplicate(url, data, projectAssets);
}

/** 主图格已展示时，从参考格展示列表去掉与 imagePreview 同资产的项 */
export function filterPanelReferenceDisplayEntriesExcludingMainPreview(
  entries: Array<{ url: string; slotIndex: number }>,
  imagePreview: string | undefined,
  imageName: string | undefined,
  referenceImageLabels: string[] | undefined,
  projectAssets?: ProjectAssetLabelRow[],
  nodeData?: Partial<NodeData>
): Array<{ url: string; slotIndex: number }> {
  const main = String(imagePreview || '').trim();
  if (!main) return entries;
  const mainKey = panelRefDisplayDedupeKey(main, imageName, projectAssets);
  /** 运行后隐藏主图格时 imagePreview 是首个@参考图（§10.38），不按 imagePreview key 去重 */
  const skipImagePreviewKeyDedup = nodeData?.panelMainSlotVisible === false;
  return entries.filter((e) => {
    if (
      nodeData &&
      isPanelRefDuplicateOfMainImageSlot(e.url, nodeData as NodeData, projectAssets)
    ) {
      return false;
    }
    if (!mainKey || skipImagePreviewKeyDedup) return true;
    const cap = referenceImageLabels?.[e.slotIndex]?.trim();
    const k = panelRefDisplayDedupeKey(e.url, cap, projectAssets);
    return k !== mainKey;
  });
}

function pictureOrdsInPrompt(prompt: string | undefined): Set<number> {
  const s = new Set<number>();
  if (!prompt) return s;
  for (const m of prompt.matchAll(/@图片(\d+)/g)) {
    s.add(parseInt(m[1], 10));
  }
  return s;
}

function leadingGapCountBeforeSlot(imgs: string[], slotIndex: number): number {
  let gaps = 0;
  for (let i = 0; i < slotIndex; i++) {
    if (!String(imgs[i] || '').trim()) gaps += 1;
  }
  return gaps;
}

/** 参考槽「图片n」：创意描述仍 @图片n 则保留；否则修正跳号孤儿标签 */
export function syncGenericReferenceImageLabelsToSlotOrdinals(
  refs: string[],
  labels: string[] | undefined,
  imagePreview?: string,
  prompt?: string
): string[] {
  const aligned = alignReferenceImageLabels(refs, labels);
  const promptOrds = pictureOrdsInPrompt(prompt);
  const nonEmpty = refs.filter((u) => String(u || '').trim()).length;
  return refs.map((url, i) => {
    const cap = aligned[i]?.trim();
    if (!String(url || '').trim()) return '';
    if (cap && !isGenericPanelRefLabel(cap)) return cap;
    const compact = refImageOrdinalForSlot(i, refs, imagePreview);
    const pic = cap?.match(/^图片(\d+)$/);
    if (pic) {
      const labelOrd = parseInt(pic[1], 10);
      if (labelOrd > nonEmpty && compact >= 1) {
        const gaps = panelReferenceHasEmptySlots(refs);
        if (nonEmpty === 1 && compact === 1 && labelOrd > nonEmpty) {
          const gapsBefore = leadingGapCountBeforeSlot(refs, i);
          if (gapsBefore < 2) return `图片${compact}`;
        }
        if (promptOrds.has(labelOrd) && labelOrd === i + 1) return cap;
        if (gaps && labelOrd === i + 1 && nonEmpty > 1) return cap;
        return `图片${compact}`;
      }
      if (
        promptOrds.has(labelOrd) &&
        resolvePictureTokenSlotIndex(labelOrd, refs, aligned, imagePreview) === i
      ) {
        return cap;
      }
      if (compact >= 1 && labelOrd === compact) return cap;
      if (labelOrd === i + 1 && labelOrd <= nonEmpty) return cap;
      if (compact >= 1 && labelOrd > nonEmpty) return `图片${compact}`;
      if (labelOrd >= 1) return cap;
    }
    return compact >= 1 ? `图片${compact}` : '';
  });
}

/** 若参考槽有重复则写回节点（返回 patch；无变化则 undefined） */
export function referenceImagesDedupePatchIfNeeded(
  data: Pick<
    NodeData,
    | 'referenceImages'
    | 'referenceImageLabels'
    | 'imagePreview'
    | 'panelMainSlotVisible'
    | 'selectedModel'
    | 'prompt'
    | 'klingOmniTab'
    | 'klingOmniMultiPrompt'
    | 'klingOmniInstructionPrompt'
    | 'klingOmniVideoPrompt'
    | 'seedanceGenerationMode'
    | 'seedanceTabConfigs'
  >,
  options?: { dedupeAgainstMain?: boolean; projectAssets?: ProjectAssetLabelRow[]; prompt?: string }
): Partial<Pick<NodeData, 'referenceImages' | 'referenceImageLabels'>> | undefined {
  const refs = data.referenceImages || [];
  if (!refs.length) return undefined;
  const dedupeAgainstMain =
    options?.dedupeAgainstMain ??
    (Boolean(data.imagePreview?.trim()) && data.panelMainSlotVisible !== false);
  const deduped = dedupeReferenceImageSlots(refs, data.referenceImageLabels, {
    imagePreview: data.imagePreview,
    dedupeAgainstMain,
    projectAssets: options?.projectAssets,
  });
  const syncedLabels = syncGenericReferenceImageLabelsToSlotOrdinals(
    deduped.referenceImages,
    deduped.referenceImageLabels,
    data.imagePreview,
    options?.prompt ?? getNodeInspectorPromptText(data as NodeData)
  );
  const sameRefs =
    deduped.referenceImages.length === refs.length &&
    deduped.referenceImages.every((u, i) => u === refs[i]);
  const labels = data.referenceImageLabels || [];
  const sameLabels =
    syncedLabels.length === labels.length &&
    syncedLabels.every((l, i) => l === (labels[i] || ''));
  if (sameRefs && sameLabels) return undefined;
  return {
    referenceImages: deduped.referenceImages,
    referenceImageLabels: syncedLabels,
  };
}

/** 紧凑 URL 列表去重（Omni 多图等无空槽占位数组） */
export function dedupeReferenceUrlList(
  urls: string[] | undefined,
  options?: { imagePreview?: string; dedupeAgainstMain?: boolean }
): string[] {
  const out: string[] = [];
  for (const raw of urls || []) {
    const url = String(raw || '').trim();
    if (!url) continue;
    if (referenceMediaAlreadyInSlots(out, url, options)) continue;
    out.push(url);
  }
  return out;
}

export type SyncReferenceImageLabelsOptions = {
  plan?: ReferencedMediaPlan;
  projectAssets?: ProjectAssetLabelRow[];
};

/** 分镜克隆 / 运行后 prune：按槽位保留或清空展示名（URL / assetId / plan 槽位） */
export function syncReferenceImageLabelsAfterPanelPrune(
  panelBefore: string[],
  labelsBefore: string[] | undefined,
  panelAfter: string[],
  options?: SyncReferenceImageLabelsOptions
): string[] {
  const beforeLabels = alignReferenceImageLabels(panelBefore, labelsBefore);
  const planBySlot = new Map<number, string>();
  for (const entry of options?.plan?.images || []) {
    if (entry.refImageSlotIndex == null || !entry.label?.trim()) continue;
    planBySlot.set(entry.refImageSlotIndex, entry.label.trim());
  }

  return panelAfter.map((url, i) => {
    if (!String(url || '').trim()) return '';
    const key = normalizeRefMediaUrlKey(url);
    const assetKey = projectAssetPairKey(url);
    if (
      i < beforeLabels.length &&
      beforeLabels[i] &&
      i < panelBefore.length &&
      normalizeRefMediaUrlKey(panelBefore[i] || '') === key
    ) {
      return beforeLabels[i];
    }
    /** 同槽上传后 URL 替换（COS 等），仍保留拖入时的展示名 */
    if (
      i < beforeLabels.length &&
      beforeLabels[i] &&
      i < panelBefore.length &&
      String(panelBefore[i] || '').trim() &&
      String(url || '').trim()
    ) {
      return beforeLabels[i];
    }
    if (planBySlot.has(i)) return planBySlot.get(i)!;
    for (let j = 0; j < panelBefore.length; j++) {
      const u = String(panelBefore[j] || '').trim();
      if (!u || !beforeLabels[j]) continue;
      if (normalizeRefMediaUrlKey(u) === key) return beforeLabels[j];
      const beforeAsset = projectAssetPairKey(u);
      if (assetKey && beforeAsset && beforeAsset === assetKey) return beforeLabels[j];
    }
    const inferred = projectAssetDisplayNameFromUrl(url, options?.projectAssets);
    if (inferred) return inferred;
    return '';
  });
}

/**
 * 运行上传/prune 后：保留拖入时的 referenceImageLabels，空槽再按 plan / 资产库补全。
 */
export function resolveReferenceImageLabelsAfterPanelRun(options: {
  panelBefore: string[];
  labelsBefore?: string[];
  panelAfter: string[];
  plan?: ReferencedMediaPlan;
  projectAssets?: ProjectAssetLabelRow[];
}): string[] {
  const { panelBefore, labelsBefore, panelAfter, plan, projectAssets } = options;
  let labels = syncReferenceImageLabelsAfterPanelPrune(
    panelBefore,
    labelsBefore,
    panelAfter,
    { plan, projectAssets }
  );

  if (plan?.images?.length) {
    const built = buildReferenceImageLabelsForPanel(panelAfter, plan, projectAssets);
    for (const entry of plan.images) {
      const idx = entry.refImageSlotIndex;
      const name = entry.label?.trim();
      if (idx == null || idx < 0 || !name) continue;
      if (!String(panelAfter[idx] || '').trim()) continue;
      labels[idx] = name;
    }
    labels = labels.map((l, i) => {
      if (l.trim()) return l;
      return built[i]?.trim() || '';
    });
  }

  return labels.map((l, i) => {
    const url = String(panelAfter[i] || '').trim();
    const upgraded = preferAssetDisplayNameOverGenericLabel(l, url, projectAssets);
    if (upgraded) return upgraded;
    if (!url) return '';
    return projectAssetDisplayNameFromUrl(url, projectAssets) || '';
  });
}

/** 根据创意描述 @ 与资产库列表，为 referenceImages 各槽写入展示名 */
export function buildReferenceImageLabelsForPanel(
  urls: string[],
  plan: ReferencedMediaPlan,
  projectAssets?: ProjectAssetLabelRow[]
): string[] {
  const slugToName = new Map<string, string>();
  const urlKeyToName = new Map<string, string>();
  for (const a of projectAssets || []) {
    slugToName.set(a.slug, a.name);
    if (a.url) urlKeyToName.set(normalizeRefMediaUrlKey(a.url), a.name);
  }

  const labels = urls.map(() => '');

  for (const entry of plan.images) {
    if (entry.token.startsWith('@资产:')) {
      const slug = entry.token.slice('@资产:'.length);
      const name = slugToName.get(slug) || slug;
      const entryKey = normalizeRefMediaUrlKey(entry.url);
      for (let i = 0; i < urls.length; i++) {
        const u = String(urls[i] || '').trim();
        if (!u) continue;
        if (normalizeRefMediaUrlKey(u) === entryKey) labels[i] = name;
      }
    }
  }

  for (let i = 0; i < urls.length; i++) {
    if (labels[i]) continue;
    const u = String(urls[i] || '').trim();
    if (!u) continue;
    const inferred =
      urlKeyToName.get(normalizeRefMediaUrlKey(u)) ||
      projectAssetDisplayNameFromUrl(u, projectAssets);
    if (inferred) labels[i] = inferred;
  }

  return labels;
}

export function inferReferenceImageLabelsFromUrls(
  urls: string[],
  projectAssets?: ProjectAssetLabelRow[]
): string[] {
  return urls.map((u) => projectAssetDisplayNameFromUrl(u, projectAssets) || '');
}

import type { NodeData } from '../types';
import {
  isProjectAssetLibraryImageUrl,
  parseProjectAssetIdsFromMediaUrl,
} from './projectAssetPreview';
import type { ReferencedMediaPlan } from './promptMediaRefs';
import {
  isDuplicateOfMainImagePreview,
  panelReferenceSlotLabel,
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
  const fromAsset = url?.trim()
    ? projectAssetDisplayNameFromUrl(url, projectAssets)
    : undefined;
  if (custom && !isGenericPanelRefLabel(custom)) return custom;
  if (fromAsset) return fromAsset;
  if (custom) return custom;
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

/** 主图格已展示时，从参考格展示列表去掉与 imagePreview 同资产的项 */
export function filterPanelReferenceDisplayEntriesExcludingMainPreview(
  entries: Array<{ url: string; slotIndex: number }>,
  imagePreview: string | undefined,
  imageName: string | undefined,
  referenceImageLabels: string[] | undefined,
  projectAssets?: ProjectAssetLabelRow[]
): Array<{ url: string; slotIndex: number }> {
  const main = String(imagePreview || '').trim();
  if (!main) return entries;
  const mainKey = panelRefDisplayDedupeKey(main, imageName, projectAssets);
  if (!mainKey) return entries;
  return entries.filter((e) => {
    const cap = referenceImageLabels?.[e.slotIndex]?.trim();
    const k = panelRefDisplayDedupeKey(e.url, cap, projectAssets);
    return k !== mainKey;
  });
}

/** 若参考槽有重复则写回节点（返回 patch；无变化则 undefined） */
export function referenceImagesDedupePatchIfNeeded(
  data: Pick<NodeData, 'referenceImages' | 'referenceImageLabels' | 'imagePreview' | 'panelMainSlotVisible'>,
  options?: { dedupeAgainstMain?: boolean; projectAssets?: ProjectAssetLabelRow[] }
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
  const sameRefs =
    deduped.referenceImages.length === refs.length &&
    deduped.referenceImages.every((u, i) => u === refs[i]);
  const labels = data.referenceImageLabels || [];
  const sameLabels =
    deduped.referenceImageLabels.length === labels.length &&
    deduped.referenceImageLabels.every((l, i) => l === (labels[i] || ''));
  if (sameRefs && sameLabels) return undefined;
  return {
    referenceImages: deduped.referenceImages,
    referenceImageLabels: deduped.referenceImageLabels,
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

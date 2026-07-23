import { type NodeData, isImage2Model, isNanoBanana2Model } from '../types';
import { image2MaxReferenceSlots } from './image2PanelRefs';
import {
  isProjectAssetLibraryImageUrl,
  parseProjectAssetIdsFromMediaUrl,
} from './projectAssetPreview';
import {
  alignReferenceImageLabels,
  buildPanelReferenceDisplayEntries,
  normalizePanelReferenceUrlKey,
  preferAssetDisplayNameOverGenericLabel,
  projectAssetMediaPairKeyFromUrl,
  resolveFirstLastFramePanelDisplayLabel,
  resolveFirstLastFramePanelUrl,
  resolveMainImagePanelDisplayLabel,
  resolvePanelReferenceSlotDisplayUrl,
  tryAppendReferenceImageWithLabel,
} from './referenceImageSlotLabels';
import { needsFirstFramePanelModel } from './firstFramePanel';
import {
  mergePanelWithPersistedRefsIfPromptNeeds,
  persistedReferenceImagesForRun,
} from './panelRefPersistence';

/** 创意描述中可 @ 引用的素材（与面板展示序号一致） */
export type PromptMediaRefItem = {
  label: string;
  kind: 'image' | 'video' | 'audio' | 'mainImage' | 'mainVideo' | 'projectAsset';
  /** 插入到提示词中的片段，含 @ */
  insertText: string;
  /**
   * 参考图在对应模型「参考图数组」中的 0-based 下标（与面板 @图片n 分工一致：主预览同步槽走 @主图）。
   */
  refImageIndex?: number;
  /** 首尾帧类槽位：0=首帧 1=尾帧（展开文案与 label 序号解耦） */
  refFrameIndex?: 0 | 1;
};

/** 节点主预览是否为视频 URL（用于 @主视频；blob 无扩展名时偏保守视为非视频） */
export function isLikelyMainVideoUrl(url: string | undefined): boolean {
  if (!url?.trim()) return false;
  const u = url.trim();
  if (/^data:video\//i.test(u)) return true;
  if (/\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(u)) return true;
  if (/[?&]type=video\b/i.test(u)) return true;
  return false;
}

function normalizeRefUrlForDedupe(s: string): string {
  let u = s
    .trim()
    .replace(/\|UP$/i, '')
    .replace(/\/thumb(\?.*)?$/i, '/file$1');
  try {
    if (/^https?:\/\//i.test(u)) {
      const { pathname } = new URL(u);
      if (pathname.startsWith('/flowgen-api/')) {
        u = pathname;
      }
    }
  } catch {
    /* keep original */
  }
  return u
    .split('?')[0]
    .split('#')[0]
    .replace(/\/+$/, '')
    .toLowerCase();
}

/** 参考图 URL 是否与节点主预览（非视频）为同一张图（用于去重，避免主图在参考格重复展示） */
export function isDuplicateOfMainImagePreview(
  url: string | undefined,
  imagePreview: string | undefined
): boolean {
  const prev = imagePreview?.trim();
  const u = url?.trim();
  if (!prev || !u || isLikelyMainVideoUrl(prev)) return false;
  if (u === prev) return true;
  const uPair = projectAssetMediaPairKeyFromUrl(u);
  const pPair = projectAssetMediaPairKeyFromUrl(prev);
  if (uPair && pPair && uPair === pPair) return true;
  return normalizeRefUrlForDedupe(u) === normalizeRefUrlForDedupe(prev);
}

/**
 * @ 下拉 / plan 主图去重：运行后 imagePreview 常为画布首个 @ 参考，主图格用 panelMainImageUrl。
 */
export function resolvePromptMainImagePreviewForRefs(data: Partial<NodeData>): string | undefined {
  const backup = String(data.panelMainImageUrl || '').trim();
  if (backup && !isLikelyMainVideoUrl(backup)) return backup;
  if (data.panelMainSlotVisible === false) return undefined;
  const preview = String(data.imagePreview || '').trim();
  if (preview && !isLikelyMainVideoUrl(preview)) return preview;
  return undefined;
}

/** 参考槽列表去掉与主预览/已上传主图重复的项（Omni 多图：主图仅 imagePreview，不进 klingOmniMultiReferenceImages） */
export function stripPanelRefsDuplicateOfMain(
  refs: string[] | undefined,
  imagePreview?: string,
  uploadedMainUrl?: string
): string[] {
  const out: string[] = [];
  for (const raw of refs || []) {
    const u = String(raw || '').trim();
    if (!u) continue;
    if (imagePreview && isDuplicateOfMainImagePreview(u, imagePreview)) continue;
    if (uploadedMainUrl && isDuplicateOfMainImagePreview(u, uploadedMainUrl)) continue;
    out.push(u);
  }
  return out;
}

/**
 * 纯图片参考列表：首项与节点主预览（非视频）为同一 URL 时显示「主图」，其余从「图片1」起为手动参考序号（与各模型 @ 引用一致）。
 */
export function mainAwareRefImageSlotLabel(
  slotIndex: number,
  urls: string[] | undefined,
  imagePreview: string | undefined
): string {
  const imgs = urls || [];
  if (slotIndex < 0 || slotIndex >= imgs.length) return `图片${slotIndex + 1}`;
  const prev = imagePreview?.trim();
  const isMainDupSlot = (i: number) => isDuplicateOfMainImagePreview(imgs[i], prev);
  if (isMainDupSlot(slotIndex)) return '主图';
  let ord = 0;
  for (let j = 0; j <= slotIndex; j++) {
    if (!isMainDupSlot(j)) ord += 1;
  }
  return `图片${ord}`;
}

/**
 * 面板参考格底栏：槽位下标与「图片n」对齐（prune 后空槽不重排）。
 * Nano / image2 / Omni / Seedance 参考生等共用。
 */
export type PanelRefSlotLabelMode = 'panelSlot' | 'seedanceSlot';

/** 参考面板是否存在空槽（prune 后稀疏数组） */
export function panelReferenceHasEmptySlots(urls: string[] | undefined): boolean {
  return (urls || []).some((u) => !String(u || '').trim());
}

function leadingGapCountBeforeSlot(imgs: string[], slotIndex: number): number {
  let gaps = 0;
  for (let i = 0; i < slotIndex; i++) {
    if (!String(imgs[i] || '').trim()) gaps += 1;
  }
  return gaps;
}

/** panelSlot：稀疏槽用紧凑序号；密集槽用物理 idx+1 / 自定义标签序号（含主图同 URL 参考槽） */
export function panelSlotPictureOrdinal(
  slotIndex: number,
  urls: string[] | undefined,
  imagePreview: string | undefined,
  customLabel?: string
): number {
  const imgs = urls || [];
  const customPicOrd = customLabel?.trim().match(/^图片(\d+)$/);
  const hasGaps = panelReferenceHasEmptySlots(imgs);
  if (hasGaps) {
    if (customPicOrd) {
      const labelOrd = parseInt(customPicOrd[1], 10);
      const gapsBefore = leadingGapCountBeforeSlot(imgs, slotIndex);
      const compact = refImageOrdinalForSlot(slotIndex, imgs, imagePreview);
      const nonEmpty = imgs.filter((u) => String(u || '').trim()).length;
      if (labelOrd === slotIndex + 1) {
        if (gapsBefore >= 2 && labelOrd > compact && compact >= 1 && nonEmpty > 1) return compact;
        if (nonEmpty > 1 || gapsBefore >= 2) return labelOrd;
      }
      if (labelOrd > nonEmpty) {
        if (compact >= 1) return compact;
      }
      return labelOrd;
    }
    const compact = refImageOrdinalForSlot(slotIndex, imgs, imagePreview);
    const physical = slotIndex + 1;
    const gapsBefore = leadingGapCountBeforeSlot(imgs, slotIndex);
    const nonEmpty = imgs.filter((u) => String(u || '').trim()).length;
    if (compact >= 1) {
      if (nonEmpty === 1) return compact;
      if (gapsBefore >= 2 && physical > compact) return compact;
      if (physical > compact && gapsBefore === 1) return physical;
      return compact;
    }
    return 0;
  }
  if (customPicOrd) {
    const labelOrd = parseInt(customPicOrd[1], 10);
    if (labelOrd === slotIndex + 1) return labelOrd;
  }
  return slotIndex + 1;
}

/** panelSlot：referenceImages[0]=@图片1；seedanceSlot：槽1=@图片1（槽0 常为主图重复） */
export function panelReferenceSlotLabel(
  slotIndex: number,
  urls: string[] | undefined,
  imagePreview: string | undefined,
  mode: PanelRefSlotLabelMode = 'panelSlot'
): string {
  const imgs = urls || [];
  const prev = imagePreview?.trim();
  if (slotIndex < 0 || slotIndex >= imgs.length) {
    return mode === 'seedanceSlot'
      ? `图片${Math.max(1, slotIndex)}`
      : `图片${Math.max(1, slotIndex + 1)}`;
  }
  if (mode === 'seedanceSlot') {
    if (prev && isDuplicateOfMainImagePreview(imgs[slotIndex], prev)) return '主图';
    const ord = panelReferenceHasEmptySlots(imgs)
      ? seedancePictureTokenOrd(slotIndex, urls, imagePreview)
      : refImageOrdinalForSlot(slotIndex, urls, imagePreview);
    return ord < 1 ? '主图' : `图片${ord}`;
  }
  if (panelReferenceHasEmptySlots(imgs)) {
    const ord = refImageOrdinalForSlot(slotIndex, urls, imagePreview);
    return ord < 1 ? '主图' : `图片${ord}`;
  }
  if (prev && isDuplicateOfMainImagePreview(imgs[slotIndex], prev)) return '主图';
  return `图片${slotIndex + 1}`;
}

/** @deprecated 使用 panelReferenceSlotLabel */
export const seedanceReferenceSlotLabel = panelReferenceSlotLabel;

/** Seedance 参考生：@图片n 与面板槽下标对齐（前导空槽/主图重复槽时）；否则与 panelSlot 一样用 idx+1 */
export function seedancePictureTokenOrd(
  slotIndex: number,
  urls: string[] | undefined,
  imagePreview: string | undefined
): number {
  const imgs = urls || [];
  const first = String(imgs[0] || '').trim();
  const prev = imagePreview?.trim();
  const leadIsPadding =
    !first || (!!prev && isDuplicateOfMainImagePreview(first, prev));
  if (panelReferenceHasEmptySlots(imgs)) {
    return slotIndex < 1 ? 1 : slotIndex;
  }
  if (leadIsPadding) return slotIndex < 1 ? 1 : slotIndex;
  return slotIndex + 1;
}

export function refImageOrdinalForSlot(
  slotIndex: number,
  urls: string[] | undefined,
  imagePreview: string | undefined
): number {
  const imgs = urls || [];
  const prev = imagePreview?.trim();
  const isMainDupSlot = (i: number) => isDuplicateOfMainImagePreview(imgs[i], prev);
  if (isMainDupSlot(slotIndex)) return 0;
  let ord = 0;
  for (let j = 0; j <= slotIndex; j++) {
    if (!String(imgs[j] || '').trim()) continue;
    if (!isMainDupSlot(j)) ord += 1;
  }
  return ord;
}

function pushPanelRefImageAtSlot(
  refs: PromptMediaRefItem[],
  data: NodeData,
  imgs: string[],
  idx: number,
  prev: string | undefined,
  options?: { slotLabelMode?: PanelRefSlotLabelMode; projectAssets?: ProjectAssetLabelRow[] }
): void {
  const s = String(imgs[idx] || '').trim();
  if (!s) return;
  // 仅 seedance 参考生模式按主图去重（主图单独一格，同素材不占 @图片n）；
  // image2 / Nano / Omni 等面板槽模式下，用户显式拖入同 URL 参考槽仍需 @图片n 可选
  if (prev && options?.slotLabelMode === 'seedanceSlot' && isDuplicateOfMainImagePreview(s, prev)) return;
  const customCap = data.referenceImageLabels?.[idx]?.trim();
  const customPicOrd = customCap?.match(/^图片(\d+)$/);
  let ord: number;
  if (options?.slotLabelMode === 'panelSlot') {
    ord = panelSlotPictureOrdinal(idx, imgs, prev, customCap);
  } else if (options?.slotLabelMode === 'seedanceSlot') {
    if (idx < 1 && (!s || (prev && isDuplicateOfMainImagePreview(s, prev)))) return;
    ord =
      customPicOrd && panelReferenceHasEmptySlots(imgs)
        ? panelSlotPictureOrdinal(idx, imgs, prev, customCap)
        : seedancePictureTokenOrd(idx, imgs, prev);
  } else if (customPicOrd) {
    ord = parseInt(customPicOrd[1], 10);
  } else {
    ord = refImageOrdinalForSlot(idx, imgs, prev);
  }
  if (ord < 1) return;
  const displayLabel = refSlotMentionDisplayLabel(
    data,
    idx,
    imgs,
    prev,
    options?.slotLabelMode || 'panelSlot',
    options.projectAssets
  );
  const assetSlug = resolveAssetSlugForReferenceSlot(
    idx,
    imgs,
    data.referenceImageLabels,
    options?.projectAssets
  );
  if (assetSlug) {
    refs.push({
      label: displayLabel,
      kind: 'projectAsset',
      insertText: buildProjectAssetPromptToken(assetSlug, options?.projectAssets),
      refImageIndex: idx,
    });
    return;
  }
  if (displayLabel === '主图') {
    pushMainImage(refs, displayLabel);
    return;
  }
  if (displayLabel === '主视频') {
    pushMainVideo(refs, displayLabel);
    return;
  }
  pushImage(refs, ord, { refImageIndex: idx, displayLabel });
}

export type ReferenceImageDetailItem = { url: string; label: string };

export type BuildReferenceImageDetailItemsOptions = {
  projectAssets?: ProjectAssetLabelRow[];
};

/** 创意描述 @资产 未出现在参考格时，从资产库补全 Details / 面板展示项 */
export function appendPromptReferencedAssetDetailItems(
  items: ReferenceImageDetailItem[],
  data: Partial<NodeData>,
  projectAssets?: ProjectAssetLabelRow[]
): ReferenceImageDetailItem[] {
  if (!projectAssets?.length) return items;
  const prompt = getNodeInspectorPromptText(data as NodeData).trim();
  if (!prompt) return items;
  const seen = new Set(items.map((i) => i.label.trim()).filter(Boolean));
  const out = [...items];
  for (const { token } of matchAllPromptMediaTokens(prompt, projectAssets)) {
    if (!token.startsWith('@资产:')) continue;
    const key = token.slice('@资产:'.length).trim();
    const row = projectAssets.find((a) => a.slug === key || a.name.trim() === key);
    const name = row?.name?.trim() || key;
    if (seen.has(name)) continue;
    const lib = row?.url?.trim();
    if (!lib) continue;
    out.push({ url: lib, label: name });
    seen.add(name);
  }
  return out;
}

/**
 * Omni multi：imagePreview 是否作为 @图片1/@主图 计入 Details。
 * 未 @主图 运行后 imagePreview/panelMainImageUrl 可能是备份主图，实际 @图片1 在 klingOmniMultiReferenceImages 槽内。
 */
export function omniMultiImagePreviewCountsAsPromptImageRef(
  data: Partial<NodeData>,
  main: string,
  prompt?: string
): boolean {
  const preview = String(main || data.imagePreview || '').trim();
  if (!preview || isLikelyMainVideoUrl(preview)) return false;
  if (promptMentionsMainImageForNodeData(data)) return true;

  const promptText = String(
    prompt ??
      data.klingOmniMultiPrompt ??
      data.prompt ??
      ''
  ).trim();
  if (!/@图片1|@图片(?!\d)/.test(promptText)) return false;

  const backup = String(data.panelMainImageUrl || '').trim();
  if (
    backup &&
    isDuplicateOfMainImagePreview(preview, backup) &&
    !promptMentionsMainImageForNodeData(data)
  ) {
    const slots = (data.klingOmniMultiReferenceImages || []).filter(Boolean);
    if (slots.length && !slots.some((u) => isDuplicateOfMainImagePreview(u, preview))) {
      return false;
    }
  }

  const slots = (data.klingOmniMultiReferenceImages || []).filter(Boolean);
  const gp = data.generationParams as { referenceImages?: string[]; firstFrameImage?: string; firstFrameImageUrl?: string } | undefined;
  const gpRefs = (gp?.referenceImages || []).filter(Boolean);
  const pool = [...slots, ...gpRefs];
  if (pool.some((u) => isDuplicateOfMainImagePreview(u, preview))) return true;

  const gpFirst = String(gp?.firstFrameImageUrl || gp?.firstFrameImage || '').trim();
  if (gpFirst && isDuplicateOfMainImagePreview(preview, gpFirst)) return true;

  if (pool.length > 0) return false;
  return true;
}

/** Node Details / 测试：与属性面板参考格底栏一致；仅文案 @主图 时含「主图」项 */
export function buildReferenceImageDetailItemsFromPanel(
  data: Partial<NodeData>,
  options?: BuildReferenceImageDetailItemsOptions
): ReferenceImageDetailItem[] {
  const projectAssets = options?.projectAssets;
  const model = String(data.selectedModel || '').trim();
  const items: ReferenceImageDetailItem[] = [];
  const main = String(data.imagePreview || '').trim();
  const pushMain = () => {
    if (!main || isLikelyMainVideoUrl(main)) return;
    const assetName = String(data.imageName || '').trim();
    const label =
      assetName && isProjectAssetLibraryImageUrl(main) ? assetName : '主图';
    items.push({ url: main, label });
  };

  if (['seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(model)) {
    const mode = data.seedanceGenerationMode || 'text';
    if (mode === 'reference') {
      const mentionsMain = promptMentionsMainImageForNodeData(data);
      if (mentionsMain) pushMain();
      const refs = data.referenceImages || [];
      const dedupeMain = mentionsMain ? main : '';
      const labelMain = mentionsMain ? main : '';
      for (let i = 0; i < refs.length; i++) {
        const u = String(refs[i] || '').trim();
        if (!u) continue;
        if (dedupeMain && isDuplicateOfMainImagePreview(u, dedupeMain)) continue;
        const slotLabel =
          preferAssetDisplayNameOverGenericLabel(data.referenceImageLabels?.[i], u) ||
          panelReferenceSlotLabel(i, refs, labelMain, 'seedanceSlot');
        const displayUrl = projectAssets?.length
	      ? resolvePanelReferenceSlotDisplayUrl(u, slotLabel, projectAssets)
	      : u;
	    items.push({
	      url: displayUrl,
	      label: slotLabel,
	    });
	  }
	  return appendPromptReferencedAssetDetailItems(items, data, projectAssets);
	}
	if (mode === 'image') {
      const tab = data.seedanceTabConfigs?.image;
      const first = String(
        data.firstFrameImageUrl ||
          data.firstFrameImage ||
          tab?.firstFrameImageUrl ||
          tab?.firstFrameImage ||
          ''
      ).trim();
      const last = String(
        data.lastFrameImageUrl ||
          data.lastFrameImage ||
          tab?.lastFrameImageUrl ||
          tab?.lastFrameImage ||
          ''
      ).trim();
      if (first) {
        items.push({
          url: first,
          label: data.firstFrameImageLabel?.trim() || '首帧图',
        });
      }
      if (last) {
        items.push({
          url: last,
          label: data.lastFrameImageLabel?.trim() || '尾帧图',
        });
      }
      return items;
    }
    return items;
  }

  if (model === 'Nano Banana 2.0' || model === 'image 2') {
    const mentionsMain = promptMentionsMainImageForNodeData(data);
    if (mentionsMain) pushMain();
    const refs = data.referenceImages || [];
    const labelMain = mentionsMain ? main : '';
    for (let i = 0; i < refs.length; i++) {
      const u = String(refs[i] || '').trim();
      if (!u) continue;
      // 主图独立一格；参考槽同 URL 仍保留（@图片1 与 @主图 可指向同素材）
      const slotLabel =
        preferAssetDisplayNameOverGenericLabel(data.referenceImageLabels?.[i], u) ||
        panelReferenceSlotLabel(i, refs, labelMain, 'panelSlot');
      const displayUrl = projectAssets?.length
	    ? resolvePanelReferenceSlotDisplayUrl(u, slotLabel, projectAssets)
	    : u;
	  items.push({ url: displayUrl, label: slotLabel });
	}
	return appendPromptReferencedAssetDetailItems(items, data, projectAssets);
      }

      if (model === '即梦3.0 Pro') {
    const mentionsMain = promptMentionsMainImageForNodeData(data);
    const first = String(data.firstFrameImageUrl || data.firstFrameImage || '').trim();
    if (first) {
      items.push({ url: first, label: data.firstFrameImageLabel?.trim() || '首帧图' });
    } else if (mentionsMain) pushMain();
    return items;
  }

  if (model === '可灵3.0 Omni') {
    const tab = (data.klingOmniTab || 'multi') as 'multi' | 'instruction' | 'video' | 'frames';
    if (tab === 'frames') {
      const first = String(data.firstFrameImageUrl || data.firstFrameImage || '').trim();
      const last = String(data.lastFrameImageUrl || data.lastFrameImage || '').trim();
      if (first && !isLikelyMainVideoUrl(first)) {
        items.push({ url: first, label: data.firstFrameImageLabel?.trim() || '首帧图' });
      }
      if (last && !isLikelyMainVideoUrl(last)) {
        items.push({ url: last, label: data.lastFrameImageLabel?.trim() || '尾帧图' });
      }
      return items;
    }
    const refKey =
      tab === 'instruction'
        ? 'klingOmniInstructionReferenceImages'
        : tab === 'video'
          ? 'klingOmniVideoReferenceImages'
          : 'klingOmniMultiReferenceImages';
    const imgs = (data[refKey] as string[] | undefined) || [];
    const promptText = String(
      tab === 'multi'
        ? data.klingOmniMultiPrompt ?? data.prompt
        : tab === 'instruction'
          ? data.klingOmniInstructionPrompt ?? data.prompt
          : tab === 'video'
            ? data.klingOmniVideoPrompt ?? data.prompt
            : data.prompt
    ).trim();
    const mentionsMain = promptMentionsMainImageForNodeData(data);
    const countsAsPromptImg1 = omniMultiImagePreviewCountsAsPromptImageRef(data, main, promptText);
    if (mentionsMain) pushMain();
    else if (tab === 'multi' && countsAsPromptImg1) {
      items.push({ url: main, label: '图片1' });
    }
    const dedupeMain = mentionsMain || countsAsPromptImg1 ? main : '';
    const labelMain = dedupeMain;
    for (let i = 0; i < imgs.length; i++) {
      const u = String(imgs[i] || '').trim();
      if (!u || isOmniMultiReferenceSlotVideo(data, i, u)) continue;
      if (dedupeMain && isDuplicateOfMainImagePreview(u, dedupeMain)) continue;
      const slotLabel =
        data.referenceImageLabels?.[i]?.trim() ||
        panelReferenceSlotLabel(i, imgs, labelMain, 'panelSlot');
      items.push({ url: u, label: slotLabel });
    }
    return items;
  }

  if (
    model.includes('可灵') ||
    model === 'vidu 2.0' ||
    model === 'seedance1.5-pro'
  ) {
    const first = String(data.firstFrameImageUrl || data.firstFrameImage || '').trim();
    const last = String(data.lastFrameImageUrl || data.lastFrameImage || '').trim();
    if (first && !isLikelyMainVideoUrl(first)) {
      items.push({ url: first, label: data.firstFrameImageLabel?.trim() || '首帧图' });
    }
    if (last && !isLikelyMainVideoUrl(last)) {
      items.push({ url: last, label: data.lastFrameImageLabel?.trim() || '尾帧图' });
    }
    return items;
  }

  return items;
}

function isOmniMixedRefItemVideo(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('data:image/')) return false;
  return isLikelyMainVideoUrl(url);
}

/** Omni 多图 tab：参考格是否为视频（mp4 / 底栏「视频n」/ referenceMovs poster 绑定） */
export function isOmniMultiReferenceSlotVideo(
  data: Partial<NodeData>,
  slotIndex: number,
  url?: string
): boolean {
  const u = String(url ?? data.klingOmniMultiReferenceImages?.[slotIndex] ?? '').trim();
  if (!u) return false;
  if (isOmniMixedRefItemVideo(u)) return true;
  const label = data.referenceImageLabels?.[slotIndex]?.trim();
  if (label && /^视频\d+$/.test(label)) return true;
  for (const m of data.referenceMovs || []) {
    const vu = String(m?.url || '').trim();
    if (!vu || !isLikelyMainVideoUrl(vu)) continue;
    const poster = String(m.posterDataUrl || '').trim();
    if (poster && isSameMediaUrl(poster, u)) return true;
    if (isSameMediaUrl(vu, u)) return true;
  }
  return false;
}

/** Omni 多图 tab：解析参考格绑定的视频 URL（格内为 poster 时从 referenceMovs 反查） */
export function resolveOmniMultiReferenceSlotVideoUrl(
  data: Partial<NodeData>,
  slotIndex: number,
  url?: string
): string | undefined {
  const u = String(url ?? data.klingOmniMultiReferenceImages?.[slotIndex] ?? '').trim();
  if (!u) return undefined;
  if (isLikelyMainVideoUrl(u)) return u;
  for (const m of data.referenceMovs || []) {
    const vu = String(m?.url || '').trim();
    if (!vu || !isLikelyMainVideoUrl(vu)) continue;
    if (m.posterDataUrl && isSameMediaUrl(m.posterDataUrl, u)) return vu;
  }
  return undefined;
}

/** Omni 指令/视频参考 tab：顶栏绑定的参考视频 URL */
export function resolveOmniTabBoundVideoUrl(
  data: Partial<NodeData>,
  tab: 'instruction' | 'video'
): string | undefined {
  const url =
    tab === 'instruction'
      ? data.klingOmniInstructionVideoUrl || data.klingOmniInstructionVideoPreviewUrl
      : data.klingOmniVideoUrl || data.klingOmniVideoPreviewUrl;
  const u = String(url || '').trim();
  return u && isLikelyMainVideoUrl(u) ? u : undefined;
}

/** 创意描述是否 @主视频 */
export function promptMentionsMainVideoForNodeData(data: Partial<NodeData>): boolean {
  return /@主视频/.test(getNodeInspectorPromptText(data as NodeData));
}

/**
 * Seedance 参考生：应对齐 @主视频 / 面板「主视频」角标的视频 URL。
 * MOV/OUTPUT 切参考生时 imagePreview 可能仍为 mp4，也可能仅为 poster/截帧，成片在 referenceMovs / outputUrl。
 */
export function resolveSeedanceReferenceMainVideoUrl(
  data: Partial<NodeData>
): string | undefined {
  const prev = String(data.imagePreview || '').trim();
  if (prev && isLikelyMainVideoUrl(prev)) return prev;

  const movs = data.referenceMovs || [];
  const soleMov = movs.length === 1 ? String(movs[0]?.url || '').trim() : '';
  const outputUrl = String(
    (data.generationParams as { outputUrl?: string } | undefined)?.outputUrl || ''
  ).trim();

  if (soleMov && isLikelyMainVideoUrl(soleMov)) {
    if (outputUrl && isSameMediaUrl(soleMov, outputUrl)) return soleMov;
    if (prev && isSameMediaUrl(soleMov, prev)) return soleMov;
  }

  if (outputUrl && isLikelyMainVideoUrl(outputUrl)) {
    if (soleMov && isSameMediaUrl(soleMov, outputUrl)) return soleMov;
    // 仅当 referenceMovs 中有 outputUrl 时才视为参考主视频；
    // 无 referenceMovs 时 outputUrl 仅为生成结果，非参考视频，避免误将 @主图 变为 @主视频
  }

  return undefined;
}

/** Seedance 参考生 referenceMovs 条目是否为「主视频」（与面板角标一致） */
export function isSeedanceReferenceMovMainVideo(
  data: Partial<NodeData>,
  movUrl: string | undefined
): boolean {
  const main = resolveSeedanceReferenceMainVideoUrl(data);
  const u = String(movUrl || '').trim();
  if (!main || !u) return false;
  return isSameMediaUrl(main, u);
}

/**
 * Omni 指令/视频 tab 顶栏预览：是否应显示「主视频」（非「视频1」）。
 * imagePreview 常为截帧 PNG，@主视频 实际绑定 klingOmni*VideoUrl。
 */
export function isOmniTabVideoMainVideoReference(
  data: Partial<NodeData>,
  displayUrl: string,
  tab: 'instruction' | 'video'
): boolean {
  const url = String(displayUrl || '').trim();
  if (!url) return false;
  const mainPrev = String(data.imagePreview || '').trim();
  if (mainPrev && isLikelyMainVideoUrl(mainPrev) && isSameMediaUrl(mainPrev, url)) {
    return true;
  }
  const bound = resolveOmniTabBoundVideoUrl(data, tab);
  if (!bound || !isSameMediaUrl(bound, url)) return false;
  return promptMentionsMainVideoForNodeData(data);
}

/**
 * 可灵 Omni 多图/指令/视频 tab：参考格内图文混排。视频单独编「视频n」。
 * slotIndex 须为面板 referenceImages 的 origIdx（与 @图片n 的 refImageIndex 一致），勿用过滤后的展示序号。
 */
export function omniMixedRefSlotCaption(
  slotIndex: number,
  urls: string[] | undefined,
  imagePreview: string | undefined,
  data?: Partial<NodeData>
): string {
  const all = urls || [];
  if (slotIndex < 0 || slotIndex >= all.length) {
    return `图片${Math.max(1, slotIndex + 1)}`;
  }
  const url = all[slotIndex];
  const customLabel = data?.referenceImageLabels?.[slotIndex]?.trim();
  if (customLabel && /^视频\d+$/.test(customLabel)) return customLabel;
  if (data && isOmniMultiReferenceSlotVideo(data, slotIndex, url)) {
    let v = 0;
    for (let i = 0; i <= slotIndex; i++) {
      if (isOmniMultiReferenceSlotVideo(data, i, all[i])) v++;
    }
    return `视频${v}`;
  }
  if (isOmniMixedRefItemVideo(url)) {
    let v = 0;
    for (let i = 0; i <= slotIndex; i++) {
      if (isOmniMixedRefItemVideo(all[i])) v++;
    }
    return `视频${v}`;
  }
  const prev = imagePreview?.trim();
  if (prev && isDuplicateOfMainImagePreview(url, prev)) return '主图';
  return panelReferenceSlotLabel(slotIndex, all, imagePreview, 'panelSlot');
}

function pushMainImage(refs: PromptMediaRefItem[], displayLabel?: string) {
  refs.push({
    label: displayLabel?.trim() || '主图',
    kind: 'mainImage',
    insertText: '@主图',
  });
}

function pushMainVideo(refs: PromptMediaRefItem[], displayLabel?: string) {
  refs.push({
    label: displayLabel?.trim() || '主视频',
    kind: 'mainVideo',
    insertText: '@主视频',
  });
}

type PushImageExtras = {
  refImageIndex?: number;
  refFrameIndex?: 0 | 1;
  displayLabel?: string;
};

function pushImage(refs: PromptMediaRefItem[], ordinal: number, extras?: PushImageExtras) {
  const token = `图片${ordinal}`;
  refs.push({
    label: extras?.displayLabel?.trim() || token,
    kind: 'image',
    insertText: `@${token}`,
    ...(extras?.refImageIndex !== undefined ? { refImageIndex: extras.refImageIndex } : {}),
    ...(extras?.refFrameIndex !== undefined ? { refFrameIndex: extras.refFrameIndex } : {}),
  });
}

function pushFrameImage(
  refs: PromptMediaRefItem[],
  frameIndex: 0 | 1,
  displayLabel?: string
) {
  const token = frameIndex === 0 ? '首帧图' : '尾帧图';
  refs.push({
    label: displayLabel?.trim() || token,
    kind: 'image',
    insertText: `@${token}`,
    refFrameIndex: frameIndex,
  });
}

/** 首尾帧槽 → 项目资产 slug（与参考槽规则一致） */
export function resolveAssetSlugForFrameSlot(
  frameIndex: 0 | 1,
  data: NodeData,
  projectAssets?: ProjectAssetLabelRow[]
): string | undefined {
  const url = (
    frameIndex === 0
      ? data.firstFrameImageUrl || data.firstFrameImage
      : data.lastFrameImageUrl || data.lastFrameImage
  )?.trim();
  if (!url) return undefined;
  const cap =
    frameIndex === 0
      ? data.firstFrameImageLabel?.trim()
      : data.lastFrameImageLabel?.trim();
  return resolveAssetSlugForReferenceSlot(0, [url], cap ? [cap] : undefined, projectAssets);
}

function maybePushFramePreview(
  refs: PromptMediaRefItem[],
  data: NodeData,
  frameIndex: 0 | 1,
  ctx: PromptMediaRefContext
): void {
  const url = (
    frameIndex === 0
      ? data.firstFrameImageUrl || data.firstFrameImage
      : data.lastFrameImageUrl || data.lastFrameImage
  )?.trim();
  if (!url || isLikelyMainVideoUrl(url)) return;
  const cap = frameMentionDisplayLabel(data, frameIndex, ctx.projectAssets);
  const generic = frameIndex === 0 ? '首帧图' : '尾帧图';
  const slug = resolveAssetSlugForFrameSlot(frameIndex, data, ctx.projectAssets);
  if (slug && cap !== generic) {
    refs.push({
      label: cap,
      kind: 'projectAsset',
      insertText: buildProjectAssetPromptToken(slug, ctx.projectAssets),
      refFrameIndex: frameIndex,
    });
    return;
  }
  const stored =
    frameIndex === 0
      ? data.firstFrameImageLabel?.trim()
      : data.lastFrameImageLabel?.trim();
  if (
    stored &&
    cap !== generic &&
    ctx.projectAssets?.some((a) => a.name.trim() === stored || a.slug === stored)
  ) {
    refs.push({
      label: cap,
      kind: 'projectAsset',
      insertText: buildProjectAssetPromptToken(stored, ctx.projectAssets),
      refFrameIndex: frameIndex,
    });
    return;
  }
  pushFrameImage(refs, frameIndex, cap);
}

function isLegacyFrameImageMentionItem(it: PromptMediaRefItem): boolean {
  return (
    it.kind === 'image' &&
    (it.refFrameIndex != null ||
      it.insertText === '@首帧图' ||
      it.insertText === '@尾帧图')
  );
}

function pushVideo(refs: PromptMediaRefItem[], i: number) {
  const label = `视频${i}`;
  refs.push({ label, kind: 'video', insertText: `@${label}` });
}

function pushAudio(refs: PromptMediaRefItem[], i: number) {
  const label = `音频${i}`;
  refs.push({ label, kind: 'audio', insertText: `@${label}` });
}

/** 节点默认主预览：资产库主图 → @资产:slug；否则 @主图 / @主视频 */
function maybePushMainPreview(data: NodeData, ctx: PromptMediaRefContext, refs: PromptMediaRefItem[]) {
  const p = resolvePromptMainImagePreviewForRefs(data);
  if (!p) return;
  const cap = mainMentionDisplayLabel(data, ctx.projectAssets);
  if (isLikelyMainVideoUrl(p)) {
    pushMainVideo(refs, cap);
    return;
  }
  const slug = resolveAssetSlugForReferenceSlot(
    0,
    [p],
    [String(data.imageName || '').trim(), cap].filter(Boolean),
    ctx.projectAssets
  );
  const name = String(data.imageName || '').trim();
  if (slug) {
    refs.push({
      label: cap,
      kind: 'projectAsset',
      insertText: buildProjectAssetPromptToken(slug, ctx.projectAssets),
    });
    return;
  }
  if (
    name &&
    cap !== '主图' &&
    cap !== '主视频' &&
    (isProjectAssetLibraryImageUrl(p) ||
      ctx.projectAssets?.some((a) => a.name.trim() === name || a.name.trim() === cap))
  ) {
    refs.push({
      label: cap,
      kind: 'projectAsset',
      insertText: buildProjectAssetPromptToken(name, ctx.projectAssets),
    });
    return;
  }
  pushMainImage(refs, cap);
}

function maybePushMainPreviewWithoutFrameMainImage(data: NodeData, ctx: PromptMediaRefContext, refs: PromptMediaRefItem[]) {
  const p = data.imagePreview?.trim();
  if (!p) return;
  const hasFrameSlots = !!(
    data.firstFrameImage ||
    data.firstFrameImageUrl ||
    data.lastFrameImage ||
    data.lastFrameImageUrl
  );
  // 仅在「当前模式确实是首尾帧」时由 @首帧图/@尾帧图 接管主预览，避免 Omni 从首尾帧切到其他 tab 后仍占位导致 @主图 消失、素材引用为空
  let suppressMainForFrames = false;
  if (hasFrameSlots && !isLikelyMainVideoUrl(p)) {
    if (ctx.isKelingOmni && ctx.klingOmniTab === 'frames') suppressMainForFrames = true;
    else if (ctx.isSeedance20 && ctx.seedanceMode === 'image') suppressMainForFrames = true;
    else if (ctx.isJimeng) suppressMainForFrames = true;
    else if ((ctx.isKeling || ctx.isVidu || ctx.isSeedance15) && !ctx.isKelingOmni) suppressMainForFrames = true;
  }
  if (suppressMainForFrames) return;
  maybePushMainPreview(data, ctx, refs);
}

function panelRefPushOpts(ctx: PromptMediaRefContext) {
  return { projectAssets: ctx.projectAssets };
}

function isSameMediaUrl(a?: string, b?: string): boolean {
  const ua = a?.trim();
  const ub = b?.trim();
  if (!ua || !ub) return false;
  return ua === ub;
}

/**
 * 首帧槽与主预览图是否为「同一素材」（避免主图 blob、上传后 https 双轨时误判多出 @图片1 / 角标「图片1」）。
 * 用于 Omni 首尾帧、Seedance2.0 图生、可灵2.5/vidu/1.5、即梦等首帧逻辑。
 */
export function isFirstFrameSlotSameAsMainImagePreview(
  data: NodeData,
  ctx: PromptMediaRefContext,
  prev: string | undefined
): boolean {
  const p = prev?.trim();
  if (!p || isLikelyMainVideoUrl(p)) return false;
  if (!(data.firstFrameImage || data.firstFrameImageUrl)) return false;
  const u = String(data.firstFrameImageUrl || data.firstFrameImage || '').trim();
  const firstBlob = String(data.firstFrameImage || '').trim();
  if (u && u === p) return true;
  if (!!data.firstFrameImageUrl && !!firstBlob && firstBlob === p) return true;
  if (
    firstBlob &&
    u &&
    firstBlob === u &&
    /^https?:/i.test(u) &&
    (p.startsWith('blob:') || p.startsWith('data:image'))
  ) {
    if (ctx.isSeedance20 && ctx.seedanceMode === 'image') return true;
    if (ctx.isKelingOmni && ctx.klingOmniTab === 'frames') return true;
    if (ctx.isJimeng) return true;
    if ((ctx.isKeling || ctx.isVidu || ctx.isSeedance15) && !ctx.isKelingOmni) return true;
    return false;
  }
  return false;
}

export type ProjectAssetLabelRow = { slug: string; name: string; url?: string };

export type PromptMediaRefContext = {
  isKelingOmni: boolean;
  klingOmniTab: 'multi' | 'instruction' | 'video' | 'frames';
  isJimeng: boolean;
  isNano: boolean;
  isImage2: boolean;
  isKeling: boolean;
  isVidu: boolean;
  isSeedance15: boolean;
  isSeedance20: boolean;
  seedanceMode: 'text' | 'image' | 'reference';
  /** 项目资产库：用于 @ 列表与面板底栏一致的展示名 */
  projectAssets?: ProjectAssetLabelRow[];
};

function normalizeMentionAssetUrlKey(url: string): string {
  return url
    .trim()
    .replace(/\|UP$/i, '')
    .replace(/\/thumb(\?.*)?$/i, '/file$1');
}

function lookupProjectAssetDisplayName(
  url: string | undefined,
  assets?: ProjectAssetLabelRow[]
): string | undefined {
  const s = String(url || '').trim();
  if (!s || !assets?.length) return undefined;
  const key = normalizeMentionAssetUrlKey(s);
  const ids = parseProjectAssetIdsFromMediaUrl(s);
  for (const a of assets) {
    if (a.url && normalizeMentionAssetUrlKey(a.url) === key) return a.name;
    if (ids && a.url) {
      const aid = parseProjectAssetIdsFromMediaUrl(a.url);
      if (aid && aid.assetId === ids.assetId) return a.name;
    }
  }
  return undefined;
}

function mainMentionDisplayLabel(data: NodeData, assets?: ProjectAssetLabelRow[]): string {
  const p = data.imagePreview?.trim();
  return resolveMainImagePanelDisplayLabel(p, {
    imageName: data.imageName,
    projectAssets: assets,
    video: Boolean(p && isLikelyMainVideoUrl(p)),
  });
}

function frameMentionDisplayLabel(
  data: NodeData,
  frameIndex: 0 | 1,
  assets?: ProjectAssetLabelRow[]
): string {
  const frame = frameIndex === 0 ? 'first' : 'last';
  const url = resolveFirstLastFramePanelUrl(data, frame);
  if (url) {
    return (
      resolveFirstLastFramePanelDisplayLabel(data, frame, assets) ||
      (frameIndex === 0 ? '首帧图' : '尾帧图')
    );
  }
  return frameIndex === 0 ? '首帧图' : '尾帧图';
}

/** 与属性面板首尾帧格一致：槽位无 URL 时，图生首尾帧模型首帧格回退主预览 */
export function effectiveFirstFramePanelUrl(
  data: NodeData,
  ctx: PromptMediaRefContext
): string | undefined {
  const stored = resolveFirstLastFramePanelUrl(data, 'first').trim();
  if (stored) return stored;
  const main = String(data.imagePreview || '').trim();
  if (!main || isLikelyMainVideoUrl(main)) return undefined;
  if (
    !needsFirstFramePanelModel(data, {
      seedanceMode: ctx.seedanceMode,
      klingOmniTab: ctx.klingOmniTab,
    })
  ) {
    return undefined;
  }
  return main;
}

/** 面板首尾帧格当前应对外引用的 URL（与 FrameDropZone / @ 下拉一致） */
export function resolvedFramePanelUrl(
  data: NodeData,
  ctx: PromptMediaRefContext,
  frameIndex: 0 | 1
): string | undefined {
  const frame = frameIndex === 0 ? 'first' : 'last';
  const stored = resolveFirstLastFramePanelUrl(data, frame).trim();
  if (stored) return stored;
  if (frameIndex === 0) return effectiveFirstFramePanelUrl(data, ctx);
  return undefined;
}

/** 面板底栏文案 → @ 下拉 insertText（泛称保留 @主图/@首帧图，资产名走 @资产:） */
export function mentionInsertTextForPanelCaption(
  caption: string,
  slot: 'main' | 'first' | 'last',
  data: NodeData,
  ctx: PromptMediaRefContext
): string {
  const cap = String(caption || '').trim();
  const genericMain = cap === '主图' || cap === '主视频';
  const genericFrame = cap === '首帧图' || cap === '尾帧图';
  if (slot === 'main') {
    if (genericMain) return cap === '主视频' ? '@主视频' : '@主图';
    const slug = resolveAssetSlugForReferenceSlot(
      0,
      [String(data.imagePreview || '').trim()],
      [cap],
      ctx.projectAssets
    );
    return slug ? buildProjectAssetPromptToken(slug, ctx.projectAssets) : '@主图';
  }
  const frameIndex = slot === 'first' ? 0 : 1;
  if (genericFrame) return frameIndex === 0 ? '@首帧图' : '@尾帧图';
  const url =
    frameIndex === 0
      ? effectiveFirstFramePanelUrl(data, ctx)
      : resolveFirstLastFramePanelUrl(data, 'last');
  const slug = resolveAssetSlugForFrameSlot(
    frameIndex,
    url ? { ...data, ...(frameIndex === 0 ? { firstFrameImageUrl: url } : { lastFrameImageUrl: url }) } : data,
    ctx.projectAssets
  );
  return slug ? buildProjectAssetPromptToken(slug, ctx.projectAssets) : frameIndex === 0 ? '@首帧图' : '@尾帧图';
}

/** 写入 @ 列表：与面板首尾帧格展示/回退规则一致 */
function pushFrameMentionFromPanel(
  refs: PromptMediaRefItem[],
  data: NodeData,
  ctx: PromptMediaRefContext,
  frameIndex: 0 | 1
): void {
  const u = String(resolvedFramePanelUrl(data, ctx, frameIndex) || '').trim();
  if (!u || isLikelyMainVideoUrl(u)) return;

  const frame = frameIndex === 0 ? 'first' : 'last';
  const hasStoredUrl = Boolean(resolveFirstLastFramePanelUrl(data, frame).trim());
  const pushData: NodeData = { ...data };
  if (!hasStoredUrl) {
    if (frameIndex === 0) pushData.firstFrameImageUrl = u;
    else pushData.lastFrameImageUrl = u;
  }
  maybePushFramePreview(refs, pushData, frameIndex, ctx);
}

function refSlotMentionDisplayLabel(
  data: NodeData,
  slotIndex: number,
  imgs: string[],
  imagePreview: string | undefined,
  mode: PanelRefSlotLabelMode,
  assets?: ProjectAssetLabelRow[]
): string {
  const custom = data.referenceImageLabels?.[slotIndex]?.trim();
  const genericOrd = custom?.match(/^图片(\d+)$/);
  if (genericOrd) {
    const labelOrd = parseInt(genericOrd[1], 10);
    const compactOrd = refImageOrdinalForSlot(slotIndex, imgs, imagePreview);
    const hasGaps = panelReferenceHasEmptySlots(imgs);
    if (compactOrd >= 1 && labelOrd === compactOrd) return custom;
    if (!hasGaps && labelOrd === slotIndex + 1) return custom;
    if (hasGaps && String(imgs[slotIndex] || '').trim()) {
      const nonEmpty = imgs.filter((u) => String(u || '').trim()).length;
      const gapsBefore = leadingGapCountBeforeSlot(imgs, slotIndex);
      if (
        labelOrd === slotIndex + 1 &&
        nonEmpty > 1 &&
        !(gapsBefore >= 2 && labelOrd > compactOrd)
      ) {
        return custom;
      }
    }
  }
  const url = imgs[slotIndex];
  const preferred = preferAssetDisplayNameOverGenericLabel(custom, url, assets);
  if (preferred) return preferred;
  const fromAsset = lookupProjectAssetDisplayName(url, assets);
  if (fromAsset) return fromAsset;
  const fallback = panelReferenceSlotLabel(slotIndex, imgs, imagePreview, mode);
  if (fallback === '主图') return mainMentionDisplayLabel(data, assets);
  return fallback;
}

function ordinalFromMediaInsertText(insertText: string, prefix: string): string {
  const m = insertText.match(new RegExp(`^@${prefix}(\d+)$`));
  return m ? m[1] : '?';
}

/**
 * 按当前模型与 tab 收集可引用标签：
 * - 节点主预览 imagePreview → @主图 / @主视频
 * - 拖入/面板的参考素材 → @图片1… @视频1… @音频1…
 */
export function buildPromptMediaRefLabels(data: NodeData, ctx: PromptMediaRefContext): PromptMediaRefItem[] {
  const refs: PromptMediaRefItem[] = [];
  let imgCount = 0;
  let vidCount = 0;
  let audCount = 0;

  const nextImage = () => {
    imgCount += 1;
    pushImage(refs, imgCount);
  };
  const nextVideo = () => {
    vidCount += 1;
    pushVideo(refs, vidCount);
  };
  const nextAudio = () => {
    audCount += 1;
    pushAudio(refs, audCount);
  };

  if (ctx.isKelingOmni) {
    maybePushMainPreviewWithoutFrameMainImage(data, ctx, refs);
    const tab = ctx.klingOmniTab;
    const prev = data.imagePreview?.trim();
    if (tab === 'frames') {
      pushFrameMentionFromPanel(refs, data, ctx, 0);
      pushFrameMentionFromPanel(refs, data, ctx, 1);
    } else if (tab === 'multi') {
      const imgs = data.klingOmniMultiReferenceImages || [];
      if (imgs.length > 0) {
        let vidOrd = 0;
        imgs.forEach((url, idx) => {
          if (isOmniMultiReferenceSlotVideo(data, idx, url)) {
            vidOrd += 1;
            pushVideo(refs, vidOrd);
            return;
          }
          pushPanelRefImageAtSlot(refs, data, imgs, idx, prev, {
            slotLabelMode: 'panelSlot',
            ...panelRefPushOpts(ctx),
          });
        });
      }
    } else if (tab === 'instruction' || tab === 'video') {
      const imgs =
        tab === 'instruction'
          ? data.klingOmniInstructionReferenceImages || []
          : data.klingOmniVideoReferenceImages || [];
      const slotVideoUrl =
        tab === 'instruction'
          ? (data.klingOmniInstructionVideoUrl || data.klingOmniInstructionVideoPreviewUrl || '').trim()
          : (data.klingOmniVideoUrl || data.klingOmniVideoPreviewUrl || '').trim();
      let vidOrd = 0;
      if (imgs.length > 0) {
        imgs.forEach((url, idx) => {
          if (isOmniMixedRefItemVideo(url)) {
            if (prev && isLikelyMainVideoUrl(prev) && isSameMediaUrl(url, prev)) return;
            vidOrd += 1;
            pushVideo(refs, vidOrd);
            return;
          }
          pushPanelRefImageAtSlot(refs, data, imgs, idx, prev, {
            slotLabelMode: 'panelSlot',
            ...panelRefPushOpts(ctx),
          });
        });
      }
      const hasVid =
        tab === 'instruction'
          ? Boolean(data.klingOmniInstructionVideoPreviewUrl || data.klingOmniInstructionVideoUrl)
          : Boolean(data.klingOmniVideoPreviewUrl || data.klingOmniVideoUrl);
      /** 独立视频槽：imagePreview=视频 URL 或创意描述 @主视频 → 主视频，否则 @视频1 */
      const slotVideoIsMain =
        (!!prev && isLikelyMainVideoUrl(prev) && isSameMediaUrl(slotVideoUrl, prev)) ||
        (hasVid && promptMentionsMainVideoForNodeData(data));
      if (hasVid && vidOrd === 0) {
        if (slotVideoIsMain) {
          if (!refs.some((r) => r.kind === 'mainVideo')) pushMainVideo(refs);
        } else {
          nextVideo();
        }
      }
    }
    return refs;
  }

  if (ctx.isJimeng) {
    pushFrameMentionFromPanel(refs, data, ctx, 0);
    return refs;
  }

  if (ctx.isImage2) {
    maybePushMainPreview(data, ctx, refs);
    const imgs = data.referenceImages || [];
    const prev = resolvePromptMainImagePreviewForRefs(data);
    imgs.forEach((_, idx) =>
      pushPanelRefImageAtSlot(refs, data, imgs, idx, prev, {
        slotLabelMode: 'panelSlot',
        ...panelRefPushOpts(ctx),
      })
    );
    return refs;
  }

  if (ctx.isNano) {
    maybePushMainPreview(data, ctx, refs);
    const imgs = data.referenceImages || [];
    const prev = resolvePromptMainImagePreviewForRefs(data);
    imgs.forEach((_, idx) =>
      pushPanelRefImageAtSlot(refs, data, imgs, idx, prev, {
        slotLabelMode: 'panelSlot',
        ...panelRefPushOpts(ctx),
      })
    );
    return refs;
  }

  if (ctx.isSeedance20) {
    if (ctx.seedanceMode === 'image') {
      pushFrameMentionFromPanel(refs, data, ctx, 0);
      pushFrameMentionFromPanel(refs, data, ctx, 1);
      return refs;
    }
    if (ctx.seedanceMode === 'reference') {
      const mainVideoUrl = resolveSeedanceReferenceMainVideoUrl(data);
      const mainIsVideo = Boolean(mainVideoUrl);
      /** 与面板 referenceMovs 角标一致：主视频须 @主视频，而非 @视频1 */
      if (mainIsVideo && mainVideoUrl) {
        pushMainVideo(refs, mainMentionDisplayLabel(data, ctx.projectAssets));
      } else {
        maybePushMainPreviewWithoutFrameMainImage(data, ctx, refs);
      }
      const imgs = data.referenceImages || [];
      const prev = resolvePromptMainImagePreviewForRefs(data);
      /** 与 UI 一致：主图单独一格，referenceImages 里与主预览同素材的槽不占 @图片1（含 thumb/file 双轨） */
      if (imgs.length > 0) {
        imgs.forEach((_, idx) =>
          pushPanelRefImageAtSlot(refs, data, imgs, idx, prev, {
            slotLabelMode: 'seedanceSlot',
            ...panelRefPushOpts(ctx),
          })
        );
      } else if (
        !mainIsVideo &&
        (data.firstFrameImage || data.firstFrameImageUrl)
      ) {
        if (!isFirstFrameSlotSameAsMainImagePreview(data, ctx, prev)) {
          nextImage();
        }
      }
      const movs = data.referenceMovs || [];
      movs.forEach((m) => {
        const u = m?.url;
        if (mainIsVideo && mainVideoUrl && isSameMediaUrl(u, mainVideoUrl)) return;
        if (prev && isLikelyMainVideoUrl(prev) && isSameMediaUrl(u, prev)) return;
        nextVideo();
      });
      const auds = data.referenceAudios || [];
      auds.forEach(() => nextAudio());
      return refs;
    }
    maybePushMainPreviewWithoutFrameMainImage(data, ctx, refs);
    return refs;
  }

  if (ctx.isKeling || ctx.isVidu || ctx.isSeedance15) {
    pushFrameMentionFromPanel(refs, data, ctx, 0);
    pushFrameMentionFromPanel(refs, data, ctx, 1);
    return refs;
  }

  return refs;
}

/** 解析 @ 提及：从光标前文本中取 @ 后过滤词 */
export function getActiveAtMention(
  text: string,
  cursor: number,
  projectAssets?: ProjectAssetLabelRow[]
): { atIndex: number; query: string } | null {
  const before = text.slice(0, cursor);
  const atIndex = before.lastIndexOf('@');
  if (atIndex === -1) return null;
  const afterAt = before.slice(atIndex + 1);
  if (/[\s\n\r]/.test(afterAt)) return null;

  /** 已完成 @资产:名称 — 光标在库内资产名末尾时不视为正在输入（避免误匹配长串正文） */
  if (afterAt.startsWith('资产:') && projectAssets?.length) {
    const tail = afterAt.slice('资产:'.length);
    const known = matchLongestProjectAssetKey(tail, projectAssets);
    if (known && tail.startsWith(known)) {
      if (tail.length === known.length) return null;
      const afterName = tail.slice(known.length);
      /** 误粘贴/扫描粘连：@资产:野人围绕着… — 光标在 token 内部时不视为正在输入 @ */
      if (afterName.length > 0 && !/^[\s@，。；：、,.!?／/与和及{〈(（\[]/.test(afterName[0])) {
        return null;
      }
    }
  }

  return { atIndex, query: normalizeAtMentionFilterQuery(afterAt) };
}

/** @ 下拉过滤词：去掉用户手打的「资产:」前缀，与 insertText @资产:名 对齐 */
export function normalizeAtMentionFilterQuery(query: string): string {
  const q = query.trim();
  if (q.startsWith('资产:')) return q.slice('资产:'.length);
  return q;
}

/**
 * @图片n 对应面板槽：先匹配底栏「图片n」，再按非空参考槽序号（跳过空槽，避免串位）。
 * 主图格已单独展示时，跳过与 imagePreview 同素材的槽（避免 @图片1 误绑主图 URL）。
 */
export function resolvePictureTokenSlotIndex(
  ord: number,
  panelUrls: string[],
  labels: string[] | undefined,
  imagePreview?: string
): number | undefined {
  if (ord < 1) return undefined;
  const want = `图片${ord}`;
  const main = String(imagePreview || '').trim();
  const isMainDupSlot = (i: number) =>
    Boolean(main && isDuplicateOfMainImagePreview(String(panelUrls[i] || '').trim(), main));
  const phys = ord - 1;
  /** 底栏标签重复为同一「图片n」时，@图片n 按物理槽位对齐，避免 @图片1/@图片2 共绑同一槽（image2.json） */
  const duplicateGenericPictureLabels = (() => {
    const seen = new Set<string>();
    for (let i = 0; i < (labels?.length || 0); i++) {
      const l = labels?.[i]?.trim() || '';
      if (!/^图片\d+$/.test(l)) continue;
      if (!String(panelUrls[i] || '').trim()) continue;
      if (seen.has(l)) return true;
      seen.add(l);
    }
    return false;
  })();
  if (
    duplicateGenericPictureLabels &&
    phys >= 0 &&
    phys < panelUrls.length &&
    String(panelUrls[phys] || '').trim()
  ) {
    return phys;
  }
  const labelHits: number[] = [];
  const mainDupLabelHits: number[] = [];
  for (let i = 0; i < panelUrls.length; i++) {
    if (labels?.[i]?.trim() !== want) continue;
    if (!String(panelUrls[i] || '').trim()) continue;
    if (isMainDupSlot(i)) {
      mainDupLabelHits.push(i);
      continue;
    }
    labelHits.push(i);
  }
  if (labelHits.length === 1) return labelHits[0];
  for (const i of labelHits) {
    if (refImageOrdinalForSlot(i, panelUrls, imagePreview) === ord) return i;
  }
  /** 底栏「图片n」与 @图片n 同序号，但与 imagePreview 同 URL：仍绑定该槽（可灵3 @图片2）；778990 误标 slot0 时让位给真实参考格 */
  for (const i of mainDupLabelHits) {
    if (labels?.[i]?.trim() !== want || i + 1 !== ord) continue;
    const conflictSlot = panelUrls.findIndex(
      (_, j) =>
        j !== i &&
        String(panelUrls[j] || '').trim() &&
        !isMainDupSlot(j) &&
        refImageOrdinalForSlot(j, panelUrls, imagePreview) === ord
    );
    const hasNonMainDupOrdinalMatch = conflictSlot >= 0;
    if (hasNonMainDupOrdinalMatch && ord === 1 && i === 0) {
      const conflictLabel = labels?.[conflictSlot]?.trim() || '';
      const conflictPic = conflictLabel.match(/^图片(\d+)$/);
      // 另一槽底栏为「图片2」等显式序号：slot0 的「图片1」优先（Nano @主图+@图片1）；底栏非图片n 则让位（778990）
      if (conflictPic && parseInt(conflictPic[1], 10) !== ord) return i;
      continue;
    }
    return i;
  }
  /** 优先非主图重复槽（778990：@图片1→猫而非主图 city 重复槽） */
  for (let i = 0; i < panelUrls.length; i++) {
    if (!String(panelUrls[i] || '').trim()) continue;
    if (isMainDupSlot(i)) continue;
    if (refImageOrdinalForSlot(i, panelUrls, imagePreview) === ord) return i;
  }
  if (
    phys >= 0 &&
    phys < panelUrls.length &&
    String(panelUrls[phys] || '').trim() &&
    !isMainDupSlot(phys)
  ) {
    const compactAtPhys = refImageOrdinalForSlot(phys, panelUrls, imagePreview);
    const gapsBefore = leadingGapCountBeforeSlot(panelUrls, phys);
    const nonEmpty = panelUrls.filter((u) => String(u || '').trim()).length;
    if (compactAtPhys !== ord) {
      if (gapsBefore >= 2 || nonEmpty === 1) return undefined;
      const want = `图片${ord}`;
      if (labels?.[phys]?.trim() === want) return phys;
      if (ord > nonEmpty) return undefined;
      return phys;
    }
    if (compactAtPhys === ord) return phys;
  }
  /** image2/Nano：仅当无其它槽可匹配时，才允许 @图片n 绑定与主图同 URL 的显式参考槽 */
  for (const i of mainDupLabelHits) {
    if (ord === i + 1) return i;
  }
  return undefined;
}

/** @图片n 在面板槽已映射为 @资产:名称 时，仍能解析到对应槽位项 */
export function findPromptMediaRefItemForToken(
  labels: PromptMediaRefItem[],
  token: string,
  alias?: string
): PromptMediaRefItem | undefined {
  const a = alias ?? token;
  const direct = labels.find((i) => i.insertText === token || i.insertText === a);
  if (direct) return direct;
  const pic = a.match(/^@图片(\d+)$/);
  if (pic) {
    const ord = parseInt(pic[1], 10);
    if (ord >= 1) {
      const byCaption = labels.find(
        (i) =>
          (i.kind === 'image' || i.kind === 'projectAsset') &&
          (i.label === `图片${ord}` || i.label.replace(/^素材·/, '') === `图片${ord}`)
      );
      if (byCaption) return byCaption;
      const directPic = labels.find((i) => i.kind === 'image' && i.insertText === a);
      if (directPic) return directPic;
      /** 面板底栏为资产名时 insertText 为 @资产:名，仍按 refImageIndex 序对应 @图片n */
      const picRefs = labels
        .filter(
          (i) =>
            (i.kind === 'image' || i.kind === 'projectAsset') && i.refImageIndex != null
        )
        .sort((x, y) => (x.refImageIndex ?? 0) - (y.refImageIndex ?? 0));
      const byOrd = picRefs[ord - 1];
      if (byOrd) return byOrd;
    }
  }
  if (token.startsWith('@资产:')) {
    const key = token.slice('@资产:'.length);
    const matches = labels.filter(
      (i) =>
        i.kind === 'projectAsset' &&
        (i.insertText === token ||
          i.insertText.replace(/^@资产:/, '') === key ||
          i.label === key ||
          i.label.replace(/^素材·/, '') === key)
    );
    if (matches.length <= 1) return matches[0];
    return (
      matches.find((i) => i.refFrameIndex != null) ||
      matches.find((i) => i.refImageIndex != null) ||
      matches[0]
    );
  }
  return undefined;
}

/** Image2 属性面板可见槽（主图格 + 最多 3 参考，或无主图时 4 参考；与 API image[] 上限一致） */
export function image2VisiblePanelRefSlotIndices(data: NodeData): {
  showMain: boolean;
  refSlotIndices: number[];
} {
  const mainForPanel = resolvePromptMainImagePreviewForRefs(data);
  const prev = data.imagePreview?.trim();
  const showMain = Boolean(mainForPanel && !isLikelyMainVideoUrl(mainForPanel));
  const entries = buildPanelReferenceDisplayEntries(data.referenceImages, {
    imagePreview: mainForPanel ?? prev,
    // @ 下拉不按主图去重：用户显式拖入同 URL 参考槽时 @图片n 仍需可选
    dedupeAgainstMain: false,
    referenceImageLabels: data.referenceImageLabels,
  });
  const maxRef = image2MaxReferenceSlots(data);
  return {
    showMain,
    refSlotIndices: entries.slice(0, maxRef).map((e) => e.slotIndex),
  };
}

function filterLabelsForPanelInspectorDropdown(
  data: NodeData,
  labels: PromptMediaRefItem[],
  ctx: PromptMediaRefContext
): PromptMediaRefItem[] {
  if (ctx.isImage2) {
    const { showMain, refSlotIndices } = image2VisiblePanelRefSlotIndices(data);
    const allowed = new Set(refSlotIndices);
    return labels.filter((it) => {
      if (it.kind === 'mainImage' || it.kind === 'mainVideo') return showMain;
      if (it.refImageIndex != null) return allowed.has(it.refImageIndex);
      if (it.kind === 'projectAsset' && it.refImageIndex == null) return showMain;
      return false;
    });
  }
  if (ctx.isNano) {
    const allowed = new Set(
      (data.referenceImages || [])
        .map((u, i) => (String(u || '').trim() ? i : -1))
        .filter((i) => i >= 0)
    );
    const showMain = Boolean(resolvePromptMainImagePreviewForRefs(data));
    return labels.filter((it) => {
      if (it.kind === 'mainImage' || it.kind === 'mainVideo') {
        return showMain;
      }
      if (it.kind === 'projectAsset' && it.refImageIndex == null) return showMain;
      if (it.refImageIndex != null) return allowed.has(it.refImageIndex);
      return false;
    });
  }
  return labels;
}

/** @ 下拉展示名：与面板底栏文案一致（泛称 @主图/@首帧图 亦返回可读名） */
export function inspectorMentionDisplayNameForItem(it: PromptMediaRefItem): string {
  const lab = String(it.label || '')
    .replace(/^素材·/, '')
    .trim();
  if (lab) return lab;
  const ins = String(it.insertText || '').trim();
  if (ins === '@主图') return '主图';
  if (ins === '@主视频') return '主视频';
  if (ins === '@首帧图') return '首帧图';
  if (ins === '@尾帧图') return '尾帧图';
  if (ins.startsWith('@资产:')) return ins.slice('@资产:'.length).trim();
  return '';
}

/** 属性面板 @ 下拉：仅当前面板已拖入/选中的素材（不含项目素材库全量）；同资产名只一项 */
export function buildInspectorPromptMentionItems(
  data: NodeData,
  ctx: PromptMediaRefContext,
  _projectAssetRefItems: PromptMediaRefItem[] = []
): PromptMediaRefItem[] {
  void _projectAssetRefItems;
  let labels = buildPromptMediaRefLabels(data, ctx);
  if (ctx.isImage2 || ctx.isNano) {
    labels = filterLabelsForPanelInspectorDropdown(data, labels, ctx);
  }
  const seenTokens = new Set<string>();
  const seenNames = new Set<string>();
  const out: PromptMediaRefItem[] = [];
  for (const it of labels) {
    if (
      it.kind !== 'projectAsset' &&
      it.kind !== 'mainImage' &&
      it.kind !== 'mainVideo' &&
      it.kind !== 'image' &&
      it.kind !== 'video' &&
      it.kind !== 'audio'
    ) {
      continue;
    }
    const t = it.insertText?.trim();
    if (!t || seenTokens.has(t)) continue;
    const nameKey = inspectorMentionDisplayNameForItem(it).toLowerCase();
    if (nameKey && seenNames.has(nameKey)) {
      /** 同资产名：优先保留 @资产:展示名，不要 @主图 */
      if (it.kind === 'projectAsset') {
        const prevIdx = out.findIndex(
          (x) => inspectorMentionDisplayNameForItem(x).toLowerCase() === nameKey
        );
        if (
          prevIdx >= 0 &&
          (out[prevIdx].kind === 'mainImage' || isLegacyFrameImageMentionItem(out[prevIdx]))
        ) {
          seenTokens.delete(out[prevIdx].insertText.trim());
          out.splice(prevIdx, 1);
        } else {
          continue;
        }
      } else if (
        it.kind === 'mainImage' ||
        it.kind === 'mainVideo' ||
        isLegacyFrameImageMentionItem(it)
      ) {
        /** 泛称（@主图/@主视频/首尾帧）按展示名去重，避免同义重复 */
        continue;
      }
      /** image/video/audio（@图片n/@视频n/@音频n）：insertText 已按 ordinal 唯一，
       *  displayLabel 可能因 referenceImageLabels 错位而重复（如 slot2 标签误写"图片4"），
       *  不按 displayLabel 去重，否则会误删后续合法 @图片n（如真正的 @图片4）。 */
    }
    seenTokens.add(t);
    if (nameKey) seenNames.add(nameKey);
    out.push(it);
  }
  return out;
}

/** 属性面板输入 @ 时的下拉：面板已拖入素材 + 项目素材库（去重；面板项优先） */
export function mergeInspectorAtMentionItems(
  panelItems: PromptMediaRefItem[],
  libraryItems: PromptMediaRefItem[]
): PromptMediaRefItem[] {
  const seenTokens = new Set<string>();
  const seenNames = new Set<string>();
  const out: PromptMediaRefItem[] = [];
  const push = (it: PromptMediaRefItem) => {
    const t = it.insertText?.trim();
    if (!t || seenTokens.has(t)) return;
    const nameKey = inspectorMentionDisplayNameForItem(it).toLowerCase();
    if (nameKey && seenNames.has(nameKey)) return;
    seenTokens.add(t);
    if (nameKey) seenNames.add(nameKey);
    out.push(it);
  };
  for (const it of panelItems) push(it);
  for (const it of libraryItems) {
    if (it.kind === 'projectAsset') push(it);
  }
  return out;
}

/** slug 与展示名均可查 URL（创意描述 token 常用 @资产:名称） */
export function buildProjectAssetSlugUrlMap(
  rows: Array<{ slug: string; name: string; url?: string }>
): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    const u = r.url?.trim();
    if (!u) continue;
    m.set(r.slug, u);
    const name = r.name?.trim();
    if (name) m.set(name, u);
  }
  return m;
}

export function filterMediaRefs(items: PromptMediaRefItem[], query: string): PromptMediaRefItem[] {
  const q = normalizeAtMentionFilterQuery(query).trim().toLowerCase();
  if (!q) return items;
  return items.filter((it) => {
    const ins = it.insertText.toLowerCase();
    const bare = ins.startsWith('@') ? ins.slice(1) : ins;
    return (
      it.label.toLowerCase().includes(q) ||
      ins.includes(q) ||
      bare.includes(q)
    );
  });
}

/** 与 NodeInspector / 运行节点一致，用于展开 @ 占位符 */
/** 运行节点时附带项目资产库，供 @ 解析与 plan.label 使用展示名 */
export function buildPromptMediaRefContextForRun(
  data: NodeData,
  projectAssets?: ProjectAssetLabelRow[]
): PromptMediaRefContext {
  return { ...buildPromptMediaRefContextFromNode(data), projectAssets };
}

export function buildPromptMediaRefContextFromNode(data: NodeData): PromptMediaRefContext {
  const model = data.selectedModel || '';
  const isKelingOmni = model === '可灵3.0 Omni';
  const isJimeng = model === '即梦3.0 Pro';
  const isVidu = model === 'vidu 2.0';
  const isSeedance15 = model === 'seedance1.5-pro';
  const isSeedance20 = model === 'seedance2.0 (高质量版)' || model === 'seedance2.0 (急速版)';
  const isSeedance = isSeedance15 || isSeedance20;
  const isKelingNonOmni =
    (model.includes('可灵') || model.includes('Keling')) && !isKelingOmni;
  const isNano = isNanoBanana2Model(model);
  const isImage2 = isImage2Model(model);
  return {
    isKelingOmni,
    klingOmniTab: (data.klingOmniTab || 'multi') as PromptMediaRefContext['klingOmniTab'],
    isJimeng,
    isNano,
    isImage2,
    isKeling: Boolean(isKelingNonOmni),
    isVidu,
    isSeedance15,
    isSeedance20,
    seedanceMode: (data.seedanceGenerationMode || 'text') as PromptMediaRefContext['seedanceMode'],
  };
}

/** 与 API referenceImages / imageUrls 序号一致，提示词中统一为 [图N] */
export function referenceImagePhrase(label: string, imageIndex: number): string {
  return `（${label}，对应本请求 referenceImages 第${imageIndex}张，在提示词中请视作 [图${imageIndex}]）`;
}

function seedanceReferenceImagePhrase(label: string, imageIndex: number): string {
  return referenceImagePhrase(label, imageIndex);
}

function referenceImageIndexFromOptions(
  options: ResolvePromptPlaceholdersOptions | undefined,
  token: string
): number | undefined {
  if (!options) return undefined;
  return (
    options.referenceImageIndexByToken?.get(token) ??
    options.seedanceReferenceImageIndexByToken?.get(token)
  );
}

function expansionPhraseForRef(
  item: PromptMediaRefItem,
  data: NodeData,
  ctx: PromptMediaRefContext,
  options?: ResolvePromptPlaceholdersOptions
): string {
  switch (item.kind) {
    case 'mainImage': {
      const n =
        referenceImageIndexFromOptions(options, '@主图') ??
        referenceImageIndexFromOptions(options, '@主体');
      const mainCap = mainMentionDisplayLabel(data, ctx.projectAssets);
      if (n != null) {
        return referenceImagePhrase(`主预览素材「${mainCap}」`, n);
      }
      if (ctx.isSeedance20 && ctx.seedanceMode === 'reference') {
        return `（主预览素材「${mainCap}」，对应本请求主图/主预览输入）`;
      }
      return `（主预览素材「${mainCap}」，对应本请求主图/主预览输入）`;
    }
    case 'mainVideo':
      return '（本节点主预览视频素材，对应本请求主视频输入）';
    case 'image': {
      const mappedIdx = referenceImageIndexFromOptions(options, item.insertText);
      if (mappedIdx != null) {
        return referenceImagePhrase(`面板参考「${item.label}」`, mappedIdx);
      }
      const n = ordinalFromMediaInsertText(item.insertText, '图片');
      if (item.refFrameIndex === 0) {
        const frameCap = item.label || '首帧图';
        if (ctx.isKelingOmni && ctx.klingOmniTab === 'frames')
          return `（首帧素材「${frameCap}」，对应本请求首帧/第一张图）`;
        if (ctx.isSeedance20 && ctx.seedanceMode === 'image') {
          return `（首帧素材「${frameCap}」，对应本请求 startImage）`;
        }
        if (ctx.isKeling || ctx.isVidu || ctx.isSeedance15) {
          return `（首帧素材「${frameCap}」，对应本请求首帧/第一张图）`;
        }
      }
      if (item.refFrameIndex === 1) {
        const frameCap = item.label || '尾帧图';
        if (ctx.isKelingOmni && ctx.klingOmniTab === 'frames')
          return `（尾帧素材「${frameCap}」，对应本请求尾帧/第二张图）`;
        if (ctx.isSeedance20 && ctx.seedanceMode === 'image') {
          return `（尾帧素材「${frameCap}」，对应本请求 endImage）`;
        }
        if (ctx.isKeling || ctx.isVidu || ctx.isSeedance15) {
          return `（尾帧素材「${frameCap}」，对应本请求尾帧/第二张图）`;
        }
      }
      if (item.refImageIndex != null) {
        const apiN = item.refImageIndex + 1;
        if (ctx.isSeedance20 && ctx.seedanceMode === 'reference') {
          return `（面板参考「${item.label}」，对应本请求 referenceImages 第${apiN}项）`;
        }
        if (ctx.isNano || ctx.isImage2) {
          return `（面板参考「${item.label}」，对应本请求 imageUrls 第${apiN}项）`;
        }
        if (ctx.isJimeng) {
          return `（面板参考「${item.label}」，对应本请求即梦参考图列表第${apiN}项）`;
        }
        if (ctx.isKelingOmni && ctx.klingOmniTab === 'multi') {
          return `（面板参考「${item.label}」，对应本请求 Omni 多图参考第${apiN}项）`;
        }
        if (ctx.isKelingOmni && (ctx.klingOmniTab === 'instruction' || ctx.klingOmniTab === 'video')) {
          return `（面板参考「${item.label}」，对应本请求当前 tab 参考图第${apiN}项）`;
        }
        return `（面板参考「${item.label}」，与本请求参考图入参第${apiN}项一致）`;
      }
      if (ctx.isKelingOmni && ctx.klingOmniTab === 'frames') {
        if (item.refFrameIndex === 0 || item.insertText === '@首帧图') {
          const frameCap = item.label || '首帧图';
          return `（首帧素材「${frameCap}」，对应本请求首帧/第一张图）`;
        }
        if (item.refFrameIndex === 1 || item.insertText === '@尾帧图') {
          const frameCap = item.label || '尾帧图';
          return `（尾帧素材「${frameCap}」，对应本请求尾帧/第二张图）`;
        }
      }
      if (ctx.isKelingOmni && ctx.klingOmniTab === 'multi') {
        return `（参考图第${n}张，对应本请求中接在首帧后的第${n}张参考图）`;
      }
      if (ctx.isKelingOmni && (ctx.klingOmniTab === 'instruction' || ctx.klingOmniTab === 'video')) {
        return `（参考图第${n}张，对应本请求参考图序列第${n}张）`;
      }
      if (ctx.isNano || ctx.isImage2) {
        return `（参考图第${n}张，对应本请求 imageUrls 中主图之后的第${n}张）`;
      }
      if (ctx.isJimeng) {
        return `（面板参考图第${n}张；即梦任务实际提交的为首帧图，与面板所选顺序一致）`;
      }
      if (ctx.isSeedance20 && ctx.seedanceMode === 'image') {
        if (item.refFrameIndex === 0 || item.insertText === '@首帧图') {
          return '（首帧图，对应本请求 startImage）';
        }
        if (item.refFrameIndex === 1 || item.insertText === '@尾帧图') {
          return '（尾帧图，对应本请求 endImage）';
        }
      }
      if (ctx.isSeedance20 && ctx.seedanceMode === 'reference') {
        const mapped = options?.seedanceReferenceImageIndexByToken?.get(item.insertText);
        const apiN = mapped ?? (item.refImageIndex != null ? item.refImageIndex + 1 : Number(n) || 1);
        return seedanceReferenceImagePhrase(`参考图「${item.label}」`, apiN);
      }
      if (ctx.isKeling || ctx.isVidu || ctx.isSeedance15) {
        if (item.refFrameIndex === 0 || item.insertText === '@首帧图') {
          return '（首帧图，对应本请求首帧/第一张图）';
        }
        if (item.refFrameIndex === 1 || item.insertText === '@尾帧图') {
          return '（尾帧图，对应本请求尾帧/第二张图）';
        }
      }
      return `（参考图第${n}张）`;
    }
    case 'video': {
      const n = ordinalFromMediaInsertText(item.insertText, '视频');
      if (ctx.isKelingOmni && (ctx.klingOmniTab === 'instruction' || ctx.klingOmniTab === 'video')) {
        return `（参考视频第${n}段，对应本请求参考视频第${n}段）`;
      }
      if (ctx.isSeedance20 && ctx.seedanceMode === 'reference') {
        return `（参考视频第${n}段，对应本请求 referenceVideos 第${n}段）`;
      }
      return `（参考视频第${n}段）`;
    }
    case 'audio': {
      const n = ordinalFromMediaInsertText(item.insertText, '音频');
      return `（参考音频第${n}段，对应本请求 referenceAudios 第${n}段）`;
    }
    case 'projectAsset': {
      const raw = item.label.replace(/^素材·/, '') || item.label;
      const n =
        referenceImageIndexFromOptions(options, item.insertText) ??
        (item.refFrameIndex === 0
          ? referenceImageIndexFromOptions(options, '@首帧图')
          : item.refFrameIndex === 1
            ? referenceImageIndexFromOptions(options, '@尾帧图')
            : undefined);
      if (item.refFrameIndex === 0) {
        if (n != null) return referenceImagePhrase(`首帧素材「${raw}」`, n);
        if (ctx.isSeedance20 && ctx.seedanceMode === 'image') {
          return `（首帧素材「${raw}」，对应本请求 startImage）`;
        }
        return `（首帧素材「${raw}」，对应本请求首帧/第一张图）`;
      }
      if (item.refFrameIndex === 1) {
        if (n != null) return referenceImagePhrase(`尾帧素材「${raw}」`, n);
        if (ctx.isSeedance20 && ctx.seedanceMode === 'image') {
          return `（尾帧素材「${raw}」，对应本请求 endImage）`;
        }
        return `（尾帧素材「${raw}」，对应本请求尾帧/第二张图）`;
      }
      return expansionPhraseForProjectAsset(raw, n);
    }
    default:
      return '';
  }
}

export type ResolvePromptPlaceholdersOptions = {
  /** 可选：主体库名称等，用于替换 @主体 */
  subjectCaption?: string;
  /** 项目资产库：@资产:slug → 文案说明（媒体 URL 由调用方并入参考图） */
  projectAssets?: Array<{ slug: string; name: string; url: string }>;
  /** @token → referenceImages 序号（与请求体数组一致，1-based），展开为 [图N] */
  referenceImageIndexByToken?: Map<string, number>;
  referenceVideoIndexByToken?: Map<string, number>;
  referenceAudioIndexByToken?: Map<string, number>;
  /** @deprecated 使用 referenceImageIndexByToken */
  seedanceReferenceImageIndexByToken?: Map<string, number>;
  /** @deprecated 使用 referenceVideoIndexByToken */
  seedanceReferenceVideoIndexByToken?: Map<string, number>;
  /** @deprecated 使用 referenceAudioIndexByToken */
  seedanceReferenceAudioIndexByToken?: Map<string, number>;
};

function expansionPhraseForProjectAsset(name: string, imageIndex?: number): string {
  if (imageIndex != null) {
    return seedanceReferenceImagePhrase(`项目素材库·${name}`, imageIndex);
  }
  return `（项目素材库：${name}，生成请求中已并入该素材 URL）`;
}

/** 主预览为资产库素材时，@ 下拉为 @资产:名称，但文案里仍可能写 @主图 */
function findMainPreviewRefItem(
  items: PromptMediaRefItem[],
  data: NodeData,
  ctx: PromptMediaRefContext
): PromptMediaRefItem | undefined {
  const direct = items.find((i) => i.insertText === '@主图');
  if (direct) return direct;
  const p = data.imagePreview?.trim();
  if (!p || isLikelyMainVideoUrl(p)) return undefined;
  const cap = mainMentionDisplayLabel(data, ctx.projectAssets);
  if (cap === '主图' || cap === '主视频') return undefined;
  return items.find(
    (i) =>
      i.kind === 'projectAsset' &&
      (i.label === cap || i.label.replace(/^素材·/, '') === cap)
  );
}

/** 构建 token → 发模型前展开文案 的映射（各生图/生视频模型共用） */
function buildPromptTokenPhraseMap(
  data: NodeData,
  c: PromptMediaRefContext,
  options?: ResolvePromptPlaceholdersOptions
): Map<string, string> {
  const items = buildPromptMediaRefLabels(data, c);
  const map = new Map<string, string>();
  const addPair = (token: string, phrase: string) => {
    if (!token || !phrase || map.has(token)) return;
    map.set(token, phrase);
  };
  for (const it of items) {
    const phrase = expansionPhraseForRef(it, data, c, options);
    if (!phrase) continue;
    addPair(it.insertText, phrase);
    if (it.kind === 'projectAsset' && it.refFrameIndex === 0) {
      const n =
        referenceImageIndexFromOptions(options, '@首帧图') ??
        referenceImageIndexFromOptions(options, it.insertText);
      const raw = it.label.replace(/^素材·/, '') || it.label;
      addPair(
        '@首帧图',
        n != null ? referenceImagePhrase(`首帧素材「${raw}」`, n) : phrase
      );
    }
    if (it.kind === 'projectAsset' && it.refFrameIndex === 1) {
      const n =
        referenceImageIndexFromOptions(options, '@尾帧图') ??
        referenceImageIndexFromOptions(options, it.insertText);
      const raw = it.label.replace(/^素材·/, '') || it.label;
      addPair(
        '@尾帧图',
        n != null ? referenceImagePhrase(`尾帧素材「${raw}」`, n) : phrase
      );
    }
    if (it.kind === 'projectAsset' && it.refImageIndex != null) {
      const picTok = `@图片${it.refImageIndex + 1}`;
      const cap = it.label.replace(/^素材·/, '') || it.label;
      const n =
        referenceImageIndexFromOptions(options, picTok) ??
        referenceImageIndexFromOptions(options, it.insertText);
      const picPhrase =
        n != null ? referenceImagePhrase(`面板参考「${cap}」`, n) : phrase;
      addPair(picTok, picPhrase);
      if (it.refImageIndex === 0) addPair('@图片', picPhrase);
    }
  }
  if (options?.projectAssets?.length) {
    for (const a of options.projectAssets) {
      const tok = buildProjectAssetPromptToken(a.slug, options.projectAssets);
      const n =
        referenceImageIndexFromOptions(options, tok) ??
        referenceImageIndexFromOptions(options, `@资产:${a.slug}`) ??
        referenceImageIndexFromOptions(options, `@资产:${a.name.trim()}`);
      if (!map.has(tok)) {
        addPair(tok, expansionPhraseForProjectAsset(a.name, n));
      }
      const slugTok = `@资产:${a.slug}`;
      if (slugTok !== tok && !map.has(slugTok)) {
        const nSlug = referenceImageIndexFromOptions(options, slugTok);
        if (nSlug != null) {
          addPair(slugTok, expansionPhraseForProjectAsset(a.name, nSlug));
        }
      }
      const nameTok = `@资产:${a.name.trim()}`;
      if (nameTok !== tok && nameTok !== slugTok && !map.has(nameTok)) {
        const nName =
          referenceImageIndexFromOptions(options, nameTok) ??
          referenceImageIndexFromOptions(options, slugTok) ??
          n;
        if (nName != null) {
          addPair(nameTok, expansionPhraseForProjectAsset(a.name, nName));
        }
      }
    }
  }
  const mainRef = findMainPreviewRefItem(items, data, c);
  if (mainRef) {
    const mainPhrase =
      mainRef.kind === 'projectAsset'
        ? expansionPhraseForProjectAsset(
            mainRef.label.replace(/^素材·/, '') || mainRef.label,
            referenceImageIndexFromOptions(options, '@主图') ??
              referenceImageIndexFromOptions(options, mainRef.insertText)
          )
        : expansionPhraseForRef(mainRef, data, c, options);
    addPair('@主图', mainPhrase);
    addPair(
      '@主体',
      options?.subjectCaption?.trim()
        ? `（主体：${options.subjectCaption.trim()}，同本请求主预览图）`
        : mainPhrase
    );
  } else if (options?.subjectCaption?.trim()) {
    addPair('@主体', `（主体：${options.subjectCaption.trim()}）`);
  }
  const img1 =
    items.find((i) => i.insertText === '@图片1') ||
    items.find((i) => i.kind === 'image' && i.refFrameIndex === 0);
  if (img1) addPair('@图片', expansionPhraseForRef(img1, data, c, options));
  const vid1 = items.find((i) => i.insertText === '@视频1');
  if (vid1) addPair('@视频', expansionPhraseForRef(vid1, data, c, options));
  const aud1 = items.find((i) => i.insertText === '@音频1');
  if (aud1) addPair('@音频', expansionPhraseForRef(aud1, data, c, options));
  return map;
}

function lookupExpansionPhraseForToken(
  token: string,
  phraseMap: Map<string, string>,
  projectAssets?: ProjectAssetLabelRow[]
): string | undefined {
  const direct = phraseMap.get(token);
  if (direct) return direct;
  if (token.startsWith('@资产:')) {
    const key = token.slice('@资产:'.length).trim();
    const candidates = new Set<string>([token, `@资产:${key}`]);
    if (projectAssets?.length) {
      const row = projectAssets.find((a) => a.slug === key || a.name.trim() === key);
      if (row) {
        candidates.add(buildProjectAssetPromptToken(row.slug, projectAssets));
        candidates.add(`@资产:${row.name.trim()}`);
        candidates.add(`@资产:${row.slug}`);
      }
    }
    for (const cand of candidates) {
      const phrase = phraseMap.get(cand);
      if (phrase) return phrase;
    }
  }
  if (token === '@图片' && phraseMap.has('@图片1')) return phraseMap.get('@图片1');
  if (token === '@视频' && phraseMap.has('@视频1')) return phraseMap.get('@视频1');
  if (token === '@音频' && phraseMap.has('@音频1')) return phraseMap.get('@音频1');
  if (token === '@主体' && phraseMap.has('@主图')) return phraseMap.get('@主图');
  return undefined;
}

/**
 * 发模型前调用：将 @主图、@图片1、@图片（简写=第1张）、@视频、@音频 等换为与 API 入参顺序一致的中文说明。
 * 媒体 URL 仍在各模型专用字段；本函数只增强 prompt 可理解性。
 */
export function resolvePromptPlaceholders(
  userPrompt: string,
  data: NodeData,
  ctx?: PromptMediaRefContext,
  options?: ResolvePromptPlaceholdersOptions
): string {
  if (userPrompt == null || userPrompt === '') return userPrompt;
  const c: PromptMediaRefContext = {
    ...(ctx ?? buildPromptMediaRefContextFromNode(data)),
    projectAssets: ctx?.projectAssets ?? options?.projectAssets,
  };
  const phraseMap = buildPromptTokenPhraseMap(data, c, options);
  const projectAssets = c.projectAssets ?? options?.projectAssets;
  const matches = matchAllPromptMediaTokens(userPrompt, projectAssets);
  if (matches.length === 0) return userPrompt;

  let out = userPrompt;
  const sorted = [...matches].sort((a, b) => b.index - a.index);
  for (const { token, index } of sorted) {
    const phrase = lookupExpansionPhraseForToken(token, phraseMap, projectAssets);
    if (!phrase) continue;
    out = out.slice(0, index) + phrase + out.slice(index + token.length);
  }
  return out;
}

export function slugifyProjectAssetToken(name: string): string {
  const t = name.trim().replace(/\s+/g, '_');
  const cleaned = t.replace(/[^\w\u4e00-\u9fff_-]/g, '');
  return cleaned || 'asset';
}

export function buildProjectAssetSlugRows(
  assets: Array<{ id: string; name: string }>
): Array<{ id: string; name: string; slug: string }> {
  const used = new Set<string>();
  return assets.map((a) => {
    let base = slugifyProjectAssetToken(a.name);
    let slug = base;
    let n = 0;
    while (used.has(slug)) {
      n += 1;
      slug = `${base}_${n}`;
    }
    used.add(slug);
    return { id: a.id, name: a.name, slug };
  });
}

export function buildProjectAssetPromptRefItems(
  assets: Array<{ id: string; name: string }>
): PromptMediaRefItem[] {
  return buildProjectAssetSlugRows(assets).map((a) => ({
    label: `素材·${a.name}`,
    kind: 'projectAsset' as const,
    insertText: `@资产:${a.slug}`,
  }));
}

export function resolveProjectAssetUrlFromTokenKey(
  key: string,
  bySlug: Map<string, string>,
  assets?: ProjectAssetLabelRow[]
): string | undefined {
  const direct = bySlug.get(key)?.trim();
  if (direct) return direct;
  if (!assets?.length) return undefined;
  const row = assets.find((a) => a.slug === key || a.name.trim() === key);
  if (!row) return undefined;
  const fromSlug = row.slug?.trim() ? bySlug.get(row.slug.trim())?.trim() : undefined;
  if (fromSlug) return fromSlug;
  /** recovery / Details：仅有 projectAssets[].url、slug map 未建时仍须解析 @资产 */
  return row.url?.trim() || undefined;
}

export function collectProjectAssetUrlsFromPrompt(
  prompt: string,
  bySlug: Map<string, string>,
  assets?: ProjectAssetLabelRow[]
): string[] {
  if (!prompt || !bySlug.size) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { token } of matchAllPromptMediaTokens(prompt, assets)) {
    if (!token.startsWith('@资产:')) continue;
    const key = token.slice('@资产:'.length).trim();
    const url = resolveProjectAssetUrlFromTokenKey(key, bySlug, assets);
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

/** @资产: 后接的资产名/slug（不含空白、@、常见中英文标点，避免「@资产:荒塘，人物」粘连） */
export const PROMPT_ASSET_TOKEN_SUFFIX = String.raw`[^\s@，。；：、,.!?／/与和及]+`;

/** 创意描述中可扫描的 @ 媒体标记（各生图/生视频模型共用） */
export const PROMPT_MEDIA_TOKEN_RE = new RegExp(
  `@资产:\s*${PROMPT_ASSET_TOKEN_SUFFIX}|@图片\d+|@图片(?!\d)|@主图|@主视频|@主体|@首帧图|@尾帧图|@视频\d+|@视频(?!\d)|@音频\d+|@音频(?!\d)`,
  'g'
);

const NON_ASSET_PROMPT_TOKEN_RE =
  /^@图片\d+|@图片(?!\d)|@主图|@主视频|@主体|@首帧图|@尾帧图|@视频\d+|@视频(?!\d)|@音频\d+|@音频(?!\d)/;

/** 已知资产库条目时优先最长前缀匹配，避免扫描无空格时「@资产:白泽走向」粘连 */
export function matchLongestProjectAssetKey(
  text: string,
  projectAssets?: ProjectAssetLabelRow[]
): string | null {
  if (!text || !projectAssets?.length) return null;
  const keys = new Set<string>();
  for (const a of projectAssets) {
    const name = a.name?.trim();
    const slug = a.slug?.trim();
    if (name) keys.add(name);
    if (slug) keys.add(slug);
  }
  const sorted = [...keys].sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (text.startsWith(key)) return key;
  }
  return null;
}

/** 按出现顺序提取创意描述中的 @ 媒体 token（@资产: 支持无空格扫描后的边界识别） */
export function matchAllPromptMediaTokens(
  prompt: string,
  projectAssets?: ProjectAssetLabelRow[]
): Array<{ token: string; index: number }> {
  if (!prompt) return [];
  const matches: Array<{ token: string; index: number }> = [];
  let i = 0;
  while (i < prompt.length) {
    if (prompt[i] !== '@') {
      i += 1;
      continue;
    }
    const rest = prompt.slice(i);
    if (rest.startsWith('@资产:')) {
      let j = i + '@资产:'.length;
      while (j < prompt.length && /\s/.test(prompt[j])) j += 1;
      const tail = prompt.slice(j);
      const known = matchLongestProjectAssetKey(tail, projectAssets);
      if (known) {
        matches.push({ token: `@资产:${known}`, index: i });
        i = j + known.length;
        continue;
      }
      i += 1;
      continue;
    }
    const m = rest.match(NON_ASSET_PROMPT_TOKEN_RE);
    if (m?.[0]) {
      matches.push({ token: m[0], index: i });
      i += m[0].length;
      continue;
    }
    i += 1;
  }
  return matches;
}

/**
 * 复制创意描述为纯文本：去掉 @主图/@图片n/@资产:名称 等媒体引用 token，保留其余正文。
 * 优先用项目素材库精确匹配 @资产: 边界，再兜底 PROMPT_MEDIA_TOKEN_RE。
 */
export function stripPromptMediaTokensForPlainCopy(
  prompt: string,
  projectAssets?: ProjectAssetLabelRow[]
): string {
  if (!prompt) return '';
  const matches = matchAllPromptMediaTokens(prompt, projectAssets);
  let out = prompt;
  for (const { token, index } of [...matches].sort((a, b) => b.index - a.index)) {
    out = out.slice(0, index) + out.slice(index + token.length);
  }
  out = out.replace(PROMPT_MEDIA_TOKEN_RE, '');
  return out;
}

/**
 * 去掉误写的 @资产: 前缀：仅保留资产库已知名称；未知长串还原为普通正文（避免整句高亮）。
 */
export function repairPromptInvalidAssetTokens(
  prompt: string,
  projectAssets?: ProjectAssetLabelRow[]
): string {
  if (!prompt?.trim() || !projectAssets?.length) return prompt;
  let out = prompt;
  const pieces: Array<{ start: number; end: number; replacement: string }> = [];
  let i = 0;
  while (i < out.length) {
    if (out.slice(i, i + '@资产:'.length) !== '@资产:') {
      i += 1;
      continue;
    }
    const start = i;
    let j = i + '@资产:'.length;
    while (j < out.length && /\s/.test(out[j])) j += 1;
    const tail = out.slice(j);
    const known = matchLongestProjectAssetKey(tail, projectAssets);
    if (known) {
      const end = j + known.length;
      const expected = `@资产:${known}`;
      const actual = out.slice(start, end);
      if (actual !== expected) pieces.push({ start, end, replacement: expected });
      i = end;
      continue;
    }
    const greedy = tail.match(new RegExp(`^${PROMPT_ASSET_TOKEN_SUFFIX}`));
    if (greedy?.[0]) {
      pieces.push({ start, end: j + greedy[0].length, replacement: greedy[0] });
      i = j + greedy[0].length;
      continue;
    }
    i += 1;
  }
  for (const p of pieces.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, p.start) + p.replacement + out.slice(p.end);
  }
  return out;
}

function omniHasVideoForTab(data: NodeData, tab: 'multi' | 'instruction' | 'video'): boolean {
  if (tab === 'instruction') {
    return Boolean(data.klingOmniInstructionVideoPreviewUrl || data.klingOmniInstructionVideoUrl);
  }
  if (tab === 'video') {
    return Boolean(data.klingOmniVideoPreviewUrl || data.klingOmniVideoUrl);
  }
  return false;
}

function omniRefImagesField(
  tab: 'multi' | 'instruction' | 'video'
): 'klingOmniMultiReferenceImages' | 'klingOmniInstructionReferenceImages' | 'klingOmniVideoReferenceImages' {
  if (tab === 'multi') return 'klingOmniMultiReferenceImages';
  if (tab === 'instruction') return 'klingOmniInstructionReferenceImages';
  return 'klingOmniVideoReferenceImages';
}

/** 扫描后：把创意描述中已 @ 到的库内素材补进当前面板参考数组（与展示格一致） */
export function buildPromptReferencedAssetsPanelPatch(
  data: NodeData,
  projectAssets?: ProjectAssetLabelRow[]
): Partial<NodeData> | undefined {
  if (!projectAssets?.length) return undefined;
  const ctx = buildPromptMediaRefContextForRun(data, projectAssets);
  const prompt = getNodeInspectorPromptText(data);
  const bySlug = buildProjectAssetSlugUrlMap(projectAssets);
  const urlsFromPrompt = collectProjectAssetUrlsFromPrompt(prompt, bySlug, projectAssets);
  if (!urlsFromPrompt.length) return undefined;

  const patch: Partial<NodeData> = {};
  let labels = [...(data.referenceImageLabels || [])];

  const appendUrls = (
    field:
      | 'referenceImages'
      | 'klingOmniMultiReferenceImages'
      | 'klingOmniInstructionReferenceImages'
      | 'klingOmniVideoReferenceImages',
    max: number
  ) => {
    let current = [...(data[field] || [])];
    let nextLabels = alignReferenceImageLabels(current, labels);
    let fieldChanged = false;
    for (const url of urlsFromPrompt) {
      if (current.length >= max) break;
      const name = lookupProjectAssetDisplayName(url, projectAssets) || '';
      const next = tryAppendReferenceImageWithLabel(current, nextLabels, url, name);
      if (!next.added) continue;
      current = next.referenceImages;
      nextLabels = next.referenceImageLabels;
      fieldChanged = true;
    }
    if (!fieldChanged) return;
    patch[field] = current.slice(0, max);
    labels = nextLabels;
    patch.referenceImageLabels = labels.slice(0, Math.max(max, 9));
  };

  if (ctx.isKelingOmni) {
    const tab = (ctx.klingOmniTab || 'multi') as 'multi' | 'instruction' | 'video' | 'frames';
    if (tab === 'frames') return undefined;
    const max = tab === 'multi' ? 7 : omniHasVideoForTab(data, tab) ? 4 : 7;
    appendUrls(omniRefImagesField(tab), max);
  } else if (ctx.isSeedance20 && ctx.seedanceMode === 'reference') {
    appendUrls('referenceImages', 14);
  } else if (ctx.isNano || ctx.isImage2) {
    appendUrls('referenceImages', ctx.isImage2 ? 3 : 14);
  }

  return Object.keys(patch).length > 0 ? patch : undefined;
}

const SEEDANCE_PROMPT_TOKEN_RE = PROMPT_MEDIA_TOKEN_RE;

export type ReferencedCollectedImageRef = {
  token: string;
  url: string;
  label: string;
  refImageSlotIndex?: number;
  /** 首尾帧模型：0=首帧，1=尾帧（@资产:名 与 @首帧图/@尾帧图 对齐） */
  refFrameIndex?: 0 | 1;
  /** 与 referenceImages 数组下标一致，从 1 开始（对应 [图1]） */
  imageIndex: number;
};

/** @deprecated 使用 ReferencedCollectedImageRef */
export type SeedanceCollectedImageRef = ReferencedCollectedImageRef;

export type ReferencedCollectedVideoRef = {
  token: string;
  url: string;
  label: string;
  videoIndex: number;
};

/** @deprecated 使用 ReferencedCollectedVideoRef */
export type SeedanceCollectedVideoRef = ReferencedCollectedVideoRef;

export type ReferencedCollectedAudioRef = {
  token: string;
  url: string;
  label: string;
  audioIndex: number;
};

/** @deprecated 使用 ReferencedCollectedAudioRef */
export type SeedanceCollectedAudioRef = ReferencedCollectedAudioRef;

export type ReferencedMediaPlan = {
  images: ReferencedCollectedImageRef[];
  videos: ReferencedCollectedVideoRef[];
  audios: ReferencedCollectedAudioRef[];
};

/** @deprecated 使用 ReferencedMediaPlan */
export type SeedanceReferencedMediaPlan = ReferencedMediaPlan;

export function buildReferenceIndexOptionsFromPlan(
  plan: ReferencedMediaPlan,
  base?: ResolvePromptPlaceholdersOptions
): ResolvePromptPlaceholdersOptions {
  const referenceImageIndexByToken = new Map<string, number>();
  const referenceVideoIndexByToken = new Map<string, number>();
  const referenceAudioIndexByToken = new Map<string, number>();
  for (const img of plan.images) {
    referenceImageIndexByToken.set(img.token, img.imageIndex);
  }
  for (const v of plan.videos) {
    referenceVideoIndexByToken.set(v.token, v.videoIndex);
  }
  for (const a of plan.audios) {
    referenceAudioIndexByToken.set(a.token, a.audioIndex);
  }
  return {
    ...base,
    referenceImageIndexByToken,
    referenceVideoIndexByToken,
    referenceAudioIndexByToken,
    seedanceReferenceImageIndexByToken: referenceImageIndexByToken,
    seedanceReferenceVideoIndexByToken: referenceVideoIndexByToken,
    seedanceReferenceAudioIndexByToken: referenceAudioIndexByToken,
  };
}

/** 与 buildPromptMediaRefLabels 一致：当前模型/tab 下的参考图数组（0-based 槽位） */
export function referenceImageUrlsForContext(data: NodeData, ctx: PromptMediaRefContext): string[] {
  const persisted = persistedReferenceImagesForRun(data);
  /** 勿用 getCanonicalInspectorPromptText：其 remap 会调用本函数，造成循环 */
  const prompt = getNodeInspectorPromptText(data) || String(data.prompt || '');
  if (ctx.isKelingOmni) {
    const tab = ctx.klingOmniTab;
    let panel: string[] = [];
    if (tab === 'multi') panel = data.klingOmniMultiReferenceImages || [];
    else if (tab === 'instruction') panel = data.klingOmniInstructionReferenceImages || [];
    else if (tab === 'video') panel = data.klingOmniVideoReferenceImages || [];
    return mergePanelWithPersistedRefsIfPromptNeeds(panel, persisted, prompt, data.imagePreview);
  }
  if (ctx.isJimeng) {
    const f = data.firstFrameImageUrl || data.firstFrameImage;
    const panel = f ? [f] : [];
    return mergePanelWithPersistedRefsIfPromptNeeds(panel, persisted, prompt, data.imagePreview);
  }
  return mergePanelWithPersistedRefsIfPromptNeeds(
    data.referenceImages,
    persisted,
    prompt,
    data.imagePreview
  );
}

/** 与 @视频n 标签顺序一致（Omni 指令/视频 tab 含独立视频槽） */
export function referenceVideoUrlsInLabelOrder(data: NodeData, ctx: PromptMediaRefContext): string[] {
  const prev = data.imagePreview?.trim();
  if (ctx.isKelingOmni) {
    const tab = ctx.klingOmniTab;
    if (tab === 'multi') {
      const urls: string[] = [];
      for (let i = 0; i < (data.klingOmniMultiReferenceImages || []).length; i++) {
        const url = data.klingOmniMultiReferenceImages![i];
        const resolved = resolveOmniMultiReferenceSlotVideoUrl(data, i, url);
        if (resolved) urls.push(resolved.trim());
        else if (isOmniMixedRefItemVideo(url)) urls.push(url.trim());
      }
      return urls;
    }
    if (tab === 'instruction' || tab === 'video') {
      const imgs =
        tab === 'instruction'
          ? data.klingOmniInstructionReferenceImages || []
          : data.klingOmniVideoReferenceImages || [];
      const videos: string[] = [];
      for (const url of imgs) {
        if (!isOmniMixedRefItemVideo(url)) continue;
        if (prev && isLikelyMainVideoUrl(prev) && isSameMediaUrl(url, prev)) continue;
        videos.push(url.trim());
      }
      const slotUrl = (
        tab === 'instruction'
          ? data.klingOmniInstructionVideoUrl || data.klingOmniInstructionVideoPreviewUrl
          : data.klingOmniVideoUrl || data.klingOmniVideoPreviewUrl
      )?.trim();
      const hasVid = Boolean(slotUrl);
      const slotVideoIsMain =
        (!!prev && isLikelyMainVideoUrl(prev) && isSameMediaUrl(slotUrl, prev)) ||
        (hasVid && promptMentionsMainVideoForNodeData(data));
      if (hasVid && videos.length === 0 && !slotVideoIsMain) {
        videos.push(slotUrl!);
      }
      return videos;
    }
  }
  return (data.referenceMovs || [])
    .map((m) => m?.url?.trim())
    .filter((u): u is string => Boolean(u));
}

function projectAssetMediaPairKey(url: string): string | null {
  const ids = parseProjectAssetIdsFromMediaUrl(url);
  if (!ids) return null;
  return `${ids.projectId}/${ids.assetId}`;
}

/** 底栏展示名与槽内像素一致时，@资产 才可绑定该参考槽（避免「标签夏茉、槽内却是街景 COS」） */
export function panelLabelSlotMatchesAssetLib(
  panelUrl: string | undefined,
  libUrl: string | undefined,
  imagePreview?: string
): boolean {
  const lib = libUrl?.trim();
  const p = panelUrl?.trim();
  if (!lib) return true;
  if (!p) return true;
  const libKey = projectAssetMediaPairKey(lib);
  const slotKey = projectAssetMediaPairKey(p);
  if (libKey && slotKey) return libKey === slotKey;
  if (libKey && !slotKey && /aitop100app-1251510006/i.test(p)) {
    const prevKey = projectAssetMediaPairKey(imagePreview || '');
    if (prevKey && prevKey === libKey) return false;
  }
  return true;
}

/** @资产: 上传/解析用 URL：误拖 blob/aitop 错图时用资产库；面板已换成其它有效 URL 时以面板为准 */
export function resolveProjectAssetUrlForPromptToken(
  panelUrl: string | undefined,
  libUrl: string | undefined
): string | undefined {
  const lib = libUrl?.trim();
  const panel = panelUrl?.trim();
  if (!panel) return lib;
  if (!lib) return panel;
  if (/^blob:/i.test(panel) || /^data:image\//i.test(panel)) {
    const libKey = projectAssetMediaPairKey(lib);
    const slotKey = projectAssetMediaPairKey(panel);
    if (libKey && slotKey && libKey === slotKey) return panel;
    return lib;
  }
  if (/aitop100app-1251510006/i.test(panel)) {
    const libKey = projectAssetMediaPairKey(lib);
    const panelKey = projectAssetMediaPairKey(panel);
    if (libKey && panelKey && libKey === panelKey) return panel;
    return lib;
  }
  return panel;
}

function resolveSeedancePromptTokenMedia(
  token: string,
  data: NodeData,
  ctx: PromptMediaRefContext,
  projectAssetBySlug: Map<string, string>
): { kind: 'image' | 'video' | 'audio'; url: string; label: string; refImageSlotIndex?: number } | null {
  if (token.startsWith('@资产:')) {
    const key = token.slice('@资产:'.length).trim();
    const libUrl = resolveProjectAssetUrlFromTokenKey(
      key,
      projectAssetBySlug,
      ctx.projectAssets
    )?.trim();
    const panelUrls = referenceImageUrlsForContext(data, ctx);
    const panelLabels = data.referenceImageLabels;
    let refImageSlotIndex: number | undefined;
    let panelUrl: string | undefined;
    if (key && panelLabels?.length) {
      for (let i = 0; i < panelLabels.length; i++) {
        if (panelLabels[i]?.trim() !== key) continue;
        const p = panelUrls[i]?.trim();
        if (!p) continue;
        refImageSlotIndex = i;
        panelUrl = p;
        break;
      }
    }
    if (refImageSlotIndex == null && libUrl) {
      const libKey = parseProjectAssetIdsFromMediaUrl(libUrl);
      for (let i = 0; i < panelUrls.length; i++) {
        const p = panelUrls[i]?.trim();
        if (!p) continue;
        const ids = parseProjectAssetIdsFromMediaUrl(p);
        if (ids && libKey && ids.assetId === libKey.assetId) {
          refImageSlotIndex = i;
          panelUrl = p;
          break;
        }
      }
    }
    const url = panelUrl?.trim()
      ? resolveProjectAssetUrlForPromptToken(panelUrl, libUrl)
      : libUrl;
    if (!url) return null;
    const row = ctx.projectAssets?.find(
      (a) => a.slug === key || a.name.trim() === key
    );
    const name = row?.name?.trim() || key;
    return { kind: 'image', url, label: name, refImageSlotIndex };
  }
  if (token === '@主图' || token === '@主体') {
    const url = data.imagePreview?.trim();
    if (!url || isLikelyMainVideoUrl(url)) return null;
    return { kind: 'image', url, label: mainMentionDisplayLabel(data, ctx.projectAssets) };
  }
  if (token === '@主视频') {
    const tab = data.klingOmniTab;
    if (tab === 'instruction' || tab === 'video') {
      const bound = resolveOmniTabBoundVideoUrl(data, tab);
      if (bound) return { kind: 'video', url: bound, label: '主视频' };
    }
    const url = data.imagePreview?.trim();
    if (!url || !isLikelyMainVideoUrl(url)) return null;
    return { kind: 'video', url, label: '主视频' };
  }
  if (token === '@首帧图') {
    const url = effectiveFirstFramePanelUrl(data, ctx)?.trim();
    if (!url || isLikelyMainVideoUrl(url)) return null;
    return {
      kind: 'image',
      url,
      label: frameMentionDisplayLabel(
        data.firstFrameImageUrl || data.firstFrameImage
          ? data
          : { ...data, firstFrameImageUrl: url },
        0,
        ctx.projectAssets
      ) || '首帧图',
    };
  }
  if (token === '@尾帧图') {
    const url = (data.lastFrameImageUrl || data.lastFrameImage)?.trim();
    if (!url || isLikelyMainVideoUrl(url)) return null;
    return {
      kind: 'image',
      url,
      label: frameMentionDisplayLabel(data, 1, ctx.projectAssets) || '尾帧图',
    };
  }
  const picOrdMatch = token.match(/^@图片(\d+)$/);
  if (picOrdMatch) {
    const ord = parseInt(picOrdMatch[1], 10);
    const panelUrls = referenceImageUrlsForContext(data, ctx);
    const idx = resolvePictureTokenSlotIndex(
      ord,
      panelUrls,
      data.referenceImageLabels,
      data.imagePreview?.trim()
    );
    if (idx != null) {
      const url = panelUrls[idx]?.trim();
      if (url && !isLikelyMainVideoUrl(url)) {
        const custom = data.referenceImageLabels?.[idx]?.trim();
        const cap =
          custom && !/^图片\d+$/.test(custom) ? custom : `图片${ord}`;
        return { kind: 'image', url, label: cap, refImageSlotIndex: idx };
      }
    }
  }
  const labels = buildPromptMediaRefLabels(data, ctx);
  const alias =
    token === '@图片' ? '@图片1' : token === '@视频' ? '@视频1' : token === '@音频' ? '@音频1' : token;
  const item = findPromptMediaRefItemForToken(labels, token, alias);
  if (!item) return null;
  if (item.kind === 'projectAsset') {
    const key = item.insertText.replace(/^@资产:/, '');
    const libUrl = resolveProjectAssetUrlFromTokenKey(
      key,
      projectAssetBySlug,
      ctx.projectAssets
    )?.trim();
    const idx = item.refImageIndex;
    const panelUrls = referenceImageUrlsForContext(data, ctx);
    let url: string | undefined;
    if (item.refFrameIndex === 0) {
      url = (
        data.firstFrameImageUrl ||
        data.firstFrameImage ||
        (!isLikelyMainVideoUrl(data.imagePreview || '') ? data.imagePreview : undefined)
      )?.trim();
    } else if (item.refFrameIndex === 1) {
      url = (data.lastFrameImageUrl || data.lastFrameImage)?.trim();
    } else if (idx != null) {
      url = resolveProjectAssetUrlForPromptToken(panelUrls[idx]?.trim(), libUrl);
    } else {
      url = resolveProjectAssetUrlForPromptToken(
        data.imagePreview?.trim(),
        libUrl
      );
    }
    url = url || libUrl;
    if (!url || isLikelyMainVideoUrl(url)) return null;
    const cap = item.label.replace(/^素材·/, '') || item.label;
    return { kind: 'image', url, label: cap, refImageSlotIndex: idx };
  }
  if (item.kind === 'image') {
    if (item.refFrameIndex === 0) {
      const url = (
        data.firstFrameImageUrl ||
        data.firstFrameImage ||
        (!isLikelyMainVideoUrl(data.imagePreview || '') ? data.imagePreview : undefined)
      )?.trim();
      if (!url || isLikelyMainVideoUrl(url)) return null;
      return { kind: 'image', url, label: item.label };
    }
    if (item.refFrameIndex === 1) {
      const url = (data.lastFrameImageUrl || data.lastFrameImage)?.trim();
      if (!url || isLikelyMainVideoUrl(url)) return null;
      return { kind: 'image', url, label: item.label };
    }
    const panelUrls = referenceImageUrlsForContext(data, ctx);
    const prev = data.imagePreview?.trim();
    const picOrd = token.match(/^@图片(\d+)$/);
    let idx: number | undefined = item.refImageIndex ?? undefined;
    if (picOrd) {
      const ord = parseInt(picOrd[1], 10);
      const byOrd = resolvePictureTokenSlotIndex(
        ord,
        panelUrls,
        data.referenceImageLabels,
        prev
      );
      if (byOrd == null) return null;
      idx = byOrd;
    }
    const url =
      idx != null ? panelUrls[idx]?.trim() : data.imagePreview?.trim();
    if (!url || isLikelyMainVideoUrl(url)) return null;
    const customCap =
      idx != null ? data.referenceImageLabels?.[idx]?.trim() : undefined;
    const cap =
      customCap && !/^图片\d+$/.test(customCap) ? customCap : item.label;
    return { kind: 'image', url, label: cap, refImageSlotIndex: idx };
  }
  if (item.kind === 'video') {
    const n = parseInt(item.label.replace(/^视频/, ''), 10) || 1;
    const videos = referenceVideoUrlsInLabelOrder(data, ctx);
    const url = videos[n - 1];
    if (!url) return null;
    return { kind: 'video', url, label: item.label };
  }
  if (item.kind === 'audio') {
    const n = parseInt(item.label.replace(/^音频/, ''), 10) || 1;
    const url = data.referenceAudios?.[n - 1]?.url?.trim();
    if (!url) return null;
    return { kind: 'audio', url, label: item.label };
  }
  return null;
}

function normalizeMediaUrlKey(url: string): string {
  return normalizePanelReferenceUrlKey(url);
}

/** plan 去重：同 URL 不同参考槽（@资产:萧逍 等）须分别保留，避免运行后 prune 误删槽 */
function imagePlanEntryDedupeKey(
  url: string,
  refImageSlotIndex?: number
): string {
  const key = normalizeMediaUrlKey(url);
  const ids = parseProjectAssetIdsFromMediaUrl(url);
  const assetPart = ids ? `${ids.projectId}/${ids.assetId}` : key;
  if (refImageSlotIndex != null && refImageSlotIndex >= 0) {
    return `${assetPart}@slot${refImageSlotIndex}`;
  }
  return assetPart;
}

/** 运行展开 prompt：保留 plan 中 @资产 按展示名或 slug 引用的资产行 */
export function filterProjectAssetsForReferencedPlan(
  assets: ProjectAssetLabelRow[] | undefined,
  plan: ReferencedMediaPlan
): ProjectAssetLabelRow[] {
  if (!assets?.length) return [];
  return assets.filter((a) => {
    const name = a.name.trim();
    const slug = a.slug.trim();
    return plan.images.some((e) => {
      if (e.token === `@资产:${slug}` || e.token === `@资产:${name}`) return true;
      if (e.token.startsWith('@资产:')) {
        const key = e.token.slice('@资产:'.length).trim();
        if (key === slug || key === name) return true;
      }
      return e.label === name || e.label === slug;
    });
  });
}

function resolveRefFrameIndexForCollectedToken(
  token: string,
  data: NodeData,
  ctx: PromptMediaRefContext
): 0 | 1 | undefined {
  if (token === '@尾帧图') return 1;
  if (token === '@首帧图') return 0;
  const isFrameModel =
    ctx.isKeling ||
    ctx.isVidu ||
    ctx.isSeedance15 ||
    ctx.isJimeng ||
    (ctx.isSeedance20 && ctx.seedanceMode === 'image');
  if (isFrameModel) {
    if (
      token === '@主图' ||
      token === '@主体' ||
      token === '@图片1' ||
      token === '@图片'
    ) {
      return 0;
    }
    if (token === '@图片2') return 1;
  }
  const labels = buildPromptMediaRefLabels(data, ctx);
  const item = findPromptMediaRefItemForToken(labels, token);
  if (item?.refFrameIndex === 0 || item?.refFrameIndex === 1) {
    return item.refFrameIndex;
  }
  return undefined;
}

function projectAssetsFromSlugMap(
  projectAssetBySlug: Map<string, string>
): ProjectAssetLabelRow[] {
  const out: ProjectAssetLabelRow[] = [];
  for (const [slug, url] of projectAssetBySlug.entries()) {
    const u = String(url || '').trim();
    if (!u) continue;
    const name = slug.trim();
    out.push({ slug: name, name, url: u });
  }
  return out;
}

/**
 * 仅收集创意描述里实际 @ 到的素材，顺序与在正文中的出现顺序一致。
 * 未 @ 的主图/参考槽/资产库条目不会进入上传列表（各模型运行前共用）。
 */
export function collectReferencedMediaFromPrompt(
  prompt: string,
  data: NodeData,
  ctx: PromptMediaRefContext,
  projectAssetBySlug: Map<string, string>,
  projectAssets?: ProjectAssetLabelRow[]
): ReferencedMediaPlan {
  const mergedCtx: PromptMediaRefContext = {
    ...ctx,
    projectAssets: ctx.projectAssets ?? projectAssets,
  };
  if (!mergedCtx.projectAssets?.length && projectAssetBySlug.size) {
    mergedCtx.projectAssets = projectAssetsFromSlugMap(projectAssetBySlug);
  }
  const images: ReferencedCollectedImageRef[] = [];
  const videos: ReferencedCollectedVideoRef[] = [];
  const audios: ReferencedCollectedAudioRef[] = [];
  if (!prompt?.trim()) return { images, videos, audios };

  const matches = matchAllPromptMediaTokens(prompt, mergedCtx.projectAssets);

  const seenImageKeys = new Set<string>();
  const seenVideoKeys = new Set<string>();
  const seenAudioKeys = new Set<string>();
  const seenTokens = new Set<string>();

  for (const { token } of matches) {
    if (seenTokens.has(token)) continue;
    seenTokens.add(token);
    const resolved = resolveSeedancePromptTokenMedia(token, data, mergedCtx, projectAssetBySlug);
    if (!resolved) continue;
    const key = normalizeMediaUrlKey(resolved.url);
    if (resolved.kind === 'image') {
      const dedupeKey = imagePlanEntryDedupeKey(resolved.url, resolved.refImageSlotIndex);
      if (seenImageKeys.has(dedupeKey)) continue;
      seenImageKeys.add(dedupeKey);
      images.push({
        token,
        url: resolved.url,
        label: resolved.label,
        refImageSlotIndex: resolved.refImageSlotIndex,
        refFrameIndex: resolveRefFrameIndexForCollectedToken(token, data, mergedCtx),
        imageIndex: images.length + 1,
      });
    } else if (resolved.kind === 'video') {
      if (seenVideoKeys.has(key)) continue;
      seenVideoKeys.add(key);
      videos.push({
        token,
        url: resolved.url,
        label: resolved.label,
        videoIndex: videos.length + 1,
      });
    } else if (resolved.kind === 'audio') {
      if (seenAudioKeys.has(key)) continue;
      seenAudioKeys.add(key);
      audios.push({
        token,
        url: resolved.url,
        label: resolved.label,
        audioIndex: audios.length + 1,
      });
    }
  }

  const maxImages = 9;
  return {
    images: images.slice(0, maxImages),
    videos: videos.slice(0, 3),
    audios: audios.slice(0, 3),
  };
}

/** @deprecated 使用 collectReferencedMediaFromPrompt */
export const collectSeedanceReferencedMediaFromPrompt = collectReferencedMediaFromPrompt;

/**
 * 粘贴或一键补全：在出现的素材展示名后追加 @资产:slug（已带 @ 的跳过）。
 */
export function scanPromptAppendProjectAssetTokens(
  text: string,
  assets: Array<{ name: string; slug: string }>
): string {
  if (!text || !assets.length) return text;
  const sorted = [...assets].sort((a, b) => b.name.trim().length - a.name.trim().length);
  let out = text;
  for (const a of sorted) {
    const name = a.name.trim();
    if (name.length < 1) continue;
    const token = `@资产:${a.slug}`;
    let i = 0;
    while (i < out.length) {
      const j = out.indexOf(name, i);
      if (j === -1) break;
      const end = j + name.length;
      const after = out.slice(end);
      if (/^\s*@资产:/.test(after)) {
        i = end;
        continue;
      }
      const beforeCh = j > 0 ? out[j - 1] : '';
      const firstNm = name[0] || '';
      if (/[A-Za-z0-9_]/.test(beforeCh) && /[A-Za-z0-9_]/.test(firstNm)) {
        i = end;
        continue;
      }
      out = out.slice(0, end) + token + out.slice(end);
      i = end + token.length;
    }
  }
  return out;
}

/**
 * 扫描所有引用标记（主图、图片1、视频1、资产等）并在匹配的词后追加 @引用。
 * 例如："使用主图和猫咪" → "使用主图@主图和猫咪@资产:猫咪"
 */
export function scanPromptAppendAllTokens(
  text: string,
  refs: Array<{ label: string; insertText: string; kind?: string }>
): string {
  if (!text || !refs.length) return text;
  // 按标签长度降序，避免短词先匹配导致长词无法匹配
  const sorted = [...refs].sort((a, b) => b.label.length - a.label.length);
  
  // 先找出所有已存在的 @引用位置，避免在其内部重复匹配
  const existingTokenRanges: Array<{ start: number; end: number }> = [];
  const allTokens = sorted.map(r => r.insertText);
  for (const token of allTokens) {
    let idx = 0;
    while ((idx = text.indexOf(token, idx)) !== -1) {
      // 记录token的范围（包括后面的空格）
      const endIdx = idx + token.length;
      existingTokenRanges.push({ start: idx, end: text[endIdx] === ' ' ? endIdx + 1 : endIdx });
      idx = endIdx;
    }
  }
  
  // 找出所有需要追加token的匹配位置
  type MatchPos = { pos: number; name: string; token: string; tokenPrefix: string };
  const matches: MatchPos[] = [];
  const matchedPositions = new Set<number>(); // 避免同一位置重复匹配
  
  for (const ref of sorted) {
    const name = ref.label.trim();
    if (name.length < 1) continue;
    const token = ref.insertText;
    const tokenPrefix = token.includes(':') ? token.split(':')[0] + ':' : token;
    
    let i = 0;
    while (i < text.length) {
      const j = text.indexOf(name, i);
      if (j === -1) break;
      
      const end = j + name.length;
      
      // 检查这个位置是否在其他已匹配的范围内（长词优先）
      let overlap = false;
      for (const pos of matchedPositions) {
        if (j >= pos && j < pos + name.length) {
          overlap = true;
          break;
        }
      }
      if (overlap) {
        i = end;
        continue;
      }
      
      // 检查这个位置是否在已有的 @引用 内部
      const isInExistingToken = existingTokenRanges.some(
        r => (j >= r.start && j < r.end) || (j < r.start && end > r.start)
      );
      if (isInExistingToken) {
        i = end;
        continue;
      }
      
      const after = text.slice(end);
      
      // 检查是否已经存在 @引用
      const hasTokenAlready = after.startsWith(token) || 
        after.startsWith(token + ' ') ||
        (token.includes(':') && after.startsWith(tokenPrefix)) ||
        (token.includes(':') && after.startsWith(tokenPrefix + ' '));
      
      if (hasTokenAlready) {
        i = end;
        continue;
      }
      
      // 检查单词边界
      const beforeCh = j > 0 ? text[j - 1] : '';
      const firstCh = name[0];
      const isBeforeEnglish = /[A-Za-z]/.test(beforeCh);
      const isBeforeDigit = /[0-9]/.test(beforeCh);
      const isFirstChEnglish = /[A-Za-z]/.test(firstCh);
      const isFirstChDigit = /[0-9]/.test(firstCh);
      const isWordBoundaryBefore = !beforeCh || 
        (!(isBeforeEnglish && isFirstChEnglish) && !(isBeforeDigit && isFirstChDigit));
      
      if (!isWordBoundaryBefore) {
        i = end;
        continue;
      }
      
      matches.push({ pos: j, name, token, tokenPrefix });
      matchedPositions.add(j);
      i = end;
    }
  }
  
  // 按位置从后向前排序，这样追加token不会影响前面的位置
  matches.sort((a, b) => b.pos - a.pos);
  
  // 执行追加操作
  let out = text;
  for (const m of matches) {
    const end = m.pos + m.name.length;
    out = out.slice(0, end) + m.token + out.slice(end);
  }
  
  return out;
}

/** 与 NodeInspector「扫描 @素材」一致：读取当前模型对应的创意描述字段 */
export function getNodeInspectorPromptText(data: NodeData): string {
  const model = data.selectedModel || '';
  if (model === '可灵3.0 Omni') {
    const tab = (data.klingOmniTab || 'multi') as 'multi' | 'instruction' | 'video' | 'frames';
    if (tab === 'multi') return data.klingOmniMultiPrompt ?? data.prompt ?? '';
    if (tab === 'instruction') return data.klingOmniInstructionPrompt ?? data.prompt ?? '';
    if (tab === 'video') return data.klingOmniVideoPrompt ?? data.prompt ?? '';
    return data.klingOmniFramesPrompt ?? data.prompt ?? '';
  }
  if (model === 'seedance2.0 (高质量版)' || model === 'seedance2.0 (急速版)') {
    const mode = (data.seedanceGenerationMode || 'text') as 'text' | 'image' | 'reference';
    return data.seedanceTabConfigs?.[mode]?.prompt ?? data.prompt ?? '';
  }
  return data.prompt || '';
}

/** 创意描述是否 @ 到 @主图/@主体（按 collectReferencedMediaFromPrompt，避免 @图片1 等误判） */
export function promptMentionsMainImageForNodeData(data: Partial<NodeData>): boolean {
  const d = data as NodeData;
  const prompt = getNodeInspectorPromptText(d).trim();
  if (!prompt) return false;
  const plan = collectReferencedMediaFromPrompt(
    prompt,
    d,
    buildPromptMediaRefContextFromNode(d),
    new Map()
  );
  return plan.images.some((e) => e.token === '@主图' || e.token === '@主体');
}

/** 创意描述是否含图片类 @ token 字面量（不依赖资产库能否 resolve；导出 JSON / 刷新无 projectAssets 时仍须为 true） */
export function promptTextHasImageMediaMention(prompt: string | undefined): boolean {
  const t = String(prompt || '');
  return (
    /@主图\b|@主体\b/.test(t) ||
    /@图片\d*\b/.test(t) ||
    /@首帧图\b|@尾帧图\b/.test(t) ||
    /@资产:[^\s@]+/.test(t)
  );
}

/** 创意描述是否 @ 到任意图片类引用（@图片n / @资产 / @首帧图 等，不含纯文本） */
export function promptMentionsAnyImageRefForNodeData(data: Partial<NodeData>): boolean {
  const d = data as NodeData;
  const prompt = getNodeInspectorPromptText(d).trim();
  if (!prompt) return false;
  // 纯 @资产:名 在无 projectAssets 时 collect 可能解析不出 plan.images，但仍算「有图片类 @」（§5.7 画布缩略图）
  if (promptTextHasImageMediaMention(prompt)) return true;
  const plan = collectReferencedMediaFromPrompt(
    prompt,
    d,
    buildPromptMediaRefContextFromNode(d),
    new Map()
  );
  return plan.images.length > 0;
}

function isGenericPanelRefCaption(label: string): boolean {
  return /^(图片\d+|主图|主视频|首帧图|尾帧图)$/.test(label.trim());
}

/**
 * 参考槽 → 项目资产 slug（底栏展示名 / 资产库 URL / assetId）。
 * 各模型共用：用于 @图片n → @资产:名称 与 @ 下拉插入。
 */
export function resolveAssetSlugForReferenceSlot(
  slotIndex: number,
  imgs: string[],
  labels: string[] | undefined,
  projectAssets?: ProjectAssetLabelRow[]
): string | undefined {
  const url = String(imgs[slotIndex] || '').trim();
  if (!url || !projectAssets?.length) return undefined;
  const cap = String(labels?.[slotIndex] || '').trim();
  if (cap && !isGenericPanelRefCaption(cap)) {
    const byName = projectAssets.find((a) => a.name.trim() === cap);
    if (byName?.slug) return byName.slug;
    const bySlug = projectAssets.find((a) => a.slug === cap);
    if (bySlug?.slug) return bySlug.slug;
  }
  const fromUrlName = lookupProjectAssetDisplayName(url, projectAssets);
  if (fromUrlName) {
    const row = projectAssets.find((a) => a.name.trim() === fromUrlName);
    if (row?.slug) return row.slug;
  }
  const ids = parseProjectAssetIdsFromMediaUrl(url);
  if (ids) {
    const row = projectAssets.find((a) => {
      const aid = a.url ? parseProjectAssetIdsFromMediaUrl(a.url) : null;
      return aid?.assetId === ids.assetId;
    });
    if (row?.slug) return row.slug;
  }
  return undefined;
}

/** 面板 @图片n / @图片 → 可替换的 @资产:slug（与 buildPromptMediaRefLabels 槽位一致） */
export function buildPromptImageTokenToAssetTokenMap(
  data: NodeData,
  ctx: PromptMediaRefContext,
  projectAssets?: ProjectAssetLabelRow[]
): Map<string, string> {
  const map = new Map<string, string>();
  const assets = projectAssets ?? ctx.projectAssets;
  if (!assets?.length) return map;
  const ctxImgs = referenceImageUrlsForContext(data, ctx);
  const panelImgs = data.referenceImages || [];
  const imgs = ctxImgs.length > 0 ? ctxImgs : panelImgs;
  const labels = data.referenceImageLabels;
  const prev = data.imagePreview?.trim();

  const slotLabelMode: PanelRefSlotLabelMode =
    ctx.isSeedance20 && ctx.seedanceMode === 'reference' ? 'seedanceSlot' : 'panelSlot';

  for (let i = 0; i < imgs.length; i++) {
    const url = String(imgs[i] || '').trim();
    if (!url) continue;
    const slug = resolveAssetSlugForReferenceSlot(i, imgs, labels, assets);
    const ord = refImageOrdinalForSlot(i, imgs, prev);
    const cap =
      String(labels?.[i] || '').trim() ||
      panelReferenceSlotLabel(i, imgs, prev, slotLabelMode);

    if (!slug) {
      /** 仅拖入、未入库：保留 @图片n，勿 remap 成其它槽的资产 */
      const capPic = cap.match(/^图片(\d+)$/);
      if (capPic) {
        map.set(`@图片${capPic[1]}`, `@图片${capPic[1]}`);
      } else if (ord >= 1) {
        map.set(`@图片${ord}`, `@图片${ord}`);
      }
      map.set(`@图片${i + 1}`, `@图片${i + 1}`);
      continue;
    }

    const assetTok = buildProjectAssetPromptToken(slug, assets);
    map.set(`@图片${i + 1}`, assetTok);
    if (ord >= 1) map.set(`@图片${ord}`, assetTok);
  }

  const items = buildPromptMediaRefLabels(data, { ...ctx, projectAssets: assets });
  for (const item of items) {
    if (item.kind !== 'image' || item.refImageIndex == null) continue;
    const slug = resolveAssetSlugForReferenceSlot(
      item.refImageIndex,
      imgs,
      labels,
      assets
    );
    if (slug) map.set(item.insertText, buildProjectAssetPromptToken(slug, assets));
  }
  /** 仅匹配裸 @图片，不能吃掉 @图片3 等（remap 时用 (?!\d)） */
  const img1Tok = map.get('@图片1');
  if (img1Tok) map.set('@图片', img1Tok);

  for (const frameIndex of [0, 1] as const) {
    const slug = resolveAssetSlugForFrameSlot(frameIndex, data, assets);
    if (!slug) continue;
    const cap = frameMentionDisplayLabel(data, frameIndex, assets);
    const generic = frameIndex === 0 ? '首帧图' : '尾帧图';
    if (!cap || cap === generic) continue;
    map.set(frameIndex === 0 ? '@首帧图' : '@尾帧图', buildProjectAssetPromptToken(slug, assets));
  }

  return map;
}

/** 创意描述：可识别的 @首帧图/@尾帧图 → @资产:展示名 */
export function remapPromptFrameTokensToAssetTokens(
  prompt: string,
  data: NodeData,
  projectAssets?: ProjectAssetLabelRow[]
): string {
  if (!prompt?.trim() || !projectAssets?.length) return prompt;
  let out = prompt;
  for (const frameIndex of [0, 1] as const) {
    const slug = resolveAssetSlugForFrameSlot(frameIndex, data, projectAssets);
    if (!slug) continue;
    const cap = frameMentionDisplayLabel(data, frameIndex, projectAssets);
    const generic = frameIndex === 0 ? '首帧图' : '尾帧图';
    if (!cap || cap === generic) continue;
    const tok = buildProjectAssetPromptToken(slug, projectAssets);
    const from = frameIndex === 0 ? '@首帧图' : '@尾帧图';
    out = out.replace(new RegExp(`${escapeRegExpForPromptRepair(from)}(?=[\\s@，。；：、]|$)`, 'g'), tok);
  }
  return out;
}

/** 将创意描述里的 @图片n 换成对应参考槽资产库的 @资产:slug（已是 @资产 的保留） */
export function remapPromptPanelImageTokensToAssetTokens(
  prompt: string,
  data: NodeData,
  ctx?: PromptMediaRefContext,
  projectAssets?: ProjectAssetLabelRow[]
): string {
  if (!prompt?.trim()) return prompt;
  const c: PromptMediaRefContext = {
    ...(ctx ?? buildPromptMediaRefContextFromNode(data)),
    projectAssets: projectAssets ?? ctx?.projectAssets,
  };
  const tokenMap = buildPromptImageTokenToAssetTokenMap(data, c, c.projectAssets);
  if (!tokenMap.size) return prompt;
  let out = prompt;
  const fromTokens = [...tokenMap.keys()].sort((a, b) => b.length - a.length);
  for (const from of fromTokens) {
    const to = tokenMap.get(from);
    if (!to || from === to) continue;
    if (from === '@图片') {
      out = out.replace(/@图片(?!\d)/g, (match, offset, whole) => {
        const after = whole[offset + match.length];
        const spacer = after && !/^[\s@\/，。；：、]/.test(after) ? ' ' : '';
        return to + spacer;
      });
      continue;
    }
    let idx = 0;
    while ((idx = out.indexOf(from, idx)) !== -1) {
      const end = idx + from.length;
      const after = out[end];
      /** @图片3全景 → @资产:slug 全景，避免 slug 与后文汉字粘连导致 @资产 解析失败 */
      const spacer = after && !/^[\s@\/，。；：、]/.test(after) ? ' ' : '';
      out = out.slice(0, idx) + to + spacer + out.slice(end);
      idx += to.length + spacer.length;
    }
  }
  return out;
}

function escapeRegExpForPromptRepair(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 修复「扫描 @素材」误把槽位标签当关键词产生的冗余，如 @主图 白泽 主图 → @资产:白泽。
 */
/** 写入创意描述的 @资产 token：优先用资产库展示名（与 slug 二选一解析） */
export function buildProjectAssetPromptToken(
  slug: string,
  projectAssets?: ProjectAssetLabelRow[]
): string {
  const row = projectAssets?.find((a) => a.slug === slug);
  const label = row?.name?.trim() || slug;
  return `@资产:${label}`;
}

export function remapPromptMainImageToAssetToken(
  prompt: string,
  data: NodeData,
  projectAssets?: ProjectAssetLabelRow[]
): string {
  if (!prompt?.trim() || !projectAssets?.length) return prompt;
  const mainUrl = data.imagePreview?.trim();
  if (!mainUrl || isLikelyMainVideoUrl(mainUrl)) return prompt;
  const cap = mainMentionDisplayLabel(data, projectAssets);
  if (cap === '主图' || cap === '主视频') return prompt;
  const slug = resolveAssetSlugForReferenceSlot(
    0,
    [mainUrl],
    [String(data.imageName || '').trim(), cap].filter(Boolean),
    projectAssets
  );
  if (!slug) return prompt;
  const tok = buildProjectAssetPromptToken(slug, projectAssets);
  let out = prompt;
  /** 中文后无 \\b 词界，用前瞻匹配空白/@/结尾 */
  out = out.replace(/@主图(?=[\s@，。；：、]|$)/g, tok);
  out = out.replace(/@主体(?=[\s@，。；：、]|$)/g, tok);
  return out;
}

export function repairPromptStraySlotLabelDuplicates(
  prompt: string,
  data: NodeData,
  projectAssets?: ProjectAssetLabelRow[]
): string {
  if (!prompt?.trim() || !projectAssets?.length) return prompt;
  let out = prompt;

  const mainUrl = data.imagePreview?.trim();
  if (mainUrl && !isLikelyMainVideoUrl(mainUrl)) {
    const mainSlug = resolveAssetSlugForReferenceSlot(
      0,
      [mainUrl],
      [String(data.imageName || '').trim(), mainMentionDisplayLabel(data, projectAssets)].filter(
        Boolean
      ),
      projectAssets
    );
    if (mainSlug) {
      const tok = buildProjectAssetPromptToken(mainSlug, projectAssets);
      out = out.replace(/@主图\s+[^\s@]+?\s+主图/g, tok);
      out = out.replace(/@主体\s+[^\s@]+?\s+主图/g, tok);
    }
  }

  const applyName = (name: string, slug: string) => {
    const cap = name.trim();
    if (!cap || isGenericPanelRefCaption(cap) || cap.length < 2) return;
    const n = escapeRegExpForPromptRepair(cap);
    const tok = buildProjectAssetPromptToken(slug, projectAssets);
    out = out.replace(new RegExp(`@主图\\s+${n}\\s+主图`, 'g'), tok);
    out = out.replace(new RegExp(`@主体\\s+${n}\\s+主图`, 'g'), tok);
    out = out.replace(new RegExp(`@首帧图\\s+${n}\\s+首帧图`, 'g'), tok);
    out = out.replace(new RegExp(`@尾帧图\\s+${n}\\s+尾帧图`, 'g'), tok);
    out = out.replace(
      new RegExp(`@主图\\s+${n}(?![\\s@])`, 'g'),
      (m, offset, full) => {
        const after = full.slice(offset + m.length);
        if (after.startsWith('@')) return m;
        return tok;
      }
    );
  };

  for (const a of projectAssets) {
    if (a.name && a.slug) applyName(a.name, a.slug);
  }

  const ctx = buildPromptMediaRefContextFromNode(data);
  const ctxImgs = referenceImageUrlsForContext(data, ctx);
  const panelImgs = data.referenceImages || [];
  const imgs = ctxImgs.length > 0 ? ctxImgs : panelImgs;
  const labels = data.referenceImageLabels;
  for (let i = 0; i < imgs.length; i++) {
    const slug = resolveAssetSlugForReferenceSlot(i, imgs, labels, projectAssets);
    if (!slug) continue;
    const cap =
      String(labels?.[i] || '').trim() ||
      lookupProjectAssetDisplayName(String(imgs[i] || ''), projectAssets) ||
      '';
    if (cap) applyName(cap, slug);
  }

  if (mainUrl && !isLikelyMainVideoUrl(mainUrl)) {
    const mainCap = mainMentionDisplayLabel(data, projectAssets);
    const slug = resolveAssetSlugForReferenceSlot(
      0,
      [mainUrl],
      [mainCap],
      projectAssets
    );
    if (slug && mainCap) applyName(mainCap, slug);
  }

  return out;
}

/** 「扫描 @素材」仅匹配资产库展示名，不把 @主图/@图片n 等槽位标签当关键词 */
export function collectPromptAssetScanRefs(
  data: NodeData,
  projectAssetRefItems: PromptMediaRefItem[],
  projectAssets?: ProjectAssetLabelRow[]
): Array<{ label: string; insertText: string }> {
  const ctx = buildPromptMediaRefContextForRun(data, projectAssets);
  const assets = projectAssets ?? ctx.projectAssets ?? [];
  const refs: Array<{ label: string; insertText: string }> = [];
  const seen = new Set<string>();

  const add = (name: string, token: string) => {
    const n = name.trim();
    const t = token.trim();
    if (!n || !t || seen.has(t) || isGenericPanelRefCaption(n)) return;
    seen.add(t);
    refs.push({ label: n, insertText: t });
  };

  for (const item of projectAssetRefItems) {
    if (item.kind !== 'projectAsset') continue;
    const name = item.label.replace(/^素材·/, '').trim();
    const slug = item.insertText.replace(/^@资产:/, '').trim();
    if (name && slug) add(name, buildProjectAssetPromptToken(slug, assets));
  }

  for (const a of assets) {
    if (a.name?.trim() && a.slug?.trim())
      add(a.name, buildProjectAssetPromptToken(a.slug, assets));
  }

  const ctxImgs = referenceImageUrlsForContext(data, ctx);
  const panelImgs = data.referenceImages || [];
  const imgs = ctxImgs.length > 0 ? ctxImgs : panelImgs;
  const labels = data.referenceImageLabels;
  for (let i = 0; i < imgs.length; i++) {
    const slug = resolveAssetSlugForReferenceSlot(i, imgs, labels, assets);
    if (!slug) continue;
    const cap =
      String(labels?.[i] || '').trim() ||
      lookupProjectAssetDisplayName(String(imgs[i] || ''), assets) ||
      '';
    if (cap) add(cap, buildProjectAssetPromptToken(slug, assets));
  }

  for (const frameIndex of [0, 1] as const) {
    const slug = resolveAssetSlugForFrameSlot(frameIndex, data, assets);
    if (!slug) continue;
    const cap = frameMentionDisplayLabel(data, frameIndex, assets);
    const generic = frameIndex === 0 ? '首帧图' : '尾帧图';
    if (cap && cap !== generic) add(cap, buildProjectAssetPromptToken(slug, assets));
  }

  return refs.sort((a, b) => b.label.length - a.label.length);
}

/** 创意描述里过期/失效 @图片n → 与当前面板槽 @ 列表对齐（跳号泛称 + 删槽后残留如 @图片4） */
export function repairPromptPictureOrdinalMismatch(
  prompt: string,
  data: NodeData,
  ctx: PromptMediaRefContext
): string {
  if (!prompt.includes('@图片')) return prompt;
  const items = buildPromptMediaRefLabels(data, ctx);
  const validOrds = new Set<number>();
  for (const it of items) {
    const m = it.insertText.match(/^@图片(\d+)$/);
    if (m) validOrds.add(parseInt(m[1], 10));
  }
  if (validOrds.size === 0) return prompt;

  const imgs = referenceImageUrlsForContext(data, ctx);
  const labels = data.referenceImageLabels || [];
  const preview = data.imagePreview?.trim();
  const validSorted = [...validOrds].sort((a, b) => a - b);
  const maxValid = Math.max(...validOrds);
  const staleToCurrent = new Map<string, string>();

  for (let i = 0; i < imgs.length; i++) {
    const custom = labels[i]?.match(/^图片(\d+)$/);
    if (!custom) continue;
    const staleOrd = parseInt(custom[1], 10);
    const compactOrd = refImageOrdinalForSlot(i, imgs, preview);
    if (
      compactOrd >= 1 &&
      staleOrd !== compactOrd &&
      !validOrds.has(staleOrd) &&
      validOrds.has(compactOrd)
    ) {
      const bySlot = resolvePictureTokenSlotIndex(staleOrd, imgs, labels, preview);
      if (bySlot === i && staleOrd === i + 1) {
        const gapsBefore = leadingGapCountBeforeSlot(imgs, i);
        const nonEmpty = imgs.filter((u) => String(u || '').trim()).length;
        if (!(gapsBefore >= 2 && staleOrd > nonEmpty)) continue;
      }
      staleToCurrent.set(`@图片${staleOrd}`, `@图片${compactOrd}`);
    }
  }

  let out = prompt;
  for (const [from, to] of [...staleToCurrent.entries()].sort(
    (a, b) => b[0].length - a[0].length
  )) {
    out = out.split(from).join(to);
  }

  const orphans = new Set<number>();
  for (const m of out.matchAll(/@图片(\d+)/g)) {
    const ord = parseInt(m[1], 10);
    if (validOrds.has(ord)) continue;
    if (resolvePictureTokenSlotIndex(ord, imgs, labels, preview) != null) continue;
    orphans.add(ord);
  }
  if (!orphans.size) return out;

  for (const badOrd of [...orphans].sort((a, b) => b - a)) {
    const usedValid = new Set<number>();
    for (const m of out.matchAll(/@图片(\d+)/g)) {
      const o = parseInt(m[1], 10);
      if (validOrds.has(o) && o !== badOrd) usedValid.add(o);
    }
    const bySlot = resolvePictureTokenSlotIndex(badOrd, imgs, labels, preview);
    let target: number | undefined;
    if (bySlot != null) {
      const compact = refImageOrdinalForSlot(bySlot, imgs, preview);
      if (compact >= 1 && validOrds.has(compact)) target = compact;
    }
    if (target == null) {
      const unused = validSorted.filter((o) => !usedValid.has(o));
      target = unused.find((o) => o !== badOrd) ?? (badOrd > maxValid ? maxValid : undefined);
    }
    if (target != null && target !== badOrd && validOrds.has(target)) {
      out = out.replace(new RegExp(`@图片${badOrd}(?!\\d)`, 'g'), `@图片${target}`);
    }
  }
  return out;
}

/** @deprecated 使用 repairPromptPictureOrdinalMismatch */
export const repairPromptStalePictureOrdinals = repairPromptPictureOrdinalMismatch;

/** 属性面板打开时：仅修正 @图片n 序号，不做 @资产 规范化 */
export function buildPromptPictureOrdinalRepairPatch(
  data: NodeData,
  projectAssets?: ProjectAssetLabelRow[]
): Partial<NodeData> | undefined {
  const raw = getNodeInspectorPromptText(data);
  const ctx = buildPromptMediaRefContextForRun(data, projectAssets);
  const repaired = repairPromptPictureOrdinalMismatch(raw, data, ctx);
  if (repaired === raw) return undefined;
  return buildNodePromptUpdatePatch(data, repaired);
}

/** 属性面板展示用文案：读当前 tab + 修复误扫描 + 将可识别的 @图片n 规范为 @资产:名称 */
export function getCanonicalInspectorPromptText(
  data: NodeData,
  projectAssets?: ProjectAssetLabelRow[]
): string {
  const raw = getNodeInspectorPromptText(data);
  const ctx = buildPromptMediaRefContextForRun(data, projectAssets);
  let step = repairPromptPictureOrdinalMismatch(raw, data, ctx);
  step = repairPromptStraySlotLabelDuplicates(step, data, projectAssets);
  step = remapPromptMainImageToAssetToken(step, data, projectAssets);
  step = remapPromptFrameTokensToAssetTokens(step, data, projectAssets);
  step = remapPromptPanelImageTokensToAssetTokens(step, data, ctx, projectAssets);
  return step;
}

/**
 * 运行 / 分镜生成前：同步顶层 prompt 与分 tab 文案，并把 @图片n 写成 @资产:名称。
 * 无变化时返回 undefined。
 */
export function buildCanonicalInspectorPromptPatch(
  data: NodeData,
  projectAssets?: ProjectAssetLabelRow[]
): Partial<NodeData> | undefined {
  const canonical = getCanonicalInspectorPromptText(data, projectAssets);
  const raw = getNodeInspectorPromptText(data);
  if (canonical === raw) return undefined;
  return buildNodePromptUpdatePatch(data, canonical);
}

/** 与 NodeInspector setPromptByContext 一致：写入当前模型对应的创意描述字段 */
export function buildNodePromptUpdatePatch(data: NodeData, prompt: string): Partial<NodeData> {
  const model = data.selectedModel || '';
  if (model === '可灵3.0 Omni') {
    const tab = (data.klingOmniTab || 'multi') as 'multi' | 'instruction' | 'video' | 'frames';
    const patch: Partial<NodeData> = { prompt };
    if (tab === 'multi') patch.klingOmniMultiPrompt = prompt;
    else if (tab === 'instruction') patch.klingOmniInstructionPrompt = prompt;
    else if (tab === 'video') patch.klingOmniVideoPrompt = prompt;
    else patch.klingOmniFramesPrompt = prompt;
    return patch;
  }
  if (model === 'seedance2.0 (高质量版)' || model === 'seedance2.0 (急速版)') {
    const mode = (data.seedanceGenerationMode || 'text') as 'text' | 'image' | 'reference';
    const tabs = { ...(data.seedanceTabConfigs || {}) };
    const cur = { ...(tabs[mode] || {}) };
    cur.prompt = prompt;
    tabs[mode] = cur;
    return { prompt, seedanceTabConfigs: tabs };
  }
  return { prompt };
}

/**
 * 与 NodeInspector「扫描 @素材」按钮相同：在创意描述中为素材名/展示名补全 @引用 token。
 */
export function scanPromptAppendMediaTokensForNode(
  data: NodeData,
  projectAssetRefItems: PromptMediaRefItem[],
  promptText?: string,
  projectAssets?: ProjectAssetLabelRow[]
): string {
  const text = promptText ?? getNodeInspectorPromptText(data);
  if (!text.trim()) return text;

  const ctx = buildPromptMediaRefContextForRun(data, projectAssets);
  const refs = collectPromptAssetScanRefs(data, projectAssetRefItems, projectAssets);
  if (!refs.length) return text;
  let out = scanPromptAppendAllTokens(text, refs);
  out = repairPromptStraySlotLabelDuplicates(out, data, projectAssets);
  out = remapPromptMainImageToAssetToken(out, data, projectAssets);
  out = remapPromptPanelImageTokensToAssetTokens(out, data, ctx, projectAssets);
  out = repairPromptInvalidAssetTokens(out, projectAssets);
  return out;
}

/** 「扫描 @素材」：补全创意描述 token + 修复无效 @资产 + 同步面板参考格 */
export function buildScanPromptAndPanelPatch(
  data: NodeData,
  projectAssetRefItems: PromptMediaRefItem[],
  rawPrompt: string,
  projectAssets?: ProjectAssetLabelRow[]
): Partial<NodeData> | undefined {
  const scanned = scanPromptAppendMediaTokensForNode(
    data,
    projectAssetRefItems,
    rawPrompt,
    projectAssets
  );
  const promptPatch = buildNodePromptUpdatePatch(data, scanned);
  const merged = { ...data, ...promptPatch };
  const panelPatch = buildPromptReferencedAssetsPanelPatch(merged, projectAssets);
  const patch = { ...promptPatch, ...panelPatch };
  const promptChanged = scanned !== rawPrompt;
  const panelChanged = Boolean(panelPatch && Object.keys(panelPatch).length > 0);
  if (!promptChanged && !panelChanged) return undefined;
  return patch;
}

/** 写入创意描述并自动执行「扫描 @素材」（分镜表批量建节点等场景） */
export function buildScannedNodePromptPatch(
  data: NodeData,
  projectAssetRefItems: PromptMediaRefItem[],
  rawPrompt: string,
  projectAssets?: ProjectAssetLabelRow[]
): Partial<NodeData> {
  const patch = buildScanPromptAndPanelPatch(data, projectAssetRefItems, rawPrompt, projectAssets);
  if (patch) return patch;
  return buildNodePromptUpdatePatch(data, rawPrompt);
}

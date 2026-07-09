import type { NodeData } from '../types';
import { IMAGE2_MAX_API_IMAGES } from './image2Model';
import {
  isDuplicateOfMainImagePreview,
  resolvePictureTokenSlotIndex,
  resolvePromptMainImagePreviewForRefs,
} from './promptMediaRefs';
import {
  buildPanelReferenceDisplayEntries,
  dedupePanelReferenceDisplayEntries,
  type ProjectAssetLabelRow,
} from './referenceImageSlotLabels';

export { IMAGE2_MAX_API_IMAGES as IMAGE2_MAX_PANEL_SLOTS };

function image2HasMainInGrid(
  data: Pick<NodeData, 'imagePreview' | 'panelMainSlotVisible' | 'panelMainImageUrl' | 'imageLocalRef'>
): boolean {
  const backup = String(data.panelMainImageUrl || '').trim();
  if (backup && !/^data:video\//i.test(backup) && !/\.(mov|mp4|webm|avi|mkv)(\?|$)/i.test(backup)) {
    return true;
  }
  if (data.panelMainSlotVisible === false) {
    return Boolean(String(data.imageLocalRef || '').trim());
  }
  const p = String(data.imagePreview || '').trim();
  if (!p) return false;
  if (/^data:video\//i.test(p) || /\.(mov|mp4|webm|avi|mkv)(\?|$)/i.test(p)) return false;
  return true;
}

/** 有主图格时参考图最多 3 张，否则 4 张（与 API image[] 上限一致） */
export function image2MaxReferenceSlots(
  data: Pick<NodeData, 'imagePreview' | 'panelMainSlotVisible' | 'panelMainImageUrl'>
): number {
  return image2HasMainInGrid(data) ? IMAGE2_MAX_API_IMAGES - 1 : IMAGE2_MAX_API_IMAGES;
}

/**
 * image2 多图参考格展示：用槽位原始 URL（勿用资产库替换 URL），
 * 且主图已单独占一格时跳过「referenceImages 里误写的与主图重复的首项」（仍保留仅一张同 URL 的 @主图+@图片1 场景）。
 */
export function buildImage2PanelDisplayEntries(
  data: Pick<
    NodeData,
    | 'imagePreview'
    | 'panelMainImageUrl'
    | 'panelMainSlotVisible'
    | 'referenceImages'
    | 'referenceImageLabels'
  >,
  projectAssets?: ProjectAssetLabelRow[]
): Array<{ url: string; slotIndex: number }> {
  const refs = data.referenceImages || [];
  const base = buildPanelReferenceDisplayEntries(refs, {
    imagePreview: data.imagePreview,
    dedupeAgainstMain: false,
    referenceImageLabels: data.referenceImageLabels,
    projectAssets,
  });
  let entries = dedupePanelReferenceDisplayEntries(
    base,
    data.referenceImageLabels,
    projectAssets
  ).map((e) => ({
    slotIndex: e.slotIndex,
    url: String(refs[e.slotIndex] || '').trim() || e.url,
  }));

  if (image2HasMainInGrid(data)) {
    const main = resolvePromptMainImagePreviewForRefs(data) || '';
    const dupSlots = new Set(
      entries
        .filter((e) => isDuplicateOfMainImagePreview(refs[e.slotIndex], main))
        .map((e) => e.slotIndex)
    );
    const hasOther = entries.some((e) => !dupSlots.has(e.slotIndex));
    if (hasOther && dupSlots.size > 0) {
      entries = entries.filter((e) => !dupSlots.has(e.slotIndex));
    }
  }

  return entries.filter((e) => Boolean(e.url));
}

/**
 * 将 referenceImages 压紧为与面板可见格一致的有序列表，去掉「删格后仍留在数组里的隐藏项」。
 */
export function compactImage2PanelReferences(
  data: Pick<
    NodeData,
    | 'imagePreview'
    | 'panelMainImageUrl'
    | 'panelMainSlotVisible'
    | 'referenceImages'
    | 'referenceImageLabels'
  >
): { referenceImages: string[]; referenceImageLabels: string[] } {
  const maxRefs = image2MaxReferenceSlots(data);
  const prev = resolvePromptMainImagePreviewForRefs(data);
  const entries = buildPanelReferenceDisplayEntries(data.referenceImages, {
    imagePreview: prev,
    // 展示层不去重主图；数据层由下方 image2HasMainInGrid 分支移除与主图同 URL 的首槽
    // （与 image2-panel-refs-test「压紧时去掉主图重复首槽」一致）
    dedupeAgainstMain: false,
    referenceImageLabels: data.referenceImageLabels,
  }).slice(0, maxRefs);
  const referenceImages: string[] = [];
  const referenceImageLabels: string[] = [];
  for (const { slotIndex } of entries) {
    referenceImages.push(String(data.referenceImages?.[slotIndex] || '').trim());
    referenceImageLabels.push(String(data.referenceImageLabels?.[slotIndex] || '').trim());
  }
  const main = resolvePromptMainImagePreviewForRefs(data);
  if (image2HasMainInGrid(data) && referenceImages.length > 1 && main) {
    while (
      referenceImages.length > 1 &&
      isDuplicateOfMainImagePreview(referenceImages[0], main)
    ) {
      referenceImages.shift();
      referenceImageLabels.shift();
    }
  }
  return {
    referenceImages: referenceImages.slice(0, maxRefs),
    referenceImageLabels: referenceImageLabels.slice(0, maxRefs),
  };
}

/** 与 compactImage2PanelReferences 结果对齐的 localRefs（按 URL 首次匹配槽位） */
export function compactImage2PanelLocalRefs(
  data: Pick<
    NodeData,
    | 'imagePreview'
    | 'panelMainImageUrl'
    | 'panelMainSlotVisible'
    | 'referenceImages'
    | 'referenceImageLabels'
    | 'referenceImageLocalRefs'
  >
): string[] {
  const compacted = compactImage2PanelReferences(data);
  const refs = data.referenceImages || [];
  const localRefs = data.referenceImageLocalRefs || [];
  const used = new Set<number>();
  return compacted.referenceImages.map((url) => {
    const target = String(url || '').trim();
    for (let i = 0; i < refs.length; i++) {
      if (used.has(i)) continue;
      if (String(refs[i] || '').trim() === target) {
        used.add(i);
        return String(localRefs[i] || '').trim();
      }
    }
    return '';
  });
}

/** 按面板展示下标移除 image2 参考图（同步压紧 referenceImages / labels / localRefs） */
export function removeImage2PanelReferenceAtDisplaySlot(
  data: Pick<
    NodeData,
    | 'imagePreview'
    | 'panelMainImageUrl'
    | 'panelMainSlotVisible'
    | 'referenceImages'
    | 'referenceImageLabels'
    | 'referenceImageLocalRefs'
  >,
  displayRefSlotIdx: number,
  projectAssets?: ProjectAssetLabelRow[]
): {
  referenceImages: string[];
  referenceImageLabels: string[];
  referenceImageLocalRefs: string[];
  removedLocalRef?: string;
  removedSlotIndex: number;
} | undefined {
  const entries = buildImage2PanelDisplayEntries(data, projectAssets);
  const entry = entries[displayRefSlotIdx];
  if (!entry) return undefined;
  const slotIndex = entry.slotIndex;
  const refs = [...(data.referenceImages || [])];
  const labels = [...(data.referenceImageLabels || [])];
  const localRefs = [...(data.referenceImageLocalRefs || [])];
  while (labels.length < refs.length) labels.push('');
  refs.splice(slotIndex, 1);
  labels.splice(slotIndex, 1);
  const removedLocalRef = String(localRefs[slotIndex] || '').trim() || undefined;
  if (slotIndex >= 0 && slotIndex < localRefs.length) localRefs.splice(slotIndex, 1);
  const merged = {
    ...data,
    referenceImages: refs,
    referenceImageLabels: labels,
    referenceImageLocalRefs: localRefs,
  };
  const compacted = compactImage2PanelReferences(merged);
  return {
    referenceImages: compacted.referenceImages,
    referenceImageLabels: compacted.referenceImageLabels,
    referenceImageLocalRefs: compactImage2PanelLocalRefs(merged),
    removedLocalRef,
    removedSlotIndex: slotIndex,
  };
}

export function image2PanelRefsPatchIfChanged(
  data: Pick<
    NodeData,
    | 'imagePreview'
    | 'panelMainImageUrl'
    | 'panelMainSlotVisible'
    | 'referenceImages'
    | 'referenceImageLabels'
  >
): Partial<Pick<NodeData, 'referenceImages' | 'referenceImageLabels'>> | undefined {
  const next = compactImage2PanelReferences(data);
  const prevRefs = data.referenceImages || [];
  const prevLabels = data.referenceImageLabels || [];
  const sameRefs =
    prevRefs.length === next.referenceImages.length &&
    prevRefs.every((u, i) => u === next.referenceImages[i]);
  const sameLabels =
    prevLabels.length === next.referenceImageLabels.length &&
    prevLabels.every((l, i) => (l || '') === (next.referenceImageLabels[i] || ''));
  if (sameRefs && sameLabels) return undefined;
  return next;
}

/** 按 UI 参考格下标写入/覆盖（0-based；有主图格时不含主图） */
export function patchImage2ReferenceAtRefSlot(
  data: Pick<
    NodeData,
    | 'imagePreview'
    | 'panelMainImageUrl'
    | 'panelMainSlotVisible'
    | 'referenceImages'
    | 'referenceImageLabels'
  >,
  refSlotIndex: number,
  url: string,
  displayName?: string
): Partial<Pick<NodeData, 'referenceImages' | 'referenceImageLabels'>> {
  const compacted = compactImage2PanelReferences(data);
  const refs = [...compacted.referenceImages];
  const labels = [...compacted.referenceImageLabels];
  const maxRefs = image2MaxReferenceSlots(data);
  if (refSlotIndex < 0 || refSlotIndex >= maxRefs) {
    return {
      referenceImages: refs.slice(0, maxRefs),
      referenceImageLabels: labels.slice(0, maxRefs),
    };
  }
  refs[refSlotIndex] = url;
  labels[refSlotIndex] = String(displayName || '').trim();
  return {
    referenceImages: refs.slice(0, maxRefs),
    referenceImageLabels: labels.slice(0, maxRefs),
  };
}

/** 主图格已展示时：清空 referenceImages 里与 imagePreview 同素材的误写槽（保留下标） */
export function stripImage2MainPreviewDuplicateSlots(
  data: Pick<
    NodeData,
    | 'imagePreview'
    | 'panelMainImageUrl'
    | 'panelMainSlotVisible'
    | 'referenceImages'
    | 'referenceImageLabels'
  >,
  prompt?: string
): { referenceImages: string[]; referenceImageLabels: string[] } {
  const refs = (data.referenceImages || []).map((u) => String(u || ''));
  const labels = (data.referenceImageLabels || []).map((l) => String(l || ''));
  const main = resolvePromptMainImagePreviewForRefs(data) || '';
  if (!main || !image2HasMainInGrid(data)) {
    return { referenceImages: refs, referenceImageLabels: labels };
  }
  const promptText = String(prompt || '').trim();
  for (let i = 0; i < refs.length; i++) {
    if (!refs[i] || !isDuplicateOfMainImagePreview(refs[i], main)) continue;
    const ord = i + 1;
    if (promptText && !new RegExp(`@图片${ord}(?!\\d)`).test(promptText)) {
      refs[i] = '';
      if (labels[i]?.trim()) labels[i] = '';
      continue;
    }
    if (promptText) {
      const altSlot = resolvePictureTokenSlotIndex(ord, refs, labels, main);
      if (altSlot != null && altSlot !== i) {
        refs[i] = '';
        if (labels[i]?.trim()) labels[i] = '';
      }
      continue;
    }
    refs[i] = '';
    if (labels[i]?.trim()) labels[i] = '';
  }
  return { referenceImages: refs, referenceImageLabels: labels };
}

function image2ConfigHasMainSnapshot(
  img2Config: NonNullable<NodeData['modelConfigs']>['image2'] | undefined
): boolean {
  if (!img2Config) return false;
  if (String(img2Config.imageLocalRef || '').trim()) return true;
  return Boolean(String(img2Config.imagePreview || '').trim());
}

/** 切到 image2：有快照则恢复主图+localRef+主图格可见性；无快照则保留节点当前主预览（仅剥离 data:） */
export function image2MainPatchOnModelSwitch(
  img2Config: NonNullable<NodeData['modelConfigs']>['image2'] | undefined,
  current: Pick<
    NodeData,
    'imagePreview' | 'imageName' | 'imageLocalRef' | 'panelMainImageUrl' | 'panelMainSlotVisible'
  >
): Partial<
  Pick<
    NodeData,
    'imagePreview' | 'imageName' | 'imageLocalRef' | 'panelMainImageUrl' | 'panelMainSlotVisible'
  >
> {
  if (image2ConfigHasMainSnapshot(img2Config)) {
    const preview = String(img2Config!.imagePreview || '').trim();
    return {
      imagePreview: preview.startsWith('data:') ? undefined : img2Config!.imagePreview,
      imageName: img2Config!.imageName,
      imageLocalRef: img2Config!.imageLocalRef,
      panelMainImageUrl: img2Config!.panelMainImageUrl,
      ...(Object.prototype.hasOwnProperty.call(img2Config, 'panelMainSlotVisible')
        ? { panelMainSlotVisible: img2Config!.panelMainSlotVisible }
        : {}),
    };
  }
  const curPreview = String(current.imagePreview || '').trim();
  const backup = String(current.panelMainImageUrl || '').trim();
  const patch: Partial<
    Pick<
      NodeData,
      'imagePreview' | 'imageName' | 'imageLocalRef' | 'panelMainImageUrl' | 'panelMainSlotVisible'
    >
  > = {
    imagePreview: curPreview.startsWith('data:') ? undefined : current.imagePreview,
    imageName: current.imageName,
    imageLocalRef: current.imageLocalRef,
  };
  // 无 image2 快照时继承它模型主图：勿沿用 panelMainSlotVisible=false 导致主图格被隐藏
  if (patch.imagePreview || backup) {
    patch.panelMainSlotVisible = undefined;
    if (backup) patch.panelMainImageUrl = current.panelMainImageUrl;
  } else {
    patch.panelMainSlotVisible = current.panelMainSlotVisible;
    patch.panelMainImageUrl = current.panelMainImageUrl;
  }
  return patch;
}

/** 切到首尾帧/参考槽模型时：不继承上一模型的面板参考图，主图 imagePreview 不在此 patch 内 */
export function clearInheritedPanelRefsOnFrameModelSwitch(): Partial<
  Pick<NodeData, 'referenceImages' | 'referenceImageLabels'>
> {
  return { referenceImages: [], referenceImageLabels: undefined };
}

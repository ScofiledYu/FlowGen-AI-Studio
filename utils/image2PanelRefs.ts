import type { NodeData } from '../types';
import { buildPanelReferenceDisplayEntries } from './referenceImageSlotLabels';

function image2HasMainInGrid(data: Pick<NodeData, 'imagePreview' | 'panelMainSlotVisible'>): boolean {
  const p = String(data.imagePreview || '').trim();
  if (!p) return false;
  if (/^data:video\//i.test(p) || /\.(mov|mp4|webm|avi|mkv)(\?|$)/i.test(p)) return false;
  return data.panelMainSlotVisible !== false;
}

/** 有主图格时参考图最多 2 张，否则 3 张（与属性面板格数一致） */
export function image2MaxReferenceSlots(
  data: Pick<NodeData, 'imagePreview' | 'panelMainSlotVisible'>
): number {
  return image2HasMainInGrid(data) ? 2 : 3;
}

/**
 * 将 referenceImages 压紧为与面板可见格一致的有序列表，去掉「删格后仍留在数组里的隐藏项」。
 */
export function compactImage2PanelReferences(
  data: Pick<
    NodeData,
    'imagePreview' | 'panelMainSlotVisible' | 'referenceImages' | 'referenceImageLabels'
  >
): { referenceImages: string[]; referenceImageLabels: string[] } {
  const maxRefs = image2MaxReferenceSlots(data);
  const prev = data.imagePreview?.trim();
  const dedupeAgainstMain = image2HasMainInGrid(data);
  const entries = buildPanelReferenceDisplayEntries(data.referenceImages, {
    imagePreview: prev,
    dedupeAgainstMain,
    referenceImageLabels: data.referenceImageLabels,
  }).slice(0, maxRefs);
  const referenceImages: string[] = [];
  const referenceImageLabels: string[] = [];
  for (const { slotIndex } of entries) {
    referenceImages.push(String(data.referenceImages?.[slotIndex] || '').trim());
    referenceImageLabels.push(String(data.referenceImageLabels?.[slotIndex] || '').trim());
  }
  return { referenceImages, referenceImageLabels };
}

export function image2PanelRefsPatchIfChanged(
  data: Pick<
    NodeData,
    'imagePreview' | 'panelMainSlotVisible' | 'referenceImages' | 'referenceImageLabels'
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
    'imagePreview' | 'panelMainSlotVisible' | 'referenceImages' | 'referenceImageLabels'
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

/** 切到 image2：仅当曾保存过 image2 快照时才覆盖主图，否则保留节点当前主预览 */
export function image2MainPatchOnModelSwitch(
  img2Config: NonNullable<NodeData['modelConfigs']>['image2'] | undefined,
  current: Pick<NodeData, 'imagePreview' | 'imageName' | 'panelMainSlotVisible'>
): Partial<Pick<NodeData, 'imagePreview' | 'imageName' | 'panelMainSlotVisible'>> {
  if (img2Config && 'imagePreview' in img2Config) {
    return {
      imagePreview: img2Config.imagePreview,
      imageName: img2Config.imageName,
      ...(Object.prototype.hasOwnProperty.call(img2Config, 'panelMainSlotVisible')
        ? { panelMainSlotVisible: img2Config.panelMainSlotVisible }
        : {}),
    };
  }
  return {
    imagePreview: current.imagePreview,
    imageName: current.imageName,
    panelMainSlotVisible: current.panelMainSlotVisible,
  };
}

/** 切到首尾帧/参考槽模型时：不继承上一模型的面板参考图，主图 imagePreview 不在此 patch 内 */
export function clearInheritedPanelRefsOnFrameModelSwitch(): Partial<
  Pick<NodeData, 'referenceImages' | 'referenceImageLabels'>
> {
  return { referenceImages: [], referenceImageLabels: undefined };
}

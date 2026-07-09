import type { NodeData } from '../types';

/** 各首尾帧模型在 modelConfigs 中保存的槽位快照 */
export type FrameSlotSnapshot = {
  firstFrameImage?: string;
  lastFrameImage?: string;
  firstFrameImageUrl?: string;
  lastFrameImageUrl?: string;
  firstFrameImageLabel?: string;
  lastFrameImageLabel?: string;
  firstFrameLocalRef?: string;
  lastFrameLocalRef?: string;
};

/** 切换模型时清掉上一模型留在节点顶层的面板媒体（避免 imagePreview 被默认灌进首帧） */
export function clearInheritedPanelMedia(patch: Partial<NodeData>): void {
  patch.imagePreview = undefined;
  patch.imageName = undefined;
  patch.imageLocalRef = undefined;
  patch.referenceImages = [];
  patch.referenceImageLabels = undefined;
  patch.referenceImageLocalRefs = [];
  patch.referenceMovs = [];
  patch.referenceAudios = [];
  patch.panelMainSlotVisible = undefined;
  patch.panelMainImageUrl = undefined;
}

export function snapshotFrameSlotsFromNode(data: NodeData): FrameSlotSnapshot {
  return {
    firstFrameImage: data.firstFrameImage,
    lastFrameImage: data.lastFrameImage,
    firstFrameImageUrl: data.firstFrameImageUrl,
    lastFrameImageUrl: data.lastFrameImageUrl,
    firstFrameImageLabel: data.firstFrameImageLabel,
    lastFrameImageLabel: data.lastFrameImageLabel,
    firstFrameLocalRef: data.firstFrameLocalRef,
    lastFrameLocalRef: data.lastFrameLocalRef,
  };
}

/** 仅写入快照中的首尾帧字段（无快照的键写 undefined，不继承切换前的节点数据） */
export function applyFrameSlotSnapshot(
  patch: Partial<NodeData>,
  snap: FrameSlotSnapshot = {}
): void {
  patch.firstFrameImage = snap.firstFrameImage;
  patch.lastFrameImage = snap.lastFrameImage;
  patch.firstFrameImageUrl = snap.firstFrameImageUrl;
  patch.lastFrameImageUrl = snap.lastFrameImageUrl;
  patch.firstFrameImageLabel = snap.firstFrameImageLabel;
  patch.lastFrameImageLabel = snap.lastFrameImageLabel;
  patch.firstFrameLocalRef = snap.firstFrameLocalRef;
  patch.lastFrameLocalRef = snap.lastFrameLocalRef;
}

/** 切到 Nano Banana 2.0：曾保存过快照则恢复主图预览，否则保留节点当前主图 */
export function nanoBananaMainPatchOnModelSwitch(
  nanoConfig:
    | {
        imagePreview?: string;
        imageName?: string;
        imageLocalRef?: string;
        panelMainImageUrl?: string;
        panelMainSlotVisible?: boolean;
      }
    | undefined,
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
  if (nanoConfig && ('imagePreview' in nanoConfig || nanoConfig.imageLocalRef)) {
    return {
      imagePreview: nanoConfig.imagePreview,
      imageName: nanoConfig.imageName,
      imageLocalRef: nanoConfig.imageLocalRef,
      panelMainImageUrl: nanoConfig.panelMainImageUrl,
      ...(Object.prototype.hasOwnProperty.call(nanoConfig, 'panelMainSlotVisible')
        ? { panelMainSlotVisible: nanoConfig.panelMainSlotVisible }
        : {}),
    };
  }
  return {
    imagePreview: current.imagePreview,
    imageName: current.imageName,
    imageLocalRef: current.imageLocalRef,
    panelMainImageUrl: current.panelMainImageUrl,
    panelMainSlotVisible: current.panelMainSlotVisible,
  };
}

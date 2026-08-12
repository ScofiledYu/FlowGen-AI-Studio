import { NodeType, type GenerationParams, type NodeData } from '../types';
import { isLikelyMainVideoUrl } from './promptMediaRefs';

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

/** 切到 Nano Banana 2.0：曾保存过有效主图快照则恢复主图预览，否则保留节点当前主图 */
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
  // §11.90x：节点处于「运行后未 @主图」状态（panelMainSlotVisible=false 且 imagePreview
  // 已切到首个 @ 参考，见 buildPanelImagePreviewPatchAfterRun §5.7/§10.38）时，主图跟随当前
  // imagePreview（= @ 首个元素），与 seedance/即梦等模型切换分支一致（那些分支不动 imagePreview）。
  // 此时若恢复 Banana 旧快照主图，面板显示的是「面板默认首张图」而非 @ 首个元素
  // （image2-特别.json：应显示 @鸱吻=当前 imagePreview，旧逻辑显示快照里的夏茉）。
  const curPreview = String(current.imagePreview || '').trim();
  if (current.panelMainSlotVisible === false && curPreview && !isLikelyMainVideoUrl(curPreview)) {
    return {
      imagePreview: current.imagePreview,
      imageName: current.imageName,
      // 勿继承上一模型的 IDB 键（模型隔离，防 hydration 把旧主图 blob 灌回 Banana 主图格）
      imageLocalRef: undefined,
      // 勿用上一模型主图备份盖掉首个 @ 参考；主图格直接展示 imagePreview
      panelMainImageUrl: undefined,
      panelMainSlotVisible: undefined,
    };
  }
  // §11.90t：对标 image2 的 image2ConfigHasMainSnapshot——只有快照里 imageLocalRef 或
  // imagePreview 真实非空才算「有主图快照」。旧条件 `'imagePreview' in nanoConfig` 在
  // 保存分支恒写 imagePreview（即使为 undefined）的情况下恒为 true，导致空快照把
  // image2/Omni 拖入后继承来的主图清空（切到 Banana 面板主图丢失）。
  const hasMainSnapshot = Boolean(
    nanoConfig &&
      (String(nanoConfig.imageLocalRef || '').trim() ||
        String(nanoConfig.imagePreview || '').trim())
  );
  if (nanoConfig && hasMainSnapshot) {
    // §11.90q：nanoConfig.imagePreview 为 undefined 但 imageLocalRef 存在时，
    // 勿继承 current.imagePreview（可能是刷新后失效的 blob/data URL），
    // 应置空让后续 hydration 从 imageLocalRef 恢复主图。
    const hasValidSnapshotPreview = nanoConfig.imagePreview !== undefined;
    const restoredPreview = hasValidSnapshotPreview ? nanoConfig.imagePreview : undefined;
    const restoredBackup = nanoConfig.panelMainImageUrl;
    const hasVisibleProp = Object.prototype.hasOwnProperty.call(nanoConfig, 'panelMainSlotVisible');
    let restoredVisible = hasVisibleProp ? nanoConfig.panelMainSlotVisible : undefined;
    // §11.90v：快照带「隐藏主图格」标记（panelMainSlotVisible=false）但快照本身没存
    // panelMainImageUrl 备份时，主图槽将永远无法显示（resolvePanelMainSlotPreviewUrl：
    // 无 backup 且 visible=false → undefined）。典型场景：image2 生图完成后切 Banana，
    // Banana 快照保存时顶层 panelMainImageUrl 恰好为空导致备份字段丢失。
    // 此时 restoredPreview 即主图本身，清除虚假隐藏标记让主图槽直接展示——
    // 与重新选中节点时 buildPanelMainImageRestorePatchForEditing 的恢复语义一致。
    if (
      restoredVisible === false &&
      !String(restoredBackup || '').trim() &&
      String(restoredPreview || '').trim()
    ) {
      restoredVisible = undefined;
    }
    return {
      imagePreview: restoredPreview,
      imageName: nanoConfig.imageName,
      imageLocalRef: nanoConfig.imageLocalRef,
      panelMainImageUrl: restoredBackup,
      ...(hasVisibleProp ? { panelMainSlotVisible: restoredVisible } : {}),
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

/** 从运行快照中提取结果主图/主视频 URL（outputUrl 优先，其次 outputUrls[0]） */
export function getRunResultMainPreviewUrl(generationParams?: GenerationParams): string | undefined {
  if (!generationParams) return undefined;
  if (generationParams.outputUrl) return generationParams.outputUrl;
  if (Array.isArray(generationParams.outputUrls) && generationParams.outputUrls.length > 0) {
    return generationParams.outputUrls[0];
  }
  return undefined;
}

/**
 * outputNode / movNode 切换模型时：若存在运行结果 URL，保持其作为主图显示，
 * 避免被 modelConfigs 中其他模型继承自上游的旧快照覆盖。
 * 返回 null 表示无需保护（非运行结果节点或没有运行结果 URL）。
 */
export function preserveRunResultMainPreview(
  nodeType: NodeType | string | undefined,
  generationParams?: GenerationParams
): Partial<
  Pick<NodeData, 'imagePreview' | 'panelMainImageUrl' | 'panelMainSlotVisible' | 'imageLocalRef'>
> | null {
  const isResultNode = nodeType === NodeType.OUTPUT || nodeType === NodeType.MOV;
  if (!isResultNode) return null;
  const runResultUrl = getRunResultMainPreviewUrl(generationParams);
  if (!runResultUrl) return null;
  return {
    imagePreview: runResultUrl,
    panelMainImageUrl: undefined,
    panelMainSlotVisible: undefined,
    imageLocalRef: undefined,
  };
}

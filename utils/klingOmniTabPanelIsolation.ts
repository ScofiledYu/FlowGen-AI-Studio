import type { NodeData } from '../types';
import type { PanelReferenceLocalRefField } from './hydratePanelReferenceLocalRefs';
import type { FrameSlotSnapshot } from './modelSwitchPanelIsolation';
import { snapshotFrameSlotsFromNode } from './modelSwitchPanelIsolation';

export type KlingOmniPanelTab = 'multi' | 'instruction' | 'video' | 'frames';

export type KlingOmniInstructionTabSnapshot = {
  klingOmniInstructionVideoUrl?: string;
  klingOmniInstructionVideoPreviewUrl?: string;
  klingOmniInstructionVideoManuallyCleared?: boolean;
};

export type KlingOmniVideoTabSnapshot = {
  klingOmniVideoUrl?: string;
  klingOmniVideoPreviewUrl?: string;
  klingOmniVideoManuallyCleared?: boolean;
};

/** 各 tab 独立快照：参考图数组已分字段存储；此处仅首尾帧 + 指令/视频顶栏视频 */
export type KlingOmniTabConfigs = {
  instruction?: KlingOmniInstructionTabSnapshot;
  video?: KlingOmniVideoTabSnapshot;
  frames?: FrameSlotSnapshot;
};

export const KLING_OMNI_MODEL = '可灵3.0 Omni';

export function isKlingOmniModel(model: string | undefined): boolean {
  return String(model || '').trim() === KLING_OMNI_MODEL;
}

/** 把当前激活 tab 的 tab 专属顶层面板写入 klingOmniTabConfigs（主图四 tab 共用，不在此快照） */
export function snapshotKlingOmniTabConfigsWithLivePanel(
  data: NodeData,
  currentTab: KlingOmniPanelTab
): KlingOmniTabConfigs {
  const tabs = { ...(data.klingOmniTabConfigs || {}) } as KlingOmniTabConfigs;
  if (currentTab === 'instruction') {
    tabs.instruction = {
      klingOmniInstructionVideoUrl: data.klingOmniInstructionVideoUrl,
      klingOmniInstructionVideoPreviewUrl: data.klingOmniInstructionVideoPreviewUrl,
      klingOmniInstructionVideoManuallyCleared: data.klingOmniInstructionVideoManuallyCleared,
    };
  } else if (currentTab === 'video') {
    tabs.video = {
      klingOmniVideoUrl: data.klingOmniVideoUrl,
      klingOmniVideoPreviewUrl: data.klingOmniVideoPreviewUrl,
      klingOmniVideoManuallyCleared: data.klingOmniVideoManuallyCleared,
    };
  } else if (currentTab === 'frames') {
    tabs.frames = snapshotFrameSlotsFromNode(data);
  }
  return tabs;
}

function clearLiveFramePanelPatch(patch: Partial<NodeData>): void {
  patch.firstFrameImage = undefined;
  patch.lastFrameImage = undefined;
  patch.firstFrameImageUrl = undefined;
  patch.lastFrameImageUrl = undefined;
  patch.firstFrameLocalRef = undefined;
  patch.lastFrameLocalRef = undefined;
  patch.firstFrameImageLabel = undefined;
  patch.lastFrameImageLabel = undefined;
}

function applyFramePanelSnapshot(patch: Partial<NodeData>, snap: FrameSlotSnapshot = {}): void {
  patch.firstFrameImage = snap.firstFrameImage;
  patch.lastFrameImage = snap.lastFrameImage;
  patch.firstFrameImageUrl = snap.firstFrameImageUrl;
  patch.lastFrameImageUrl = snap.lastFrameImageUrl;
  patch.firstFrameLocalRef = snap.firstFrameLocalRef;
  patch.lastFrameLocalRef = snap.lastFrameLocalRef;
  patch.firstFrameImageLabel = snap.firstFrameImageLabel;
  patch.lastFrameImageLabel = snap.lastFrameImageLabel;
}

function applyInstructionVideoSnapshot(
  patch: Partial<NodeData>,
  snap: KlingOmniInstructionTabSnapshot = {}
): void {
  patch.klingOmniInstructionVideoUrl = snap.klingOmniInstructionVideoUrl;
  patch.klingOmniInstructionVideoPreviewUrl = snap.klingOmniInstructionVideoPreviewUrl;
  patch.klingOmniInstructionVideoManuallyCleared = snap.klingOmniInstructionVideoManuallyCleared;
}

function applyVideoTabVideoSnapshot(patch: Partial<NodeData>, snap: KlingOmniVideoTabSnapshot = {}): void {
  patch.klingOmniVideoUrl = snap.klingOmniVideoUrl;
  patch.klingOmniVideoPreviewUrl = snap.klingOmniVideoPreviewUrl;
  patch.klingOmniVideoManuallyCleared = snap.klingOmniVideoManuallyCleared;
}

export function getKlingOmniTabPromptFields(
  data: NodeData,
  tab: KlingOmniPanelTab
): { prompt: string; negativePrompt: string } {
  if (tab === 'multi') {
    return {
      prompt: data.klingOmniMultiPrompt ?? data.prompt ?? '',
      negativePrompt: data.klingOmniMultiNegativePrompt ?? data.negativePrompt ?? '',
    };
  }
  if (tab === 'instruction') {
    return {
      prompt: data.klingOmniInstructionPrompt ?? data.prompt ?? '',
      negativePrompt: data.klingOmniInstructionNegativePrompt ?? data.negativePrompt ?? '',
    };
  }
  if (tab === 'video') {
    return {
      prompt: data.klingOmniVideoPrompt ?? data.prompt ?? '',
      negativePrompt: data.klingOmniVideoNegativePrompt ?? data.negativePrompt ?? '',
    };
  }
  return {
    prompt: data.klingOmniFramesPrompt ?? data.prompt ?? '',
    negativePrompt: data.klingOmniFramesNegativePrompt ?? data.negativePrompt ?? '',
  };
}

/**
 * Omni 四 tab 切换：主图 imagePreview 四 tab 共用（不写入 patch）；
 * 仅隔离首尾帧 + 指令/视频 tab 顶栏视频。
 */
export function buildKlingOmniTabSwitchPatch(
  data: NodeData,
  fromTab: KlingOmniPanelTab,
  toTab: KlingOmniPanelTab
): Partial<NodeData> {
  const tabs = snapshotKlingOmniTabConfigsWithLivePanel(data, fromTab);
  const tabText = getKlingOmniTabPromptFields(data, toTab);
  const patch: Partial<NodeData> = {
    klingOmniTab: toTab,
    klingOmniTabConfigs: tabs,
    prompt: tabText.prompt,
    negativePrompt: tabText.negativePrompt,
  };

  if (toTab === 'frames') {
    clearLiveFramePanelPatch(patch);
    applyFramePanelSnapshot(patch, tabs.frames || {});
  } else {
    clearLiveFramePanelPatch(patch);
    if (toTab === 'instruction') {
      applyInstructionVideoSnapshot(patch, tabs.instruction || {});
    } else if (toTab === 'video') {
      applyVideoTabVideoSnapshot(patch, tabs.video || {});
    }
  }
  return patch;
}

/** 切到 Omni 模型后：按激活 tab 恢复首尾帧/顶栏视频；主图保持 modelConfigs 顶层字段 */
export function applyKlingOmniActiveTabLivePanel(
  patch: Partial<NodeData>,
  omniConfig: {
    klingOmniTab?: KlingOmniPanelTab;
    klingOmniTabConfigs?: KlingOmniTabConfigs;
  },
  fallbackData?: Partial<NodeData>
): void {
  const activeTab = (omniConfig.klingOmniTab || 'multi') as KlingOmniPanelTab;
  const tabs = { ...(omniConfig.klingOmniTabConfigs || {}) } as KlingOmniTabConfigs;
  if (!tabs[activeTab] && fallbackData && activeTab !== 'multi') {
    const snapAll = snapshotKlingOmniTabConfigsWithLivePanel(
      { ...fallbackData, klingOmniTab: activeTab } as NodeData,
      activeTab
    );
    if (snapAll[activeTab]) tabs[activeTab] = snapAll[activeTab];
  }
  patch.klingOmniTabConfigs = tabs;

  if (activeTab === 'frames') {
    clearLiveFramePanelPatch(patch);
    applyFramePanelSnapshot(patch, (tabs.frames || {}) as FrameSlotSnapshot);
  } else {
    clearLiveFramePanelPatch(patch);
    if (activeTab === 'instruction') {
      applyInstructionVideoSnapshot(patch, tabs.instruction || {});
    } else if (activeTab === 'video') {
      applyVideoTabVideoSnapshot(patch, tabs.video || {});
    }
  }
}

export function klingOmniTabFromReferenceLocalRefField(
  field: PanelReferenceLocalRefField
): KlingOmniPanelTab | undefined {
  if (field === 'klingOmniMultiReferenceLocalRefs') return 'multi';
  if (field === 'klingOmniInstructionReferenceLocalRefs') return 'instruction';
  if (field === 'klingOmniVideoReferenceLocalRefs') return 'video';
  return undefined;
}

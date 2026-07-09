import type { NodeData } from '../types';
import { getSeedanceDefaultResolution } from './seedanceAspectRatio';

export const SEEDANCE20_VARIANT_MODELS = [
  'seedance2.0 (高质量版)',
  'seedance2.0 (急速版)',
] as const;

export type Seedance20VariantModel = (typeof SEEDANCE20_VARIANT_MODELS)[number];

export type SeedanceModelConfigSnapshot = NonNullable<
  NodeData['modelConfigs']
>[Seedance20VariantModel];

export function isSeedance20VariantModel(
  model: string | undefined
): model is Seedance20VariantModel {
  return SEEDANCE20_VARIANT_MODELS.includes(model as Seedance20VariantModel);
}

export function isSeedance20VariantSwitch(
  fromModel: string | undefined,
  toModel: string
): boolean {
  return (
    isSeedance20VariantModel(fromModel) &&
    isSeedance20VariantModel(toModel) &&
    fromModel !== toModel
  );
}

/** 把当前激活 tab 的面板态写入 seedanceTabConfigs（与 switchSeedance20Tab 快照一致） */
export function snapshotSeedanceTabConfigsWithLivePanel(
  data: NodeData,
  promptText: string
): NonNullable<NodeData['seedanceTabConfigs']> {
  const tabs = { ...(data.seedanceTabConfigs || {}) } as NonNullable<NodeData['seedanceTabConfigs']>;
  const mode = (data.seedanceGenerationMode || 'text') as 'text' | 'image' | 'reference';
  const currentSnapshot: Record<string, unknown> = {
    prompt: promptText,
    negativePrompt: data.negativePrompt || '',
  };
  if (mode === 'image') {
    currentSnapshot.firstFrameImage = data.firstFrameImage;
    currentSnapshot.lastFrameImage = data.lastFrameImage;
    currentSnapshot.firstFrameImageUrl = data.firstFrameImageUrl;
    currentSnapshot.lastFrameImageUrl = data.lastFrameImageUrl;
    currentSnapshot.firstFrameLocalRef = data.firstFrameLocalRef;
    currentSnapshot.lastFrameLocalRef = data.lastFrameLocalRef;
  }
  if (mode === 'reference') {
    currentSnapshot.referenceImages = data.referenceImages ? [...data.referenceImages] : [];
    currentSnapshot.referenceImageLabels = data.referenceImageLabels
      ? [...data.referenceImageLabels]
      : [];
    currentSnapshot.referenceElementIds = data.referenceElementIds
      ? [...data.referenceElementIds]
      : [];
    currentSnapshot.referenceMovs = data.referenceMovs ? [...data.referenceMovs] : [];
    currentSnapshot.referenceAudios = data.referenceAudios ? [...data.referenceAudios] : [];
  }
  tabs[mode] = currentSnapshot as NonNullable<
    NonNullable<NodeData['seedanceTabConfigs']>[typeof mode]
  >;
  return tabs;
}

/** 写入 modelConfigs 前：含三 tab 快照 + 共享 Seedance 参数 + 参考素材 */
export function buildSeedanceModelConfigSnapshot(
  data: NodeData,
  model: string,
  promptText: string
): SeedanceModelConfigSnapshot {
  const tabs = snapshotSeedanceTabConfigsWithLivePanel(data, promptText);
  let seedanceResolution = data.seedanceResolution;
  if (
    (model === 'seedance2.0 (急速版)' || model === 'seedance1.5-pro') &&
    seedanceResolution === '1080p'
  ) {
    seedanceResolution = '720p';
  }
  return {
    prompt: promptText,
    negativePrompt: data.negativePrompt || '',
    firstFrameImage: data.firstFrameImage,
    lastFrameImage: data.lastFrameImage,
    firstFrameImageUrl: data.firstFrameImageUrl,
    lastFrameImageUrl: data.lastFrameImageUrl,
    firstFrameLocalRef: data.firstFrameLocalRef,
    lastFrameLocalRef: data.lastFrameLocalRef,
    firstFrameImageLabel: data.firstFrameImageLabel,
    lastFrameImageLabel: data.lastFrameImageLabel,
    numberOfImages: data.numberOfImages,
    seedanceResolution,
    seedanceAspectRatio: data.seedanceAspectRatio,
    seedanceDuration: data.seedanceDuration,
    seedanceGenerateAudio: data.seedanceGenerateAudio,
    seedanceFixedCamera: data.seedanceFixedCamera,
    seedanceGenerationMode: data.seedanceGenerationMode,
    seedanceReferenceRatioMode: data.seedanceReferenceRatioMode,
    seedanceReferenceWebSearch: data.seedanceReferenceWebSearch,
    seedanceTabConfigs: tabs,
    referenceImages: data.referenceImages?.length ? [...data.referenceImages] : undefined,
    referenceImageLabels: data.referenceImageLabels?.length
      ? [...data.referenceImageLabels]
      : undefined,
    referenceElementIds: data.referenceElementIds?.length
      ? [...data.referenceElementIds]
      : undefined,
    referenceMovs: data.referenceMovs?.length ? [...data.referenceMovs] : undefined,
    referenceAudios: data.referenceAudios?.length ? [...data.referenceAudios] : undefined,
    referenceImageLocalRefs: data.referenceImageLocalRefs?.some(Boolean)
      ? [...data.referenceImageLocalRefs]
      : undefined,
  };
}

/**
 * 急速 ↔ 高质量：以当前面板为准同步到目标型号（创意描述、时长、三 tab、参考素材等）。
 * 分辨率仍遵守型号上限（急速版 1080p → 720p）。
 */
export function resolveSeedanceConfigForModelSwitch(options: {
  data: NodeData;
  fromModel: string | undefined;
  toModel: string;
  savedTargetConfig: Partial<SeedanceModelConfigSnapshot>;
  promptText: string;
}): SeedanceModelConfigSnapshot {
  const { data, fromModel, toModel, savedTargetConfig, promptText } = options;
  if (isSeedance20VariantSwitch(fromModel, toModel)) {
    return buildSeedanceModelConfigSnapshot(data, toModel, promptText);
  }
  const base = { ...savedTargetConfig } as SeedanceModelConfigSnapshot;
  if (!base.seedanceResolution) {
    base.seedanceResolution = getSeedanceDefaultResolution(toModel);
  }
  if (
    (toModel === 'seedance2.0 (急速版)' || toModel === 'seedance1.5-pro') &&
    base.seedanceResolution === '1080p'
  ) {
    base.seedanceResolution = '720p';
  }
  return base;
}

export const SEEDANCE20_PANEL_TABS = [
  { id: 'reference' as const, label: '参考生视频' },
  { id: 'image' as const, label: '图生视频' },
  { id: 'text' as const, label: '文生视频' },
] as const;

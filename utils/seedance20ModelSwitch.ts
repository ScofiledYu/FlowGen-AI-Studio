import type { NodeData } from '../types';
import { getSeedanceDefaultResolution } from './seedanceAspectRatio';

export const SEEDANCE20_VARIANT_MODELS = [
  'seedance2.0 (4k版)',
  'seedance2.0 (高质量版)',
  'seedance2.0 (急速版)',
  'seedance2.5',
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
    // §11.90l：对标 Banana 面板 — 参考图不再存入快照。顶层 data.referenceImages
    // 是唯一数据源，切换 tab 时不清空，切回时无需从快照恢复。
    // 仅保留 prompt 等 tab 专属元数据在快照中。
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
  // 型号切换时分辨率适配目标型号能力上限
  if (model === 'seedance2.0 (4k版)') {
    seedanceResolution = '4k'; // 4k版固定4k
  } else if (model === 'seedance2.5') {
    // 2.5 支持 1080p，从 4k 降级为 1080p
    if (seedanceResolution === '4k') seedanceResolution = '1080p';
    if (seedanceResolution !== '1080p' && seedanceResolution !== '720p' && seedanceResolution !== '480p') {
      seedanceResolution = '1080p';
    }
  } else if (model === 'seedance2.0 (高质量版)') {
    // 高质量版支持 1080p，从 4k 降级为 1080p
    if (seedanceResolution === '4k') seedanceResolution = '1080p';
    if (seedanceResolution !== '1080p' && seedanceResolution !== '720p' && seedanceResolution !== '480p') {
      seedanceResolution = '1080p';
    }
  } else if (model === 'seedance2.0 (急速版)' || model === 'seedance1.5-pro') {
    // 急速版/1.5 最高 720p
    if (seedanceResolution === '1080p' || seedanceResolution === '4k') {
      seedanceResolution = '720p';
    }
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
    seedanceTaskType: data.seedanceTaskType,
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
 * Seedance 全系列互切（4k版/高质量版/急速版/2.5）：以当前面板为准同步到目标型号。
 * 分辨率按目标型号能力上限适配（4k→2.5/高质量版 降级 1080p；→急速版 降级 720p）。
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
  // 型号切换时分辨率适配目标型号能力上限
  if (toModel === 'seedance2.0 (4k版)') {
    base.seedanceResolution = '4k'; // 4k版固定4k
  } else if (toModel === 'seedance2.5') {
    if (base.seedanceResolution === '4k') base.seedanceResolution = '1080p';
  } else if (toModel === 'seedance2.0 (高质量版)') {
    if (base.seedanceResolution === '4k') base.seedanceResolution = '1080p';
  } else if (toModel === 'seedance2.0 (急速版)' || toModel === 'seedance1.5-pro') {
    if (base.seedanceResolution === '1080p' || base.seedanceResolution === '4k') {
      base.seedanceResolution = '720p';
    }
  }
  return base;
}

export const SEEDANCE20_PANEL_TABS = [
  { id: 'reference' as const, label: '参考生视频' },
  { id: 'image' as const, label: '图生视频' },
  { id: 'text' as const, label: '文生视频' },
] as const;

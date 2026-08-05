import type { NodeData } from '../types';
import { isImage2Model, isMidJourneyFamilyModel, isNanoBanana2Model } from '../types';

/** 生图 OUTPUT 继承源模型；MidJourney 生图默认 seedance2.0 便于图生视频；其它图节点默认可灵 2.5 便于图生视频链路 */
export function resolveSpawnOutputDefaultModel(params: {
  isVideoModel: boolean;
  currentModelName: string;
}): string {
  const { isVideoModel, currentModelName } = params;
  if (isVideoModel) return currentModelName;
  const isStillImageGen =
    isImage2Model(currentModelName) || isNanoBanana2Model(currentModelName);
  if (isStillImageGen) return currentModelName;
  // MidJourney 生图：默认 seedance2.0，方便用户将生成的图片直接用于视频生成
  if (isMidJourneyFamilyModel(currentModelName)) return 'seedance2.0 (高质量版)';
  return '可灵 2.5 Turbo';
}

const KELING_OUTPUT_STRIP_KEYS: Array<keyof NodeData> = [
  'quality',
  'duration',
  'creativityLevel',
  'klingAudioSync',
  'klingOmniTab',
  'firstFrameImage',
  'firstFrameImageUrl',
  'firstFrameLocalRef',
  'firstFrameImageLabel',
  'lastFrameImage',
  'lastFrameImageUrl',
  'lastFrameLocalRef',
  'lastFrameImageLabel',
];

/**
 * Banana / image2 生成 OUTPUT：保留 modelConfigs 快照，清掉可灵首尾帧等无关继承字段，
 * 面板主图格直接展示 imagePreview（生成结果）。
 */
export function buildStillImageOutputSpawnPatch(
  snapshot: Partial<NodeData>,
  selectedModel: string
): Partial<NodeData> {
  if (!isNanoBanana2Model(selectedModel) && !isImage2Model(selectedModel)) {
    return {};
  }
  const patch: Partial<NodeData> = {
    panelMainImageUrl: undefined,
    panelMainSlotVisible: undefined,
    imageLocalRef: undefined,
  };
  for (const key of KELING_OUTPUT_STRIP_KEYS) {
    (patch as Record<string, undefined>)[key] = undefined;
  }
  if (snapshot.modelConfigs && typeof snapshot.modelConfigs === 'object') {
    patch.modelConfigs = JSON.parse(JSON.stringify(snapshot.modelConfigs));
  }
  return patch;
}

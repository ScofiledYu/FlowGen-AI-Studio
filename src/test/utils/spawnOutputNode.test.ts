import { describe, expect, it } from 'vitest';
import {
  buildStillImageOutputSpawnPatch,
  resolveSpawnOutputDefaultModel,
} from '../../../utils/spawnOutputNode';
import { MODEL_IMAGE_2, MODEL_MIDJOURNEY, MODEL_NANO_BANANA_2 } from '../../../types';

describe('spawnOutputNode', () => {
  it('Banana/image2 OUTPUT 继承源模型', () => {
    expect(
      resolveSpawnOutputDefaultModel({
        isVideoModel: false,
        currentModelName: MODEL_NANO_BANANA_2,
      })
    ).toBe(MODEL_NANO_BANANA_2);
    expect(
      resolveSpawnOutputDefaultModel({
        isVideoModel: false,
        currentModelName: MODEL_IMAGE_2,
      })
    ).toBe(MODEL_IMAGE_2);
    expect(
      resolveSpawnOutputDefaultModel({
        isVideoModel: false,
        currentModelName: 'seedance2.0 (急速版)',
      })
    ).toBe('可灵 2.5 Turbo');
  });

  it('MidJourney OUTPUT 默认 seedance2.0', () => {
    expect(
      resolveSpawnOutputDefaultModel({
        isVideoModel: false,
        currentModelName: MODEL_MIDJOURNEY,
      })
    ).toBe('seedance2.0 (高质量版)');
  });

  it('视频 OUTPUT 继承运行模型', () => {
    expect(
      resolveSpawnOutputDefaultModel({
        isVideoModel: true,
        currentModelName: '可灵3.0 Omni',
      })
    ).toBe('可灵3.0 Omni');
  });

  it('Banana OUTPUT spawn 复制 modelConfigs 并清可灵首尾帧', () => {
    const patch = buildStillImageOutputSpawnPatch(
      {
        modelConfigs: {
          [MODEL_NANO_BANANA_2]: { aspectRatio: '16:9', numberOfImages: 2 },
        },
        quality: 'high',
        firstFrameImageUrl: 'https://example.com/a.png',
        panelMainImageUrl: 'blob:old',
      },
      MODEL_NANO_BANANA_2
    );
    expect(patch.modelConfigs?.[MODEL_NANO_BANANA_2]).toEqual({
      aspectRatio: '16:9',
      numberOfImages: 2,
    });
    expect(patch.quality).toBeUndefined();
    expect(patch.firstFrameImageUrl).toBeUndefined();
    expect(patch.panelMainImageUrl).toBeUndefined();
  });
});

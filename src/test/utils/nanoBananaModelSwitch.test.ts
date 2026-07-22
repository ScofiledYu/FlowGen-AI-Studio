import { describe, expect, it } from 'vitest';
import { MODEL_NANO_BANANA_2 } from '../../../types';
import { nanoBananaMainPatchOnModelSwitch } from '../../../utils/modelSwitchPanelIsolation';
import { resolveCanvasNodePreviewUrl } from '../../../utils/referencedMediaRun';

describe('nanoBanana model switch main preview', () => {
  it('restores imagePreview from modelConfigs when switching back to Banana2', () => {
    const patch = nanoBananaMainPatchOnModelSwitch(
      {
        imagePreview: 'https://cos.example/banana-main.png',
        imageName: '主图素材',
        imageLocalRef: 'flowgen-local:u:p:n1:main',
      },
      {
        imagePreview: 'https://cos.example/image2-main.png',
        imageName: 'other',
      }
    );
    expect(patch.imagePreview).toBe('https://cos.example/banana-main.png');
    expect(patch.imageName).toBe('主图素材');
    expect(patch.imageLocalRef).toBe('flowgen-local:u:p:n1:main');
  });

  it('keeps current main when no banana snapshot saved yet', () => {
    const patch = nanoBananaMainPatchOnModelSwitch(undefined, {
      imagePreview: 'https://cos.example/current.png',
      imageName: 'cur',
    });
    expect(patch.imagePreview).toBe('https://cos.example/current.png');
  });

  it('model switch empty preview: canvas does not fall back to gp 图1 without run-hide-main', () => {
    const switched = {
      selectedModel: MODEL_NANO_BANANA_2,
      imagePreview: '',
      prompt: '@图片1参考',
      referenceImages: ['https://cos.example/ref1.png'],
      generationParams: {
        referenceImages: ['https://cos.example/ref1.png'],
        prompt: '@图片1参考',
      },
    };
    expect(resolveCanvasNodePreviewUrl(switched)).toBeUndefined();
  });

  it('after run hide main: canvas uses first @ ref not main backup (§5.7 / §10.38)', () => {
    const afterRun = {
      selectedModel: MODEL_NANO_BANANA_2,
      imagePreview: 'https://cos.example/main-kept.png',
      panelMainImageUrl: 'https://cos.example/main-kept.png',
      panelMainSlotVisible: false as const,
      prompt: '@图片1参考',
      generationParams: {
        referenceImages: ['https://cos.example/ref1.png'],
        prompt: '@图片1参考',
      },
    };
    expect(resolveCanvasNodePreviewUrl(afterRun)).toBe('https://cos.example/ref1.png');
  });

  it('2026070607: empty prompt + stale panelMainImageUrl keeps main thumb not ref1', () => {
    const data = {
      selectedModel: MODEL_NANO_BANANA_2,
      prompt: '',
      imagePreview: 'blob:http://localhost:3001/main-abc',
      panelMainImageUrl: 'blob:http://localhost:3001/backup-xyz',
      referenceImages: [
        'blob:http://localhost:3001/ref0',
        'blob:http://localhost:3001/ref1',
      ],
      referenceImageLabels: ['图片1', '图片2'],
    };
    expect(resolveCanvasNodePreviewUrl(data)).toBe('blob:http://localhost:3001/main-abc');
  });
});

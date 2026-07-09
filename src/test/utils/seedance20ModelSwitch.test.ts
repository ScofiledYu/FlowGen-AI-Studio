import { describe, expect, it } from 'vitest';
import type { NodeData } from '../../../types';
import {
  buildSeedanceModelConfigSnapshot,
  isSeedance20VariantSwitch,
  resolveSeedanceConfigForModelSwitch,
  snapshotSeedanceTabConfigsWithLivePanel,
} from '../../../utils/seedance20ModelSwitch';

describe('seedance20ModelSwitch', () => {
  it('isSeedance20VariantSwitch detects 急速 ↔ 高质量', () => {
    expect(
      isSeedance20VariantSwitch('seedance2.0 (急速版)', 'seedance2.0 (高质量版)')
    ).toBe(true);
    expect(isSeedance20VariantSwitch('seedance2.0 (急速版)', 'seedance1.5-pro')).toBe(false);
  });

  it('snapshotSeedanceTabConfigsWithLivePanel merges active reference tab', () => {
    const data = {
      seedanceGenerationMode: 'reference',
      prompt: '@主图 动起来',
      negativePrompt: 'no blur',
      referenceImages: ['https://cos.example/a.jpg'],
      referenceImageLabels: ['图片1'],
      referenceMovs: [{ url: 'https://cos.example/v.mp4' }],
      referenceAudios: [{ url: 'https://cos.example/a.mp3' }],
      seedanceTabConfigs: { text: { prompt: 'old text' } },
    } as NodeData;
    const tabs = snapshotSeedanceTabConfigsWithLivePanel(data, '@主图 动起来');
    expect(tabs.text?.prompt).toBe('old text');
    expect(tabs.reference?.referenceImages).toEqual(['https://cos.example/a.jpg']);
    expect(tabs.reference?.referenceMovs?.[0]?.url).toBe('https://cos.example/v.mp4');
  });

  it('variant switch copies live panel params to target model', () => {
    const data = {
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      prompt: '@主图 @图片1 联动',
      seedanceDuration: '8s',
      seedanceAspectRatio: '1:1',
      seedanceResolution: '720p',
      seedanceGenerateAudio: true,
      referenceImages: ['https://cos.example/ref.jpg'],
      referenceImageLabels: ['图片1'],
      seedanceTabConfigs: {
        reference: { prompt: '@主图 @图片1 联动' },
      },
    } as NodeData;
    const snap = buildSeedanceModelConfigSnapshot(
      data,
      'seedance2.0 (高质量版)',
      '@主图 @图片1 联动'
    );
    expect(snap.seedanceDuration).toBe('8s');
    expect(snap.seedanceAspectRatio).toBe('1:1');
    expect(snap.referenceImages).toEqual(['https://cos.example/ref.jpg']);
    expect(snap.seedanceTabConfigs?.reference?.prompt).toBe('@主图 @图片1 联动');

    const loaded = resolveSeedanceConfigForModelSwitch({
      data,
      fromModel: 'seedance2.0 (急速版)',
      toModel: 'seedance2.0 (高质量版)',
      savedTargetConfig: {},
      promptText: '@主图 @图片1 联动',
    });
    expect(loaded.seedanceDuration).toBe('8s');
    expect(loaded.referenceImages).toEqual(['https://cos.example/ref.jpg']);
  });

  it('downgrades 1080p when saving snapshot for 急速版', () => {
    const data = {
      seedanceResolution: '1080p',
      seedanceGenerationMode: 'text',
      prompt: 'test',
    } as NodeData;
    const snap = buildSeedanceModelConfigSnapshot(
      data,
      'seedance2.0 (急速版)',
      'test'
    );
    expect(snap.seedanceResolution).toBe('720p');
  });
});

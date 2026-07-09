import { describe, expect, it } from 'vitest';
import {
  parsePanelGenerateCount,
  resolvePanelGenerateCount,
} from '../../../utils/panelGenerateCount';

describe('parsePanelGenerateCount', () => {
  it('parses 张/条 suffix', () => {
    expect(parsePanelGenerateCount('1张')).toBe(1);
    expect(parsePanelGenerateCount('2张')).toBe(2);
    expect(parsePanelGenerateCount('3条')).toBe(3);
    expect(parsePanelGenerateCount('4')).toBe(4);
  });

  it('clamps to max', () => {
    expect(parsePanelGenerateCount('9张', 4)).toBe(4);
    expect(parsePanelGenerateCount('', 4)).toBe(1);
  });
});

describe('resolvePanelGenerateCount', () => {
  it('prefers top-level numberOfImages', () => {
    expect(
      resolvePanelGenerateCount({
        numberOfImages: '3张',
        selectedModel: 'image 2',
        modelConfigs: { image2: { numberOfImages: '1张' } },
      })
    ).toBe(3);
  });

  it('falls back to modelConfigs when top-level missing', () => {
    expect(
      resolvePanelGenerateCount({
        selectedModel: '可灵 2.5 Turbo',
        modelConfigs: { '可灵 2.5 Turbo': { numberOfImages: '2条' } },
      })
    ).toBe(2);
  });
});

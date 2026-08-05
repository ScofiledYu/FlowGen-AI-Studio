import { describe, expect, it } from 'vitest';
import {
  resolveNamedAssetUrlByLabel,
  type ProjectAssetLabelRow,
} from '../../../utils/referenceImageSlotLabels';

const ASSETS: ProjectAssetLabelRow[] = [
  { slug: '鸱吻', name: '鸱吻', url: 'https://cos/assets/chiwen.png' },
  { slug: '夏茉', name: '夏茉', url: 'https://cos/assets/xiamo.png' },
];

describe('Omni panel reference named asset URL resolution', () => {
  it('returns asset URL when label matches a named asset', () => {
    expect(resolveNamedAssetUrlByLabel('鸱吻', ASSETS)).toBe('https://cos/assets/chiwen.png');
  });

  it('matches by slug as well as name', () => {
    expect(resolveNamedAssetUrlByLabel('夏茉', ASSETS)).toBe('https://cos/assets/xiamo.png');
  });

  it('returns undefined for generic ordinal labels', () => {
    expect(resolveNamedAssetUrlByLabel('图片1', ASSETS)).toBeUndefined();
    expect(resolveNamedAssetUrlByLabel('图片2', ASSETS)).toBeUndefined();
    expect(resolveNamedAssetUrlByLabel('主图', ASSETS)).toBeUndefined();
    expect(resolveNamedAssetUrlByLabel('主视频', ASSETS)).toBeUndefined();
  });

  it('returns undefined for unknown named labels', () => {
    expect(resolveNamedAssetUrlByLabel('石头', ASSETS)).toBeUndefined();
  });

  it('returns undefined when label is empty', () => {
    expect(resolveNamedAssetUrlByLabel('', ASSETS)).toBeUndefined();
    expect(resolveNamedAssetUrlByLabel(undefined, ASSETS)).toBeUndefined();
  });

  it('returns undefined when no project assets', () => {
    expect(resolveNamedAssetUrlByLabel('鸱吻', undefined)).toBeUndefined();
    expect(resolveNamedAssetUrlByLabel('鸱吻', [])).toBeUndefined();
  });

  it('trims label whitespace before matching', () => {
    expect(resolveNamedAssetUrlByLabel('  鸱吻  ', ASSETS)).toBe('https://cos/assets/chiwen.png');
  });
});

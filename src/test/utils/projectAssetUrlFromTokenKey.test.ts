import { describe, expect, it } from 'vitest';
import {
  resolveProjectAssetUrlFromTokenKey,
  type ProjectAssetLabelRow,
} from '../../../utils/promptMediaRefs.ts';

const GUANG = '/flowgen-api/projects/14/assets/eec77159/file';
const ASSETS: ProjectAssetLabelRow[] = [
  { slug: 'guangtouqiang', name: '光头强', url: GUANG },
];

describe('resolveProjectAssetUrlFromTokenKey', () => {
  it('falls back to projectAssets row.url when slug map is empty', () => {
    expect(resolveProjectAssetUrlFromTokenKey('光头强', new Map(), ASSETS)).toBe(GUANG);
    expect(resolveProjectAssetUrlFromTokenKey('guangtouqiang', new Map(), ASSETS)).toBe(GUANG);
  });

  it('prefers slug map over row.url', () => {
    const fromMap = 'https://cos.example/from-slug-map.png';
    expect(
      resolveProjectAssetUrlFromTokenKey(
        '光头强',
        new Map([['guangtouqiang', fromMap]]),
        ASSETS
      )
    ).toBe(fromMap);
  });

  it('returns undefined without assets or map entry', () => {
    expect(resolveProjectAssetUrlFromTokenKey('光头强', new Map())).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import {
  isStalePanelAssetDisplayLabel,
  preferAssetDisplayNameOverGenericLabel,
  resolveReferenceSlotDisplayLabel,
} from '../../../utils/referenceImageSlotLabels';

describe('stale panel asset labels after library delete', () => {
  const assets = [{ slug: 'hero', name: '萧逍', url: '/flowgen-api/projects/p1/assets/hero/file' }];
  const assetsWithoutHero = [{ slug: 'other', name: '其它', url: '/flowgen-api/projects/p1/assets/other/file' }];

  it('detects label for deleted asset on new blob URL', () => {
    expect(
      isStalePanelAssetDisplayLabel(
        '萧逍',
        'blob:http://localhost:3001/new-image',
        assetsWithoutHero
      )
    ).toBe(true);
  });

  it('display falls back to 图片n when label stale', () => {
    const label = resolveReferenceSlotDisplayLabel(
      0,
      ['blob:http://localhost:3001/new-image'],
      ['萧逍'],
      undefined,
      'panelSlot',
      assetsWithoutHero
    );
    expect(label).toBe('图片1');
  });

  it('preferAssetDisplayNameOverGenericLabel drops stale incoming name', () => {
    expect(
      preferAssetDisplayNameOverGenericLabel(
        '萧逍',
        'blob:http://localhost:3001/new-image',
        assetsWithoutHero
      )
    ).toBe('');
  });

  it('keeps valid asset label when URL still matches library', () => {
    expect(
      isStalePanelAssetDisplayLabel('萧逍', '/flowgen-api/projects/p1/assets/hero/file', assets)
    ).toBe(false);
    expect(
      resolveReferenceSlotDisplayLabel(
        0,
        ['/flowgen-api/projects/p1/assets/hero/file'],
        ['萧逍'],
        undefined,
        'panelSlot',
        assets
      )
    ).toBe('萧逍');
  });

  it('keeps library label when slot URL is wrong blob but asset name still in library', () => {
    const libAssets = [{ slug: 'cw', name: '鸱吻', url: '/flowgen-api/projects/p1/assets/cw/file' }];
    expect(
      isStalePanelAssetDisplayLabel(
        '鸱吻',
        'https://cos.example.com/wrong-gym.png',
        libAssets
      )
    ).toBe(false);
    expect(
      resolveReferenceSlotDisplayLabel(
        0,
        ['https://cos.example.com/wrong-gym.png'],
        ['鸱吻'],
        undefined,
        'panelSlot',
        libAssets
      )
    ).toBe('鸱吻');
  });

  it('keeps custom non-library label on cos URL after run upload replace', () => {
    expect(
      isStalePanelAssetDisplayLabel(
        '街景',
        'https://cos-up.example.com/street-up.png',
        assetsWithoutHero
      )
    ).toBe(false);
    expect(
      resolveReferenceSlotDisplayLabel(
        0,
        ['https://cos/street.png'],
        ['街景'],
        undefined,
        'panelSlot',
        assetsWithoutHero
      )
    ).toBe('街景');
  });

  it('stale when asset library URL but name removed from library', () => {
    expect(
      isStalePanelAssetDisplayLabel(
        '祭司老人',
        '/flowgen-api/projects/p1/assets/old-id/file',
        assetsWithoutHero
      )
    ).toBe(true);
  });
});

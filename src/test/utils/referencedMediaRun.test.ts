import { describe, expect, it } from 'vitest';
import {
  buildOmniMultiApiImageList,
  buildOmniMultiGenerationParamsLabels,
  mergeSeedancePanelReferenceMovsAfterUpload,
  shouldUseSlotOriginalFileForUpload,
} from '../../../utils/referencedMediaRun';

describe('buildOmniMultiApiImageList', () => {
  it('@图片2@图片5@图片3 隐式首帧：imageList 仅 3 张（首帧与 @图片2 同 URL）', () => {
    const first =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/6284419a.png';
    const img5 =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/99853bec.png';
    const img3 =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/da3e2d72.png';
    const uploadedByToken = new Map<string, string>([
      ['@图片2', first],
      ['@图片5', img5],
      ['@图片3', img3],
    ]);
    const extraEntries = [
      { token: '@图片2', refImageSlotIndex: 1 },
      { token: '@图片5', refImageSlotIndex: 4 },
      { token: '@图片3', refImageSlotIndex: 2 },
    ] as any[];
    const list = buildOmniMultiApiImageList({
      firstFrameUrl: first,
      extraEntries,
      uploadedByToken,
    });
    expect(list.map((r) => r.image_url)).toEqual([first, img5, img3]);
  });

  it('同 token 两次 upload 不同 URL 时按 key 去重', () => {
    const first = 'https://cos.example/a.png';
    const dupeUpload = 'https://cos.example/a.png?x=1';
    const uploadedByToken = new Map<string, string>([
      ['@图片2', dupeUpload],
      ['@图片5', 'https://cos.example/b.png'],
    ]);
    const list = buildOmniMultiApiImageList({
      firstFrameUrl: first,
      extraEntries: [{ token: '@图片2' }, { token: '@图片5' }] as any[],
      uploadedByToken,
    });
    expect(list.map((r) => r.image_url)).toEqual([first, 'https://cos.example/b.png']);
  });
});

describe('buildOmniMultiGenerationParamsLabels', () => {
  it('aligns API order with first frame + @图片1 + @图片4 (2026070802-可灵.json)', () => {
    const first =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/4357a077-d0c8-42c2-b4c4-6b00a8085603.png';
    const img1 =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/c99fa3f0-fe6a-4993-9b63-31ef1fb526fb.png';
    const img4 =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/20e0605b-709d-497a-9428-c509f559214d.png';
    const uploadedByToken = new Map<string, string>([
      ['@图片1', img1],
      ['@图片4', img4],
    ]);
    const planImages = [
      { token: '@图片1', url: img1, label: '图片1' },
      { token: '@图片4', url: img4, label: '图片4' },
    ];
    const labels = buildOmniMultiGenerationParamsLabels(
      [first, img1, img4],
      planImages as any,
      uploadedByToken,
      first
    );
    expect(labels).toEqual(['图片1', '图片1', '图片4']);
  });
});

describe('mergeSeedancePanelReferenceMovsAfterUpload', () => {
  it('returns empty when plan has no @视频 (stale panel movs cleared)', () => {
    const stale = [{ url: 'https://cos.example/stale-ref.mp4', posterDataUrl: 'https://cos.example/p.jpg' }];
    expect(mergeSeedancePanelReferenceMovsAfterUpload(stale, [], [])).toEqual([]);
  });

  it('merges uploaded URLs for plan videos', () => {
    const panel = [{ url: 'blob:old' }];
    const planVideos = [{ token: '@视频1', label: '视频1', url: 'https://ex/local.mp4', videoIndex: 0 }];
    const uploaded = ['https://cos.example/up.mp4'];
    const out = mergeSeedancePanelReferenceMovsAfterUpload(panel, planVideos, uploaded);
    expect(out).toEqual([{ url: 'https://cos.example/up.mp4' }]);
  });

  it('does not retain extra stale panel slots beyond plan videos', () => {
    const panel = [
      { url: 'https://ex/old1.mp4' },
      { url: 'https://ex/old2.mp4' },
    ];
    const planVideos = [{ token: '@视频1', label: '视频1', url: 'https://ex/v1.mp4', videoIndex: 0 }];
    const uploaded = ['https://cos.example/new1.mp4'];
    const out = mergeSeedancePanelReferenceMovsAfterUpload(panel, planVideos, uploaded);
    expect(out).toEqual([{ url: 'https://cos.example/new1.mp4' }]);
  });
});

describe('shouldUseSlotOriginalFileForUpload', () => {
  const cos =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/07e66432.png';
  const entry = {
    token: '@图片2',
    url: cos,
    label: '图片2',
    refImageSlotIndex: 1,
  };

  it('skips stale File when panel slot is remote COS (20260709 seedance)', () => {
    expect(
      shouldUseSlotOriginalFileForUpload(entry as any, cos, { name: 'stale.png' } as File)
    ).toBe(false);
  });

  it('still uses File for blob panel slots', () => {
    expect(
      shouldUseSlotOriginalFileForUpload(
        entry as any,
        'blob:http://localhost:3001/abc',
        { name: 'local.png' } as File
      )
    ).toBe(true);
  });

  it('skips stale File when panel slot is data: image (banana-问题3 @图片4 串图)', () => {
    const dataUrl = 'data:image/jpeg;base64,/9j/pic4slot';
    expect(
      shouldUseSlotOriginalFileForUpload(
        { ...entry, url: dataUrl, refImageSlotIndex: 3 } as any,
        dataUrl,
        { name: 'stale-pic3.png' } as File
      )
    ).toBe(false);
  });
});

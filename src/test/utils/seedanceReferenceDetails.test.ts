import { describe, expect, it } from 'vitest';
import {
  buildGenerationParamsFromRunSnapshot,
  buildSeedanceReferenceDetailsFromSnapshot,
  isSameVideoAssetForDetails,
  scrubGeneratedVideoFromReferenceMovs,
  seedanceReferenceMovsForOutputDetails,
} from '../../../utils/nodeDetailsPreview';

describe('seedanceReferenceMovsForOutputDetails', () => {
  it('OUTPUT with image-only gp has no reference videos', () => {
    expect(seedanceReferenceMovsForOutputDetails(undefined, 'https://cos.example/out.mp4')).toEqual([]);
    expect(seedanceReferenceMovsForOutputDetails([], 'https://cos.example/out.mp4')).toEqual([]);
  });

  it('keeps gp reference videos that are not the generated output', () => {
    const gpMovs = [{ url: 'https://cos.example/ref-in.mp4' }];
    expect(
      seedanceReferenceMovsForOutputDetails(gpMovs, 'https://cos.example/out.mp4')
    ).toEqual(gpMovs);
  });

  it('scrubs generated output from reference mov list', () => {
    const out = 'https://cos.example/out.mp4?sig=1';
    const items = [
      { url: out },
      { url: 'https://cos.example/ref.mp4' },
    ];
    const scrubbed = scrubGeneratedVideoFromReferenceMovs(items, out, isSameVideoAssetForDetails);
    expect(scrubbed).toEqual([{ url: 'https://cos.example/ref.mp4' }]);
  });
});

describe('buildGenerationParamsFromRunSnapshot seedance reference', () => {
  it('runCapture mode overrides stale snapshot text mode', () => {
    const gp = buildGenerationParamsFromRunSnapshot(
      {
        selectedModel: 'seedance2.0 (急速版)',
        seedanceGenerationMode: 'text',
        prompt: '@主图 @图片3',
      },
      'seedance2.0 (急速版)',
      {
        runCapture: {
          seedanceGenerationMode: 'reference',
          referenceImages: ['https://cos.example/a.jpg', 'https://cos.example/b.jpg'],
          referenceImageLabels: ['主图', '图片3'],
        },
      }
    );
    expect(gp.seedanceGenerationMode).toBe('reference');
    expect(gp.referenceImages).toEqual(['https://cos.example/a.jpg', 'https://cos.example/b.jpg']);
  });
});

// §11.85 门禁：buildSeedanceReferenceDetailsFromSnapshot 代理路径 → COS URL 转换
// 防回归「Node Details 参考图片 URL 显示为 /flowgen-api/... 代理路径而非 aitop100 COS 地址」
describe('§11.85 buildSeedanceReferenceDetailsFromSnapshot 代理路径 URL 转换', () => {
  const proxyPath = '/flowgen-api/projects/14/assets/ff824bc5-94a7-4b52-acd7-0790a704c42c/file';
  const cosUrl = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/ff824bc5-94a7-4b52-acd7-0790a704c42c.png';
  const cosUrl2 = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/40cc6744-852e-488c-80c5-a5f40d4dc030.png';

  const projectAssets = [
    { slug: 'da-ya', name: '大牙', url: cosUrl },
    { slug: 'tu-pian-2', name: '图片2', url: cosUrl2 },
  ];

  it('场景1: 代理路径 + 命名资产标签（大牙）→ 转换为 COS URL', () => {
    const result = buildSeedanceReferenceDetailsFromSnapshot({
      snapshotRefs: [proxyPath, cosUrl2],
      snapshotLabels: ['大牙', '图片2'],
      projectAssets,
      prompt: '@资产:大牙出现在@图片2中',
    });
    expect(result.referenceImages).toEqual([cosUrl, cosUrl2]);
    expect(result.referenceImageDetailItems.map((i) => i.url)).toEqual([cosUrl, cosUrl2]);
    expect(result.referenceImageDetailItems.map((i) => i.label)).toEqual(['大牙', '图片2']);
  });

  it('场景2: 已为 COS URL → 不转换（保持原样）', () => {
    const result = buildSeedanceReferenceDetailsFromSnapshot({
      snapshotRefs: [cosUrl, cosUrl2],
      snapshotLabels: ['大牙', '图片2'],
      projectAssets,
      prompt: '@图片2出现在@主图中',
    });
    expect(result.referenceImages).toEqual([cosUrl, cosUrl2]);
  });

  it('场景3: 代理路径但标签为泛化名（图片1）→ 不转换', () => {
    const result = buildSeedanceReferenceDetailsFromSnapshot({
      snapshotRefs: [proxyPath],
      snapshotLabels: ['图片1'],
      projectAssets,
      prompt: '@图片1',
    });
    // 泛化名标签不触发转换，URL 保持代理路径
    expect(result.referenceImages).toEqual([proxyPath]);
  });

  it('场景4: 代理路径 + 命名资产，但 projectAssets 不包含该标签 → 不转换', () => {
    const result = buildSeedanceReferenceDetailsFromSnapshot({
      snapshotRefs: [proxyPath],
      snapshotLabels: ['不存在的资产'],
      projectAssets,
      prompt: '@资产:不存在的资产',
    });
    expect(result.referenceImages).toEqual([proxyPath]);
  });

  it('场景5: 无 projectAssets → 不转换', () => {
    const result = buildSeedanceReferenceDetailsFromSnapshot({
      snapshotRefs: [proxyPath, cosUrl2],
      snapshotLabels: ['大牙', '图片2'],
      projectAssets: undefined,
      prompt: '@图片2出现在@主图中',
    });
    expect(result.referenceImages).toEqual([proxyPath, cosUrl2]);
  });

  it('场景6: 空 projectAssets → 不转换', () => {
    const result = buildSeedanceReferenceDetailsFromSnapshot({
      snapshotRefs: [proxyPath],
      snapshotLabels: ['大牙'],
      projectAssets: [],
      prompt: '@资产:大牙',
    });
    expect(result.referenceImages).toEqual([proxyPath]);
  });

  it('场景7: 混合场景 - 代理路径（大牙）+ COS（图片2）→ 仅代理路径转换', () => {
    const result = buildSeedanceReferenceDetailsFromSnapshot({
      snapshotRefs: [proxyPath, cosUrl2],
      snapshotLabels: ['大牙', '图片2'],
      projectAssets,
      prompt: '@资产:大牙出现在@图片2中',
    });
    expect(result.referenceImages).toEqual([cosUrl, cosUrl2]);
    expect(result.referenceImageDetailItems[0].url).toBe(cosUrl);
    expect(result.referenceImageDetailItems[1].url).toBe(cosUrl2);
  });
});

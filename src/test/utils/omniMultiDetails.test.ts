import { describe, expect, it } from 'vitest';
import {
  ancestorOmniPanelMergeAllowedForDetails,
  buildOmniInstructionVideoTabDetailsReferencePreview,
  buildOmniMultiTabDetailsReferencePreview,
  buildOmniPanelSourceForNodeDetails,
} from '../../../utils/nodeDetailsPreview';

describe('Omni multi tab Details reference images', () => {
  it('OUTPUT with cleared panel slots shows gp snapshot for @图片1 @图片3', () => {
    const img1 = 'https://cos.example/cat.png';
    const img3 = 'https://cos.example/forest.png';
    const prompt = '@图片1中的角色出现在@图片3中';
    const gp = {
      referenceImages: [img1, img3],
      referenceImageLabels: ['图片1', '图片3'],
      prompt,
    };
    const preview = buildOmniMultiTabDetailsReferencePreview({
      panelSource: {
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'multi',
        imagePreview: 'https://cos.example/out.mp4',
        generationParams: gp,
      },
      urlPool: gp.referenceImages,
      snapshotRefs: gp.referenceImages,
      snapshotLabels: gp.referenceImageLabels,
      prompt,
      movUrlSet: new Set(),
    });
    expect(preview.referenceImageDetailItems).toHaveLength(2);
    expect(preview.referenceImageDetailItems.map((i) => i.label)).toEqual(['图片1', '图片3']);
    expect(preview.referenceImages).toEqual([img1, img3]);
  });

  it('processor with @主图 still shows main + slots', () => {
    const main = 'https://cos.example/main.png';
    const ref = 'https://cos.example/ref.png';
    const preview = buildOmniMultiTabDetailsReferencePreview({
      panelSource: {
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'multi',
        imagePreview: main,
        klingOmniMultiReferenceImages: [ref],
        referenceImageLabels: ['图片2'],
        klingOmniMultiPrompt: '@主图 @图片2',
      },
      urlPool: [main, ref],
      snapshotRefs: [main, ref],
      prompt: '@主图 @图片2',
      movUrlSet: new Set(),
    });
    expect(preview.referenceImageDetailItems.length).toBeGreaterThanOrEqual(2);
    expect(preview.referenceImageDetailItems.some((i) => i.label === '主图')).toBe(true);
  });

  it('dedupes same URL after refresh when panel slots repeat main', () => {
    const cat = 'https://cos.example/cat.png';
    const forest = 'https://cos.example/forest.png';
    const preview = buildOmniMultiTabDetailsReferencePreview({
      panelSource: {
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'multi',
        imagePreview: cat,
        klingOmniMultiReferenceImages: [cat, forest],
        referenceImageLabels: ['图片1', '图片3'],
        klingOmniMultiPrompt: '@图片1中的角色出现在@图片3中',
      },
      urlPool: [cat, forest],
      snapshotRefs: [cat, forest],
      snapshotLabels: ['图片1', '图片3'],
      prompt: '@图片1中的角色出现在@图片3中',
      movUrlSet: new Set(),
    });
    expect(preview.referenceImageDetailItems).toHaveLength(2);
    expect(new Set(preview.referenceImages).size).toBe(2);
  });

  it('processor with panelMainImageUrl backup does not duplicate blob as 图片1 (node details参考图不一致.json)', () => {
    const ref1 =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/f5275674-8fae-443d-a457-22fa98d71aa8.png';
    const ref2 =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/e77305ee-b20e-4d6a-b251-5792906ee3cb.png';
    const mainBlob = 'blob:http://localhost:3001/49d7a441-main-backup';
    const prompt = '@图片1和@图片2打斗了起来';
    const gp = {
      referenceImages: [ref1, ref2],
      referenceImageLabels: ['图片1', '图片2'],
      prompt,
    };
    const procPreview = buildOmniMultiTabDetailsReferencePreview({
      panelSource: {
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'multi',
        imagePreview: mainBlob,
        panelMainImageUrl: mainBlob,
        klingOmniMultiReferenceImages: [ref1, ref2],
        referenceImageLabels: ['图片1', '图片2'],
        klingOmniMultiPrompt: prompt,
        generationParams: gp,
      },
      urlPool: [ref1, ref2, mainBlob],
      snapshotRefs: gp.referenceImages,
      snapshotLabels: gp.referenceImageLabels,
      prompt,
      movUrlSet: new Set(),
    });
    const movPanel = buildOmniPanelSourceForNodeDetails({
      previewNodeData: {
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'multi',
        taskId: '1533069',
        generationParams: gp,
      },
      generationParams: gp,
      ancestorData: {
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'multi',
        imagePreview: mainBlob,
        panelMainImageUrl: mainBlob,
        klingOmniMultiReferenceImages: [ref1, ref2],
        referenceImageLabels: ['图片1', '图片2'],
        taskId: '1533069',
      },
      isOutputLike: true,
      omniTab: 'multi',
      modelStr: '可灵3.0 Omni',
      resolvedPrompt: prompt,
    });
    const movPreview = buildOmniMultiTabDetailsReferencePreview({
      panelSource: movPanel,
      urlPool: [ref1, ref2],
      snapshotRefs: gp.referenceImages,
      snapshotLabels: gp.referenceImageLabels,
      prompt,
      movUrlSet: new Set(),
    });
    expect(procPreview.referenceImageDetailItems).toHaveLength(2);
    expect(movPreview.referenceImageDetailItems).toHaveLength(2);
    expect(procPreview.referenceImageDetailItems.map((i) => i.label)).toEqual(['图片1', '图片2']);
    expect(procPreview.referenceImages).toEqual(movPreview.referenceImages);
    expect(procPreview.referenceImages).not.toContain(mainBlob);
  });

  it('API 3-slot snapshot with @图片1 @图片3 skips middle slot (67811111.json)', () => {
    const img1 = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/f60c45e7-aa2c-436f-987a-c1bf36271f12.png';
    const img2 = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/eb23fa79-9ace-4f82-91da-d141e5e6ae32.png';
    const img3 = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/a16c76ae-8876-4e28-b8b5-782ed2206c43.png';
    const prompt = '@图片1中的角色出现在@图片3中';
    const preview = buildOmniMultiTabDetailsReferencePreview({
      panelSource: {
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'multi',
        imagePreview: img2,
        klingOmniMultiReferenceImages: [img2, '', img3],
        klingOmniMultiPrompt: prompt,
      },
      urlPool: [img1, img2, img3],
      snapshotRefs: [img1, img2, img3],
      prompt,
      movUrlSet: new Set(),
    });
    expect(preview.referenceImageDetailItems).toHaveLength(2);
    expect(preview.referenceImageDetailItems.map((i) => i.label)).toEqual(['图片1', '图片3']);
    expect(preview.referenceImages).toEqual([img1, img3]);
    expect(preview.referenceImages).not.toContain(img2);
  });

  it('stale gp Nano snapshot does not override panel 图片1 (uuuuu.json)', () => {
    const mainInk =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/cfcdb6fe-04bc-4c96-a8ff-d88505a9ae95.png';
    const dogRef =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/d2286a66-3c32-4a0c-b105-3c39d7b2fa85.png';
    const staleCat =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/053818f1-fc01-470a-8e8c-2384e44d80fb.png';
    const staleGoat =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/9ca827bd-7264-463d-b908-55deb1077d89.png';
    const prompt = '@主图大战@图片1，打斗过程中有中国水墨的线条';
    const preview = buildOmniMultiTabDetailsReferencePreview({
      panelSource: {
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'multi',
        imagePreview: mainInk,
        klingOmniMultiReferenceImages: [dogRef],
        referenceImageLabels: ['图片1'],
        klingOmniMultiPrompt: prompt,
      },
      urlPool: [mainInk, dogRef, staleCat, staleGoat],
      snapshotRefs: [staleCat, staleGoat],
      snapshotLabels: ['', '图片2'],
      prompt,
      movUrlSet: new Set(),
    });
    expect(preview.referenceImageDetailItems).toHaveLength(2);
    expect(preview.referenceImageDetailItems.map((i) => i.label)).toEqual(['主图', '图片1']);
    expect(preview.referenceImages).toEqual([mainInk, dogRef]);
    expect(preview.referenceImages).not.toContain(staleGoat);
  });

  it('§11.81 面板含 blob 槽时 Details 过滤 blob，仅保留 COS 参考图 (可灵中间节点.json)', () => {
    const blob0 = 'blob:http://localhost:3001/1280951d-b007-4156-b891-771daaef758e';
    const blob2 = 'blob:http://localhost:3001/7c6764f2-f685-46d2-a445-0006c5076412';
    const cosMain =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/13c33dc3-9f9f-44c0-a297-21ede9cb7a4d.png';
    const cosRef =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/3dab2fba-86b8-48e7-8a7e-8ea33ab62671.png';
    const prompt = '@资产:祭司老人出现在@主图中与@主图的角色交流起来';
    const preview = buildOmniMultiTabDetailsReferencePreview({
      panelSource: {
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'multi',
        klingOmniMultiReferenceImages: [blob0, cosRef, blob2],
        klingOmniMultiPrompt: prompt,
        prompt,
        imagePreview: cosMain,
        referenceImageLabels: ['图片1', '祭司老人', '图片3'],
        generationParams: {
          model: '可灵3.0 Omni',
          referenceImages: [cosMain, cosRef, ''],
          referenceImageLabels: ['图片1', '祭司老人', '图片3'],
        },
      },
      urlPool: [cosMain, cosRef, blob0, blob2],
      snapshotRefs: [cosMain, cosRef, ''],
      snapshotLabels: ['图片1', '祭司老人', '图片3'],
      prompt,
      movUrlSet: new Set(),
      projectAssets: [],
    });
    // blob 临时 URL 不得出现在 Details
    expect(preview.referenceImages.some((u) => /^(blob|data):/i.test(u))).toBe(false);
    // 保留主图 + 祭司老人两张 COS 参考图
    expect(preview.referenceImages).toContain(cosMain);
    expect(preview.referenceImages).toContain(cosRef);
    expect(preview.referenceImages).toHaveLength(2);
  });

  it('§11.82 面板含 blob + @资产主图 时 Details 正确返回 2 张参考图 (可灵3.0.json)', () => {
    // 模拟 node_17: prompt 含 @资产:大牙 + @图片2，面板 4 槽含 blob，
    // projectAssets 为空（资产库未加载），验证修复后 returns 2 张正确标签图片
    const blob0 = 'blob:http://localhost:3001/a42e10e4-558d-4b2d-bcb5-efc9af754877';
    const blob3 = 'blob:http://localhost:3001/35364fee-2055-4c9f-bd5c-abb5df8eec56';
    const cosMain =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/b8ca5280-9ded-446d-bfd9-e061948f0aec.png';
    const cosPic2 =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/56d45933-4d11-42c4-b947-75f3b1f91698.png';
    const prompt = '@资产:大牙出现在@图片2中与@图片2角色交流起来';
    const preview = buildOmniMultiTabDetailsReferencePreview({
      panelSource: {
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'multi',
        klingOmniMultiReferenceImages: [blob0, cosPic2, cosMain, blob3],
        klingOmniMultiPrompt: prompt,
        prompt,
        imagePreview: cosMain,
        referenceImageLabels: ['图片1', '图片2', '大牙', '图片4'],
        generationParams: {
          model: '可灵3.0 Omni',
          referenceImages: [cosMain, cosPic2],
          referenceImageLabels: ['大牙', '图片2'],
        },
      },
      urlPool: [cosMain, cosPic2, blob0, blob3],
      snapshotRefs: [cosMain, cosPic2],
      snapshotLabels: ['大牙', '图片2'],
      prompt,
      movUrlSet: new Set(),
      projectAssets: undefined,
    });
    // 无 blob 残留
    expect(preview.referenceImages.some((u) => /^(blob|data):/i.test(u))).toBe(false);
    // 2 张 COS 参考图
    expect(preview.referenceImages).toHaveLength(2);
    expect(preview.referenceImages).toContain(cosPic2);
    expect(preview.referenceImages).toContain(cosMain);
    // §11.82 标签顺序按 prompt @ 引用顺序排列（大牙→图片2），与后节点 gp 顺序一致
    expect(preview.referenceImageDetailItems.map((i) => i.label)).toEqual(['大牙', '图片2']);
  });

  // §11.82 needsSnapSlotIndex 修复：panel 有 2 个 COS 槽但 imagePreview 去重导致 panelSnapRefs 只计 1 个
  // → preferPanel 仍为 true，不会误判降级为 snap 路径少图
  it('§11.82 needsSnapSlotIndex 修复：panel 2 槽但 imagePreview 去重只计 1 → preferPanel 仍为 true', () => {
    const cosA =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/aaa.png';
    const cosB =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/bbb.png';
    const prompt = '@图片2中的角色出现在@图片3中';
    // panel 有 cosA(=imagePreview) + cosB 两个 COS 槽，但 imagePreview=cosA 与槽0重复
    // → buildOmniMultiPanelSnapshotRefsForPrompt 去重后 panelSnapRefs 只计 1 个（cosB）
    // → 修复前 needsSnapSlotIndex 用 panelSnapRefs.length=1 比较 snapRefs.length=2 → 误判为 true
    // → 修复后 activeSlotRefs.length=2 → needsSnapSlotIndex=false → preferPanel=true
    const preview = buildOmniMultiTabDetailsReferencePreview({
      panelSource: {
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'multi',
        klingOmniMultiReferenceImages: [cosA, cosB],
        klingOmniMultiPrompt: prompt,
        prompt,
        imagePreview: cosA,
        referenceImageLabels: ['图片2', '图片3'],
        generationParams: {
          model: '可灵3.0 Omni',
          referenceImages: [cosA, cosB],
          referenceImageLabels: ['图片2', '图片3'],
        },
      },
      urlPool: [cosA, cosB],
      snapshotRefs: [cosA, cosB],
      snapshotLabels: ['图片2', '图片3'],
      prompt,
      movUrlSet: new Set(),
    });
    expect(preview.referenceImageDetailItems).toHaveLength(2);
    expect(preview.referenceImageDetailItems.map((i) => i.label)).toEqual(['图片2', '图片3']);
  });

  // §11.82 effectiveProjectAssets fallback 边界：prompt 无 @资产: 时不构造 fallback
  it('§11.82 effectiveProjectAssets fallback 边界：prompt 无 @资产: 时不构造 fallback', () => {
    const cosA =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/aaa.png';
    const cosB =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/bbb.png';
    const prompt = '@图片1中的角色出现在@图片2中';
    const preview = buildOmniMultiTabDetailsReferencePreview({
      panelSource: {
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'multi',
        klingOmniMultiReferenceImages: [cosA, cosB],
        klingOmniMultiPrompt: prompt,
        prompt,
        imagePreview: cosA,
        referenceImageLabels: ['图片1', '图片2'],
        generationParams: {
          model: '可灵3.0 Omni',
          referenceImages: [cosA, cosB],
          referenceImageLabels: ['图片1', '图片2'],
        },
      },
      urlPool: [cosA, cosB],
      snapshotRefs: [cosA, cosB],
      snapshotLabels: ['图片1', '图片2'],
      prompt,
      movUrlSet: new Set(),
      projectAssets: undefined,
    });
    // prompt 无 @资产:，effectiveProjectAssets 不构造 fallback，正常走 panel 路径
    expect(preview.referenceImageDetailItems).toHaveLength(2);
    expect(preview.referenceImageDetailItems.map((i) => i.label)).toEqual(['图片1', '图片2']);
  });

  // §11.82 顺序重排跳过：标签集不一致时跳过重排，保持原顺序
  it('§11.82 顺序重排跳过：标签集不一致时保持原顺序', () => {
    const cosA =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/aaa.png';
    const cosB =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/bbb.png';
    const prompt = '@图片2出现在@图片3中';
    // 面板标签为「石头」「树木」— 但 prompt 用 @图片2/@图片3，标签集不一致
    // → inferredLabels = ['图片2', '图片3']，panelLabels = ['石头', '树木']，Set 不一致 → 跳过重排
    const preview = buildOmniMultiTabDetailsReferencePreview({
      panelSource: {
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'multi',
        klingOmniMultiReferenceImages: [cosA, cosB],
        klingOmniMultiPrompt: prompt,
        prompt,
        imagePreview: '',
        referenceImageLabels: ['石头', '树木'],
        generationParams: {
          model: '可灵3.0 Omni',
          referenceImages: [cosA, cosB],
          referenceImageLabels: ['石头', '树木'],
        },
      },
      urlPool: [cosA, cosB],
      snapshotRefs: [cosA, cosB],
      snapshotLabels: ['石头', '树木'],
      prompt,
      movUrlSet: new Set(),
    });
    // 面板路径保持原顺序 ['石头', '树木']
    expect(preview.referenceImageDetailItems).toHaveLength(2);
    expect(preview.referenceImageDetailItems.map((i) => i.label)).toEqual(['石头', '树木']);
  });
});

describe('Omni multi tab Details — 2026070802-可灵2.json', () => {
  it('MOV merged 4 panel slots but prompt @图片2 @图片4 → Details 仅 2 张', () => {
    const img2 =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/a06d168e-aba2-46e9-ae71-fe9aadb9d436.png';
    const img4 =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/da28f030-6703-4c8a-924c-e6441d37754d.png';
    const first =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/13ad4c3f-51c1-4e96-968e-60cd93bffda1.png';
    const blob = 'blob:http://localhost:3001/c3b1ee6a-d750-4d10-b161-5b66b9bccdc2';
    const asset = '/flowgen-api/projects/14/assets/90bdcd95-b552-42ab-9562-255b8557d92d/file';
    const outputVideo =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/4d797c16-b822-4f35-a18c-23a03e213b07.mp4';
    const prompt = '@图片2运动后去换衣服换成@图片4，视频中展现她换衣服的全程';
    const snapRefs = [first, img2, img4];
    const ancestor = {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi' as const,
      imagePreview: img2,
      klingOmniMultiReferenceImages: [blob, img2, asset, img4],
      referenceImageLabels: ['图片1', '图片2', '大牙-有牙', '图片4'],
      klingOmniMultiPrompt: prompt,
    };
    const panelSource = buildOmniPanelSourceForNodeDetails({
      previewNodeData: {
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'multi',
        imagePreview: outputVideo,
        generationParams: { referenceImages: snapRefs, prompt, klingOmniTab: 'multi' },
      },
      generationParams: {
        referenceImages: snapRefs,
        referenceImageLabels: ['图片2', '图片2', '图片4'],
        prompt,
        klingOmniTab: 'multi',
      },
      ancestorData: ancestor,
      isOutputLike: true,
      omniTab: 'multi',
      modelStr: '可灵3.0 Omni',
      resolvedPrompt: prompt,
    });
    const urlPool = [first, img2, img4, blob, asset, outputVideo];
    const preview = buildOmniMultiTabDetailsReferencePreview({
      panelSource,
      urlPool,
      snapshotRefs: snapRefs,
      snapshotLabels: ['图片2', '图片2', '图片4'],
      prompt,
      movUrlSet: new Set([outputVideo]),
    });
    expect(preview.referenceImageDetailItems.map((i) => i.label)).toEqual(['图片2', '图片4']);
    expect(preview.referenceImages).toEqual([img2, img4]);
  });
});

describe('Omni video tab Details reference images', () => {
  it('MOV node without panel slots shows 主图+图片1 not 图片1+图片2 (tttttt.json)', () => {
    const mainInk =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/0319bfa6-41db-4eac-8ee0-13de3aee94f4.png';
    const dogRef =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/d2286a66-3c32-4a0c-b105-3c39d7b2fa85.png';
    const refVideo =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/36c5a66c-f7b0-40f2-a5a1-67cd68d54382.mp4';
    const outputVideo =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/70e6f61d-b6a0-4cb4-a0b6-8ff8108c4921.mp4';
    const prompt = '@主图和@图片1参考@视频1动作进行打斗';
    const snapRefs = [mainInk, dogRef];
    const preview = buildOmniInstructionVideoTabDetailsReferencePreview({
      panelSource: {
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'video',
        imagePreview: outputVideo,
        klingOmniVideoPrompt: prompt,
        prompt,
        referenceMovs: [{ url: refVideo }],
      },
      omniTab: 'video',
      urlPool: snapRefs,
      snapshotRefs: snapRefs,
      movUrlSet: new Set([refVideo, outputVideo]),
    });
    expect(preview.referenceImageDetailItems.map((i) => i.label)).toEqual(['主图', '图片1']);
    expect(preview.referenceImages).toEqual([mainInk, dogRef]);
  });

  it('after refresh with empty omni slots uses top-level referenceImages (uuuuu)', () => {
    const mainInk =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/cfcdb6fe-04bc-4c96-a8ff-d88505a9ae95.png';
    const dogRef =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/d2286a66-3c32-4a0c-b105-3c39d7b2fa85.png';
    const staleCat =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/053818f1-fc01-470a-8e8c-2384e44d80fb.png';
    const staleGoat =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/9ca827bd-7264-463d-b908-55deb1077d89.png';
    const prompt = '@主图大战@图片1，打斗过程中有中国水墨的线条';
    const preview = buildOmniMultiTabDetailsReferencePreview({
      panelSource: {
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'multi',
        imagePreview: mainInk,
        klingOmniMultiReferenceImages: [],
        referenceImages: [mainInk, dogRef],
        klingOmniMultiPrompt: prompt,
      },
      urlPool: [mainInk, dogRef, staleCat, staleGoat],
      snapshotRefs: [staleCat, staleGoat],
      prompt,
      movUrlSet: new Set(),
    });
    expect(preview.referenceImageDetailItems.map((i) => i.label)).toEqual(['主图', '图片1']);
    expect(preview.referenceImages[1]).toBe(dogRef);
  });
});

describe('Omni MOV stale task ancestor guard', () => {
  it('does not merge INPUT ancestor when taskId mismatches (0702 node_5)', () => {
    const mainLion =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/0319bfa6-41db-4eac-8ee0-13de3aee94f4.png';
    const dogRef =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/d2286a66-3c32-4a0c-b105-3c39d7b2fa85.png';
    const inputStyle =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/0cc619d6-7a84-4bbb-8060-d2061dce6f56.png';
    const videoPrompt = '@主图和@图片1参考@视频1动作进行打斗';
    const mismatchedAncestor = {
      taskId: '1467628',
      referenceImages: ['https://cos.example/wrong.png', inputStyle],
      generationParams: { taskId: '1467628' },
    };
    expect(
      ancestorOmniPanelMergeAllowedForDetails(
        { taskId: '1467947', generationParams: { taskId: '1467947' } },
        mismatchedAncestor
      )
    ).toBe(false);
    const panel = buildOmniPanelSourceForNodeDetails({
      previewNodeData: {
        taskId: '1467947',
        generationParams: {
          taskId: '1467947',
          prompt: videoPrompt,
          referenceImages: [mainLion, dogRef],
        },
      },
      generationParams: {
        taskId: '1467947',
        prompt: videoPrompt,
        referenceImages: [mainLion, dogRef],
      },
      ancestorData: mismatchedAncestor,
      isOutputLike: true,
      omniTab: 'video',
      modelStr: '可灵3.0 Omni',
      resolvedPrompt: videoPrompt,
    });
    expect(panel.referenceImages || []).not.toContain(inputStyle);
    const preview = buildOmniInstructionVideoTabDetailsReferencePreview({
      panelSource: panel,
      omniTab: 'video',
      urlPool: [mainLion, dogRef, inputStyle],
      snapshotRefs: [mainLion, dogRef],
      movUrlSet: new Set(),
      prompt: videoPrompt,
    });
    expect(preview.referenceImageDetailItems).toHaveLength(2);
    expect(preview.referenceImageDetailItems.map((i) => i.label)).toEqual(['主图', '图片1']);
  });
});

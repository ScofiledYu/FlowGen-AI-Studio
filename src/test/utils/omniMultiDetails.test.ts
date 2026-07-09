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

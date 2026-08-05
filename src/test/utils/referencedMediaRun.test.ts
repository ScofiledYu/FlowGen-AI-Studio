import { describe, expect, it } from 'vitest';
import {
  buildOmniMultiApiImageList,
  buildOmniMultiGenerationParamsLabels,
  mergeSeedancePanelReferenceMovsAfterUpload,
  shouldUseSlotOriginalFileForUpload,
  repairSeedanceReferenceGenerationParamsFromPanel,
  repairOmniMultiGenerationParamsFromPanel,
  buildSeedanceReferenceApiLabelsFromPlan,
  buildSeedanceReferenceImagesApiPayload,
  promptMentionsMainImageInText,
  pickSeedanceReferencePanelSnapshot,
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

// §11.73 门禁：刷新后面板 @主图 blob 被 sanitize 为空槽，repair 覆盖时须用 gp 已有 COS URL 回填，
// 防止 gp 主图 COS URL 被空槽覆盖丢失（Node Details Reference Images 主图消失）。
describe('§11.73 repairSeedanceReferenceGenerationParamsFromPanel 空槽回填保留主图 COS URL', () => {
  const mainCos = 'https://cos.example/main.png';
  const img1Cos = 'https://cos.example/img1.png';
  const img2Cos = 'https://cos.example/img2.png';

  it('场景1: 面板主图空槽(blob 被 sanitize) + gp 含主图 COS URL → 回填后 mergedRefs 与 gp 一致 → 无变更（gp 已有正确数据）', () => {
    const data = {
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'reference',
      referenceImages: ['', img1Cos, img2Cos],          // 主图 blob 被 sanitize 为空槽
      referenceImageLabels: ['主图', '图片1', '图片2'],
      generationParams: {
        model: 'seedance2.0 (高质量版)',
        seedanceGenerationMode: 'reference',
        referenceImages: [mainCos, img1Cos, img2Cos],   // gp 含主图 COS URL
        referenceImageLabels: ['主图', '图片1', '图片2'],
      },
    } as any;
    const result = repairSeedanceReferenceGenerationParamsFromPanel(data);
    // §11.75: mergedRefs=[mainCos,img1Cos,img2Cos] === gp 原值，且标签一致 → 无变更
    expect(result).toBeUndefined();
  });

  it('场景2: 面板全非空 + 与 gp 不一致 → 用面板覆盖（行为不变，回填不触发）', () => {
    const newMain = 'https://cos.example/new-main.png';
    const data = {
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'reference',
      referenceImages: [newMain, img1Cos],              // 面板有新主图
      referenceImageLabels: ['主图', '图片1'],
      generationParams: {
        referenceImages: [mainCos, img1Cos],            // gp 是旧主图
      },
    } as any;
    const result = repairSeedanceReferenceGenerationParamsFromPanel(data);
    expect(result).toBeDefined();
    expect(result!.referenceImages).toEqual([newMain, img1Cos]);  // 用面板覆盖
  });

  it('场景3: 面板全空 → pickSeedanceReferencePanelSnapshot 返回空 → 早退 undefined（不覆盖 gp）', () => {
    const data = {
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'reference',
      referenceImages: ['', ''],
      generationParams: { referenceImages: [mainCos, img1Cos] },
    } as any;
    const result = repairSeedanceReferenceGenerationParamsFromPanel(data);
    expect(result).toBeUndefined();
  });

  it('场景4: 面板与 gp URL 集合匹配 → 早退 undefined', () => {
    const data = {
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'reference',
      referenceImages: [mainCos, img1Cos],
      generationParams: { referenceImages: [mainCos, img1Cos] },
    } as any;
    const result = repairSeedanceReferenceGenerationParamsFromPanel(data);
    expect(result).toBeUndefined();
  });

  it('场景5: 非 reference 模式 → 早退 undefined', () => {
    const data = {
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'text',
      referenceImages: [mainCos],
      generationParams: { referenceImages: [mainCos] },
    } as any;
    const result = repairSeedanceReferenceGenerationParamsFromPanel(data);
    expect(result).toBeUndefined();
  });

  it('场景6: 非 seedance2.0 模型 → 早退 undefined', () => {
    const data = {
      selectedModel: '可灵3.0 Omni',
      seedanceGenerationMode: 'reference',
      referenceImages: [mainCos],
      generationParams: { referenceImages: [mainCos] },
    } as any;
    const result = repairSeedanceReferenceGenerationParamsFromPanel(data);
    expect(result).toBeUndefined();
  });

  it('场景7: 多空槽（主图+图片1 均空）→ 全部从 gp 回填', () => {
    const data = {
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      referenceImages: ['', '', img2Cos],
      referenceImageLabels: ['主图', '图片1', '图片2'],
      generationParams: {
        referenceImages: [mainCos, img1Cos, img2Cos],
      },
    } as any;
    const result = repairSeedanceReferenceGenerationParamsFromPanel(data);
    expect(result).toBeDefined();
    expect(result!.referenceImages).toEqual([mainCos, img1Cos, img2Cos]);
  });

  it('场景8: 空槽对应 gp 也为空 → 保持空（不凭空捏造 URL），但同步面板标签到 gp', () => {
    const data = {
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'reference',
      referenceImages: ['', img1Cos],
      referenceImageLabels: ['主图', '图片1'],
      generationParams: {
        referenceImages: ['', img1Cos],                // gp 对应槽也为空
      },
    } as any;
    // §11.75: mergedRefs = ['', img1Cos] 与 gp 一致，但面板标签 ['主图','图片1'] 与 gp 标签 [] 不同 → 需同步标签
    const result = repairSeedanceReferenceGenerationParamsFromPanel(data);
    expect(result).toBeDefined();
    expect(result!.referenceImages).toEqual(['', img1Cos]);
    expect(result!.referenceImageLabels).toEqual(['主图', '图片1']);
  });
});

// §11.78 门禁：Seedance 刷新后 gp 修复不再从 imagePreview 回填主图（imagePreview 是生成输出而非主参考图）。
	// 主图 COS URL 应在运行时由 resolveSeedancePromptTokenMedia（优先面板参考图）+ seedanceApiRefImages fallback
	// （使用 uploadedMainImageUrl）正确写入 gp。修复函数仅处理 gp 已有 URL 的回填空槽 + blob/data 过滤。
	describe('§11.78 repairSeedanceReferenceGenerationParamsFromPanel 不适用 imagePreview 回填主图', () => {
	  const mainCos = 'https://cos.example/main.png';
	  const img1Cos = 'https://cos.example/img1.png';

	  it('场景1: gp 主图槽空 + panel 主图槽空 + prompt 含 @主图 → 不再从 imagePreview 回填，保持空槽', () => {
	    // §11.78: imagePreview 是生成输出，不应回填为主参考图
	    const data = {
	      selectedModel: 'seedance2.0 (急速版)',
	      seedanceGenerationMode: 'reference',
	      prompt: '@资产:大牙出现在@主图中与@主图中角色交流',
	      imagePreview: mainCos,  // imagePreview 是生成输出，不是主参考图
	      referenceImages: ['', img1Cos, ''],
	      referenceImageLabels: ['图片1', '大牙', '图片3'],
	      generationParams: {
	        referenceImages: ['', img1Cos, ''],
	        referenceImageLabels: ['图片1', '大牙', '图片3'],
	      },
	    } as any;
	    const result = repairSeedanceReferenceGenerationParamsFromPanel(data);
	    // mergedRefs = ['', img1Cos, ''] === gp 原值，标签一致 → 无变更
	    expect(result).toBeUndefined();
	  });

	  it('场景2: 面板含 blob URL → 过滤为空格，从 gp 回填 COS URL', () => {
	    const data = {
	      selectedModel: 'seedance2.0 (高质量版)',
	      seedanceGenerationMode: 'reference',
	      referenceImages: ['blob:http://localhost/main', img1Cos],
	      referenceImageLabels: ['主图', '图片1'],
	      generationParams: {
	        referenceImages: [mainCos, img1Cos],
	        referenceImageLabels: ['主图', '图片1'],
	      },
	    } as any;
	    const result = repairSeedanceReferenceGenerationParamsFromPanel(data);
	    // mergedRefs = [mainCos, img1Cos] === gp 原值 → 无变更
	    expect(result).toBeUndefined();
	  });

	  it('场景3: 面板含 data: URL → 过滤为空格，从 gp 回填', () => {
	    const data = {
	      selectedModel: 'seedance2.0 (高质量版)',
	      seedanceGenerationMode: 'reference',
	      referenceImages: ['data:image/png;base64,abc', img1Cos],
	      referenceImageLabels: ['主图', '图片1'],
	      generationParams: {
	        referenceImages: [mainCos, img1Cos],
	        referenceImageLabels: ['主图', '图片1'],
	      },
	    } as any;
	    const result = repairSeedanceReferenceGenerationParamsFromPanel(data);
	    expect(result).toBeUndefined();
	  });
	});

// §11.79 门禁：buildSeedanceReferenceApiLabelsFromPlan 面板标签对齐 ——
// 参考可灵多图参考，当面板有自定义标签（如"大牙"）时，gp 标签应使用面板标签而非泛化名（如"主图"）。
describe('§11.79 buildSeedanceReferenceApiLabelsFromPlan 面板标签对齐', () => {
  const img2Cos = 'https://cos.example/img2.png';
  const mainCos = 'https://cos.example/main.png';

  it('面板有自定义标签"大牙"→ @主图标签用"大牙"而非"主图"', () => {
    const planImages = [
      { token: '@图片2', label: '图片2', url: img2Cos, refImageSlotIndex: 1 },
      { token: '@主图', label: '主图', url: mainCos },
    ] as any[];
    const uploadedByToken = new Map<string, string>([
      ['@图片2', img2Cos],
      ['@主图', mainCos],
    ]);
    const panelLabels = ['大牙', '图片2'];
    const result = buildSeedanceReferenceApiLabelsFromPlan(planImages, uploadedByToken, panelLabels);
    expect(result).toEqual(['图片2', '大牙']);
  });

  it('面板无自定义标签 → 使用 plan 标签（向后兼容）', () => {
    const planImages = [
      { token: '@图片2', label: '图片2', url: img2Cos, refImageSlotIndex: 1 },
      { token: '@主图', label: '主图', url: mainCos },
    ] as any[];
    const uploadedByToken = new Map<string, string>([
      ['@图片2', img2Cos],
      ['@主图', mainCos],
    ]);
    const panelLabels = ['主图', '图片2'];
    const result = buildSeedanceReferenceApiLabelsFromPlan(planImages, uploadedByToken, panelLabels);
    // 面板标签"主图"匹配 /^图片\d+$/ 不匹配 → 使用 plan 标签
    expect(result).toEqual(['图片2', '主图']);
  });

  it('不传 panelLabels → 使用 plan 标签（向后兼容）', () => {
    const planImages = [
      { token: '@图片2', label: '图片2', url: img2Cos, refImageSlotIndex: 1 },
      { token: '@主图', label: '主图', url: mainCos },
    ] as any[];
    const uploadedByToken = new Map<string, string>([
      ['@图片2', img2Cos],
      ['@主图', mainCos],
    ]);
    const result = buildSeedanceReferenceApiLabelsFromPlan(planImages, uploadedByToken);
    expect(result).toEqual(['图片2', '主图']);
  });

  it('@资产:大牙 无 refImageSlotIndex → 作为 @主图 使用 slot 0 面板标签', () => {
    const planImages = [
      { token: '@资产:大牙', label: '大牙', url: mainCos },
      { token: '@图片2', label: '图片2', url: img2Cos, refImageSlotIndex: 1 },
    ] as any[];
    const uploadedByToken = new Map<string, string>([
      ['@资产:大牙', mainCos],
      ['@图片2', img2Cos],
    ]);
    const panelLabels = ['大牙', '图片2'];
    const result = buildSeedanceReferenceApiLabelsFromPlan(planImages, uploadedByToken, panelLabels);
    // @资产:大牙 不是 MAIN_IMAGE_REF_TOKENS → slotIdx=undefined → 使用 plan 标签
    expect(result).toEqual(['大牙', '图片2']);
  });
});

// §11.76 门禁：可灵3.0 Omni multi tab 刷新后 gp 修复，移除 seedanceReferenceSnapshotUrlsMatch 集合比较，
// 改为 mergedRefs 逐元素比较 + 空槽回填，防止主图 COS URL 被覆盖丢失。
describe('§11.76 repairOmniMultiGenerationParamsFromPanel 空槽回填保留主图 COS URL', () => {
  const mainCos = 'https://cos.example/main.png';
  const img1Cos = 'https://cos.example/img1.png';
  const img2Cos = 'https://cos.example/img2.png';

  it('场景1: 面板空槽(blob 被 sanitize) + gp 含主图 COS URL（槽数不同）→ mergedRefs 回填主图，写回 gp', () => {
    // 模拟可灵.json 中间节点场景：gp 有 2 个槽（主图+参考图），面板有 3 个槽（刷新后 blob 变空）
    const data = {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      klingOmniMultiReferenceImages: ['', img1Cos, ''],     // 面板 3 槽，blob 被 sanitize
      referenceImageLabels: ['图片1', '祭司老人', '图片3'],
      generationParams: {
        model: '可灵3.0 Omni',
        referenceImages: [mainCos, img1Cos],                // gp 2 槽，含主图 COS URL
        referenceImageLabels: ['主图', '祭司老人'],
      },
    } as any;
    const result = repairOmniMultiGenerationParamsFromPanel(data);
    expect(result).toBeDefined();
    // mergedRefs 回填主图：面板空槽0用 gp[0] 回填，面板空槽2用 gp[2] 回填（gp[2]为空→保持空）
    expect(result!.referenceImages).toEqual([mainCos, img1Cos, '']);
    expect(result!.referenceImageLabels).toEqual(['图片1', '祭司老人', '图片3']);
  });

  it('场景2: 面板全非空 + 与 gp 一致 → 无变更', () => {
    const data = {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      klingOmniMultiReferenceImages: [mainCos, img1Cos],
      referenceImageLabels: ['主图', '图片1'],
      generationParams: {
        referenceImages: [mainCos, img1Cos],
        referenceImageLabels: ['主图', '图片1'],
      },
    } as any;
    const result = repairOmniMultiGenerationParamsFromPanel(data);
    expect(result).toBeUndefined();
  });

  it('场景3: 面板全空 → 早退 undefined（不覆盖 gp）', () => {
    const data = {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      klingOmniMultiReferenceImages: ['', '', ''],
      generationParams: { referenceImages: [mainCos, img1Cos] },
    } as any;
    const result = repairOmniMultiGenerationParamsFromPanel(data);
    expect(result).toBeUndefined();
  });

  it('场景4: 非 multi tab → 早退 undefined', () => {
    const data = {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'instruction',
      klingOmniMultiReferenceImages: ['', img1Cos],
      generationParams: { referenceImages: [mainCos, img1Cos] },
    } as any;
    const result = repairOmniMultiGenerationParamsFromPanel(data);
    expect(result).toBeUndefined();
  });

  it('场景5: 非可灵3.0 Omni 模型 → 早退 undefined', () => {
    const data = {
      selectedModel: 'seedance2.0 (高质量版)',
      klingOmniTab: 'multi',
      klingOmniMultiReferenceImages: ['', img1Cos],
      generationParams: { referenceImages: [mainCos, img1Cos] },
    } as any;
    const result = repairOmniMultiGenerationParamsFromPanel(data);
    expect(result).toBeUndefined();
  });

  it('场景6: 多空槽（槽0+槽2 均空）→ 全部从 gp 回填', () => {
    const data = {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      klingOmniMultiReferenceImages: ['', img1Cos, ''],
      referenceImageLabels: ['图片1', '祭司老人', '图片3'],
      generationParams: {
        referenceImages: [mainCos, img1Cos, img2Cos],
      },
    } as any;
    const result = repairOmniMultiGenerationParamsFromPanel(data);
    expect(result).toBeDefined();
    expect(result!.referenceImages).toEqual([mainCos, img1Cos, img2Cos]);
    expect(result!.referenceImageLabels).toEqual(['图片1', '祭司老人', '图片3']);
  });

  it('场景7: mergedRefs 与 gp 完全一致 + 标签一致 → 无变更（gp 已有正确数据）', () => {
    const data = {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      klingOmniMultiReferenceImages: ['', img1Cos, ''],
      referenceImageLabels: ['图片1', '祭司老人', '图片3'],
      generationParams: {
        referenceImages: ['', img1Cos, ''],
        referenceImageLabels: ['图片1', '祭司老人', '图片3'],
      },
    } as any;
    const result = repairOmniMultiGenerationParamsFromPanel(data);
    // mergedRefs = ['', img1Cos, ''] === gp 原值，标签一致 → 无变更
    expect(result).toBeUndefined();
  });

  it('场景8: 空槽对应 gp 也为空但标签不同 → 同步标签到 gp', () => {
    const data = {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      klingOmniMultiReferenceImages: ['', img1Cos],
      referenceImageLabels: ['主图', '图片1'],
      generationParams: {
        referenceImages: ['', img1Cos],
        // gp 无标签
      },
    } as any;
    const result = repairOmniMultiGenerationParamsFromPanel(data);
    expect(result).toBeDefined();
    expect(result!.referenceImages).toEqual(['', img1Cos]);
    expect(result!.referenceImageLabels).toEqual(['主图', '图片1']);
	  });
	});

// §11.83 门禁：buildSeedanceReferenceImagesApiPayload —— Seedance 参考生 API 参考图列表构建。
// 覆盖 @主图 各种场景（COS URL、blob URL、视频 URL、多次引用、与 @图片n 混合），
// 确保 §11.83 回退后 @主图 使用 imagePreview 的行为正确。
describe('§11.83 buildSeedanceReferenceImagesApiPayload @主图 场景覆盖', () => {
  const mainCos = 'https://cos.example/main.png';
  const img1Cos = 'https://cos.example/img1.png';
  const img2Cos = 'https://cos.example/img2.png';
  const mainBlob = 'blob:http://localhost:3001/abc123';

  it('@主图 COS URL → API payload 含 @主图', () => {
    const planImages = [
      { token: '@主图', url: mainCos, label: '主图' },
      { token: '@图片1', url: img1Cos, label: '图片1', refImageSlotIndex: 1 },
    ] as any[];
    const uploadedByToken = new Map<string, string>([
      ['@主图', mainCos],
      ['@图片1', img1Cos],
    ]);
    const result = buildSeedanceReferenceImagesApiPayload(planImages, uploadedByToken);
    expect(result).toEqual([mainCos, img1Cos]);
  });

  it('@主图 blob URL → 上传后为 COS URL，API payload 含上传后 COS URL', () => {
    const planImages = [
      { token: '@主图', url: mainBlob, label: '主图' },
      { token: '@图片2', url: img2Cos, label: '图片2', refImageSlotIndex: 1 },
    ] as any[];
    const uploadedByToken = new Map<string, string>([
      ['@主图', mainCos],  // 上传后变为 COS URL
      ['@图片2', img2Cos],
    ]);
    const result = buildSeedanceReferenceImagesApiPayload(planImages, uploadedByToken);
    expect(result).toEqual([mainCos, img2Cos]);
  });

  it('@主图 多次引用 → 去重，仅保留一次', () => {
    const planImages = [
      { token: '@主图', url: mainCos, label: '主图' },
      { token: '@图片1', url: img1Cos, label: '图片1', refImageSlotIndex: 1 },
      { token: '@主图', url: mainCos, label: '主图' },  // 重复
    ] as any[];
    const uploadedByToken = new Map<string, string>([
      ['@主图', mainCos],
      ['@图片1', img1Cos],
    ]);
    const result = buildSeedanceReferenceImagesApiPayload(planImages, uploadedByToken);
    expect(result).toEqual([mainCos, img1Cos]);
  });

  it('仅 @图片n（无 @主图）→ API payload 不含 @主图', () => {
    const planImages = [
      { token: '@图片1', url: img1Cos, label: '图片1', refImageSlotIndex: 0 },
      { token: '@图片2', url: img2Cos, label: '图片2', refImageSlotIndex: 1 },
    ] as any[];
    const uploadedByToken = new Map<string, string>([
      ['@图片1', img1Cos],
      ['@图片2', img2Cos],
    ]);
    const result = buildSeedanceReferenceImagesApiPayload(planImages, uploadedByToken);
    expect(result).toEqual([img1Cos, img2Cos]);
  });

  it('仅 @主图（无 @图片n）→ API payload 仅含 @主图', () => {
    const planImages = [
      { token: '@主图', url: mainCos, label: '主图' },
    ] as any[];
    const uploadedByToken = new Map<string, string>([
      ['@主图', mainCos],
    ]);
    const result = buildSeedanceReferenceImagesApiPayload(planImages, uploadedByToken);
    expect(result).toEqual([mainCos]);
  });

  it('@主图 + @资产:xxx → 均含在 API payload 中', () => {
    const planImages = [
      { token: '@主图', url: mainCos, label: '主图' },
      { token: '@资产:大牙', url: img1Cos, label: '大牙' },
    ] as any[];
    const uploadedByToken = new Map<string, string>([
      ['@主图', mainCos],
      ['@资产:大牙', img1Cos],
    ]);
    const result = buildSeedanceReferenceImagesApiPayload(planImages, uploadedByToken);
    expect(result).toEqual([mainCos, img1Cos]);
  });

  it('@主图 上传失败（无 uploadedByToken）→ 跳过', () => {
    const planImages = [
      { token: '@主图', url: mainBlob, label: '主图' },
      { token: '@图片1', url: img1Cos, label: '图片1', refImageSlotIndex: 1 },
    ] as any[];
    const uploadedByToken = new Map<string, string>([
      // @主图 未上传成功
      ['@图片1', img1Cos],
    ]);
    const result = buildSeedanceReferenceImagesApiPayload(planImages, uploadedByToken);
    expect(result).toEqual([img1Cos]);
  });
});

// §11.83 门禁：promptMentionsMainImageInText —— 检测创意描述中是否 @ 到主图。
describe('§11.83 promptMentionsMainImageInText 边界覆盖', () => {
  it('含 @主图 → true', () => {
    expect(promptMentionsMainImageInText('@图片3出现在@主图中')).toBe(true);
  });

  it('含 @主体 → true', () => {
    expect(promptMentionsMainImageInText('@主体在画面中央')).toBe(true);
  });

  it('不含 @主图/@主体 → false', () => {
    expect(promptMentionsMainImageInText('@图片1和@图片2的组合')).toBe(false);
  });

  it('含 @主视频 → false（不是图片引用）', () => {
    expect(promptMentionsMainImageInText('@主视频作为参考')).toBe(false);
  });

  it('空字符串 → false', () => {
    expect(promptMentionsMainImageInText('')).toBe(false);
  });

  it('undefined → false', () => {
    expect(promptMentionsMainImageInText(undefined)).toBe(false);
  });
});

// §11.83 门禁：pickSeedanceReferencePanelSnapshot —— 从面板数据提取 Seedance 参考图快照。
describe('§11.83 pickSeedanceReferencePanelSnapshot 快照提取', () => {
  const mainCos = 'https://cos.example/main.png';
  const img1Cos = 'https://cos.example/img1.png';

  it('从 seedanceTabConfigs.reference 提取 → 优先使用 tab 数据', () => {
    const data = {
      referenceImages: ['blob:old'],
      referenceImageLabels: ['旧标签'],
      seedanceTabConfigs: {
        reference: {
          referenceImages: [mainCos, img1Cos],
          referenceImageLabels: ['主图', '图片1'],
        },
      },
    } as any;
    const result = pickSeedanceReferencePanelSnapshot(data);
    expect(result.referenceImages).toEqual([mainCos, img1Cos]);
    expect(result.referenceImageLabels).toEqual(['主图', '图片1']);
  });

  it('无 tab 配置 → 回退到 data.referenceImages', () => {
    const data = {
      referenceImages: [mainCos, img1Cos],
      referenceImageLabels: ['主图', '图片1'],
    } as any;
    const result = pickSeedanceReferencePanelSnapshot(data);
    expect(result.referenceImages).toEqual([mainCos, img1Cos]);
    expect(result.referenceImageLabels).toEqual(['主图', '图片1']);
  });

  it('全部空槽 → 返回空 referenceImages', () => {
    const data = {
      referenceImages: ['', ''],
    } as any;
    const result = pickSeedanceReferencePanelSnapshot(data);
    expect(result.referenceImages).toEqual([]);
  });

  it('含空槽 → 保留空槽结构（不压缩）', () => {
    const data = {
      referenceImages: ['', img1Cos, ''],
      referenceImageLabels: ['图片1', '图片2', '图片3'],
    } as any;
    const result = pickSeedanceReferencePanelSnapshot(data);
    expect(result.referenceImages).toEqual(['', img1Cos, '']);
    expect(result.referenceImageLabels).toEqual(['图片1', '图片2', '图片3']);
  });

  it('无标签 → referenceImageLabels 为 undefined', () => {
    const data = {
      referenceImages: [mainCos],
    } as any;
    const result = pickSeedanceReferencePanelSnapshot(data);
    expect(result.referenceImages).toEqual([mainCos]);
    expect(result.referenceImageLabels).toBeUndefined();
  });
});

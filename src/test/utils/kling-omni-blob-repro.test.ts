/**
 * 临时验证测试：用户报告"可灵还是有问题.json"
 * 场景：最终节点（可灵3.0 Omni）面板含 blob URL 时，§11.76 修复会把 blob URL 写回 gp，
 *      然后 §11.65 过滤时主图（https）被 snapKeys 误过滤掉，导致标签变成 ['图片1','祭司老人','图片3']。
 */
import { describe, it, expect } from 'vitest';
import { repairOmniMultiGenerationParamsFromPanel, pickStillImageRecoveryApiReferenceImages } from '../../../utils/referencedMediaRun';
import {
  buildOmniMultiTabDetailsReferencePreview,
  buildStillImageGenNodeDetailsReferencePreview,
} from '../../../utils/nodeDetailsPreview';

describe('可灵还是有问题.json - 最终节点 blob URL 污染 gp 链路验证', () => {
  // 用户报告 JSON 中的真实数据
  const mainCos =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/3b4f58b8-3cc9-4c21-b746-d25b0113c01d.png';
  const refCos =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/871f0e8f-7297-4ddf-9982-a465dd3e30d5.png';
  const blob1 = 'blob:http://localhost:3001/5aead162-fa9a-4f1c-a0a0-339f38760ae2';
  const blob2 = 'blob:http://localhost:3001/47c54214-7f22-4310-a9c2-cdee46600b1d';
  const prompt = '@资产:祭司老人出现在@主图中与@主图的角色交流起来';

  it('场景A: 面板槽含 blob URL（用户刚运行完，blob 未 sanitize）→ gp 被污染', () => {
    const data = {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      // 面板 3 槽：blob + https + blob（用户实际状态）
      klingOmniMultiReferenceImages: [blob1, refCos, blob2],
      referenceImageLabels: ['图片1', '祭司老人', '图片3'],
      generationParams: {
        model: '可灵3.0 Omni',
        referenceImages: [mainCos, refCos], // gp 原本正确的 2 张 https
        referenceImageLabels: ['主图', '祭司老人'],
      },
    } as any;

    const result = repairOmniMultiGenerationParamsFromPanel(data);
    console.log('场景A repair 结果:', JSON.stringify(result, null, 2));

    // 期望：不应该把 blob URL 写回 gp
    // 实际（bug）：把 blob URL 写回 gp，污染 generationParams
    expect(result).toBeDefined();
    if (result) {
      // 当前实现的实际行为：mergedRefs = [blob1, refCos, blob2]
      // 这会把 blob URL 写回 gp，导致后续 §11.65 过滤错误
      console.log('referenceImages:', result.referenceImages);
      console.log('referenceImageLabels:', result.referenceImageLabels);
    }
  });

  it('场景B: gp 被 blob 污染后，§11.65 过滤导致主图被误删', () => {
    // 模拟 §11.76 修复后的 gp（被污染）
    const panelSource = {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      imagePreview: mainCos,
      klingOmniMultiReferenceImages: [blob1, refCos, blob2],
      referenceImageLabels: ['图片1', '祭司老人', '图片3'],
      klingOmniMultiPrompt: prompt,
      prompt,
    } as any;

    // gp 被污染后的 snapshotRefs
    const snapshotRefs = [blob1, refCos, blob2];
    const snapshotLabels = ['图片1', '祭司老人', '图片3'];

    const preview = buildOmniMultiTabDetailsReferencePreview({
      panelSource,
      urlPool: [mainCos, blob1, refCos, blob2],
      snapshotRefs,
      snapshotLabels,
      prompt,
      movUrlSet: new Set(),
    });

    console.log('场景B preview labels:', preview.referenceImageDetailItems.map((i) => i.label));
    console.log('场景B preview urls:', preview.referenceImages);
    console.log('场景B detail items:', JSON.stringify(preview.referenceImageDetailItems, null, 2));

    // 期望：应该返回 ['主图', '祭司老人']
    // 实际（bug）：主图被过滤掉
  });

  it('场景D: 修复方案验证 - §11.65 过滤时排除 blob/data URL', () => {
    // 验证修复方案：§11.65 生成 snapKeys 时过滤掉 blob:/data: URL
    const panelSource = {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      imagePreview: mainCos,
      klingOmniMultiReferenceImages: [blob1, refCos, blob2],
      referenceImageLabels: ['图片1', '祭司老人', '图片3'],
      klingOmniMultiPrompt: prompt,
      prompt,
    } as any;

    // gp 被污染后的 snapshotRefs（含 blob）
    const snapshotRefs = [blob1, refCos, blob2];
    const snapshotLabels = ['图片1', '祭司老人', '图片3'];

    // 模拟修复后的 snapKeys：过滤掉 blob:/data: URL
    const snapKeysFixed = new Set(
      snapshotRefs
        .filter((u) => !/^(blob|data):/i.test(u))
        .map((u) => u)
        .filter(Boolean)
    );
    console.log('场景D 修复后 snapKeys:', [...snapKeysFixed]);
    console.log('场景D 修复后主图 mainCos 是否会被保留:', !/^(blob|data):/i.test(mainCos));

    // 修复后 snapKeys 应该只包含 refCos（https），mainCos 不在 snapKeys 但应被保留
  });

  it('场景C: gp 未被污染（原值 https）→ §11.65 正确过滤', () => {
    const panelSource = {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      imagePreview: mainCos,
      klingOmniMultiReferenceImages: [blob1, refCos, blob2],
      referenceImageLabels: ['图片1', '祭司老人', '图片3'],
      klingOmniMultiPrompt: prompt,
      prompt,
    } as any;

    // gp 未被污染（原值 https）
    const snapshotRefs = [mainCos, refCos];
    const snapshotLabels = ['主图', '祭司老人'];

    const preview = buildOmniMultiTabDetailsReferencePreview({
      panelSource,
      urlPool: [mainCos, blob1, refCos, blob2],
      snapshotRefs,
      snapshotLabels,
      prompt,
      movUrlSet: new Set(),
    });

    console.log('场景C preview labels:', preview.referenceImageDetailItems.map((i) => i.label));
    console.log('场景C preview urls:', preview.referenceImages);

    // 期望：返回 ['主图', '祭司老人']
  });
});

describe('可灵还是有问题.json - 中间节点（image 2）少图验证', () => {
  // 用户报告 JSON 中间节点数据
  const blob0 = 'blob:http://localhost:3001/227cd7a8-b587-494f-b966-2acb3752d37c';
  const imgJungle =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/89876cdd-11d8-426a-a6ac-8584f0ebfbc6.png';
  const imgTooth =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/a9d08f59-9b88-4d3f-bad6-bf810922daaf.png';
  const prompt = '@资产:大牙-有牙出现在@资产:原始丛林小路中';

  it('场景E: image 2 中间节点（gp 无 referenceImages）→ 走 pickStillImageRecoveryApiReferenceImages', () => {
    const panelSource = {
      selectedModel: 'image 2',
      prompt,
      referenceImages: [blob0, imgJungle, imgTooth],
      referenceImageLabels: ['图片1', '原始丛林小路', '大牙-有牙'],
      panelMainSlotVisible: false,
      panelMainImageUrl: '/flowgen-api/projects/14/assets/62803dee-e53e-4f51-b0c7-b297829bea54/file',
      // 注意：generationParams 没有 referenceImages 字段
      generationParams: {
        model: 'image 2',
        prompt,
        taskId: '1785962, 1785965',
        aspectRatio: '16:9',
      },
    } as any;

    const result = buildStillImageGenNodeDetailsReferencePreview({
      panelSource,
      snapRefs: [], // gp 无 referenceImages
      snapLabels: undefined,
      prompt,
      projectAssets: [], // 模拟 projectAssets 未加载
      isOutputLike: false,
    });

    // §11.80 修复后：matchAllPromptMediaTokens 兜底识别 @资产:xxx，
    //              pickStillImageRecoveryApiReferenceImages 用 referenceImageLabels 匹配面板槽，
    //              返回 2 张 COS URL（@资产:大牙-有牙 → imgTooth, @资产:原始丛林小路 → imgJungle）
    expect(result).not.toBeNull();
    expect(result!.referenceImages).toHaveLength(2);
    expect(result!.referenceImages).toContain(imgJungle);
    expect(result!.referenceImages).toContain(imgTooth);
    const labels = result!.referenceImageDetailItems.map((i) => i.label);
    expect(labels).toContain('大牙-有牙');
    expect(labels).toContain('原始丛林小路');
  });

  it('场景F: image 2 中间节点 - 不传 projectAssets（模拟未加载）', () => {
    const panelSource = {
      selectedModel: 'image 2',
      prompt,
      referenceImages: [blob0, imgJungle, imgTooth],
      referenceImageLabels: ['图片1', '原始丛林小路', '大牙-有牙'],
      panelMainSlotVisible: false,
      generationParams: {
        model: 'image 2',
        prompt,
      },
    } as any;

    // 不传 projectAssets，模拟资产库未加载场景
    const result = buildStillImageGenNodeDetailsReferencePreview({
      panelSource,
      snapRefs: [],
      snapLabels: undefined,
      prompt,
      projectAssets: undefined,
      isOutputLike: false,
    });

    // §11.80 修复后：projectAssets 为 undefined 时同样兜底识别 @资产:xxx
    expect(result).not.toBeNull();
    expect(result!.referenceImages).toHaveLength(2);
    expect(result!.referenceImages).toContain(imgJungle);
    expect(result!.referenceImages).toContain(imgTooth);
  });

  it('场景G: §11.79 snapKeys 排除 blob:/data: URL，COS 参考图不被误过滤', () => {
    // 验证修复方案2：§11.65 snapKeys 排除 blob:/data: URL
    // 模拟 Omni 最终节点：snapRefs 只含 blob（gp 被 blob 污染），dedupedPanel 含 COS 参考图
    const gRefCos =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/871f0e8f-7297-4ddf-9982-a465dd3e30d5.png';
    const gBlob1 = 'blob:http://localhost:3001/5aead162-fa9a-4f1c-a0a0-339f38760ae2';
    const gBlob2 = 'blob:http://localhost:3001/47c54214-7f22-4310-a9c2-cdee46600b1d';
    const gPrompt = '@资产:祭司老人出现在@主图中';
    const panelSource = {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      klingOmniMultiReferenceImages: [gBlob1, gRefCos, gBlob2],
      referenceImageLabels: ['图片1', '祭司老人', '图片3'],
      klingOmniMultiPrompt: gPrompt,
      prompt: gPrompt,
    } as any;

    // snapRefs 只含 blob（gp 被 blob 污染场景）
    const snapshotRefs = [gBlob1, gBlob2];
    const snapshotLabels = ['图片1', '图片3'];

    const preview = buildOmniMultiTabDetailsReferencePreview({
      panelSource,
      urlPool: [gRefCos, gBlob1, gBlob2],
      snapshotRefs,
      snapshotLabels,
      prompt: gPrompt,
      movUrlSet: new Set(),
    });

    // §11.79 修复后：snapKeys 排除 blob → snapKeys 为空 → 不触发 §11.65 过滤 → gRefCos 保留
    // 修复前：snapKeys 含 blob key，gRefCos（COS）key 不匹配 → 被误过滤
    const urls = preview.referenceImages.map((u) => String(u || '').trim()).filter(Boolean);
    expect(urls).toContain(gRefCos);
  });
});

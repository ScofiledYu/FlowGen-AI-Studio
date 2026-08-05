import { describe, expect, it } from 'vitest';
import type { NodeData } from '../../../types';
import {
  buildPromptMediaRefLabels,
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
  isSeedanceReferenceMovMainVideo,
  resolveSeedanceReferenceMainVideoUrl,
  promptMentionsMainVideoForNodeData,
} from '../../../utils/promptMediaRefs';
import { buildReferenceVideoDetailItems } from '../../../utils/nodeDetailsPreview';

const SEEDANCE_REF_MAIN_VIDEO: Partial<NodeData> = {
  selectedModel: 'seedance2.0 (高质量版)',
  seedanceGenerationMode: 'reference',
  imagePreview:
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/demo/sample-ref.mp4',
  referenceMovs: [
    {
      url: 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/demo/sample-ref.mp4',
    },
  ],
};

describe('Seedance 参考生 @主视频 与面板角标一致', () => {
  const videoUrl = SEEDANCE_REF_MAIN_VIDEO.imagePreview!;

  it('buildPromptMediaRefLabels 使用 @主视频 而非 @视频1', () => {
    const ctx = buildPromptMediaRefContextFromNode(SEEDANCE_REF_MAIN_VIDEO as NodeData);
    const labels = buildPromptMediaRefLabels(SEEDANCE_REF_MAIN_VIDEO as NodeData, ctx);
    expect(labels.some((l) => l.insertText === '@主视频')).toBe(true);
    expect(labels.some((l) => l.insertText === '@视频1')).toBe(false);
  });

  it('collectReferencedMediaFromPrompt 解析 @主视频', () => {
    const data = {
      ...SEEDANCE_REF_MAIN_VIDEO,
      prompt: '参考@主视频的动作',
    } as NodeData;
    const ctx = buildPromptMediaRefContextFromNode(data);
    const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, new Map());
    expect(plan.videos.find((v) => v.label === '主视频')?.url).toBe(videoUrl);
  });

  it('非主视频 referenceMovs 仍用 @视频1', () => {
    const data = {
      ...SEEDANCE_REF_MAIN_VIDEO,
      imagePreview: 'https://example.com/main.png',
      referenceMovs: [
        { url: 'https://example.com/ref-a.mp4' },
      ],
    } as NodeData;
    const ctx = buildPromptMediaRefContextFromNode(data);
    const labels = buildPromptMediaRefLabels(data, ctx);
    expect(labels.some((l) => l.insertText === '@视频1')).toBe(true);
    expect(labels.some((l) => l.insertText === '@主视频')).toBe(false);
  });

  it('MOV poster 主预览 + referenceMovs 成片 → @主视频', () => {
    const mp4 =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/out.mp4';
    const data = {
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: '/flowgen-api/projects/14/node-media/poster.jpg/file',
      videoPosterDataUrl: '/flowgen-api/projects/14/node-media/poster.jpg/file',
      generationParams: { outputUrl: mp4 },
      referenceMovs: [{ url: mp4 }],
    } as NodeData;
    expect(resolveSeedanceReferenceMainVideoUrl(data)).toBe(mp4);
    expect(isSeedanceReferenceMovMainVideo(data, mp4)).toBe(true);
    const ctx = buildPromptMediaRefContextFromNode(data);
    const labels = buildPromptMediaRefLabels(data, ctx);
    expect(labels.some((l) => l.insertText === '@主视频')).toBe(true);
    expect(labels.some((l) => l.insertText === '@视频1')).toBe(false);
  });
});

// §11.71 门禁：Seedance 参考生 Node Details 参考视频角标与面板一致
// 防回归「主视频被显示成视频1」+「主视频存在时视频1/视频2 索引错位」
describe('§11.71 Seedance 参考生 Node Details 参考视频角标', () => {
  const mainUrl = 'https://example.com/main.mp4';
  const v1Url = 'https://example.com/v1.mp4';
  const v2Url = 'https://example.com/v2.mp4';

  it('场景1: 单主视频 → [主视频]', () => {
    const data = {
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'reference',
      imagePreview: mainUrl,
      referenceMovs: [{ url: mainUrl }],
    } as NodeData;
    const items = buildReferenceVideoDetailItems(data, data.referenceMovs!);
    expect(items.map((i) => i.label)).toEqual(['主视频']);
  });

  it('场景2: 主视频 + 视频1 + 视频2 → [主视频, 视频1, 视频2]（修复前会错位成 [视频1, 视频2, 视频3]）', () => {
    const data = {
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'reference',
      imagePreview: mainUrl,
      referenceMovs: [{ url: mainUrl }, { url: v1Url }, { url: v2Url }],
    } as NodeData;
    const items = buildReferenceVideoDetailItems(data, data.referenceMovs!);
    expect(items.map((i) => i.label)).toEqual(['主视频', '视频1', '视频2']);
  });

  it('场景3: 无主视频（imagePreview 为图片）+ 视频1 + 视频2 → [视频1, 视频2]', () => {
    const data = {
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'reference',
      imagePreview: 'https://example.com/poster.png',
      referenceMovs: [{ url: v1Url }, { url: v2Url }],
    } as NodeData;
    const items = buildReferenceVideoDetailItems(data, data.referenceMovs!);
    expect(items.map((i) => i.label)).toEqual(['视频1', '视频2']);
  });

  it('场景4: 主视频在中间位置（视频1, 主视频, 视频2）→ [视频1, 主视频, 视频2]（验证序号不依赖主视频位置）', () => {
    const data = {
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: mainUrl,
      referenceMovs: [{ url: v1Url }, { url: mainUrl }, { url: v2Url }],
    } as NodeData;
    const items = buildReferenceVideoDetailItems(data, data.referenceMovs!);
    expect(items.map((i) => i.label)).toEqual(['视频1', '主视频', '视频2']);
  });

  it('场景5: MOV poster 主预览 + referenceMovs 成片（outputUrl 主视频）→ [主视频]', () => {
    const data = {
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: '/flowgen-api/projects/14/node-media/poster.jpg/file',
      videoPosterDataUrl: '/flowgen-api/projects/14/node-media/poster.jpg/file',
      generationParams: { outputUrl: mainUrl },
      referenceMovs: [{ url: mainUrl }],
    } as NodeData;
    const items = buildReferenceVideoDetailItems(data, data.referenceMovs!);
    expect(items.map((i) => i.label)).toEqual(['主视频']);
  });

  it('场景6: 非参考生模式（seedance text 模式）不进 Seedance 分支，走原 else 逻辑', () => {
    const data = {
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'text',
      imagePreview: mainUrl,
      referenceMovs: [{ url: mainUrl }, { url: v1Url }],
    } as NodeData;
    const items = buildReferenceVideoDetailItems(data, data.referenceMovs!);
    // 非参考生模式不走 §11.71 分支，标签由原 ordIdx/fallback 逻辑决定（不应误判为"主视频"）
    expect(items.every((i) => i.label.startsWith('视频'))).toBe(true);
  });

  it('场景7: 保留 url 与 posterDataUrl 字段不丢失', () => {
    const data = {
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'reference',
      imagePreview: mainUrl,
      referenceMovs: [
        { url: mainUrl, posterDataUrl: 'data:image/png;base64,aaa' },
        { url: v1Url },
      ],
    } as NodeData;
    const items = buildReferenceVideoDetailItems(data, data.referenceMovs!);
    expect(items[0].url).toBe(mainUrl);
    expect(items[0].posterDataUrl).toBe('data:image/png;base64,aaa');
    expect(items[1].url).toBe(v1Url);
    expect(items[1].posterDataUrl).toBeUndefined();
  });
});

// §11.84 门禁：Seedance 2.0 输出节点 referenceMovs 含上游参考视频，
// 但 imagePreview/outputUrl 是生成结果视频（与参考视频 URL 不同），
// 此时 prompt 明确包含 @主视频，参考视频仍应被识别为「主视频」。
// 防回归「输出节点参考视频标签显示为视频1而非主视频」。
describe('§11.84 Seedance 2.0 输出节点 @主视频 标签（imagePreview 与参考视频不同）', () => {
  const refVideoUrl = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/43213994-e709-4e54-aa8e-48c4a7e66742.mp4';
  const generatedVideoUrl = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/3d31869b-f9da-48c4-885b-dd8b65058c6d.mp4';

  it('场景1: 输出节点 imagePreview/outputUrl 与参考视频不同，prompt 含 @主视频 → 参考视频为主视频', () => {
    const data = {
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: generatedVideoUrl,  // 生成结果视频，非参考视频
      prompt: '@资产:祭司老人出现在@主视频中感到害怕',
      generationParams: {
        model: 'seedance2.0 (急速版)',
        outputUrl: generatedVideoUrl,   // 生成结果视频
        referenceMovs: [{ url: refVideoUrl }],  // 上游参考视频
        prompt: '@资产:祭司老人出现在@主视频中感到害怕',
      },
      referenceMovs: [{ url: refVideoUrl }],
    } as NodeData;

    // resolveSeedanceReferenceMainVideoUrl 应通过 @主视频 prompt 守卫返回参考视频
    expect(promptMentionsMainVideoForNodeData(data)).toBe(true);
    expect(resolveSeedanceReferenceMainVideoUrl(data)).toBe(refVideoUrl);
    expect(isSeedanceReferenceMovMainVideo(data, refVideoUrl)).toBe(true);
    expect(isSeedanceReferenceMovMainVideo(data, generatedVideoUrl)).toBe(false);
  });

  it('场景2: buildReferenceVideoDetailItems 输出节点标签为「主视频」', () => {
    const data = {
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: generatedVideoUrl,
      prompt: '@资产:祭司老人出现在@主视频中感到害怕',
      generationParams: {
        model: 'seedance2.0 (急速版)',
        outputUrl: generatedVideoUrl,
        referenceMovs: [{ url: refVideoUrl }],
        prompt: '@资产:祭司老人出现在@主视频中感到害怕',
      },
      referenceMovs: [{ url: refVideoUrl }],
    } as NodeData;

    const items = buildReferenceVideoDetailItems(data, data.referenceMovs!);
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('主视频');
    expect(items[0].url).toBe(refVideoUrl);
  });

  it('场景3: 输出节点 imagePreview 与参考视频相同时，原匹配门禁仍生效（不依赖 prompt 守卫）', () => {
    const sameUrl = refVideoUrl;
    const data = {
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: sameUrl,  // 与参考视频相同
      prompt: '参考视频的动作',  // 无 @主视频
      generationParams: {
        model: 'seedance2.0 (急速版)',
        outputUrl: sameUrl,
        referenceMovs: [{ url: sameUrl }],
      },
      referenceMovs: [{ url: sameUrl }],
    } as NodeData;

    // 即使 prompt 不含 @主视频，soleMov 匹配 outputUrl 门禁仍生效
    expect(promptMentionsMainVideoForNodeData(data)).toBe(false);
    expect(resolveSeedanceReferenceMainVideoUrl(data)).toBe(sameUrl);
    expect(isSeedanceReferenceMovMainVideo(data, sameUrl)).toBe(true);
  });

  it('场景4: imagePreview 为图片（非视频），prompt 含 @主视频，参考视频仍为主视频', () => {
    const data = {
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: 'https://cos.example/poster.png',  // 图片，非视频
      prompt: '@主视频中的角色开始移动',
      generationParams: {
        model: 'seedance2.0 (急速版)',
        referenceMovs: [{ url: refVideoUrl }],
      },
      referenceMovs: [{ url: refVideoUrl }],
    } as NodeData;

    // imagePreview 是图片，不匹配 soleMov；prompt 含 @主视频 → 返回 soleMov
    expect(resolveSeedanceReferenceMainVideoUrl(data)).toBe(refVideoUrl);
    expect(isSeedanceReferenceMovMainVideo(data, refVideoUrl)).toBe(true);
  });

  it('场景5: 无 @主视频 且 imagePreview 为图片 → 不误判为主视频', () => {
    const data = {
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: 'https://cos.example/poster.png',
      prompt: '参考视频的动作',
      generationParams: {
        model: 'seedance2.0 (急速版)',
        referenceMovs: [{ url: refVideoUrl }],
      },
      referenceMovs: [{ url: refVideoUrl }],
    } as NodeData;

    // 无 @主视频，imagePreview 非视频 → 不返回主视频
    expect(resolveSeedanceReferenceMainVideoUrl(data)).toBeUndefined();
    expect(isSeedanceReferenceMovMainVideo(data, refVideoUrl)).toBe(false);
  });
});

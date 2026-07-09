import { describe, expect, it } from 'vitest';
import type { NodeData } from '../../../types';
import {
  buildPromptMediaRefLabels,
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
  isSeedanceReferenceMovMainVideo,
  resolveSeedanceReferenceMainVideoUrl,
} from '../../../utils/promptMediaRefs';

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

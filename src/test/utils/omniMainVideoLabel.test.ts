import { describe, expect, it } from 'vitest';
import type { NodeData } from '../../../types';
import {
  buildPromptMediaRefLabels,
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
  isOmniTabVideoMainVideoReference,
} from '../../../utils/promptMediaRefs';

/** 900788.json node_20：指令变换 @主视频，imagePreview=PNG 截帧 */
const OMNI_INSTRUCTION_MAIN_VIDEO_NODE: Partial<NodeData> = {
  selectedModel: '可灵3.0 Omni',
  klingOmniTab: 'instruction',
  prompt: '@主视频中角色替换@图片3中的角色',
  klingOmniInstructionPrompt: '@主视频中角色替换@图片3中的角色',
  imagePreview:
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/1b56e9bf-db88-4964-b958-571508c1ed0d.png',
  klingOmniInstructionVideoUrl:
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/b516622f-5c16-470a-b491-02f2e4c5e3fc.mp4',
  klingOmniInstructionVideoPreviewUrl:
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/b516622f-5c16-470a-b491-02f2e4c5e3fc.mp4',
  klingOmniInstructionReferenceImages: [
    '',
    '',
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/1b56e9bf-db88-4964-b958-571508c1ed0d.png',
  ],
  referenceMovs: [
    {
      url: 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/b516622f-5c16-470a-b491-02f2e4c5e3fc.mp4',
    },
  ],
};

describe('Omni instruction @主视频 when imagePreview is PNG poster', () => {
  const videoUrl = OMNI_INSTRUCTION_MAIN_VIDEO_NODE.klingOmniInstructionVideoUrl!;

  it('buildPromptMediaRefLabels uses 主视频 not 视频1', () => {
    const ctx = buildPromptMediaRefContextFromNode(OMNI_INSTRUCTION_MAIN_VIDEO_NODE as NodeData);
    const labels = buildPromptMediaRefLabels(OMNI_INSTRUCTION_MAIN_VIDEO_NODE as NodeData, ctx);
    const mainVideo = labels.find((l) => l.insertText === '@主视频');
    expect(mainVideo).toBeDefined();
    expect(labels.some((l) => l.insertText === '@视频1')).toBe(false);
  });

  it('collectReferencedMediaFromPrompt resolves @主视频 from instruction slot', () => {
    const data = OMNI_INSTRUCTION_MAIN_VIDEO_NODE as NodeData;
    const ctx = buildPromptMediaRefContextFromNode(data);
    const plan = collectReferencedMediaFromPrompt(
      data.prompt!,
      data,
      ctx,
      new Map()
    );
    const mainVideo = plan.videos.find((p) => p.label === '主视频');
    expect(mainVideo?.url).toBe(videoUrl);
  });

  it('isOmniTabVideoMainVideoReference true for bound mp4', () => {
    expect(
      isOmniTabVideoMainVideoReference(
        OMNI_INSTRUCTION_MAIN_VIDEO_NODE,
        videoUrl,
        'instruction'
      )
    ).toBe(true);
  });
});

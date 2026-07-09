import { describe, expect, it } from 'vitest';
import {
  buildNodeDetailsVideoLabelSource,
  buildReferenceVideoDetailItems,
} from '../../../utils/nodeDetailsPreview';

/** d:\990.json node_2：Omni 视频参考 tab，prompt @视频1 */
const OMNI_VIDEO_REF_NODE = {
  selectedModel: '可灵3.0 Omni',
  klingOmniTab: 'video' as const,
  prompt: '@主图中的角色参考@视频1的动作运动起来',
  klingOmniVideoPrompt: '@主图中的角色参考@视频1的动作运动起来',
  imagePreview:
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/600515a5-123f-4d2c-a6fa-32239d3af257.png',
  klingOmniVideoUrl:
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/d4e6dfaa-ad65-4deb-858b-d794ca79016e.mp4',
  klingOmniVideoReferenceImages: [] as string[],
  referenceMovs: [
    {
      url: 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/d4e6dfaa-ad65-4deb-858b-d794ca79016e.mp4',
    },
  ],
  generationParams: {
    model: '可灵3.0 Omni',
    prompt: '@主图中的角色参考@视频1的动作运动起来',
    klingOmniTab: 'video' as const,
    klingOmniVideoUrl:
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/d4e6dfaa-ad65-4deb-858b-d794ca79016e.mp4',
    referenceMovs: [
      {
        url: 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/d4e6dfaa-ad65-4deb-858b-d794ca79016e.mp4',
      },
    ],
  },
};

describe('Node Details reference video labels (990.json)', () => {
  it('Omni video tab @视频1 → 视频1 not generic 视频', () => {
    const labelSource = buildNodeDetailsVideoLabelSource(OMNI_VIDEO_REF_NODE, {
      prompt: OMNI_VIDEO_REF_NODE.prompt,
      model: '可灵3.0 Omni',
    });
    const items = buildReferenceVideoDetailItems(
      labelSource,
      OMNI_VIDEO_REF_NODE.referenceMovs
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe('视频1');
  });

  it('MOV output uses generationParams snapshot for label', () => {
    const movNode = {
      selectedModel: '可灵3.0 Omni',
      imagePreview:
        'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/322f6589-5a53-4671-a5f8-d69f7eaf8bfc.mp4',
      generationParams: OMNI_VIDEO_REF_NODE.generationParams,
    };
    const labelSource = buildNodeDetailsVideoLabelSource(movNode, {
      prompt: OMNI_VIDEO_REF_NODE.prompt,
      model: '可灵3.0 Omni',
    });
    const items = buildReferenceVideoDetailItems(
      labelSource,
      movNode.generationParams.referenceMovs
    );
    expect(items[0]?.label).toBe('视频1');
  });
});

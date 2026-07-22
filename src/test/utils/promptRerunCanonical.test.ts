import { describe, expect, it } from 'vitest';
import type { NodeData } from '../../../types.ts';
import {
  buildCanonicalInspectorPromptPatch,
  getCanonicalInspectorPromptText,
  getNodeInspectorPromptText,
} from '../../../utils/promptMediaRefs.ts';

const MIXED_PROMPT = '景别：@图片3全景/高角度\n画面：萧道@资产:萧道 与 @图片2';
const PROJ = 'rerun-prompt-proj';
const xiaodao = `/flowgen-api/projects/${PROJ}/assets/id-xd/file`;
const xiamo = `/flowgen-api/projects/${PROJ}/assets/id-xm/file`;
const street = `/flowgen-api/projects/${PROJ}/assets/id-street/file`;
const assets = [
  { slug: '萧道', name: '萧道', url: xiaodao },
  { slug: '夏茉', name: '夏茉', url: xiamo },
  { slug: '荒塘镇街道1', name: '荒塘镇街道1', url: street },
];
const baseRefs = {
  referenceImages: [xiaodao, xiamo, street],
  referenceImageLabels: ['萧道', '夏茉', '荒塘镇街道1'],
};

/** 模拟 FlowEditor §5.8.7：运行快照可 canonical，节点 Inspector 字段保持用户原文 */
function simulateRunStartWithoutPromptWriteback(data: NodeData): {
  inspectorPrompt: string;
  runSnapshotPrompt: string;
} {
  const patch = buildCanonicalInspectorPromptPatch(data, assets);
  const runSnapshot = patch ? ({ ...data, ...patch } as NodeData) : data;
  return {
    inspectorPrompt: getNodeInspectorPromptText(data),
    runSnapshotPrompt: getCanonicalInspectorPromptText(runSnapshot, assets),
  };
}

/** 模拟 Seedance 参考生运行收尾：refTab.prompt 须保留用户原文 */
function simulateSeedanceRefTabPersistPrompt(data: NodeData): string {
  return getNodeInspectorPromptText(data);
}

describe('getCanonicalInspectorPromptText rerun stability — all models', () => {
  const modelRows: Array<{ name: string; data: NodeData }> = [
    {
      name: 'Nano Banana 2.0',
      data: {
        selectedModel: 'Nano Banana 2.0',
        prompt: MIXED_PROMPT,
        taskId: 't1',
        ...baseRefs,
      } as NodeData,
    },
    {
      name: 'image 2',
      data: {
        selectedModel: 'image 2',
        prompt: MIXED_PROMPT,
        taskId: 't1',
        ...baseRefs,
      } as NodeData,
    },
    {
      name: '可灵3.0 Omni multi',
      data: {
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'multi',
        klingOmniMultiPrompt: MIXED_PROMPT,
        prompt: '顶层旧',
        taskId: 't1',
        klingOmniMultiReferenceImages: [...baseRefs.referenceImages],
        referenceImageLabels: [...baseRefs.referenceImageLabels],
      } as NodeData,
    },
    {
      name: 'Seedance2.0 参考生',
      data: {
        selectedModel: 'seedance2.0 (急速版)',
        seedanceGenerationMode: 'reference',
        prompt: '顶层旧@图片3',
        seedanceTabConfigs: {
          reference: { prompt: MIXED_PROMPT, ...baseRefs },
        },
        taskId: 't1',
        ...baseRefs,
      } as NodeData,
    },
    {
      name: '即梦3.0 Pro',
      data: {
        selectedModel: '即梦3.0 Pro',
        prompt: MIXED_PROMPT,
        imagePreview: xiaodao,
        taskId: 't1',
        ...baseRefs,
      } as NodeData,
    },
    {
      name: 'vidu 2.0',
      data: {
        selectedModel: 'vidu 2.0',
        prompt: MIXED_PROMPT,
        firstFrameImageUrl: xiaodao,
        taskId: 't1',
        ...baseRefs,
      } as NodeData,
    },
  ];

  for (const { name, data } of modelRows) {
    it(`${name}: inspector prompt unchanged on rerun start`, () => {
      const { inspectorPrompt, runSnapshotPrompt } = simulateRunStartWithoutPromptWriteback(data);
      expect(inspectorPrompt).toBe(MIXED_PROMPT);
      expect(getNodeInspectorPromptText(data)).toBe(MIXED_PROMPT);
      expect(runSnapshotPrompt).toContain('@资产:荒塘镇街道1');
      expect(buildCanonicalInspectorPromptPatch(data, assets)).not.toBeUndefined();
    });
  }

  it('Seedance 参考生运行收尾 refTab.prompt 保留用户原文', () => {
    const data = modelRows.find((r) => r.name === 'Seedance2.0 参考生')!.data;
    expect(simulateSeedanceRefTabPersistPrompt(data)).toBe(MIXED_PROMPT);
    expect(
      getCanonicalInspectorPromptText(data, assets)
    ).not.toBe(MIXED_PROMPT);
  });

  it('still remaps bare @图片n when no @资产 in prompt (API canonical)', () => {
    const data = {
      selectedModel: 'Nano Banana 2.0',
      prompt: '@图片3 全景',
      referenceImages: ['https://x/a.png', 'https://x/b.png', street],
      referenceImageLabels: ['萧道', '夏茉', '荒塘镇街道1'],
    } as NodeData;
    const canon = getCanonicalInspectorPromptText(data, assets);
    expect(canon).toContain('@资产:荒塘镇街道1');
    expect(canon).not.toMatch(/@图片3\b/);
  });
});

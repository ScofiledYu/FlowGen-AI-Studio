/**
 * 跨模型审计：未 @主图 时画布缩略图是否误显主图（对齐 20260710 Seedance「熊二」问题）
 *
 * 覆盖：
 * A) 脏数据展示：imagePreview===panelMainImageUrl（主图备份），纯 @资产 / @图片n
 * B) 运行 patch：upload map 有值 / 空 map 回退 mergedPanelRefs
 *
 * npx tsx scripts/20260710-all-models-asset-thumb-audit-test.ts
 */
import type { NodeData } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2 } from '../types.ts';
import {
  buildPanelImagePreviewPatchAfterRun,
  resolveCanvasNodePreviewUrl,
} from '../utils/referencedMediaRun.ts';
import {
  promptMentionsAnyImageRefForNodeData,
  promptMentionsMainImageForNodeData,
} from '../utils/promptMediaRefs.ts';

const MAIN = 'https://cos.example/main-bear.png';
const REF0 = 'https://cos.example/ref-path.png';
const REF1 = 'https://cos.example/ref-juan.png';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  [OK] ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    failures.push(name + (detail ? `: ${detail}` : ''));
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

type ModelCase = {
  id: string;
  data: Partial<NodeData>;
  promptAsset: string;
  promptPic: string;
};

const cases: ModelCase[] = [
  {
    id: 'Nano Banana 2.0',
    data: { selectedModel: MODEL_NANO_BANANA_2 },
    promptAsset: '参考@资产:原始丛林小路与@资产:卷卷',
    promptPic: '参考@图片1与@图片2',
  },
  {
    id: 'image 2',
    data: { selectedModel: MODEL_IMAGE_2 },
    promptAsset: '参考@资产:原始丛林小路与@资产:卷卷',
    promptPic: '参考@图片1与@图片2',
  },
  {
    id: '可灵3.0 Omni multi',
    data: { selectedModel: '可灵3.0 Omni', klingOmniTab: 'multi' },
    promptAsset: '参考@资产:原始丛林小路与@资产:卷卷',
    promptPic: '参考@图片1与@图片2',
  },
  {
    id: '可灵3.0 Omni instruction',
    data: {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'instruction',
      klingOmniInstructionPrompt: '参考@资产:原始丛林小路与@资产:卷卷',
    },
    promptAsset: '参考@资产:原始丛林小路与@资产:卷卷',
    promptPic: '参考@图片1与@图片2',
  },
  {
    id: '可灵3.0 Omni video',
    data: {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'video',
      klingOmniVideoPrompt: '参考@资产:原始丛林小路与@资产:卷卷',
    },
    promptAsset: '参考@资产:原始丛林小路与@资产:卷卷',
    promptPic: '参考@图片1与@图片2',
  },
  {
    id: 'seedance2.0 急速 参考生',
    data: {
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
    },
    promptAsset: '参考@资产:原始丛林小路与@资产:卷卷',
    promptPic: '参考@图片1与@图片2',
  },
  {
    id: 'seedance2.0 高质量 参考生',
    data: {
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'reference',
    },
    promptAsset: '参考@资产:原始丛林小路与@资产:卷卷',
    promptPic: '参考@图片1与@图片2',
  },
];

function dirtyAfterRun(base: Partial<NodeData>, prompt: string): NodeData {
  const d = {
    label: 'audit',
    imageName: '熊二',
    imagePreview: MAIN,
    panelMainImageUrl: MAIN,
    panelMainSlotVisible: false as const,
    referenceImages: [REF0, REF1],
    referenceImageLabels: ['原始丛林小路', '卷卷'],
    prompt,
    generationParams: {
      referenceImages: [REF0, REF1],
      referenceImageLabels: ['原始丛林小路', '卷卷'],
      prompt,
      ...(base.seedanceGenerationMode
        ? { seedanceGenerationMode: base.seedanceGenerationMode }
        : {}),
    },
    ...base,
  } as NodeData;
  if (base.selectedModel === '可灵3.0 Omni') {
    const tab = base.klingOmniTab || 'multi';
    if (tab === 'multi') d.klingOmniMultiPrompt = prompt;
    if (tab === 'instruction') d.klingOmniInstructionPrompt = prompt;
    if (tab === 'video') d.klingOmniVideoPrompt = prompt;
  }
  if (base.seedanceGenerationMode === 'reference') {
    d.seedanceTabConfigs = {
      reference: { prompt },
    };
  }
  return d;
}

console.log('\n=== A) 脏数据展示：imagePreview===主图备份，画布须=首个@参考 ===\n');

for (const c of cases) {
  console.log(`--- ${c.id} · 纯@资产 ---`);
  const d = dirtyAfterRun(c.data, c.promptAsset);
  ok(`${c.id} · mentionsMain=false`, !promptMentionsMainImageForNodeData(d));
  ok(`${c.id} · mentionsAny=true（纯@资产）`, promptMentionsAnyImageRefForNodeData(d));
  const canvas = resolveCanvasNodePreviewUrl(d);
  ok(`${c.id} · 画布≠主图`, canvas !== MAIN, `got=${canvas}`);
  ok(`${c.id} · 画布=REF0`, canvas === REF0, `got=${canvas}`);

  console.log(`--- ${c.id} · @图片n ---`);
  const d2 = dirtyAfterRun(c.data, c.promptPic);
  const canvas2 = resolveCanvasNodePreviewUrl(d2);
  ok(`${c.id} · @图片n 画布≠主图`, canvas2 !== MAIN, `got=${canvas2}`);
  ok(`${c.id} · @图片n 画布=REF0`, canvas2 === REF0, `got=${canvas2}`);
}

console.log('\n=== B) 运行 patch：upload 有值 / 空 map 回退 mergedPanelRefs ===\n');

for (const c of cases) {
  const preRun = {
    label: 'audit',
    imagePreview: MAIN,
    imageName: '熊二',
    referenceImages: [REF0, REF1],
    referenceImageLabels: ['原始丛林小路', '卷卷'],
    prompt: c.promptAsset,
    ...c.data,
  } as NodeData;

  const planImages = [
    {
      token: '@资产:原始丛林小路',
      url: REF0,
      label: '原始丛林小路',
      imageIndex: 1,
    },
    {
      token: '@资产:卷卷',
      url: REF1,
      label: '卷卷',
      imageIndex: 2,
    },
  ];

  const uploaded = new Map<string, string>([
    ['@资产:原始丛林小路', `${REF0}|UP`],
    ['@资产:卷卷', `${REF1}|UP`],
  ]);
  const patchOk = buildPanelImagePreviewPatchAfterRun(planImages as any, uploaded, {
    nodeData: preRun,
    mergedPanelRefs: [REF0, REF1],
    mergedPanelLabels: ['原始丛林小路', '卷卷'],
  });
  ok(
    `${c.id} · patch(有upload).imagePreview=首个上传`,
    patchOk.imagePreview === `${REF0}|UP`,
    `got=${patchOk.imagePreview}`
  );
  ok(`${c.id} · patch(有upload).hideMain`, patchOk.panelMainSlotVisible === false);
  ok(`${c.id} · patch(有upload).backup=MAIN`, patchOk.panelMainImageUrl === MAIN);

  const patchEmpty = buildPanelImagePreviewPatchAfterRun(planImages as any, new Map(), {
    nodeData: preRun,
    mergedPanelRefs: [REF0, REF1],
    mergedPanelLabels: ['原始丛林小路', '卷卷'],
  });
  ok(
    `${c.id} · patch(空upload).imagePreview=merged REF0`,
    patchEmpty.imagePreview === REF0,
    `got=${patchEmpty.imagePreview}`
  );
  ok(`${c.id} · patch(空upload).hideMain`, patchEmpty.panelMainSlotVisible === false);
}

console.log('\n=== C) 首尾帧模型：未@主图仅@首帧时缩略图=首帧（非主图备份脏态） ===\n');

const frameModels = [
  { id: '可灵 2.5 Turbo', selectedModel: '可灵 2.5 Turbo' },
  { id: 'vidu 2.0', selectedModel: 'vidu 2.0' },
  { id: '即梦3.0 Pro', selectedModel: '即梦3.0 Pro' },
];
for (const m of frameModels) {
  const d = {
    label: 'frame',
    selectedModel: m.selectedModel,
    imagePreview: MAIN,
    panelMainImageUrl: MAIN,
    panelMainSlotVisible: false as const,
    prompt: '@首帧图动起来',
    firstFrameImageUrl: REF0,
    generationParams: {
      prompt: '@首帧图动起来',
      firstFrameImageUrl: REF0,
      referenceImages: [REF0],
    },
  } as NodeData;
  const canvas = resolveCanvasNodePreviewUrl(d);
  // 首尾帧模型画布常走 imagePreview；若仍=MAIN 备份且 gp 有 referenceImages，应回退 gp
  ok(
    `${m.id} · 脏态画布≠主图备份（有 gp refs）`,
    canvas !== MAIN,
    `got=${canvas}`
  );
}

console.log(`\n=== 汇总: ${pass} 通过, ${fail} 失败 ===\n`);
if (fail) {
  console.error('失败项:\n' + failures.map((f) => ` - ${f}`).join('\n'));
  process.exit(1);
}
console.log('ALL MODELS: 无「纯@资产/未@主图误显主图」回归\n');

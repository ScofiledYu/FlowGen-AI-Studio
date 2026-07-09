/**
 * 全模型复现 image2.json：底栏双「图片1」+ prompt @图片1/@图片2 → 运行后面板参考图不丢
 * npx tsx scripts/all-models-duplicate-label-panel-test.ts
 */
import type { NodeData } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2 } from '../types.ts';
import {
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
  resolvePictureTokenSlotIndex,
} from '../utils/promptMediaRefs.ts';
import {
  mergeAndPrunePanelReferenceImagesAfterUpload,
  panelMergeOptionsForReferencedUpload,
  panelReferenceImagesForUpload,
} from '../utils/referencedMediaRun.ts';
import { resolveReferenceImageLabelsAfterPanelRun } from '../utils/referenceImageSlotLabels.ts';
import { buildImage2PanelDisplayEntries, compactImage2PanelReferences } from '../utils/image2PanelRefs.ts';
import { buildPanelReferenceDisplayEntries } from '../utils/referenceImageSlotLabels.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const MAIN = 'https://cos/openApi/main-dup.png';
const REF2 = 'https://cos/openApi/ref-second.png';
const PROMPT = '@图片1参考@图片2风格生成';
const DUP_LABELS = ['图片1', '图片1'] as const;

type ModelCase = {
  id: string;
  build: () => NodeData;
  panelCount: () => (data: NodeData) => string[];
};

function simulateRun(data: NodeData, prompt: string) {
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, new Map());
  const panelBefore = panelReferenceImagesForUpload(data) || [];
  const uploaded = new Map<string, string>();
  for (const e of plan.images) {
    uploaded.set(e.token, `https://cos/uploaded/${e.token.replace(/[^a-z0-9]/gi, '_')}.png`);
  }
  const mergeOpts = panelMergeOptionsForReferencedUpload(
    plan.images,
    uploaded,
    data.imagePreview,
    new Map(),
    data.referenceImageLabels,
    data.panelMainSlotVisible
  );
  const panelAfter = mergeAndPrunePanelReferenceImagesAfterUpload(
    panelBefore,
    plan.images,
    uploaded,
    mergeOpts
  );
  const labels = resolveReferenceImageLabelsAfterPanelRun({
    panelBefore,
    labelsBefore: data.referenceImageLabels,
    panelAfter,
    plan,
  });
  return { plan, panelBefore, panelAfter, labels, ctx };
}

const CASES: ModelCase[] = [
  {
    id: 'Nano Banana 2.0',
    build: () =>
      ({
        label: 'n',
        selectedModel: MODEL_NANO_BANANA_2,
        imagePreview: MAIN,
        referenceImages: [MAIN, REF2],
        referenceImageLabels: [...DUP_LABELS],
        prompt: PROMPT,
      }) as NodeData,
    panelCount: (d) => d.referenceImages || [],
  },
  {
    id: 'image 2',
    build: () =>
      ({
        label: 'n',
        selectedModel: MODEL_IMAGE_2,
        imagePreview: MAIN,
        panelMainImageUrl: MAIN,
        panelMainSlotVisible: false,
        referenceImages: [MAIN, REF2],
        referenceImageLabels: [...DUP_LABELS],
        prompt: PROMPT,
        status: 'completed',
      }) as NodeData,
    panelCount: (d) => d.referenceImages || [],
  },
  {
    id: 'seedance2.0 参考生',
    build: () =>
      ({
        label: 'n',
        selectedModel: 'seedance2.0 (急速版)',
        seedanceGenerationMode: 'reference',
        imagePreview: MAIN,
        referenceImages: [MAIN, REF2],
        referenceImageLabels: [...DUP_LABELS],
        prompt: PROMPT,
        seedanceTabConfigs: {
          reference: { prompt: PROMPT, referenceImages: [MAIN, REF2], referenceImageLabels: [...DUP_LABELS] },
        },
      }) as NodeData,
    panelCount: (d) => d.referenceImages || [],
  },
  {
    id: '可灵3.0 Omni·multi',
    build: () =>
      ({
        label: 'n',
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'multi',
        imagePreview: MAIN,
        klingOmniMultiReferenceImages: [MAIN, REF2],
        referenceImageLabels: [...DUP_LABELS],
        prompt: PROMPT,
        klingOmniMultiPrompt: PROMPT,
      }) as NodeData,
    panelCount: (d) => d.klingOmniMultiReferenceImages || [],
  },
  {
    id: '可灵3.0 Omni·instruction',
    build: () =>
      ({
        label: 'n',
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'instruction',
        imagePreview: MAIN,
        klingOmniInstructionReferenceImages: [MAIN, REF2],
        referenceImageLabels: [...DUP_LABELS],
        prompt: PROMPT,
        klingOmniInstructionPrompt: PROMPT,
      }) as NodeData,
    panelCount: (d) => d.klingOmniInstructionReferenceImages || [],
  },
  {
    id: '可灵3.0 Omni·video',
    build: () =>
      ({
        label: 'n',
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'video',
        imagePreview: MAIN,
        klingOmniVideoReferenceImages: [MAIN, REF2],
        referenceImageLabels: [...DUP_LABELS],
        prompt: PROMPT,
        klingOmniVideoPrompt: PROMPT,
      }) as NodeData,
    panelCount: (d) => d.klingOmniVideoReferenceImages || [],
  },
];

console.log('=== 全模型：双「图片1」标签 + @图片1/@图片2 运行模拟（image2.json 类问题）===\n');

for (const c of CASES) {
  console.log(`--- ${c.id} ---`);
  const data = c.build();
  const panelUrls = c.panelCount(data);
  const slot1 = resolvePictureTokenSlotIndex(1, panelUrls, data.referenceImageLabels, data.imagePreview);
  const slot2 = resolvePictureTokenSlotIndex(2, panelUrls, data.referenceImageLabels, data.imagePreview);
  console.log(`  resolve: @图片1→slot${slot1} @图片2→slot${slot2}`);

  const { plan, panelAfter, labels } = simulateRun(data, PROMPT);
  const tokens = plan.images.map((e) => e.token);
  const slots = plan.images.map((e) => e.refImageSlotIndex);
  console.log(`  plan: ${JSON.stringify(plan.images.map((e) => ({ t: e.token, s: e.refImageSlotIndex })))}`);
  console.log(`  panelAfter: ${panelAfter.length} labels: ${JSON.stringify(labels)}`);

  ok(`${c.id}: plan 含 @图片1+@图片2`, tokens.includes('@图片1') && tokens.includes('@图片2'), tokens.join(','));
  ok(`${c.id}: @图片1/@图片2 不同槽`, slots.length === 2 && slots[0] !== slots[1], JSON.stringify(slots));
  ok(`${c.id}: panelAfter 保留 2 槽`, panelAfter.filter(Boolean).length >= 2, String(panelAfter.length));
  ok(`${c.id}: labels 修正为 图片1+图片2`, labels[0] === '图片1' && labels[1] === '图片2', JSON.stringify(labels));

  if (c.id === 'image 2') {
    const after = { ...data, referenceImages: panelAfter, referenceImageLabels: labels } as NodeData;
    const display = buildImage2PanelDisplayEntries(after);
    ok(`${c.id}: 面板展示 ≥2 格`, display.length >= 2, String(display.length));
  } else {
    const display = buildPanelReferenceDisplayEntries(panelAfter, {
      imagePreview: data.imagePreview,
      dedupeAgainstMain: false,
      referenceImageLabels: labels,
    });
    ok(`${c.id}: 面板展示 ≥2 格`, display.length >= 2, String(display.length));
  }
  console.log('');
}

console.log(`=== 汇总：${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) process.exit(1);

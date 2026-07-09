/**
 * ggggttt.json 回归：未 @主图 时
 * 1) 编辑态 / 运行后均保留面板主图格（panelMainImageUrl 备份）
 * 2) 画布节点缩略图保留主图（不切换成首个 @ 参考图）；生成结果进 generatedThumbnails / OUTPUT
 *
 * npx tsx scripts/ggggttt-panel-preview-test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NodeData } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2 } from '../types.ts';
import {
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
} from '../utils/promptMediaRefs.ts';
import {
  PANEL_MAIN_IMAGE_SLOT_SCENARIOS,
  buildPanelImagePreviewPatchAfterRun,
  firstUploadedNonMainImageFromPlan,
  mergeAndPrunePanelReferenceImagesAfterUpload,
  panelMergeOptionsForReferencedUpload,
  panelReferenceImagesForUpload,
  promptPlanReferencesMainImage,
  resolveCanvasNodePreviewUrl,
  resolvePanelMainSlotPreviewUrl,
  shouldShowPanelMainImageSlot,
} from '../utils/referencedMediaRun.ts';
import { resolveMainImagePanelDisplayLabel } from '../utils/referenceImageSlotLabels.ts';
import { resolveNodeSelectionPreviewUrl } from '../utils/nodeDetailsPreview.ts';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

function mockUploadedByToken(
  plan: ReturnType<typeof collectReferencedMediaFromPrompt>
): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of plan.images) {
    m.set(e.token, `${e.url}|UP`);
  }
  return m;
}

function simulateRunPreviewPatch(
  data: NodeData,
  uploaded?: Map<string, string>
): Partial<NodeData> {
  const ctx = buildPromptMediaRefContextFromNode(data);
  const prompt = String(data.prompt || '').trim();
  const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, new Map());
  const up = uploaded ?? mockUploadedByToken(plan);
  const panelBefore = panelReferenceImagesForUpload(data) ?? data.referenceImages ?? [];
  const merged = mergeAndPrunePanelReferenceImagesAfterUpload(
    panelBefore,
    plan.images,
    up,
    panelMergeOptionsForReferencedUpload(
      plan.images,
      up,
      data.imagePreview,
      undefined,
      data.referenceImageLabels,
      data.panelMainSlotVisible
    )
  );
  const previewPatch = buildPanelImagePreviewPatchAfterRun(plan.images, up, {
    nodeData: data,
    ...(String(data.selectedModel || '').trim() === '可灵3.0 Omni'
      ? {}
      : {
          mergedPanelRefs: merged,
          mergedPanelLabels: data.referenceImageLabels,
        }),
  });
  return {
    ...data,
    ...previewPatch,
    referenceImages: merged,
    imagePreview: previewPatch.imagePreview ?? data.imagePreview,
  };
}

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ggggttt.json');

console.log('\n=== ggggttt §1. 导入 JSON：编辑态应保留主图格 ===\n');

{
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    nodes: Array<{ id: string; data: NodeData }>;
  };
  const image2Node = raw.nodes.find((n) => n.data.selectedModel === MODEL_IMAGE_2);
  const nanoNode = raw.nodes.find((n) => n.data.selectedModel === MODEL_NANO_BANANA_2);
  ok('JSON 含 image2 节点', Boolean(image2Node));
  ok('JSON 含 Nano 节点', Boolean(nanoNode));

  if (image2Node) {
    const edit = {
      ...image2Node.data,
      panelMainSlotVisible: undefined,
      status: 'idle' as const,
    };
    ok('image2 编辑态展示主图格', shouldShowPanelMainImageSlot(edit));
  }
  if (nanoNode) {
    const edit = {
      ...nanoNode.data,
      panelMainSlotVisible: undefined,
      status: 'idle' as const,
    };
    ok('Nano 编辑态展示主图格', shouldShowPanelMainImageSlot(edit));
  }
}

console.log('\n=== ggggttt §2. image2 @图片1@图片3：运行后画布=图片1，非 outputUrl ===\n');

{
  const REF1 =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/a79e4d5c-61dc-4003-830c-c1023b3486aa.png';
  const REF3 =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/e6b0f01a-e56a-4a27-a56c-771031174f4a.png';
  const OUTPUT =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/b9164bbb-2b0f-4a19-a532-b6c493858117.png';
  const MAIN = 'blob:http://localhost:3001/d4ae531f-6775-402f-be34-e02ac6627c96';

  const edit: NodeData = {
    label: 'Input Picture Node',
    selectedModel: MODEL_IMAGE_2,
    imagePreview: MAIN,
    prompt: '@图片1参考@图片3风格',
    referenceImages: [REF1, REF3],
    referenceImageLabels: ['图片1', '图片3'],
    panelMainSlotVisible: undefined,
    generationParams: { outputUrl: OUTPUT },
    generatedThumbnails: [
      {
        id: 'out',
        url: OUTPUT,
        type: 'image',
        nodeId: 'out',
        name: 'Generated_98.png',
      },
    ],
  } as NodeData;

  ok('编辑态主图格可见', shouldShowPanelMainImageSlot(edit));
  const afterRun = simulateRunPreviewPatch(edit) as NodeData;
  ok('运行后仍展示主图格', shouldShowPanelMainImageSlot(afterRun));
  ok('运行后备份主图', afterRun.panelMainImageUrl === MAIN);
  ok('imagePreview=首个@参考图(图片1)', afterRun.imagePreview === `${REF1}|UP`, afterRun.imagePreview);
  ok('画布节点缩略图=首个@参考图', resolveCanvasNodePreviewUrl(afterRun) === `${REF1}|UP`);
  ok('主图格标签=主图', resolveMainImagePanelDisplayLabel(resolvePanelMainSlotPreviewUrl(afterRun)!) === '主图');
  ok('画布不是生成 outputUrl', afterRun.imagePreview !== OUTPUT);
  ok('thumbnails 仍为生成图', edit.generatedThumbnails?.[0]?.url === OUTPUT);

  const swapped = {
    ...afterRun,
    referenceImages: [
      'https://cos.example.com/new-ref1.png',
      REF3,
    ],
  };
  ok('换参考图后 imagePreview 不变(仍首个@上传URL)', swapped.imagePreview === `${REF1}|UP`);
  ok('换参考图后画布仍=首个@参考图上传URL', resolveCanvasNodePreviewUrl(swapped) === `${REF1}|UP`);
  ok('换参考图后仍非 outputUrl', swapped.imagePreview !== OUTPUT);
  const hero = resolveNodeSelectionPreviewUrl(swapped, []);
  ok('Node Details 选中预览=上次运行首个@参考图', hero === `${REF1}|UP`, hero);
}

console.log('\n=== ggggttt §3. Nano @图片1@图片3：运行后画布=Details 首张引用 ===\n');

{
  const REF1 =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/6fa5d78c-26df-4a3f-acc2-7da774d20717.png';
  const REF3 =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/1804446e-af2e-4228-86a4-ce1b90da02bc.png';
  const OUTPUT =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/b810a3f7-bfc8-41ac-ba47-98bc5dc8a2f2.png';
  const MAIN = 'blob:http://localhost:3001/bd324a33-661d-475f-8deb-feebaca413e0';

  const edit: NodeData = {
    label: 'Input Picture Node',
    selectedModel: MODEL_NANO_BANANA_2,
    imagePreview: MAIN,
    prompt: '@图片1参考生成@图片3',
    referenceImages: [REF1, '', REF3],
    referenceImageLabels: ['图片1', '', '图片3'],
    panelMainSlotVisible: undefined,
    generationParams: { outputUrl: OUTPUT },
    generatedThumbnails: [
      {
        id: 'out-nano',
        url: OUTPUT,
        type: 'image',
        nodeId: 'out-nano',
        name: 'Generated_236.png',
      },
    ],
  } as NodeData;

  ok('Nano 编辑态主图格可见', shouldShowPanelMainImageSlot(edit));
  const afterRun = simulateRunPreviewPatch(edit) as NodeData;
  ok('Nano 运行后仍展示主图格', shouldShowPanelMainImageSlot(afterRun));
  ok('Nano imagePreview=首个@参考图(图片1)', afterRun.imagePreview === `${REF1}|UP`, afterRun.imagePreview);
  ok('Nano 画布缩略图=首个@参考图', resolveCanvasNodePreviewUrl(afterRun) === `${REF1}|UP`);
  ok('Nano 画布不是 outputUrl', afterRun.imagePreview !== OUTPUT);
}

console.log('\n=== ggggttt §4. 全模型：编辑态保留主图格 / 运行后画布=Details 首张引用 ===\n');

const REF_A = 'https://cos.example/all-model-ref-a.png';
const REF_B = 'https://cos.example/all-model-ref-b.png';
const MAIN_ALL = 'https://cos.example/all-model-main.png';
const PROMPT = '@图片1参考@图片2风格';

for (const scenario of PANEL_MAIN_IMAGE_SLOT_SCENARIOS) {
  const base = {
    label: 'all-model',
    selectedModel: scenario.model,
    imagePreview: MAIN_ALL,
    referenceImages: [REF_A, REF_B],
    referenceImageLabels: ['图片1', '图片2'],
    prompt: PROMPT,
    panelMainSlotVisible: undefined,
    ...scenario.dataPatch,
  } as NodeData;

  ok(`${scenario.id} · 编辑态主图格`, shouldShowPanelMainImageSlot(base));

  const ctx = buildPromptMediaRefContextFromNode(base);
  const plan = collectReferencedMediaFromPrompt(
    getInspectorPrompt(base),
    base,
    ctx,
    new Map()
  );
  ok(`${scenario.id} · plan 未@主图`, !promptPlanReferencesMainImage(plan.images));

  const afterRun = simulateRunPreviewPatch(base) as NodeData;
  ok(`${scenario.id} · 运行后仍展示主图格`, shouldShowPanelMainImageSlot(afterRun));
  const expectedFirstRef = firstUploadedNonMainImageFromPlan(plan.images, mockUploadedByToken(plan));
  ok(
    `${scenario.id} · 运行后画布=首个@参考图`,
    afterRun.imagePreview === expectedFirstRef && resolveCanvasNodePreviewUrl(afterRun) === expectedFirstRef,
    `expected=${expectedFirstRef} actual=${resolveCanvasNodePreviewUrl(afterRun)}`
  );
}

function getInspectorPrompt(data: NodeData): string {
  const m = String(data.selectedModel || '').trim();
  if (m === '可灵3.0 Omni') {
    const tab = data.klingOmniTab || 'multi';
    if (tab === 'instruction') return String(data.klingOmniInstructionPrompt || data.prompt || '');
    if (tab === 'video') return String(data.klingOmniVideoPrompt || data.prompt || '');
    return String(data.klingOmniMultiPrompt || data.prompt || '');
  }
  if (m.includes('seedance') && data.seedanceGenerationMode === 'reference') {
    return String(data.seedanceTabConfigs?.reference?.prompt || data.prompt || '');
  }
  return String(data.prompt || '');
}

console.log(`\n=== 汇总: ${pass} 通过, ${fail} 失败 ===\n`);
if (fail > 0) process.exit(1);

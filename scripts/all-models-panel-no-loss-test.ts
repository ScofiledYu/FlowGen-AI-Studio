/**
 * 全模型运行后面板丢图测试
 * npx tsx scripts/all-models-panel-no-loss-test.ts
 */
import type { NodeData } from '../types.ts';
import {
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
} from '../utils/promptMediaRefs.ts';
import {
  buildPanelImagePreviewPatchAfterRun,
  mergeAndPrunePanelReferenceImagesAfterUpload,
  panelMergeOptionsForReferencedUpload,
  panelReferenceImagesForUpload,
  MAIN_IMAGE_REF_TOKENS,
} from '../utils/referencedMediaRun.ts';
import { resolveReferenceImageLabelsAfterPanelRun } from '../utils/referenceImageSlotLabels.ts';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++; else fail++;
}

const mainBlob = 'blob:http://localhost:3001/main-test';
const ref1 = 'data:image/jpeg;base64,/9j/4AAQref1';
const ref2 = 'data:image/jpeg;base64,/9j/4AAQref2';
const ref3 = 'data:image/jpeg;base64,/9j/4AAQref3';

function testModel(model: string, prompt: string, extraData?: Partial<NodeData>) {
  console.log(`\n=== ${model} ===`);
  const dataIn = {
    selectedModel: model,
    imagePreview: mainBlob,
    imageLocalRef: 'flowgen-local:uid_pid:node:main',
    referenceImages: [ref1, ref2, ref3],
    referenceImageLabels: ['图片1', '图片2', '图片3'],
    prompt,
    status: 'idle',
    ...extraData,
  } as NodeData;

  const ctx = buildPromptMediaRefContextFromNode(dataIn);
  const plan = collectReferencedMediaFromPrompt(prompt, dataIn, ctx, new Map());
  const panelBefore = panelReferenceImagesForUpload(dataIn) || [];
  const uploaded = new Map<string, string>();
  for (const e of plan.images) {
    uploaded.set(e.token, `https://aitop-cos/${e.token.replace(/[^a-zA-Z0-9]/g,'')}-signed.png`);
  }
  const mergeOpts = panelMergeOptionsForReferencedUpload(plan.images, uploaded, dataIn.imagePreview, new Map(), dataIn.referenceImageLabels);
  const panelAfter = mergeAndPrunePanelReferenceImagesAfterUpload(panelBefore, plan.images, uploaded, mergeOpts);
  const labels = resolveReferenceImageLabelsAfterPanelRun({ panelBefore, labelsBefore: dataIn.referenceImageLabels, panelAfter, plan });
  const previewPatch = buildPanelImagePreviewPatchAfterRun(plan.images, uploaded, {
    nodeData: dataIn, mergedPanelRefs: panelAfter, mergedPanelLabels: labels,
  });

  console.log(`  plan.images: ${plan.images.length}`);
  console.log(`  panelBefore: ${panelBefore.length}`);
  console.log(`  panelAfter: ${panelAfter.length} — ${JSON.stringify(panelAfter.map(u=>u?u.slice(0,25):'EMPTY'))}`);
  console.log(`  labels: ${JSON.stringify(labels)}`);
  console.log(`  previewPatch.imagePreview: ${previewPatch.imagePreview ? String(previewPatch.imagePreview).slice(0,30) : 'undefined'}`);

  // 通用断言：未@的参考槽应保留
  const nonAtSlots = panelAfter.filter((u, i) => {
    const slotEntries = plan.images.filter(e => e.refImageSlotIndex === i);
    return slotEntries.length === 0 && u && u.trim();
  });
  ok(`${model}: 未@槽保留`, nonAtSlots.length > 0 || plan.images.length === panelAfter.length, JSON.stringify(panelAfter.map(u=>u?u.slice(0,25):'EMPTY')));
  ok(`${model}: @到的槽有 signed URL`, plan.images.every(e => {
    if (MAIN_IMAGE_REF_TOKENS.has(e.token)) return true; // @主图 进 imagePreview，不进面板
    const idx = e.refImageSlotIndex;
    return idx != null && panelAfter[idx] && panelAfter[idx].includes('aitop-cos');
  }) || plan.images.length === 0, JSON.stringify(plan.images.map(e=>({t:e.token,s:e.refImageSlotIndex}))));
  ok(`${model}: 面板不丢图(>=plan.images数)`, panelAfter.filter(Boolean).length >= plan.images.length, `${panelAfter.filter(Boolean).length} vs ${plan.images.length}`);
}

// 测试各模型
testModel('Nano Banana 2.0', '@图片1参考@图片3风格');
testModel('image 2', '@图片1参考@图片3风格');
testModel('可灵3.0 Omni', '@图片1参考@图片2风格', { klingOmniTab: 'multi', klingOmniMultiPrompt: '@图片1参考@图片2风格', klingOmniMultiReferenceImages: [ref1, ref2, ref3] } as Partial<NodeData>);
testModel('可灵3.0 Omni', '@图片1参考@图片2风格', { klingOmniTab: 'instruction', klingOmniInstructionPrompt: '@图片1参考@图片2风格', klingOmniInstructionReferenceImages: [ref1, ref2, ref3] } as Partial<NodeData>);
testModel('seedance2.0 (高质量版)', '@图片1参考@图片3风格', { seedanceGenerationMode: 'reference' } as Partial<NodeData>);
testModel('可灵 2.5 Turbo', '@主图生成', { firstFrameImageUrl: ref1 } as Partial<NodeData>);
testModel('vidu 2.0', '@主图生成', { firstFrameImageUrl: ref1 } as Partial<NodeData>);
testModel('即梦3.0 Pro', '@主图生成', { firstFrameImageUrl: ref1 } as Partial<NodeData>);

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);

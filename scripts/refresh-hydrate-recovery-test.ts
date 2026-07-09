/**
 * 模拟刷新后 UI 图片恢复测试
 * 验证：运行后保存（sanitize 剥离 blob/data）→ 刷新加载 → hydrate 从 IndexedDB 恢复
 * npx tsx scripts/refresh-hydrate-recovery-test.ts
 */
import type { NodeData } from '../types.ts';
import { sanitizePersistValueDeep } from '../utils/persistSanitize.mjs';
import {
  shouldPreferRunReferencePreviewOverLocalMain,
  buildPanelImagePreviewPatchAfterRun,
  mergeAndPrunePanelReferenceImagesAfterUpload,
  panelMergeOptionsForReferencedUpload,
  panelReferenceImagesForUpload,
} from '../utils/referencedMediaRun.ts';
import { resolveReferenceImageLabelsAfterPanelRun } from '../utils/referenceImageSlotLabels.ts';
import { compactImage2PanelReferences } from '../utils/image2PanelRefs.ts';
import {
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
} from '../utils/promptMediaRefs.ts';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++; else fail++;
}

const mainBlob = 'blob:http://localhost:3001/main-test';
const ref1Data = 'data:image/jpeg;base64,/9j/4AAQref1ref1ref1ref1ref1ref1ref1ref1';
const ref2Data = 'data:image/jpeg;base64,/9j/4AAQref2ref2ref2ref2ref2ref2ref2ref2';
const ref3Data = 'data:image/jpeg;base64,/9j/4AAQref3ref3ref3ref3ref3ref3ref3ref3';
const ref1Signed = 'https://aitop-cos/ref1-signed.png';
const ref3Signed = 'https://aitop-cos/ref3-signed.png';

function simulateRefreshRecovery(label: string, model: string, dataIn: NodeData, prompt: string) {
  console.log(`\n=== ${label} ===`);
  // 1. 运行上传
  const ctx = buildPromptMediaRefContextFromNode(dataIn);
  const plan = collectReferencedMediaFromPrompt(prompt, dataIn, ctx, new Map());
  const panelBefore = panelReferenceImagesForUpload(dataIn) || [];
  const uploaded = new Map<string, string>();
  for (const e of plan.images) {
    if (e.token === '@主图' || e.token === '@主体') {
      uploaded.set(e.token, 'https://aitop-cos/main-signed.png');
    } else {
      uploaded.set(e.token, `https://aitop-cos/${e.token.replace(/[^a-zA-Z0-9]/g,'')}-signed.png`);
    }
  }
  const mergeOpts = panelMergeOptionsForReferencedUpload(plan.images, uploaded, dataIn.imagePreview, new Map(), dataIn.referenceImageLabels);
  const panelAfter = mergeAndPrunePanelReferenceImagesAfterUpload(panelBefore, plan.images, uploaded, mergeOpts);
  const labels = resolveReferenceImageLabelsAfterPanelRun({ panelBefore, labelsBefore: dataIn.referenceImageLabels, panelAfter, plan });
  const previewPatch = buildPanelImagePreviewPatchAfterRun(plan.images, uploaded, {
    nodeData: dataIn, mergedPanelRefs: panelAfter, mergedPanelLabels: labels,
  });

  // 2. 运行后节点状态
  const afterRun = { ...dataIn, ...previewPatch, referenceImages: panelAfter, referenceImageLabels: labels, status: 'completed', taskId: 'test-123', generationParams: { taskId: 'test-123', model, referenceImages: uploaded.size ? Array.from(uploaded.values()) : undefined } } as NodeData;
  console.log('  运行后 referenceImages:', afterRun.referenceImages.map(u=>u?u.slice(0,30):'EMPTY'));
  console.log('  运行后 imagePreview:', String(afterRun.imagePreview||'').slice(0,30));
  console.log('  运行后 imageLocalRef:', afterRun.imageLocalRef ? 'YES' : 'NO');

  // 3. 模拟保存：sanitize 剥离 blob/data
  const saved = sanitizePersistValueDeep(afterRun) as NodeData;
  console.log('  保存后(sanitize) referenceImages:', (saved.referenceImages||[]).map(u=>u?u.slice(0,30):'EMPTY'));
  console.log('  保存后 imagePreview:', String(saved.imagePreview||'').slice(0,30));
  console.log('  保存后 imageLocalRef:', saved.imageLocalRef ? 'YES' : 'NO');

  // 4. 模拟刷新后 hydrate 判断
  const shouldRecoverMain = !shouldPreferRunReferencePreviewOverLocalMain(saved);
  console.log('  shouldRecoverMain(从IDB恢复主图):', shouldRecoverMain);

  // 5. 断言
  ok(`${label}: imageLocalRef 保留(用于恢复主图)`, Boolean(saved.imageLocalRef), String(saved.imageLocalRef||''));
  ok(`${label}: @到的 signed URL 保留(sanitize不剥离https)`, (saved.referenceImages||[]).some(u => u && u.includes('aitop-cos')) || plan.images.length === 0, JSON.stringify((saved.referenceImages||[]).map(u=>u?u.slice(0,25):'EMPTY')));
  ok(`${label}: shouldRecoverMain 允许恢复主图`, shouldRecoverMain, `imagePreview=${String(saved.imagePreview||'').slice(0,20)}`);
}

// image2：主图blob + 3参考data，@图片1 @图片3
simulateRefreshRecovery(
  'image2 刷新恢复',
  'image 2',
  { selectedModel: 'image 2', imagePreview: mainBlob, imageLocalRef: 'flowgen-local:uid_pid:node:main', referenceImages: [mainBlob, ref1Data, ref2Data, ref3Data], referenceImageLabels: ['图片1','图片2','图片3','图片4'], prompt: '@图片1参考@图片3', status: 'idle' } as NodeData,
  '@图片1参考@图片3'
);

// Banana2：主图blob + 3参考data，@图片1 @图片3
simulateRefreshRecovery(
  'Banana2 刷新恢复',
  'Nano Banana 2.0',
  { selectedModel: 'Nano Banana 2.0', imagePreview: mainBlob, imageLocalRef: 'flowgen-local:uid_pid:node:main', referenceImages: [ref1Data, ref2Data, ref3Data], referenceImageLabels: ['图片1','图片2','图片3'], prompt: '@图片1参考@图片3', status: 'idle' } as NodeData,
  '@图片1参考@图片3'
);

// image2：运行后主图blob（未@主图，imagePreview保留主图）
simulateRefreshRecovery(
  'image2 未@主图 刷新恢复',
  'image 2',
  { selectedModel: 'image 2', imagePreview: mainBlob, imageLocalRef: 'flowgen-local:uid_pid:node:main', referenceImages: [ref1Data, ref2Data, ref3Data], referenceImageLabels: ['图片1','图片2','图片3'], prompt: '@图片1参考@图片3', status: 'idle' } as NodeData,
  '@图片1参考@图片3'
);

// Seedance 参考生
simulateRefreshRecovery(
  'Seedance 参考生 刷新恢复',
  'seedance2.0 (高质量版)',
  { selectedModel: 'seedance2.0 (高质量版)', imagePreview: mainBlob, imageLocalRef: 'flowgen-local:uid_pid:node:main', referenceImages: [ref1Data, ref2Data, ref3Data], referenceImageLabels: ['图片1','图片2','图片3'], prompt: '@图片1参考@图片3', seedanceGenerationMode: 'reference', status: 'idle' } as NodeData,
  '@图片1参考@图片3'
);

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);

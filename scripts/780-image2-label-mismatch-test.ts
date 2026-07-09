/**
 * 模拟 image2 运行后面板标签错位/丢图
 * npx tsx scripts/780-image2-label-mismatch-test.ts
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
} from '../utils/referencedMediaRun.ts';
import { resolveReferenceImageLabelsAfterPanelRun } from '../utils/referenceImageSlotLabels.ts';
import { buildImage2PanelDisplayEntries, compactImage2PanelReferences } from '../utils/image2PanelRefs.ts';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++; else fail++;
}

const main = 'https://cos/main-snow.png';
const ref1 = 'https://cos/ref1-city.png';   // 图片1（@图片1）
const ref2 = 'https://cos/ref2-wolf.png';   // 图片2（未@）
const ref3 = 'https://cos/ref3-other.png';  // 图片3（@图片3）

function simulateRun(label: string, dataIn: NodeData, prompt: string) {
  console.log(`\n=== ${label} ===`);
  const ctx = buildPromptMediaRefContextFromNode(dataIn);
  const plan = collectReferencedMediaFromPrompt(prompt, dataIn, ctx, new Map());
  console.log('  plan.images:', plan.images.map(e => ({ token: e.token, url: e.url.slice(0,30), slot: e.refImageSlotIndex })));

  const panelBefore = panelReferenceImagesForUpload(dataIn) || [];
  console.log('  panelBefore:', panelBefore.map(u=>u.slice(0,30)));

  const uploaded = new Map<string, string>();
  for (const e of plan.images) {
    uploaded.set(e.token, `https://aitop-cos/${e.token.replace(/[^a-zA-Z0-9]/g,'')}-signed.png`);
  }

  const mergeOpts = panelMergeOptionsForReferencedUpload(plan.images, uploaded, dataIn.imagePreview, new Map(), dataIn.referenceImageLabels);
  const panelAfter = mergeAndPrunePanelReferenceImagesAfterUpload(panelBefore, plan.images, uploaded, mergeOpts);
  console.log('  panelAfter:', panelAfter.map(u=>u.slice(0,40)));

  const labels = resolveReferenceImageLabelsAfterPanelRun({
    panelBefore, labelsBefore: dataIn.referenceImageLabels, panelAfter, plan,
  });
  console.log('  labels:', labels);

  const previewPatch = buildPanelImagePreviewPatchAfterRun(plan.images, uploaded, {
    nodeData: dataIn, mergedPanelRefs: panelAfter, mergedPanelLabels: labels,
  });
  console.log('  previewPatch:', previewPatch);

  const after = { ...dataIn, ...previewPatch, referenceImages: panelAfter, referenceImageLabels: labels } as NodeData;
  const display = buildImage2PanelDisplayEntries(after);
  console.log('  展示 entries:', display.map(e=>({slot:e.slotIndex, url:e.url.slice(0,30)})));

  // 模拟 NodeInspector compact effect（运行后 status=completed，我已禁用）
  // 但验证 compact 本身不丢图
  const compacted = compactImage2PanelReferences(after);
  console.log('  compact 后:', compacted.referenceImages.map(u=>u.slice(0,30)), compacted.referenceImageLabels);

  return { panelAfter, labels, display, compacted };
}

// 场景：主图 + 3 参考图（图片1=城市, 图片2=狼, 图片3=其他），prompt @图片1 @图片3
const r = simulateRun(
  '主图+3参考, prompt=@图片1参考@图片3风格',
  {
    selectedModel: 'image 2',
    imagePreview: main,
    imageLocalRef: 'flowgen-local:uid_pid:node:main',
    referenceImages: [ref1, ref2, ref3],
    referenceImageLabels: ['图片1', '图片2', '图片3'],
    prompt: '@图片1参考@图片3的风格',
    status: 'idle',
  } as NodeData,
  '@图片1参考@图片3的风格'
);

ok('面板保留 3 槽', r.panelAfter.length === 3, JSON.stringify(r.panelAfter.map(u=>u.slice(0,30))));
ok('面板不含主图', !r.panelAfter.some(u => u === main), JSON.stringify(r.panelAfter.map(u=>u.slice(0,30))));
ok('标签无重复"主图"', !r.labels.some(l => l === '主图'), JSON.stringify(r.labels));
ok('标签含图片1', r.labels.includes('图片1'), JSON.stringify(r.labels));
ok('标签含图片3', r.labels.includes('图片3'), JSON.stringify(r.labels));
ok('compact 后仍 3 槽', r.compacted.referenceImages.length === 3, JSON.stringify(r.compacted.referenceImages.map(u=>u.slice(0,30))));

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);

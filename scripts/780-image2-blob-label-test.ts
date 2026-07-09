/**
 * 模拟 image2 本地 blob/data 运行后面板标签错位/丢图
 * npx tsx scripts/780-image2-blob-label-test.ts
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

// 本地 blob 主图 + data URL 参考图
const mainBlob = 'blob:http://localhost:3001/main-abc';
const ref1Data = 'data:image/jpeg;base64,/9j/4AAQref1city';
const ref2Data = 'data:image/jpeg;base64,/9j/4AAQref2wolf';
const ref3Data = 'data:image/jpeg;base64,/9j/4AAQref3other';

const dataIn = {
  selectedModel: 'image 2',
  imagePreview: mainBlob,
  imageLocalRef: 'flowgen-local:uid_pid:node:main',
  referenceImages: [ref1Data, ref2Data, ref3Data],
  referenceImageLabels: ['图片1', '图片2', '图片3'],
  prompt: '@图片1参考@图片3的风格',
  status: 'idle',
} as NodeData;

const prompt = '@图片1参考@图片3的风格';
const ctx = buildPromptMediaRefContextFromNode(dataIn);
const plan = collectReferencedMediaFromPrompt(prompt, dataIn, ctx, new Map());
console.log('plan.images:', plan.images.map(e => ({ token: e.token, slot: e.refImageSlotIndex })));

const panelBefore = panelReferenceImagesForUpload(dataIn) || [];
console.log('panelBefore (strip后):', panelBefore.map(u => u ? u.slice(0,30) : 'EMPTY'));

const uploaded = new Map<string, string>();
for (const e of plan.images) {
  uploaded.set(e.token, `https://aitop-cos/${e.token.replace(/[^a-zA-Z0-9]/g,'')}-signed.png`);
}

const mergeOpts = panelMergeOptionsForReferencedUpload(plan.images, uploaded, dataIn.imagePreview, new Map(), dataIn.referenceImageLabels);
const panelAfter = mergeAndPrunePanelReferenceImagesAfterUpload(panelBefore, plan.images, uploaded, mergeOpts);
console.log('panelAfter:', panelAfter.map(u => u ? u.slice(0,40) : 'EMPTY'));

const labels = resolveReferenceImageLabelsAfterPanelRun({
  panelBefore, labelsBefore: dataIn.referenceImageLabels, panelAfter, plan,
});
console.log('labels:', labels);

const previewPatch = buildPanelImagePreviewPatchAfterRun(plan.images, uploaded, {
  nodeData: dataIn, mergedPanelRefs: panelAfter, mergedPanelLabels: labels,
});
console.log('previewPatch:', previewPatch);

const after = { ...dataIn, ...previewPatch, referenceImages: panelAfter, referenceImageLabels: labels } as NodeData;
const display = buildImage2PanelDisplayEntries(after);
console.log('展示 entries:', display.map(e => ({ slot: e.slotIndex, url: e.url.slice(0,40) })));

// 模拟运行后 status=completed（NodeInspector compact effect 已禁用，但验证 compact 本身）
const compacted = compactImage2PanelReferences({ ...after, status: 'completed' } as NodeData);
console.log('compact 后:', compacted.referenceImages.map(u => u ? u.slice(0,40) : 'EMPTY'), compacted.referenceImageLabels);

ok('面板保留 3 槽', panelAfter.length === 3, JSON.stringify(panelAfter.map(u => u ? u.slice(0,30) : 'EMPTY')));
ok('标签无重复"主图"', !labels.some(l => l === '主图'), JSON.stringify(labels));
ok('标签含图片1', labels.includes('图片1'), JSON.stringify(labels));
ok('标签含图片3', labels.includes('图片3'), JSON.stringify(labels));
ok('展示含 3 个参考格', display.length === 3, JSON.stringify(display.map(e => e.url.slice(0,30))));

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);

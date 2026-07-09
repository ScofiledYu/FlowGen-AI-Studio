/**
 * 完全复现用户场景：主图blob + referenceImages含主图在槽0 + 3参考data URL
 * npx tsx scripts/780-image2-user-scenario-test.ts
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

// 用户实际场景：主图blob，referenceImages=[主图blob, 图1data, 图2data, 图3data]（4个，主图在槽0）
const mainBlob = 'blob:http://localhost:3001/main-snow';
const ref1Data = 'data:image/jpeg;base64,/9j/4AAQref1city';
const ref2Data = 'data:image/jpeg;base64,/9j/4AAQref2wolf';
const ref3Data = 'data:image/jpeg;base64,/9j/4AAQref3other';

const dataIn = {
  selectedModel: 'image 2',
  imagePreview: mainBlob,
  imageLocalRef: 'flowgen-local:uid_pid:node:main',
  referenceImages: [mainBlob, ref1Data, ref2Data, ref3Data],
  referenceImageLabels: ['图片1', '图片2', '图片3', '图片4'],
  prompt: '@图片1参考@图片3',
  status: 'idle',
  image2Style: 'natural',
  image2AspectRatio: '1:1',
  image2ImageSize: '1024x1024',
  numberOfImages: '1张',
} as NodeData;

const prompt = '@图片1参考@图片3';
console.log('=== 用户场景：主图blob在槽0, 4参考, prompt @图片1@图片3 ===');
console.log('运行前 referenceImages:', dataIn.referenceImages.map(u=>u.slice(0,30)));
console.log('运行前 labels:', dataIn.referenceImageLabels);

const ctx = buildPromptMediaRefContextFromNode(dataIn);
const plan = collectReferencedMediaFromPrompt(prompt, dataIn, ctx, new Map());
console.log('plan.images:', plan.images.map(e => ({ token: e.token, slot: e.refImageSlotIndex, frame: e.refFrameIndex })));

const panelBefore = panelReferenceImagesForUpload(dataIn) || [];
console.log('panelBefore:', panelBefore.map(u => u ? u.slice(0,30) : 'EMPTY'));

const uploaded = new Map<string, string>();
for (const e of plan.images) {
  uploaded.set(e.token, `https://aitop-cos/${e.token.replace(/[^a-zA-Z0-9]/g,'')}-signed.png`);
}
console.log('uploaded:', Array.from(uploaded.entries()).map(([k,v])=>[k,v.slice(0,30)]));

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

const after = { ...dataIn, ...previewPatch, referenceImages: panelAfter, referenceImageLabels: labels, status: 'completed' } as NodeData;
const display = buildImage2PanelDisplayEntries(after);
console.log('展示 entries:', display.map(e => ({ slot: e.slotIndex, url: e.url.slice(0,40) })));

// 模拟 NodeInspector compact effect（status=completed，已禁用）
// 但验证 compactImage2PanelReferences 本身
const compacted = compactImage2PanelReferences(after);
console.log('compact 后:', compacted.referenceImages.map(u => u ? u.slice(0,40) : 'EMPTY'), compacted.referenceImageLabels);

ok('plan @图片1 有 slot', plan.images.some(e => e.token === '@图片1' && e.refImageSlotIndex != null), JSON.stringify(plan.images.map(e=>({t:e.token,s:e.refImageSlotIndex}))));
ok('plan @图片3 有 slot', plan.images.some(e => e.token === '@图片3' && e.refImageSlotIndex != null), JSON.stringify(plan.images.map(e=>({t:e.token,s:e.refImageSlotIndex}))));
ok('panelAfter 含 @图片1 signed', panelAfter.some(u => u && u.includes('aitop-cos') && u.includes('1-signed')), JSON.stringify(panelAfter.map(u=>u?u.slice(0,30):'EMPTY')));
ok('panelAfter 含 @图片3 signed', panelAfter.some(u => u && u.includes('aitop-cos') && u.includes('3-signed')), JSON.stringify(panelAfter.map(u=>u?u.slice(0,30):'EMPTY')));
ok('panelAfter 含未@ data URL', panelAfter.some(u => u && u.startsWith('data:')), JSON.stringify(panelAfter.map(u=>u?u.slice(0,30):'EMPTY')));
ok('展示含 3 个参考格(非主图)', display.length === 3, JSON.stringify(display.map(e=>e.url.slice(0,30))));
ok('展示不含主图blob', !display.some(e => e.url === mainBlob), JSON.stringify(display.map(e=>e.url.slice(0,30))));
ok('标签无空串', !labels.some(l => !l || !l.trim()), JSON.stringify(labels));

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);

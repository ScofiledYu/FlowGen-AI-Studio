/**
 * 复现 d:/json/image2.json：删节点后改 @ 再运行，面板参考图消失
 * npx tsx scripts/image2-json-panel-loss-test.ts
 */
import fs from 'fs';
import type { NodeData } from '../types.ts';
import {
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
  matchAllPromptMediaTokens,
  resolvePictureTokenSlotIndex,
} from '../utils/promptMediaRefs.ts';
import {
  buildPanelImagePreviewPatchAfterRun,
  mergeAndPrunePanelReferenceImagesAfterUpload,
  panelMergeOptionsForReferencedUpload,
  panelReferenceImagesForUpload,
} from '../utils/referencedMediaRun.ts';
import { resolveReferenceImageLabelsAfterPanelRun } from '../utils/referenceImageSlotLabels.ts';
import {
  buildImage2PanelDisplayEntries,
  compactImage2PanelReferences,
} from '../utils/image2PanelRefs.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const json = JSON.parse(fs.readFileSync('d:/json/image2.json', 'utf8'));
const node = json.nodes.find((n: { id: string }) => n.id === 'node_10_1783472899369');
if (!node) throw new Error('node_10 not found');

const baseData = node.data as NodeData;
console.log('match tokens:', matchAllPromptMediaTokens(baseData.prompt || '', []));
console.log('@图片1 idx:', resolvePictureTokenSlotIndex(1, baseData.referenceImages||[], baseData.referenceImageLabels, baseData.imagePreview));
console.log('@图片2 idx:', resolvePictureTokenSlotIndex(2, baseData.referenceImages||[], baseData.referenceImageLabels, baseData.imagePreview));

function simulateRun(label: string, dataIn: NodeData, prompt: string) {
  console.log(`\n=== ${label} ===`);
  const ctx = buildPromptMediaRefContextFromNode(dataIn);
  const plan = collectReferencedMediaFromPrompt(prompt, dataIn, ctx, new Map());
  console.log(
    '  plan:',
    plan.images.map((e) => ({
      token: e.token,
      slot: e.refImageSlotIndex,
      label: e.label,
      url: e.url?.slice(-24),
    }))
  );

  const panelBefore = panelReferenceImagesForUpload(dataIn) || [];
  const uploaded = new Map<string, string>();
  for (const e of plan.images) {
    uploaded.set(e.token, `https://cos/uploaded-${e.token.replace(/[^a-z0-9]/gi, '')}.png`);
  }

  const mergeOpts = panelMergeOptionsForReferencedUpload(
    plan.images,
    uploaded,
    dataIn.imagePreview,
    new Map(),
    dataIn.referenceImageLabels,
    dataIn.panelMainSlotVisible
  );
  const panelAfter = mergeAndPrunePanelReferenceImagesAfterUpload(
    panelBefore,
    plan.images,
    uploaded,
    mergeOpts
  );
  const labels = resolveReferenceImageLabelsAfterPanelRun({
    panelBefore,
    labelsBefore: dataIn.referenceImageLabels,
    panelAfter,
    plan,
  });
  const previewPatch = buildPanelImagePreviewPatchAfterRun(plan.images, uploaded, {
    nodeData: dataIn,
    mergedPanelRefs: panelAfter,
    mergedPanelLabels: labels,
  });
  const after = {
    ...dataIn,
    ...previewPatch,
    referenceImages: panelAfter,
    referenceImageLabels: labels,
    status: 'completed',
  } as NodeData;
  const display = buildImage2PanelDisplayEntries(after);
  const compacted = compactImage2PanelReferences(after);

  console.log('  panelBefore:', panelBefore.length, panelBefore.map((u) => u.slice(-20)));
  console.log('  panelAfter:', panelAfter.length, panelAfter.map((u) => String(u || '').slice(-20)));
  console.log('  labels:', labels);
  console.log('  previewPatch:', previewPatch);
  console.log('  display:', display.map((e) => ({ slot: e.slotIndex, url: e.url.slice(-20) })));
  console.log('  compact:', compacted.referenceImages.length, compacted.referenceImageLabels);

  return { plan, panelBefore, panelAfter, labels, display, compacted, after };
}

const base = node.data as NodeData;

// 场景 A：JSON 导出态（已运行一次，labels 双「图片1」，prompt @图片1+@图片2）
const rA = simulateRun('JSON 导出态再运行', { ...base, status: 'idle' }, base.prompt || '');

// 场景 B：标签已正确时（对照，非 duplicate 路径）
const rB = simulateRun(
  '标签已正确 [图片1,图片2]',
  { ...base, status: 'idle', referenceImageLabels: ['图片1', '图片2'] },
  base.prompt || ''
);
ok('正确 labels 时 plan 含 @图片2', rB.plan.images.some((e) => e.token === '@图片2'), JSON.stringify(rB.plan.images));

// 场景 C：用户只改了 prompt 去掉 @图片2
const rC = simulateRun(
  '仅 @图片1 再运行',
  { ...base, status: 'idle' },
  '@图片1参考风格生成'
);

ok('JSON态 plan 含 @图片2', rA.plan.images.some((e) => e.token === '@图片2'), JSON.stringify(rA.plan.images));
ok('JSON态 @图片1/@图片2 不同槽', (() => {
  const a = rA.plan.images.find((e) => e.token === '@图片1');
  const b = rA.plan.images.find((e) => e.token === '@图片2');
  return a && b && a.refImageSlotIndex !== b.refImageSlotIndex;
})(), JSON.stringify(rA.plan.images));
ok('JSON态 panelAfter 保留 2 槽', rA.panelAfter.length >= 2, String(rA.panelAfter.length));
ok('JSON态 labels 修正为 图片1+图片2', rA.labels[0] === '图片1' && rA.labels[1] === '图片2', JSON.stringify(rA.labels));

ok('正确 labels 时 @图片2 槽位 1', rB.plan.images.find((e) => e.token === '@图片2')?.refImageSlotIndex === 1);

ok('仅@图片1 panelAfter 仍保留未@槽', rC.panelAfter.filter(Boolean).length >= 2, String(rC.panelAfter.length));

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);

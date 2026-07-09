/**
 * 复现 d:/json/主图消失.json：删节点后再运行，面板主图格消失
 * npx tsx scripts/zhutu-panel-loss-test.ts
 */
import fs from 'fs';
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
  shouldShowPanelMainImageSlot,
} from '../utils/referencedMediaRun.ts';
import { resolveReferenceImageLabelsAfterPanelRun } from '../utils/referenceImageSlotLabels.ts';
import {
  buildImage2PanelDisplayEntries,
  image2MaxReferenceSlots,
} from '../utils/image2PanelRefs.ts';
import {
  mainPanelPendingLocalHydrate,
  anyPanelRefsPendingLocalHydrate,
} from '../utils/hydratePanelReferenceLocalRefs.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const json = JSON.parse(fs.readFileSync('d:/json/主图消失.json', 'utf8'));
const node = json.nodes.find((n: { id: string }) => n.id === 'node_3_1783498963620');
if (!node) throw new Error('node_3 not found');

const baseData = node.data as NodeData;
const image2Data = { ...baseData, selectedModel: 'image 2' as const } as NodeData;

function simulateRun(label: string, dataIn: NodeData) {
  console.log(`\n=== ${label} ===`);
  const prompt = dataIn.prompt || '';
  const ctx = buildPromptMediaRefContextFromNode(dataIn);
  const plan = collectReferencedMediaFromPrompt(prompt, dataIn, ctx, new Map());
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
    projectAssets: [],
  });
  const after = {
    ...dataIn,
    ...previewPatch,
    referenceImages: panelAfter,
    referenceImageLabels: labels,
    status: 'completed',
  } as NodeData;
  const display = buildImage2PanelDisplayEntries(after);
  console.log('  previewPatch:', previewPatch);
  console.log('  shouldShowMain:', shouldShowPanelMainImageSlot(after));
  console.log('  mainPendingHydrate:', mainPanelPendingLocalHydrate(after));
  console.log('  anyPendingHydrate:', anyPanelRefsPendingLocalHydrate(after));
  console.log('  maxRefSlots:', image2MaxReferenceSlots(after));
  console.log('  display slots:', display.length);
  return { after, previewPatch, display };
}

console.log('JSON 态：panelMainSlotVisible=', baseData.panelMainSlotVisible);
console.log('JSON 态：panelMainImageUrl=', baseData.panelMainImageUrl);
console.log('JSON 态：imageLocalRef=', baseData.imageLocalRef?.slice(-20));

ok(
  'JSON 导出态应展示主图格（imageLocalRef）',
  shouldShowPanelMainImageSlot(image2Data),
  String(shouldShowPanelMainImageSlot(image2Data))
);
ok(
  'JSON 导出态应触发主图 hydrate',
  mainPanelPendingLocalHydrate(image2Data),
  String(mainPanelPendingLocalHydrate(image2Data))
);
ok(
  'JSON 导出态 anyPanelRefsPending 含主图',
  anyPanelRefsPendingLocalHydrate(image2Data),
  String(anyPanelRefsPendingLocalHydrate(image2Data))
);

// 删画布源节点后：referenceElementIds[1] 清空，参考槽 URL 仍保留
const afterDeleteNode = {
  ...image2Data,
  status: 'idle' as const,
  referenceElementIds: ['', ''],
} as NodeData;

const r1 = simulateRun('删节点后再运行', afterDeleteNode);
ok(
  '再运行后勿把 @图片1 URL 误写入 panelMainImageUrl',
  !r1.previewPatch.panelMainImageUrl ||
    r1.previewPatch.panelMainImageUrl !== afterDeleteNode.referenceImages?.[0],
  String(r1.previewPatch.panelMainImageUrl)
);
ok(
  '再运行后仍应展示主图格',
  shouldShowPanelMainImageSlot(r1.after),
  String(shouldShowPanelMainImageSlot(r1.after))
);
ok(
  '再运行后仍应触发主图 hydrate',
  mainPanelPendingLocalHydrate(r1.after),
  String(mainPanelPendingLocalHydrate(r1.after))
);
ok('再运行后 image2 面板格数 >= 2', r1.display.length >= 2, String(r1.display.length));

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);

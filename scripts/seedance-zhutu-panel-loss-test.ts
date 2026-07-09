/**
 * 复现 d:/json/主图消失2.json：seedance 参考生运行后删节点，面板主图格消失
 * npx tsx scripts/seedance-zhutu-panel-loss-test.ts
 */
import fs from 'fs';
import type { NodeData } from '../types.ts';
import {
  shouldShowPanelMainImageSlot,
  resolvePanelMainSlotPreviewUrl,
  seedanceReferenceCompactRefsIncludeMainLabel,
} from '../utils/referencedMediaRun.ts';
import {
  needsMainBackupHydrateFromLocalRef,
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

const json = JSON.parse(fs.readFileSync('d:/json/主图消失2.json', 'utf8'));
const node = json.nodes[0];
if (!node) throw new Error('node not found');

const data = node.data as NodeData;

console.log('model:', data.selectedModel);
console.log('mode:', data.seedanceGenerationMode);
console.log('panelMainSlotVisible:', data.panelMainSlotVisible);
console.log('panelMainImageUrl:', data.panelMainImageUrl);
console.log('imageLocalRef:', data.imageLocalRef?.slice(-20));
console.log('imagePreview===ref[0]:', data.imagePreview === data.referenceImages?.[0]);

ok(
  '非紧凑主图标签（无「主图」label）',
  !seedanceReferenceCompactRefsIncludeMainLabel(data),
  String(data.referenceImageLabels)
);
ok('应展示主图格', shouldShowPanelMainImageSlot(data), String(shouldShowPanelMainImageSlot(data)));
ok(
  'resolve 无备份时为 undefined',
  resolvePanelMainSlotPreviewUrl(data) === undefined,
  String(resolvePanelMainSlotPreviewUrl(data))
);
ok(
  '应触发主图 hydrate',
  needsMainBackupHydrateFromLocalRef(data),
  String(needsMainBackupHydrateFromLocalRef(data))
);
ok(
  'anyPanelRefsPending 含主图',
  anyPanelRefsPendingLocalHydrate(data),
  String(anyPanelRefsPendingLocalHydrate(data))
);

// 删画布源节点
const afterDelete = {
  ...data,
  referenceElementIds: ['', '', '', ''],
  referenceImages: [
    data.referenceImages![0],
    data.referenceImages![1],
    '',
    '',
  ],
} as NodeData;
ok(
  '删节点后仍应展示主图格',
  shouldShowPanelMainImageSlot(afterDelete),
  String(shouldShowPanelMainImageSlot(afterDelete))
);
ok(
  '删节点后仍须 hydrate',
  mainPanelPendingLocalHydrate(afterDelete),
  String(mainPanelPendingLocalHydrate(afterDelete))
);

// 444444 对照：紧凑 API 含「主图」标签时不单独展示主图格
const compactMain = {
  selectedModel: 'seedance2.0 (急速版)',
  seedanceGenerationMode: 'reference',
  panelMainSlotVisible: false,
  imageLocalRef: 'flowgen-local:u:p:n:main',
  referenceImages: ['https://cos/a.png', 'https://cos/b.png'],
  referenceImageLabels: ['主图', '图片3'],
} as NodeData;
ok(
  '紧凑主图标签不展示独立主图格',
  !shouldShowPanelMainImageSlot(compactMain),
  String(shouldShowPanelMainImageSlot(compactMain))
);
ok(
  '紧凑主图标签不触发 hydrate',
  !needsMainBackupHydrateFromLocalRef(compactMain),
  String(needsMainBackupHydrateFromLocalRef(compactMain))
);

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);

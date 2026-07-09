/**
 * 20260709-bannana.json：运行后 blob 参考槽 + panelMainImageUrl 须触发 post-run hydrate 复检
 * npx tsx scripts/20260709-banana-panel-run-hydrate-test.ts
 */
import fs from 'fs';
import type { NodeData } from '../types.ts';
import {
  panelNeedsPostRunBlobHydrateRecheck,
  panelHasBlobBackedLocalRefSlots,
} from '../utils/hydratePanelReferenceLocalRefs.ts';
import {
  buildPanelReferenceDisplayEntries,
  firstEmptyPanelReferenceSlotIndex,
} from '../utils/referenceImageSlotLabels.ts';
import { shouldShowPanelMainImageSlot } from '../utils/referencedMediaRun.ts';
import {
  buildStillImageOutputSpawnPatch,
  resolveSpawnOutputDefaultModel,
} from '../utils/spawnOutputNode.ts';
import { MODEL_NANO_BANANA_2 } from '../types.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const json = JSON.parse(fs.readFileSync('d:/json/20260709-bannana.json', 'utf8'));
const node = json.nodes.find(
  (n: { data: { selectedModel?: string } }) => n.data.selectedModel === 'Nano Banana 2.0'
);
const data = node!.data as NodeData;

console.log('=== 20260709 Banana 运行后面板 hydrate 复检 ===\n');

ok(
  '运行完成态应触发 post-run blob 复检',
  panelNeedsPostRunBlobHydrateRecheck(data),
  String(data.status)
);
ok(
  '含 blob 参考槽 + localRef',
  panelHasBlobBackedLocalRefSlots(data),
  JSON.stringify(data.referenceImageLocalRefs)
);
ok(
  '主图格应展示（panelMainImageUrl 备份）',
  shouldShowPanelMainImageSlot(data),
  String(data.panelMainImageUrl || '').slice(0, 40)
);

const entries = buildPanelReferenceDisplayEntries(data.referenceImages || [], {
  referenceImageLabels: data.referenceImageLabels,
});
ok('面板展示条目仍为 4 槽', entries.length === 4, String(entries.length));

const sparse = ['https://cos/a.png', '', 'blob:x', ''];
ok(
  '空槽 append 用 firstEmptyPanelReferenceSlotIndex',
  firstEmptyPanelReferenceSlotIndex(sparse) === 1,
  String(firstEmptyPanelReferenceSlotIndex(sparse))
);
ok(
  '尾槽 append 下标',
  firstEmptyPanelReferenceSlotIndex(['a', 'b', 'c']) === 3,
  String(firstEmptyPanelReferenceSlotIndex(['a', 'b', 'c']))
);

ok(
  'Banana spawn OUTPUT 默认模型仍为 Banana',
  resolveSpawnOutputDefaultModel({
    isVideoModel: false,
    currentModelName: MODEL_NANO_BANANA_2,
  }) === MODEL_NANO_BANANA_2,
  resolveSpawnOutputDefaultModel({
    isVideoModel: false,
    currentModelName: MODEL_NANO_BANANA_2,
  })
);
ok(
  '非生图 OUTPUT 仍默认可灵 2.5',
  resolveSpawnOutputDefaultModel({
    isVideoModel: false,
    currentModelName: 'seedance2.0 (急速版)',
  }) === '可灵 2.5 Turbo',
  resolveSpawnOutputDefaultModel({
    isVideoModel: false,
    currentModelName: 'seedance2.0 (急速版)',
  })
);

const spawnPatch = buildStillImageOutputSpawnPatch(
  {
    modelConfigs: { [MODEL_NANO_BANANA_2]: { aspectRatio: '1:1' } },
    firstFrameImageUrl: 'https://x',
  },
  MODEL_NANO_BANANA_2
);
ok('Banana OUTPUT spawn 带 modelConfigs', !!spawnPatch.modelConfigs?.[MODEL_NANO_BANANA_2]);
ok('Banana OUTPUT spawn 清首尾帧', spawnPatch.firstFrameImageUrl === undefined);

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);

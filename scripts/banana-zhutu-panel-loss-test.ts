/**
 * 复现 d:/json/banana主图.json：Banana 运行后删节点，主图格 blob revoke 显示破损
 * npx tsx scripts/banana-zhutu-panel-loss-test.ts
 */
import fs from 'fs';
import type { NodeData } from '../types.ts';
import { MODEL_NANO_BANANA_2 } from '../types.ts';
import {
  shouldShowPanelMainImageSlot,
  resolvePanelMainSlotPreviewUrl,
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

const json = JSON.parse(fs.readFileSync('d:/json/banana主图.json', 'utf8'));
const node = json.nodes[0];
if (!node) throw new Error('node not found');

const data = node.data as NodeData;

console.log('panelMainImageUrl:', data.panelMainImageUrl?.slice(0, 48));
console.log('imageLocalRef:', data.imageLocalRef?.slice(-30));
console.log('panelMainSlotVisible:', data.panelMainSlotVisible);

ok('应展示主图格', shouldShowPanelMainImageSlot(data), String(shouldShowPanelMainImageSlot(data)));
ok(
  'resolve 仍指向 panelMainImageUrl（导出态）',
  resolvePanelMainSlotPreviewUrl(data) === data.panelMainImageUrl,
  String(resolvePanelMainSlotPreviewUrl(data)?.slice(0, 40))
);
ok(
  'stale blob 应触发主图 backup hydrate',
  needsMainBackupHydrateFromLocalRef(data),
  String(needsMainBackupHydrateFromLocalRef(data))
);
ok(
  'mainPanelPendingLocalHydrate',
  mainPanelPendingLocalHydrate(data),
  String(mainPanelPendingLocalHydrate(data))
);
ok(
  'anyPanelRefsPending 含主图',
  anyPanelRefsPendingLocalHydrate(data),
  String(anyPanelRefsPendingLocalHydrate(data))
);

// 删画布源节点后（referenceElementIds 清空）
const afterDelete = {
  ...data,
  referenceElementIds: ['', '', '', null],
} as NodeData;
ok(
  '删节点后仍须 hydrate 主图 backup',
  needsMainBackupHydrateFromLocalRef(afterDelete),
  String(needsMainBackupHydrateFromLocalRef(afterDelete))
);

// 对照：cos 备份不需 hydrate
const withCosBackup = {
  ...data,
  panelMainImageUrl: 'https://cos.example/main.png',
} as NodeData;
ok(
  'cos 备份不触发 hydrate',
  !needsMainBackupHydrateFromLocalRef(withCosBackup),
  String(needsMainBackupHydrateFromLocalRef(withCosBackup))
);

// 对照：Omni 不适用
const omniStale = {
  selectedModel: '可灵3.0 Omni',
  panelMainImageUrl: 'blob:http://localhost:3001/revoked',
  imageLocalRef: 'flowgen-local:u:p:n:main',
  panelMainSlotVisible: false,
} as NodeData;
ok('Omni stale blob 不触发主图 hydrate', !needsMainBackupHydrateFromLocalRef(omniStale));

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);

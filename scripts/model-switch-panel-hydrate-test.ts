/**
 * 复现：Banana 拖图 → 切 image2 → 刷新 → 切回 Banana 面板空，再刷新才显示
 * 修复：切模型时 align 槽位 + Inspector 从 localRefs hydrate
 * npx tsx scripts/model-switch-panel-hydrate-test.ts
 */
import type { NodeData } from '../types.ts';
import { sanitizePersistValueDeep } from '../utils/persistSanitize.mjs';
import {
  alignPanelReferenceSlotsFromLocalRefs,
  anyPanelRefsPendingLocalHydrate,
} from '../utils/hydratePanelReferenceLocalRefs.ts';
import { nanoBananaMainPatchOnModelSwitch } from '../utils/modelSwitchPanelIsolation.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const longData = `data:image/jpeg;base64,${'B'.repeat(9000)}`;
const mainBlob = 'blob:http://localhost:3001/banana-main';

const bananaBeforeSwitch = {
  selectedModel: 'Nano Banana 2.0',
  imagePreview: mainBlob,
  imageLocalRef: 'flowgen-local:uid_pid:node:main',
  referenceImages: [longData, longData],
  referenceImageLabels: ['图片1', '图片2'],
  referenceImageLocalRefs: [
    'flowgen-local:uid_pid:node:ref:0',
    'flowgen-local:uid_pid:node:ref:1',
  ],
} as Partial<NodeData>;

console.log('\n=== 1. Banana 切 image2 前保存到 modelConfigs（内存）===\n');
const bananaSnapshot = {
  referenceImages: [...(bananaBeforeSwitch.referenceImages || [])],
  referenceImageLabels: bananaBeforeSwitch.referenceImageLabels,
  referenceImageLocalRefs: bananaBeforeSwitch.referenceImageLocalRefs,
  imagePreview: bananaBeforeSwitch.imagePreview,
  imageLocalRef: bananaBeforeSwitch.imageLocalRef,
};

console.log('\n=== 2. 刷新后当前在 image2，Banana 快照已 sanitize ===\n');
const savedBanana = sanitizePersistValueDeep(bananaSnapshot) as typeof bananaSnapshot;
ok(
  'Banana localRefs 保留',
  (savedBanana.referenceImageLocalRefs || []).length === 2,
  JSON.stringify(savedBanana.referenceImageLocalRefs)
);
ok(
  'Banana referenceImages 剥离为空槽',
  (savedBanana.referenceImages || []).every((u) => !String(u || '').startsWith('data:')),
  JSON.stringify(savedBanana.referenceImages)
);
ok('Banana imageLocalRef 保留', Boolean(savedBanana.imageLocalRef));

console.log('\n=== 3. 切回 Banana：align + main patch（模拟 handleModelChange）===\n');
const aligned = alignPanelReferenceSlotsFromLocalRefs(
  savedBanana.referenceImages,
  savedBanana.referenceImageLocalRefs
);
const switchBack: Partial<NodeData> = {
  selectedModel: 'Nano Banana 2.0',
  referenceImages: aligned.images,
  referenceImageLocalRefs: aligned.localRefs,
  referenceImageLabels: savedBanana.referenceImageLabels,
  ...nanoBananaMainPatchOnModelSwitch(savedBanana, {}),
};

ok(
  '切回后 referenceImages 槽位与 localRefs 对齐',
  (switchBack.referenceImages || []).length === 2,
  JSON.stringify(switchBack.referenceImages)
);
ok(
  '切回后待 hydrate（面板应触发 IDB 恢复）',
  anyPanelRefsPendingLocalHydrate(switchBack),
  String(anyPanelRefsPendingLocalHydrate(switchBack))
);
ok(
  '切回后 imageLocalRef 恢复',
  switchBack.imageLocalRef === savedBanana.imageLocalRef,
  String(switchBack.imageLocalRef)
);
ok(
  '切回后 imagePreview 为空（待主图 hydrate）',
  !String(switchBack.imagePreview || '').trim(),
  String(switchBack.imagePreview || '')
);

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);

/**
 * 复现：Nano 拖入 4 blob + 1 https 参考图 → 切 image2 → 切回 Nano
 * 检查切回后 referenceImages 是否有 broken URL
 * npx tsx scripts/panel-switch-broken-urls-test.ts
 */
import type { NodeData } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2 } from '../types.ts';
import { sanitizePersistValueDeep } from '../utils/persistSanitize.mjs';
import {
  alignPanelReferenceSlotsFromLocalRefs,
  anyPanelRefsPendingLocalHydrate,
  needsHydrateFromLocalRef,
  stripRestoredNodeMediaForLocalRefHydrate,
} from '../utils/hydratePanelReferenceLocalRefs.ts';
import { nanoBananaMainPatchOnModelSwitch } from '../utils/modelSwitchPanelIsolation.ts';
import { buildPanelRefSlotSyncPatch } from '../utils/panelRefPersistence.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

function simNode(p: Partial<NodeData> & { selectedModel: string }): NodeData {
  return { label: 'broken-test', ...p } as NodeData;
}

/** 模拟 handleModelChange 中切回 Nano/image2 时的 data: URL 剥离（保留 blob: 和 https） */
function stripEphemeralUrls(images: string[]): string[] {
  return images.map((u) => {
    const s = String(u || '').trim();
    if (!s) return '';
    if (s.startsWith('data:')) return '';
    return s;
  });
}

/** 模拟 handleModelChange 末尾 stripRestoredNodeMediaForLocalRefHydrate */
function applyModelRestoreStrip(data: NodeData): NodeData {
  return { ...data, ...stripRestoredNodeMediaForLocalRefHydrate(data) };
}

/** 模拟 IDB hydrate：空槽 → blob 预览 */
function mockHydrateRefs(data: NodeData): NodeData {
  const refs = [...(data.referenceImages || [])];
  const localRefs = [...(data.referenceImageLocalRefs || [])];
  const maxLen = Math.max(refs.length, localRefs.length);
  const next = [...refs];
  while (next.length < maxLen) next.push('');
  for (let i = 0; i < maxLen; i++) {
    const lr = String(localRefs[i] || '').trim();
    if (!lr) continue;
    if (!needsHydrateFromLocalRef(next[i])) continue;
    next[i] = `blob:http://localhost/hydrated-${i}`;
  }
  return { ...data, referenceImages: next };
}

console.log('\n=== 场景1：Nano 4 blob + 1 https → 切 image2 → 切回（无刷新）===\n');

const blob1 = 'blob:http://localhost:3001/ref-1';
const blob2 = 'blob:http://localhost:3001/ref-2';
const blob3 = 'blob:http://localhost:3001/ref-3';
const blob4 = 'blob:http://localhost:3001/ref-4';
const httpsRef = 'https://cos.example.com/asset-landscape.png';
const mainBlob = 'blob:http://localhost:3001/main-woman';

const local0 = 'flowgen-local:uid_pid:node:ref:0';
const local1 = 'flowgen-local:uid_pid:node:ref:1';
const local2 = 'flowgen-local:uid_pid:node:ref:2';
const local3 = 'flowgen-local:uid_pid:node:ref:3';
// https ref from asset library — no localRef

const nanoBefore = simNode({
  selectedModel: MODEL_NANO_BANANA_2,
  imagePreview: mainBlob,
  imageLocalRef: 'flowgen-local:uid_pid:node:main',
  referenceImages: [blob1, blob2, blob3, blob4, httpsRef],
  referenceImageLabels: ['图片1', '图片2', '图片3', '图片4', '风景'],
  referenceImageLocalRefs: [local0, local1, local2, local3, ''],
  prompt: '',
  modelConfigs: {},
});

// Step 1: handleModelChange — save Nano config, switch to image2
const savedNanoConfig = {
  prompt: nanoBefore.prompt,
  referenceImages: [...nanoBefore.referenceImages!],
  referenceImageLabels: [...nanoBefore.referenceImageLabels!],
  referenceImageLocalRefs: [...nanoBefore.referenceImageLocalRefs!],
  imagePreview: nanoBefore.imagePreview,
  imageLocalRef: nanoBefore.imageLocalRef,
};

const onImage2 = simNode({
  selectedModel: MODEL_IMAGE_2,
  imagePreview: undefined,
  referenceImages: [],
  referenceImageLocalRefs: [],
  modelConfigs: { [MODEL_NANO_BANANA_2]: savedNanoConfig },
  prompt: '',
});

ok('image2 切换后 Nano 快照有 5 ref', (savedNanoConfig.referenceImages || []).length === 5, JSON.stringify(savedNanoConfig.referenceImages?.length));
ok('image2 切换后 Nano 快照有 4 localRef', (savedNanoConfig.referenceImageLocalRefs || []).filter(Boolean).length === 4, JSON.stringify(savedNanoConfig.referenceImageLocalRefs));

// Step 2: handleModelChange — save image2, switch back to Nano
const nanoConfig = onImage2.modelConfigs?.[MODEL_NANO_BANANA_2] || {};
const aligned = alignPanelReferenceSlotsFromLocalRefs(
  nanoConfig.referenceImages,
  nanoConfig.referenceImageLocalRefs
);
const switchBack = applyModelRestoreStrip(simNode({
  selectedModel: MODEL_NANO_BANANA_2,
  referenceImages: stripEphemeralUrls(aligned.images),
  referenceImageLocalRefs: aligned.localRefs,
  referenceImageLabels: nanoConfig.referenceImageLabels,
  ...nanoBananaMainPatchOnModelSwitch(nanoConfig, onImage2),
  modelConfigs: onImage2.modelConfigs,
  prompt: nanoConfig.prompt || '',
}));

ok('切回后 5 ref 槽', (switchBack.referenceImages || []).length === 5, JSON.stringify(switchBack.referenceImages));
// 有 localRef 的 blob 被剥离，待 IDB hydrate；https 保留
ok('切回后 4 空槽 + 1 https（stale blob 剥离）',
  (switchBack.referenceImages || []).filter(u => !String(u||'').trim()).length === 4 &&
  (switchBack.referenceImages || []).filter(u => String(u||'').startsWith('https:')).length === 1,
  JSON.stringify(switchBack.referenceImages));
ok('切回后 pending hydrate = true', anyPanelRefsPendingLocalHydrate(switchBack), String(anyPanelRefsPendingLocalHydrate(switchBack)));

// buildPanelRefSlotSyncPatch 模拟 — pending 时跳过
const syncPatch = anyPanelRefsPendingLocalHydrate(switchBack)
  ? undefined
  : buildPanelRefSlotSyncPatch(switchBack, { dedupeAgainstMain: false, projectAssets: [] });
ok('pending 时 syncPatch 不运行', !syncPatch?.referenceImages, JSON.stringify(syncPatch?.referenceImages));

// 模拟 hydrate 后恢复
const switchBackHydrated = mockHydrateRefs(switchBack);
ok('hydrate 后 4 blob 恢复',
  (switchBackHydrated.referenceImages || []).filter(u => String(u||'').startsWith('blob:')).length === 4,
  JSON.stringify(switchBackHydrated.referenceImages));

console.log('\n=== 场景2：Nano 4 blob + 1 https → 刷新 → 切 image2 → 切回 ===\n');

// Step 1: refresh — sanitize strips blob, keeps localRefs
const afterSanitize = sanitizePersistValueDeep({ data: nanoBefore }).data as NodeData;
ok('sanitize 后 blob 被剥离', (afterSanitize.referenceImages || []).filter(u => String(u||'').startsWith('blob:')).length === 0, JSON.stringify(afterSanitize.referenceImages));
ok('sanitize 后 https 保留', (afterSanitize.referenceImages || []).filter(u => String(u||'').startsWith('https:')).length === 1, JSON.stringify(afterSanitize.referenceImages));
ok('sanitize 后 4 localRef 保留', (afterSanitize.referenceImageLocalRefs || []).filter(Boolean).length === 4, JSON.stringify(afterSanitize.referenceImageLocalRefs));

// Step 2: mock IDB hydrate (FlowEditor hydrateLocalMediaPreviews)
const afterHydrate = mockHydrateRefs(afterSanitize);
ok('hydrate 后 4 blob 恢复', (afterHydrate.referenceImages || []).filter(u => String(u||'').startsWith('blob:')).length === 4, JSON.stringify(afterHydrate.referenceImages));
ok('hydrate 后 https 仍在', (afterHydrate.referenceImages || []).filter(u => String(u||'').startsWith('https:')).length === 1, JSON.stringify(afterHydrate.referenceImages));
ok('hydrate 后 5 槽', (afterHydrate.referenceImages || []).length === 5, JSON.stringify(afterHydrate.referenceImages));

// Step 3: switch to image2 — save Nano with restored blob URLs
const savedNano2 = {
  referenceImages: [...afterHydrate.referenceImages!],
  referenceImageLabels: [...afterHydrate.referenceImageLabels!],
  referenceImageLocalRefs: [...afterHydrate.referenceImageLocalRefs!],
  imagePreview: afterHydrate.imagePreview,
  imageLocalRef: afterHydrate.imageLocalRef,
  prompt: afterHydrate.prompt,
};

const onImage2_v2 = simNode({
  selectedModel: MODEL_IMAGE_2,
  referenceImages: [],
  referenceImageLocalRefs: [],
  modelConfigs: { [MODEL_NANO_BANANA_2]: savedNano2 },
});

// Step 4: switch back to Nano
const nanoCfg2 = onImage2_v2.modelConfigs?.[MODEL_NANO_BANANA_2] || {};
const aligned2 = alignPanelReferenceSlotsFromLocalRefs(
  nanoCfg2.referenceImages,
  nanoCfg2.referenceImageLocalRefs
);
const switchBack2 = applyModelRestoreStrip(simNode({
  selectedModel: MODEL_NANO_BANANA_2,
  referenceImages: stripEphemeralUrls(aligned2.images),
  referenceImageLocalRefs: aligned2.localRefs,
  referenceImageLabels: nanoCfg2.referenceImageLabels,
  ...nanoBananaMainPatchOnModelSwitch(nanoCfg2, onImage2_v2),
  prompt: nanoCfg2.prompt || '',
}));

ok('切回后 5 ref 槽', (switchBack2.referenceImages || []).length === 5, JSON.stringify(switchBack2.referenceImages));
ok('切回后 pending hydrate（stale blob 剥离）', anyPanelRefsPendingLocalHydrate(switchBack2), String(anyPanelRefsPendingLocalHydrate(switchBack2)));
const switchBack2Hydrated = mockHydrateRefs(switchBack2);
ok('hydrate 后 4 blob + 1 https',
  (switchBack2Hydrated.referenceImages || []).filter(u => String(u||'').startsWith('blob:')).length === 4 &&
  (switchBack2Hydrated.referenceImages || []).filter(u => String(u||'').startsWith('https:')).length === 1,
  JSON.stringify(switchBack2Hydrated.referenceImages));

console.log('\n=== 场景3：Nano 刷新后切 image2 → sanitize 存入 modelConfigs → 切回 ===\n');

// 模拟：刷新后当前在 Nano，blob 已恢复。切到 image2：
// handleModelChange 保存 Nano config = 当前 data（含 blob）→ modelConfigs
// 但保存工程时 sanitize 会剥离 modelConfigs 内 blob
const nanoAfterRefresh = mockHydrateRefs(sanitizePersistValueDeep({ data: nanoBefore }).data as NodeData);

// 保存到 modelConfigs（内存中含 blob）
const memSaved = {
  referenceImages: [...nanoAfterRefresh.referenceImages!],
  referenceImageLocalRefs: [...nanoAfterRefresh.referenceImageLocalRefs!],
  referenceImageLabels: [...nanoAfterRefresh.referenceImageLabels!],
  imagePreview: nanoAfterRefresh.imagePreview,
  imageLocalRef: nanoAfterRefresh.imageLocalRef,
};

// 模拟工程保存 sanitize（modelConfigs 也会被 sanitize）
const sanitizedModelConfigs = sanitizePersistValueDeep({
  [MODEL_NANO_BANANA_2]: memSaved,
}) as any;

const sanitizedNanoCfg = sanitizedModelConfigs[MODEL_NANO_BANANA_2];
console.log('  sanitized modelConfigs Nano:', JSON.stringify({
  refImages: sanitizedNanoCfg?.referenceImages,
  localRefs: sanitizedNanoCfg?.referenceImageLocalRefs,
  imagePreview: sanitizedNanoCfg?.imagePreview,
  imageLocalRef: sanitizedNanoCfg?.imageLocalRef,
}));

ok('sanitize 后 modelConfigs refImages blob 被剥离',
  (sanitizedNanoCfg?.referenceImages || []).filter((u: string) => String(u||'').startsWith('blob:')).length === 0,
  JSON.stringify(sanitizedNanoCfg?.referenceImages));
ok('sanitize 后 modelConfigs https 保留',
  (sanitizedNanoCfg?.referenceImages || []).filter((u: string) => String(u||'').startsWith('https:')).length === 1,
  JSON.stringify(sanitizedNanoCfg?.referenceImages));
ok('sanitize 后 modelConfigs 4 localRef 保留',
  (sanitizedNanoCfg?.referenceImageLocalRefs || []).filter(Boolean).length === 4,
  JSON.stringify(sanitizedNanoCfg?.referenceImageLocalRefs));

// 切回 Nano：用 sanitized modelConfigs
const aligned3 = alignPanelReferenceSlotsFromLocalRefs(
  sanitizedNanoCfg?.referenceImages,
  sanitizedNanoCfg?.referenceImageLocalRefs
);
const switchBack3 = applyModelRestoreStrip(simNode({
  selectedModel: MODEL_NANO_BANANA_2,
  referenceImages: aligned3.images,
  referenceImageLocalRefs: aligned3.localRefs,
  referenceImageLabels: sanitizedNanoCfg?.referenceImageLabels,
  ...nanoBananaMainPatchOnModelSwitch(sanitizedNanoCfg, {}),
  prompt: '',
}));

console.log('  切回后 referenceImages:', JSON.stringify(switchBack3.referenceImages));
console.log('  切回后 imagePreview:', String(switchBack3.imagePreview || ''));

ok('切回后 pending hydrate = true', anyPanelRefsPendingLocalHydrate(switchBack3), String(anyPanelRefsPendingLocalHydrate(switchBack3)));
ok('切回后空槽=4（待 IDB hydrate）',
  (switchBack3.referenceImages || []).filter(u => !String(u||'').trim()).length === 4,
  JSON.stringify(switchBack3.referenceImages));
ok('切回后 https 槽=1',
  (switchBack3.referenceImages || []).filter(u => String(u||'').startsWith('https:')).length === 1,
  JSON.stringify(switchBack3.referenceImages));

// 模拟 NodeInspector hydrate effect
const afterInspectorHydrate = mockHydrateRefs(switchBack3);
// 模拟 main preview hydrate effect（imagePreview 从 IDB 恢复）
const mainRef = String(switchBack3.imageLocalRef || '').trim();
const afterFullHydrate = { ...afterInspectorHydrate };
if (mainRef && !String(afterInspectorHydrate.imagePreview || '').trim()) {
  afterFullHydrate.imagePreview = 'blob:http://localhost/hydrated-main';
}
console.log('  hydrate 后 referenceImages:', JSON.stringify(afterFullHydrate.referenceImages));
console.log('  hydrate 后 imagePreview:', String(afterFullHydrate.imagePreview || ''));
ok('hydrate 后 4 blob 恢复',
  (afterFullHydrate.referenceImages || []).filter(u => String(u||'').startsWith('blob:')).length === 4,
  JSON.stringify(afterFullHydrate.referenceImages));
ok('hydrate 后 1 https 保留',
  (afterFullHydrate.referenceImages || []).filter(u => String(u||'').startsWith('https:')).length === 1,
  JSON.stringify(afterFullHydrate.referenceImages));
ok('hydrate 后无 broken URL',
  (afterFullHydrate.referenceImages || []).every(u => String(u||'').trim()),
  JSON.stringify(afterFullHydrate.referenceImages));

// 检查 imagePreview 是否被恢复
ok('hydrate 后 imagePreview 恢复',
  Boolean(String(afterFullHydrate.imagePreview || '').trim()),
  String(afterFullHydrate.imagePreview || ''));

console.log('\n=== 场景4：modelConfigs 含 stale blob（已 revoke）→ 切回必须重 hydrate ===\n');

const staleBlob = 'blob:http://localhost:3001/revoked-ref';
const switchBackStale = applyModelRestoreStrip(simNode({
  selectedModel: MODEL_NANO_BANANA_2,
  referenceImages: [staleBlob, staleBlob],
  referenceImageLocalRefs: [local0, local1],
  imagePreview: staleBlob,
  imageLocalRef: 'flowgen-local:uid_pid:node:main',
  prompt: '',
}));

ok('stale blob 切回后 ref 槽空', (switchBackStale.referenceImages || []).every(u => !String(u||'').trim()), JSON.stringify(switchBackStale.referenceImages));
ok('stale blob 切回后主图 blob 保留（待 hydrate 替换）', switchBackStale.imagePreview === staleBlob, String(switchBackStale.imagePreview));
ok('stale blob 切回后 pending hydrate', anyPanelRefsPendingLocalHydrate(switchBackStale), String(anyPanelRefsPendingLocalHydrate(switchBackStale)));

const staleHydrated = mockHydrateRefs(switchBackStale);
ok('stale hydrate 后 2 blob 恢复', (staleHydrated.referenceImages || []).filter(u => String(u||'').startsWith('blob:')).length === 2, JSON.stringify(staleHydrated.referenceImages));

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);

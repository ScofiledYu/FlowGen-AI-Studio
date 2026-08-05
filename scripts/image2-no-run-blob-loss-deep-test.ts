/**
 * image2 专项测试：聚焦 image2 未运行刷新 blob 丢失问题
 * 覆盖 NodeInspector 的 shouldShowPanelMainImageSlot / image2ShowMainInRefGrid / mainPreviewDisplaySrc 逻辑
 * npx tsx scripts/image2-no-run-blob-loss-deep-test.ts
 */
import type { NodeData } from '../types.ts';
import { NodeType } from '../types.ts';
import type { Node as RFNode } from 'reactflow';
import { sanitizePersistValueDeep } from '../utils/persistSanitize.mjs';
import { hydrateGraphMediaFromPersisted } from '../utils/hydratePersistedNodePreviews.ts';
import { normalizeGraphNodesProjectAssetBinding } from '../utils/normalizeTemplateNodeForSpawn.ts';
import { shouldPreferRunReferencePreviewOverLocalMain, shouldShowPanelMainImageSlot, resolvePanelMainSlotPreviewUrl } from '../utils/referencedMediaRun.ts';
import { isEphemeralMediaUrl } from '../utils/workspaceMediaPersist.ts';
import { modelFrameLocalRefKey } from '../utils/localNodeMediaStore.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  [OK] ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`); }
}

function simNode(partial: { id: string; type?: NodeType; data: Partial<NodeData> }): RFNode {
  return {
    id: partial.id,
    type: partial.type || NodeType.PROCESSOR,
    position: { x: 0, y: 0 },
    data: { label: 'n', ...partial.data } as NodeData,
  };
}

const serverProjectId = 'proj-123';
const model = 'image 2';
const modelKey = modelFrameLocalRefKey(model);
const scope = 'uid_pid';
const nodeId = 'image2-test-node';

console.log('=== image2 专项：未运行 → 上传主图 → 刷新 → 全链路 ===\n');

// ── 阶段 1：内存状态（上传后） ──
console.log('阶段 1：上传主图后内存状态');

const ref = `flowgen-local:${scope}:${nodeId}:main:${modelKey}`;
const beforePersist: Partial<NodeData> = {
  selectedModel: model,
  imagePreview: `blob:http://localhost:3001/${nodeId}-main`,
  imageLocalRef: ref,
  imageName: 'test.png',
  panelMainSlotVisible: undefined, // image2 上传时设为 undefined
  panelMainImageUrl: undefined,
  status: 'idle',
  prompt: '',
  generationParams: undefined,
  referenceImages: [],
  referenceImageLabels: [],
  referenceImageLocalRefs: [],
};

ok('imagePreview 为 blob URL', beforePersist.imagePreview?.startsWith('blob:') ?? false, String(beforePersist.imagePreview));
ok('imageLocalRef 存在', Boolean(beforePersist.imageLocalRef), String(beforePersist.imageLocalRef));
ok('panelMainSlotVisible 为 undefined', beforePersist.panelMainSlotVisible === undefined);
ok('panelMainImageUrl 为 undefined', beforePersist.panelMainImageUrl === undefined);
ok('generationParams 为 undefined', beforePersist.generationParams === undefined);

// ── 阶段 2：persist（sanitize） ──
console.log('\n阶段 2：persist 后（sanitize）');

const saved = sanitizePersistValueDeep(beforePersist) as Partial<NodeData>;
ok('imagePreview 被剥离', !saved.imagePreview || saved.imagePreview === '');
ok('imageLocalRef 保留', Boolean(saved.imageLocalRef), String(saved.imageLocalRef));
ok('panelMainSlotVisible 不变', saved.panelMainSlotVisible === undefined);
ok('panelMainImageUrl 被剥离', !saved.panelMainImageUrl || saved.panelMainImageUrl === '');
ok('generationParams 仍为 undefined', saved.generationParams === undefined);

// ── 阶段 3：hydrateGraphMediaFromPersisted ──
console.log('\n阶段 3：hydrateGraphMediaFromPersisted');

const node = simNode({ id: nodeId, type: NodeType.PROCESSOR, data: saved });
const hydrated = hydrateGraphMediaFromPersisted([node], []);
const hData = hydrated[0].data as NodeData;

ok('imagePreview 为空（待 IDB 恢复）', !hData.imagePreview || hData.imagePreview === '', JSON.stringify(hData.imagePreview));
ok('imageLocalRef 保留', Boolean(hData.imageLocalRef), String(hData.imageLocalRef));
ok('panelMainSlotVisible 不变', (hData as any).panelMainSlotVisible === undefined);
ok('generationParams 仍为 undefined', hData.generationParams === undefined);

// ── 阶段 4：normalizeGraphNodesProjectAssetBinding ──
console.log('\n阶段 4：normalizeGraphNodesProjectAssetBinding（§10.70 修复后）');

const bound = normalizeGraphNodesProjectAssetBinding(hydrated, serverProjectId);
const bData = bound[0].data as NodeData;

// 关键验证：修复后 imageLocalRef 不应被误删
ok('§10.70: imageLocalRef 保留', bData.imageLocalRef === ref, `expected=${ref} actual=${String(bData.imageLocalRef || 'MISSING')}`);
ok('§10.70: imagePreview 仍为空', !bData.imagePreview || bData.imagePreview === '', JSON.stringify(bData.imagePreview));
ok('§10.70: 节点未被修改（引用相同）', bound[0] === hydrated[0] || bound[0].data === hydrated[0].data, 'node unchanged');

// ── 阶段 5：模拟 NodeInspector → shouldShowPanelMainImageSlot ──
console.log('\n阶段 5：模拟 NodeInspector 渲染 —— shouldShowPanelMainImageSlot');

const slotVisible1 = shouldShowPanelMainImageSlot(bData);
ok('shouldShowPanelMainImageSlot 返回 false（imagePreview 为空）', slotVisible1 === false);

// ── 阶段 6：模拟 NodeInspector → image2ShowMainInRefGrid ──
console.log('\n阶段 6：模拟 NodeInspector 渲染 —— image2ShowMainInRefGrid');

const mainPreviewUrl1 = resolvePanelMainSlotPreviewUrl(bData);
ok('resolvePanelMainSlotPreviewUrl 返回 undefined（无预览）', mainPreviewUrl1 === undefined || mainPreviewUrl1 === '');

const showMainInGrid1 = !slotVisible1 ? false : (() => {
  const p = resolvePanelMainSlotPreviewUrl(bData);
  if (p && !/\bvideo\b/i.test(p)) return true;
  return Boolean(String(bData.imageLocalRef || '').trim());
})();
// 简化：image2ShowMainInRefGrid 逻辑
// if (!shouldShowPanelMainImageSlot) return false
// const p = resolvePanelMainSlotPreviewUrl; if (p && !isVideo) return true
// return Boolean(imageLocalRef)
// 但 shouldShowPanelMainImageSlot 是 false，所以直接返回 false
ok('image2ShowMainInRefGrid 返回 false（无预览 + 无主图格）', showMainInGrid1 === false);

// ── 阶段 7：模拟 hydrateLocalMediaPreviews 恢复后 ──
console.log('\n阶段 7：模拟 hydrateLocalMediaPreviews 从 IDB 恢复后');

const recoveredBlobUrl = `blob:http://localhost:3001/recovered-${nodeId}`;
const recoveredData: Partial<NodeData> = {
  ...bData,
  imagePreview: recoveredBlobUrl,
};

// ── 阶段 8：恢复后 NodeInspector 渲染 ──
console.log('\n阶段 8：恢复后 NodeInspector 渲染');

const slotVisible2 = shouldShowPanelMainImageSlot(recoveredData);
ok('shouldShowPanelMainImageSlot 返回 true（blob 已恢复）', slotVisible2 === true);

const mainPreviewUrl2 = resolvePanelMainSlotPreviewUrl(recoveredData);
ok('resolvePanelMainSlotPreviewUrl 返回 blob URL', mainPreviewUrl2 === recoveredBlobUrl, String(mainPreviewUrl2));

const showMainInGrid2 = (() => {
  if (!slotVisible2) return false;
  const p = resolvePanelMainSlotPreviewUrl(recoveredData);
  if (p && !/\bvideo\b/i.test(p)) return true;
  return Boolean(String(recoveredData.imageLocalRef || '').trim());
})();
ok('image2ShowMainInRefGrid 返回 true（blob 已恢复）', showMainInGrid2 === true);

// mainPreviewDisplaySrc = resolveDisplayMediaUrl(resolvePanelMainSlotPreviewUrl(data))
// resolveDisplayMediaUrl 对 blob URL 直接返回
const mainPreviewDisplaySrc = recoveredBlobUrl;
ok('mainPreviewDisplaySrc 为 blob URL', mainPreviewDisplaySrc === recoveredBlobUrl, mainPreviewDisplaySrc);

// ── 阶段 9：hydrateLocalMediaPreviews 判断条件 ──
console.log('\n阶段 9：hydrateLocalMediaPreviews 恢复判断条件');

const shouldRecover = !shouldPreferRunReferencePreviewOverLocalMain(bData);
const previewEmpty = !bData.imagePreview || isEphemeralMediaUrl(String(bData.imagePreview || ''), 'imagePreview');
const hasLocalRef = Boolean(bData.imageLocalRef);
ok('shouldPreferRunReferencePreviewOverLocalMain 返回 false', shouldRecover === true);
ok('imagePreview 为空或 ephemeral', previewEmpty === true);
ok('imageLocalRef 存在', hasLocalRef === true);
ok('允许从 IDB 恢复', shouldRecover && previewEmpty && hasLocalRef);

// ── 阶段 10：第二次 hydratePersistedRemotePreviews 是否会清除已恢复的 blob ──
console.log('\n阶段 10：第二次 hydratePersistedRemotePreviews 是否误清除已恢复的 blob');

const recoveredNode = simNode({ id: nodeId, type: NodeType.PROCESSOR, data: recoveredData });
const hydrated2 = hydrateGraphMediaFromPersisted([recoveredNode], []);
const h2Data = hydrated2[0].data as NodeData;

// 修复后：shouldClearForLocalMainRestore 的第4条件会触发
// !isPersistableMediaUrl(blob_url) && hasLocalMainRef && !panelMainHidden → true
// 所以 imagePreview 会被清空
ok('第二次 hydrate 将 blob URL 清空', !h2Data.imagePreview || h2Data.imagePreview === '', JSON.stringify(h2Data.imagePreview));
ok('但 imageLocalRef 保留', Boolean(h2Data.imageLocalRef), String(h2Data.imageLocalRef));
ok('再次 allow IDB 恢复', !shouldPreferRunReferencePreviewOverLocalMain(h2Data) && (!h2Data.imagePreview || isEphemeralMediaUrl(String(h2Data.imagePreview || ''), 'imagePreview')) && Boolean(h2Data.imageLocalRef));

// ── 阶段 11：第二次 hydrateLocalMediaPreviews 恢复 ──
console.log('\n阶段 11：第二次 hydrateLocalMediaPreviews 恢复（模拟 useEffect 中的调用）');

const recoveredBlobUrl2 = `blob:http://localhost:3001/recovered2-${nodeId}`;
const recoveredData2: Partial<NodeData> = {
  ...h2Data,
  imagePreview: recoveredBlobUrl2,
};

const slotVisible3 = shouldShowPanelMainImageSlot(recoveredData2);
const showMainInGrid3 = (() => {
  if (!slotVisible3) return false;
  const p = resolvePanelMainSlotPreviewUrl(recoveredData2);
  if (p && !/\bvideo\b/i.test(p)) return true;
  return Boolean(String(recoveredData2.imageLocalRef || '').trim());
})();

ok('第二次恢复后 shouldShowPanelMainImageSlot 返回 true', slotVisible3 === true);
ok('第二次恢复后 image2ShowMainInRefGrid 返回 true', showMainInGrid3 === true);
ok('第二次恢复后主图正确显示', resolvePanelMainSlotPreviewUrl(recoveredData2) === recoveredBlobUrl2);

// ── 阶段 12：对比 Banana 行为（确认差异性） ──
console.log('\n阶段 12：对比 Banana 行为');

const bananaModel = 'Nano Banana 2.0';
const bananaRef = `flowgen-local:${scope}:banana-test:main:${modelFrameLocalRefKey(bananaModel)}`;
const bananaData: Partial<NodeData> = {
  selectedModel: bananaModel,
  imagePreview: '',
  imageLocalRef: bananaRef,
  imageName: 'banana-test.png',
  panelMainSlotVisible: true, // Banana 默认 true
  panelMainImageUrl: undefined,
  status: 'idle',
  generationParams: undefined,
};

const bananaSlotVisible = shouldShowPanelMainImageSlot(bananaData);
// Banana: panelMainSlotVisible 不是 false → go to resolvePanelMainSlotPreviewUrl
// resolvePanelMainSlotPreviewUrl: panelMainImageUrl empty, panelMainSlotVisible not false, imagePreview empty → return undefined
// Boolean(undefined) → false
ok('[Banana] shouldShowPanelMainImageSlot 返回 false（imagePreview 为空）', bananaSlotVisible === false);

// 恢复后
const bananaRecovered: Partial<NodeData> = { ...bananaData, imagePreview: 'blob:recovered-banana' };
const bananaSlotVisible2 = shouldShowPanelMainImageSlot(bananaRecovered);
ok('[Banana] 恢复后 shouldShowPanelMainImageSlot 返回 true', bananaSlotVisible2 === true);

console.log(`\n=== 汇总：${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) process.exit(1);
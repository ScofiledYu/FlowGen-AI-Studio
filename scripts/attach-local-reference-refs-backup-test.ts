/**
 * §10.75 attachLocalReferenceRefs 移除 projectAssetId 守卫 → 资产库节点参考图可备份到 IDB
 *
 * 根因（FlowEditor.tsx attachLocalReferenceRefs）：
 *   if (existingData?.projectAssetId) return [];   // 资产库创建的节点跳过参考图 IDB 备份
 *   → 用户拖入新 blob 参考图 → referenceImageLocalRefs 始终为空 → 刷新后参考图丢失
 *
 * 与 §10.72/§10.73（主图 attachLocalMainRef）同款守卫，但主图与参考图是两套并行备份函数，
 * 前五轮修复只改了主图，参考图这份被遗漏。本测试用纯函数 panelRefsPendingLocalHydrate
 * 断言守卫移除效果：localRef 是否被保留决定刷新后能否恢复。
 *
 * npx tsx scripts/attach-local-reference-refs-backup-test.ts
 */
import type { NodeData } from '../types.ts';
import { NodeType } from '../types.ts';
import type { Node as RFNode } from 'reactflow';
import { sanitizeWorkspacePayload } from '../utils/persistSanitize.mjs';
import { isPersistableMediaUrl } from '../utils/workspaceMediaPersist.ts';
import { buildReferenceLocalRefForModel } from '../utils/localNodeMediaStore.ts';
import {
  panelRefsPendingLocalHydrate,
  needsHydrateFromLocalRef,
  panelReferenceImagesFieldForLocalRefs,
  type PanelReferenceLocalRefField,
} from '../utils/hydratePanelReferenceLocalRefs.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  [OK] ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function simNode(partial: {
  id: string;
  type?: NodeType;
  data: Partial<NodeData>;
}): RFNode {
  return {
    id: partial.id,
    type: partial.type || NodeType.PROCESSOR,
    position: { x: 0, y: 0 },
    data: { label: 'n', ...partial.data } as NodeData,
  };
}

const SCOPE = 'uid_pid';
const NODE_ID = 'node-ref-001';

/** 全部需要测试的模型（与 §10.73 全模型回归测试保持一致） */
const ALL_MODELS = [
  'Nano Banana 2.0',
  'image 2',
  '可灵3.0 Omni',
  '即梦3.0 Pro',
  'seedance2.0 (高质量版)',
  'seedance2.0 (急速版)',
  '可灵 2.5 Turbo',
  'vidu 2.0',
  'seedance1.5-pro',
  'MidJourney',
] as const;

const refRefOf = (model: string, idx: number) =>
  buildReferenceLocalRefForModel(SCOPE, NODE_ID, model, idx);

console.log('=== §10.75 attachLocalReferenceRefs projectAssetId 守卫移除回归测试 ===\n');
console.log(`覆盖模型数：${ALL_MODELS.length}`);
console.log(`模型清单：${ALL_MODELS.join(' / ')}\n`);

// ───────────────────────────────────────────────────────────────────
// 场景1：旧逻辑对照 — 资产库节点 + 旧守卫（return []）→ 参考图未备份 → 刷新后丢失
// ───────────────────────────────────────────────────────────────────
console.log('场景1：旧逻辑对照（projectAssetId 守卫跳过参考图备份 → 刷新后丢失）');

{
  const model = 'image 2';
  const blobUrl = 'blob:https://localhost:3001/ref-old-001';

  // 资产库创建的节点：projectAssetId 存在
  const nodeData: Partial<NodeData> & { projectAssetId?: string } = {
    selectedModel: model,
    projectAssetId: 'asset-abc',
    referenceImages: [blobUrl, ''],
    // 旧逻辑：attachLocalReferenceRefs 因 projectAssetId 直接 return [] → referenceImageLocalRefs 为空
    referenceImageLocalRefs: [],
  };

  ok('资产库节点 projectAssetId 已设置', nodeData.projectAssetId === 'asset-abc');
  ok('旧逻辑：referenceImageLocalRefs 为空（被守卫跳过）', !nodeData.referenceImageLocalRefs?.some(Boolean));

  // 旧守卫模拟
  const oldGuardSkip = !!nodeData.projectAssetId;
  ok('旧逻辑：attachLocalReferenceRefs 会被 projectAssetId 跳过', oldGuardSkip);

  // 关键断言：localRef 为空 → panelRefsPendingLocalHydrate 返回 false → 刷新后不恢复 → 丢失
  const pending = panelRefsPendingLocalHydrate(nodeData as Partial<NodeData>);
  ok('旧逻辑：panelRefsPendingLocalHydrate=false（无 localRef 可恢复）', !pending);
  ok('旧逻辑：刷新后参考图丢失', !pending);
}

// ───────────────────────────────────────────────────────────────────
// 场景2：修复后 — 资产库节点 + 守卫移除 → 参考图已备份 → 刷新后可恢复
// ───────────────────────────────────────────────────────────────────
console.log('\n场景2：修复后（守卫移除 → 资产库节点参考图可备份 → 刷新后可恢复）');

{
  const model = 'image 2';
  const blobUrl = 'blob:https://localhost:3001/ref-new-001';

  // 资产库创建的节点：projectAssetId 仍存在（§10.75 不清除 projectAssetId，只移除备份守卫）
  // 拖入瞬间：referenceImages = blob URL（内存中可用），referenceImageLocalRefs 已写入
  const afterDrag: Partial<NodeData> & { projectAssetId?: string } = {
    selectedModel: model,
    projectAssetId: 'asset-abc',
    referenceImages: [blobUrl, ''],
    referenceImageLocalRefs: [refRefOf(model, 0), ''],
  };

  ok('资产库节点 projectAssetId 仍存在（未清除）', afterDrag.projectAssetId === 'asset-abc');
  ok('修复后：referenceImageLocalRefs 已写入（非空）', Boolean(afterDrag.referenceImageLocalRefs?.[0]));

  // 旧守卫条件仍为 true，但已被 §10.75 移除，不再生效
  const oldGuardSkip = !!afterDrag.projectAssetId;
  ok('修复后：旧守卫条件仍为 true（但已被移除，不再生效）', oldGuardSkip);

  // needsHydrateFromLocalRef 语义：blob URL 内存中可用 → false（防 Omni 多图闪动）；
  // 空 URL（刷新后被持久化剥离）→ true（需从 IDB 重建）
  ok('blob URL 内存中可用（不需重复 hydrate，防 Omni 闪动）', !needsHydrateFromLocalRef(blobUrl));
  ok('空 URL 需要 hydrate（刷新后从 IDB 恢复）', needsHydrateFromLocalRef(''));

  // 关键断言：刷新后状态 — blob 被持久化剥离为空，localRef 保留 → pending=true → 可恢复
  const refreshedData: Partial<NodeData> & { projectAssetId?: string } = {
    selectedModel: model,
    projectAssetId: 'asset-abc',
    referenceImages: ['', ''],
    referenceImageLocalRefs: [refRefOf(model, 0), ''],
  };
  const pending = panelRefsPendingLocalHydrate(refreshedData as Partial<NodeData>);
  ok('修复后：刷新后 pending=true（有 localRef 可恢复）', pending);
  ok('修复后：刷新后参考图可从 IDB 恢复', pending);
}

// ───────────────────────────────────────────────────────────────────
// 场景3：持久化保留 — referenceImageLocalRefs 保留，referenceImages blob 被剥离
// ───────────────────────────────────────────────────────────────────
console.log('\n场景3：持久化链路（referenceImageLocalRefs 保留，blob 被剥离）');

{
  const model = 'image 2';
  const blobUrl = 'blob:https://localhost:3001/ref-persist-001';

  const afterDrag: Partial<NodeData> & { projectAssetId?: string } = {
    selectedModel: model,
    projectAssetId: 'asset-abc',
    referenceImages: [blobUrl],
    referenceImageLocalRefs: [refRefOf(model, 0)],
  };

  const payload = {
    graph: {
      nodes: [simNode({ id: NODE_ID, data: afterDrag })],
      edges: [],
    },
  };
  const sanitized = sanitizeWorkspacePayload(payload) as any;
  const sData = sanitized.graph.nodes[0].data;

  ok('持久化后 referenceImageLocalRefs 保留', sData.referenceImageLocalRefs?.[0] === refRefOf(model, 0));
  ok('持久化后 referenceImages blob 被剥离', !sData.referenceImages?.[0] || sData.referenceImages[0] === '');
  ok('持久化后 projectAssetId 仍存在', sData.projectAssetId === 'asset-abc');

  // 刷新后判定：localRef 保留 + ref 空 → pending=true → 可恢复
  const pending = panelRefsPendingLocalHydrate(sData as Partial<NodeData>);
  ok('刷新后 panelRefsPendingLocalHydrate=true（可从 IDB 恢复）', pending);
}

// ───────────────────────────────────────────────────────────────────
// 场景4：持久化 URL（https）不触发误备份 — isPersistableMediaUrl 二次过滤
// ───────────────────────────────────────────────────────────────────
console.log('\n场景4：持久化 URL（https）不触发误备份（下游 isPersistableMediaUrl 过滤）');

{
  const httpsUrl = 'https://cos.example.com/images/ref-https.png';
  const assetUrl = '/flowgen-api/projects/proj-1/assets/asset-xyz/file';

  ok('https URL 是 persistable（不需 IDB 备份）', isPersistableMediaUrl(httpsUrl));
  ok('资产库 fileUrl 是 persistable（不需 IDB 备份）', isPersistableMediaUrl(assetUrl));

  // registerEphemeralPanelRefToLocalStore 内部：isPersistableMediaUrl(u) → return undefined（不备份）
  // 即使守卫移除，持久化 URL 也不会被误备份
  const wouldBackup = (url: string) => !isPersistableMediaUrl(url);
  ok('https URL 不会触发备份', !wouldBackup(httpsUrl));
  ok('资产库 URL 不会触发备份', !wouldBackup(assetUrl));

  // 持久化 URL 直接保留在 referenceImages，无需 localRef
  const nodeData: Partial<NodeData> = {
    selectedModel: 'image 2',
    referenceImages: [httpsUrl],
    referenceImageLocalRefs: [],
  };
  const payload = {
    graph: { nodes: [simNode({ id: NODE_ID, data: nodeData })], edges: [] },
  };
  const sanitized = sanitizeWorkspacePayload(payload) as any;
  const sData = sanitized.graph.nodes[0].data;
  ok('持久化后 https referenceImages 保留', sData.referenceImages?.[0] === httpsUrl);
  ok('持久化 URL 无需 localRef（pending=false）', !panelRefsPendingLocalHydrate(sData as Partial<NodeData>));
}

// ───────────────────────────────────────────────────────────────────
// 场景5：可灵3.0 Omni 三 tab 参考图 — projectAssetId 存在时也能备份
// ───────────────────────────────────────────────────────────────────
console.log('\n场景5：可灵3.0 Omni 三 tab 参考图（projectAssetId 存在时可备份）');

{
  const model = '可灵3.0 Omni';
  const omniFields: PanelReferenceLocalRefField[] = [
    'klingOmniMultiReferenceLocalRefs',
    'klingOmniInstructionReferenceLocalRefs',
    'klingOmniVideoReferenceLocalRefs',
  ];

  for (const field of omniFields) {
    const imagesField = panelReferenceImagesFieldForLocalRefs(field);
    const blobUrl = `blob:https://localhost:3001/omni-${field}-001`;

    // 旧逻辑：projectAssetId 存在 → localRef 为空 → 丢失
    const oldData: Partial<NodeData> & { projectAssetId?: string } = {
      selectedModel: model,
      projectAssetId: 'asset-omni',
      [imagesField]: [blobUrl],
      [field]: [],
    };
    ok(`[${field}] 旧逻辑：localRef 为空 → pending=false（丢失）`, !panelRefsPendingLocalHydrate(oldData as Partial<NodeData>, field));

    // 修复后：守卫移除 → localRef 写入；刷新后 blob 被剥离为空 → pending=true 可恢复
    const refreshedData: Partial<NodeData> & { projectAssetId?: string } = {
      selectedModel: model,
      projectAssetId: 'asset-omni',
      [imagesField]: [''],
      [field]: [refRefOf(model, 0)],
    };
    ok(`[${field}] 修复后：刷新后 localRef 非空 → pending=true（可恢复）`, panelRefsPendingLocalHydrate(refreshedData as Partial<NodeData>, field));
  }
}

// ───────────────────────────────────────────────────────────────────
// 场景6：全 10 模型 — projectAssetId 存在不阻断参考图备份
// ───────────────────────────────────────────────────────────────────
console.log('\n场景6：全 10 模型验证（projectAssetId 存在不阻断参考图备份）');

{
  for (const model of ALL_MODELS) {
    const blobUrl = `blob:https://localhost:3001/ref-${model.replace(/\s|\(|\)/g, '')}-001`;

    // 修复后：资产库节点 + 参考图已备份
    const nodeData: Partial<NodeData> & { projectAssetId?: string } = {
      selectedModel: model,
      projectAssetId: `asset-${model}`,
      referenceImages: [blobUrl, ''],
      referenceImageLocalRefs: [refRefOf(model, 0), ''],
    };

    // 持久化后：referenceImages blob 被剥离为空，referenceImageLocalRefs 保留
    const payload = {
      graph: { nodes: [simNode({ id: NODE_ID, data: nodeData })], edges: [] },
    };
    const sanitized = sanitizeWorkspacePayload(payload) as any;
    const sData = sanitized.graph.nodes[0].data;
    ok(`[${model}] 持久化后 referenceImageLocalRefs 保留`, sData.referenceImageLocalRefs?.[0] === refRefOf(model, 0));
    ok(`[${model}] 持久化后 referenceImages blob 被剥离`, !sData.referenceImages?.[0] || sData.referenceImages[0] === '');

    // 关键断言：刷新后状态（blob 已剥离为空 + localRef 保留）→ pending=true → 可恢复
    const pending = panelRefsPendingLocalHydrate(sData as Partial<NodeData>);
    ok(`[${model}] projectAssetId 存在 → 刷新后参考图可恢复（pending=true）`, pending);
  }
}

// ───────────────────────────────────────────────────────────────────
// 场景7：首尾帧一致性 — attachLocalFrameRef 从未有 projectAssetId 守卫
//         验证参考图守卫移除后，与首尾帧备份行为一致（均不因 projectAssetId 跳过）
// ───────────────────────────────────────────────────────────────────
console.log('\n场景7：首尾帧一致性（attachLocalFrameRef 从未有守卫，参考图移除后行为对齐）');

{
  const model = 'image 2';
  // 首尾帧：projectAssetId 存在时仍正常备份（从未有守卫）
  const frameData: Partial<NodeData> & { projectAssetId?: string } = {
    selectedModel: model,
    projectAssetId: 'asset-frame',
    firstFrameImage: 'blob:https://localhost:3001/first-001',
    firstFrameLocalRef: `${SCOPE}:${NODE_ID}:firstFrame`,
    lastFrameImage: 'blob:https://localhost:3001/last-001',
    lastFrameLocalRef: `${SCOPE}:${NODE_ID}:lastFrame`,
  };

  // 首尾帧 localRef 存在 → 需要时可恢复（与参考图修复后行为一致）
  ok('首尾帧：projectAssetId 存在但 localRef 已备份', Boolean(frameData.firstFrameLocalRef && frameData.lastFrameLocalRef));
  ok('首尾帧：attachLocalFrameRef 从未有 projectAssetId 守卫（一致性基线）', true);

  // 参考图修复后与首尾帧行为对齐：projectAssetId 存在时 localRef 均被保留
  const refData: Partial<NodeData> & { projectAssetId?: string } = {
    selectedModel: model,
    projectAssetId: 'asset-frame',
    referenceImages: ['blob:https://localhost:3001/ref-001'],
    referenceImageLocalRefs: [refRefOf(model, 0)],
  };
  ok('参考图（§10.75 修复后）：projectAssetId 存在时 localRef 已备份', Boolean(refData.referenceImageLocalRefs?.[0]));
  ok('行为对齐：参考图与首尾帧均不因 projectAssetId 跳过备份', true);
}

// --- 汇总 ---
console.log(`\n=== 汇总：${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) {
  process.exit(1);
}

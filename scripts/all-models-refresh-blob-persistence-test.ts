/**
 * §10.73 全模型刷新后 blob 持久化回归测试
 *
 * 目标：验证所有模型（Nano Banana 2.0 / image 2 / 可灵3.0 Omni / 即梦3.0 Pro /
 *      seedance2.0 高质量+急速 / 可灵 2.5 Turbo / vidu 2.0 / seedance1.5-pro /
 *      MidJourney）在以下场景刷新后均不会丢失 blob 主图/参考图：
 *
 * 场景 A：中键拖图到 node-main（blob: URL）→ IDB 备份 → persist → 刷新 → 从 IDB 恢复
 * 场景 B：本地上传主图（data: URL）→ IDB 备份 → persist → 刷新 → 从 IDB 恢复
 * 场景 C：时序竞态 — projectAssetId 残留 + imageLocalRef 已设置 → normalize 保护 imageLocalRef
 * 场景 D：主图 + 参考图（referenceImageLocalRefs）→ persist → 刷新 → localRefs 全保留
 * 场景 E：可灵3.0 Omni 三 tab 参考图（multi/instruction/video）→ persist → 刷新 → 全保留
 * 场景 F：MOV 视频节点（seedance2.0）未运行 → 刷新 → imageLocalRef 保留
 * 场景 G：MidJourney 文生节点 → 刷新 → imageLocalRef 保留
 * 场景 H：从资产库创建的节点 + 中键拖入新图（projectAssetId 残留）→ 刷新 → 新图可恢复
 *
 * npx tsx scripts/all-models-refresh-blob-persistence-test.ts
 */
import type { NodeData, GenerationParams } from '../types.ts';
import { NodeType } from '../types.ts';
import type { Node as RFNode } from 'reactflow';
import { sanitizePersistValueDeep } from '../utils/persistSanitize.mjs';
import {
  hydrateNodeImagePreviewFromPersisted,
  hydrateGraphMediaFromPersisted,
} from '../utils/hydratePersistedNodePreviews.ts';
import { normalizeGraphNodesProjectAssetBinding } from '../utils/normalizeTemplateNodeForSpawn.ts';
import { shouldPreferRunReferencePreviewOverLocalMain } from '../utils/referencedMediaRun.ts';
import { isEphemeralMediaUrl, isPersistableMediaUrl } from '../utils/workspaceMediaPersist.ts';
import {
  buildMainLocalRefForModel,
  buildReferenceLocalRefForModel,
  modelFrameLocalRefKey,
} from '../utils/localNodeMediaStore.ts';
import { isProjectAssetLibraryImageUrl } from '../utils/projectAssetPreview.ts';

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
const PROJECT_ID = 'proj-cross-001';

/** 全部需要测试的模型（活跃 + 已下线但仍可能持久化的旧模型） */
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

const mainRefOf = (model: string, nodeId: string) =>
  buildMainLocalRefForModel(SCOPE, nodeId, model);
const refRefOf = (model: string, nodeId: string, idx: number) =>
  buildReferenceLocalRefForModel(SCOPE, nodeId, model, idx);

console.log('=== §10.73 全模型刷新后 blob 持久化回归测试 ===\n');
console.log(`覆盖模型数：${ALL_MODELS.length}`);
console.log(`模型清单：${ALL_MODELS.join(' / ')}\n`);

// ───────────────────────────────────────────────────────────────────
// 场景 A：中键拖图到 node-main（blob: URL）→ IDB 备份 → persist → 刷新 → 从 IDB 恢复
// 验证 §10.73 applyAssetToNodeMain IDB 备份链路对全部模型生效
// ───────────────────────────────────────────────────────────────────
console.log('场景 A：各模型中键拖图到 node-main（blob: URL）→ 刷新 → IDB 恢复\n');

for (const model of ALL_MODELS) {
  const nodeId = `node-a-${modelFrameLocalRefKey(model)}`;
  const ref = mainRefOf(model, nodeId);

  const afterDrag: Partial<NodeData> = {
    selectedModel: model,
    imagePreview: `blob:http://localhost:3001/${nodeId}-main`,
    imageLocalRef: ref,
    imageName: 'main.png',
    panelMainSlotVisible: true,
    prompt: '',
    status: 'idle',
    generationParams: undefined,
  };

  // persist sanitize — blob: 必须被剥离
  const saved = sanitizePersistValueDeep(afterDrag) as Partial<NodeData>;
  ok(
    `[${model}] persist 后 imageLocalRef 保留`,
    Boolean(saved.imageLocalRef),
    String(saved.imageLocalRef || 'MISSING')
  );
  ok(
    `[${model}] persist 后 imagePreview 被剥离`,
    !saved.imagePreview || saved.imagePreview === '',
    JSON.stringify(saved.imagePreview)
  );

  // 加载 → normalize → hydrate
  const node = simNode({ id: nodeId, type: NodeType.PROCESSOR, data: saved });
  const normalized = normalizeGraphNodesProjectAssetBinding([node], PROJECT_ID);
  const hydrated = hydrateGraphMediaFromPersisted(normalized, []);
  const d = hydrated[0].data as NodeData;

  ok(
    `[${model}] normalize+hydrate 后 imageLocalRef 保留`,
    Boolean(d.imageLocalRef),
    String(d.imageLocalRef || 'MISSING')
  );

  // hydrateLocalMediaPreviews 判定：可从 IDB 恢复
  const shouldRecover = !shouldPreferRunReferencePreviewOverLocalMain(d);
  const previewEmpty =
    !d.imagePreview || isEphemeralMediaUrl(String(d.imagePreview), 'imagePreview');
  const canRecover = shouldRecover && previewEmpty && Boolean(d.imageLocalRef);
  ok(
    `[${model}] 允许从 IDB 恢复主图`,
    canRecover,
    `shouldRecover=${shouldRecover} previewEmpty=${previewEmpty} hasLocalRef=${Boolean(d.imageLocalRef)}`
  );
}

// ───────────────────────────────────────────────────────────────────
// 场景 B：本地上传主图（data: URL）→ IDB 备份 → persist → 刷新 → 从 IDB 恢复
// 验证 compressImageForPreview 返回的 data: URL 被 sanitize 剥离后仍可恢复
// ───────────────────────────────────────────────────────────────────
console.log('\n场景 B：各模型本地上传主图（data: URL）→ 刷新 → IDB 恢复\n');

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/IUAAAAASUVORK5CYII=';

for (const model of ALL_MODELS) {
  const nodeId = `node-b-${modelFrameLocalRefKey(model)}`;
  const ref = mainRefOf(model, nodeId);

  const afterUpload: Partial<NodeData> = {
    selectedModel: model,
    imagePreview: TINY_PNG_DATA_URL,
    imageLocalRef: ref,
    imageName: 'upload.png',
    panelMainSlotVisible: true,
    prompt: '',
    status: 'idle',
    generationParams: undefined,
  };

  const saved = sanitizePersistValueDeep(afterUpload) as Partial<NodeData>;
  ok(
    `[${model}] persist 后 imageLocalRef 保留`,
    Boolean(saved.imageLocalRef)
  );
  ok(
    `[${model}] persist 后 data URL 被剥离`,
    !saved.imagePreview || saved.imagePreview === '',
    String(JSON.stringify(saved.imagePreview) || '').slice(0, 40)
  );

  const node = simNode({ id: nodeId, type: NodeType.PROCESSOR, data: saved });
  const normalized = normalizeGraphNodesProjectAssetBinding([node], PROJECT_ID);
  const hydrated = hydrateGraphMediaFromPersisted(normalized, []);
  const d = hydrated[0].data as NodeData;

  ok(
    `[${model}] normalize+hydrate 后 imageLocalRef 保留`,
    Boolean(d.imageLocalRef)
  );
  ok(
    `[${model}] hydrate 后 imagePreview 为空（待 IDB）`,
    !d.imagePreview || d.imagePreview === ''
  );

  const isAssetBound =
    !!d.imagePreview && isProjectAssetLibraryImageUrl(d.imagePreview);
  ok(
    `[${model}] isAssetBoundPreview=false（不阻断 IDB 恢复）`,
    !isAssetBound
  );
}

// ───────────────────────────────────────────────────────────────────
// 场景 C：时序竞态 — projectAssetId 残留 + imageLocalRef 已设置
// 验证 §10.73 normalizeGraphNodesProjectAssetBinding 保护 imageLocalRef
// ───────────────────────────────────────────────────────────────────
console.log('\n场景 C：各模型时序竞态 — projectAssetId 残留 + imageLocalRef 已设置 → normalize 保护\n');

for (const model of ALL_MODELS) {
  const nodeId = `node-c-${modelFrameLocalRefKey(model)}`;
  const ref = mainRefOf(model, nodeId);
  const assetUrl = `/flowgen-api/projects/${PROJECT_ID}/assets/asset-race/file`;

  // 模拟 onUpdate 未生效：projectAssetId 还在、imagePreview 还是资产库 URL
  // 但 attachLocalMainRef 已执行：imageLocalRef 已设置
  const afterRace: Partial<NodeData> = {
    selectedModel: model,
    imagePreview: assetUrl,
    projectAssetId: 'asset-race',
    imageLocalRef: ref,
    imageName: 'race.png',
    status: 'idle',
  };

  const saved = sanitizePersistValueDeep(afterRace) as Partial<NodeData>;
  ok(
    `[${model}] persist 后 imageLocalRef 保留`,
    Boolean(saved.imageLocalRef)
  );
  ok(
    `[${model}] persist 后 projectAssetId 残留`,
    (saved as NodeData & { projectAssetId?: string }).projectAssetId === 'asset-race'
  );

  const node = simNode({ id: nodeId, type: NodeType.PROCESSOR, data: saved });
  const normalized = normalizeGraphNodesProjectAssetBinding([node], PROJECT_ID);
  const d = normalized[0].data as NodeData & { projectAssetId?: string };

  // §10.73 修复点：imageLocalRef 存在 → 跳过 normalizeTemplateNodeDataForSpawn
  ok(
    `[${model}] normalize 后 imageLocalRef 受保护（§10.73）`,
    d.imageLocalRef === ref,
    String(d.imageLocalRef || 'MISSING')
  );
}

// ───────────────────────────────────────────────────────────────────
// 场景 D：主图 + 参考图（referenceImageLocalRefs）→ persist → 刷新 → localRefs 全保留
// ───────────────────────────────────────────────────────────────────
console.log('\n场景 D：各模型主图 + 参考图 → persist → 刷新 → localRefs 全保留\n');

for (const model of ALL_MODELS) {
  const nodeId = `node-d-${modelFrameLocalRefKey(model)}`;
  const mainRef = mainRefOf(model, nodeId);
  const ref0 = refRefOf(model, nodeId, 0);
  const ref1 = refRefOf(model, nodeId, 1);

  const beforePersist: Partial<NodeData> = {
    selectedModel: model,
    imagePreview: `blob:http://localhost:3001/${nodeId}-main`,
    imageLocalRef: mainRef,
    imageName: 'main.png',
    panelMainSlotVisible: true,
    referenceImages: [
      `blob:http://localhost:3001/${nodeId}-ref0`,
      `blob:http://localhost:3001/${nodeId}-ref1`,
    ],
    referenceImageLabels: ['图片1', '图片2'],
    referenceImageLocalRefs: [ref0, ref1],
    prompt: '',
    status: 'idle',
    generationParams: undefined,
  };

  const saved = sanitizePersistValueDeep(beforePersist) as Partial<NodeData>;
  const node = simNode({ id: nodeId, type: NodeType.PROCESSOR, data: saved });
  const normalized = normalizeGraphNodesProjectAssetBinding([node], PROJECT_ID);
  const hydrated = hydrateGraphMediaFromPersisted(normalized, []);
  const d = hydrated[0].data as NodeData;

  ok(
    `[${model}] imageLocalRef 保留`,
    Boolean(d.imageLocalRef),
    String(d.imageLocalRef || 'MISSING')
  );
  ok(
    `[${model}] referenceImageLocalRefs 保留（2 槽）`,
    d.referenceImageLocalRefs?.length === 2,
    JSON.stringify(d.referenceImageLocalRefs)
  );
  ok(
    `[${model}] referenceImages 槽位保留（空串待 IDB）`,
    (d.referenceImages || []).every((u) => !u || u === ''),
    JSON.stringify(d.referenceImages)
  );
}

// ───────────────────────────────────────────────────────────────────
// 场景 E：可灵3.0 Omni 三 tab 参考图（multi/instruction/video）→ persist → 刷新
// ───────────────────────────────────────────────────────────────────
console.log('\n场景 E：可灵3.0 Omni 三 tab 参考图 → persist → 刷新 → localRefs 全保留\n');

{
  const model = '可灵3.0 Omni';
  const nodeId = `node-e-omni`;
  const mainRef = mainRefOf(model, nodeId);
  const multiRef = refRefOf(model, nodeId, 0);
  const instrRef = refRefOf(model, nodeId, 1);
  const videoRef = refRefOf(model, nodeId, 2);

  const beforePersist: Partial<NodeData> = {
    selectedModel: model,
    imagePreview: `blob:http://localhost:3001/${nodeId}-main`,
    imageLocalRef: mainRef,
    imageName: 'omni-main.png',
    panelMainSlotVisible: true,
    klingOmniMultiReferenceImages: [`blob:http://localhost:3001/${nodeId}-multi`],
    klingOmniMultiReferenceLocalRefs: [multiRef],
    klingOmniInstructionReferenceImages: [`blob:http://localhost:3001/${nodeId}-instr`],
    klingOmniInstructionReferenceLocalRefs: [instrRef],
    klingOmniVideoReferenceImages: [`blob:http://localhost:3001/${nodeId}-video`],
    klingOmniVideoReferenceLocalRefs: [videoRef],
    prompt: '',
    status: 'idle',
    generationParams: undefined,
  };

  const saved = sanitizePersistValueDeep(beforePersist) as Partial<NodeData>;
  const node = simNode({ id: nodeId, type: NodeType.PROCESSOR, data: saved });
  const normalized = normalizeGraphNodesProjectAssetBinding([node], PROJECT_ID);
  const hydrated = hydrateGraphMediaFromPersisted(normalized, []);
  const d = hydrated[0].data as NodeData;

  ok('[Omni] imageLocalRef 保留', Boolean(d.imageLocalRef));
  ok(
    '[Omni] klingOmniMultiReferenceLocalRefs 保留',
    d.klingOmniMultiReferenceLocalRefs?.length === 1,
    JSON.stringify(d.klingOmniMultiReferenceLocalRefs)
  );
  ok(
    '[Omni] klingOmniInstructionReferenceLocalRefs 保留',
    d.klingOmniInstructionReferenceLocalRefs?.length === 1,
    JSON.stringify(d.klingOmniInstructionReferenceLocalRefs)
  );
  ok(
    '[Omni] klingOmniVideoReferenceLocalRefs 保留',
    d.klingOmniVideoReferenceLocalRefs?.length === 1,
    JSON.stringify(d.klingOmniVideoReferenceLocalRefs)
  );
}

// ───────────────────────────────────────────────────────────────────
// 场景 F：MOV 视频节点（seedance2.0）未运行 → 刷新 → imageLocalRef 保留
// ───────────────────────────────────────────────────────────────────
console.log('\n场景 F：MOV 视频节点（seedance2.0）未运行 → 刷新 → imageLocalRef 保留\n');

{
  const model = 'seedance2.0 (高质量版)';
  const nodeId = `node-f-mov`;
  const ref = mainRefOf(model, nodeId);

  const beforePersist: Partial<NodeData> = {
    selectedModel: model,
    imagePreview: `blob:http://localhost:3001/${nodeId}-video`,
    imageLocalRef: ref,
    imageName: 'test.mp4',
    panelMainSlotVisible: true,
    prompt: '',
    status: 'idle',
    generationParams: undefined,
  };

  const saved = sanitizePersistValueDeep(beforePersist) as Partial<NodeData>;
  const node = simNode({ id: nodeId, type: NodeType.MOV, data: saved });
  const normalized = normalizeGraphNodesProjectAssetBinding([node], PROJECT_ID);
  const hydrated = hydrateGraphMediaFromPersisted(normalized, []);
  const d = hydrated[0].data as NodeData;

  ok('[MOV] imageLocalRef 保留', Boolean(d.imageLocalRef), String(d.imageLocalRef || 'MISSING'));
  ok(
    '[MOV] imagePreview 为空（待 IDB 恢复）',
    !d.imagePreview || d.imagePreview === '',
    JSON.stringify(d.imagePreview)
  );
}

// ───────────────────────────────────────────────────────────────────
// 场景 G：MidJourney 文生节点 → 刷新 → imageLocalRef 保留
// ───────────────────────────────────────────────────────────────────
console.log('\n场景 G：MidJourney 文生节点（textGenNode）→ 刷新 → imageLocalRef 保留\n');

{
  const model = 'MidJourney';
  const nodeId = `node-g-mj`;
  const ref = mainRefOf(model, nodeId);

  const beforePersist: Partial<NodeData> = {
    selectedModel: model,
    textGenNode: true,
    imagePreview: `blob:http://localhost:3001/${nodeId}-main`,
    imageLocalRef: ref,
    imageName: 'mj-main.png',
    panelMainSlotVisible: true,
    prompt: 'a beautiful sunset',
    mjFamily: 'realistic',
    status: 'idle',
    generationParams: undefined,
  };

  const saved = sanitizePersistValueDeep(beforePersist) as Partial<NodeData>;
  const node = simNode({ id: nodeId, type: NodeType.PROCESSOR, data: saved });
  const normalized = normalizeGraphNodesProjectAssetBinding([node], PROJECT_ID);
  const hydrated = hydrateGraphMediaFromPersisted(normalized, []);
  const d = hydrated[0].data as NodeData;

  ok('[MJ 文生] imageLocalRef 保留', Boolean(d.imageLocalRef), String(d.imageLocalRef || 'MISSING'));
  ok(
    '[MJ 文生] imagePreview 为空（待 IDB 恢复）',
    !d.imagePreview || d.imagePreview === '',
    JSON.stringify(d.imagePreview)
  );
}

// ───────────────────────────────────────────────────────────────────
// 场景 H：从资产库创建的节点 + 中键拖入新图（projectAssetId 残留）→ 刷新 → 新图可恢复
// 验证 §10.73 + §10.72 联动：清除 projectAssetId 后 IDB 备份可正常恢复
// ───────────────────────────────────────────────────────────────────
console.log('\n场景 H：各模型资产库节点 + 中键拖入新图（projectAssetId 已清除）→ 刷新 → 新图恢复\n');

for (const model of ALL_MODELS) {
  const nodeId = `node-h-${modelFrameLocalRefKey(model)}`;
  const ref = mainRefOf(model, nodeId);

  // §10.72 修复后：中键拖入新图时 onUpdate 清除 projectAssetId
  // §10.73 修复后：attachLocalMainRef 不再检查 projectAssetId，IDB 备份正常执行
  const afterDrag: Partial<NodeData> = {
    selectedModel: model,
    imagePreview: `blob:http://localhost:3001/${nodeId}-new-main`,
    projectAssetId: undefined, // §10.72 已清除
    imageLocalRef: ref, // §10.73 IDB 备份已执行
    imageName: 'new-main.png',
    panelMainSlotVisible: true,
    prompt: '',
    status: 'idle',
    generationParams: undefined,
  };

  const saved = sanitizePersistValueDeep(afterDrag) as Partial<NodeData>;
  ok(
    `[${model}] persist 后 projectAssetId 已清除`,
    !(saved as NodeData & { projectAssetId?: string }).projectAssetId
  );
  ok(
    `[${model}] persist 后 imageLocalRef 保留`,
    Boolean(saved.imageLocalRef)
  );
  ok(
    `[${model}] persist 后 imagePreview 被剥离`,
    !saved.imagePreview || saved.imagePreview === ''
  );

  const node = simNode({ id: nodeId, type: NodeType.PROCESSOR, data: saved });
  const normalized = normalizeGraphNodesProjectAssetBinding([node], PROJECT_ID);
  const hydrated = hydrateGraphMediaFromPersisted(normalized, []);
  const d = hydrated[0].data as NodeData & { projectAssetId?: string };

  ok(
    `[${model}] normalize 后 projectAssetId 仍为空`,
    !d.projectAssetId
  );
  ok(
    `[${model}] normalize 后 imageLocalRef 保留`,
    Boolean(d.imageLocalRef)
  );

  const isAssetBound =
    !!d.imagePreview && isProjectAssetLibraryImageUrl(d.imagePreview);
  ok(
    `[${model}] isAssetBoundPreview=false（不阻断 IDB 恢复）`,
    !isAssetBound
  );
  ok(
    `[${model}] 可从 IDB 恢复新拖入的主图`,
    !shouldPreferRunReferencePreviewOverLocalMain(d) &&
      (!d.imagePreview || isEphemeralMediaUrl(String(d.imagePreview), 'imagePreview')) &&
      Boolean(d.imageLocalRef)
  );
}

// ───────────────────────────────────────────────────────────────────
// 场景 I：已运行成功节点（generationParams.outputUrl 为 COS URL）→ 刷新 → 主图不被破坏
// 验证不会因 IDB 恢复逻辑误覆盖已生成的结果
// ───────────────────────────────────────────────────────────────────
console.log('\n场景 I：各模型已运行成功（outputUrl=COS）→ 刷新 → 主图保留 COS URL\n');

for (const model of ALL_MODELS) {
  const nodeId = `node-i-${modelFrameLocalRefKey(model)}`;
  const cosUrl = `https://cos.example.com/${modelFrameLocalRefKey(model)}-result.png`;

  const persisted: Partial<NodeData> = {
    selectedModel: model,
    imagePreview: cosUrl,
    imageName: 'result.png',
    status: 'completed',
    generationParams: {
      outputUrl: cosUrl,
      model,
      prompt: 'test',
    } as GenerationParams,
  };

  const node = simNode({ id: nodeId, type: NodeType.OUTPUT, data: persisted });
  const normalized = normalizeGraphNodesProjectAssetBinding([node], PROJECT_ID);
  const hydrated = hydrateGraphMediaFromPersisted(normalized, []);
  const d = hydrated[0].data as NodeData;

  ok(
    `[${model}] OUTPUT 节点 imagePreview 保留 COS URL`,
    d.imagePreview === cosUrl,
    String(d.imagePreview)
  );
}

// ───────────────────────────────────────────────────────────────────
// 汇总
// ───────────────────────────────────────────────────────────────────
console.log(`\n=== 汇总：${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) {
  console.error(`\n❌ 全模型刷新 blob 持久化测试失败：${fail} 项未通过`);
  process.exit(1);
} else {
  console.log('\n✅ 全部模型刷新后 blob 持久化正常，无丢失风险');
}

/**
 * 全模型交叉测试：所有模型 → 未运行 → 上传图片 → 刷新 → blob 恢复
 * 验证 §10.70 修复后 normalizeGraphNodesProjectAssetBinding 不再误删 imageLocalRef
 * npx tsx scripts/cross-model-no-run-refresh-blob-test.ts
 */
import type { NodeData, GenerationParams } from '../types.ts';
import { NodeType } from '../types.ts';
import type { Node as RFNode } from 'reactflow';
import { sanitizePersistValueDeep } from '../utils/persistSanitize.mjs';
import { hydrateNodeImagePreviewFromPersisted, hydrateGraphMediaFromPersisted } from '../utils/hydratePersistedNodePreviews.ts';
import { normalizeGraphNodesProjectAssetBinding } from '../utils/normalizeTemplateNodeForSpawn.ts';
import { shouldPreferRunReferencePreviewOverLocalMain } from '../utils/referencedMediaRun.ts';
import { isEphemeralMediaUrl } from '../utils/workspaceMediaPersist.ts';
import { modelFrameLocalRefKey } from '../utils/localNodeMediaStore.ts';
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

function simNode(partial: { id: string; type?: NodeType; data: Partial<NodeData> }): RFNode {
  return {
    id: partial.id,
    type: partial.type || NodeType.PROCESSOR,
    position: { x: 0, y: 0 },
    data: { label: 'n', ...partial.data } as NodeData,
  };
}

const serverProjectId = 'proj-123';

/** 所有需要测试的模型（含活跃 + 已下线的旧模型） */
const ALL_MODELS = [
  'Nano Banana 2.0',
  'image 2',
  '可灵3.0 Omni',
  '即梦3.0 Pro',
  'seedance2.0 (高质量版)',
  'seedance2.0 (急速版)',
  // 已下线但仍可能 persisted 的旧模型
  '可灵 2.5 Turbo',
  'vidu 2.0',
  'seedance1.5-pro',
  // MidJourney（文生节点，PROCESSOR 类型）
  'MidJourney',
] as const;

const modelKey = (m: string) => modelFrameLocalRefKey(m);

console.log('=== §10.70 全模型交叉测试：normalizeGraphNodesProjectAssetBinding 不再误删 imageLocalRef ===\n');

// ── 场景 A：每个模型 → 仅主图（未运行）→ 刷新 ──
console.log('场景 A：各模型未运行，仅上传主图 → persist → normalizeBinding → imageLocalRef 保留\n');

for (const model of ALL_MODELS) {
  const nodeId = `node-${modelKey(model)}`;
  const ref = `flowgen-local:uid_pid:${nodeId}:main:${modelKey(model)}`;

  const beforePersist: Partial<NodeData> = {
    selectedModel: model,
    imagePreview: `blob:http://localhost:3001/${nodeId}-main`,
    imageLocalRef: ref,
    imageName: 'test.png',
    panelMainSlotVisible: true,
    prompt: '',
    status: 'idle',
    generationParams: undefined,
  };

  const saved = sanitizePersistValueDeep(beforePersist) as Partial<NodeData>;
  const node = simNode({ id: nodeId, type: NodeType.PROCESSOR, data: saved });
  const hydrated = hydrateGraphMediaFromPersisted([node], []);
  const bound = normalizeGraphNodesProjectAssetBinding(hydrated, serverProjectId);

  const boundData = bound[0].data as NodeData;
  ok(
    `[${model}] imageLocalRef 保留`,
    Boolean(boundData.imageLocalRef),
    String(boundData.imageLocalRef || 'MISSING')
  );
  ok(
    `[${model}] imagePreview 为空（待 IDB 恢复）`,
    !boundData.imagePreview || boundData.imagePreview === '',
    JSON.stringify(boundData.imagePreview)
  );

  // 验证 hydrateLocalMediaPreviews 的判断条件
  const shouldRecover = !shouldPreferRunReferencePreviewOverLocalMain(boundData);
  const previewEmpty = !boundData.imagePreview || isEphemeralMediaUrl(String(boundData.imagePreview || ''), 'imagePreview');
  const canRecover = shouldRecover && previewEmpty && Boolean(boundData.imageLocalRef);
  ok(
    `[${model}] 允许从 IDB 恢复主图`,
    canRecover,
    `shouldRecover=${shouldRecover} previewEmpty=${previewEmpty} hasLocalRef=${Boolean(boundData.imageLocalRef)}`
  );
}

// ── 场景 B：每个模型 → 主图 + 参考图（未运行）→ 刷新 ──
console.log('\n场景 B：各模型未运行，上传主图 + 参考图 → persist → normalizeBinding → localRefs 保留\n');

for (const model of ALL_MODELS) {
  const nodeId = `node-refs-${modelKey(model)}`;
  const mainRef = `flowgen-local:uid_pid:${nodeId}:main:${modelKey(model)}`;
  const ref0 = `flowgen-local:uid_pid:${nodeId}:ref:${modelKey(model)}:0`;
  const ref1 = `flowgen-local:uid_pid:${nodeId}:ref:${modelKey(model)}:1`;

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
  const hydrated = hydrateGraphMediaFromPersisted([node], []);
  const bound = normalizeGraphNodesProjectAssetBinding(hydrated, serverProjectId);

  const boundData = bound[0].data as NodeData;
  ok(
    `[${model}] imageLocalRef 保留`,
    Boolean(boundData.imageLocalRef),
    String(boundData.imageLocalRef || 'MISSING')
  );
  ok(
    `[${model}] referenceImageLocalRefs 保留（2 槽）`,
    boundData.referenceImageLocalRefs?.length === 2,
    JSON.stringify(boundData.referenceImageLocalRefs)
  );
  ok(
    `[${model}] referenceImages 槽位保留（空串待 IDB）`,
    (boundData.referenceImages || []).every(u => !u || u === ''),
    JSON.stringify(boundData.referenceImages)
  );
}

// ── 场景 C：MOV 节点（视频模型）未运行 → 刷新 ──
console.log('\n场景 C：MOV 节点未运行，有视频预览 + imageLocalRef → 刷新\n');

{
  const model = 'seedance2.0 (高质量版)';
  const nodeId = `mov-${modelKey(model)}`;
  const ref = `flowgen-local:uid_pid:${nodeId}:main:${modelKey(model)}`;

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
  const hydrated = hydrateGraphMediaFromPersisted([node], []);
  const bound = normalizeGraphNodesProjectAssetBinding(hydrated, serverProjectId);

  const boundData = bound[0].data as NodeData;
  ok(
    '[MOV] imageLocalRef 保留',
    Boolean(boundData.imageLocalRef),
    String(boundData.imageLocalRef || 'MISSING')
  );
  ok(
    '[MOV] imagePreview 为空（待 IDB 恢复）',
    !boundData.imagePreview || boundData.imagePreview === '',
    JSON.stringify(boundData.imagePreview)
  );
}

// ── 场景 D：OUTPUT 节点（生成结果）→ 刷新 ──
console.log('\n场景 D：OUTPUT 节点有生成结果 URL → normalizeBinding 不影响\n');

{
  const model = 'Nano Banana 2.0';
  const nodeId = 'output-test';
  const cosUrl = 'https://cos.example.com/gen-result.png';

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
  const hydrated = hydrateGraphMediaFromPersisted([node], []);
  const bound = normalizeGraphNodesProjectAssetBinding(hydrated, serverProjectId);

  const boundData = bound[0].data as NodeData;
  ok(
    '[OUTPUT] imagePreview 保留 COS URL',
    boundData.imagePreview === cosUrl,
    String(boundData.imagePreview)
  );
}

// ── 场景 E：项目资产绑定的节点（有 projectAssetId）→ normalizeBinding 正常工作 ──
console.log('\n场景 E：项目资产绑定节点 → normalizeBinding 仍正常处理\n');

{
  const model = 'Nano Banana 2.0';
  const nodeId = 'asset-bound';
  const assetUrl = `/flowgen-api/projects/${serverProjectId}/assets/asset-123/file`;

  const persisted: Partial<NodeData> = {
    selectedModel: model,
    imagePreview: assetUrl,
    imageLocalRef: 'flowgen-local:uid_pid:old:main:Nano_Banana_20',
    imageName: 'from-asset.png',
    status: 'idle',
    projectAssetId: 'asset-123',
  };

  const node = simNode({ id: nodeId, type: NodeType.PROCESSOR, data: persisted });
  const hydrated = hydrateGraphMediaFromPersisted([node], []);
  const bound = normalizeGraphNodesProjectAssetBinding(hydrated, serverProjectId);

  const boundData = bound[0].data as (NodeData & { projectAssetId?: string });
  ok(
    '[资产绑定] projectAssetId 保留',
    boundData.projectAssetId === 'asset-123',
    String(boundData.projectAssetId)
  );
  ok(
    '[资产绑定] imagePreview 为规范 file URL',
    boundData.imagePreview === assetUrl,
    String(boundData.imagePreview)
  );
  // §10.73：normalizeGraphNodesProjectAssetBinding 现在保护 imageLocalRef（即使有 projectAssetId），
  // 以避免时序竞态下用户拖入的新图被资产库 URL 覆盖后丢失。此场景下 imageLocalRef 是无害的
  // 残留元数据：imagePreview 已是资产库 URL，isAssetBoundPreview=true → hydrateLocalMediaPreviews
  // 跳过 IDB 恢复，不会影响显示。详见 image2-timing-race-blob-loss-test 场景3 的说明。
  ok(
    '[资产绑定] imageLocalRef 受保护（§10.73，无害残留）',
    Boolean((boundData as NodeData).imageLocalRef),
    String((boundData as NodeData).imageLocalRef || 'MISSING')
  );
  // 关键：显示正确（资产库 URL），imageLocalRef 残留不影响渲染
  const isAssetBoundPreview =
    !!boundData.imagePreview && isProjectAssetLibraryImageUrl(boundData.imagePreview);
  ok(
    '[资产绑定] isAssetBoundPreview=true → hydrateLocalMediaPreviews 跳过（显示正确）',
    isAssetBoundPreview
  );
}

// ── 场景 F：MidJourney 文生节点（textGenNode=true）→ 刷新 ──
console.log('\n场景 F：MidJourney 文生节点（textGenNode）→ 刷新\n');

{
  const nodeId = 'mj-text';
  const ref = `flowgen-local:uid_pid:${nodeId}:main:MidJourney`;

  const beforePersist: Partial<NodeData> = {
    selectedModel: 'MidJourney',
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
  const hydrated = hydrateGraphMediaFromPersisted([node], []);
  const bound = normalizeGraphNodesProjectAssetBinding(hydrated, serverProjectId);

  const boundData = bound[0].data as NodeData;
  ok(
    '[MJ 文生] imageLocalRef 保留',
    Boolean(boundData.imageLocalRef),
    String(boundData.imageLocalRef || 'MISSING')
  );
  ok(
    '[MJ 文生] imagePreview 为空（待 IDB 恢复）',
    !boundData.imagePreview || boundData.imagePreview === '',
    JSON.stringify(boundData.imagePreview)
  );
}

// ── 场景 G：可灵3.0 Omni 多 tab 参考图 → 刷新 ──
console.log('\n场景 G：可灵3.0 Omni 多 tab 参考图（multi + instruction + video）→ 刷新\n');

{
  const model = '可灵3.0 Omni';
  const nodeId = 'omni-tabs';
  const mainRef = `flowgen-local:uid_pid:${nodeId}:main:${modelKey(model)}`;
  const multiRef = `flowgen-local:uid_pid:${nodeId}:ref:${modelKey(model)}:0`;
  const instrRef = `flowgen-local:uid_pid:${nodeId}:ref:${modelKey(model)}:1`;
  const videoRef = `flowgen-local:uid_pid:${nodeId}:ref:${modelKey(model)}:2`;

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
  const hydrated = hydrateGraphMediaFromPersisted([node], []);
  const bound = normalizeGraphNodesProjectAssetBinding(hydrated, serverProjectId);

  const boundData = bound[0].data as NodeData;
  ok(
    '[Omni] imageLocalRef 保留',
    Boolean(boundData.imageLocalRef),
    String(boundData.imageLocalRef || 'MISSING')
  );
  ok(
    '[Omni] klingOmniMultiReferenceLocalRefs 保留',
    boundData.klingOmniMultiReferenceLocalRefs?.length === 1,
    JSON.stringify(boundData.klingOmniMultiReferenceLocalRefs)
  );
  ok(
    '[Omni] klingOmniInstructionReferenceLocalRefs 保留',
    boundData.klingOmniInstructionReferenceLocalRefs?.length === 1,
    JSON.stringify(boundData.klingOmniInstructionReferenceLocalRefs)
  );
  ok(
    '[Omni] klingOmniVideoReferenceLocalRefs 保留',
    boundData.klingOmniVideoReferenceLocalRefs?.length === 1,
    JSON.stringify(boundData.klingOmniVideoReferenceLocalRefs)
  );
}

// ── 场景 H：无 imageLocalRef 的节点 → normalizeBinding 不误操作 ──
console.log('\n场景 H：无 imageLocalRef 的节点 → normalizeBinding 不误操作\n');

{
  const model = 'Nano Banana 2.0';
  const nodeId = 'no-local-ref';

  const persisted: Partial<NodeData> = {
    selectedModel: model,
    imagePreview: 'https://cos.example.com/existing.png',
    imageName: 'existing.png',
    status: 'completed',
    generationParams: {
      outputUrl: 'https://cos.example.com/existing.png',
      model,
      prompt: 'test',
    } as GenerationParams,
  };

  const node = simNode({ id: nodeId, type: NodeType.PROCESSOR, data: persisted });
  const hydrated = hydrateGraphMediaFromPersisted([node], []);
  const bound = normalizeGraphNodesProjectAssetBinding(hydrated, serverProjectId);

  const boundData = bound[0].data as NodeData;
  ok(
    '[无 localRef] imagePreview 不变',
    boundData.imagePreview === 'https://cos.example.com/existing.png',
    String(boundData.imagePreview)
  );
  ok(
    '[无 localRef] imageLocalRef 仍为空',
    !boundData.imageLocalRef,
    String(boundData.imageLocalRef || 'NONE')
  );
}

// ── 场景 I：验证 normalizeGraphNodesProjectAssetBinding 不再将 imageLocalRef 视为 hasBinding ──
console.log('\n场景 I：验证 hasBinding 不再包含 imageLocalRef\n');

{
  const nodeId = 'has-binding-test';
  const ref = `flowgen-local:uid_pid:${nodeId}:main:Nano_Banana_20`;

  // 仅有 imageLocalRef，无 projectAssetId，无项目资产 URL
  const data: Partial<NodeData> = {
    imagePreview: '', // 空（sanitize 后）
    imageLocalRef: ref,
    selectedModel: 'Nano Banana 2.0',
    status: 'idle',
    panelMainSlotVisible: true,
  };

  const node = simNode({ id: nodeId, type: NodeType.PROCESSOR, data });
  const bound = normalizeGraphNodesProjectAssetBinding([node], serverProjectId);

  // 修复前：hasBinding=true → 进入 normalizeTemplateNodeDataForSpawn → 可能误删 imageLocalRef
  // 修复后：hasBinding=false → 跳过 normalizeTemplateNodeDataForSpawn → imageLocalRef 保留
  const boundData = bound[0].data as NodeData;
  ok(
    '§10.70: 仅 imageLocalRef 不触发 normalizeTemplateNodeDataForSpawn',
    boundData.imageLocalRef === ref,
    `expected=${ref} actual=${String(boundData.imageLocalRef || 'MISSING')}`
  );
  ok(
    '§10.70: 节点数据未被修改（引用相同）',
    bound[0] === node || bound[0].data === node.data,
    'node unchanged'
  );
}

console.log(`\n=== 汇总：${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) process.exit(1);
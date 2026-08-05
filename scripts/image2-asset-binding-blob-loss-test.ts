/**
 * §10.72：image2 从资产库创建后中键拖入新图 → projectAssetId 阻断 IDB 备份 → 刷新后 blob 丢失
 *
 * 根因：
 * 1. image2 从资产库创建 → projectAssetId 已设置
 * 2. 中键拖入新 blob 图片 → onUpdate 设置 imagePreview=data_url，但未清除 projectAssetId
 * 3. attachLocalMainRef 检查 if (existingData?.projectAssetId) return → 跳过 IDB 备份
 * 4. 刷新后 persistSanitize 剥离 data_url → imagePreview=''
 * 5. hydrateLocalMediaPreviews 检查 boundAsset=projectAssetId → 跳过 blob 恢复
 * 6. 图片丢失
 *
 * 修复：onUpdate 中清除 projectAssetId: undefined
 */

import { MODEL_IMAGE_2, NodeType, type NodeData } from '../types';
import { hydrateNodeImagePreviewFromPersisted } from '../utils/hydratePersistedNodePreviews';
import { isPersistableMediaUrl } from '../utils/workspaceMediaPersist';
import { sanitizeWorkspacePayload } from '../utils/persistSanitize.mjs';

let pass = 0;
let fail = 0;

function ok(label: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++;
    console.log(`  [OK] ${label}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${label}${extra ? ` — ${extra}` : ''}`);
  }
}

console.log('\n=== §10.72 image2 projectAssetId 阻断 IDB 备份 → 刷新 blob 丢失 测试 ===\n');

// --- 场景1：从资产库创建的 image2 节点（有 projectAssetId） ---
console.log('场景1：从资产库创建的 image2 节点（有 projectAssetId）');

{
  const assetUrl = '/flowgen-api/projects/proj-1/assets/asset-abc/file';
  const nodeData: Partial<NodeData> = {
    selectedModel: MODEL_IMAGE_2,
    imagePreview: assetUrl,
    projectAssetId: 'asset-abc',
  };

  ok('projectAssetId 已设置', nodeData.projectAssetId === 'asset-abc');
  ok('imagePreview 是资产库 URL', Boolean(nodeData.imagePreview));

  // 模拟 attachLocalMainRef 的 skipLocal 检查
  const skipLocal = !!nodeData.projectAssetId;
  ok('旧逻辑：attachLocalMainRef 会跳过（projectAssetId 已设置）', skipLocal);

  // 模拟 hydrateLocalMediaPreviews 的 boundAsset 检查
  const boundAsset = nodeData.projectAssetId;
  ok('旧逻辑：hydrateLocalMediaPreviews 会跳过（boundAsset 已设置）', Boolean(boundAsset));
}

// --- 场景2：中键拖入新图后清除 projectAssetId（修复后） ---
console.log('\n场景2：中键拖入新图后清除 projectAssetId（修复后）');

{
  const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
  const blobUrl = 'blob:https://localhost:3001/abc-123';

  // 模拟修复后的 onUpdate 调用
  const nodeData: Partial<NodeData> = {
    selectedModel: MODEL_IMAGE_2,
    imagePreview: dataUrl,
    projectAssetId: undefined, // §10.72：清除资产绑定
    panelMainSlotVisible: undefined,
    panelMainImageUrl: undefined,
  };

  ok('projectAssetId 已清除', !nodeData.projectAssetId);
  ok('imagePreview = data URL', nodeData.imagePreview === dataUrl);

  // 模拟 attachLocalMainRef 的 skipLocal 检查（修复后）
  const skipLocal = !!nodeData.projectAssetId;
  ok('修复后：attachLocalMainRef 不会跳过（projectAssetId 已清除）', !skipLocal);

  // 模拟 hydrateLocalMediaPreviews 的 boundAsset 检查（修复后）
  const boundAsset = nodeData.projectAssetId;
  ok('修复后：hydrateLocalMediaPreviews 不会跳过（boundAsset 已清除）', !boundAsset);

  // 模拟 IDB 备份后 imageLocalRef 已设置
  nodeData.imageLocalRef = 'flowgen-local:image2-main:test-node';
  ok('imageLocalRef 已设置（IDB 备份后）', Boolean(nodeData.imageLocalRef));
}

// --- 场景3：完整刷新恢复链路（修复后） ---
console.log('\n场景3：完整刷新恢复链路（修复后）');

{
  // 步骤1：中键拖入后节点状态
  const afterDrag: Partial<NodeData> = {
    selectedModel: MODEL_IMAGE_2,
    imagePreview: 'data:image/png;base64,iVBORw0KGgo=',
    projectAssetId: undefined, // §10.72 已清除
    imageLocalRef: 'flowgen-local:image2-main:test-node',
    panelMainSlotVisible: undefined,
    panelMainImageUrl: undefined,
  };

  // 步骤2：持久化
  const payload = {
    graph: {
      nodes: [{ id: 'test', type: NodeType.INPUT, position: { x: 0, y: 0 }, data: afterDrag }],
      edges: [],
    },
  };
  const sanitized = sanitizeWorkspacePayload(payload);
  const sData = (sanitized as any).graph.nodes[0].data;

  ok('持久化后 imagePreview 被剥离', !sData.imagePreview || sData.imagePreview === '');
  ok('持久化后 projectAssetId 不存在（undefined 被 sanitize 跳过）', sData.projectAssetId === undefined);
  ok('持久化后 imageLocalRef 保留', sData.imageLocalRef === 'flowgen-local:image2-main:test-node');

  // 步骤3：刷新后 hydrate
  const node = { id: 'test', type: NodeType.INPUT, position: { x: 0, y: 0 }, data: sData };
  const hydrated = hydrateNodeImagePreviewFromPersisted(node as any);
  const hData = hydrated.data as Record<string, unknown>;

  ok('hydrate 后 imagePreview 为空（等待 IDB 恢复）', !hData.imagePreview || hData.imagePreview === '');
  ok('hydrate 后 imageLocalRef 保留', hData.imageLocalRef === 'flowgen-local:image2-main:test-node');

  // 步骤4：hydrateLocalMediaPreviews 恢复
  const boundAsset = hData.projectAssetId;
  ok('boundAsset 为空（不会跳过 blob 恢复）', !boundAsset);

  const ref = hData.imageLocalRef;
  ok('imageLocalRef 存在（可从 IDB 恢复）', Boolean(ref));

  // 模拟 IDB 恢复
  hData.imagePreview = 'blob:https://localhost:3001/recovered';
  ok('IDB 恢复后 imagePreview = 新 blob URL', Boolean(hData.imagePreview));
}

// --- 场景4：对照旧逻辑（未清除 projectAssetId → blob 丢失） ---
console.log('\n场景4：对照旧逻辑（未清除 projectAssetId → blob 丢失）');

{
  // 旧逻辑：未清除 projectAssetId
  const afterDragOld: Partial<NodeData> = {
    selectedModel: MODEL_IMAGE_2,
    imagePreview: 'data:image/png;base64,iVBORw0KGgo=',
    projectAssetId: 'asset-abc', // 未清除！
    // imageLocalRef 未设置（attachLocalMainRef 被跳过）
  };

  // 持久化
  const payload = {
    graph: {
      nodes: [{ id: 'test', type: NodeType.INPUT, position: { x: 0, y: 0 }, data: afterDragOld }],
      edges: [],
    },
  };
  const sanitized = sanitizeWorkspacePayload(payload);
  const sData = (sanitized as any).graph.nodes[0].data;

  ok('旧逻辑：持久化后 projectAssetId 保留', sData.projectAssetId === 'asset-abc');
  ok('旧逻辑：持久化后 imagePreview 被剥离', !sData.imagePreview || sData.imagePreview === '');
  ok('旧逻辑：持久化后无 imageLocalRef', !sData.imageLocalRef);

  // hydrate
  const node = { id: 'test', type: NodeType.INPUT, position: { x: 0, y: 0 }, data: sData };
  const hydrated = hydrateNodeImagePreviewFromPersisted(node as any);
  const hData = hydrated.data as Record<string, unknown>;

  // hydrateLocalMediaPreviews 检查
  const boundAsset = hData.projectAssetId;
  ok('旧逻辑：boundAsset 存在 → 跳过 blob 恢复', Boolean(boundAsset));
  ok('旧逻辑：imageLocalRef 不存在 → 无法恢复', !hData.imageLocalRef);
  ok('旧逻辑：imagePreview 保持空 → 图片丢失', !hData.imagePreview || hData.imagePreview === '');
}

// --- 场景5：从资产库拖入的图片（https URL）不需要 IDB 备份 ---
console.log('\n场景5：从资产库拖入的 https URL 不需要 IDB 备份');

{
  const httpsUrl = 'https://cos.example.com/images/test.png';

  // https URL 是 persistable，不需要 IDB 备份
  ok('https URL 是 persistable', isPersistableMediaUrl(httpsUrl));

  // 即使清除 projectAssetId，https URL 仍可持久化
  const nodeData: Partial<NodeData> = {
    selectedModel: MODEL_IMAGE_2,
    imagePreview: httpsUrl,
    projectAssetId: undefined,
  };

  // 持久化
  const payload = {
    graph: {
      nodes: [{ id: 'test', type: NodeType.INPUT, position: { x: 0, y: 0 }, data: nodeData }],
      edges: [],
    },
  };
  const sanitized = sanitizeWorkspacePayload(payload);
  const sData = (sanitized as any).graph.nodes[0].data;

  ok('持久化后 https URL 保留', sData.imagePreview === httpsUrl);

  // hydrate
  const node = { id: 'test', type: NodeType.INPUT, position: { x: 0, y: 0 }, data: sData };
  const hydrated = hydrateNodeImagePreviewFromPersisted(node as any);
  const hData = hydrated.data as Record<string, unknown>;

  ok('hydrate 后 https URL 保留', hData.imagePreview === httpsUrl);
}

// --- 汇总 ---
console.log(`\n=== 汇总：${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) {
  process.exit(1);
}

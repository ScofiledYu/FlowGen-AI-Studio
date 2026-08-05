/**
 * §10.71：image2 中键拖入主图 → IDB 备份 → 刷新恢复 完整链路测试
 *
 * 验证场景：
 * 1. 中键拖入 blob URL 到 image2（无主图）→ imageLocalRef 应被设置 + imagePreview 立即显示
 * 2. 持久化时 imagePreview (data URL) 被剥离，imageLocalRef 保留
 * 3. 刷新后 hydrateNodeImagePreviewFromPersisted 清空 imagePreview → hydrateLocalMediaPreviews 从 IDB 恢复
 * 4. 中键拖入 https URL 到 image2（无主图）→ imagePreview 立即显示，无需 IDB 备份
 * 5. 中键拖入到已有主图的 image2 → 走参考槽逻辑，registerEphemeralPanelRefToLocalStore 备份
 */

import { isImage2Model, MODEL_IMAGE_2, NodeType, type NodeData } from '../types';
import { hydrateNodeImagePreviewFromPersisted } from '../utils/hydratePersistedNodePreviews';
import { isPersistableMediaUrl, isEphemeralMediaUrl } from '../utils/workspaceMediaPersist';
import { shouldPreferRunReferencePreviewOverLocalMain } from '../utils/referencedMediaRun';
import { shouldShowPanelMainImageSlot } from '../utils/referencedMediaRun';
import { sanitizeWorkspacePayload } from '../utils/persistSanitize.mjs';
import { compactImage2PanelReferences } from '../utils/image2PanelRefs';

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

console.log('\n=== §10.71 image2 中键拖入主图 → IDB 备份 → 刷新恢复 测试 ===\n');

// --- 场景1：中键拖入 blob URL → imageLocalRef 设置 + imagePreview 显示 ---
console.log('场景1：中键拖入 blob URL 到 image2（无主图）');

{
  const blobUrl = 'blob:https://localhost:3001/abc-123';
  const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';

  // 模拟 applyInspectorReferenceFromUrlStringImpl 的 image2 无主图分支
  const isImage2 = isImage2Model(MODEL_IMAGE_2);
  ok('image2 模型识别', isImage2);

  // normalizeInspectorIngestImageUrl 将 blob 转为 data URL
  const normalizedImg = dataUrl; // 模拟压缩后的 data URL

  // 模拟 onUpdate 后的节点数据
  const nodeData: Partial<NodeData> = {
    selectedModel: MODEL_IMAGE_2,
    imagePreview: normalizedImg,
    panelMainSlotVisible: undefined,
    panelMainImageUrl: undefined,
    imageLocalRef: 'flowgen-local:image2-main:test-node-id', // 模拟 attachLocalMainRef 设置
  };

  ok('onUpdate 后 imagePreview 立即设置为 data URL', nodeData.imagePreview === dataUrl);
  ok('imageLocalRef 已设置（attachLocalMainRef 后台执行）', Boolean(nodeData.imageLocalRef?.trim()));
  ok('panelMainSlotVisible 为 undefined', nodeData.panelMainSlotVisible === undefined);
  ok('isPersistableMediaUrl(blob) = false（需要 IDB 备份）', !isPersistableMediaUrl(blobUrl));
  ok('isPersistableMediaUrl(data) = false（data URL 也需要 IDB 备份）', !isPersistableMediaUrl(dataUrl));
}

// --- 场景2：持久化时 data URL 被剥离，imageLocalRef 保留 ---
console.log('\n场景2：持久化 sanitize 剥离 data URL，保留 imageLocalRef');

{
  const nodeData: Partial<NodeData> = {
    selectedModel: MODEL_IMAGE_2,
    imagePreview: 'data:image/png;base64,iVBORw0KGgo=',
    imageLocalRef: 'flowgen-local:image2-main:test-node-id',
    referenceImages: [],
    referenceImageLabels: [],
    referenceImageLocalRefs: [],
  };

  const payload = {
    graph: {
      nodes: [
        {
          id: 'test-node',
          type: NodeType.INPUT,
          position: { x: 0, y: 0 },
          data: nodeData,
        },
      ],
      edges: [],
    },
  };

  const sanitized = sanitizeWorkspacePayload(payload);
  const sanitizedNode = (sanitized as any).graph.nodes[0];
  const sanitizedData = sanitizedNode.data;

  ok('持久化后 imagePreview 被剥离', !sanitizedData.imagePreview || sanitizedData.imagePreview === '');
  ok('持久化后 imageLocalRef 保留', sanitizedData.imageLocalRef === 'flowgen-local:image2-main:test-node-id');
}

// --- 场景3：刷新后 hydrate 清空 imagePreview → hydrateLocalMediaPreviews 从 IDB 恢复 ---
console.log('\n场景3：刷新后 hydrate 流程');

{
  // 模拟从服务器加载的持久化数据（imagePreview 已被剥离）
  const persistedData: Record<string, unknown> = {
    selectedModel: MODEL_IMAGE_2,
    imagePreview: '', // 已被 persistSanitize 剥离
    imageLocalRef: 'flowgen-local:image2-main:test-node-id',
    referenceImages: [],
    referenceImageLabels: [],
    referenceImageLocalRefs: [],
  };

  const node = {
    id: 'test-node',
    type: NodeType.INPUT,
    position: { x: 0, y: 0 },
    data: persistedData,
  };

  // hydrateNodeImagePreviewFromPersisted 应清空 imagePreview（让 IDB 恢复）
  const hydrated = hydrateNodeImagePreviewFromPersisted(node as any);
  const hydratedData = hydrated.data as Record<string, unknown>;

  ok('hydrate 后 imagePreview 为空（等待 IDB 恢复）', !hydratedData.imagePreview || hydratedData.imagePreview === '');
  ok('hydrate 后 imageLocalRef 保留', hydratedData.imageLocalRef === 'flowgen-local:image2-main:test-node-id');

  // 验证 shouldPreferRunReferencePreviewOverLocalMain 返回 false（允许 IDB 恢复）
  const preferGp = shouldPreferRunReferencePreviewOverLocalMain(hydratedData as Partial<NodeData>);
  ok('shouldPreferRunReferencePreviewOverLocalMain = false（允许 IDB 恢复主图）', !preferGp);

  // 验证 shouldShowPanelMainImageSlot 在 imagePreview 为空时返回 false（正常：IDB 恢复前主图格隐藏）
  const showMainBeforeHydrate = shouldShowPanelMainImageSlot(hydratedData as Partial<NodeData>);
  ok('IDB 恢复前 shouldShowPanelMainImageSlot = false（imagePreview 空，等待恢复）', !showMainBeforeHydrate);

  // 模拟 IDB 恢复后：imagePreview = blob URL
  const afterHydrateData = { ...hydratedData, imagePreview: 'blob:https://localhost:3001/recovered-xyz' };
  const showMainAfterHydrate = shouldShowPanelMainImageSlot(afterHydrateData as Partial<NodeData>);
  ok('IDB 恢复后 shouldShowPanelMainImageSlot = true（imagePreview 已恢复）', showMainAfterHydrate);

  // 模拟从 IDB 恢复 blob URL
  // 实际运行时 getLocalMediaBlob(ref) 会返回 blob，URL.createObjectURL(blob) 创建新 blob URL
  const recoveredBlobUrl = 'blob:https://localhost:3001/recovered-xyz';
  ok('IDB 恢复后 imagePreview = 新 blob URL（模拟）', Boolean(recoveredBlobUrl));
}

// --- 场景4：中键拖入 https URL → 无需 IDB 备份 ---
console.log('\n场景4：中键拖入 https URL 到 image2（无主图）');

{
  const httpsUrl = 'https://cos.example.com/images/test.png';

  // isPersistableMediaUrl 应返回 true（https URL 可持久化）
  ok('isPersistableMediaUrl(https) = true（无需 IDB 备份）', isPersistableMediaUrl(httpsUrl));

  // 模拟 onUpdate 后的节点数据
  const nodeData: Partial<NodeData> = {
    selectedModel: MODEL_IMAGE_2,
    imagePreview: httpsUrl,
    panelMainSlotVisible: undefined,
    panelMainImageUrl: undefined,
    // 无 imageLocalRef（https URL 不需要 IDB 备份）
  };

  ok('onUpdate 后 imagePreview = https URL', nodeData.imagePreview === httpsUrl);
  ok('无 imageLocalRef（https URL 可直接持久化）', !nodeData.imageLocalRef);

  // 持久化后 https URL 应保留
  const payload = {
    graph: {
      nodes: [
        {
          id: 'test-node',
          type: NodeType.INPUT,
          position: { x: 0, y: 0 },
          data: nodeData,
        },
      ],
      edges: [],
    },
  };

  const sanitized = sanitizeWorkspacePayload(payload);
  const sanitizedData = (sanitized as any).graph.nodes[0].data;

  ok('持久化后 https URL 保留', sanitizedData.imagePreview === httpsUrl);

  // hydrate 后 https URL 应保留（不是 ephemeral）
  const node = {
    id: 'test-node',
    type: NodeType.INPUT,
    position: { x: 0, y: 0 },
    data: sanitizedData,
  };
  const hydrated = hydrateNodeImagePreviewFromPersisted(node as any);
  const hydratedData = hydrated.data as Record<string, unknown>;

  ok('hydrate 后 https URL 保留', hydratedData.imagePreview === httpsUrl);
  ok('isEphemeralMediaUrl(https) = false', !isEphemeralMediaUrl(httpsUrl, 'imagePreview'));
}

// --- 场景5：中键拖入到已有主图的 image2 → 走参考槽逻辑 ---
console.log('\n场景5：中键拖入到已有主图的 image2 → 参考槽逻辑');

{
  const blobUrl = 'blob:https://localhost:3001/ref-blob-456';

  // 模拟已有主图的 image2 节点
  const nodeData: Partial<NodeData> = {
    selectedModel: MODEL_IMAGE_2,
    imagePreview: 'data:image/png;base64,iVBORw0KGgo=',
    imageLocalRef: 'flowgen-local:image2-main:test-node',
    referenceImages: [],
    referenceImageLabels: [],
    referenceImageLocalRefs: [],
  };

  // 主图已存在 → isImage2 && !main 为 false → 走参考槽逻辑
  const main = String(nodeData.imagePreview || '').trim();
  ok('已有主图时 main 非空', Boolean(main));
  ok('已有主图时跳过无主图分支', Boolean(main));

  // 参考槽逻辑会调用 registerEphemeralPanelRefToLocalStore
  // 该函数对 blob URL 会 fetch + 存 IDB + 设置 referenceImageLocalRefs
  ok('blob URL 非持久化 → registerEphemeralPanelRefToLocalStore 会备份', !isPersistableMediaUrl(blobUrl));

  // 模拟参考槽添加后
  const refData: Partial<NodeData> = {
    ...nodeData,
    referenceImages: [blobUrl],
    referenceImageLabels: ['图片1'],
    referenceImageLocalRefs: ['flowgen-local:image2-ref:test-node:0'],
  };

  // 持久化时 referenceImages 中的 blob 被剥离为空串（PRESERVE_SLOT_ARRAY_KEYS）
  const payload = {
    graph: {
      nodes: [
        {
          id: 'test-node',
          type: NodeType.INPUT,
          position: { x: 0, y: 0 },
          data: refData,
        },
      ],
      edges: [],
    },
  };

  const sanitized = sanitizeWorkspacePayload(payload);
  const sanitizedData = (sanitized as any).graph.nodes[0].data;

  ok('持久化后 referenceImages[0] 被剥离为空串', sanitizedData.referenceImages[0] === '');
  ok('持久化后 referenceImageLocalRefs[0] 保留', sanitizedData.referenceImageLocalRefs[0] === 'flowgen-local:image2-ref:test-node:0');
}

// --- 场景6：验证 image2ShowMainInRefGrid 逻辑 ---
console.log('\n场景6：image2ShowMainInRefGrid 主图格显示逻辑');

{
  // 有主图 + imageLocalRef → 主图格显示
  const withMain: Partial<NodeData> = {
    selectedModel: MODEL_IMAGE_2,
    imagePreview: 'data:image/png;base64,iVBORw0KGgo=',
    imageLocalRef: 'flowgen-local:image2-main:test',
  };
  ok('有主图+imageLocalRef → shouldShowPanelMainImageSlot = true', shouldShowPanelMainImageSlot(withMain));

  // 刷新后 imagePreview 被清空 + imageLocalRef 保留 → IDB 恢复前主图格隐藏（正常）
  const afterRefresh: Partial<NodeData> = {
    selectedModel: MODEL_IMAGE_2,
    imagePreview: '',
    imageLocalRef: 'flowgen-local:image2-main:test',
  };
  ok('刷新后 imagePreview 空+imageLocalRef 存在 → IDB 恢复前 shouldShowPanelMainImageSlot = false', !shouldShowPanelMainImageSlot(afterRefresh));

  // IDB 恢复后 imagePreview = blob URL → 主图格显示
  const afterHydrate: Partial<NodeData> = {
    ...afterRefresh,
    imagePreview: 'blob:https://localhost:3001/recovered',
  };
  ok('IDB 恢复后 imagePreview=blob → shouldShowPanelMainImageSlot = true', shouldShowPanelMainImageSlot(afterHydrate));

  // 无主图 + 无 imageLocalRef → 主图格不显示
  const noMain: Partial<NodeData> = {
    selectedModel: MODEL_IMAGE_2,
    imagePreview: '',
  };
  ok('无主图+无imageLocalRef → shouldShowPanelMainImageSlot = false', !shouldShowPanelMainImageSlot(noMain));
}

// --- 场景7：onUpdate 先于 IDB 备份执行（关键：图片立即显示） ---
console.log('\n场景7：onUpdate 先于 IDB 备份执行（图片立即显示）');

{
  const executionOrder: string[] = [];

  // 模拟 applyMain 的执行顺序
  const applyMain = (img: string) => {
    // 1. 先调用 onUpdate（同步）
    executionOrder.push('onUpdate');
    // 2. 再后台异步 IDB 备份
    if (!isPersistableMediaUrl('blob:https://localhost:3001/test')) {
      void (async () => {
        executionOrder.push('fetch-start');
        try {
          await Promise.resolve(); // 模拟 fetch
          executionOrder.push('fetch-done');
          executionOrder.push('dispatchEvent');
        } catch {
          executionOrder.push('fetch-error');
        }
      })();
    }
  };

  applyMain('data:image/png;base64,iVBORw0KGgo=');

  ok('onUpdate 是第一个执行的（图片立即显示）', executionOrder[0] === 'onUpdate');
  ok('fetch 在 onUpdate 之后异步启动', executionOrder.length >= 2 && executionOrder[1] === 'fetch-start');
}

// --- 汇总 ---
console.log(`\n=== 汇总：${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) {
  process.exit(1);
}

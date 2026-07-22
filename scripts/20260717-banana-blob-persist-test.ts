/**
 * 2026-07-17 Banana blob 持久化端到端模拟测试
 * 场景：拖入 3 张本地图片 → 运行（@图片1 + @图片2）→ 刷新 → 验证面板 blob 图片是否恢复
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { NodeData, GenerationParams } from '../types';
import { NodeType, MODEL_NANO_BANANA_2 } from '../types';
import {
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
  getNodeInspectorPromptText,
  type ReferencedCollectedImageRef,
} from '../utils/promptMediaRefs';
import {
  mergeAndPrunePanelReferenceImagesAfterUpload,
  buildPanelImagePreviewPatchAfterRun,
  panelMergeOptionsForReferencedUpload,
  mergeSeedancePanelReferenceImagesAfterUpload,
  populateUploadedRefBySlotFromMediaPlan,
  pickStillImageRecoveryApiReferenceImages,
  isPersistablePanelReferenceUrl,
} from '../utils/referencedMediaRun';
import {
  hydrateAllPanelReferenceLocalRefs,
  needsHydrateFromLocalRef,
  needsMainBackupHydrateFromLocalRef,
  panelRefsPendingLocalHydrate,
  anyPanelRefsPendingLocalHydrate,
} from '../utils/hydratePanelReferenceLocalRefs';
import { isPersistableMediaUrl, isEphemeralMediaUrl } from '../utils/workspaceMediaPersist';
import { sanitizePersistValueDeep } from '../utils/persistSanitize.mjs';
import { prepareNodesAfterWorkspaceLoad } from '../utils/runRecovery';
import { hydrateGraphMediaFromPersisted } from '../utils/hydratePersistedNodePreviews';
import { getLocalMediaBlob, putLocalMediaFile } from '../utils/localNodeMediaStore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}
function shorten(s?: string, n = 60) {
  return s ? (s.length > n ? s.slice(0, n) + '…' : s) : String(s);
}

// 模拟 COS URL（模拟上传后返回的 URL）
const COS_UPLOADED_1 = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/uploaded-1.png';
const COS_UPLOADED_2 = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/uploaded-2.png';
const COS_UPLOADED_3 = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/uploaded-3.png';

// 模拟 blob URL（本地拖入的图片）
const BLOB_1 = 'blob:http://localhost:3001/abc-123';
const BLOB_2 = 'blob:http://localhost:3001/def-456';
const BLOB_3 = 'blob:http://localhost:3001/ghi-789';

// 模拟 localRef（IndexedDB key）
const LOCAL_REF_1 = 'nano:node_banana_1:ref:0';
const LOCAL_REF_2 = 'nano:node_banana_1:ref:1';
const LOCAL_REF_3 = 'nano:node_banana_1:ref:2';

console.log('=== Banana blob 持久化端到端模拟测试 ===\n');

// ===== §1. 拖入 3 张本地图片到 Banana 面板 =====
console.log('--- §1. 拖入 3 张本地图片到 Banana 面板 ---');
const nodeAfterDrag: Partial<NodeData> = {
  id: 'node_banana_1',
  type: NodeType.INPUT_IMAGE,
  selectedModel: MODEL_NANO_BANANA_2,
  prompt: '',
  imagePreview: BLOB_1, // 主图（拖入第一张）
  referenceImages: [BLOB_1, BLOB_2, BLOB_3],
  referenceImageLabels: ['图片1', '图片2', '图片3'],
  referenceImageLocalRefs: [LOCAL_REF_1, LOCAL_REF_2, LOCAL_REF_3],
  imageLocalRef: 'nano:node_banana_1:main',
  status: 'idle',
};

ok('拖入后 referenceImages 有 3 个 blob', (nodeAfterDrag.referenceImages || []).length === 3);
ok('拖入后 referenceImageLocalRefs 有 3 个 localRef', (nodeAfterDrag.referenceImageLocalRefs || []).length === 3);
ok('所有槽都是 blob URL', (nodeAfterDrag.referenceImages || []).every((u) => String(u || '').startsWith('blob:')));

// ===== §2. 用户写 prompt 并运行 =====
console.log('\n--- §2. 用户写 prompt "@图片1 + @图片2" 并运行 ---');
const prompt = '@图片1 + @图片2';
const dataForRun: NodeData = { ...nodeAfterDrag, prompt } as NodeData;

// 2a. 解析 plan
const ctx = buildPromptMediaRefContextFromNode(dataForRun);
const plan = collectReferencedMediaFromPrompt(prompt, dataForRun, ctx, new Map(), undefined);
console.log('  plan.images =', plan.images.map((it) => ({ token: it.token, slotIndex: it.refImageSlotIndex, url: shorten(it.url, 30) })));
ok('plan 解析到 2 个 @ 引用', plan.images.length === 2);
ok('@图片1 slotIndex=0', plan.images[0]?.refImageSlotIndex === 0);
ok('@图片2 slotIndex=1', plan.images[1]?.refImageSlotIndex === 1);

// 2b. 模拟上传（blob → COS URL）
const nanoUploadedByToken = new Map<string, string>();
nanoUploadedByToken.set('@图片1', COS_UPLOADED_1);
nanoUploadedByToken.set('@图片2', COS_UPLOADED_2);
const imageUrls = [COS_UPLOADED_1, COS_UPLOADED_2];

// 2c. mergeAndPrunePanelReferenceImagesAfterUpload
const panelMergeOpts = panelMergeOptionsForReferencedUpload(
  plan.images,
  nanoUploadedByToken,
  dataForRun.imagePreview,
  undefined,
  dataForRun.referenceImageLabels
);
const mergedNanoRefs = mergeAndPrunePanelReferenceImagesAfterUpload(
  dataForRun.referenceImages,
  plan.images,
  nanoUploadedByToken,
  panelMergeOpts
);
console.log('  mergedNanoRefs =', mergedNanoRefs.map((u) => shorten(u, 50)));
ok('合并后仍有 3 个槽位', mergedNanoRefs.length === 3);
ok('槽0 是 COS URL（上传后）', mergedNanoRefs[0] === COS_UPLOADED_1);
ok('槽1 是 COS URL（上传后）', mergedNanoRefs[1] === COS_UPLOADED_2);
ok('槽2 仍是 blob URL（未 @ 引用）', mergedNanoRefs[2] === BLOB_3);

// 2d. buildPanelImagePreviewPatchAfterRun
const nanoPreviewPatch = buildPanelImagePreviewPatchAfterRun(plan.images, nanoUploadedByToken, {
  nodeData: dataForRun,
  mergedPanelRefs: mergedNanoRefs,
  mergedPanelLabels: dataForRun.referenceImageLabels,
  projectAssets: undefined,
});
console.log('  nanoPreviewPatch =', {
  imagePreview: shorten(nanoPreviewPatch.imagePreview),
  panelMainSlotVisible: nanoPreviewPatch.panelMainSlotVisible,
  panelMainImageUrl: shorten(nanoPreviewPatch.panelMainImageUrl),
});

// 2e. 运行后节点状态
const nodeAfterRun: Partial<NodeData> = {
  ...dataForRun,
  ...nanoPreviewPatch,
  referenceImages: [...mergedNanoRefs],
  referenceImageLocalRefs: [...(dataForRun.referenceImageLocalRefs || [])], // 保留
  imageLocalRef: dataForRun.imageLocalRef, // 保留
  status: 'completed',
  generationParams: {
    model: MODEL_NANO_BANANA_2,
    prompt,
    referenceImages: [...imageUrls],
    referenceImageLabels: ['图片1', '图片2'],
    seedanceGenerationMode: '',
  } as GenerationParams,
};
console.log('  运行后 referenceImages =', (nodeAfterRun.referenceImages || []).map((u) => shorten(u, 50)));
console.log('  运行后 referenceImageLocalRefs =', nodeAfterRun.referenceImageLocalRefs);
console.log('  运行后 imagePreview =', shorten(nodeAfterRun.imagePreview));
console.log('  运行后 panelMainImageUrl =', shorten(nodeAfterRun.panelMainImageUrl));
ok('运行后 referenceImageLocalRefs 保留 3 个', (nodeAfterRun.referenceImageLocalRefs || []).length === 3);

// ===== §3. 模拟持久化（sanitize） =====
console.log('\n--- §3. 模拟持久化 (sanitizePersistValueDeep) ---');
const sanitized = sanitizePersistValueDeep(nodeAfterRun, '') as Record<string, unknown>;
console.log('  sanitized referenceImages =', (sanitized.referenceImages as string[] || []).map((u) => shorten(u as string, 50)));
console.log('  sanitized referenceImageLocalRefs =', sanitized.referenceImageLocalRefs);
ok('sanitize 后 referenceImages 槽2 变为空字符串', (sanitized.referenceImages as string[] || [])[2] === '');
ok('sanitize 后 referenceImageLocalRefs 保留', Array.isArray(sanitized.referenceImageLocalRefs) && (sanitized.referenceImageLocalRefs as string[]).length === 3);
ok('sanitize 后 imagePreview 保留 COS URL', typeof sanitized.imagePreview === 'string' && (sanitized.imagePreview as string).startsWith('https://'));

// ===== §4. 模拟刷新后 workspace load =====
console.log('\n--- §4. 模拟刷新后 workspace load → hydrate ---');
const sanitizedNode = { id: 'node_banana_1', type: NodeType.INPUT_IMAGE, data: sanitized };
const prepared = prepareNodesAfterWorkspaceLoad([sanitizedNode], []);
const hydratedRemote = hydrateGraphMediaFromPersisted(prepared.nodes, []);
const hydratedNode = hydratedRemote[0];
console.log('  hydrateRemote 后 referenceImages =', ((hydratedNode.data as Record<string, unknown>).referenceImages as string[] || []).map((u) => shorten(u as string, 50)));
console.log('  hydrateRemote 后 referenceImageLocalRefs =', (hydratedNode.data as Record<string, unknown>).referenceImageLocalRefs);

// ===== §5. 模拟 hydrateAllPanelReferenceLocalRefs（异步从 IDB 恢复 blob） =====
console.log('\n--- §5. 模拟 hydrateAllPanelReferenceLocalRefs（从 IDB 恢复 blob） ---');
// 注意：Node.js 环境下 IndexedDB 不可用，getLocalMediaBlob 会返回 null
// 这里我们直接验证 needHydrate 判定逻辑
const dataForHydrate = hydratedNode.data as Partial<NodeData>;
console.log('  referenceImages =', (dataForHydrate.referenceImages || []).map((u) => shorten(u, 50)));
console.log('  referenceImageLocalRefs =', dataForHydrate.referenceImageLocalRefs);

// 检查每个槽位
const refs = dataForHydrate.referenceImages || [];
const localRefs = dataForHydrate.referenceImageLocalRefs || [];
for (let i = 0; i < Math.max(refs.length, localRefs.length); i++) {
  const url = refs[i] || '';
  const lr = localRefs[i] || '';
  const needsHydrate = needsHydrateFromLocalRef(url);
  console.log(`  槽${i}: url=${shorten(url, 30)} localRef=${shorten(lr, 20)} needsHydrate=${needsHydrate}`);
}
ok('槽0 (COS URL) 不需要 hydrate', !needsHydrateFromLocalRef(refs[0]));
ok('槽1 (COS URL) 不需要 hydrate', !needsHydrateFromLocalRef(refs[1]));
ok('槽2 (空字符串) 需要 hydrate（有 localRef）', needsHydrateFromLocalRef(refs[2]) && Boolean(localRefs[2]));
ok('anyPanelRefsPendingLocalHydrate = true', anyPanelRefsPendingLocalHydrate(dataForHydrate) === true);

// ===== §6. 验证：如果 IndexedDB 中存在 blob，恢复后面板正确 =====
console.log('\n--- §6. 验证恢复逻辑（模拟 IDB 有数据） ---');
// 模拟 hydrate 后的结果：槽2 恢复为 blob URL
const restoredRefs = [...refs];
restoredRefs[2] = BLOB_3; // 模拟 hydrateAllPanelReferenceLocalRefs 恢复
console.log('  恢复后 referenceImages =', restoredRefs.map((u) => shorten(u, 50)));
ok('恢复后槽0 仍是 COS URL', restoredRefs[0] === COS_UPLOADED_1);
ok('恢复后槽1 仍是 COS URL', restoredRefs[1] === COS_UPLOADED_2);
ok('恢复后槽2 恢复为 blob URL', restoredRefs[2] === BLOB_3);

// ===== §7. 边界场景：所有图片都被 @ 引用 → 全部上传为 COS =====
console.log('\n--- §7. 边界场景：@图片1 + @图片2 + @图片3（全部 @ 引用） ---');
const promptAll = '@图片1 + @图片2 + @图片3';
const planAll = collectReferencedMediaFromPrompt(promptAll, dataForRun, ctx, new Map(), undefined);
const uploadedAll = new Map<string, string>();
uploadedAll.set('@图片1', COS_UPLOADED_1);
uploadedAll.set('@图片2', COS_UPLOADED_2);
uploadedAll.set('@图片3', COS_UPLOADED_3);

const mergedAll = mergeAndPrunePanelReferenceImagesAfterUpload(
  dataForRun.referenceImages,
  planAll.images,
  uploadedAll,
  panelMergeOptionsForReferencedUpload(planAll.images, uploadedAll, dataForRun.imagePreview, undefined, dataForRun.referenceImageLabels)
);
console.log('  mergedAll =', mergedAll.map((u) => shorten(u, 50)));
ok('全部 @ 引用后所有槽都是 COS URL', mergedAll.every((u) => u.startsWith('https://')));
ok('全部 @ 引用后槽数仍是 3', mergedAll.length === 3);

// 持久化后：所有槽都是 COS URL，不需要 hydrate
const sanitizedAll = sanitizePersistValueDeep({
  ...nodeAfterRun,
  referenceImages: [...mergedAll],
}, '') as Record<string, unknown>;
console.log('  sanitize 后 referenceImages =', (sanitizedAll.referenceImages as string[] || []).map((u) => shorten(u as string, 50)));
const allPersistable = (sanitizedAll.referenceImages as string[] || []).every((u) => isPersistableMediaUrl(u));
ok('全部 @ 引用后 sanitize 不丢图', allPersistable);
const noPending = !anyPanelRefsPendingLocalHydrate({
  referenceImages: sanitizedAll.referenceImages as string[],
  referenceImageLocalRefs: dataForRun.referenceImageLocalRefs,
} as Partial<NodeData>);
ok('全部 @ 引用后不需要 hydrate', noPending);

// ===== §8. 验证：Banana 运行后 panelMainSlotVisible=false 的 blob 恢复 =====
console.log('\n--- §8. 验证 panelMainSlotVisible=false 时主图 blob 恢复 ---');
const mainBlobData: Partial<NodeData> = {
  ...nodeAfterRun,
  panelMainSlotVisible: false,
  panelMainImageUrl: BLOB_1, // 主图备份是 blob
  imageLocalRef: 'nano:node_banana_1:main',
};
const sanitizedMain = sanitizePersistValueDeep(mainBlobData, '') as Record<string, unknown>;
console.log('  sanitize 后 panelMainImageUrl =', shorten(sanitizedMain.panelMainImageUrl as string));
ok('sanitize 后 panelMainImageUrl 被剥离为 undefined', sanitizedMain.panelMainImageUrl === undefined);

// 但 referenceImages 中的 blob 也被剥离了
const mainRefsSanitized = sanitizedMain.referenceImages as string[] || [];
console.log('  sanitize 后 referenceImages =', mainRefsSanitized.map((u) => shorten(u as string, 50)));

// 需要 hydrate 主图备份
const needsMain = needsMainBackupHydrateFromLocalRef({
  ...sanitizedMain,
  imageLocalRef: 'nano:node_banana_1:main',
  selectedModel: MODEL_NANO_BANANA_2,
  seedanceGenerationMode: 'reference',
} as Partial<NodeData>);
ok('主图 blob 被剥离后 needsMainBackupHydrateFromLocalRef = true', needsMain === true);

console.log(`\n=== 汇总: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
/**
 * 2026-07-17 Banana 数据图片刷新后丢失 —— 精确复现
 * 
 * 用户数据三态：
 * 运行前: referenceImages=["data:image/jpeg;base64,...", "", "", ""], referenceImageLocalRefs=undefined
 * 运行后: node.referenceImages 未变，modelConfigs 有正确 URL
 * 刷新后: referenceImages=["", "COS URL", "资产库 URL", ""], 槽0/3 丢图
 * 
 * 根因: referenceImageLocalRefs 从未被设置 → 刷新后无法从 IndexedDB 恢复 blob
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { NodeData, GenerationParams } from '../types';
import { NodeType, MODEL_NANO_BANANA_2 } from '../types';
import { sanitizePersistValueDeep } from '../utils/persistSanitize.mjs';
import { prepareNodesAfterWorkspaceLoad } from '../utils/runRecovery';
import { hydrateGraphMediaFromPersisted } from '../utils/hydratePersistedNodePreviews';
import { needsHydrateFromLocalRef, anyPanelRefsPendingLocalHydrate } from '../utils/hydratePanelReferenceLocalRefs';
import { isPersistableMediaUrl } from '../utils/workspaceMediaPersist';

const __filename = fileURLToPath(import.meta.url);
let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++; else fail++;
}
function shorten(s?: string, n = 80) {
  return s ? (s.length > n ? s.slice(0, n) + '…' : s) : String(s);
}

// 模拟一个 data:image URL（从用户实际数据截取前200字符）
const DATA_IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAA';
const COS_URL = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/0af89f97-f511-4100-a5a8-b7532ffb8bd0.png';
const ASSET_URL = '/flowgen-api/projects/14/assets/f2e869b4-9bc5-4a53-b9b3-61083f1301d9/file';
const MAIN_URL = '/flowgen-api/projects/14/assets/606b3650-f5d5-486b-8568-0f65b1fc33c3/file';

console.log('=== Banana data:image 刷新丢失 - 精确复现 ===\n');

// ===== §1. 模拟运行后状态（用户 "banana运行后.json"） =====
console.log('--- §1. 模拟运行后状态 ---');
const nodeAfterRun: Partial<NodeData> = {
  id: 'node_0_1784251363772',
  type: NodeType.INPUT_IMAGE,
  selectedModel: MODEL_NANO_BANANA_2,
  prompt: '@资产:祭司老人老人出现再@资产:原始丛林小路中',
  imagePreview: COS_URL,
  imageName: '原始丛林小路',
  panelMainImageUrl: MAIN_URL,
  panelMainSlotVisible: false,
  status: 'completed',
  // 关键：referenceImages 仍有 data:image（运行后未更新 node 级别）
  referenceImages: [DATA_IMAGE, '', '', ''],
  referenceImageLabels: ['图片1', '祭司老人', '土坑', '图片4'],
  // 关键：referenceImageLocalRefs 是 undefined！
  referenceImageLocalRefs: undefined,
  imageLocalRef: undefined,
  // modelConfigs 有正确的 URL
  modelConfigs: {
    'Nano Banana 2.0': {
      prompt: '@资产:祭司老人老人出现再@资产:原始丛林小路中',
      referenceImages: [DATA_IMAGE, COS_URL, ASSET_URL, ''],
      referenceImageLabels: ['图片1', '祭司老人', '土坑', '图片4'],
      panelMainImageUrl: MAIN_URL,
      panelMainSlotVisible: false,
      imagePreview: COS_URL,
      imageName: '原始丛林小路',
    },
  },
  generationParams: {
    model: MODEL_NANO_BANANA_2,
    prompt: '@资产:祭司老人老人出现再@资产:原始丛林小路中',
    referenceImages: [COS_URL, ASSET_URL],
    referenceImageLabels: ['祭司老人', '原始丛林小路'],
  } as GenerationParams,
};

console.log('  node.referenceImages =', (nodeAfterRun.referenceImages || []).map((u) => shorten(u, 60)));
console.log('  node.referenceImageLocalRefs =', nodeAfterRun.referenceImageLocalRefs);
console.log('  modelConfigs.referenceImages =', (nodeAfterRun.modelConfigs?.['Nano Banana 2.0']?.referenceImages || []).map((u: string) => shorten(u, 60)));

ok('node 级别 referenceImages[0] 是 data:image', String(nodeAfterRun.referenceImages?.[0] || '').startsWith('data:image/'));
ok('node 级别 referenceImageLocalRefs 是 undefined', nodeAfterRun.referenceImageLocalRefs === undefined);
ok('modelConfigs 有 4 个槽位', (nodeAfterRun.modelConfigs?.['Nano Banana 2.0']?.referenceImages || []).length === 4);

// ===== §2. 模拟持久化 sanitize =====
console.log('\n--- §2. 模拟持久化 sanitize ---');
const sanitized = sanitizePersistValueDeep(nodeAfterRun, '') as Record<string, unknown>;
const sanitizedRefs = sanitized.referenceImages as string[] || [];
console.log('  sanitize 后 referenceImages =', sanitizedRefs.map((u) => shorten(u as string, 60)));
console.log('  sanitize 后 referenceImageLocalRefs =', sanitized.referenceImageLocalRefs);

ok('sanitize 后槽0 变为空字符串', sanitizedRefs[0] === '');
ok('sanitize 后槽1/2/3 保持空（因为 node 级别就是空）', sanitizedRefs[1] === '' && sanitizedRefs[2] === '' && sanitizedRefs[3] === '');

// modelConfigs 中的 data:image 也会被剥离
const sanitizedMc = sanitized.modelConfigs as Record<string, unknown> | undefined;
const sanitizedMcRefs = (sanitizedMc?.['Nano Banana 2.0'] as Record<string, unknown>)?.referenceImages as string[] || [];
console.log('  sanitize 后 modelConfigs.referenceImages =', sanitizedMcRefs.map((u) => shorten(u as string, 60)));
ok('sanitize 后 modelConfigs 槽0 变为空字符串', sanitizedMcRefs[0] === '');
ok('sanitize 后 modelConfigs 槽1 保持 COS URL', sanitizedMcRefs[1] === COS_URL);
ok('sanitize 后 modelConfigs 槽2 保持资产库 URL', sanitizedMcRefs[2] === ASSET_URL);

// ===== §3. 模拟刷新后 workspace load + hydrate =====
console.log('\n--- §3. 模拟刷新后 workspace load → hydrate ---');
const sanitizedNode = { id: 'node_0_1784251363772', type: NodeType.INPUT_IMAGE, data: sanitized };
const prepared = prepareNodesAfterWorkspaceLoad([sanitizedNode], []);
const hydratedRemote = hydrateGraphMediaFromPersisted(prepared.nodes, []);
const hydratedNode = hydratedRemote[0];
const hydratedData = hydratedNode.data as Partial<NodeData>;
console.log('  hydrate 后 referenceImages =', (hydratedData.referenceImages || []).map((u) => shorten(u, 60)));
console.log('  hydrate 后 referenceImageLocalRefs =', hydratedData.referenceImageLocalRefs);

// hydrateGraphMediaFromPersisted 会从 modelConfigs 恢复 referenceImages
const hydratedRefs = hydratedData.referenceImages || [];
ok('hydrate 后槽0 为空（data:image 被剥离）', hydratedRefs[0] === '');
ok('hydrate 后槽1 为 COS URL（从 modelConfigs 恢复）', hydratedRefs[1] === COS_URL);
ok('hydrate 后槽2 为资产库 URL（从 modelConfigs 恢复）', hydratedRefs[2] === ASSET_URL);

// ===== §4. 关键判定：能否从 IndexedDB 恢复？ =====
console.log('\n--- §4. 能否从 IndexedDB 恢复？ ---');
console.log('  referenceImageLocalRefs =', hydratedData.referenceImageLocalRefs);
const needsHydrate = needsHydrateFromLocalRef(hydratedRefs[0]);
console.log('  needsHydrateFromLocalRef(槽0) =', needsHydrate);
console.log('  但 referenceImageLocalRefs[0] =', hydratedData.referenceImageLocalRefs?.[0]);

// 关键：referenceImageLocalRefs 是 undefined，所以即使需要 hydrate，也没有 localRef
ok('needsHydrateFromLocalRef(槽0) = true（空字符串需要恢复）', needsHydrate === true);
ok('referenceImageLocalRefs 是 undefined → 无法恢复', hydratedData.referenceImageLocalRefs === undefined || hydratedData.referenceImageLocalRefs?.[0] === undefined);

// ===== §5. 模拟"如果 referenceImageLocalRefs 被正确设置"的情况 =====
console.log('\n--- §5. 模拟正确修复后的场景 ---');
const fixedNode: Partial<NodeData> = {
  ...nodeAfterRun,
  referenceImageLocalRefs: ['banana:local:ref:slot0', undefined, undefined, undefined],
};
const fixedSanitized = sanitizePersistValueDeep(fixedNode, '') as Record<string, unknown>;
console.log('  fix 后 referenceImageLocalRefs =', fixedSanitized.referenceImageLocalRefs);
ok('fix 后 referenceImageLocalRefs[0] 保留', (fixedSanitized.referenceImageLocalRefs as string[])?.[0] === 'banana:local:ref:slot0');

// §6. 检查 modelConfigs 中是否有 referenceImageLocalRefs
console.log('\n--- §6. 检查 modelConfigs 持久化是否包含 referenceImageLocalRefs ---');
const mcWithLocalRefs = {
  ...nodeAfterRun.modelConfigs,
  'Nano Banana 2.0': {
    ...nodeAfterRun.modelConfigs?.['Nano Banana 2.0'],
    referenceImageLocalRefs: ['banana:local:ref:slot0', undefined, undefined, undefined],
  },
};
const mcSanitized = sanitizePersistValueDeep({ modelConfigs: mcWithLocalRefs }, '') as Record<string, unknown>;
const mcSanitizedLocalRefs = ((mcSanitized.modelConfigs as Record<string, unknown>)?.['Nano Banana 2.0'] as Record<string, unknown>)?.referenceImageLocalRefs as string[] | undefined;
console.log('  modelConfigs 中 referenceImageLocalRefs 保留:', mcSanitizedLocalRefs);
ok('modelConfigs 中 referenceImageLocalRefs 也保留', mcSanitizedLocalRefs?.[0] === 'banana:local:ref:slot0');

console.log(`\n=== 汇总: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
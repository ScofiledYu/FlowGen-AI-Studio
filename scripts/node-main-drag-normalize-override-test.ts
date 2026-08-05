/**
 * §10.74：applyAssetToNodeMain 中键拖入非持久化 URL 到资产库节点 → normalize 覆盖 imagePreview 修复验证
 *
 * 根因：applyAssetToNodeMain 调用 normalizeTemplateNodeDataForSpawn 时传入 { ...n.data, imagePreview: blobUrl }。
 * 若节点从资产库创建（n.data.projectAssetId 存在）+ serverProjectId 存在 → pid&&aid=true →
 * normalizeTemplateNodeDataForSpawn 把 imagePreview 改回资产库 fileUrl + delete imageLocalRef。
 * 用户拖入的新图被旧资产图覆盖 → "无法拖图"；刷新后 isAssetBoundPreview=true → 跳过 IDB 恢复 → "刷新后丢图"。
 *
 * 修复：拖入非持久化 URL 时清除 projectAssetId=undefined，避免 normalize 覆盖 imagePreview。
 *
 * npx tsx scripts/node-main-drag-normalize-override-test.ts
 */
import type { NodeData } from '../types.ts';
import { normalizeTemplateNodeDataForSpawn } from '../utils/normalizeTemplateNodeForSpawn.ts';
import { isPersistableMediaUrl } from '../utils/workspaceMediaPersist.ts';
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

const PROJECT_ID = 'proj-node-main-001';
const ASSET_ID = 'asset-from-lib';
const ASSET_URL = `/flowgen-api/projects/${PROJECT_ID}/assets/${ASSET_ID}/file`;
const BLOB_URL = 'blob:http://localhost:3001/user-dragged-new-image';
const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/IUAAAAASUVORK5CYII=';
const HTTPS_URL = 'https://cos.example.com/persistable-image.png';

console.log('=== §10.74 applyAssetToNodeMain normalize 覆盖 imagePreview 修复验证 ===\n');

// 模拟 applyAssetToNodeMain 中的核心逻辑（修复后）
function simulateApplyAssetToNodeMain(
  nodeData: Partial<NodeData>,
  nextPreview: string,
  fromAssetLibrary: boolean,
  assetId?: string
): NodeData {
  const isNonPersistedDrop = !isPersistableMediaUrl(nextPreview);
  // §10.74 修复：非持久化 URL 清除 projectAssetId
  const nextData = normalizeTemplateNodeDataForSpawn(
    {
      ...nodeData,
      imagePreview: nextPreview,
      imageName: 'test.png',
      ...(isNonPersistedDrop
        ? { projectAssetId: undefined }
        : fromAssetLibrary && assetId
          ? { projectAssetId: assetId }
          : {}),
    } as NodeData,
    PROJECT_ID
  );
  return nextData;
}

// 模拟修复前的逻辑（不清除 projectAssetId）
function simulateApplyAssetToNodeMainBeforeFix(
  nodeData: Partial<NodeData>,
  nextPreview: string,
  fromAssetLibrary: boolean,
  assetId?: string
): NodeData {
  const nextData = normalizeTemplateNodeDataForSpawn(
    {
      ...nodeData,
      imagePreview: nextPreview,
      imageName: 'test.png',
      ...(fromAssetLibrary && assetId ? { projectAssetId: assetId } : {}),
    } as NodeData,
    PROJECT_ID
  );
  return nextData;
}

// ── 场景1：资产库节点 + 中键拖入 blob URL（修复后）──
console.log('场景1：资产库节点 + 中键拖入 blob URL（修复后）→ imagePreview 不被覆盖\n');

{
  const nodeData: Partial<NodeData> = {
    selectedModel: 'image 2',
    imagePreview: ASSET_URL,
    projectAssetId: ASSET_ID,
    imageName: 'from-asset.png',
  };

  const result = simulateApplyAssetToNodeMain(nodeData, BLOB_URL, false);

  ok('imagePreview = blob URL（不被覆盖）', result.imagePreview === BLOB_URL, String(result.imagePreview));
  ok('imagePreview 不是资产库 URL', !isProjectAssetLibraryImageUrl(result.imagePreview || ''));
  ok('projectAssetId 已清除', !(result as NodeData & { projectAssetId?: string }).projectAssetId);
}

// ── 场景2：资产库节点 + 中键拖入 blob URL（修复前 — 对照组，验证 bug 存在）──
console.log('\n场景2：资产库节点 + 中键拖入 blob URL（修复前 — 对照组）→ imagePreview 被覆盖\n');

{
  const nodeData: Partial<NodeData> = {
    selectedModel: 'image 2',
    imagePreview: ASSET_URL,
    projectAssetId: ASSET_ID,
    imageName: 'from-asset.png',
  };

  const result = simulateApplyAssetToNodeMainBeforeFix(nodeData, BLOB_URL, false);

  // 修复前的 bug 行为：imagePreview 被改回资产库 URL
  ok('[对照] imagePreview 被改回资产库 URL（bug 行为）', result.imagePreview === ASSET_URL, String(result.imagePreview));
  ok('[对照] imagePreview 是资产库 URL', isProjectAssetLibraryImageUrl(result.imagePreview || ''));
}

// ── 场景3：资产库节点 + 中键拖入 data URL（修复后）──
console.log('\n场景3：资产库节点 + 中键拖入 data URL（修复后）→ imagePreview 不被覆盖\n');

{
  const nodeData: Partial<NodeData> = {
    selectedModel: 'Nano Banana 2.0',
    imagePreview: ASSET_URL,
    projectAssetId: ASSET_ID,
    imageName: 'from-asset.png',
  };

  const result = simulateApplyAssetToNodeMain(nodeData, DATA_URL, false);

  ok('imagePreview = data URL（不被覆盖）', result.imagePreview === DATA_URL);
  ok('imagePreview 不是资产库 URL', !isProjectAssetLibraryImageUrl(result.imagePreview || ''));
  ok('projectAssetId 已清除', !(result as NodeData & { projectAssetId?: string }).projectAssetId);
}

// ── 场景4：资产库节点 + 从资产库拖入 https URL（修复后）──
console.log('\n场景4：资产库节点 + 从资产库拖入（fromAssetLibrary=true）→ 正常走 normalize\n');

{
  const nodeData: Partial<NodeData> = {
    selectedModel: 'image 2',
    imagePreview: ASSET_URL,
    projectAssetId: ASSET_ID,
    imageName: 'from-asset.png',
  };

  // fromAssetLibrary=true, assetId 存在 → 走正常 normalize
  const result = simulateApplyAssetToNodeMain(nodeData, ASSET_URL, true, ASSET_ID);

  ok('imagePreview 是资产库 URL（正常 normalize）', isProjectAssetLibraryImageUrl(result.imagePreview || ''));
  ok('projectAssetId 保留', (result as NodeData & { projectAssetId?: string }).projectAssetId === ASSET_ID);
}

// ── 场景5：普通节点（无 projectAssetId）+ 中键拖入 blob URL（修复后）──
console.log('\n场景5：普通节点（无 projectAssetId）+ 中键拖入 blob URL → 原本就正常\n');

{
  const nodeData: Partial<NodeData> = {
    selectedModel: 'image 2',
    imagePreview: '',
    imageName: 'empty.png',
    // 无 projectAssetId
  };

  const result = simulateApplyAssetToNodeMain(nodeData, BLOB_URL, false);

  ok('imagePreview = blob URL', result.imagePreview === BLOB_URL);
  ok('imagePreview 不是资产库 URL', !isProjectAssetLibraryImageUrl(result.imagePreview || ''));
}

// ── 场景6：资产库节点 + 中键拖入持久化 https URL（修复后）──
console.log('\n场景6：资产库节点 + 中键拖入持久化 https URL → projectAssetId 保留，normalize 正常处理\n');

{
  const nodeData: Partial<NodeData> = {
    selectedModel: 'image 2',
    imagePreview: ASSET_URL,
    projectAssetId: ASSET_ID,
    imageName: 'from-asset.png',
  };

  // https URL 是持久化的 → isNonPersistedDrop=false → 不清除 projectAssetId
  const result = simulateApplyAssetToNodeMain(nodeData, HTTPS_URL, false);

  ok('imagePreview 是持久化 URL', isPersistableMediaUrl(result.imagePreview));
  ok('projectAssetId 保留（持久化 URL 不清除）', (result as NodeData & { projectAssetId?: string }).projectAssetId === ASSET_ID);
}

// ── 场景7：全模型验证 — 资产库节点 + 中键拖入 blob URL → imagePreview 不被覆盖 ──
console.log('\n场景7：全模型验证 — 资产库节点 + 中键拖入 blob URL → imagePreview 不被覆盖\n');

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

for (const model of ALL_MODELS) {
  const nodeData: Partial<NodeData> = {
    selectedModel: model,
    imagePreview: ASSET_URL,
    projectAssetId: ASSET_ID,
    imageName: 'from-asset.png',
  };

  const result = simulateApplyAssetToNodeMain(nodeData, BLOB_URL, false);

  ok(
    `[${model}] imagePreview = blob URL（不被覆盖）`,
    result.imagePreview === BLOB_URL,
    String(result.imagePreview).slice(0, 50)
  );
  ok(
    `[${model}] projectAssetId 已清除`,
    !(result as NodeData & { projectAssetId?: string }).projectAssetId
  );
}

// ── 汇总 ──
console.log(`\n=== 汇总：${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) {
  console.error(`\n❌ node-main drag normalize override 测试失败：${fail} 项未通过`);
  process.exit(1);
} else {
  console.log('\n✅ 修复验证通过：非持久化 URL 拖入不再被 normalize 覆盖');
}

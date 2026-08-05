/**
 * 复现 + 锁定修复：运行失败后面板主图格消失（§10.68）
 *
 * 根因：图生图/图生视频模型在 API 调用前调用 buildPanelImagePreviewPatchAfterRun
 *   设 panelMainSlotVisible:false（未 @主图 时隐藏主图格）+ 备份原主图到 panelMainImageUrl，
 *   随即 setNodes 写回面板。API 失败 → catch 块只清 status/taskId，不回滚主图格 →
 *   主图格保持隐藏 → 用户看到"面板少图"。
 *
 * 修复：catch 块调用 buildMainSlotRollbackPatchForRunError 条件回滚主图格。
 *   - 条件：panelMainSlotVisible===false && panelMainImageUrl 有值（运行时确实隐藏了主图格）
 *   - 回滚：panelMainSlotVisible:true + imagePreview:备份 + 清 panelMainImageUrl
 *   - 不回滚：referenceImages 的 COS URL 替换（COS URL 有效，回滚到 blob 可能失效）
 *
 * 影响模型：Nano / image2 / 可灵 Omni multi/tab / Seedance（都调用 buildPanelImagePreviewPatchAfterRun）
 *
 * npx tsx scripts/run-error-panel-rollback-test.ts
 */
import type { NodeData } from '../types.ts';
import { buildMainSlotRollbackPatchForRunError, clearStaleRunTaskBeforeFreshRun } from '../utils/runRecovery.ts';

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

function simData(partial: Partial<NodeData>): NodeData {
  return { label: 'n', ...partial } as NodeData;
}

/** 模拟 FlowEditor catch 块修复后行为：清 taskId + 回滚主图格 + idle */
function applyErrorCatchFix(liveData: NodeData): NodeData {
  const clearPatch = clearStaleRunTaskBeforeFreshRun(liveData);
  const mainSlotPatch = buildMainSlotRollbackPatchForRunError(liveData);
  return {
    ...liveData,
    ...clearPatch,
    ...mainSlotPatch,
    status: 'idle',
    progress: 0,
    errorMessage: undefined,
  } as NodeData;
}

console.log('\n=== 场景1：运行时隐藏主图格（未 @主图）→ catch 回滚主图格 ===\n');

{
  // 运行中：buildPanelImagePreviewPatchAfterRun 已设 panelMainSlotVisible:false + 备份
  const runningData = simData({
    selectedModel: 'Nano Banana 2.0',
    status: 'running',
    progress: 5,
    imagePreview: 'cos://ref-first-attr.jpg', // 画布大图切为首个 @参考
    panelMainSlotVisible: false, // 主图格隐藏
    panelMainImageUrl: 'cos://original-main.jpg', // 原主图备份
    referenceImages: ['cos://ref-first.jpg', 'cos://ref-second.jpg'],
  });
  ok('运行中 panelMainSlotVisible=false', runningData.panelMainSlotVisible === false);
  ok('运行中 panelMainImageUrl 有备份', !!runningData.panelMainImageUrl);

  const afterCatch = applyErrorCatchFix(runningData);
  ok('catch 后 panelMainSlotVisible=true（主图格恢复显示）', afterCatch.panelMainSlotVisible === true, String(afterCatch.panelMainSlotVisible));
  ok('catch 后 imagePreview=备份 URL', afterCatch.imagePreview === 'cos://original-main.jpg', String(afterCatch.imagePreview));
  ok('catch 后 panelMainImageUrl 已清', afterCatch.panelMainImageUrl === undefined, String(afterCatch.panelMainImageUrl));
  ok('catch 后 status=idle', afterCatch.status === 'idle');
  ok('catch 后 referenceImages 不回滚（保留 COS URL）', (afterCatch.referenceImages || []).length === 2);
}

console.log('\n=== 场景2：运行时未动主图格（panelMainSlotVisible:true）→ catch 不回滚 ===\n');

{
  // 运行时主图格未隐藏（含 @主图 或无参考图）
  const runningData = simData({
    selectedModel: 'image 2',
    status: 'running',
    progress: 5,
    imagePreview: 'cos://main.jpg',
    panelMainSlotVisible: true, // 主图格显示中
    panelMainImageUrl: undefined, // 无备份
  });
  const afterCatch = applyErrorCatchFix(runningData);
  ok('catch 后 panelMainSlotVisible 保持 true', afterCatch.panelMainSlotVisible === true);
  ok('catch 后 imagePreview 不变', afterCatch.imagePreview === 'cos://main.jpg');
  ok('catch 后 panelMainImageUrl 仍 undefined', afterCatch.panelMainImageUrl === undefined);
}

console.log('\n=== 场景3：运行时隐藏主图格但无备份 → 不回滚（避免 imagePreview 变 undefined） ===\n');

{
  const runningData = simData({
    selectedModel: 'Seedance 2.0',
    status: 'running',
    progress: 5,
    imagePreview: 'cos://ref.jpg',
    panelMainSlotVisible: false,
    panelMainImageUrl: undefined, // 无备份，不应回滚（否则 imagePreview 变 undefined）
  });
  const afterCatch = applyErrorCatchFix(runningData);
  ok('catch 后 panelMainSlotVisible 保持 false（无备份不回滚）', afterCatch.panelMainSlotVisible === false);
  ok('catch 后 imagePreview 不变（未被清空）', afterCatch.imagePreview === 'cos://ref.jpg');
}

console.log('\n=== 场景4：对照旧行为 —— 不调用回滚函数时主图格保持隐藏 ===\n');

{
  const runningData = simData({
    selectedModel: 'Nano Banana 2.0',
    status: 'running',
    progress: 5,
    imagePreview: 'cos://ref.jpg',
    panelMainSlotVisible: false,
    panelMainImageUrl: 'cos://original-main.jpg',
  });
  // 旧行为：catch 只清 status，不调用 buildMainSlotRollbackPatchForRunError
  const oldBehavior: NodeData = {
    ...runningData,
    ...clearStaleRunTaskBeforeFreshRun(runningData),
    status: 'idle',
    progress: 0,
    errorMessage: undefined,
  } as NodeData;
  ok('旧行为：panelMainSlotVisible 仍 false（主图格消失，这就是 bug）', oldBehavior.panelMainSlotVisible === false, '这就是 §10.68 的根因');
  ok('旧行为：imagePreview 仍为参考图（非原主图）', oldBehavior.imagePreview === 'cos://ref.jpg');
}

console.log('\n=== 场景5：Omni/Seedance 多 tab 场景 —— 回滚仅基于字段，与模型无关 ===\n');

{
  // 可灵 Omni tab 场景：同样的字段逻辑
  const runningData = simData({
    selectedModel: '可灵3.0 Omni',
    status: 'running',
    progress: 5,
    imagePreview: 'cos://omni-ref.jpg',
    panelMainSlotVisible: false,
    panelMainImageUrl: 'cos://omni-main.jpg',
  });
  const afterCatch = applyErrorCatchFix(runningData);
  ok('Omni catch 后 panelMainSlotVisible=true', afterCatch.panelMainSlotVisible === true);
  ok('Omni catch 后 imagePreview=备份', afterCatch.imagePreview === 'cos://omni-main.jpg');
}

console.log(`\n=== 汇总：${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) process.exit(1);

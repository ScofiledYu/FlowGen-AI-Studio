/**
 * 画布「暂停刷新」多节点模拟测试
 * npx tsx scripts/canvas-refresh-pause-test.ts
 */
import {
  countLodTransitionsForNodes,
  getCanvasRefreshPaused,
  isGraphSideEffectPaused,
  resolvePreviewLodWithPause,
  resolveVisibleThumbCountWhenPaused,
  selectViewportZoomForNode,
  setCanvasRefreshPaused,
  shouldDeferVideoDecodeWhenPaused,
  shouldRenderNodeThumbnailsWhenPaused,
} from '../utils/canvasRefreshPause.ts';
import { zoomToCanvasPreviewLod } from '../utils/canvasPreviewLod.ts';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

console.log('\n=== 1. Phase1 LOD 冻结 ===\n');

{
  ok('暂停+未选中 → low', resolvePreviewLodWithPause(1.2, false, true) === 'low');
  ok('暂停+选中 → high', resolvePreviewLodWithPause(0.2, true, true) === 'high');
  ok('暂停+平移时选中也 → low', resolvePreviewLodWithPause(1.2, true, true, true) === 'low');
  ok('未暂停+远 zoom → low', resolvePreviewLodWithPause(0.15, false, false) === 'low');
  ok(
    '未暂停+近 zoom → high',
    resolvePreviewLodWithPause(1.0, false, false) === 'high'
  );
}

console.log('\n=== 2. 缩略图条 / 揭示 ===\n');

{
  ok(
    '暂停时非选中不渲染缩略图条',
    !shouldRenderNodeThumbnailsWhenPaused(true, 'high', true, false)
  );
  ok(
    '暂停时选中仍渲染缩略图条',
    shouldRenderNodeThumbnailsWhenPaused(true, 'high', true, true)
  );
  ok(
    '暂停时非选中仅首批',
    resolveVisibleThumbCountWhenPaused(8, true, false, 1) === 1
  );
  ok(
    '暂停时选中全部揭示',
    resolveVisibleThumbCountWhenPaused(8, true, true, 1) === 8
  );
}

console.log('\n=== 3. Phase2 高级 side-effect 门控 ===\n');

{
  ok(
    '仅 Phase1 不暂停 side-effect',
    !isGraphSideEffectPaused(false, true, false)
  );
  ok(
    'Phase1+高级 暂停 side-effect',
    isGraphSideEffectPaused(false, true, true)
  );
  ok(
    '拖拽 perf 仍暂停 side-effect',
    isGraphSideEffectPaused(true, false, false)
  );
  ok(
    '全关',
    !isGraphSideEffectPaused(false, false, false)
  );
}

console.log('\n=== 4. 多节点 zoom 换档模拟（30 节点 × 5 档 zoom）===\n');

{
  const nodeCount = 30;
  const zoomSamples = [0.15, 0.35, 0.6, 0.9, 1.2];
  const withoutPause = countLodTransitionsForNodes(nodeCount, zoomSamples, false, null);
  const withPause = countLodTransitionsForNodes(nodeCount, zoomSamples, true, null);
  ok(
    '未暂停存在 LOD 换档',
    withoutPause > 0,
    `transitions=${withoutPause}`
  );
  ok(
    '暂停后非选中 LOD 换档为 0',
    withPause === 0,
    `transitions=${withPause} (was ${withoutPause})`
  );
  ok(
    '暂停减少换档 ≥80%',
    withPause <= withoutPause * 0.2,
    `reduction=${(((withoutPause - withPause) / withoutPause) * 100).toFixed(0)}%`
  );
}

console.log('\n=== 5. useStore zoom 选择器（暂停时非选中常量）===\n');

{
  ok(
    '暂停非选中 zoom 恒为 1',
    selectViewportZoomForNode(0.15, true, false) === 1 &&
      selectViewportZoomForNode(1.5, true, false) === 1
  );
  ok(
    '暂停选中跟随 zoom',
    selectViewportZoomForNode(0.42, true, true) === 0.42
  );
  ok(
    '未暂停跟随 zoom',
    selectViewportZoomForNode(0.42, false, false) === 0.42
  );
  ok(
    '暂停平移时选中 zoom 也冻结',
    selectViewportZoomForNode(0.42, true, true, true) === 1
  );
  ok(
    'defer video 有 poster 非选中',
    shouldDeferVideoDecodeWhenPaused(true, false, true, false) === true
  );
  ok(
    '播放中不 defer',
    shouldDeferVideoDecodeWhenPaused(true, false, true, true) === false
  );
}

console.log('\n=== 6. 全局暂停态同步（新 mount 节点可读）===\n');

{
  setCanvasRefreshPaused(true);
  ok('set 后 get 为 true', getCanvasRefreshPaused() === true);
  setCanvasRefreshPaused(false);
  ok('resume 后 get 为 false', getCanvasRefreshPaused() === false);
}

console.log('\n=== 7. 与 canvasPreviewLod 原逻辑一致（未暂停）===\n');

{
  for (const zoom of [0.1, 0.4, 0.8, 1.5]) {
    for (const selected of [false, true]) {
      const a = zoomToCanvasPreviewLod(zoom, selected);
      const b = resolvePreviewLodWithPause(zoom, selected, false);
      ok(`zoom=${zoom} sel=${selected}`, a === b, `${a} vs ${b}`);
    }
  }
}

console.log(`\n--- 结果: ${pass} 通过, ${fail} 失败 ---\n`);
process.exit(fail > 0 ? 1 : 0);

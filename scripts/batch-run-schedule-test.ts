/**
 * 定时运行 / 批量队列模拟测试
 * npx tsx scripts/batch-run-schedule-test.ts
 */
import type { Edge, Node as RFNode } from 'reactflow';
import { NodeType } from '../types.ts';
import {
  BATCH_RUN_NODE_INTERVAL_MS,
  applyScheduledRunQueueHighlight,
  collectSelectedRunQueue,
  collectStoryboardGreenRunQueue,
  removeScheduledRunQueueHighlightId,
  resolveBatchRunQueueByIds,
  snapshotBatchRunNodeIds,
  simulateStaggeredBatchRun,
} from '../utils/batchRunQueue.ts';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

function node(
  id: string,
  partial: {
    type?: NodeType;
    selected?: boolean;
    prompt?: string;
    spawnHighlight?: string;
    status?: string;
    label?: string;
    hidden?: boolean;
  } = {}
): RFNode {
  return {
    id,
    type: partial.type ?? NodeType.PROCESSOR,
    position: { x: 0, y: 0 },
    hidden: partial.hidden,
    selected: partial.selected,
    data: {
      label: partial.label ?? id,
      prompt: partial.prompt ?? 'test prompt',
      spawnHighlight: partial.spawnHighlight,
      status: partial.status,
    },
  };
}

const edges: Edge[] = [
  { id: 'e1', source: 'done', target: 'out1' },
];

const baseNodes: RFNode[] = [
  node('g1', { spawnHighlight: 'green', label: '镜头01' }),
  node('g2', { spawnHighlight: 'green', label: '镜头02' }),
  node('g3', { spawnHighlight: 'green', label: '镜头03' }),
  node('yellow', { spawnHighlight: 'yellow', label: '未写入时长' }),
  node('noprompt', { spawnHighlight: 'green', prompt: '' }),
  node('done', { spawnHighlight: 'green', label: '已有输出' }),
  node('out1', { type: NodeType.OUTPUT }),
  node('sel1', { selected: true, label: '选中A' }),
  node('sel2', { selected: true, label: '选中B' }),
  node('sel3', { selected: true, label: '选中C' }),
  node('unsel', { selected: false, label: '未选中' }),
];

console.log('\n=== 1. 全部运行：绿色分镜队列 ===\n');

{
  const queue = collectStoryboardGreenRunQueue(baseNodes, edges);
  ok('绿色可运行 3 个', queue.length === 3, `ids=${queue.map((n) => n.id).join(',')}`);
  ok('排除黄色/无 prompt/已有 OUTPUT 下游', !queue.some((n) => ['yellow', 'noprompt', 'done'].includes(n.id)));
}

console.log('\n=== 2. 选择运行：选中节点队列 ===\n');

{
  const queue = collectSelectedRunQueue(baseNodes);
  ok('选中 3 个', queue.length === 3, queue.map((n) => n.id).join(','));
}

console.log('\n=== 3. 定时快照：设定时锁定 nodeIds ===\n');

{
  const snapSelected = snapshotBatchRunNodeIds('selected', baseNodes, edges);
  ok('选择运行快照 3 id', snapSelected.length === 3);

  const snapAll = snapshotBatchRunNodeIds('all', baseNodes, edges);
  ok('全部运行快照 3 id', snapAll.length === 3);

  /** 模拟：定时后用户取消选中，旧逻辑只剩 0；快照仍还原 3 */
  const afterDeselect = baseNodes.map((n) => ({ ...n, selected: false }));
  ok(
    '取消选中后 collectSelectedRunQueue=0',
    collectSelectedRunQueue(afterDeselect).length === 0
  );
  const restored = resolveBatchRunQueueByIds(snapSelected, afterDeselect);
  ok('快照还原仍 3 个', restored.length === 3, restored.map((n) => n.id).join(','));
}

console.log('\n=== 4. 到点执行：跳过 running / 无 prompt ===\n');

{
  const snap = snapshotBatchRunNodeIds('selected', baseNodes, edges);
  const atFire = baseNodes.map((n) => {
    if (n.id === 'sel2') return { ...n, data: { ...n.data, status: 'running' } };
    if (n.id === 'sel3') return { ...n, data: { ...n.data, prompt: '' } };
    return n;
  });
  const queue = resolveBatchRunQueueByIds(snap, atFire);
  ok('running 与空 prompt 被跳过', queue.length === 1 && queue[0].id === 'sel1');
}

console.log('\n=== 5. 批量启动模拟：5 节点全启动（短间隔） ===\n');

await (async () => {
  const five = [1, 2, 3, 4, 5].map((i) =>
    node(`batch${i}`, { selected: true, label: `节点${i}`, spawnHighlight: 'green' })
  );
  const snap = snapshotBatchRunNodeIds('selected', five, []);
  const queue = resolveBatchRunQueueByIds(snap, five.map((n) => ({ ...n, selected: false })));
  ok('快照队列 5 个', queue.length === 5);

  const starts: string[] = [];
  const t0 = Date.now();
  await simulateStaggeredBatchRun(queue, {
    intervalMs: 20,
    onStart: (id) => starts.push(id),
  });
  ok('stagger 启动 5 次', starts.length === 5, starts.join('→'));
  ok('间隔约 20ms×4', Date.now() - t0 >= 70, `${Date.now() - t0}ms`);
})();

console.log('\n=== 6. 定时路径：delay>0 使用 fixedNodeIds（非重新 collect） ===\n');

{
  /** 模拟 handleScheduleRun 核心路径 */
  const scheduleAction = 'selected' as const;
  const nodesAtSchedule = baseNodes;
  const nodeIds = snapshotBatchRunNodeIds(scheduleAction, nodesAtSchedule, edges);
  ok('设定时锁定', nodeIds.length === 3);

  const nodesAtFire = nodesAtSchedule.map((n) => ({ ...n, selected: false }));
  const immediateWouldBe = collectSelectedRunQueue(nodesAtFire);
  const scheduledQueue = resolveBatchRunQueueByIds(nodeIds, nodesAtFire);
  ok('到点立即 collect=0', immediateWouldBe.length === 0);
  ok('到点快照队列=3', scheduledQueue.length === 3);
}

console.log('\n=== 7. 定时排队画布标记 ===\n');

{
  const marked = applyScheduledRunQueueHighlight(baseNodes, ['g1', 'g3']);
  ok('排队节点打标', marked.filter((n) => n.data?.scheduledRunQueued).length === 2);
  ok('g1 已标记', marked.find((n) => n.id === 'g1')?.data?.scheduledRunQueued === true);
  ok('g2 未标记', !marked.find((n) => n.id === 'g2')?.data?.scheduledRunQueued);
  const cleared = applyScheduledRunQueueHighlight(marked, null);
  ok('取消定时后清除标记', cleared.every((n) => !n.data?.scheduledRunQueued));
}

console.log('\n=== 8. 批量执行：逐节点清除「定时」角标 ===\n');

{
  const ids = ['g1', 'g2', 'g3'];
  let badgeIds: string[] | null = [...ids];
  badgeIds = removeScheduledRunQueueHighlightId(badgeIds, 'g1');
  ok('启动 g1 后仍剩 2', badgeIds?.length === 2);
  let marked = applyScheduledRunQueueHighlight(baseNodes, badgeIds);
  ok('g1 无角标', !marked.find((n) => n.id === 'g1')?.data?.scheduledRunQueued);
  ok('g2 g3 仍有角标', marked.filter((n) => n.data?.scheduledRunQueued).length === 2);

  badgeIds = removeScheduledRunQueueHighlightId(badgeIds, 'g2');
  badgeIds = removeScheduledRunQueueHighlightId(badgeIds, 'g3');
  ok('全部启动后 badgeIds 为空', badgeIds === null);
  marked = applyScheduledRunQueueHighlight(baseNodes, badgeIds);
  ok('画布无角标', marked.every((n) => !n.data?.scheduledRunQueued));
}

console.log(`\n=== 汇总 ===\n通过 ${pass}，失败 ${fail}\n`);
if (fail > 0) process.exit(1);

console.log(
  `批量间隔常量 ${BATCH_RUN_NODE_INTERVAL_MS / 1000}s（生产环境 runStaggeredQueue 使用同一值）\n`
);

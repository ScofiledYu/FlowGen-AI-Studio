/**
 * 复现 + 锁定修复：运行失败后原节点卡 5% running（删错节点/刷新后 recovery 重新拉起失败任务）
 *
 * 根因：FlowEditor catch 块只更新 LIVE 状态为 idle，未清 taskId + 未持久化。
 *   - 删除 error OUTPUT 后 nodeNeedsAiTopTaskRecovery 返回 true（taskId 存在 + 无下游 error 阻断）
 *   - useAiTopRunRecovery 重新拉起 recoverOneNode → 设 running+5% → 轮询失败任务 → 卡死
 *   - 刷新加载持久化 running 态 → 同样循环
 *
 * 修复：catch 块用 clearStaleRunTaskBeforeFreshRun 清 taskId + gp.taskId + runRecoveryPending，
 *   并 stageRunPersistPatch + flushCriticalRunPersist 立即持久化。
 *
 * npx tsx scripts/run-error-no-stuck-test.ts
 */
import type { NodeData, GenerationParams } from '../types.ts';
import { NodeType } from '../types.ts';
import {
  clearRunRecoveryHints,
  clearStaleRunTaskBeforeFreshRun,
  nodeHasPendingRunRecovery,
  nodeNeedsAiTopTaskRecovery,
  prepareNodesAfterWorkspaceLoad,
  shouldTriggerAiTopRunRecovery,
} from '../utils/runRecovery.ts';
import type { Edge, Node as RFNode } from 'reactflow';

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
    type: partial.type || NodeType.INPUT,
    position: { x: 0, y: 0 },
    data: { label: 'n', ...partial.data } as NodeData,
  };
}

/** 模拟 FlowEditor catch 块的修复后行为：清 taskId + runRecoveryPending + 持久化 */
function applyErrorCatchFix(liveNode: RFNode): RFNode {
  const clearPatch = clearStaleRunTaskBeforeFreshRun(liveNode.data as NodeData);
  return {
    ...liveNode,
    data: {
      ...liveNode.data,
      ...clearPatch,
      status: 'idle',
      progress: 0,
      errorMessage: undefined,
    } as NodeData,
  };
}

console.log('\n=== 场景1：运行失败 → catch 清 taskId → 删 error OUTPUT 不触发 recovery ===\n');

{
  // 运行中：taskId 已写入，runRecoveryPending=true，progress=5
  const runningNode = simNode({
    id: 'run-1',
    data: {
      selectedModel: 'Nano Banana 2.0',
      status: 'running',
      progress: 5,
      taskId: 'failed-task-001',
      runRecoveryPending: true,
      runRecoveryProgress: 5,
      generationParams: { taskId: 'failed-task-001', model: 'Nano Banana 2.0' } as GenerationParams,
    },
  });
  ok('运行中 status=running', runningNode.data.status === 'running');
  ok('运行中 taskId 存在', runningNode.data.taskId === 'failed-task-001');

  // catch 块（修复后）：清 taskId + idle
  const afterCatch = applyErrorCatchFix(runningNode);
  ok('catch 后 status=idle', afterCatch.data.status === 'idle', String(afterCatch.data.status));
  ok('catch 后 progress=0', afterCatch.data.progress === 0);
  ok('catch 后 taskId 已清', afterCatch.data.taskId === undefined, String(afterCatch.data.taskId));
  ok('catch 后 gp.taskId 已清', (afterCatch.data.generationParams as GenerationParams)?.taskId === undefined);
  ok('catch 后 runRecoveryPending 已清', afterCatch.data.runRecoveryPending === undefined);

  // 删除 error OUTPUT 后（无下游）：shouldTriggerAiTopRunRecovery 应为 false（无 taskId）
  const noDownstream: RFNode[] = [afterCatch];
  const noEdges: Edge[] = [];
  ok(
    '删 error OUTPUT 后 shouldTriggerAiTopRunRecovery=false（无 taskId）',
    !shouldTriggerAiTopRunRecovery(afterCatch, noDownstream, noEdges),
    `taskId=${afterCatch.data.taskId}`
  );
  ok('nodeHasPendingRunRecovery=false', !nodeHasPendingRunRecovery(afterCatch));
  ok('nodeNeedsAiTopTaskRecovery=false（无 taskId）', !nodeNeedsAiTopTaskRecovery(afterCatch, noDownstream, noEdges));
}

console.log('\n=== 场景2：刷新后 prepareNodesAfterWorkspaceLoad 不再恢复 running 态 ===\n');

{
  // 持久化状态（修复后）：idle + 无 taskId + 无 runRecoveryPending
  const persistedIdle = simNode({
    id: 'run-2',
    data: {
      selectedModel: 'image 2',
      status: 'idle',
      progress: 0,
      taskId: undefined,
      runRecoveryPending: undefined,
      generationParams: { model: 'image 2' } as GenerationParams,
    },
  });
  const { nodes: prepared, changed } = prepareNodesAfterWorkspaceLoad([persistedIdle], []);
  const after = prepared.find((n) => n.id === 'run-2')!;
  ok('刷新后仍 idle', after.data.status === 'idle', String(after.data.status));
  ok('刷新后 progress=0', after.data.progress === 0);
  ok('刷新后不触发 recovery', !shouldTriggerAiTopRunRecovery(after, prepared, []));
}

console.log('\n=== 场景3：未修复的旧行为（对照）—— taskId 未清时删 error OUTPUT 会触发 recovery ===\n');

{
  // 旧行为：catch 只设 idle，没清 taskId
  const oldBehavior = simNode({
    id: 'run-3',
    data: {
      selectedModel: 'Nano Banana 2.0',
      status: 'idle',
      progress: 0,
      taskId: 'failed-task-002',
      runRecoveryPending: undefined,
      generationParams: { taskId: 'failed-task-002', model: 'Nano Banana 2.0' } as GenerationParams,
    },
  });
  // 删除 error OUTPUT 后（无下游）
  const noDownstream: RFNode[] = [oldBehavior];
  const noEdges: Edge[] = [];
  ok(
    '旧行为：删 error OUTPUT 后 shouldTriggerAiTopRunRecovery=true（taskId 残留导致 recovery 重新拉起）',
    shouldTriggerAiTopRunRecovery(oldBehavior, noDownstream, noEdges),
    `taskId=${oldBehavior.data.taskId}（这就是 5% 卡死的根因）`
  );
}

console.log('\n=== 场景4：error OUTPUT 仍在时，旧行为也不触发 recovery（下游 error 阻断） ===\n');

{
  const source = simNode({
    id: 'run-4',
    data: {
      selectedModel: 'Nano Banana 2.0',
      status: 'idle',
      progress: 0,
      taskId: 'failed-task-003',
      runRecoveryPending: undefined,
    },
  });
  const errorOut = simNode({
    id: 'err-4',
    type: NodeType.OUTPUT,
    data: {
      label: 'Error Result Node',
      status: 'error',
      errorMessage: '**Task ID：** failed-task-003',
      imageName: 'Error.txt',
    },
  });
  const edges = [{ id: 'e4', source: 'run-4', target: 'err-4' } as never];
  ok(
    'error OUTPUT 在时 shouldTriggerAiTopRunRecovery=false（下游 error 阻断）',
    !shouldTriggerAiTopRunRecovery(source, [source, errorOut], edges as Edge[])
  );
}

console.log(`\n=== 汇总：${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) process.exit(1);

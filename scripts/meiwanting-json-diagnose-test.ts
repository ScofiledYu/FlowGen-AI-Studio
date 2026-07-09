/**
 * 诊断 d:/json/没完没了.json：image2 卡 95% + 刷新 recovery 循环
 * npx tsx scripts/meiwanting-json-diagnose-test.ts
 */
import fs from 'fs';
import {
  nodeNeedsAiTopTaskRecovery,
  shouldTriggerAiTopRunRecovery,
  prepareNodesAfterWorkspaceLoad,
  clearStaleRunTaskBeforeFreshRun,
} from '../utils/runRecovery.ts';

const json = JSON.parse(fs.readFileSync('d:/json/没完没了.json', 'utf8'));
const node = json.nodes[0];
const rf = { id: node.id, type: node.type, position: node.position, data: node.data };

console.log('=== 没完没了.json 诊断 ===\n');
console.log('持久化态:', {
  status: node.data.status,
  progress: node.data.progress,
  taskId: node.data.taskId,
  runRecoveryPending: node.data.runRecoveryPending,
  runRecoveryProgress: node.data.runRecoveryProgress,
});

const { nodes: prepared } = prepareNodesAfterWorkspaceLoad([rf], []);
const p = prepared[0];
console.log('\n加载后 prepareNodes:', {
  status: p.data.status,
  progress: p.data.progress,
  runRecoveryPending: p.data.runRecoveryPending,
});
console.log('会触发 AiTop recovery:', shouldTriggerAiTopRunRecovery(p, prepared, []));

const afterFail = {
  ...p,
  data: {
    ...p.data,
    status: 'idle' as const,
    progress: 0,
    runRecoveryPending: undefined,
    runRecoveryProgress: undefined,
    errorMessage: '恢复生成结果失败：任务状态查询连续失败（Task ID: 1532775）',
  },
};
console.log('\nrecovery 失败后（taskId 未清，当前代码行为）:');
console.log('  仍会再次触发 recovery:', shouldTriggerAiTopRunRecovery(afterFail, [afterFail], []));

const afterFailFixed = {
  ...afterFail,
  data: {
    ...afterFail.data,
    ...clearStaleRunTaskBeforeFreshRun(afterFail.data),
  },
};
console.log('\nrecovery 失败后（清 taskId，修复后）:');
console.log('  不再触发 recovery:', !shouldTriggerAiTopRunRecovery(afterFailFixed, [afterFailFixed], []));

console.log('\n结论提示:');
console.log('  - 95% 是进度条上限设计，任务完成前不会超过 95');
console.log('  - taskId 1532775 在 AiTop 侧已不存在 → recovery 约 20s 内失败');
console.log('  - 若失败后未清 taskId → 会反复拉起 recovery，表现为一直卡在 95%');

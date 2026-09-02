/**
 * MOV 中间节点恢复防回归测试（§16.26）
 *
 * 背景（5555.json 实测）：MOV 节点已有成片（播放上游生成视频），在其上配置 2.5 视频延长
 * 并运行，**运行途中刷新页面** → 旧恢复逻辑 isOutputVideo 判定把 MOV 一律归为"写回自身"，
 * applyRecoveryToOutputNode 用新产出覆盖 imagePreview → 中间节点原视频丢失、与下游节点重复。
 *
 * 修复：shouldWriteRecoveryIntoRunNode —— MOV 已有成片（imagePreview 为视频 URL）时
 * 返回 false，恢复改走 buildRecoveryGraphUpdates 新建下游节点（MOV 原视频保留）；
 * 空 MOV 占位 / OUTPUT 视频节点维持写回自身。
 *
 * 覆盖：
 * 1) shouldWriteRecoveryIntoRunNode 判定矩阵
 * 2) 端到端：MOV 有视频 + 恢复 → 新建下游节点 + 运行节点 imagePreview 不变
 * 3) 空 MOV + 恢复 → applyRecoveryToOutputNode 写回自身
 *
 * 运行：npx tsx scripts/mov-recovery-keep-original-test.ts
 */
import { NodeType } from '../types.ts';
import {
  shouldWriteRecoveryIntoRunNode,
  buildRecoveryGraphUpdates,
  applyRecoveryToOutputNode,
} from '../utils/runRecovery.ts';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  [OK] ${label}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${label}`);
  }
}

const ORIGINAL_VIDEO =
  'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/b7982801-bc69-4359-936c-91e937df8f69.mp4';
const NEW_VIDEO =
  'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/83a66705-033b-4c6c-bf6a-c7c5422cb276.mp4';

function makeNode(over: Record<string, unknown> = {}) {
  const { type, ...dataOver } = over as { type?: string } & Record<string, unknown>;
  return {
    id: 'mov1',
    type: type || NodeType.MOV,
    position: { x: 0, y: 0 },
    data: {
      selectedModel: 'seedance2.5',
      imagePreview: ORIGINAL_VIDEO,
      imageName: 'ep003_seq001_sc024.mov',
      status: 'running',
      progress: 40,
      taskId: '1991333',
      ...dataOver,
    },
  } as never;
}

console.log('\n=== 场景 1：shouldWriteRecoveryIntoRunNode 判定矩阵 ===\n');
{
  ok(
    'MOV + imagePreview=视频 .mp4 → false（新建下游，不覆盖）',
    shouldWriteRecoveryIntoRunNode(makeNode() as never) === false
  );
  ok(
    'MOV + imagePreview=视频 .mp4?sign=... → false',
    shouldWriteRecoveryIntoRunNode(
      makeNode({ imagePreview: ORIGINAL_VIDEO + '?sign=abc' }) as never
    ) === false
  );
  ok(
    'MOV + imagePreview 为空 → true（空占位，写回自身）',
    shouldWriteRecoveryIntoRunNode(makeNode({ imagePreview: '' }) as never) === true
  );
  ok(
    'MOV + imagePreview 为图片 .png → true（占位图，写回自身）',
    shouldWriteRecoveryIntoRunNode(
      makeNode({ imagePreview: 'https://example.com/a.png' }) as never
    ) === true
  );
  ok(
    'OUTPUT + imageName=a.mov → true（写回自身）',
    shouldWriteRecoveryIntoRunNode(
      makeNode({ type: NodeType.OUTPUT, imagePreview: '', imageName: 'a.mov' }) as never
    ) === true
  );
  ok(
    'OUTPUT + imageName=a.png → false',
    shouldWriteRecoveryIntoRunNode(
      makeNode({ type: NodeType.OUTPUT, imagePreview: '', imageName: 'a.png' }) as never
    ) === false
  );
  ok(
    'PROCESSOR → false（本就走新建下游）',
    shouldWriteRecoveryIntoRunNode(makeNode({ type: NodeType.PROCESSOR }) as never) === false
  );
}

console.log('\n=== 场景 2：MOV 有视频 + 恢复 → 新建下游、原视频保留 ===\n');
{
  const runNode = makeNode() as never;
  const { nodes, edges } = buildRecoveryGraphUpdates({
    nodes: [runNode],
    edges: [],
    runNodeId: 'mov1',
    mediaUrls: [NEW_VIDEO],
    taskIdJoined: '1991333',
    createNodeId: () => 'recovered_mov_1',
  }) as { nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>; edges: Array<{ source: string; target: string }> };

  const runAfter = nodes.find((n) => n.id === 'mov1');
  const spawned = nodes.find((n) => n.id === 'recovered_mov_1');
  ok('生成 2 个节点（运行节点 + 新下游）', nodes.length === 2);
  ok('新下游节点是 MOV', spawned?.type === NodeType.MOV);
  ok('新下游节点 imagePreview = 新产出', spawned?.data?.imagePreview === NEW_VIDEO);
  ok(
    '运行节点 imagePreview 保持原视频（核心防回归）',
    runAfter?.data?.imagePreview === ORIGINAL_VIDEO
  );
  ok(
    '运行节点 gp.outputUrl 更新为新产出（与正常完成路径一致）',
    (runAfter?.data?.generationParams as { outputUrl?: string } | undefined)?.outputUrl === NEW_VIDEO
  );
  ok('新边挂在运行节点下游', edges.some((e) => e.source === 'mov1' && e.target === 'recovered_mov_1'));
}

console.log('\n=== 场景 3：空 MOV + 恢复 → 写回自身（行为不变） ===\n');
{
  const emptyMov = makeNode({ imagePreview: '' }) as never;
  const out = applyRecoveryToOutputNode([emptyMov], 'mov1', [NEW_VIDEO], '1991333') as Array<{
    data: { imagePreview?: string };
  }>;
  ok('空 MOV imagePreview 写回新产出', out[0].data.imagePreview === NEW_VIDEO);
}

console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===\n`);
if (failed > 0) process.exit(1);

import { describe, expect, it } from 'vitest';
import type { Node as RFNode } from 'reactflow';
import { NodeType } from '../../../types';
import {
  normalizeNodeRunStateForPersist,
  nodeHasPendingRunRecovery,
  nodeNeedsAiTopTaskRecovery,
  prepareNodesAfterWorkspaceLoad,
  shouldTriggerAiTopRunRecovery,
  mergeRunPersistPatchesIntoNodes,
  mergeRecoveryGenerationParamsFromRunNode,
  mergeRunRecoveryFieldsFromLocalSnapshot,
  reconcileSourceRunStateAfterOutputNodesRemoved,
  clearStaleRunTaskBeforeFreshRun,
  restoreUploadPhaseRunningUi,
} from '../../../utils/runRecovery';

function simNode(partial: {
  id: string;
  type?: string;
  data: Record<string, unknown>;
}): RFNode {
  return {
    id: partial.id,
    type: partial.type || NodeType.PROCESSOR,
    position: { x: 0, y: 0 },
    data: partial.data,
  } as RFNode;
}

describe('runRecovery', () => {
  it('normalizeNodeRunStateForPersist clears running for save', () => {
    const n = simNode({
      id: 'a',
      data: { status: 'running', progress: 42, taskId: 't-1' },
    });
    const out = normalizeNodeRunStateForPersist(n);
    expect(out.data.status).toBe('idle');
    expect(out.data.progress).toBe(0);
    expect(out.data.runRecoveryPending).toBe(true);
    expect(out.data.runRecoveryProgress).toBe(42);
  });

  it('nodeHasPendingRunRecovery requires taskId', () => {
    const n = simNode({
      id: 'a',
      data: { runRecoveryPending: true, taskId: 'task-abc' },
    });
    expect(nodeHasPendingRunRecovery(n)).toBe(true);
  });

  it('prepareNodesAfterWorkspaceLoad restores running for pending taskId recovery', () => {
    const nodes = [
      simNode({
        id: 'run-1',
        data: {
          status: 'idle',
          progress: 0,
          taskId: 'task-abc',
          selectedModel: 'seedance2.0 (高质量版)',
        },
      }),
    ];
    expect(nodeNeedsAiTopTaskRecovery(nodes[0], nodes, [])).toBe(true);
    const { nodes: prepared, changed } = prepareNodesAfterWorkspaceLoad(nodes, []);
    expect(changed).toBe(true);
    expect(prepared[0].data.status).toBe('running');
    expect(prepared[0].data.progress).toBeGreaterThanOrEqual(5);
    expect(prepared[0].data.runRecoveryPending).toBe(true);
  });

  it('prepareNodesAfterWorkspaceLoad restores from runRecoveryPending snapshot', () => {
    const nodes = [
      simNode({
        id: 'run-3',
        data: {
          status: 'idle',
          progress: 0,
          taskId: 'task-xyz',
          runRecoveryPending: true,
          runRecoveryProgress: 37,
        },
      }),
    ];
    const { nodes: prepared } = prepareNodesAfterWorkspaceLoad(nodes, []);
    expect(prepared[0].data.status).toBe('running');
    expect(prepared[0].data.progress).toBe(37);
  });

  it('prepareNodesAfterWorkspaceLoad reconciles pending source to completed when downstream OUTPUT already has result', () => {
    // 刷新中断发生在 spawn 之后、源节点落 completed 之前：下游 OUTPUT 已持成片，
    // 源节点仍带 runRecoveryPending + 小进度。应直接收尾为 completed，避免卡进度。
    const source = simNode({
      id: 'run-src',
      data: {
        status: 'idle',
        progress: 0,
        taskId: 'task-stuck',
        runRecoveryPending: true,
        runRecoveryProgress: 6,
        selectedModel: 'nano banana 2',
      },
    });
    const output = simNode({
      id: 'out-1',
      type: NodeType.OUTPUT,
      data: {
        status: 'idle',
        taskId: 'task-stuck',
        imagePreview: 'https://cdn.example.com/lion.png',
      },
    });
    const edges = [{ source: 'run-src', target: 'out-1' } as never];
    const { nodes: prepared, changed } = prepareNodesAfterWorkspaceLoad(
      [source, output],
      edges
    );
    expect(changed).toBe(true);
    const srcAfter = prepared.find((n) => n.id === 'run-src')!;
    expect(srcAfter.data.status).toBe('completed');
    expect(srcAfter.data.progress).toBe(100);
    expect(srcAfter.data.runRecoveryPending).toBeUndefined();
    // 不触发重复恢复轮询
    expect(nodeNeedsAiTopTaskRecovery(srcAfter, prepared, edges)).toBe(false);
  });

  it('prepareNodesAfterWorkspaceLoad restores running when downstream has no output yet', () => {
    const source = simNode({
      id: 'run-src2',
      data: {
        status: 'idle',
        progress: 0,
        taskId: 'task-pending',
        runRecoveryPending: true,
        runRecoveryProgress: 6,
        selectedModel: 'nano banana 2',
      },
    });
    const { nodes: prepared } = prepareNodesAfterWorkspaceLoad([source], []);
    const srcAfter = prepared.find((n) => n.id === 'run-src2')!;
    expect(srcAfter.data.status).toBe('running');
    expect(srcAfter.data.progress).toBe(6);
    expect(srcAfter.data.runRecoveryPending).toBe(true);
  });

  it('prepareNodesAfterWorkspaceLoad reconciles to completed even when source already has generatedThumbnails', () => {
    // 刷新发生在 spawn 写 thumbnails 之后、源节点 status 落 completed 之前：
    // 若用 nodeHasRecoveredMediaOutput 阻断 reconcile，会卡在 running 6% 且 recovery 不触发。
    const source = simNode({
      id: 'run-src3',
      data: {
        status: 'idle',
        progress: 0,
        taskId: 'task-thumb-stuck',
        runRecoveryPending: true,
        runRecoveryProgress: 6,
        selectedModel: 'seedance2.0 (高质量版)',
        generatedThumbnails: [
          {
            id: 'out-x',
            url: 'https://cdn.example.com/result.mp4',
            type: 'video',
            generationParams: { taskId: 'task-thumb-stuck' },
          },
        ],
      },
    });
    const output = simNode({
      id: 'out-x',
      type: NodeType.OUTPUT,
      data: {
        status: 'idle',
        taskId: 'task-thumb-stuck',
        imagePreview: 'https://cdn.example.com/result.mp4',
      },
    });
    const edges = [{ source: 'run-src3', target: 'out-x' } as never];
    const { nodes: prepared } = prepareNodesAfterWorkspaceLoad([source, output], edges);
    const srcAfter = prepared.find((n) => n.id === 'run-src3')!;
    expect(srcAfter.data.status).toBe('completed');
    expect(srcAfter.data.progress).toBe(100);
    expect(srcAfter.data.runRecoveryPending).toBeUndefined();
    expect(nodeNeedsAiTopTaskRecovery(srcAfter, prepared, edges)).toBe(false);
  });

  it('prepareNodesAfterWorkspaceLoad clears running without taskId', () => {
    const nodes = [
      simNode({
        id: 'run-2',
        data: { status: 'running', progress: 30 },
      }),
    ];
    const { nodes: prepared } = prepareNodesAfterWorkspaceLoad(nodes, []);
    expect(prepared[0].data.status).toBe('idle');
    expect(prepared[0].data.progress).toBe(0);
  });

  it('normalizeNodeRunStateForPersist preserves runRecoveryPending before taskId exists', () => {
    const n = simNode({
      id: 'pre-task',
      data: {
        status: 'running',
        progress: 18,
        runRecoveryPending: true,
        selectedModel: '可灵3.0 Omni',
      },
    });
    const out = normalizeNodeRunStateForPersist(n);
    expect(out.data.status).toBe('idle');
    expect(out.data.runRecoveryPending).toBe(true);
    expect(out.data.runRecoveryProgress).toBe(18);
    expect(out.data.taskId).toBeUndefined();
  });

  it('prepareNodesAfterWorkspaceLoad restores running UI when runRecoveryPending has no taskId yet (Omni upload)', () => {
    const n = simNode({
      id: 'omni-upload',
      data: {
        status: 'idle',
        progress: 0,
        runRecoveryPending: true,
        runRecoveryProgress: 18,
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'instruction',
      },
    });
    const { nodes: prepared, changed } = prepareNodesAfterWorkspaceLoad([n], []);
    expect(changed).toBe(true);
    expect(prepared[0].data.status).toBe('running');
    expect(prepared[0].data.progress).toBe(18);
    expect(prepared[0].data.runRecoveryPending).toBe(true);
    expect(shouldTriggerAiTopRunRecovery(prepared[0], prepared, [])).toBe(false);
  });

  it('restoreUploadPhaseRunningUi for Omni video tab upload-phase refresh', () => {
    const patch = restoreUploadPhaseRunningUi({
      status: 'idle',
      progress: 0,
      runRecoveryProgress: 42,
      runRecoveryPending: true,
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'video',
    } as never);
    expect(patch.status).toBe('running');
    expect(patch.progress).toBe(42);
    expect(patch.runRecoveryPending).toBe(true);
  });

  it('mergeRunRecoveryFieldsFromLocalSnapshot sets runRecoveryPending from local taskId only', () => {
    const server = [
      simNode({
        id: 'n1',
        data: { status: 'idle', progress: 0, selectedModel: 'Nano Banana 2.0' },
      }),
    ];
    const local = JSON.stringify({
      nodes: [
        {
          id: 'n1',
          data: {
            taskId: 'task-xyz',
            progress: 35,
            generationParams: { taskId: 'task-xyz', model: 'Nano Banana 2.0' },
          },
        },
      ],
    });
    const merged = mergeRunRecoveryFieldsFromLocalSnapshot(server, local);
    expect(merged[0].data.taskId).toBe('task-xyz');
    expect(merged[0].data.runRecoveryPending).toBe(true);
    expect(merged[0].data.runRecoveryProgress).toBe(35);
  });

  it('prepareNodesAfterWorkspaceLoad still restores running when old Error Result has different taskId', () => {
    const source = simNode({
      id: 'node_7',
      data: {
        status: 'idle',
        progress: 0,
        taskId: '1462000',
        runRecoveryPending: true,
        runRecoveryProgress: 42,
        selectedModel: 'Nano Banana 2.0',
      },
    });
    const staleError = simNode({
      id: 'node_9',
      type: NodeType.OUTPUT,
      data: {
        label: 'Error Result Node',
        status: 'error',
        errorMessage: '**Task ID：** 1461260',
        imageName: 'Error_old.txt',
      },
    });
    const edges = [{ id: 'enode_7-node_9-error-1', source: 'node_7', target: 'node_9' } as never];
    const { nodes: prepared } = prepareNodesAfterWorkspaceLoad([source, staleError], edges);
    const srcAfter = prepared.find((n) => n.id === 'node_7')!;
    expect(srcAfter.data.status).toBe('running');
    expect(srcAfter.data.progress).toBe(42);
    expect(srcAfter.data.runRecoveryPending).toBe(true);
    expect(shouldTriggerAiTopRunRecovery(srcAfter, prepared, edges)).toBe(true);
  });

  it('prepareNodesAfterWorkspaceLoad clears stuck running when downstream Error Result exists', () => {
    const source = simNode({
      id: 'node_7',
      data: {
        status: 'running',
        progress: 5,
        taskId: '1461260',
        runRecoveryPending: true,
        selectedModel: 'Nano Banana 2.0',
      },
    });
    const errorOut = simNode({
      id: 'node_9',
      type: NodeType.OUTPUT,
      data: {
        label: 'Error Result Node',
        status: 'error',
        errorMessage:
          '**❌ Nano Banana 任务失败**\n\n**Task ID：** 1461260\n**域账号：** liangyu',
        imageName: 'Error_1782871530985.txt',
      },
    });
    const edges = [{ id: 'enode_7-node_9-error-1', source: 'node_7', target: 'node_9' } as never];
    const { nodes: prepared, changed } = prepareNodesAfterWorkspaceLoad(
      [source, errorOut],
      edges
    );
    expect(changed).toBe(true);
    const srcAfter = prepared.find((n) => n.id === 'node_7')!;
    expect(srcAfter.data.status).toBe('idle');
    expect(srcAfter.data.progress).toBe(0);
    expect(srcAfter.data.runRecoveryPending).toBeUndefined();
    expect(shouldTriggerAiTopRunRecovery(srcAfter, prepared, edges)).toBe(false);
  });

  it('shouldTriggerAiTopRunRecovery true for idle + runRecoveryPending + taskId', () => {
    const n = simNode({
      id: 'run-idle',
      data: {
        status: 'idle',
        runRecoveryPending: true,
        taskId: 'task-refresh',
      },
    });
    expect(shouldTriggerAiTopRunRecovery(n, [n], [])).toBe(true);
  });

  it('mergeRunPersistPatchesIntoNodes merges taskId before normalize persist', () => {
    const nodes = [
      simNode({
        id: 'n1',
        data: { status: 'running', progress: 12, selectedModel: 'seedance2.0 (高质量版)' },
      }),
    ];
    const patches = new Map<string, Record<string, unknown>>([
      [
        'n1',
        {
          taskId: 'task-sync',
          runRecoveryPending: true,
          runRecoveryProgress: 12,
        },
      ],
    ]);
    const merged = mergeRunPersistPatchesIntoNodes(nodes, patches as never);
    const snap = normalizeNodeRunStateForPersist(merged[0]);
    expect(snap.data.taskId).toBe('task-sync');
    expect(snap.data.runRecoveryPending).toBe(true);
    expect(snap.data.runRecoveryProgress).toBe(12);
  });

  it('mergeRunRecoveryFieldsFromLocalSnapshot fills missing server taskId from local snapshot', () => {
    const server = simNode({
      id: 'node_2',
      data: {
        status: 'idle',
        progress: 0,
        selectedModel: '可灵3.0 Omni',
      },
    });
    const localSnapshot = JSON.stringify({
      nodes: [
        {
          id: 'node_2',
          data: {
            taskId: '1462000',
            runRecoveryPending: true,
            runRecoveryProgress: 42,
            generationParams: { taskId: '1462000', model: '可灵3.0 Omni' },
          },
        },
      ],
    });
    const merged = mergeRunRecoveryFieldsFromLocalSnapshot([server], localSnapshot);
    expect(merged[0].data.taskId).toBe('1462000');
    expect(merged[0].data.runRecoveryPending).toBe(true);
    expect(merged[0].data.runRecoveryProgress).toBe(42);
    const { nodes: prepared } = prepareNodesAfterWorkspaceLoad(merged, []);
    expect(prepared[0].data.status).toBe('running');
    expect(prepared[0].data.progress).toBe(42);
  });

  it('mergeRecoveryGenerationParamsFromRunNode prefers panel refs over stale gp for seedance reference', () => {
    const panelA = 'https://cos.example/new-main.png';
    const panelB = 'https://cos.example/new-ref3.png';
    const staleA = 'https://cos.example/old-fox.png';
    const staleB = 'https://cos.example/old-cat.png';
    const runNode = simNode({
      id: 'src',
      data: {
        selectedModel: 'seedance2.0 (急速版)',
        seedanceGenerationMode: 'reference',
        prompt: '@主图参考@图片3的姿势运动起来',
        referenceImages: [panelA, panelB],
        referenceImageLabels: ['主图', '图片3'],
        generationParams: {
          seedanceGenerationMode: 'reference',
          referenceImages: [staleA, staleB],
          referenceImageLabels: ['', '图片2', '图片3'],
        },
      },
    });
    const gp = mergeRecoveryGenerationParamsFromRunNode(runNode, {
      taskId: '1486254',
      model: 'seedance2.0 (急速版)',
    });
    expect(gp.seedanceGenerationMode).toBe('reference');
    expect(gp.referenceImages).toEqual([panelA, panelB]);
    expect(gp.referenceImageLabels).toEqual(['主图', '图片3']);
  });

  it('mergeRecoveryGenerationParamsFromRunNode falls back to gp when panel has no refs', () => {
    const runNode = simNode({
      id: 'src',
      data: {
        selectedModel: 'seedance2.0 (急速版)',
        seedanceGenerationMode: 'reference',
        prompt: '@主图出现在@图片3中',
        generationParams: {
          referenceImages: ['https://cos.example/a.jpg', 'https://cos.example/b.jpg'],
          referenceImageLabels: ['主图', '图片3'],
        },
      },
    });
    const gp = mergeRecoveryGenerationParamsFromRunNode(runNode, {
      taskId: '1453770',
      model: 'seedance2.0 (急速版)',
      generatedAt: new Date().toISOString(),
      prompt: '@主图出现在@图片3中',
    });
    expect(gp.seedanceGenerationMode).toBe('reference');
    expect(gp.referenceImages).toEqual([
      'https://cos.example/a.jpg',
      'https://cos.example/b.jpg',
    ]);
    expect(gp.referenceImageLabels).toEqual(['主图', '图片3']);
  });

  it('mergeRecoveryGenerationParamsFromRunNode enriches 可灵3.0 Omni video tab from panel', () => {
    const mainImg = 'https://cos.example.com/main-cat.png';
    const inputVideo = 'https://cos.example.com/input-ref.mp4';
    const outputVideo = 'https://cos.example.com/output.mp4';
    const runNode = simNode({
      id: 'omni-run',
      data: {
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'video',
        quality: '高质量',
        duration: '5s',
        aspectRatio: '16:9',
        imagePreview: mainImg,
        klingOmniVideoUrl: inputVideo,
        klingOmniVideoPrompt: '把@主图中的角色按照@视频1中的角色运动起来',
        referenceMovs: [{ url: inputVideo }],
        generationParams: {
          taskId: '1460856',
          model: '可灵3.0 Omni',
          klingOmniTab: 'video',
          prompt: '把@主图中的角色按照@视频1中的角色运动起来',
        },
      },
    });
    const gp = mergeRecoveryGenerationParamsFromRunNode(runNode, {
      taskId: '1460856',
      model: '可灵3.0 Omni',
      outputUrl: outputVideo,
    });
    expect(gp.referenceImages).toEqual([mainImg]);
    expect(gp.referenceMovs?.[0]?.url).toBe(inputVideo);
    expect(gp.klingOmniVideoUrl).toBe(inputVideo);
    expect(gp.outputUrl).toBe(outputVideo);
    expect(gp.quality).toBe('高质量');
    expect(gp.referenceMovs?.some((m) => m.url === outputVideo)).toBe(false);
  });

  it('mergeRecoveryGenerationParamsFromRunNode does not copy stale panel referenceMovs', () => {
    const runNode = simNode({
      id: 'src',
      data: {
        selectedModel: 'seedance2.0 (急速版)',
        seedanceGenerationMode: 'reference',
        referenceMovs: [{ url: 'https://cos.example/stale-panel.mp4' }],
        generationParams: {
          seedanceGenerationMode: 'reference',
          referenceImages: ['https://cos.example/a.jpg'],
        },
      },
    });
    const gp = mergeRecoveryGenerationParamsFromRunNode(runNode, {
      taskId: '1454330',
      model: 'seedance2.0 (急速版)',
    });
    expect(gp.referenceMovs).toBeUndefined();
    expect(gp.referenceImages).toEqual(['https://cos.example/a.jpg']);
  });

  it('reconcileSourceRunStateAfterOutputNodesRemoved clears taskId when last MOV deleted', () => {
    const src = simNode({
      id: 'src',
      type: NodeType.PROCESSOR,
      data: {
        status: 'completed',
        taskId: '1454330',
        selectedModel: 'seedance2.0 (急速版)',
        generationParams: { taskId: '1454330', outputUrl: 'https://cos.example/out.mp4' },
      },
    });
    const mov = simNode({
      id: 'mov1',
      type: NodeType.MOV,
      data: { taskId: '1454330' },
    });
    const edges = [{ id: 'e1', source: 'src', target: 'mov1' }];
    const { nodes, changed } = reconcileSourceRunStateAfterOutputNodesRemoved(
      [src, mov],
      edges,
      ['mov1']
    );
    expect(changed).toBe(true);
    const nextSrc = nodes.find((n) => n.id === 'src')!;
    expect(nextSrc.data.taskId).toBeUndefined();
    expect(nextSrc.data.generationParams?.taskId).toBeUndefined();
    expect(nextSrc.data.generationParams?.outputUrl).toBeUndefined();
    expect(nextSrc.data.runRecoveryPending).toBeUndefined();
  });

  it('reconcileSourceRunStateAfterOutputNodesRemoved keeps taskId when sibling output remains', () => {
    const src = simNode({
      id: 'src',
      type: NodeType.PROCESSOR,
      data: {
        status: 'completed',
        taskId: '1454330',
        generationParams: { taskId: '1454330' },
      },
    });
    const mov1 = simNode({ id: 'mov1', type: NodeType.MOV, data: { taskId: '1454330' } });
    const mov2 = simNode({ id: 'mov2', type: NodeType.MOV, data: { taskId: '1454330' } });
    const edges = [
      { id: 'e1', source: 'src', target: 'mov1' },
      { id: 'e2', source: 'src', target: 'mov2' },
    ];
    const { nodes, changed } = reconcileSourceRunStateAfterOutputNodesRemoved(
      [src, mov1, mov2],
      edges,
      ['mov1']
    );
    expect(changed).toBe(false);
    expect(nodes.find((n) => n.id === 'src')!.data.taskId).toBe('1454330');
  });

  it('prepareNodesAfterWorkspaceLoad repairs stale seedance gp from panel on load', () => {
    const panelA = 'https://cos.example/c3ca-main.png';
    const panelB = 'https://cos.example/1f70-ref3.png';
    const staleA = 'https://cos.example/bdb523-fox.png';
    const staleB = 'https://cos.example/eddd-cat.png';
    const run = simNode({
      id: 'out-run',
      type: NodeType.OUTPUT,
      data: {
        selectedModel: 'seedance2.0 (急速版)',
        seedanceGenerationMode: 'reference',
        status: 'completed',
        taskId: '1486254',
        referenceImages: [panelA, panelB],
        referenceImageLabels: ['主图', '图片3'],
        generationParams: {
          model: 'seedance2.0 (急速版)',
          seedanceGenerationMode: 'reference',
          taskId: '1486254',
          referenceImages: [staleA, staleB],
          referenceImageLabels: ['', '图片2', '图片3'],
        },
        generatedThumbnails: [
          {
            id: 'mov1',
            url: 'https://cos.example/video.mp4',
            name: 'Video.mov',
            type: 'video',
            nodeId: 'mov1',
            generationParams: {
              model: 'seedance2.0 (急速版)',
              seedanceGenerationMode: 'reference',
              referenceImages: [staleA, staleB],
              referenceImageLabels: ['', '图片2', '图片3'],
            },
          },
        ],
      },
    });
    const mov = simNode({
      id: 'mov1',
      type: NodeType.MOV,
      data: {
        selectedModel: 'seedance2.0 (急速版)',
        taskId: '1486254',
        generationParams: {
          model: 'seedance2.0 (急速版)',
          seedanceGenerationMode: 'reference',
          referenceImages: [staleA, staleB],
          referenceImageLabels: ['', '图片2', '图片3'],
        },
      },
    });
    const edges = [{ id: 'e1', source: 'out-run', target: 'mov1' }];
    const { nodes, changed } = prepareNodesAfterWorkspaceLoad([run, mov], edges);
    expect(changed).toBe(true);
    const repairedRun = nodes.find((n) => n.id === 'out-run')!;
    expect(repairedRun.data.generationParams?.referenceImages).toEqual([panelA, panelB]);
    expect(repairedRun.data.generationParams?.referenceImageLabels).toEqual(['主图', '图片3']);
    expect(repairedRun.data.panelMainSlotVisible).toBe(false);
    expect(repairedRun.data.generatedThumbnails?.[0].generationParams?.referenceImages).toEqual([
      panelA,
      panelB,
    ]);
    const repairedMov = nodes.find((n) => n.id === 'mov1')!;
    expect(repairedMov.data.generationParams?.referenceImages).toEqual([panelA, panelB]);
  });

  it('clearStaleRunTaskBeforeFreshRun strips taskId and recovery hints', () => {
    const patch = clearStaleRunTaskBeforeFreshRun({
      status: 'completed',
      taskId: '999',
      runRecoveryPending: true,
      runRecoveryProgress: 50,
      generationParams: { taskId: '999', outputUrl: 'https://x', quality: '高' },
    } as any);
    expect(patch.taskId).toBeUndefined();
    expect(patch.runRecoveryPending).toBeUndefined();
    expect(patch.generationParams?.taskId).toBeUndefined();
    expect(patch.generationParams?.outputUrl).toBeUndefined();
    expect(patch.generationParams?.quality).toBe('高');
  });

  it('clearStaleRunTaskBeforeFreshRun stops recovery re-trigger after fail (没完没了.json)', () => {
    const n = simNode({
      id: 'img2-stuck',
      data: {
        selectedModel: 'image 2',
        status: 'idle',
        progress: 0,
        taskId: '1532775',
        runRecoveryPending: undefined,
        generationParams: { taskId: '1532775', model: 'image 2' },
        errorMessage: '恢复生成结果失败：任务状态查询连续失败（Task ID: 1532775）',
      },
    });
    expect(shouldTriggerAiTopRunRecovery(n, [n], [])).toBe(true);
    const cleared = {
      ...n,
      data: { ...n.data, ...clearStaleRunTaskBeforeFreshRun(n.data as never) },
    };
    expect(shouldTriggerAiTopRunRecovery(cleared, [cleared], [])).toBe(false);
    expect(cleared.data.taskId).toBeUndefined();
  });
});

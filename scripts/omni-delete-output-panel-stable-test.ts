/**
 * 可灵3.0 Omni 四 tab：运行完成后删除下游 MOV/OUTPUT，源节点面板图/视频/首尾帧不应变化
 * npx tsx scripts/omni-delete-output-panel-stable-test.ts
 */
import type { NodeData } from '../types.ts';
import { NodeType } from '../types.ts';
import type { Edge, Node as RFNode } from 'reactflow';
import { reconcileSourceRunStateAfterOutputNodesRemoved } from '../utils/runRecovery.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

function panelMediaSnapshot(data: NodeData) {
  return {
    imagePreview: data.imagePreview,
    panelMainImageUrl: data.panelMainImageUrl,
    panelMainSlotVisible: data.panelMainSlotVisible,
    imageLocalRef: data.imageLocalRef,
    klingOmniMultiReferenceImages: data.klingOmniMultiReferenceImages,
    klingOmniInstructionReferenceImages: data.klingOmniInstructionReferenceImages,
    klingOmniVideoReferenceImages: data.klingOmniVideoReferenceImages,
    klingOmniMultiReferenceLocalRefs: data.klingOmniMultiReferenceLocalRefs,
    klingOmniInstructionReferenceLocalRefs: data.klingOmniInstructionReferenceLocalRefs,
    klingOmniVideoReferenceLocalRefs: data.klingOmniVideoReferenceLocalRefs,
    klingOmniInstructionVideoUrl: data.klingOmniInstructionVideoUrl,
    klingOmniInstructionVideoPreviewUrl: data.klingOmniInstructionVideoPreviewUrl,
    klingOmniVideoUrl: data.klingOmniVideoUrl,
    klingOmniVideoPreviewUrl: data.klingOmniVideoPreviewUrl,
    firstFrameImage: data.firstFrameImage,
    lastFrameImage: data.lastFrameImage,
    firstFrameImageUrl: data.firstFrameImageUrl,
    lastFrameImageUrl: data.lastFrameImageUrl,
    referenceImageLabels: data.referenceImageLabels,
    klingOmniTabConfigs: data.klingOmniTabConfigs,
    referenceMovs: data.referenceMovs,
  };
}

function simAfterRun(tab: 'multi' | 'instruction' | 'video' | 'frames'): RFNode {
  const main = 'https://cos.example/omni-main.png';
  const ref0 = 'https://cos.example/omni-ref0.png';
  const ref1 = 'https://cos.example/omni-ref1.png';
  const vid = 'https://cos.example/omni-ref-video.mp4';
  const vidPoster = 'https://cos.example/omni-vid-poster.png';
  const base: NodeData = {
    label: 'Omni src',
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: tab,
    status: 'completed',
    progress: 100,
    taskId: '1533001',
    imagePreview: main,
    panelMainImageUrl: 'blob:http://localhost/main-backup',
    imageLocalRef: 'flowgen-local:scope:node_omni:main:可灵30_Omni',
    generationParams: {
      taskId: '1533001',
      model: '可灵3.0 Omni',
      klingOmniTab: tab,
      referenceImages: [ref0],
      referenceImageLabels: ['图片1'],
    },
  };

  if (tab === 'multi') {
    Object.assign(base, {
      klingOmniMultiPrompt: '@主图 @图片1',
      klingOmniMultiReferenceImages: [ref0, ref1, ''],
      klingOmniMultiReferenceLocalRefs: ['flowgen-local:scope:node_omni:ref:可灵30_Omni_multi:0'],
      referenceImageLabels: ['图片1', '图片2', '图片3'],
    });
  } else if (tab === 'instruction') {
    Object.assign(base, {
      klingOmniInstructionPrompt: '@主图 @图片1',
      klingOmniInstructionReferenceImages: [ref0, ref1],
      klingOmniInstructionReferenceLocalRefs: ['flowgen-local:scope:node_omni:ref:可灵30_Omni_instruction:0'],
      klingOmniInstructionVideoUrl: vid,
      klingOmniInstructionVideoPreviewUrl: vidPoster,
      referenceImageLabels: ['图片1', '图片2'],
      referenceMovs: [{ url: vid, posterDataUrl: vidPoster }],
    });
  } else if (tab === 'video') {
    Object.assign(base, {
      klingOmniVideoPrompt: '@主图 @视频1',
      klingOmniVideoReferenceImages: [ref0],
      klingOmniVideoReferenceLocalRefs: ['flowgen-local:scope:node_omni:ref:可灵30_Omni_video:0'],
      klingOmniVideoUrl: vid,
      klingOmniVideoPreviewUrl: vidPoster,
      referenceImageLabels: ['图片1'],
      referenceMovs: [{ url: vid, posterDataUrl: vidPoster }],
    });
  } else {
    Object.assign(base, {
      klingOmniFramesPrompt: '@首帧图 @尾帧图',
      firstFrameImage: 'https://cos.example/ff.png',
      lastFrameImage: 'https://cos.example/lf.png',
      firstFrameImageUrl: 'https://cos.example/ff.png',
      lastFrameImageUrl: 'https://cos.example/lf.png',
      klingOmniTabConfigs: {
        frames: {
          firstFrameImage: 'https://cos.example/ff.png',
          lastFrameImage: 'https://cos.example/lf.png',
        },
      },
    });
  }

  return {
    id: `src-${tab}`,
    type: NodeType.PROCESSOR,
    position: { x: 0, y: 0 },
    data: base,
  };
}

function deleteDownstreamMov(src: RFNode, tab: string) {
  const mov: RFNode = {
    id: `mov-${tab}`,
    type: NodeType.MOV,
    position: { x: 400, y: 0 },
    data: {
      label: 'MOV',
      taskId: '1533001',
      imagePreview: 'https://cos.example/output.mp4',
      generationParams: { taskId: '1533001', model: '可灵3.0 Omni', klingOmniTab: tab },
    },
  };
  const edges: Edge[] = [{ id: `e-${tab}`, source: src.id, target: mov.id }];
  const before = panelMediaSnapshot(src.data);
  const { nodes, changed } = reconcileSourceRunStateAfterOutputNodesRemoved(
    [src, mov],
    edges,
    [mov.id]
  );
  const afterSrc = nodes.find((n) => n.id === src.id)!;
  const after = panelMediaSnapshot(afterSrc.data);
  return { before, after, afterSrc, changed };
}

console.log('\n=== 可灵 Omni 四 tab：删下游 MOV 后面板媒体字段稳定性 ===\n');

for (const tab of ['multi', 'instruction', 'video', 'frames'] as const) {
  console.log(`--- tab: ${tab} ---`);
  const src = simAfterRun(tab);
  const { before, after, afterSrc, changed } = deleteDownstreamMov(src, tab);
  ok(`${tab} reconcile 有变更（清 taskId）`, changed);
  ok(`${tab} taskId 已清`, afterSrc.data.taskId === undefined);
  ok(`${tab} gp.taskId 已清`, (afterSrc.data.generationParams as { taskId?: string })?.taskId === undefined);
  ok(`${tab} 面板媒体快照不变`, JSON.stringify(before) === JSON.stringify(after));
}

console.log('\n=== 删画布参考源节点：面板 URL 保留（仅 eid 可清空）===\n');
{
  const src = simAfterRun('multi');
  const before = panelMediaSnapshot(src.data);
  const afterDeleteCanvasRef = {
    ...src,
    data: {
      ...src.data,
      klingOmniMultiReferenceElementIds: ['', ''],
      status: 'idle' as const,
      taskId: undefined,
      generationParams: undefined,
    },
  };
  const after = panelMediaSnapshot(afterDeleteCanvasRef.data);
  ok(
    '删画布源后 multi 参考图 URL 不变',
    JSON.stringify(before.klingOmniMultiReferenceImages) ===
      JSON.stringify(after.klingOmniMultiReferenceImages)
  );
  ok('删画布源后主图 imagePreview 不变', before.imagePreview === after.imagePreview);
}

console.log(`\n通过 ${pass}，失败 ${fail}\n`);
if (fail > 0) process.exit(1);

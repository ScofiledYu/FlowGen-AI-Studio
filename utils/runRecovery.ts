import type { Edge, Node as RFNode } from 'reactflow';
import { NodeType, type GenerationParams, type NodeData } from '../types';
import {
  parseAiTopTaskIds,
  isVideoModelName,
  extractResourceUrlFromTaskStatus,
  isTerminalTaskSuccess,
} from './aitopTaskRecovery';
import { isAitopCosUrl } from './aitopCosMediaUrl';
import { isLikelyVideoMediaUrl, isVideoPreviewUrl } from './hydratePersistedNodePreviews';

export function normalizeNodeRunStateForPersist<T extends { data?: NodeData }>(node: T): T {
  if (!node.data || node.data.status !== 'running') return node;
  return {
    ...node,
    data: {
      ...node.data,
      status: 'idle',
      progress: 0,
      errorMessage: undefined,
    },
  };
}

function normalizeUrlKey(url?: string): string {
  return url ? url.split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase() : '';
}

export function nodeHasRecoveredMediaOutput(node: RFNode): boolean {
  const data = node.data || {};
  const taskIds = parseAiTopTaskIds(data.taskId || data.generationParams?.taskId);
  const thumbs = data.generatedThumbnails || [];
  for (const t of thumbs) {
    if (!t?.url) continue;
    const thumbTaskIds = parseAiTopTaskIds(t.generationParams?.taskId);
    if (taskIds.length && thumbTaskIds.some((id) => taskIds.includes(id))) return true;
  }
  if (data.status === 'completed') {
    return thumbs.some((t) => t?.url && (t.type === 'video' || t.type === 'image'));
  }
  return false;
}

/** 下游 MOV/OUTPUT 是否已绑定同一批 taskId 且已有成片（避免已完成仍误触发恢复轮询） */
export function nodeHasDownstreamOutputForTaskIds(
  node: RFNode,
  nodes: RFNode[],
  edges: Edge[],
  taskIds: string[]
): boolean {
  if (!taskIds.length) return false;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const queue = edges.filter((e) => e.source === node.id).map((e) => e.target);
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (!n) {
      edges.filter((e) => e.source === id).forEach((e) => queue.push(e.target));
      continue;
    }
    if (n.type === NodeType.MOV || n.type === NodeType.OUTPUT) {
      const preview = String(n.data?.imagePreview || '').trim();
      const childTaskIds = parseAiTopTaskIds(
        n.data?.taskId || n.data?.generationParams?.taskId
      );
      const taskMatch =
        childTaskIds.length > 0 && childTaskIds.some((id) => taskIds.includes(id));
      if (taskMatch && preview) return true;
      const thumbs = n.data?.generatedThumbnails || [];
      if (
        taskMatch &&
        thumbs.some((t) => t?.url && (t.type === 'video' || t.type === 'image'))
      ) {
        return true;
      }
    }
    edges.filter((e) => e.source === id).forEach((e) => queue.push(e.target));
  }
  return false;
}

function isOutputVideoNode(node: RFNode): boolean {
  if (node.type === NodeType.MOV) return true;
  if (node.type !== NodeType.OUTPUT) return false;
  const preview = String(node.data?.imagePreview || '').trim();
  const name = String(node.data?.imageName || '');
  return isVideoPreviewUrl(preview) || /\.(mov|mp4|webm|avi|mkv)(\?|$)/i.test(name);
}

/** 已有成片但 status 仍为 running（刷新中断） */
export function reconcileZombieRunningNode(node: RFNode): Partial<NodeData> | null {
  if (node.data?.status !== 'running') return null;
  const preview = String(node.data?.imagePreview || '').trim();
  const thumbs = node.data.generatedThumbnails || [];
  const hasMediaThumb = thumbs.some((t) => t?.url && (t.type === 'video' || t.type === 'image'));
  const hasMovPreview = node.type === NodeType.MOV && !!preview;
  const hasVideoPreview =
    isOutputVideoNode(node) &&
    !!preview &&
    isLikelyVideoMediaUrl(preview, { nodeType: node.type, imageName: node.data?.imageName });
  if (!hasMediaThumb && !hasMovPreview && !hasVideoPreview) return null;
  return {
    status: 'completed',
    progress: 100,
    errorMessage: undefined,
  };
}

export function nodeNeedsAiTopTaskRecovery(
  node: RFNode,
  nodes: RFNode[] = [],
  edges: Edge[] = []
): boolean {
  const taskIds = parseAiTopTaskIds(node.data?.taskId || node.data?.generationParams?.taskId);
  if (!taskIds.length) return false;
  if (node.data?.status === 'error') return false;
  if (reconcileZombieRunningNode(node)) return false;

  if (isOutputVideoNode(node)) {
    const preview = String(node.data?.imagePreview || '').trim();
    if (node.data?.status === 'completed' && preview && isVideoPreviewUrl(preview)) {
      return false;
    }
    if (node.data?.status === 'running') return true;
    return (
      !preview ||
      !isLikelyVideoMediaUrl(preview, { nodeType: node.type, imageName: node.data?.imageName })
    );
  }

  if (node.type !== NodeType.INPUT && node.type !== NodeType.PROCESSOR) return false;
  if (nodeHasRecoveredMediaOutput(node)) return false;
  if (nodes.length && nodeHasDownstreamOutputForTaskIds(node, nodes, edges, taskIds)) {
    return false;
  }
  if (node.data?.status === 'completed') return false;
  return true;
}

/** 刷新后单次查询：任务若已在 AiTop 侧完成则直接取 URL，避免先闪 running 进度条 */
export async function fetchCompletedAiTopTaskUrls(
  taskIds: string[],
  getTaskStatus: (taskId: string) => Promise<unknown>
): Promise<string[] | null> {
  const urls: string[] = [];
  for (const taskId of taskIds) {
    let statusData: unknown = null;
    try {
      statusData = await getTaskStatus(taskId);
    } catch {
      return null;
    }
    if (!statusData || typeof statusData !== 'object') return null;
    const status = (statusData as { status?: unknown }).status;
    const resourceUrl = extractResourceUrlFromTaskStatus(statusData);
    if (!resourceUrl) return null;
    if (String(status) === 'TRANSFER_SUCCESS') {
      urls.push(resourceUrl);
      continue;
    }
    if (isTerminalTaskSuccess(status, resourceUrl) && isAitopCosUrl(resourceUrl)) {
      urls.push(resourceUrl);
      continue;
    }
    return null;
  }
  return urls.length === taskIds.length ? urls : null;
}

/** 刷新后：为已存在的 MOV/OUTPUT 视频节点写回 imagePreview */
export function applyRecoveryToOutputNode(
  nodes: RFNode[],
  outputNodeId: string,
  mediaUrls: string[],
  taskIdJoined: string
): RFNode[] {
  const mediaUrl = mediaUrls[0];
  if (!mediaUrl) return nodes;
  const generatedAtIso = new Date().toISOString();
  return nodes.map((n) => {
    if (n.id !== outputNodeId) return n;
    const gp = {
      ...(n.data.generationParams || {}),
      generatedAt: generatedAtIso,
      taskId: taskIdJoined,
      model: n.data.generationParams?.model || n.data.selectedModel,
    } as GenerationParams;
    return {
      ...n,
      data: {
        ...n.data,
        imagePreview: mediaUrl,
        status: 'completed',
        progress: 100,
        errorMessage: undefined,
        taskId: taskIdJoined,
        generatedAt: generatedAtIso,
        generationParams: gp,
      },
    };
  });
}

function resolveVideoAnchorNode(
  runNode: RFNode,
  nodes: RFNode[],
  edges: Edge[]
): RFNode {
  const model = runNode.data?.selectedModel || '';
  if (
    !isVideoModelName(model) ||
    !(runNode.type === NodeType.INPUT || runNode.type === NodeType.PROCESSOR)
  ) {
    return runNode;
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const directParents = edges.filter((e) => e.target === runNode.id).map((e) => e.source);
  for (let i = directParents.length - 1; i >= 0; i--) {
    const p = byId.get(directParents[i]);
    if (p && (p.type === NodeType.MOV || p.type === NodeType.OUTPUT)) return p;
  }
  const visited = new Set<string>();
  const queue = [...directParents];
  while (queue.length) {
    const nid = queue.shift()!;
    if (visited.has(nid)) continue;
    visited.add(nid);
    const node = byId.get(nid);
    if (node && (node.type === NodeType.MOV || node.type === NodeType.OUTPUT)) return node;
    edges.filter((e) => e.target === nid).forEach((e) => queue.push(e.source));
  }
  return runNode;
}

export type BuildRecoveryGraphParams = {
  nodes: RFNode[];
  edges: Edge[];
  runNodeId: string;
  mediaUrls: string[];
  taskIdJoined: string;
  createNodeId: () => string;
};

/**
 * 将 AiTop 恢复到的媒体 URL 写入画布：完成态、缩略图、必要时补 MOV/OUTPUT 子节点。
 */
export function buildRecoveryGraphUpdates(params: BuildRecoveryGraphParams): {
  nodes: RFNode[];
  edges: Edge[];
} {
  const { runNodeId, mediaUrls, taskIdJoined, createNodeId } = params;
  if (!mediaUrls.length) return { nodes: params.nodes, edges: params.edges };

  let nodes = [...params.nodes];
  let edges = [...params.edges];
  const runIdx = nodes.findIndex((n) => n.id === runNodeId);
  if (runIdx < 0) return { nodes: params.nodes, edges: params.edges };

  const runNode = nodes[runIdx];
  const model = runNode.data?.selectedModel || '';
  const isVideo = isVideoModelName(model);
  const generatedAtIso = new Date().toISOString();
  const generationParams: GenerationParams = {
    ...(runNode.data.generationParams || {}),
    generatedAt: generatedAtIso,
    taskId: taskIdJoined,
    model,
    prompt: runNode.data.prompt,
    negativePrompt: runNode.data.negativePrompt,
    klingOmniTab: runNode.data.klingOmniTab ?? runNode.data.generationParams?.klingOmniTab,
    firstFrameImage:
      runNode.data.firstFrameImage ?? runNode.data.generationParams?.firstFrameImage,
    lastFrameImage:
      runNode.data.lastFrameImage ?? runNode.data.generationParams?.lastFrameImage,
    firstFrameImageUrl:
      runNode.data.firstFrameImageUrl ?? runNode.data.generationParams?.firstFrameImageUrl,
    lastFrameImageUrl:
      runNode.data.lastFrameImageUrl ?? runNode.data.generationParams?.lastFrameImageUrl,
  };

  const existingThumbUrls = new Set(
    (runNode.data.generatedThumbnails || []).map((t) => normalizeUrlKey(t.url))
  );
  const existingOutputUrls = new Set<string>();
  for (const n of nodes) {
    if (n.type === NodeType.MOV || n.type === NodeType.OUTPUT) {
      const u = n.data?.imagePreview;
      if (u) existingOutputUrls.add(normalizeUrlKey(u));
    }
  }

  const relationAnchor = resolveVideoAnchorNode(runNode, nodes, edges);
  const isInputLike = runNode.type === NodeType.INPUT || runNode.type === NodeType.PROCESSOR;
  const linkSourceId = isVideo && isInputLike ? relationAnchor.id : runNodeId;
  const baseX = relationAnchor.position.x + 350;
  const baseY = relationAnchor.position.y;
  const existingOutgoing = edges.filter((e) => e.source === linkSourceId).length;

  const newNodes: RFNode[] = [];
  const newEdges: Edge[] = [];
  const newThumbs: NonNullable<NodeData['generatedThumbnails']> = [];

  mediaUrls.forEach((mediaUrl, idx) => {
    const urlKey = normalizeUrlKey(mediaUrl);
    if (existingThumbUrls.has(urlKey) && existingOutputUrls.has(urlKey)) {
      return;
    }

    const newNodeId = createNodeId();
    const nodeType = isVideo ? NodeType.MOV : NodeType.OUTPUT;
    const label = isVideo ? 'Output Mov Node' : 'Output Picture Node';
    const imageName = isVideo
      ? `Video_${Math.floor(Math.random() * 1000)}.mov`
      : `Generated_${Math.floor(Math.random() * 1000)}.png`;

    if (!existingOutputUrls.has(urlKey)) {
      const outNode: RFNode = {
        id: newNodeId,
        type: nodeType,
        position: { x: baseX, y: baseY + (existingOutgoing + idx) * 250 },
        data: {
          label,
          imagePreview: mediaUrl,
          imageName,
          selectedModel: isVideo ? model : '可灵 2.5 Turbo',
          status: 'idle',
          generatedAt: generatedAtIso,
          taskId: taskIdJoined,
          generationParams: { ...generationParams },
        },
      };
      newNodes.push(outNode);
      newEdges.push({
        id: `e${linkSourceId}-${newNodeId}-recover-${Date.now()}-${idx}`,
        source: linkSourceId,
        target: newNodeId,
        animated: true,
        style: { stroke: '#6366f1', strokeWidth: 2 },
      });
      existingOutputUrls.add(urlKey);
    }

    if (!existingThumbUrls.has(urlKey)) {
      newThumbs.push({
        id: newNodeId,
        url: mediaUrl,
        type: isVideo ? 'video' : 'image',
        nodeId: newNodeId,
        name: imageName,
        generationParams: { ...generationParams },
      });
      existingThumbUrls.add(urlKey);
    }
  });

  const thumbnailTargetId =
    isVideo && isInputLike
      ? relationAnchor.id
      : isVideo && (runNode.type === NodeType.OUTPUT || runNode.type === NodeType.MOV)
        ? runNodeId
        : isInputLike
          ? runNodeId
          : null;

  nodes = nodes.map((n) => {
    const isRunNode = n.id === runNodeId;
    const isThumbTarget =
      thumbnailTargetId != null && n.id === thumbnailTargetId && newThumbs.length > 0;
    if (!isRunNode && !isThumbTarget) return n;

    let nextData = { ...n.data };
    if (isRunNode) {
      nextData = {
        ...nextData,
        status: 'completed' as const,
        progress: 100,
        errorMessage: undefined,
        taskId: taskIdJoined,
        generatedAt: generatedAtIso,
        generationParams: { ...(nextData.generationParams || {}), ...generationParams },
      };
    }
    // runNodeId 与 thumbnailTargetId 常为同一分镜节点；须合并写入，避免早 return 漏掉 generatedThumbnails
    if (isThumbTarget) {
      const prev = nextData.generatedThumbnails || [];
      nextData = {
        ...nextData,
        generatedThumbnails: [...prev, ...newThumbs],
      };
    }
    return { ...n, data: nextData };
  });

  if (newNodes.length) {
    nodes = [...nodes, ...newNodes];
    edges = [...edges, ...newEdges];
  }

  return { nodes, edges };
}

import type { Edge, Node as RFNode } from 'reactflow';
import { NodeType, isImage2Model, isNanoBanana2Model, type GenerationParams, type NodeData } from '../types';
import {
  parseAiTopTaskIds,
  isVideoModelName,
  extractResourceUrlFromTaskStatus,
  isTerminalTaskSuccess,
  isTerminalTaskFailure,
  sanitizeAiTopTaskFailureMessage,
} from './aitopTaskRecovery';
import { isAitopCosUrl } from './aitopCosMediaUrl';
import { isLikelyVideoMediaUrl, isVideoPreviewUrl } from './hydratePersistedNodePreviews';
import {
  pickSeedanceReferencePanelSnapshot,
  repairSeedanceReferenceGenerationParamsFromPanel,
  repairSeedanceReferencePanelMainSlotIfNeeded,
  pickStillImageRecoveryApiReferenceImages,
  buildStillImageRecoveryPanelPreviewPatch,
} from './referencedMediaRun';
import {
  resolveSpawnOutputDefaultModel,
  buildStillImageOutputSpawnPatch,
} from './spawnOutputNode';

export function normalizeNodeRunStateForPersist<T extends { data?: NodeData }>(node: T): T {
  if (!node.data || node.data.status !== 'running') return node;
  const taskIds = parseAiTopTaskIds(node.data.taskId || node.data.generationParams?.taskId);
  if (taskIds.length) {
    return {
      ...node,
      data: {
        ...node.data,
        status: 'idle',
        progress: 0,
        errorMessage: undefined,
        runRecoveryPending: true,
        runRecoveryProgress: Math.max(0, Math.min(100, Number(node.data.progress || 0))),
      },
    };
  }
  // 任务创建前（Omni 上传等）刷新：保留 runRecoveryPending，加载后至少恢复进度条 UI
  if (node.data.runRecoveryPending) {
    return {
      ...node,
      data: {
        ...node.data,
        status: 'idle',
        progress: 0,
        errorMessage: undefined,
        runRecoveryPending: true,
        runRecoveryProgress: Math.max(0, Math.min(100, Number(node.data.progress || 0))),
      },
    };
  }
  return {
    ...node,
    data: {
      ...node.data,
      status: 'idle',
      progress: 0,
      errorMessage: undefined,
      runRecoveryPending: undefined,
      runRecoveryProgress: undefined,
    },
  };
}

export function clearRunRecoveryHints(data: Partial<NodeData>): Partial<NodeData> {
  return {
    ...data,
    runRecoveryPending: undefined,
    runRecoveryProgress: undefined,
  };
}

/**
 * Omni instruction/video 等上传阶段刷新（尚无 taskId）：恢复进度条 UI，不触发 AiTop 轮询。
 */
export function restoreUploadPhaseRunningUi(data: NodeData): Partial<NodeData> {
  const prevProgress = Number(data.runRecoveryProgress ?? data.progress ?? 0);
  const nextProgress = Math.max(5, prevProgress > 0 ? prevProgress : 5);
  return {
    status: 'running' as const,
    progress: nextProgress,
    runRecoveryPending: true,
    errorMessage: undefined,
  };
}

/** 持久化快照里标记了待恢复，且仍有 taskId */
export function nodeHasPendingRunRecovery(node: RFNode): boolean {
  if (!node.data?.runRecoveryPending) return false;
  const taskIds = parseAiTopTaskIds(node.data.taskId || node.data.generationParams?.taskId);
  return taskIds.length > 0;
}

/** 刷新后是否应向 AiTop 恢复轮询（含 idle + runRecoveryPending，勿要求已是 running） */
export function shouldTriggerAiTopRunRecovery(
  node: RFNode,
  nodes: RFNode[] = [],
  edges: Edge[] = []
): boolean {
  const taskIds = parseAiTopTaskIds(node.data?.taskId || node.data?.generationParams?.taskId);
  if (!taskIds.length) return false;
  return (
    nodeNeedsAiTopTaskRecovery(node, nodes, edges) || nodeHasPendingRunRecovery(node)
  );
}

/** force persist 前合并运行中尚未 flush 进 ReactFlow store 的 recovery 字段 */
export function mergeRunPersistPatchesIntoNodes(
  nodes: RFNode[],
  patches: ReadonlyMap<string, Partial<NodeData>>
): RFNode[] {
  if (patches.size === 0) return nodes;
  return nodes.map((n) => {
    const patch = patches.get(n.id);
    if (!patch) return n;
    const merged: NodeData = { ...n.data, ...patch };
    if (patch.generationParams) {
      merged.generationParams = {
        ...(n.data.generationParams || {}),
        ...patch.generationParams,
      } as GenerationParams;
    }
    return { ...n, data: merged };
  });
}

/**
 * 服务端 workspace 刷新时：若本地快照含 taskId/runRecovery* 而服务端图缺失，合并以免进度无法恢复。
 */
export function mergeRunRecoveryFieldsFromLocalSnapshot(
  nodes: RFNode[],
  localSnapshotRaw: string | null | undefined
): RFNode[] {
  if (!localSnapshotRaw) return nodes;
  try {
    const parsed = JSON.parse(localSnapshotRaw) as {
      nodes?: Array<{ id: string; data?: NodeData }>;
    };
    if (!Array.isArray(parsed.nodes)) return nodes;
    const localById = new Map(parsed.nodes.map((n) => [n.id, n]));
    return nodes.map((n) => {
      const local = localById.get(n.id);
      if (!local?.data) return n;
      const serverTaskIds = parseAiTopTaskIds(
        n.data?.taskId || n.data?.generationParams?.taskId
      );
      if (serverTaskIds.length > 0) return n;
      const localTaskIds = parseAiTopTaskIds(
        local.data.taskId || local.data.generationParams?.taskId
      );
      const localPending = Boolean(local.data.runRecoveryPending);
      if (localTaskIds.length === 0 && !localPending) return n;

      const mergedData: NodeData = { ...n.data };
      if (local.data.taskId) mergedData.taskId = local.data.taskId;
      // 服务端图常缺 runRecovery*；本地快照有 taskId 即应恢复轮询
      if (localPending || localTaskIds.length > 0) {
        mergedData.runRecoveryPending = true;
      }
      if (local.data.runRecoveryProgress != null) {
        mergedData.runRecoveryProgress = local.data.runRecoveryProgress;
      } else if (localTaskIds.length > 0) {
        mergedData.runRecoveryProgress = Math.max(
          0,
          Math.min(100, Number(local.data.progress || 0))
        );
      }
      if (local.data.generationParams && typeof local.data.generationParams === 'object') {
        mergedData.generationParams = {
          ...(n.data.generationParams || {}),
          ...local.data.generationParams,
        } as GenerationParams;
      }
      return { ...n, data: mergedData };
    });
  } catch {
    return nodes;
  }
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

/** 是否存在仍连在源节点下游、且 taskId 匹配的 MOV/OUTPUT（不要求 preview，用于删节点后 reconcile） */
function nodeHasLinkedDownstreamOutputForTaskIds(
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
    if (!n) continue;
    if (n.type === NodeType.MOV || n.type === NodeType.OUTPUT) {
      const childTaskIds = parseAiTopTaskIds(
        n.data?.taskId || n.data?.generationParams?.taskId
      );
      if (childTaskIds.length > 0 && childTaskIds.some((tid) => taskIds.includes(tid))) {
        return true;
      }
    }
    edges.filter((e) => e.source === id).forEach((e) => queue.push(e.target));
  }
  return false;
}

/**
 * 用户删除下游 MOV/OUTPUT 后：若源节点已无同 taskId 成片，清 taskId/runRecovery，
 * 避免 AiTop 恢复或再次点运行时用旧 taskId 把已删节点 spawn 回来。
 */
export function reconcileSourceRunStateAfterOutputNodesRemoved(
  nodes: RFNode[],
  edges: Edge[],
  deletedNodeIds: readonly string[]
): { nodes: RFNode[]; changed: boolean } {
  if (!deletedNodeIds.length) return { nodes, changed: false };
  const deletedSet = new Set(deletedNodeIds);
  const remainingNodes = nodes.filter((n) => !deletedSet.has(n.id));
  const remainingEdges = edges.filter(
    (e) => !deletedSet.has(e.source) && !deletedSet.has(e.target)
  );
  const deletedOutputs = nodes.filter(
    (n) =>
      deletedSet.has(n.id) &&
      (n.type === NodeType.MOV || n.type === NodeType.OUTPUT)
  );
  if (!deletedOutputs.length) return { nodes, changed: false };

  const sourcesToReconcile = new Set<string>();
  for (const out of deletedOutputs) {
    for (const e of edges) {
      if (e.target === out.id) sourcesToReconcile.add(e.source);
    }
  }

  let changed = false;
  const next = nodes.map((n) => {
    if (!sourcesToReconcile.has(n.id)) return n;
    if (n.type !== NodeType.INPUT && n.type !== NodeType.PROCESSOR) return n;
    const taskIds = parseAiTopTaskIds(n.data?.taskId || n.data?.generationParams?.taskId);
    if (!taskIds.length) return n;
    if (nodeHasLinkedDownstreamOutputForTaskIds(n, remainingNodes, remainingEdges, taskIds)) {
      return n;
    }
    changed = true;
    const gp = { ...(n.data.generationParams || {}) } as GenerationParams;
    delete gp.taskId;
    delete gp.outputUrl;
    delete gp.outputUrls;
    const nextGp = Object.keys(gp).length ? gp : undefined;
    return {
      ...n,
      data: clearRunRecoveryHints({
        ...n.data,
        taskId: undefined,
        generationParams: nextGp,
      }),
    };
  });
  return { nodes: next, changed };
}

/** 新一轮运行开始前：清掉上一轮 taskId/outputUrl，避免 recovery 误用旧任务 spawn 下游节点 */
export function clearStaleRunTaskBeforeFreshRun(data: NodeData): Partial<NodeData> {
  const gp = data.generationParams ? ({ ...data.generationParams } as GenerationParams) : undefined;
  if (gp) {
    delete gp.taskId;
    delete gp.outputUrl;
    delete gp.outputUrls;
  }
  return clearRunRecoveryHints({
    taskId: undefined,
    runRecoveryPending: undefined,
    runRecoveryProgress: undefined,
    generationParams: gp && Object.keys(gp).length ? gp : undefined,
  });
}

/** 从 Error Result Node 文案解析 Task ID（与 FlowEditor spawn 格式一致） */
function parseTaskIdsFromErrorMessage(msg: string): string[] {
  const text = String(msg || '');
  const labeled = text.match(/\*\*Task ID：\*\*\s*([^\n]+)/i);
  if (labeled?.[1]) return parseAiTopTaskIds(labeled[1]);
  const plain = text.match(/Task ID[：:]\s*([^\n]+)/i);
  if (plain?.[1]) return parseAiTopTaskIds(plain[1]);
  return [];
}

/** 下游是否已有同一 taskId 的 Error Result Node（勿再恢复轮询/假进度条） */
export function nodeHasDownstreamErrorResultForTaskIds(
  node: RFNode,
  nodes: RFNode[],
  edges: Edge[],
  taskIds: string[]
): boolean {
  if (!taskIds.length) return false;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const edge of edges) {
    if (edge.source !== node.id) continue;
    const child = byId.get(edge.target);
    if (!child || child.type !== NodeType.OUTPUT || child.data?.status !== 'error') continue;
    const errMsg = String(child.data?.errorMessage || '');
    const errTaskIds = parseTaskIdsFromErrorMessage(errMsg);
    if (errTaskIds.some((id) => taskIds.includes(id))) return true;
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
  if (nodes.length && nodeHasDownstreamErrorResultForTaskIds(node, nodes, edges, taskIds)) {
    return false;
  }
  if (nodes.length && nodeHasDownstreamOutputForTaskIds(node, nodes, edges, taskIds)) {
    return false;
  }
  if (node.data?.status === 'completed') return false;
  return true;
}

/** 工程加载 / 刷新后：面板 referenceImages 已与 API 对齐时，把 stale generationParams 写回一致 */
export function applyWorkspaceSeedanceReferenceGpRepair(
  nodes: RFNode[],
  edges: Edge[]
): {
  nodes: RFNode[];
  changed: boolean;
} {
  let changed = false;
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const panelSourceForNode = (n: RFNode): Partial<NodeData> => {
    if (
      pickSeedanceReferencePanelSnapshot(n.data).referenceImages.length > 0 ||
      n.type === NodeType.INPUT ||
      n.type === NodeType.PROCESSOR
    ) {
      return n.data;
    }
    for (const e of edges) {
      if (e.target !== n.id) continue;
      const src = byId.get(e.source);
      if (!src) continue;
      if (pickSeedanceReferencePanelSnapshot(src.data).referenceImages.length > 0) {
        return {
          ...n.data,
          selectedModel: n.data.selectedModel || src.data.selectedModel,
          seedanceGenerationMode:
            n.data.seedanceGenerationMode || src.data.seedanceGenerationMode,
          referenceImages: src.data.referenceImages,
          referenceImageLabels: src.data.referenceImageLabels,
          seedanceTabConfigs: src.data.seedanceTabConfigs,
        };
      }
    }
    return n.data;
  };

  const repaired = nodes.map((n) => {
    const panelCtx = panelSourceForNode(n);
    const gpPatch = repairSeedanceReferenceGenerationParamsFromPanel({
      ...n.data,
      selectedModel: n.data.selectedModel || panelCtx.selectedModel,
      seedanceGenerationMode:
        n.data.seedanceGenerationMode || panelCtx.seedanceGenerationMode,
      referenceImages: panelCtx.referenceImages ?? n.data.referenceImages,
      referenceImageLabels:
        panelCtx.referenceImageLabels ?? n.data.referenceImageLabels,
      seedanceTabConfigs: panelCtx.seedanceTabConfigs ?? n.data.seedanceTabConfigs,
    });
    if (!gpPatch) return n;
    changed = true;
    const mainSlotPatch = repairSeedanceReferencePanelMainSlotIfNeeded(n.data);
    const prevGp = (n.data.generationParams || {}) as GenerationParams;
    return {
      ...n,
      data: {
        ...n.data,
        ...(mainSlotPatch || {}),
        generationParams: {
          ...prevGp,
          ...gpPatch,
          outputUrl: prevGp.outputUrl ?? gpPatch.outputUrl,
          outputUrls: prevGp.outputUrls ?? gpPatch.outputUrls,
          taskId: prevGp.taskId ?? gpPatch.taskId,
        },
      },
    };
  });

  const withMainSlot = repaired.map((n) => {
    if (n.data.panelMainSlotVisible === false) return n;
    const mainSlotPatch = repairSeedanceReferencePanelMainSlotIfNeeded(n.data);
    if (!mainSlotPatch) return n;
    changed = true;
    return { ...n, data: { ...n.data, ...mainSlotPatch } };
  });

  const withThumbs = withMainSlot.map((n) => {
    const thumbs = n.data.generatedThumbnails;
    if (!thumbs?.length) return n;
    const panelCtx = panelSourceForNode(n);
    let thumbsChanged = false;
    const nextThumbs = thumbs.map((t) => {
      const thumbGp = repairSeedanceReferenceGenerationParamsFromPanel({
        ...n.data,
        generationParams: t.generationParams,
        selectedModel: n.data.selectedModel || panelCtx.selectedModel,
        seedanceGenerationMode:
          n.data.seedanceGenerationMode || panelCtx.seedanceGenerationMode,
        referenceImages: panelCtx.referenceImages ?? n.data.referenceImages,
        referenceImageLabels:
          panelCtx.referenceImageLabels ?? n.data.referenceImageLabels,
        seedanceTabConfigs: panelCtx.seedanceTabConfigs ?? n.data.seedanceTabConfigs,
      });
      if (!thumbGp) return t;
      thumbsChanged = true;
      return {
        ...t,
        generationParams: {
          ...(t.generationParams || {}),
          ...thumbGp,
          outputUrl: t.generationParams?.outputUrl ?? thumbGp.outputUrl,
          taskId: t.generationParams?.taskId ?? thumbGp.taskId,
        },
      };
    });
    if (!thumbsChanged) return n;
    changed = true;
    return { ...n, data: { ...n.data, generatedThumbnails: nextThumbs } };
  });

  return { nodes: withThumbs, changed };
}

/**
 * 工程加载后：僵尸 running 先收尾；有 taskId 且待恢复的任务立即标回 running（刷新后进度条可见）；
 * 其余无 taskId 的 running 回落 idle（持久化快照不含 running）。
 */
export function prepareNodesAfterWorkspaceLoad(
  nodes: RFNode[],
  edges: Edge[]
): { nodes: RFNode[]; changed: boolean } {
  let changed = false;
  const prepared = nodes.map((n) => {
    const zombie = reconcileZombieRunningNode(n);
    if (zombie) {
      changed = true;
      return { ...n, data: { ...n.data, ...zombie } };
    }
    if (n.data?.runRecoveryPending || nodeNeedsAiTopTaskRecovery(n, nodes, edges)) {
      const taskIds = parseAiTopTaskIds(n.data?.taskId || n.data?.generationParams?.taskId);
      // 上传阶段刷新（尚无 taskId）：恢复进度条 UI，勿触发 AiTop recovery
      if (!taskIds.length) {
        if (n.data?.runRecoveryPending) {
          const uploadUi = restoreUploadPhaseRunningUi(n.data);
          if (
            n.data?.status !== uploadUi.status ||
            n.data.progress !== uploadUi.progress ||
            !n.data.runRecoveryPending
          ) {
            changed = true;
          }
          return {
            ...n,
            data: {
              ...n.data,
              ...uploadUi,
            },
          };
        }
        if (
          n.data?.status !== 'idle' ||
          n.data.progress !== 0 ||
          n.data.runRecoveryPending
        ) {
          changed = true;
        }
        return {
          ...n,
          data: clearRunRecoveryHints({
            ...n.data,
            status: 'idle',
            progress: 0,
            errorMessage: undefined,
          }),
        };
      }
      if (
        taskIds.length > 0 &&
        nodeHasDownstreamErrorResultForTaskIds(n, nodes, edges, taskIds)
      ) {
        if (
          n.data?.status !== 'idle' ||
          n.data.progress !== 0 ||
          n.data.runRecoveryPending
        ) {
          changed = true;
        }
        return {
          ...n,
          data: clearRunRecoveryHints({
            ...n.data,
            status: 'idle',
            progress: 0,
            errorMessage: undefined,
          }),
        };
      }
      // 下游 MOV/OUTPUT 已持有同一批 taskId 的成片：任务实际已完成（刷新中断发生在
      // spawn 之后、源节点落 completed 之前）。直接把源节点收尾为 completed，
      // 避免卡在刷新前的小进度（如 6%）且不触发重复恢复轮询/重复 spawn。
      // 勿用 nodeHasRecoveredMediaOutput 阻断：源节点可能已有 generatedThumbnails
      // 但 status 仍为 running，此时 nodeNeedsAiTopTaskRecovery 也会因下游而 false，
      // 会导致进度条永久卡住。
      if (
        taskIds.length > 0 &&
        nodeHasDownstreamOutputForTaskIds(n, nodes, edges, taskIds)
      ) {
        if (n.data?.status !== 'completed' || n.data.progress !== 100) changed = true;
        return {
          ...n,
          data: clearRunRecoveryHints({
            ...n.data,
            status: 'completed' as const,
            progress: 100,
            errorMessage: undefined,
          }),
        };
      }
      const prevProgress = Number(
        n.data?.runRecoveryProgress ?? n.data?.progress ?? 0
      );
      const nextProgress = Math.max(5, prevProgress > 0 ? prevProgress : 5);
      if (
        n.data?.status !== 'running' ||
        n.data.progress !== nextProgress ||
        !n.data.runRecoveryPending
      ) {
        changed = true;
      }
      return {
        ...n,
        data: {
          ...n.data,
          status: 'running' as const,
          progress: nextProgress,
          errorMessage: undefined,
          runRecoveryPending: true,
        },
      };
    }
    const normalized = normalizeNodeRunStateForPersist(n);
    if (normalized !== n) changed = true;
    return normalized;
  });
  const { nodes: seedanceRepaired, changed: seedanceChanged } =
    applyWorkspaceSeedanceReferenceGpRepair(prepared, edges);
  return {
    nodes: seedanceRepaired,
    changed: changed || seedanceChanged,
  };
}

/** 刷新后单次查询：任务若已在 AiTop 侧完成则直接取 URL，避免先闪 running 进度条 */
export async function fetchCompletedAiTopTaskUrls(
  taskIds: string[],
  getTaskStatus: (taskId: string) => Promise<unknown>,
  model?: string
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
    if (isTerminalTaskFailure(status)) {
      const sd = statusData as { errorDescription?: string; errorMsg?: string };
      throw new Error(
        sanitizeAiTopTaskFailureMessage(sd.errorDescription || sd.errorMsg || '任务失败', model)
      );
    }
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
      data: clearRunRecoveryHints({
        ...n.data,
        imagePreview: mediaUrl,
        status: 'completed',
        progress: 100,
        errorMessage: undefined,
        taskId: taskIdJoined,
        generatedAt: generatedAtIso,
        generationParams: gp,
      }),
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

function promptMentionsMainImage(prompt: string): boolean {
  return /@主图|@主体/.test(String(prompt || ''));
}

function resolveOmniTabPrompt(
  d: NodeData,
  prev: GenerationParams,
  tab: GenerationParams['klingOmniTab'],
  fallback: string
): string {
  if (tab === 'multi') {
    return String(d.klingOmniMultiPrompt || prev.prompt || fallback || '').trim();
  }
  if (tab === 'instruction') {
    return String(d.klingOmniInstructionPrompt || prev.prompt || fallback || '').trim();
  }
  if (tab === 'video') {
    return String(d.klingOmniVideoPrompt || prev.prompt || fallback || '').trim();
  }
  if (tab === 'frames') {
    return String(d.klingOmniFramesPrompt || prev.prompt || fallback || '').trim();
  }
  return String(fallback || '').trim();
}

function pickOmniRecoveryReferenceImages(
  d: NodeData,
  prev: GenerationParams,
  tab: GenerationParams['klingOmniTab'],
  tabPrompt: string
): { images: string[]; labels?: string[] } {
  if (prev.referenceImages?.length) {
    return {
      images: [...prev.referenceImages],
      labels: prev.referenceImageLabels?.length
        ? [...prev.referenceImageLabels]
        : undefined,
    };
  }

  const tabRefKey =
    tab === 'multi'
      ? 'klingOmniMultiReferenceImages'
      : tab === 'instruction'
        ? 'klingOmniInstructionReferenceImages'
        : tab === 'video'
          ? 'klingOmniVideoReferenceImages'
          : null;
  if (tabRefKey) {
    const tabRefs = ((d[tabRefKey as keyof NodeData] as string[] | undefined) || [])
      .map((u) => String(u || '').trim())
      .filter(Boolean);
    if (tabRefs.length) {
      return { images: tabRefs };
    }
  }

  if (tab === 'frames') {
    const frames: string[] = [];
    const ff = String(
      d.firstFrameImageUrl ||
        d.firstFrameImage ||
        prev.firstFrameImageUrl ||
        prev.firstFrameImage ||
        ''
    ).trim();
    const lf = String(
      d.lastFrameImageUrl ||
        d.lastFrameImage ||
        prev.lastFrameImageUrl ||
        prev.lastFrameImage ||
        ''
    ).trim();
    if (ff) frames.push(ff);
    if (lf) frames.push(lf);
    if (frames.length) return { images: frames };
  }

  const mainPreview = String(d.imagePreview || '').trim();
  if (
    mainPreview &&
    !isVideoPreviewUrl(mainPreview) &&
    !isLikelyVideoMediaUrl(mainPreview) &&
    promptMentionsMainImage(tabPrompt)
  ) {
    return { images: [mainPreview], labels: ['主图'] };
  }

  return { images: [] };
}

function pickOmniRecoveryReferenceMovs(
  d: NodeData,
  prev: GenerationParams,
  tab: GenerationParams['klingOmniTab'],
  outputUrl?: string
): GenerationParams['referenceMovs'] {
  const outputKey = outputUrl ? normalizeUrlKey(outputUrl) : '';
  const filterOutOutput = (movs: NonNullable<GenerationParams['referenceMovs']>) =>
    movs.filter((m) => m?.url && normalizeUrlKey(m.url) !== outputKey);

  if (prev.referenceMovs?.length) {
    const filtered = filterOutOutput(prev.referenceMovs);
    if (filtered.length) return filtered.map((m) => ({ ...m }));
  }

  if (d.referenceMovs?.length) {
    const filtered = filterOutOutput(d.referenceMovs);
    if (filtered.length) return filtered.map((m) => ({ ...m }));
  }

  let videoUrl = '';
  if (tab === 'instruction') {
    videoUrl = String(
      d.klingOmniInstructionVideoUrl || prev.klingOmniInstructionVideoUrl || ''
    ).trim();
  } else if (tab === 'video') {
    videoUrl = String(d.klingOmniVideoUrl || prev.klingOmniVideoUrl || '').trim();
  }
  if (!videoUrl || normalizeUrlKey(videoUrl) === outputKey) return undefined;

  const panelMov = d.referenceMovs?.find(
    (m) => m?.url && normalizeUrlKey(m.url) === normalizeUrlKey(videoUrl)
  );
  return [
    {
      url: videoUrl,
      ...(panelMov?.posterDataUrl ? { posterDataUrl: panelMov.posterDataUrl } : {}),
    },
  ];
}

function mergeKlingOmniRecoveryGenerationParams(
  d: NodeData,
  prev: GenerationParams,
  merged: GenerationParams,
  patch: Partial<GenerationParams>
): GenerationParams {
  const tab = (patch.klingOmniTab ??
    d.klingOmniTab ??
    prev.klingOmniTab ??
    'multi') as NonNullable<GenerationParams['klingOmniTab']>;
  merged.klingOmniTab = tab;
  merged.quality = patch.quality ?? prev.quality ?? d.quality;
  merged.duration = patch.duration ?? prev.duration ?? d.duration;
  merged.aspectRatio = patch.aspectRatio ?? prev.aspectRatio ?? d.aspectRatio;
  merged.klingAudioSync = prev.klingAudioSync ?? d.klingAudioSync;

  const tabPrompt = resolveOmniTabPrompt(
    d,
    prev,
    tab,
    String(merged.prompt || d.prompt || '').trim()
  );
  if (tabPrompt) merged.prompt = tabPrompt;

  const refImages = pickOmniRecoveryReferenceImages(d, prev, tab, tabPrompt);
  if (refImages.images.length) {
    merged.referenceImages = refImages.images;
    if (refImages.labels?.length) merged.referenceImageLabels = refImages.labels;
  }

  const refMovs = pickOmniRecoveryReferenceMovs(d, prev, tab, patch.outputUrl);
  if (refMovs?.length) merged.referenceMovs = refMovs;

  if (tab === 'instruction') {
    const videoUrl = String(
      d.klingOmniInstructionVideoUrl || prev.klingOmniInstructionVideoUrl || ''
    ).trim();
    if (videoUrl) {
      merged.klingOmniInstructionVideoUrl = videoUrl;
      const previewUrl = String(
        d.klingOmniInstructionVideoPreviewUrl ||
          prev.klingOmniInstructionVideoPreviewUrl ||
          ''
      ).trim();
      if (previewUrl) merged.klingOmniInstructionVideoPreviewUrl = previewUrl;
    }
  } else if (tab === 'video') {
    const videoUrl = String(d.klingOmniVideoUrl || prev.klingOmniVideoUrl || '').trim();
    if (videoUrl) {
      merged.klingOmniVideoUrl = videoUrl;
      const previewUrl = String(
        d.klingOmniVideoPreviewUrl || prev.klingOmniVideoPreviewUrl || ''
      ).trim();
      if (previewUrl) merged.klingOmniVideoPreviewUrl = previewUrl;
    }
  }

  if (patch.outputUrl) merged.outputUrl = patch.outputUrl;
  if (patch.outputUrls?.length) merged.outputUrls = [...patch.outputUrls];

  merged.firstFrameImage = patch.firstFrameImage ?? prev.firstFrameImage ?? d.firstFrameImage;
  merged.lastFrameImage = patch.lastFrameImage ?? prev.lastFrameImage ?? d.lastFrameImage;
  merged.firstFrameImageUrl =
    patch.firstFrameImageUrl ?? prev.firstFrameImageUrl ?? d.firstFrameImageUrl;
  merged.lastFrameImageUrl =
    patch.lastFrameImageUrl ?? prev.lastFrameImageUrl ?? d.lastFrameImageUrl;

  return merged;
}

/**
 * 刷新恢复 spawn：从运行节点面板态补全 generationParams（避免仅 taskId 时 Details 缺参考图/视频）
 */
export function mergeRecoveryGenerationParamsFromRunNode(
  runNode: RFNode,
  patch: Partial<GenerationParams>
): GenerationParams {
  const d = runNode.data || {};
  const prev = (d.generationParams || {}) as GenerationParams;
  const model = String(patch.model || d.selectedModel || prev.model || '').trim();
  const merged: GenerationParams = {
    ...prev,
    ...patch,
    model,
    prompt: patch.prompt ?? prev.prompt ?? d.prompt,
    negativePrompt: patch.negativePrompt ?? prev.negativePrompt ?? d.negativePrompt,
  };

  if (model === '可灵3.0 Omni') {
    return mergeKlingOmniRecoveryGenerationParams(d, prev, merged, patch);
  }

  if (isNanoBanana2Model(model) || isImage2Model(model)) {
    const patchRefs = Array.isArray(patch.referenceImages)
      ? patch.referenceImages.map((u) => String(u || '').trim()).filter(Boolean)
      : [];
    const picked = pickStillImageRecoveryApiReferenceImages({
      ...d,
      selectedModel: model,
    });
    if (patchRefs.length) {
      merged.referenceImages = [...patchRefs];
    } else if (picked?.referenceImages.length) {
      merged.referenceImages = [...picked.referenceImages];
      if (picked.referenceImageLabels?.length) {
        merged.referenceImageLabels = [...picked.referenceImageLabels];
      }
    } else {
      merged.referenceImages = undefined;
      merged.referenceImageLabels = undefined;
    }
    if (isNanoBanana2Model(model)) {
      merged.aspectRatio = merged.aspectRatio ?? d.aspectRatio ?? '1:1';
      merged.resolution = merged.resolution ?? d.resolution ?? '1K';
      merged.numberOfImages = merged.numberOfImages ?? d.numberOfImages ?? '1张';
    }
    if (isImage2Model(model)) {
      merged.image2AspectRatio =
        merged.image2AspectRatio ?? d.image2AspectRatio ?? '1:1';
      merged.aspectRatio = merged.aspectRatio ?? merged.image2AspectRatio;
    }
    return merged;
  }

  if (!['seedance2.0 (高质量版)', 'seedance2.0 (急速版)'].includes(model)) {
    return merged;
  }

  const mode = (d.seedanceGenerationMode ||
    prev.seedanceGenerationMode ||
    'text') as 'text' | 'image' | 'reference';
  merged.seedanceGenerationMode = mode;
  merged.seedanceAspectRatio = prev.seedanceAspectRatio ?? d.seedanceAspectRatio;
  merged.seedanceResolution = prev.seedanceResolution ?? d.seedanceResolution;
  merged.seedanceDuration = prev.seedanceDuration ?? d.seedanceDuration;
  merged.seedanceGenerateAudio = prev.seedanceGenerateAudio ?? d.seedanceGenerateAudio;
  merged.seedanceReferenceRatioMode =
    prev.seedanceReferenceRatioMode ?? d.seedanceReferenceRatioMode;

  if (mode !== 'reference') return merged;

  const { referenceImages: panelRefs, referenceImageLabels: panelLabels } =
    pickSeedanceReferencePanelSnapshot(d);
  if (panelRefs.length) {
    merged.referenceImages = [...panelRefs];
    merged.referenceImageLabels = panelLabels?.some((l) => String(l || '').trim())
      ? [...panelLabels!]
      : undefined;
  } else if (prev.referenceImages?.length) {
    merged.referenceImages = [...prev.referenceImages];
    merged.referenceImageLabels = prev.referenceImageLabels?.length
      ? [...prev.referenceImageLabels]
      : d.referenceImageLabels?.length
        ? [...d.referenceImageLabels]
        : undefined;
  }
  if (patch.outputUrl) merged.outputUrl = patch.outputUrl;
  if (patch.outputUrls?.length) merged.outputUrls = [...patch.outputUrls];
  if (prev.referenceMovs?.length) merged.referenceMovs = [...prev.referenceMovs];
  // 勿从面板 referenceMovs 回填：纯图参考生可能残留历史视频槽，recovery Details 会误显示 Reference Videos
  if (prev.referenceAudios?.length) merged.referenceAudios = [...prev.referenceAudios];
  else if (d.referenceAudios?.length) merged.referenceAudios = [...d.referenceAudios];

  return merged;
}

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
  const recoveryPatchBase: Partial<GenerationParams> = {
    generatedAt: generatedAtIso,
    taskId: taskIdJoined,
    model,
    prompt: runNode.data.prompt,
    negativePrompt: runNode.data.negativePrompt,
    quality: runNode.data.quality ?? runNode.data.generationParams?.quality,
    duration: runNode.data.duration ?? runNode.data.generationParams?.duration,
    aspectRatio: runNode.data.aspectRatio ?? runNode.data.generationParams?.aspectRatio,
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
  let recoveryGenerationParams: GenerationParams | null = null;

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

    const generationParams = mergeRecoveryGenerationParamsFromRunNode(runNode, {
      ...recoveryPatchBase,
      outputUrl: mediaUrl,
    });
    recoveryGenerationParams = generationParams;

    const newNodeId = createNodeId();
    const nodeType = isVideo ? NodeType.MOV : NodeType.OUTPUT;
    const label = isVideo ? 'Output Mov Node' : 'Output Picture Node';
    const imageName = isVideo
      ? `Video_${Math.floor(Math.random() * 1000)}.mov`
      : `Generated_${Math.floor(Math.random() * 1000)}.png`;

    if (!existingOutputUrls.has(urlKey)) {
      const outModel = resolveSpawnOutputDefaultModel({
        isVideoModel: isVideo,
        currentModelName: model,
      });
      const stillPatch = buildStillImageOutputSpawnPatch(runNode.data, outModel);
      const outNode: RFNode = {
        id: newNodeId,
        type: nodeType,
        position: { x: baseX, y: baseY + (existingOutgoing + idx) * 250 },
        data: {
          label,
          imagePreview: mediaUrl,
          imageName,
          selectedModel: outModel,
          status: 'idle',
          generatedAt: generatedAtIso,
          taskId: taskIdJoined,
          generationParams: { ...generationParams },
          ...stillPatch,
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
      const previewPatch = buildStillImageRecoveryPanelPreviewPatch({
        ...nextData,
        generationParams: {
          ...(nextData.generationParams || {}),
          ...(recoveryGenerationParams ||
            mergeRecoveryGenerationParamsFromRunNode(runNode, recoveryPatchBase)),
        },
      });
      nextData = clearRunRecoveryHints({
        ...nextData,
        ...(previewPatch || {}),
        status: 'completed' as const,
        progress: 100,
        errorMessage: undefined,
        taskId: taskIdJoined,
        generatedAt: generatedAtIso,
        generationParams: {
          ...(nextData.generationParams || {}),
          ...(recoveryGenerationParams ||
            mergeRecoveryGenerationParamsFromRunNode(runNode, recoveryPatchBase)),
        },
      });
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

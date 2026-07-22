import { useCallback, useEffect, useRef } from 'react';
import type { Edge, Node as RFNode } from 'reactflow';
import { getTaskStatus, uploadVideo } from '../services/aitop';
import { ensureAitopCosVideoUrl } from '../utils/aitopCosMediaUrl';
import {
  defaultPollConfigForModel,
  isKnownUpstreamFailureMessage,
  isVideoModelName,
  parseAiTopTaskIds,
  pollAiTopTaskUntilResourceUrl,
} from '../utils/aitopTaskRecovery';
import { hydrateMovNodesFromUpstream } from '../utils/hydratePersistedNodePreviews';
import {
  applyRecoveryToOutputNode,
  buildRecoveryGraphUpdates,
  fetchCompletedAiTopTaskUrls,
  clearRunRecoveryHints,
  clearStaleRunTaskBeforeFreshRun,
  nodeHasDownstreamErrorResultForTaskIds,
  prepareNodesAfterWorkspaceLoad,
  shouldTriggerAiTopRunRecovery,
} from '../utils/runRecovery';
import { NodeType } from '../types';
import type { NodeData } from '../types';

export type UseAiTopRunRecoveryParams = {
  graphHydrationReady: boolean;
  /** 节点 run/task 签名变化时重试恢复（避免 hydration 竞态漏启动轮询） */
  recoveryWatchKey?: string;
  getNodes: () => RFNode[];
  getEdges: () => Edge[];
  setNodes: React.Dispatch<React.SetStateAction<RFNode[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  createNodeId: () => string;
  onPersistRequest?: () => void;
  /** FlowEditor 正在本页轮询的节点：勿重复启动 recoverOneNode（会与 live poll 抢 setNodes） */
  isNodeLiveRunActive?: (nodeId: string) => boolean;
};

function resolveRunNodeTaskIds(runNode: RFNode): string[] {
  return parseAiTopTaskIds(runNode.data?.taskId || runNode.data?.generationParams?.taskId);
}

/**
 * 工程加载后：修复僵尸 running 节点，并按 taskId 向 AiTop 恢复未落盘的生成结果。
 */
export function useAiTopRunRecovery(params: UseAiTopRunRecoveryParams): void {
  const {
    graphHydrationReady,
    recoveryWatchKey,
    getNodes,
    getEdges,
    setNodes,
    setEdges,
    createNodeId,
    onPersistRequest,
    isNodeLiveRunActive,
  } = params;

  const recoveringRef = useRef(new Set<string>());
  /** 仅工程首次 hydration 且节点已加载后跑一次 prepare，避免 effect 重入时覆盖 live running 态 */
  const postLoadPrepDoneRef = useRef(false);

  const recoverOneNode = useCallback(
    async (runNode: RFNode) => {
      const nodeId = runNode.id;
      if (recoveringRef.current.has(nodeId)) return;
      recoveringRef.current.add(nodeId);

      let progressTimer: ReturnType<typeof setInterval> | null = null;
      const stopProgressTimer = () => {
        if (progressTimer != null) {
          clearInterval(progressTimer);
          progressTimer = null;
        }
      };
      const bumpRecoveryProgress = () => {
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id !== nodeId || n.data.status !== 'running') return n;
            const prev = Number(n.data.progress || 0);
            const next = Math.min(95, Math.max(5, prev + 1));
            if (next === prev) return n;
            return {
              ...n,
              data: { ...n.data, progress: next, runRecoveryProgress: next },
            };
          })
        );
      };

      try {
        const latestRunNode = getNodes().find((n) => n.id === nodeId) || runNode;
        const taskIds = resolveRunNodeTaskIds(latestRunNode);
        if (!taskIds.length) {
          setNodes((nds) =>
            nds.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: clearRunRecoveryHints({
                      ...n.data,
                      status: 'idle',
                      progress: 0,
                      errorMessage: undefined,
                    }),
                  }
                : n
            )
          );
          return;
        }

        const graphNodes = getNodes();
        const graphEdges = getEdges();
        if (nodeHasDownstreamErrorResultForTaskIds(latestRunNode, graphNodes, graphEdges, taskIds)) {
          setNodes((nds) =>
            nds.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: clearRunRecoveryHints({
                      ...n.data,
                      status: 'idle',
                      progress: 0,
                      errorMessage: undefined,
                    }),
                  }
                : n
            )
          );
          return;
        }

        const prevProgress = Number(
          latestRunNode.data?.runRecoveryProgress ?? latestRunNode.data?.progress ?? 0
        );
        const nextProgress = Math.max(5, prevProgress > 0 ? prevProgress : 5);
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: 'running',
                    progress: nextProgress,
                    runRecoveryProgress: nextProgress,
                    runRecoveryPending: true,
                    errorMessage: undefined,
                  },
                }
              : n
          )
        );

        progressTimer = setInterval(bumpRecoveryProgress, 2000);

        const model =
          latestRunNode.data?.selectedModel ||
          latestRunNode.data?.generationParams?.model ||
          '';
        const pollCfg = defaultPollConfigForModel(model);
        const treatAsVideo =
          isVideoModelName(model) ||
          latestRunNode.type === NodeType.MOV ||
          /\.(mov|mp4|webm)/i.test(String(latestRunNode.data?.imageName || ''));

        let mediaUrls: string[] =
          (await fetchCompletedAiTopTaskUrls(taskIds, getTaskStatus, model)) || [];

        const needsPolling = mediaUrls.length === 0;
        const requireAitopCos = treatAsVideo;

        if (needsPolling) {
          for (const taskId of taskIds) {
            const rawUrl = await pollAiTopTaskUntilResourceUrl(taskId, {
              getTaskStatus,
              pollConfig: pollCfg,
              requireAitopCos,
              model,
              maxConsecutiveErrors: model.includes('seedance2.0 (高质量版)') ? 18 : 10,
              onProgress: bumpRecoveryProgress,
            });
            mediaUrls.push(rawUrl);
          }
        }

        stopProgressTimer();

        if (treatAsVideo && mediaUrls.length > 0) {
          const stabilized: string[] = [];
          for (let i = 0; i < mediaUrls.length; i++) {
            const taskId = taskIds[i] || taskIds[0];
            const safeModel = (model || 'video').replace(/[^\w-]+/g, '_');
            const safeTask = taskId.replace(/[^\w-]+/g, '_');
            stabilized.push(
              await ensureAitopCosVideoUrl(mediaUrls[i], uploadVideo, {
                label: `恢复生成结果（task ${taskId}）`,
                filename: `recover-${safeModel}-${safeTask}.mp4`,
                taskId,
              })
            );
          }
          mediaUrls = stabilized;
        }

        const joined = taskIds.join(', ');
        const isOutputVideo =
          latestRunNode.type === NodeType.MOV ||
          (latestRunNode.type === NodeType.OUTPUT &&
            /\.(mov|mp4|webm)/i.test(String(latestRunNode.data?.imageName || '')));

        if (isOutputVideo) {
          setNodes((nds) =>
            applyRecoveryToOutputNode(nds, nodeId, mediaUrls, joined)
          );
        } else {
          const { nodes: nextNodes, edges: nextEdges } = buildRecoveryGraphUpdates({
            nodes: getNodes(),
            edges: getEdges(),
            runNodeId: nodeId,
            mediaUrls,
            taskIdJoined: joined,
            createNodeId,
          });
          setNodes(nextNodes);
          setEdges(nextEdges);
        }
        onPersistRequest?.();
      } catch (e) {
        const rawMsg = e instanceof Error ? e.message : String(e);
        const isKnownUpstreamFailure = isKnownUpstreamFailureMessage(rawMsg);
        if (isKnownUpstreamFailure) {
          console.info('[flowgen] AiTop task already failed upstream', nodeId, rawMsg.slice(0, 160));
        } else {
          console.warn('[flowgen] AiTop task recovery failed', nodeId, e);
        }
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    ...clearStaleRunTaskBeforeFreshRun(n.data as NodeData),
                    status: isKnownUpstreamFailure ? 'error' : 'idle',
                    progress: 0,
                    runRecoveryPending: undefined,
                    runRecoveryProgress: undefined,
                    errorMessage: isKnownUpstreamFailure
                      ? rawMsg.replace(/^恢复生成结果失败：/, '')
                      : e instanceof Error
                        ? `恢复生成结果失败：${e.message}`
                        : '恢复生成结果失败',
                  },
                }
              : n
          )
        );
        onPersistRequest?.();
      } finally {
        stopProgressTimer();
        recoveringRef.current.delete(nodeId);
      }
    },
    [createNodeId, getEdges, getNodes, onPersistRequest, setEdges, setNodes]
  );

  const triggerPendingRecoveries = useCallback(() => {
    const graphNodes = getNodes();
    const graphEdges = getEdges();
    for (const n of graphNodes) {
      if (isNodeLiveRunActive?.(n.id)) continue;
      if (!shouldTriggerAiTopRunRecovery(n, graphNodes, graphEdges)) continue;
      if (recoveringRef.current.has(n.id)) continue;
      void recoverOneNode(n);
    }
  }, [getEdges, getNodes, isNodeLiveRunActive, recoverOneNode]);

  useEffect(() => {
    if (!graphHydrationReady) return;
    let cancelled = false;

    void (async () => {
      if (!postLoadPrepDoneRef.current) {
        const graphEdges = getEdges();
        const graphNodes = getNodes();
        if (graphNodes.length > 0) {
          postLoadPrepDoneRef.current = true;
          const { nodes: prepared, changed: prepChanged } = prepareNodesAfterWorkspaceLoad(
            graphNodes,
            graphEdges
          );
          const afterMovHydrate = hydrateMovNodesFromUpstream(prepared, graphEdges);
          const movHydrateChanged = afterMovHydrate.some((n, i) => n !== prepared[i]);
          if (!cancelled && (prepChanged || movHydrateChanged)) {
            setNodes(afterMovHydrate);
            onPersistRequest?.();
          }
        }
      }

      if (!cancelled) triggerPendingRecoveries();
    })();

    return () => {
      cancelled = true;
    };
  }, [
    graphHydrationReady,
    recoveryWatchKey,
    getNodes,
    getEdges,
    onPersistRequest,
    setNodes,
    triggerPendingRecoveries,
  ]);
}

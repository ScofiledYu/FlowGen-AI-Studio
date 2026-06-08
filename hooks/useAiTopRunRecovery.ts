import { useCallback, useEffect, useRef } from 'react';
import type { Edge, Node as RFNode } from 'reactflow';
import { getTaskStatus, uploadVideo } from '../services/aitop';
import { ensureAitopCosVideoUrl } from '../utils/aitopCosMediaUrl';
import {
  defaultPollConfigForModel,
  isVideoModelName,
  parseAiTopTaskIds,
  pollAiTopTaskUntilResourceUrl,
} from '../utils/aitopTaskRecovery';
import { hydrateMovNodesFromUpstream } from '../utils/hydratePersistedNodePreviews';
import {
  applyRecoveryToOutputNode,
  buildRecoveryGraphUpdates,
  fetchCompletedAiTopTaskUrls,
  normalizeNodeRunStateForPersist,
  nodeNeedsAiTopTaskRecovery,
  reconcileZombieRunningNode,
} from '../utils/runRecovery';
import { NodeType } from '../types';

export type UseAiTopRunRecoveryParams = {
  graphHydrationReady: boolean;
  getNodes: () => RFNode[];
  getEdges: () => Edge[];
  setNodes: React.Dispatch<React.SetStateAction<RFNode[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  createNodeId: () => string;
  onPersistRequest?: () => void;
};

/**
 * 工程加载后：修复僵尸 running 节点，并按 taskId 向 AiTop 恢复未落盘的生成结果。
 */
export function useAiTopRunRecovery(params: UseAiTopRunRecoveryParams): void {
  const {
    graphHydrationReady,
    getNodes,
    getEdges,
    setNodes,
    setEdges,
    createNodeId,
    onPersistRequest,
  } = params;

  const recoveringRef = useRef(new Set<string>());
  const bootRecoveryDoneRef = useRef(false);

  const recoverOneNode = useCallback(
    async (runNode: RFNode) => {
      const nodeId = runNode.id;
      if (recoveringRef.current.has(nodeId)) return;
      recoveringRef.current.add(nodeId);

      try {
        const taskIds = parseAiTopTaskIds(
          runNode.data?.taskId || runNode.data?.generationParams?.taskId
        );
        if (!taskIds.length) return;

        const model =
          runNode.data?.selectedModel ||
          runNode.data?.generationParams?.model ||
          '';
        const pollCfg = defaultPollConfigForModel(model);
        const treatAsVideo =
          isVideoModelName(model) ||
          runNode.type === NodeType.MOV ||
          /\.(mov|mp4|webm)/i.test(String(runNode.data?.imageName || ''));

        let mediaUrls: string[] =
          (await fetchCompletedAiTopTaskUrls(taskIds, getTaskStatus)) || [];

        const needsPolling = mediaUrls.length === 0;
        const requireAitopCos = treatAsVideo;
        if (needsPolling) {
          setNodes((nds) =>
            nds.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: 'running', progress: n.data.progress || 5 } }
                : n
            )
          );
        }

        if (needsPolling) {
          for (const taskId of taskIds) {
            const rawUrl = await pollAiTopTaskUntilResourceUrl(taskId, {
              getTaskStatus,
              pollConfig: pollCfg,
              requireAitopCos,
              maxConsecutiveErrors: model.includes('seedance2.0 (高质量版)') ? 18 : 10,
              onProgress: () => {
                setNodes((nds) =>
                  nds.map((n) => {
                    if (n.id !== nodeId || n.data.status !== 'running') return n;
                    const prev = Number(n.data.progress || 0);
                    const next = Math.min(95, prev + 1);
                    if (next === prev) return n;
                    return { ...n, data: { ...n.data, progress: next } };
                  })
                );
              },
            });
            mediaUrls.push(rawUrl);
          }
        }

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
          runNode.type === NodeType.MOV ||
          (runNode.type === NodeType.OUTPUT &&
            /\.(mov|mp4|webm)/i.test(String(runNode.data?.imageName || '')));

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
        console.warn('[flowgen] AiTop task recovery failed', nodeId, e);
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: 'idle',
                    progress: 0,
                    errorMessage:
                      e instanceof Error
                        ? `恢复生成结果失败：${e.message}`
                        : '恢复生成结果失败',
                  },
                }
              : n
          )
        );
        onPersistRequest?.();
      } finally {
        recoveringRef.current.delete(nodeId);
      }
    },
    [createNodeId, getEdges, getNodes, onPersistRequest, setEdges, setNodes]
  );

  useEffect(() => {
    if (!graphHydrationReady || bootRecoveryDoneRef.current) return;
    bootRecoveryDoneRef.current = true;

    void (async () => {
      const rawNodes = getNodes();
      const normalized = rawNodes.map((n) => normalizeNodeRunStateForPersist(n));
      const normalizedChanged = normalized.some((n, i) => n !== rawNodes[i]);
      let zombieChanged = false;
      const afterZombie = normalized.map((n) => {
        const patch = reconcileZombieRunningNode(n);
        if (!patch) return n;
        zombieChanged = true;
        return { ...n, data: { ...n.data, ...patch } };
      });
      const afterMovHydrate = hydrateMovNodesFromUpstream(afterZombie, getEdges());
      const movHydrateChanged = afterMovHydrate.some((n, i) => n !== afterZombie[i]);
      if (zombieChanged || normalizedChanged || movHydrateChanged) {
        setNodes(afterMovHydrate);
        onPersistRequest?.();
      }

      const graphNodes = afterMovHydrate;
      const graphEdges = getEdges();
      for (const n of graphNodes) {
        if (!nodeNeedsAiTopTaskRecovery(n, graphNodes, graphEdges)) continue;
        void recoverOneNode(n);
      }
    })();
  }, [graphHydrationReady, getNodes, getEdges, onPersistRequest, recoverOneNode, setNodes]);
}

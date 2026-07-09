import type { Edge, Node as RFNode } from 'reactflow';
import { NodeType } from '../types';

/** 「全部运行」/「选择运行」：每隔 N 秒启动下一节点（可重叠执行） */
export const BATCH_RUN_NODE_INTERVAL_MS = 15000;

function compareNodeDisplayNameStatic(a: RFNode, b: RFNode): number {
  const hasCustomA = !!a.data?.customName?.trim();
  const hasCustomB = !!b.data?.customName?.trim();
  if (hasCustomA !== hasCustomB) return hasCustomA ? -1 : 1;
  const nameA = (a.data?.customName?.trim() || a.data?.label || '').trim();
  const nameB = (b.data?.customName?.trim() || b.data?.label || '').trim();
  return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
}

export function nodeHasOutputOrMovDownstream(
  nodeId: string,
  nodes: RFNode[],
  edges: Edge[]
): boolean {
  for (const e of edges) {
    if (e.hidden || e.source !== nodeId) continue;
    const target = nodes.find((n) => n.id === e.target);
    if (
      target &&
      !target.hidden &&
      (target.type === NodeType.OUTPUT || target.type === NodeType.MOV)
    ) {
      return true;
    }
  }
  return false;
}

export function sortNodesForBatchRun(nodes: RFNode[]): RFNode[] {
  return [...nodes].sort((a, b) => {
    const byName = compareNodeDisplayNameStatic(a, b);
    if (byName !== 0) return byName;
    if (Math.abs(a.position.y - b.position.y) < 50) {
      return a.position.x - b.position.x;
    }
    return a.position.y - b.position.y;
  });
}

/** 分镜表绿色下游、有 prompt、尚无 OUTPUT/MOV 子节点 */
export function collectStoryboardGreenRunQueue(nodes: RFNode[], edges: Edge[]): RFNode[] {
  const candidates = nodes.filter((n) => {
    if (n.hidden) return false;
    if (n.type !== NodeType.PROCESSOR && n.type !== NodeType.INPUT) return false;
    if (n.data?.spawnHighlight !== 'green') return false;
    if (!String(n.data?.prompt || '').trim()) return false;
    if (n.data?.status === 'running') return false;
    if (nodeHasOutputOrMovDownstream(n.id, nodes, edges)) return false;
    return true;
  });
  return sortNodesForBatchRun(candidates);
}

/** 画布当前选中的 INPUT/PROCESSOR（有创意描述、非 running） */
export function collectSelectedRunQueue(nodes: RFNode[]): RFNode[] {
  const candidates = nodes.filter((n) => {
    if (n.hidden || !n.selected) return false;
    if (n.type !== NodeType.PROCESSOR && n.type !== NodeType.INPUT) return false;
    if (!String(n.data?.prompt || '').trim()) return false;
    if (n.data?.status === 'running') return false;
    return true;
  });
  return sortNodesForBatchRun(candidates);
}

/** 定时运行：按设定时的 nodeId 顺序还原队列（勿再依赖当前选中态） */
export function resolveBatchRunQueueByIds(nodeIds: string[], nodes: RFNode[]): RFNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const resolved: RFNode[] = [];
  for (const id of nodeIds) {
    const n = byId.get(id);
    if (!n || n.hidden) continue;
    if (n.type !== NodeType.PROCESSOR && n.type !== NodeType.INPUT) continue;
    if (!String(n.data?.prompt || '').trim()) continue;
    if (n.data?.status === 'running') continue;
    resolved.push(n);
  }
  return sortNodesForBatchRun(resolved);
}

export function snapshotBatchRunNodeIds(
  action: 'selected' | 'all',
  nodes: RFNode[],
  edges: Edge[]
): string[] {
  const queue =
    action === 'selected'
      ? collectSelectedRunQueue(nodes)
      : collectStoryboardGreenRunQueue(nodes, edges);
  return queue.map((n) => n.id);
}

/** 定时运行排队：为画布节点打上瞬态 UI 标记（不写入持久化） */
export function applyScheduledRunQueueHighlight<T extends RFNode>(
  nodes: T[],
  queuedNodeIds: string[] | null | undefined
): T[] {
  const queued = queuedNodeIds?.length ? new Set(queuedNodeIds) : null;
  return nodes.map((n) => {
    const shouldQueue = queued?.has(n.id) ?? false;
    if (shouldQueue === !!n.data?.scheduledRunQueued) return n;
    return {
      ...n,
      data: {
        ...n.data,
        scheduledRunQueued: shouldQueue || undefined,
      },
    };
  });
}

/** 某节点开始运行后，仅移除该节点的「定时」角标（其余排队节点保留） */
export function removeScheduledRunQueueHighlightId(
  queuedNodeIds: string[] | null | undefined,
  nodeId: string
): string[] | null {
  if (!queuedNodeIds?.length) return null;
  const next = queuedNodeIds.filter((id) => id !== nodeId);
  return next.length ? next : null;
}

/** 模拟 runStaggeredQueue：按间隔启动，返回实际启动的 nodeId 列表 */
export async function simulateStaggeredBatchRun(
  queue: RFNode[],
  opts: {
    intervalMs: number;
    onStart?: (nodeId: string, index: number) => void;
    shouldStop?: () => boolean;
  }
): Promise<string[]> {
  const started: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    if (opts.shouldStop?.()) break;
    opts.onStart?.(queue[i].id, i);
    started.push(queue[i].id);
    if (i < queue.length - 1 && !opts.shouldStop?.()) {
      await new Promise((r) => setTimeout(r, opts.intervalMs));
    }
  }
  return started;
}

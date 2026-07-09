/** 画布级中键拖素材：window capture 兜底，避免节点内 React 事件链未触发 */

import type { Node as RFNode } from 'reactflow';
import type { NodeData } from '../types';
import {
  buildCanvasMiddleDragStartPayload,
  isAltMiddlePanGesture,
  resolveCanvasNodeMiddleDragUrl,
  resolveMiddleDragNodeHit,
} from './canvasMiddleDrag';
import {
  isMiddleButtonMediaDragActive,
  startMiddleButtonMediaDrag,
} from './middleButtonMediaDrag';

const SKIP_SELECTOR =
  '.nodrag, button, a, input, textarea, select, [role="combobox"], .react-flow__handle';

let bridgeInstalled = false;
let getNodesRef: (() => RFNode[]) | null = null;

function handleMiddleDown(e: MouseEvent) {
  if (e.button !== 1) return;
  if (isAltMiddlePanGesture(e)) return;
  const target = e.target as Element | null;
  if (!target) return;
  if (!target.closest('.react-flow')) return;

  const allNodes = getNodesRef?.() ?? [];
  const hit = resolveMiddleDragNodeHit(allNodes, e.clientX, e.clientY, target);

  if (!hit || !getNodesRef) return;

  if (target.closest(SKIP_SELECTOR) && hit.via === 'target') return;
  if (isMiddleButtonMediaDragActive()) return;

  const rfNode = allNodes.find((n) => n.id === hit.nodeId);
  if (!rfNode) return;

  const sourceData = rfNode.data as Partial<NodeData>;
  const previewUrl = resolveCanvasNodeMiddleDragUrl(sourceData, String(rfNode.type || ''));
  if (!previewUrl) return;

  const payload = buildCanvasMiddleDragStartPayload({
    allNodes,
    sourceNodeId: hit.nodeId,
    sourceData,
  });
  if (!payload) return;

  e.preventDefault();
  e.stopPropagation();
  startMiddleButtonMediaDrag(e, payload);
}

export function installCanvasMiddleDragBridge(getNodes: () => RFNode[]): () => void {
  if (typeof window === 'undefined') return () => {};

  getNodesRef = getNodes;

  if (!bridgeInstalled) {
    bridgeInstalled = true;
    window.addEventListener('mousedown', handleMiddleDown, true);
  }

  return () => {
    bridgeInstalled = false;
    getNodesRef = null;
    window.removeEventListener('mousedown', handleMiddleDown, true);
  };
}

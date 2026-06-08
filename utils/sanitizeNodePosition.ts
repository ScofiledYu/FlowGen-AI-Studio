import type { Node as RFNode } from 'reactflow';

/** 超出此范围的坐标会污染 MiniMap viewBox，表现为导航全黑、看不见节点 */
const MAX_ABS_POSITION = 500_000;

export function hasReasonableNodePosition(node: RFNode): boolean {
  const x = Number(node.position?.x);
  const y = Number(node.position?.y);
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Math.abs(x) <= MAX_ABS_POSITION &&
    Math.abs(y) <= MAX_ABS_POSITION
  );
}

export function sanitizeLoadedNodePosition(node: RFNode): RFNode {
  if (hasReasonableNodePosition(node)) return node;
  if (typeof console !== 'undefined') {
    console.warn('[flowgen] reset invalid node position for minimap', node.id, node.position);
  }
  return { ...node, position: { x: 0, y: 0 } };
}

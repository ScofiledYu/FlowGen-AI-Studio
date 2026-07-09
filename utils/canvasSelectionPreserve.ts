/** Shift+框选后中键拖入面板：投放成功后清除画布多选态 */

import type { Node as RFNode } from 'reactflow';

export function buildClearCanvasSelectionPatch<T extends RFNode>(nodes: T[]): T[] | null {
  if (!nodes.some((n) => n.selected)) return null;
  return nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
}

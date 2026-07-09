/** Inspector 锚点节点 id（Shift 框选 + 中键批量拖入时排除锚点自身） */

let inspectorAnchorId: string | null = null;

export function setFlowgenInspectorAnchorId(id: string | null | undefined): void {
  inspectorAnchorId = id?.trim() || null;
}

export function getFlowgenInspectorAnchorId(): string | null {
  return inspectorAnchorId;
}

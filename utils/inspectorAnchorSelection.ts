/** Inspector 锚点：Shift 追加选区时属性面板不切换；普通框选随选区更新 */

export function resolveInspectorNodeIdOnSelectionChange(args: {
  selectedNodeIds: string[];
  anchorId: string | null;
  prevId: string | null;
  suppressClear: boolean;
  preserveAnchor: boolean;
  shouldOpenInspector: (nodeId: string) => boolean;
}): { nextId: string | null; nextAnchor: string | null } {
  const { selectedNodeIds, anchorId, prevId, suppressClear, preserveAnchor, shouldOpenInspector } =
    args;

  if (selectedNodeIds.length === 0) {
    if (anchorId && preserveAnchor && suppressClear) {
      return { nextId: anchorId, nextAnchor: anchorId };
    }
    return { nextId: null, nextAnchor: null };
  }

  if (anchorId && preserveAnchor) {
    return { nextId: anchorId, nextAnchor: anchorId };
  }

  if (selectedNodeIds.length === 1 && shouldOpenInspector(selectedNodeIds[0])) {
    return { nextId: selectedNodeIds[0], nextAnchor: selectedNodeIds[0] };
  }

  if (prevId && selectedNodeIds.some((id) => id === prevId && shouldOpenInspector(id))) {
    return { nextId: prevId, nextAnchor: prevId };
  }

  const inspectorIds = selectedNodeIds.filter((id) => shouldOpenInspector(id));
  if (inspectorIds.length === 1) {
    return { nextId: inspectorIds[0], nextAnchor: inspectorIds[0] };
  }
  if (inspectorIds.length > 1 && prevId && inspectorIds.includes(prevId)) {
    return { nextId: prevId, nextAnchor: prevId };
  }
  if (inspectorIds.length > 0) {
    return { nextId: inspectorIds[0], nextAnchor: inspectorIds[0] };
  }

  return { nextId: prevId, nextAnchor: anchorId };
}

export function shouldIgnoreNodeClickForInspector(args: {
  anchorId: string | null;
  clickedNodeId: string;
  multiCount: number;
  suppressClear: boolean;
  shiftKey: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): boolean {
  if (args.shiftKey || args.ctrlKey || args.metaKey) return true;
  if (!args.anchorId || args.anchorId === args.clickedNodeId) return false;
  if (args.suppressClear) return true;
  return args.multiCount > 1;
}

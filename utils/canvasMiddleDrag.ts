/** 画布节点中键拖素材：汇总多选预览 URL，供 NodeInspector / 其它节点主预览投放 */

import type { Node as RFNode } from 'reactflow';
import type { NodeData } from '../types';
import { NodeType } from '../types';
import { pickNodeGenerationResultPreviewUrl } from './generatedOutputUrl';
import {
  isLikelyVideoMediaUrl,
  pickPersistableMainPreviewUrl,
} from './hydratePersistedNodePreviews';
import { resolveNodeSelectionPreviewUrl } from './nodeDetailsPreview';
import type { FlowgenAssetDragItem } from './middleButtonMediaDrag';
import { getFlowgenInspectorAnchorId } from './inspectorAnchorSession';
import { logMiddleDrag, summarizeMiddleDragUrl } from './middleDragDebug';
import { isEphemeralMediaUrl } from './workspaceMediaPersist';

const SKIPPABLE_NODE_TYPES = new Set<string>([NodeType.BACKDROP, NodeType.CHAIN_FOLDER]);

/** Alt+中键：画布平移手势，不得启动中键拖素材 */
export function isAltMiddlePanGesture(
  e: Pick<MouseEvent, 'altKey'> & { getModifierState?(key: string): boolean }
): boolean {
  return Boolean(e.altKey || e.getModifierState?.('Alt'));
}

export function resolveNodeElementFromTarget(target: Element | null): Element | null {
  if (!target) return null;
  const fromWrapper = target.closest('.react-flow__node');
  if (fromWrapper) return fromWrapper;
  const inner = target.closest('[data-flowgen-node-id]');
  return inner?.closest('.react-flow__node') ?? null;
}

function nodeElementById(nodeId: string): Element | null {
  if (typeof document === 'undefined') return null;
  try {
    return document.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`);
  } catch {
    return document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
  }
}

function pointInRect(x: number, y: number, r: DOMRect): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function isFlowSelectionChrome(target: Element | null): boolean {
  if (!target) return false;
  return Boolean(
    target.classList.contains('react-flow__pane') ||
      target.closest('.react-flow__nodesselection') ||
      target.closest('.react-flow__selection') ||
      target.closest('.react-flow__nodesselection-rect')
  );
}

export function nodeHasStaleBlobPreview(data: Partial<NodeData> | undefined): boolean {
  const s = String(data?.imagePreview || '').trim();
  return Boolean(s && isEphemeralMediaUrl(s, 'imagePreview'));
}

/** 中键按下时解析源节点：DOM 目标 → 命中栈 → 选区 bbox → 框选区空白处回退 */
export function resolveMiddleDragNodeHit(
  allNodes: RFNode[],
  clientX: number,
  clientY: number,
  target: Element | null
): { nodeId: string; nodeEl: Element; via: string } | null {
  const fromTarget = resolveNodeElementFromTarget(target);
  if (fromTarget) {
    const nodeId = fromTarget.getAttribute('data-id');
    if (nodeId) return { nodeId, nodeEl: fromTarget, via: 'target' };
  }

  if (typeof document !== 'undefined' && typeof document.elementsFromPoint === 'function') {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      if (!(el instanceof Element)) continue;
      const nodeEl = el.closest('.react-flow__node');
      if (!nodeEl) continue;
      const nodeId = nodeEl.getAttribute('data-id');
      if (nodeId) return { nodeId, nodeEl, via: 'stack' };
    }
  }

  const selected = allNodes.filter(
    (n) => n.selected && !SKIPPABLE_NODE_TYPES.has(String(n.type || ''))
  );
  for (const n of selected) {
    const nodeEl = nodeElementById(n.id);
    if (!nodeEl) continue;
    if (pointInRect(clientX, clientY, nodeEl.getBoundingClientRect())) {
      return { nodeId: n.id, nodeEl, via: 'selection-rect' };
    }
  }

  if (isFlowSelectionChrome(target) && selected.length > 0) {
    const anchorId = getFlowgenInspectorAnchorId();
    const draggable = selected.filter((n) =>
      Boolean(
        resolveCanvasNodeMiddleDragUrl(n.data as Partial<NodeData>, String(n.type || ''))
      )
    );
    const pick =
      draggable.find((n) => n.id !== anchorId) ||
      draggable[0] ||
      selected.find((n) => n.id !== anchorId) ||
      selected[0];
    if (pick) {
      const nodeEl = nodeElementById(pick.id);
      if (nodeEl) return { nodeId: pick.id, nodeEl, via: 'selection-fallback' };
    }
  }

  return null;
}

/** 画布中键拖出 URL：imagePreview → 选中预览 → 运行结果 → 其它可持久化主预览
 * 允许 blob/data URL（本地上传后未运行），拖放时会自动上传转持久化
 */
export function resolveCanvasNodeMiddleDragUrl(
  data: Partial<NodeData> | undefined,
  nodeType?: string
): string {
  if (!data) return '';
  const direct = String(data.imagePreview || '').trim();
  if (direct) return direct;
  const fromSelection = String(resolveNodeSelectionPreviewUrl(data) || '').trim();
  if (fromSelection) return fromSelection;
  const fromGen = String(pickNodeGenerationResultPreviewUrl(data) || '').trim();
  if (fromGen) return fromGen;
  const fromPersist = pickPersistableMainPreviewUrl(
    data as Record<string, unknown>,
    nodeType
  );
  return String(fromPersist || '').trim();
}

function nodeDragLabel(data: Partial<NodeData> | undefined): string {
  return (
    String(data?.customName || data?.imageName || data?.label || '节点').trim() || '节点'
  );
}

function toDragItem(node: RFNode, url: string): FlowgenAssetDragItem {
  const isVideo = isLikelyVideoMediaUrl(url, {
    nodeType: node.type,
    imageName: node.data?.imageName,
  });
  return {
    assetId: node.id,
    assetName: nodeDragLabel(node.data as Partial<NodeData>),
    url,
    mime: isVideo ? 'video/mp4' : 'image/png',
  };
}

/** 当前画布选区里可中键拖出的节点（含 selection 与预览 URL 判定） */
export function listCanvasMiddleDragNodes(
  allNodes: RFNode[],
  forceIncludeNodeId?: string
): RFNode[] {
  const list = allNodes.filter((n) => {
    if (!n.selected || SKIPPABLE_NODE_TYPES.has(String(n.type || ''))) return false;
    return Boolean(
      resolveCanvasNodeMiddleDragUrl(n.data as Partial<NodeData>, String(n.type || ''))
    );
  });
  if (forceIncludeNodeId && !list.some((n) => n.id === forceIncludeNodeId)) {
    const forced = allNodes.find((n) => n.id === forceIncludeNodeId);
    const url = resolveCanvasNodeMiddleDragUrl(
      forced?.data as Partial<NodeData>,
      String(forced?.type || '')
    );
    if (forced && url) list.push({ ...forced, selected: true });
  }
  return list;
}

export function buildCanvasMiddleDragStartPayload(args: {
  allNodes: RFNode[];
  sourceNodeId: string;
  sourceData: Partial<NodeData>;
  /** 面板锚点：Shift 多选中键批量拖入参考区时不打包锚点节点预览 */
  inspectorAnchorId?: string | null;
}): {
  url: string;
  kind: 'image' | 'video';
  sourceNodeId: string;
  assetId: string;
  assetName: string;
  assets?: FlowgenAssetDragItem[];
} | null {
  const sourceNode = args.allNodes.find((n) => n.id === args.sourceNodeId);
  const sourceType = String(sourceNode?.type || '');
  const sourceUrl = resolveCanvasNodeMiddleDragUrl(args.sourceData, sourceType);
  if (!sourceUrl) {
    logMiddleDrag('payload:null-no-source-url', { sourceNodeId: args.sourceNodeId });
    return null;
  }

  const sourceWasSelected = Boolean(sourceNode?.selected);
  const dragNodes = listCanvasMiddleDragNodes(args.allNodes, args.sourceNodeId);
  const peersSelected = dragNodes.filter(
    (n) => n.id !== args.sourceNodeId && n.selected
  );
  /** 多选打包：拖出节点在选区内，且另有 1+ 个已选节点；未选中拖出时仅当另有 2+ 个已选节点才打包 */
  const useMulti =
    dragNodes.length > 1 &&
    dragNodes.some((n) => n.id === args.sourceNodeId) &&
    (sourceWasSelected ? peersSelected.length > 0 : peersSelected.length >= 2);

  const nodesForPayload = useMulti
    ? dragNodes
    : [
        sourceNode ||
          ({
            id: args.sourceNodeId,
            data: args.sourceData,
            type: NodeType.PROCESSOR,
            position: { x: 0, y: 0 },
            selected: false,
          } as RFNode),
      ];

  const anchorId =
    args.inspectorAnchorId?.trim() || getFlowgenInspectorAnchorId() || null;

  let payloads = nodesForPayload
    .map((n) => {
      const url = resolveCanvasNodeMiddleDragUrl(
        n.data as Partial<NodeData>,
        String(n.type || '')
      );
      return url ? toDragItem(n, url) : null;
    })
    .filter((p): p is FlowgenAssetDragItem => p != null);

  if (anchorId && payloads.some((p) => p.assetId === anchorId)) {
    const withoutAnchor = payloads.filter((p) => p.assetId !== anchorId);
    if (withoutAnchor.length > 0) payloads = withoutAnchor;
  }

  if (payloads.length === 0 || !payloads.some((p) => p.assetId === args.sourceNodeId)) {
    if (anchorId && args.sourceNodeId === anchorId) {
      logMiddleDrag('payload:null-anchor-self', { anchorId, sourceNodeId: args.sourceNodeId });
      return null;
    }
    const fallbackNode =
      sourceNode ||
      ({
        id: args.sourceNodeId,
        data: args.sourceData,
        type: NodeType.PROCESSOR,
        position: { x: 0, y: 0 },
        selected: false,
      } as RFNode);
    payloads = [toDragItem(fallbackNode, sourceUrl)];
  }

  const bundleMulti = useMulti && payloads.length > 1;
  const primary =
    payloads.find((p) => p.assetId === args.sourceNodeId) || payloads[0];
  const isVideo = isLikelyVideoMediaUrl(primary.url, {
    imageName: primary.assetName,
  });

  return {
    url: primary.url,
    kind: isVideo ? 'video' : 'image',
    sourceNodeId: bundleMulti ? 'canvas:multi' : args.sourceNodeId,
    assetId: primary.assetId,
    assetName: primary.assetName,
    assets: bundleMulti ? payloads : undefined,
  };
}

export function debugLogCanvasMiddleDragPayload(args: {
  sourceNodeId: string;
  allNodes: RFNode[];
  payload: ReturnType<typeof buildCanvasMiddleDragStartPayload>;
}): void {
  const { sourceNodeId, allNodes, payload } = args;
  if (!payload) return;
  const sourceNode = allNodes.find((n) => n.id === sourceNodeId);
  const dragNodes = listCanvasMiddleDragNodes(allNodes, sourceNodeId);
  const anchorId = getFlowgenInspectorAnchorId();
  logMiddleDrag('payload:built', {
    sourceNodeId,
    sourceSelected: Boolean(sourceNode?.selected),
    anchorId: anchorId || null,
    selectedWithPreview: dragNodes.map((n) => n.id),
    bundle: payload.sourceNodeId === 'canvas:multi',
    assetCount: payload.assets?.length ?? 1,
    primaryUrl: summarizeMiddleDragUrl(payload.url),
    assets: payload.assets?.map((a) => ({
      id: a.assetId,
      name: a.assetName,
      url: summarizeMiddleDragUrl(a.url),
    })),
  });
}

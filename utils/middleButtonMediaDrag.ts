/** 中键从节点拖出图片/视频 URL，松手在带 data-flowgen-media-drop 的区域完成投放 */

import type { PointerEvent as ReactPointerEvent } from 'react';

export const FLOWGEN_MEDIA_URL_DROP = 'flowgen:media-url-drop';

export type FlowgenMediaUrlDropZone =
  | 'node-main'
  | 'reference'
  | 'seedance-reference'
  | 'first-frame'
  | 'last-frame'
  | 'storyboard-video'
  | 'canvas-pane';

export type FlowgenAssetDragItem = {
  assetId: string;
  assetName: string;
  url: string;
  mime: string;
  /** 列表缩略图（JPEG，远小于原图），画布预览优先使用 */
  thumbUrl?: string;
};

export type FlowgenMediaUrlDropDetail = {
  url: string;
  kind: 'image' | 'video';
  sourceNodeId: string;
  targetNodeId: string;
  dropZone: FlowgenMediaUrlDropZone;
  /** 投放到画布空白区时的屏幕坐标 */
  clientX?: number;
  clientY?: number;
  assetId?: string;
  assetName?: string;
  /** 资产库多选中键拖入画布 */
  assets?: FlowgenAssetDragItem[];
};

type Active = {
  url: string;
  kind: 'image' | 'video';
  sourceNodeId: string;
  startX: number;
  startY: number;
  pointerId: number;
  captureTarget: Element | null;
  assetId?: string;
  assetName?: string;
  assets?: FlowgenAssetDragItem[];
  /** 最近一次 pointermove 命中的 drop zone；用于松手瞬间抖动/越界时的容错 */
  lastHit?: { zone: HTMLElement; dropZone: FlowgenMediaUrlDropZone } | null;
};

let active: Active | null = null;

const DRAG_THRESHOLD_PX = 6;

const ALLOWED_DROP_ZONES: FlowgenMediaUrlDropZone[] = [
  'node-main',
  'reference',
  'seedance-reference',
  'first-frame',
  'last-frame',
  'storyboard-video',
  'canvas-pane',
];

/** 松手时优先匹配侧栏参考区，避免误命中下层画布 node-main / canvas-pane */
const DROP_ZONE_HIT_PRIORITY: FlowgenMediaUrlDropZone[] = [
  'reference',
  'seedance-reference',
  'first-frame',
  'last-frame',
  'storyboard-video',
  'node-main',
  'canvas-pane',
];

function normalizeDropZone(raw: string | null | undefined): FlowgenMediaUrlDropZone {
  const z = raw || 'node-main';
  return (ALLOWED_DROP_ZONES.includes(z as FlowgenMediaUrlDropZone)
    ? z
    : 'node-main') as FlowgenMediaUrlDropZone;
}

/** @internal exported for unit tests */
export function resolveMediaDropZoneAtPoint(
  clientX: number,
  clientY: number
): { zone: HTMLElement; dropZone: FlowgenMediaUrlDropZone } | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  let best: { zone: HTMLElement; dropZone: FlowgenMediaUrlDropZone; rank: number } | null = null;
  for (const node of stack) {
    if (!(node instanceof Element)) continue;
    const zone = node.closest('[data-flowgen-media-drop]') as HTMLElement | null;
    if (!zone) continue;
    const dropZone = normalizeDropZone(zone.getAttribute('data-flowgen-drop-zone'));
    const rank = DROP_ZONE_HIT_PRIORITY.indexOf(dropZone);
    const r = rank >= 0 ? rank : DROP_ZONE_HIT_PRIORITY.length;
    if (!best || r < best.rank) best = { zone, dropZone, rank: r };
  }
  return best ? { zone: best.zone, dropZone: best.dropZone } : null;
}

/** 鼠标松手点可能落在边缘 1-6px 外，做近邻容错提升中键拖拽“手感” */
function resolveMediaDropZoneWithTolerance(
  clientX: number,
  clientY: number
): { zone: HTMLElement; dropZone: FlowgenMediaUrlDropZone } | null {
  const direct = resolveMediaDropZoneAtPoint(clientX, clientY);
  if (direct) return direct;
  const OFFSETS: Array<[number, number]> = [
    [0, -6],
    [0, 6],
    [-6, 0],
    [6, 0],
    [-4, -4],
    [4, -4],
    [-4, 4],
    [4, 4],
  ];
  for (const [dx, dy] of OFFSETS) {
    const hit = resolveMediaDropZoneAtPoint(clientX + dx, clientY + dy);
    if (hit) return hit;
  }
  return null;
}

function clearActiveDrag() {
  if (!active) return;
  const payload = active;
  active = null;
  endListeners();
  releaseCapture(payload);
}

function onWindowBlur() {
  clearActiveDrag();
}

function releaseCapture(payload: Active) {
  try {
    payload.captureTarget?.releasePointerCapture?.(payload.pointerId);
  } catch {
    /* ignore */
  }
}

function endListeners() {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp, true);
  window.removeEventListener('pointercancel', onPointerUp, true);
  window.removeEventListener('mouseup', onMouseUp, true);
  window.removeEventListener('mousedown', onOtherMouseDown, true);
  window.removeEventListener('blur', onWindowBlur);
}

function dispatchDropAt(clientX: number, clientY: number, payload: Active) {
  const dx = clientX - payload.startX;
  const dy = clientY - payload.startY;
  if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

  const hit =
    resolveMediaDropZoneWithTolerance(clientX, clientY) ||
    payload.lastHit ||
    null;
  if (!hit) return;
  const { zone, dropZone } = hit;

  if (dropZone === 'canvas-pane') {
    const detail: FlowgenMediaUrlDropDetail = {
      url: payload.url,
      kind: payload.kind,
      sourceNodeId: payload.sourceNodeId,
      targetNodeId: '',
      dropZone: 'canvas-pane',
      clientX,
      clientY,
      assetId: payload.assetId,
      assetName: payload.assetName,
      assets: payload.assets,
    };
    window.dispatchEvent(new CustomEvent(FLOWGEN_MEDIA_URL_DROP, { detail }));
    return;
  }

  const targetNodeId = zone.getAttribute('data-flowgen-node-id');
  if (!targetNodeId) return;
  // 同节点仅禁止投放到主预览；参考图/首尾帧等侧栏区域允许从本节点画布拖入
  if (targetNodeId === payload.sourceNodeId && dropZone === 'node-main') return;

  const detail: FlowgenMediaUrlDropDetail = {
    url: payload.url,
    kind: payload.kind,
    sourceNodeId: payload.sourceNodeId,
    targetNodeId,
    dropZone,
    assetId: payload.assetId,
    assetName: payload.assetName,
  };
  window.dispatchEvent(new CustomEvent(FLOWGEN_MEDIA_URL_DROP, { detail }));
}

function finishDrag(clientX: number, clientY: number) {
  if (!active) return;
  const payload = active;
  active = null;
  endListeners();
  releaseCapture(payload);
  dispatchDropAt(clientX, clientY, payload);
}

function onPointerMove(_e: PointerEvent) {
  if (!active) return;
  active.lastHit = resolveMediaDropZoneWithTolerance(_e.clientX, _e.clientY);
}

function onPointerUp(e: PointerEvent) {
  if (!active || e.pointerId !== active.pointerId) return;
  // preventDefault 会抑制 mouseup；中键松开时 pointerup.button 常为 0
  // 左键按下时 onOtherMouseDown 已清除 active，此处 button=0 可安全视为中键结束
  if (e.button === 2) return;
  finishDrag(e.clientX, e.clientY);
}

/** pointerup 在部分环境 button 为 0；用 mouseup 兜底完成投放 */
function onMouseUp(e: MouseEvent) {
  if (!active || e.button !== 1) return;
  finishDrag(e.clientX, e.clientY);
}

function onOtherMouseDown(e: MouseEvent) {
  if (!active || e.button !== 0) return;
  clearActiveDrag();
}

function pointerIdFromEvent(e: ReactPointerEvent | PointerEvent | MouseEvent): number {
  const id = (e as PointerEvent).pointerId;
  return typeof id === 'number' ? id : 1;
}

/**
 * 在节点主预览上中键按下时调用：阻止中键滚动并开始“伪拖放”
 */
export function startMiddleButtonMediaDrag(
  e: ReactPointerEvent | PointerEvent | MouseEvent,
  p: {
    url: string;
    kind: 'image' | 'video';
    sourceNodeId: string;
    assetId?: string;
    assetName?: string;
    assets?: FlowgenAssetDragItem[];
  }
): void {
  if (e.button !== 1) return;
  if (!p.url?.trim()) return;
  e.preventDefault();
  e.stopPropagation();
  if (active) clearActiveDrag();

  const pointerId = pointerIdFromEvent(e);
  const captureTarget =
    ('currentTarget' in e && e.currentTarget instanceof Element
      ? e.currentTarget
      : e.target instanceof Element
        ? e.target
        : null);

  try {
    captureTarget?.setPointerCapture?.(pointerId);
  } catch {
    /* ignore */
  }

  active = {
    url: p.url.trim(),
    kind: p.kind,
    sourceNodeId: p.sourceNodeId,
    startX: e.clientX,
    startY: e.clientY,
    pointerId,
    captureTarget,
    assetId: p.assetId,
    assetName: p.assetName,
    assets: p.assets?.length ? p.assets : undefined,
    lastHit: null,
  };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onPointerUp, true);
  window.addEventListener('mouseup', onMouseUp, true);
  window.addEventListener('mousedown', onOtherMouseDown, true);
  window.addEventListener('blur', onWindowBlur);
}

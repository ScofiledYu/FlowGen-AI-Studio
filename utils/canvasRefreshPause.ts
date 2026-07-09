import type { CanvasPreviewLod } from './canvasPreviewLod';
import {
  shouldRenderNodeThumbnailStrip,
  zoomToCanvasPreviewLod,
} from './canvasPreviewLod';

export const CANVAS_REFRESH_PAUSE_EVENT = 'flowgen:canvas-refresh-paused';
export const CANVAS_VIEWPORT_MOVING_EVENT = 'flowgen:viewport-moving';

let canvasRefreshPausedActive = false;
let canvasViewportMovingActive = false;

/** 供新 mount 的 CustomNode 读取当前暂停态（与 FlowEditor toggle 同步） */
export function getCanvasRefreshPaused(): boolean {
  return canvasRefreshPausedActive;
}

export function setCanvasRefreshPaused(active: boolean): void {
  canvasRefreshPausedActive = active;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(CANVAS_REFRESH_PAUSE_EVENT, { detail: { active } })
    );
  }
}

export function getCanvasViewportMoving(): boolean {
  return canvasViewportMovingActive;
}

export function setCanvasViewportMoving(active: boolean): void {
  canvasViewportMovingActive = active;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(CANVAS_VIEWPORT_MOVING_EVENT, { detail: { active } })
    );
  }
}

/** CustomNode：暂停时非选中固定低档；暂停+平移/缩放时连选中也暂降档 */
export function resolvePreviewLodWithPause(
  zoom: number,
  selected: boolean,
  paused: boolean,
  viewportMoving = false
): CanvasPreviewLod {
  if (paused && (viewportMoving || !selected)) return 'low';
  return zoomToCanvasPreviewLod(zoom, selected);
}

/** 暂停时非选中节点不渲染缩略图条 */
export function shouldRenderNodeThumbnailsWhenPaused(
  hasThumbnails: boolean,
  lod: CanvasPreviewLod,
  paused: boolean,
  selected: boolean
): boolean {
  return (
    hasThumbnails &&
    shouldRenderNodeThumbnailStrip(lod) &&
    !(paused && !selected)
  );
}

/** 暂停时非选中节点仅揭示首批缩略图 */
export function resolveVisibleThumbCountWhenPaused(
  total: number,
  paused: boolean,
  selected: boolean,
  initialCount: number
): number {
  if (!paused) return total;
  if (!selected && total > initialCount) return initialCount;
  return total;
}

/** FlowEditor：Phase2 高级模式 + 拖拽 perf 合并 */
export function isGraphSideEffectPaused(
  isDragPerformanceMode: boolean,
  isCanvasRefreshPaused: boolean,
  isCanvasPerfAdvanced: boolean
): boolean {
  return isDragPerformanceMode || (isCanvasRefreshPaused && isCanvasPerfAdvanced);
}

/** 多节点模拟：统计 zoom 变化导致的 LOD 换档次数 */
export function countLodTransitionsForNodes(
  nodeCount: number,
  zoomSamples: number[],
  paused: boolean,
  selectedIndex: number | null
): number {
  let transitions = 0;
  let prevLods: CanvasPreviewLod[] | null = null;
  for (const zoom of zoomSamples) {
    const lods: CanvasPreviewLod[] = [];
    for (let i = 0; i < nodeCount; i++) {
      const selected = selectedIndex === i;
      lods.push(resolvePreviewLodWithPause(zoom, selected, paused));
    }
    if (prevLods) {
      for (let i = 0; i < nodeCount; i++) {
        if (prevLods[i] !== lods[i]) transitions++;
      }
    }
    prevLods = lods;
  }
  return transitions;
}

/** useStore 选择器：暂停且非选中时返回常量 zoom，避免缩放触发全图重渲染 */
export function selectViewportZoomForNode(
  transformZoom: number,
  paused: boolean,
  selected: boolean,
  viewportMoving = false
): number {
  if (paused && (viewportMoving || !selected)) return 1;
  return transformZoom;
}

/** 暂停时非选中节点不挂载 video 解码（有 poster 则仅显示静图） */
export function shouldDeferVideoDecodeWhenPaused(
  paused: boolean,
  selected: boolean,
  hasPoster: boolean,
  isPlaying: boolean
): boolean {
  return paused && !selected && hasPoster && !isPlaying;
}

/** MiniMap viewBox / 尺寸纯函数，供 FlowgenMiniMap 与回归测试共用 */

export type FlowRect = { x: number; y: number; width: number; height: number };

export type MiniMapViewBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  viewScale: number;
};

export type MiniMapElementSize = {
  width: number;
  height: number;
};

const BASE_WIDTH = 150;
const MIN_HEIGHT = 150;
const MAX_HEIGHT = 150;

/** MiniMap 隐藏类型：背景框与链折叠夹本身不触发导航地图显示 */
const MINIMAP_HIDDEN_NODE_TYPES = new Set(['backdropNode', 'chainFolderNode']);

/** 判断当前画布是否应显示 MiniMap：存在至少一个非隐藏类型节点时返回 true */
export function hasVisibleMiniMapNodes(nodes: Array<{ type?: string }>): boolean {
  return nodes.some((n) => !MINIMAP_HIDDEN_NODE_TYPES.has(n.type || ''));
}

/** 纵向分镜工程：按节点 bounds 宽高比抬高 MiniMap，避免节点缩成亚像素 */
export function computeAdaptiveMiniMapSize(
  bounds: FlowRect,
  opts?: { baseWidth?: number; minHeight?: number; maxHeight?: number },
): MiniMapElementSize {
  const baseWidth = opts?.baseWidth ?? BASE_WIDTH;
  const minHeight = opts?.minHeight ?? MIN_HEIGHT;
  const maxHeight = opts?.maxHeight ?? MAX_HEIGHT;
  const w = Math.max(1, bounds.width);
  const h = Math.max(1, bounds.height);
  const aspect = h / w;
  const height = Math.round(Math.min(maxHeight, Math.max(minHeight, baseWidth * aspect)));
  return { width: baseWidth, height };
}

/** 与 @reactflow/minimap 一致，但 boundingRect 不含 viewBB 并集 */
export function computeMiniMapViewBox(
  boundingRect: FlowRect,
  elementWidth: number,
  elementHeight: number,
  offsetScale = 5,
): MiniMapViewBox {
  const scaledWidth = boundingRect.width / elementWidth;
  const scaledHeight = boundingRect.height / elementHeight;
  const viewScale = Math.max(scaledWidth, scaledHeight);
  const viewWidth = viewScale * elementWidth;
  const viewHeight = viewScale * elementHeight;
  const offset = offsetScale * viewScale;
  const x = boundingRect.x - (viewWidth - boundingRect.width) / 2 - offset;
  const y = boundingRect.y - (viewHeight - boundingRect.height) / 2 - offset;
  const width = viewWidth + offset * 2;
  const height = viewHeight + offset * 2;
  return { x, y, width, height, viewScale };
}

/** 估算节点在 MiniMap SVG 像素上的最小边长（用于回归：缩放后仍应可见） */
export function estimateMinNodePixelSize(
  nodeWidth: number,
  nodeHeight: number,
  viewBox: MiniMapViewBox,
  elementWidth: number,
  elementHeight: number,
): number {
  const pxW = (nodeWidth / viewBox.width) * elementWidth;
  const pxH = (nodeHeight / viewBox.height) * elementHeight;
  return Math.min(pxW, pxH);
}

/** viewBB 并集会把 viewBox 撑大；本函数用于测试「不含 viewBB」策略 */
export function computeMiniMapViewBoxWithViewUnion(
  boundingRect: FlowRect,
  viewBB: FlowRect,
  elementWidth: number,
  elementHeight: number,
  offsetScale = 5,
): MiniMapViewBox {
  const union = {
    x: Math.min(boundingRect.x, viewBB.x),
    y: Math.min(boundingRect.y, viewBB.y),
    width:
      Math.max(boundingRect.x + boundingRect.width, viewBB.x + viewBB.width) -
      Math.min(boundingRect.x, viewBB.x),
    height:
      Math.max(boundingRect.y + boundingRect.height, viewBB.y + viewBB.height) -
      Math.min(boundingRect.y, viewBB.y),
  };
  return computeMiniMapViewBox(union, elementWidth, elementHeight, offsetScale);
}

/**
 * 节点 bounds 为主、视口并集为辅的 viewBox：
 * - 以节点 bounds 计算 base viewBox（保证节点始终可见）
 * - 若视口指示框溢出 base viewBox，则扩展至包含视口，但宽/高不超过 base 的 2 倍
 * - 超上限时以 base 中心定位，确保节点始终在 minimap 内
 */
export function computeMiniMapViewBoxWithViewportCap(
  boundingRect: FlowRect,
  viewBB: FlowRect,
  elementWidth: number,
  elementHeight: number,
  offsetScale = 5,
): MiniMapViewBox {
  const base = computeMiniMapViewBox(boundingRect, elementWidth, elementHeight, offsetScale);
  const viewLeft = viewBB.x;
  const viewTop = viewBB.y;
  const viewRight = viewBB.x + viewBB.width;
  const viewBottom = viewBB.y + viewBB.height;
  const baseLeft = base.x;
  const baseTop = base.y;
  const baseRight = base.x + base.width;
  const baseBottom = base.y + base.height;
  const overflowLeft = viewLeft < baseLeft;
  const overflowTop = viewTop < baseTop;
  const overflowRight = viewRight > baseRight;
  const overflowBottom = viewBottom > baseBottom;
  if (!overflowLeft && !overflowTop && !overflowRight && !overflowBottom) {
    return base;
  }
  const capW = base.width * 2;
  const capH = base.height * 2;
  const unionX = Math.min(baseLeft, viewLeft);
  const unionY = Math.min(baseTop, viewTop);
  const unionRight = Math.max(baseRight, viewRight);
  const unionBottom = Math.max(baseBottom, viewBottom);
  let newW = unionRight - unionX;
  let newH = unionBottom - unionY;
  let newX = unionX;
  let newY = unionY;
  if (newW > capW) {
    newW = capW;
    // 以 base 中心定位，保证节点始终在 viewBox 内
    newX = baseLeft + base.width / 2 - capW / 2;
    // 尽可能向视口方向偏移，但不排除 base
    if (overflowLeft && !overflowRight) {
      newX = Math.max(viewLeft, baseRight - capW);
    } else if (overflowRight && !overflowLeft) {
      newX = Math.min(viewRight - capW, baseLeft);
    }
    newX = Math.min(newX, baseLeft);
    newX = Math.max(newX, baseRight - capW);
  }
  if (newH > capH) {
    newH = capH;
    newY = baseTop + base.height / 2 - capH / 2;
    if (overflowTop && !overflowBottom) {
      newY = Math.max(viewTop, baseBottom - capH);
    } else if (overflowBottom && !overflowTop) {
      newY = Math.min(viewBottom - capH, baseTop);
    }
    newY = Math.min(newY, baseTop);
    newY = Math.max(newY, baseBottom - capH);
  }
  return {
    x: newX,
    y: newY,
    width: newW,
    height: newH,
    viewScale: newW / elementWidth,
  };
}

/** 视口指示框裁剪到 viewBox 外框内，避免 evenodd 蒙版盖住全部节点 */
export function buildMiniMapMaskPath(
  viewBox: Pick<MiniMapViewBox, 'x' | 'y' | 'width' | 'height'>,
  viewBB: FlowRect,
  offsetScale: number,
  viewScale: number,
): string {
  const offset = offsetScale * viewScale;
  const outerX = viewBox.x - offset;
  const outerY = viewBox.y - offset;
  const outerW = viewBox.width + offset * 2;
  const outerH = viewBox.height + offset * 2;
  const cx = Math.max(viewBB.x, outerX);
  const cy = Math.max(viewBB.y, outerY);
  const cRight = Math.min(viewBB.x + viewBB.width, outerX + outerW);
  const cBottom = Math.min(viewBB.y + viewBB.height, outerY + outerH);
  const cw = Math.max(0, cRight - cx);
  const ch = Math.max(0, cBottom - cy);
  const outer = `M${outerX},${outerY}h${outerW}v${outerH}h${-outerW}z`;
  if (cw > 0 && ch > 0) {
    return `${outer}M${cx},${cy}h${cw}v${ch}h${-cw}z`;
  }
  return outer;
}

/** 节点 bounds 是否完全落在 viewBox 内 */
export function areNodeBoundsInsideViewBox(
  nodeBounds: FlowRect,
  viewBox: Pick<MiniMapViewBox, 'x' | 'y' | 'width' | 'height'>,
): boolean {
  return (
    nodeBounds.x >= viewBox.x &&
    nodeBounds.y >= viewBox.y &&
    nodeBounds.x + nodeBounds.width <= viewBox.x + viewBox.width &&
    nodeBounds.y + nodeBounds.height <= viewBox.y + viewBox.height
  );
}

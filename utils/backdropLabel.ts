/** 背景框标签：与 FlowEditor getBackdropFlowRect 一致的 flow 尺寸读取 */

export function parseBackdropFlowSize(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

export type BackdropFlowSize = { w: number; h: number };

export function getBackdropFlowSizeFromNode(
  node:
    | {
        width?: unknown;
        height?: unknown;
        style?: { width?: unknown; height?: unknown };
      }
    | undefined
): BackdropFlowSize {
  const st = node?.style;
  let w = typeof node?.width === 'number' && node.width >= 48 ? node.width : undefined;
  let h = typeof node?.height === 'number' && node.height >= 48 ? node.height : undefined;
  w = w ?? parseBackdropFlowSize(st?.width, 280);
  h = h ?? parseBackdropFlowSize(st?.height, 200);
  return { w, h };
}

export type BackdropLabelPresentation = {
  /** 屏幕像素字号（再经 counter-scale 抵消视口 zoom） */
  fontPx: number;
  /** 1/zoom，用于标签 counter-scale */
  invZoom: number;
  /** 标签与框顶间距（flow 坐标，对应固定屏幕像素） */
  gapFlowPx: number;
};

const LABEL_SCREEN_PX = 26;
const PLACEHOLDER_SCREEN_PX = 18;
const GAP_SCREEN_PX = 6;

/**
 * 背景框标签呈现：固定屏幕像素 + counter-scale，所有背景框缩放/平移时行为一致。
 */
export function resolveBackdropLabelPresentation(
  isCustomName: boolean,
  zoom: number
): BackdropLabelPresentation {
  const z = Math.max(zoom, 0.06);
  return {
    fontPx: isCustomName ? LABEL_SCREEN_PX : PLACEHOLDER_SCREEN_PX,
    invZoom: 1 / z,
    gapFlowPx: GAP_SCREEN_PX / z,
  };
}

/** @deprecated 仅测试对照：flow 字号方案 */
export function resolveBackdropLabelFontSize(isCustomName: boolean, zoom: number): number {
  const p = resolveBackdropLabelPresentation(isCustomName, zoom);
  return p.fontPx * p.invZoom;
}

export function backdropLabelScreenPx(flowFontSize: number, zoom: number): number {
  return flowFontSize * Math.max(zoom, 0.06);
}

/** 测试：counter-scale 后屏幕高度应恒定 */
export function backdropLabelScreenHeightFromPresentation(
  presentation: BackdropLabelPresentation,
  zoom: number
): number {
  const z = Math.max(zoom, 0.06);
  return presentation.fontPx * presentation.invZoom * z;
}

/** 缩放/平移/拖拽角点后短暂禁止进入标题编辑（毫秒） */
export const BACKDROP_LABEL_EDIT_BLOCK_MS = {
  afterWheelOrViewport: 650,
  afterResize: 900,
} as const;

export function shouldBlockBackdropLabelEdit(input: {
  now: number;
  blockUntil: number;
  viewportMoving: boolean;
}): boolean {
  if (input.viewportMoving) return true;
  return input.now < input.blockUntil;
}

/** flow 尺寸变化且非首次测量 → 视为 resize，应屏蔽编辑 */
export function backdropFlowSizeChanged(
  prev: BackdropFlowSize,
  next: BackdropFlowSize
): boolean {
  return prev.w !== next.w || prev.h !== next.h;
}

export function nextBackdropLabelEditBlockUntil(
  now: number,
  kind: keyof typeof BACKDROP_LABEL_EDIT_BLOCK_MS
): number {
  return now + BACKDROP_LABEL_EDIT_BLOCK_MS[kind];
}

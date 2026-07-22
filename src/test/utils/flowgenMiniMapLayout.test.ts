import { describe, expect, it } from 'vitest';
import {
  computeAdaptiveMiniMapSize,
  computeMiniMapViewBox,
  computeMiniMapViewBoxWithViewUnion,
  computeMiniMapViewBoxWithViewportCap,
  estimateMinNodePixelSize,
  hasVisibleMiniMapNodes,
} from '../../../utils/flowgenMiniMapLayout';

/** workspace/14 量级：219 节点、纵向分镜 */
const STORYBOARD_BOUNDS = { x: -4609, y: 6, width: 7472, height: 43099 };
const TYPICAL_NODE = { width: 324, height: 240 };

describe('flowgenMiniMapLayout', () => {
  it('fixed size returns 150x150 for any layout', () => {
    const size = computeAdaptiveMiniMapSize(STORYBOARD_BOUNDS);
    expect(size.width).toBe(150);
    expect(size.height).toBe(150);
  });

  it('nodes-only viewBox stays stable when viewport is zoomed out (no viewBB union)', () => {
    const size = computeAdaptiveMiniMapSize(STORYBOARD_BOUNDS);
    const nodesOnly = computeMiniMapViewBox(STORYBOARD_BOUNDS, size.width, size.height);
    // scale≈0.08 时视口在 flow 空间极宽，并集会撑大 viewBox（用户反馈「缩放后看不见节点」）
    const zoomedOutView = { x: -12000, y: 8000, width: 60338, height: 44295 };
    const withUnion = computeMiniMapViewBoxWithViewUnion(
      STORYBOARD_BOUNDS,
      zoomedOutView,
      size.width,
      size.height,
    );
    expect(withUnion.width).toBeGreaterThan(nodesOnly.width * 1.2);
    expect(nodesOnly.viewScale).toBeLessThan(withUnion.viewScale);
  });

  it('typical project nodes stay visible on minimap (>=2px) with fixed 150x150', () => {
    // 使用均衡宽高比的 bounds，确保 150x150 固定尺寸下节点仍 >=2px
    const balancedBounds = { x: 0, y: 0, width: 12000, height: 8000 };
    const size = computeAdaptiveMiniMapSize(balancedBounds);
    expect(size).toEqual({ width: 150, height: 150 });
    const viewBox = computeMiniMapViewBox(balancedBounds, size.width, size.height);
    const px = estimateMinNodePixelSize(
      TYPICAL_NODE.width,
      TYPICAL_NODE.height,
      viewBox,
      size.width,
      size.height,
    );
    expect(px).toBeGreaterThanOrEqual(2);
  });

  it('wide layouts keep fixed 150x150 footprint', () => {
    const wide = { x: 0, y: 0, width: 8000, height: 2000 };
    const size = computeAdaptiveMiniMapSize(wide);
    expect(size).toEqual({ width: 150, height: 150 });
  });

  it('viewportCap: viewport inside bounds → same as base', () => {
    const bounds = { x: 0, y: 0, width: 1000, height: 500 };
    const size = computeAdaptiveMiniMapSize(bounds);
    const viewportInside = { x: 200, y: 100, width: 400, height: 200 };
    const capped = computeMiniMapViewBoxWithViewportCap(bounds, viewportInside, size.width, size.height);
    const base = computeMiniMapViewBox(bounds, size.width, size.height);
    expect(capped.x).toBe(base.x);
    expect(capped.width).toBe(base.width);
  });

  it('viewportCap: viewport overflows → expands to include viewport', () => {
    const bounds = { x: 0, y: 0, width: 1000, height: 500 };
    const size = computeAdaptiveMiniMapSize(bounds);
    const viewportOverflow = { x: -500, y: -200, width: 300, height: 200 };
    const capped = computeMiniMapViewBoxWithViewportCap(bounds, viewportOverflow, size.width, size.height);
    const base = computeMiniMapViewBox(bounds, size.width, size.height);
    // viewBox 应扩展以包含溢出的视口
    expect(capped.x).toBeLessThan(base.x);
    expect(capped.width).toBeGreaterThan(base.width);
  });

  it('viewportCap: extreme zoom-out → capped at 2x base, nodes still inside', () => {
    const bounds = { x: 0, y: 0, width: 1000, height: 500 };
    const size = computeAdaptiveMiniMapSize(bounds);
    const base = computeMiniMapViewBox(bounds, size.width, size.height);
    const extremeViewport = { x: -50000, y: -20000, width: 100000, height: 50000 };
    const capped = computeMiniMapViewBoxWithViewportCap(bounds, extremeViewport, size.width, size.height);
    // 不超过 base 的 2 倍
    expect(capped.width).toBeLessThanOrEqual(base.width * 2 + 1);
    expect(capped.height).toBeLessThanOrEqual(base.height * 2 + 1);
    // 节点 bounds 仍在 viewBox 内（核心：不能丢节点）
    expect(capped.x).toBeLessThanOrEqual(bounds.x);
    expect(capped.x + capped.width).toBeGreaterThanOrEqual(bounds.x + bounds.width);
    expect(capped.y).toBeLessThanOrEqual(bounds.y);
    expect(capped.y + capped.height).toBeGreaterThanOrEqual(bounds.y + bounds.height);
  });

  it('viewportCap: nodes still visible (>=2px) after expansion', () => {
    const bounds = { x: 0, y: 0, width: 1000, height: 500 };
    const size = computeAdaptiveMiniMapSize(bounds);
    const viewportOverflow = { x: -300, y: -100, width: 200, height: 150 };
    const capped = computeMiniMapViewBoxWithViewportCap(bounds, viewportOverflow, size.width, size.height);
    const px = estimateMinNodePixelSize(200, 150, capped, size.width, size.height);
    expect(px).toBeGreaterThanOrEqual(2);
  });

  it('hasVisibleMiniMapNodes: empty canvas should not show MiniMap', () => {
    expect(hasVisibleMiniMapNodes([])).toBe(false);
  });

  it('hasVisibleMiniMapNodes: only backdrop/chainFolder should not show MiniMap', () => {
    expect(
      hasVisibleMiniMapNodes([
        { type: 'backdropNode' },
        { type: 'chainFolderNode' },
      ]),
    ).toBe(false);
  });

  it('hasVisibleMiniMapNodes: any working node should show MiniMap', () => {
    expect(hasVisibleMiniMapNodes([{ type: 'inputNode' }])).toBe(true);
    expect(hasVisibleMiniMapNodes([{ type: 'processorNode' }])).toBe(true);
    expect(hasVisibleMiniMapNodes([{ type: 'outputNode' }])).toBe(true);
    expect(hasVisibleMiniMapNodes([{ type: 'movNode' }])).toBe(true);
    // 混合场景：背景框 + 工作节点
    expect(
      hasVisibleMiniMapNodes([
        { type: 'backdropNode' },
        { type: 'inputNode' },
      ]),
    ).toBe(true);
  });
});

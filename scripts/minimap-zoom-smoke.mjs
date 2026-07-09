/**
 * MiniMap 缩放/视口/蒙版 smoke 测试
 * node scripts/minimap-zoom-smoke.mjs
 */
import {
  computeAdaptiveMiniMapSize,
  computeMiniMapViewBox,
  computeMiniMapViewBoxWithViewportCap,
  buildMiniMapMaskPath,
  areNodeBoundsInsideViewBox,
  estimateMinNodePixelSize,
} from '../utils/flowgenMiniMapLayout.ts';

let pass = 0;
let fail = 0;

function ok(name, cond, detail) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

console.log('\n=== MiniMap 缩放 smoke ===\n');

// 用户场景：2 个 Input Picture Node（类似 d:\8888 + d:\777 导入后）
const twoNodesBounds = { x: 2812, y: 33240, width: 547, height: 428 };
const size = computeAdaptiveMiniMapSize(twoNodesBounds);
ok('2 节点 adaptive size', size.width === 200 && size.height >= 150);

const baseVb = computeMiniMapViewBox(twoNodesBounds, size.width, size.height);
const px = estimateMinNodePixelSize(200, 215, baseVb, size.width, size.height);
ok('2 节点 minimap 像素 >= 4px', px >= 4, String(px.toFixed(1)));

// 缩放前视口（fit view）
const viewFit = { x: 2785, y: 33187, width: 601, height: 534 };
const vbFit = computeMiniMapViewBoxWithViewportCap(twoNodesBounds, viewFit, size.width, size.height);
ok('fit view: 节点在 viewBox 内', areNodeBoundsInsideViewBox(twoNodesBounds, vbFit));
const maskFit = buildMiniMapMaskPath(vbFit, viewFit, 5, vbFit.viewScale);
ok('fit view: mask 有视口洞', maskFit.split('M').length >= 3, maskFit.slice(0, 80));

// 放大 4 次后视口缩小
const viewZoomed = { x: 2193, y: 32970, width: 195, height: 875 };
const vbZoom = computeMiniMapViewBoxWithViewportCap(twoNodesBounds, viewZoomed, size.width, size.height);
ok('zoom in: 节点仍在 viewBox 内', areNodeBoundsInsideViewBox(twoNodesBounds, vbZoom));
ok('zoom in: viewBox 不无限膨胀', vbZoom.width <= baseVb.width * 2 + 1, String(vbZoom.width.toFixed(0)));
const maskZoom = buildMiniMapMaskPath(vbZoom, viewZoomed, 5, vbZoom.viewScale);
ok('zoom in: mask 有视口洞', maskZoom.split('M').length >= 3);

// 视口完全溢出 viewBox（用户之前报告的 bug）
const viewFar = { x: -50000, y: -20000, width: 100000, height: 50000 };
const vbFar = computeMiniMapViewBoxWithViewportCap(twoNodesBounds, viewFar, size.width, size.height);
ok('极端视口: 节点仍在 viewBox 内', areNodeBoundsInsideViewBox(twoNodesBounds, vbFar));
const maskFar = buildMiniMapMaskPath(vbFar, viewFar, 5, vbFar.viewScale);
ok('极端视口: mask 无内洞（视口完全在外）', maskFar.split('M').length === 2, maskFar.slice(0, 60));
const pxFar = estimateMinNodePixelSize(200, 215, vbFar, size.width, size.height);
ok('极端视口: 节点仍 >= 2px', pxFar >= 2, String(pxFar.toFixed(1)));

// 视口指示框应随缩放变化
ok(
  'zoom 后视口宽度小于 fit',
  viewZoomed.width < viewFit.width,
  `${viewZoomed.width.toFixed(0)} < ${viewFit.width.toFixed(0)}`,
);

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
console.log('MiniMap smoke 全部通过。\n');

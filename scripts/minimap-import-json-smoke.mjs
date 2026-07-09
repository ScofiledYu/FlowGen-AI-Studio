/**
 * 用 d:\8888.json + d:\777.json 节点 bounds 验证 MiniMap layout
 * node scripts/minimap-import-json-smoke.mjs
 */
import fs from 'node:fs';
import {
  computeAdaptiveMiniMapSize,
  computeMiniMapViewBoxWithViewportCap,
  areNodeBoundsInsideViewBox,
  buildMiniMapMaskPath,
  estimateMinNodePixelSize,
} from '../utils/flowgenMiniMapLayout.ts';

const NODE_W = 200;
const NODE_H = 215;

function boundsFromNodes(nodes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const x = n.position?.x ?? 0;
    const y = n.position?.y ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + NODE_W);
    maxY = Math.max(maxY, y + NODE_H);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function loadJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

console.log('\n=== MiniMap 导入 JSON smoke ===\n');

for (const file of ['d:/8888.json', 'd:/777.json']) {
  if (!fs.existsSync(file)) {
    ok(`${file} 存在`, false);
    continue;
  }
  const data = loadJson(file);
  const bounds = boundsFromNodes(data.nodes || []);
  const size = computeAdaptiveMiniMapSize(bounds);
  const viewFit = {
    x: bounds.x - 50,
    y: bounds.y - 50,
    width: bounds.width + 100,
    height: bounds.height + 100,
  };
  const vb = computeMiniMapViewBoxWithViewportCap(bounds, viewFit, size.width, size.height);
  const px = estimateMinNodePixelSize(NODE_W, NODE_H, vb, size.width, size.height);
  ok(`${file}: 节点在 viewBox 内`, areNodeBoundsInsideViewBox(bounds, vb));
  ok(`${file}: 节点 >= 2px`, px >= 2, px.toFixed(1));
  const mask = buildMiniMapMaskPath(vb, viewFit, 5, vb.viewScale);
  ok(`${file}: mask 有效`, mask.startsWith('M') && mask.includes('h'));
}

// 合并两文件节点（模拟导入多节点）
const merged = {
  nodes: [...loadJson('d:/8888.json').nodes, ...loadJson('d:/777.json').nodes],
};
const mergedBounds = boundsFromNodes(merged.nodes);
const mergedSize = computeAdaptiveMiniMapSize(mergedBounds);
const mergedView = {
  x: mergedBounds.x - 80,
  y: mergedBounds.y - 80,
  width: mergedBounds.width + 160,
  height: mergedBounds.height + 160,
};
const mergedVb = computeMiniMapViewBoxWithViewportCap(
  mergedBounds,
  mergedView,
  mergedSize.width,
  mergedSize.height,
);
ok('8888+777 合并: 节点在 viewBox 内', areNodeBoundsInsideViewBox(mergedBounds, mergedVb));
ok(
  '8888+777 合并: 节点像素 >= 2px',
  estimateMinNodePixelSize(NODE_W, NODE_H, mergedVb, mergedSize.width, mergedSize.height) >= 2,
);

// 缩放视口跟踪
const zoomView = {
  x: mergedBounds.x + 100,
  y: mergedBounds.y + 50,
  width: 200,
  height: 180,
};
const zoomVb = computeMiniMapViewBoxWithViewportCap(
  mergedBounds,
  zoomView,
  mergedSize.width,
  mergedSize.height,
);
ok('合并 zoom: 节点仍在 viewBox 内', areNodeBoundsInsideViewBox(mergedBounds, zoomVb));
ok('合并 zoom: 视口洞存在', buildMiniMapMaskPath(zoomVb, zoomView, 5, zoomVb.viewScale).split('M').length >= 3);

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
console.log('导入 JSON MiniMap smoke 全部通过。\n');

/** 与 utils/canvasPreviewLod.ts 阈值保持一致的手测脚本 */
function quantizeCanvasZoom(zoom) {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1;
  if (zoom < 0.28) return 0.2;
  if (zoom < 0.55) return 0.45;
  return 1;
}
function zoomToCanvasPreviewLod(zoom, selected = false) {
  if (selected) return 'high';
  const z = quantizeCanvasZoom(zoom);
  if (z < 0.28) return 'low';
  if (z < 0.55) return 'medium';
  return 'high';
}
let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  }
}
assert(quantizeCanvasZoom(0.1) === 0.2, 'low zoom');
assert(zoomToCanvasPreviewLod(0.1) === 'low', 'lod low');
assert(zoomToCanvasPreviewLod(0.1, true) === 'high', 'selected high');
assert(zoomToCanvasPreviewLod(0.5) === 'medium', 'lod medium');
if (failed) process.exit(1);
console.log('test-canvas-preview-lod: ok');

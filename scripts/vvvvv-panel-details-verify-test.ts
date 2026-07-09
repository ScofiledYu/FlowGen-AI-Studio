/**
 * vvvvv.json：Nano @图片5+@图片2+@图片6 — Node Details 只展示 gp 3 张 + prompt 标签。
 * npx tsx scripts/vvvvv-panel-details-verify-test.ts [path]
 */
import fs from 'node:fs';
import type { NodeData } from '../types.ts';
import { MODEL_NANO_BANANA_2 } from '../types.ts';
import { buildReferenceImageDetailItemsFromPanel } from '../utils/promptMediaRefs.ts';
import { buildImageGenOutputReferenceDetailsFromSnapshot } from '../utils/nodeDetailsPreview.ts';
import { resolveCanvasNodePreviewUrl } from '../utils/referencedMediaRun.ts';

const FIXTURE = process.argv[2] || 'd:/vvvvv.json';

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as {
  nodes: Array<{ id: string; type: string; data: NodeData }>;
};
const proc = raw.nodes.find((n) => n.type === 'processorNode');
const out = raw.nodes.find((n) => n.type === 'outputNode');
if (!proc) throw new Error('no processor node');

const d = proc.data;
const gp = d.generationParams!;
const prompt = String(d.prompt || gp.prompt || '').trim();

console.log(`\n=== vvvvv panel-details verify (${FIXTURE}) ===\n`);

const panelAll = buildReferenceImageDetailItemsFromPanel(d);
ok(`面板 ${panelAll.length} 槽保留`, panelAll.length >= 3);

const procDetails = buildImageGenOutputReferenceDetailsFromSnapshot({
  snapshotRefs: (gp.referenceImages || []).filter(Boolean),
  snapshotLabels: gp.referenceImageLabels,
  prompt,
});
ok('上游 Details 3 张', procDetails.referenceImages.length === 3, `got ${procDetails.referenceImages.length}`);
ok(
  '上游 Details 标签=图片5+图片2+图片6',
  procDetails.referenceImageDetailItems.map((i) => i.label).join('+') === '图片5+图片2+图片6',
  procDetails.referenceImageDetailItems.map((i) => i.label).join('+')
);
ok('无未 @ data URL', !procDetails.referenceImages.some((u) => /^data:/i.test(u)));
ok('无「主图」标签', !procDetails.referenceImageDetailItems.some((i) => i.label === '主图'));
ok(
  '画布缩略图=Details 首张',
  resolveCanvasNodePreviewUrl(d) === procDetails.referenceImages[0],
  `${String(resolveCanvasNodePreviewUrl(d)).slice(-32)} vs ${String(procDetails.referenceImages[0]).slice(-32)}`
);

if (out?.data?.generationParams?.referenceImages?.length) {
  const outGp = out.data.generationParams;
  const outDetails = buildImageGenOutputReferenceDetailsFromSnapshot({
    snapshotRefs: outGp.referenceImages!.filter(Boolean),
    snapshotLabels: outGp.referenceImageLabels,
    prompt: String(outGp.prompt || prompt),
    outputImagePreview: out.data.imagePreview,
    isRunSnapshotRef: (u) => /^https?:\/\//i.test(u) && u.includes('openApi'),
    isSameAsOutput: () => false,
  });
  ok('OUTPUT Details 3 张', outDetails.referenceImages.length === 3);
  ok(
    'OUTPUT 标签跟 prompt',
    outDetails.referenceImageDetailItems.map((i) => i.label).join('+') === '图片5+图片2+图片6'
  );
}

console.log(`\n=== 汇总: ${pass} 通过, ${fail} 失败 ===\n`);
if (fail > 0) process.exit(1);

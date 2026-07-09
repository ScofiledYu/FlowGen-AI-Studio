/**
 * 复现 2026070607.json：Banana2 空 prompt + panelMainImageUrl 遗留 → 画布缩略图误为图片1
 * npx tsx scripts/banana-thumb-2026070607-test.ts
 */
import { readFileSync } from 'node:fs';
import { sanitizePersistValueDeep } from '../utils/persistSanitize.mjs';
import { hydrateNodeImagePreviewFromPersisted } from '../utils/hydratePersistedNodePreviews.ts';
import {
  buildStalePanelMainBackupClearPatch,
  resolveCanvasNodePreviewUrl,
} from '../utils/referencedMediaRun.ts';
import { nodeUsesHiddenMainPreviewSlot } from '../utils/nodeDetailsPreview.ts';
import type { NodeData } from '../types.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const raw = JSON.parse(readFileSync('d:/json/2026070607.json', 'utf8'));
const node = raw.nodes[0];
const data = node.data as NodeData;

const mainPreview = data.imagePreview;
const ref0 = data.referenceImages?.[0];

console.log('\n=== 2026070607 编辑态（blob 未 sanitize）===\n');
ok('有主图 imagePreview', Boolean(mainPreview), String(mainPreview || '').slice(0, 40));
ok(
  '空 prompt 时 hiddenMain=false',
  !nodeUsesHiddenMainPreviewSlot(data),
  String(nodeUsesHiddenMainPreviewSlot(data))
);
ok(
  '画布缩略图=主图非 ref0',
  resolveCanvasNodePreviewUrl(data) === mainPreview,
  `${String(resolveCanvasNodePreviewUrl(data) || '').slice(0, 40)} vs ref0 ${String(ref0 || '').slice(0, 40)}`
);

const stalePatch = buildStalePanelMainBackupClearPatch(data);
ok('应清遗留 panelMainImageUrl', Boolean(stalePatch?.panelMainImageUrl === undefined));

console.log('\n=== 模拟刷新（sanitize + hydrate 主预览）===\n');
const saved = sanitizePersistValueDeep({ data }) as { data: NodeData };
const hydrated = hydrateNodeImagePreviewFromPersisted({
  id: node.id,
  type: node.type,
  data: saved.data as unknown as Record<string, unknown>,
});
const afterSanitize = hydrated.data as unknown as NodeData;
ok('sanitize 后 imageLocalRef 保留', Boolean(afterSanitize.imageLocalRef));
ok(
  'sanitize 后 imagePreview 为空(待 IDB)',
  !String(afterSanitize.imagePreview || '').trim(),
  String(afterSanitize.imagePreview || '')
);
ok(
  'hydrate 不把 ref0 写入 imagePreview',
  String(afterSanitize.imagePreview || '') !== String(ref0 || ''),
  String(afterSanitize.imagePreview || '').slice(0, 40)
);

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);

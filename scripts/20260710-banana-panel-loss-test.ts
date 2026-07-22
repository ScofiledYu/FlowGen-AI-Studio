/**
 * 复现 d:/json/banana-丢图.json（fixture: scripts/fixtures/20260710-banana-panel-loss.json）：
 * Nano Banana 2.0 拖入 4 张参考图，@图片1+@图片4 运行后：
 * - 数据层 referenceImages 仍为 4（banana-panel-clobber 已覆盖）
 * - 但 panelMainSlotVisible 被误清 + imagePreview=图片1 → 主图格用失效 blob / 冒充参考图，
 *   展示层去重或裂图，用户感知「丢图」
 *
 * 锁定：
 * 1. 运行后未 @主图 且 imagePreview 已是参考槽时，preserve 不得清 panelMainSlotVisible=false
 * 2. 有 panelMainSlotVisible=false + 备份时，主图格仍展示（via backup），参考槽 4 张全在
 *
 * npx tsx scripts/20260710-banana-panel-loss-test.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { NodeData } from '../types.ts';
import {
  buildPanelMainImagePreservePatchOnEdit,
  shouldShowPanelMainImageSlot,
  resolvePanelMainSlotPreviewUrl,
  panelReferenceLabelImagePreview,
} from '../utils/referencedMediaRun.ts';
import { buildPanelReferenceDisplayEntries } from '../utils/referenceImageSlotLabels.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, 'fixtures', '20260710-banana-panel-loss.json');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const json = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const node = json.nodes.find((n: { id: string }) => String(n.id).includes('node_9'));
if (!node) throw new Error('node_9 not found');
const saved = node.data as NodeData;

console.log('\n=== banana-丢图：数据层仍保留 4 槽 ===');
ok('referenceImages.length === 4', (saved.referenceImages || []).length === 4);
ok(
  'labels 等长',
  (saved.referenceImageLabels || []).length === (saved.referenceImages || []).length
);
ok('imagePreview === 图片1（未 @主图运行后）', saved.imagePreview === saved.referenceImages?.[0]);
ok('有 panelMainImageUrl 备份', Boolean(String(saved.panelMainImageUrl || '').trim()));

console.log('\n=== 正确运行后态：panelMainSlotVisible=false 不得被 preserve 清掉 ===');
const afterRunCorrect: NodeData = {
  ...saved,
  panelMainSlotVisible: false,
  panelMainImageUrl: 'https://cos.example/main-backup.png',
  imagePreview: saved.referenceImages![0],
  prompt: '@图片1参考@图片4的风格生成',
  selectedModel: 'Nano Banana 2.0',
};
ok(
  'preserve 不得清 false（imagePreview 已是参考槽）',
  buildPanelMainImagePreservePatchOnEdit(afterRunCorrect) === undefined
);
ok('仍展示主图格（有备份）', shouldShowPanelMainImageSlot(afterRunCorrect) === true);
ok(
  '主图格 URL = 备份非图片1',
  resolvePanelMainSlotPreviewUrl(afterRunCorrect) === 'https://cos.example/main-backup.png'
);

const showMain =
  Boolean(resolvePanelMainSlotPreviewUrl(afterRunCorrect)) &&
  shouldShowPanelMainImageSlot(afterRunCorrect);
const mainFor = panelReferenceLabelImagePreview(afterRunCorrect) ?? afterRunCorrect.imagePreview;
const entries = buildPanelReferenceDisplayEntries(afterRunCorrect.referenceImages, {
  imagePreview: mainFor,
  dedupeAgainstMain: showMain,
  referenceImageLabels: afterRunCorrect.referenceImageLabels,
});
ok('参考格展示 4 张（不去掉图片1）', entries.length === 4, String(entries.length));
ok(
  '含 slot0 图片1',
  entries.some((e) => e.slotIndex === 0),
  JSON.stringify(entries.map((e) => e.slotIndex))
);

console.log('\n=== legacy：编辑态 imagePreview 仍是主图时，preserve 可清 false ===');
const editLegacy: NodeData = {
  ...saved,
  panelMainSlotVisible: false,
  panelMainImageUrl: 'https://cos.example/main-backup.png',
  imagePreview: 'https://cos.example/main-backup.png',
  prompt: '@图片1参考@图片4的风格生成',
  selectedModel: 'Nano Banana 2.0',
};
ok(
  'legacy 同 URL 主图可清 false',
  buildPanelMainImagePreservePatchOnEdit(editLegacy)?.panelMainSlotVisible === undefined
);

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);

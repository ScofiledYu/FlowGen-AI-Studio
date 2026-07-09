/**
 * 复现 + 锁定修复：referenceImageLabels 错位时 @ 下拉误删最后元素
 *
 * 现象：referenceImageLabels = ["图片1","图片2","图片4","图片4"]（slot2 标签错位成"图片4"），
 *   buildInspectorPromptMentionItems 的 seenNames 去重把 slot3（真正的 @图片4）当成重复删掉，
 *   导致用户无法 @ 最后元素。
 *
 * 修复：image/video/audio kind 不按 displayLabel 去重（insertText @图片n 已唯一）。
 *
 * npx tsx scripts/at-mention-label-mismatch-test.ts
 */
import type { NodeData } from '../types.ts';
import {
  buildInspectorPromptMentionItems,
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
  resolvePictureTokenSlotIndex,
} from '../utils/promptMediaRefs.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  [OK] ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`); }
}

function buildNanoData(overrides: Partial<NodeData>): NodeData {
  return {
    label: 'n',
    selectedModel: 'Nano Banana 2.0',
    imagePreview: 'blob:http://localhost:3001/main',
    referenceImages: [
      'blob:http://localhost:3001/ref0',
      'blob:http://localhost:3001/ref1',
      'blob:http://localhost:3001/ref2',
      'blob:http://localhost:3001/ref3',
    ],
    ...overrides,
  } as NodeData;
}

console.log('\n=== 场景1：labels=["图片1","图片2","图片4","图片4"]（slot2 标签错位）===\n');
{
  const data = buildNanoData({
    referenceImageLabels: ['图片1', '图片2', '图片4', '图片4'],
  });
  const ctx = buildPromptMediaRefContextFromNode(data);
  const items = buildInspectorPromptMentionItems(data, ctx);
  const insertTexts = items.map((it) => it.insertText);
  console.log('  @ 下拉项:', insertTexts);
  ok('含 @图片1', insertTexts.includes('@图片1'));
  ok('含 @图片2', insertTexts.includes('@图片2'));
  ok('含 @图片3', insertTexts.includes('@图片3'));
  ok('含 @图片4（最后元素）', insertTexts.includes('@图片4'), `actual=${insertTexts}`);
  const img4 = items.find((it) => it.insertText === '@图片4');
  ok('@图片4 指向 slot 3（最后元素）', img4?.refImageIndex === 3, `refImageIndex=${img4?.refImageIndex}`);
}

console.log('\n=== 场景2：正常 labels=["图片1","图片2","图片3","图片4"]（对照）===\n');
{
  const data = buildNanoData({
    referenceImageLabels: ['图片1', '图片2', '图片3', '图片4'],
  });
  const ctx = buildPromptMediaRefContextFromNode(data);
  const items = buildInspectorPromptMentionItems(data, ctx);
  const insertTexts = items.map((it) => it.insertText);
  ok('正常标签全 4 项', insertTexts.includes('@图片1') && insertTexts.includes('@图片2') && insertTexts.includes('@图片3') && insertTexts.includes('@图片4'), `actual=${insertTexts}`);
}

console.log('\n=== 场景3：labels 全重复 ["图片4","图片4","图片4","图片4"]（极端错位）===\n');
{
  const data = buildNanoData({
    referenceImageLabels: ['图片4', '图片4', '图片4', '图片4'],
  });
  const ctx = buildPromptMediaRefContextFromNode(data);
  const items = buildInspectorPromptMentionItems(data, ctx);
  const insertTexts = items.map((it) => it.insertText);
  console.log('  @ 下拉项:', insertTexts);
  ok('极端错位仍含 @图片1-4 全部', insertTexts.includes('@图片1') && insertTexts.includes('@图片2') && insertTexts.includes('@图片3') && insertTexts.includes('@图片4'), `actual=${insertTexts}`);
}

console.log('\n=== 场景4：plan 解析 @图片4 仍指向 slot 3 ===\n');
{
  const data = buildNanoData({
    referenceImageLabels: ['图片1', '图片2', '图片4', '图片4'],
  });
  const ctx = buildPromptMediaRefContextFromNode(data);
  const slot = resolvePictureTokenSlotIndex(4, data.referenceImages || [], data.referenceImageLabels, data.imagePreview);
  ok('resolvePictureTokenSlotIndex(@图片4) → slot 3', slot === 3, `slot=${slot}`);
  const plan = collectReferencedMediaFromPrompt('@图片4 生成', data, ctx, new Map());
  const entry = plan.images.find((e) => e.token === '@图片4');
  ok('plan @图片4 refImageSlotIndex=3', entry?.refImageSlotIndex === 3, `slot=${entry?.refImageSlotIndex}`);
}

console.log(`\n=== 汇总：${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) process.exit(1);

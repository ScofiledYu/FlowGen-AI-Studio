/**
 * 20260709-seedance视频1.json：MOV 切 Seedance 参考生后 @ 应为 @主视频
 * npx tsx scripts/20260709-seedance-video1-mention-test.ts
 */
import fs from 'fs';
import type { NodeData } from '../types.ts';
import { resolveFixtureFile } from './fixturePath.ts';
import {
  buildPromptMediaRefLabels,
  buildPromptMediaRefContextFromNode,
  buildInspectorPromptMentionItems,
  isLikelyMainVideoUrl,
} from '../utils/promptMediaRefs.ts';

const json = JSON.parse(
  fs.readFileSync(
    resolveFixtureFile(
      '20260709-seedance-video1.json',
      'd:/json/20260709-seedance视频1.json'
    ),
    'utf8'
  )
);
const data = json.nodes[0].data as NodeData;

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

console.log('=== 20260709 Seedance MOV @主视频 ===\n');
console.log('imagePreview:', String(data.imagePreview || '').slice(0, 80));
console.log('isLikelyMainVideoUrl:', isLikelyMainVideoUrl(data.imagePreview));
console.log('seedanceMode:', data.seedanceGenerationMode);
console.log('referenceMovs:', data.referenceMovs?.length);

const ctx = buildPromptMediaRefContextFromNode(data);
const labels = buildPromptMediaRefLabels(data, ctx);
const mentions = buildInspectorPromptMentionItems(data, ctx);

console.log('\nbuildPromptMediaRefLabels:', labels.map((l) => l.insertText).join(', '));
console.log('buildInspectorPromptMentionItems:', mentions.map((l) => l.insertText).join(', '));

ok('ctx.isSeedance20', ctx.isSeedance20 === true);
ok('ctx.seedanceMode=reference', ctx.seedanceMode === 'reference');
ok('labels 含 @主视频', labels.some((l) => l.insertText === '@主视频'));
ok('labels 不含 @视频1', !labels.some((l) => l.insertText === '@视频1'));
ok('mentions 含 @主视频', mentions.some((l) => l.insertText === '@主视频'));
ok('mentions 不含 @视频1', !mentions.some((l) => l.insertText === '@视频1'));

// Omni MOV 切 Seedance 后可能残留 firstFrameImageUrl（PNG 截帧）
const withFirstFrame = {
  ...data,
  firstFrameImageUrl: data.generationParams?.firstFrameImageUrl as string,
  firstFrameImage: data.generationParams?.firstFrameImage as string,
};
const ctx2 = buildPromptMediaRefContextFromNode(withFirstFrame);
const labels2 = buildPromptMediaRefLabels(withFirstFrame, ctx2);
ok(
  '有 firstFrame 残留时不误增 @图片1',
  labels2.some((l) => l.insertText === '@主视频') &&
    !labels2.some((l) => l.insertText === '@图片1') &&
    !labels2.some((l) => l.insertText === '@视频1'),
  labels2.map((l) => l.insertText).join(', ')
);

// imagePreview 为 poster、referenceMovs 为 mp4（与面板「主视频」角标应对齐）
const mp4 = data.referenceMovs![0].url;
const withPosterMain = {
  ...data,
  imagePreview: data.videoPosterDataUrl,
  referenceMovs: [{ url: mp4 }],
};
const ctx3 = buildPromptMediaRefContextFromNode(withPosterMain);
const labels3 = buildPromptMediaRefLabels(withPosterMain, ctx3);
ok(
  'poster 主预览 + referenceMovs mp4 时 @主视频',
  labels3.some((l) => l.insertText === '@主视频') &&
    !labels3.some((l) => l.insertText === '@视频1'),
  labels3.map((l) => l.insertText).join(', ')
);

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);

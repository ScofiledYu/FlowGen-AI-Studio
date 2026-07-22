/**
 * 验证 seedance4.json：processor 节点运行后 @主图 不应变成 @主视频
 */
import fs from 'fs';
import type { NodeData } from '../types.ts';
import {
  buildPromptMediaRefLabels,
  buildPromptMediaRefContextFromNode,
  resolveSeedanceReferenceMainVideoUrl,
} from '../utils/promptMediaRefs.ts';

const json = JSON.parse(fs.readFileSync('E:/问题/seedance4.json', 'utf8'));
const proc = json.nodes.find((n: { type: string }) => n.type === 'processorNode');
const mov = json.nodes.find((n: { type: string }) => n.type === 'movNode');

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

console.log('=== seedance4.json：processor 节点 @主图 不应变 @主视频 ===\n');

// 1. processor 节点 resolveSeedanceReferenceMainVideoUrl 返回 undefined
const procData = proc.data as NodeData;
const procMainVideo = resolveSeedanceReferenceMainVideoUrl(procData);
ok('processor resolveSeedanceReferenceMainVideoUrl 返回 undefined', procMainVideo === undefined,
  `实际=${procMainVideo?.slice(-20)}`);

// 2. processor 节点 buildPromptMediaRefLabels 不含 @主视频
const procCtx = buildPromptMediaRefContextFromNode(procData);
const procLabels = buildPromptMediaRefLabels(procData, procCtx);
const hasMainVideo = procLabels.some((l) => l.insertText === '@主视频');
const hasMainImage = procLabels.some((l) => l.insertText === '@主图');
ok('processor @mention 不含 @主视频', !hasMainVideo);
ok('processor @mention 含 @主图', hasMainImage,
  `labels=${procLabels.map((l) => l.insertText).join(', ')}`);

// 3. MOV 节点 resolveSeedanceReferenceMainVideoUrl 返回 outputUrl
const movData = mov.data as NodeData;
const movMainVideo = resolveSeedanceReferenceMainVideoUrl(movData);
const movOutputUrl = (movData.generationParams as { outputUrl?: string })?.outputUrl;
ok('movNode resolveSeedanceReferenceMainVideoUrl 返回 outputUrl',
  movMainVideo === movOutputUrl,
  `期望=${movOutputUrl?.slice(-20)}, 实际=${movMainVideo?.slice(-20)}`);

// 4. MOV 节点 buildPromptMediaRefLabels 含 @主视频
const movCtx = buildPromptMediaRefContextFromNode(movData);
const movLabels = buildPromptMediaRefLabels(movData, movCtx);
const movHasMainVideo = movLabels.some((l) => l.insertText === '@主视频');
ok('movNode @mention 含 @主视频', movHasMainVideo,
  `labels=${movLabels.map((l) => l.insertText).join(', ')}`);

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
console.log('验证通过！');
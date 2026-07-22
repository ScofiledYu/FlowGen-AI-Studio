/**
 * 门禁：Seedance 参考生视频 Node Details 参考图一致性
 * 防止修改 Node Details 展示逻辑时破坏以下已验证行为：
 * 1. seedance3.json：processor 与 movNode 的 Node Details 参考图必须一致（都用 gp.referenceImages）
 * 2. seedance4.json：processor 节点 @主图 不应被误判为 @主视频
 */
import fs from 'fs';
import type { NodeData, GenerationParams } from '../types.ts';
import { buildSeedanceReferenceDetailsFromSnapshot } from '../utils/nodeDetailsPreview.ts';
import {
  buildPromptMediaRefLabels,
  buildPromptMediaRefContextFromNode,
  resolveSeedanceReferenceMainVideoUrl,
} from '../utils/promptMediaRefs.ts';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

// === 测试1：seedance3.json processor vs movNode 参考图一致性 ===
console.log('\n=== §1 seedance3.json：processor 与 movNode Node Details 参考图一致 ===');

const json3 = JSON.parse(fs.readFileSync('E:/问题/seedance3.json', 'utf8'));
const proc3 = json3.nodes.find((n: { type: string }) => n.type === 'processorNode');
const mov3 = json3.nodes.find((n: { type: string }) => n.type === 'movNode');

if (!proc3 || !mov3) {
  console.log('  [SKIP] seedance3.json 缺少 processorNode 或 movNode');
} else {
  const procData3 = proc3.data as NodeData;
  const movData3 = mov3.data as NodeData;
  const procGp3 = procData3.generationParams as GenerationParams;
  const movGp3 = movData3.generationParams as GenerationParams;

  const procRefs3 = (procGp3.referenceImages || []).map((u: string) => String(u || '').trim()).filter(Boolean);
  const movRefs3 = (movGp3.referenceImages || []).map((u: string) => String(u || '').trim()).filter(Boolean);

  ok('processor gp.referenceImages 数量', procRefs3.length > 0, `实际=${procRefs3.length}`);
  ok('mov gp.referenceImages 数量', movRefs3.length > 0, `实际=${movRefs3.length}`);
  ok('processor 与 mov 参考图数量一致', procRefs3.length === movRefs3.length,
    `processor=${procRefs3.length}, mov=${movRefs3.length}`);

  // Node Details 展示一致性
  const procDetails3 = buildSeedanceReferenceDetailsFromSnapshot({
    snapshotRefs: procRefs3,
    snapshotLabels: (procGp3.referenceImageLabels || []) as string[],
    prompt: String(procGp3.prompt || ''),
  });
  const movDetails3 = buildSeedanceReferenceDetailsFromSnapshot({
    snapshotRefs: movRefs3,
    snapshotLabels: (movGp3.referenceImageLabels || []) as string[],
    prompt: String(movGp3.prompt || ''),
  });

  ok('Node Details 参考图数量一致',
    procDetails3.referenceImageDetailItems.length === movDetails3.referenceImageDetailItems.length);

  procDetails3.referenceImageDetailItems.forEach((item, i) => {
    const movItem = movDetails3.referenceImageDetailItems[i];
    const labelMatch = item.label === movItem?.label;
    const urlMatch = item.url === movItem?.url;
    ok(`第${i + 1}张图一致`, labelMatch && urlMatch,
      `processor=${item.label}, mov=${movItem?.label}`);
  });
}

// === 测试2：seedance4.json processor @主图 不变 @主视频 ===
console.log('\n=== §2 seedance4.json：processor @主图 不应变为 @主视频 ===');

const json4 = JSON.parse(fs.readFileSync('E:/问题/seedance4.json', 'utf8'));
const proc4 = json4.nodes.find((n: { type: string }) => n.type === 'processorNode');

if (!proc4) {
  console.log('  [SKIP] seedance4.json 缺少 processorNode');
} else {
  const procData4 = proc4.data as NodeData;

  // resolveSeedanceReferenceMainVideoUrl 应返回 undefined（无 referenceMovs 时）
  const mainVideoUrl = resolveSeedanceReferenceMainVideoUrl(procData4);
  ok('resolveSeedanceReferenceMainVideoUrl 返回 undefined', mainVideoUrl === undefined,
    `实际=${mainVideoUrl?.slice(-20)}`);

  // @mention 中不应有 @主视频
  const ctx4 = buildPromptMediaRefContextFromNode(procData4);
  const labels4 = buildPromptMediaRefLabels(procData4, ctx4);
  const hasMainVideo = labels4.some((l) => l.insertText === '@主视频');
  const hasMainImage = labels4.some((l) => l.insertText === '@主图');
  ok('@mention 不含 @主视频', !hasMainVideo);
  ok('@mention 含 @主图', hasMainImage,
    `labels=${labels4.map((l) => l.insertText).join(', ')}`);
}

console.log(`\n=== 汇总 ===`);
console.log(`通过 ${pass}，失败 ${fail}`);
if (fail > 0) {
  console.log('\n❌ 门禁失败');
  process.exit(1);
}
console.log('\n✅ 门禁通过');

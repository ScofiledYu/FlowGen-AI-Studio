/**
 * 验证 image2 运行后 compact 不丢图（参考 Banana2 方案）
 * npx tsx scripts/780-image2-compact-no-loss-test.ts
 */
import type { NodeData } from '../types.ts';
import { compactImage2PanelReferences } from '../utils/image2PanelRefs.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

// 场景：运行后状态（status=completed），主图 blob，@图片1 signed，未@ data URL，@图片3 signed
// compact 不应丢图（Banana2 方案：运行后 NodeInspector 不 compact，但这里验证 compactImage2PanelReferences 本身不丢非主图重复槽）
const forestSigned = 'https://aitop-cos/forest-signed.png';
const wolfData = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD';
const otherSigned = 'https://aitop-cos/other-signed.png';
const mainBlob = 'blob:http://localhost:3001/main-abc';

const dataAfterRun = {
  selectedModel: 'image 2',
  imagePreview: mainBlob,
  imageLocalRef: 'flowgen-local:uid_pid:node:main',
  panelMainImageUrl: mainBlob,
  panelMainSlotVisible: false,
  referenceImages: [forestSigned, wolfData, otherSigned],
  referenceImageLabels: ['图片1', '图片2', '图片3'],
  status: 'completed',
} as NodeData;

const compacted = compactImage2PanelReferences(dataAfterRun);
console.log('compact 后 referenceImages:', compacted.referenceImages);
console.log('compact 后 labels:', compacted.referenceImageLabels);

ok('compact 后保留 3 个参考槽', compacted.referenceImages.length === 3, JSON.stringify(compacted.referenceImages));
ok('compact 后 @图片1 signed 保留', compacted.referenceImages.includes(forestSigned), JSON.stringify(compacted.referenceImages));
ok('compact 后未@ data URL 保留', compacted.referenceImages.includes(wolfData), JSON.stringify(compacted.referenceImages));
ok('compact 后 @图片3 signed 保留', compacted.referenceImages.includes(otherSigned), JSON.stringify(compacted.referenceImages));

// 场景：主图与槽0重复时，compact 应 shift 主图重复槽，保留非重复槽
const dataWithMainDup = {
  ...dataAfterRun,
  referenceImages: [mainBlob, forestSigned, otherSigned],
  referenceImageLabels: ['图片1', '图片2', '图片3'],
} as NodeData;

const compacted2 = compactImage2PanelReferences(dataWithMainDup);
console.log('\n主图重复槽0 compact 后:', compacted2.referenceImages);
ok('主图重复槽0 shift 后保留非重复 2 槽', compacted2.referenceImages.length === 2, JSON.stringify(compacted2.referenceImages));
ok('主图重复槽0 shift 后保留 forestSigned', compacted2.referenceImages.includes(forestSigned), JSON.stringify(compacted2.referenceImages));
ok('主图重复槽0 shift 后保留 otherSigned', compacted2.referenceImages.includes(otherSigned), JSON.stringify(compacted2.referenceImages));

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);

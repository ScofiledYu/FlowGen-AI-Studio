/**
 * 20260710 Seedance：纯 @资产 未 @主图 时画布缩略图不得显示主图「熊二」。
 * fixture: d:/json/20260710-seedance节点缩略图.json（副本 scripts/fixtures/）
 */
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { resolveCanvasNodePreviewUrl } from '../utils/referencedMediaRun.ts';
import { promptMentionsAnyImageRefForNodeData, promptMentionsMainImageForNodeData } from '../utils/promptMediaRefs.ts';

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  '20260710-seedance-asset-thumb.json'
);

function ok(name: string, cond: boolean, detail = '') {
  if (!cond) {
    console.error(`FAIL ${name}${detail ? ': ' + detail : ''}`);
    process.exitCode = 1;
  } else {
    console.log(`OK   ${name}`);
  }
}

const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const d = raw.nodes[0].data;
const main = String(d.panelMainImageUrl || '').trim();
const ref0 = String(d.referenceImages?.[0] || '').trim();

console.log('\n=== 20260710 Seedance 纯@资产 画布缩略图 ===\n');
ok('未 @主图', !promptMentionsMainImageForNodeData(d));
ok('有图片类 @（含纯@资产）', promptMentionsAnyImageRefForNodeData(d));
ok('panelMainSlotVisible=false', d.panelMainSlotVisible === false);
ok('主图备份存在', Boolean(main));
ok('gp/面板首张参考存在', Boolean(ref0));
const canvas = resolveCanvasNodePreviewUrl(d);
ok('画布≠主图备份（熊二）', canvas !== main, `got ${String(canvas).slice(0, 80)}`);
ok('画布=首个@参考（原始丛林小路）', canvas === ref0, `got ${String(canvas).slice(0, 80)}`);

if (process.exitCode) {
  console.error('\nFAILED');
  process.exit(1);
}
console.log('\nALL PASSED\n');

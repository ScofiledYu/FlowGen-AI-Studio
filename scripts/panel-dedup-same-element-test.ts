/**
 * 面板同源元素去重：拖入与已有元素同 URL 时不添加（静默跳过）
 *
 * 修复：applyInspectorReferenceFromUrlString 入口加 panelReferencesAlreadyContainUrl(currentRefs, internalCandidate) early-return，
 * 补充 tryAppendReferenceImageWithLabel 按压缩后 URL 去重的漏洞（同画布节点多次拖入原 URL 相同）。
 *
 * npx tsx scripts/panel-dedup-same-element-test.ts
 */
import type { NodeData } from '../types.ts';
import {
  panelReferencesAlreadyContainUrl,
  panelReferencesAlreadyContainIncoming,
  tryAppendReferenceImageWithLabel,
} from '../utils/referenceImageSlotLabels.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  [OK] ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`); }
}

console.log('\n=== 场景1：Nano 同 URL 拖两次 → 第二次跳过 ===\n');
{
  const refs: string[] = [];
  const labels: string[] = [];
  const url1 = 'blob:http://localhost:3001/abc-123';
  const r1 = tryAppendReferenceImageWithLabel(refs, labels, url1, '图片1');
  ok('首次添加成功', r1.added, `added=${r1.added}`);
  ok('首次后 1 槽', r1.referenceImages.length === 1, `len=${r1.referenceImages.length}`);
  // 模拟 applyInspectorReferenceFromUrlString 入口去重：同 URL 再来一次
  const dupCheck = panelReferencesAlreadyContainUrl(r1.referenceImages, url1);
  ok('同 URL 入口去重命中（跳过）', dupCheck, `dupCheck=${dupCheck}`);
  // tryAppendReferenceImageWithLabel 也会去重（双保险）
  const r2 = tryAppendReferenceImageWithLabel(r1.referenceImages, r1.referenceImageLabels, url1, '图片2');
  ok('tryAppend 第二次也跳过', !r2.added, `added=${r2.added}`);
  ok('两次后仍 1 槽', r2.referenceImages.length === 1, `len=${r2.referenceImages.length}`);
}

console.log('\n=== 场景2：Nano 不同 URL 拖两次 → 都添加 ===\n');
{
  const refs: string[] = [];
  const labels: string[] = [];
  const url1 = 'blob:http://localhost:3001/aaa';
  const url2 = 'blob:http://localhost:3001/bbb';
  const r1 = tryAppendReferenceImageWithLabel(refs, labels, url1, '图片1');
  ok('首次添加', r1.added);
  const dupCheck2 = panelReferencesAlreadyContainUrl(r1.referenceImages, url2);
  ok('不同 URL 入口去重不命中', !dupCheck2, `dupCheck=${dupCheck2}`);
  const r2 = tryAppendReferenceImageWithLabel(r1.referenceImages, r1.referenceImageLabels, url2, '图片2');
  ok('第二次添加', r2.added);
  ok('两次后 2 槽', r2.referenceImages.length === 2, `len=${r2.referenceImages.length}`);
}

console.log('\n=== 场景3：image2 同 URL（资产库 file URL）拖两次 ===\n');
{
  const fileUrl = '/flowgen-api/projects/14/assets/abc/file';
  const refs = [fileUrl];
  const dupCheck = panelReferencesAlreadyContainUrl(refs, fileUrl);
  ok('同资产 file URL 去重命中', dupCheck, `dupCheck=${dupCheck}`);
  const thumbUrl = '/flowgen-api/projects/14/assets/abc/thumb';
  const dupThumb = panelReferencesAlreadyContainUrl(refs, thumbUrl);
  ok('thumb 与 file 视为同源（去重命中）', dupThumb, `dupCheck=${dupThumb}`);
}

console.log('\n=== 场景4：Omni multi 同 URL 拖两次 ===\n');
{
  const refs: string[] = [];
  const url = 'blob:http://localhost:3001/omni-same';
  const r1 = tryAppendReferenceImageWithLabel(refs, undefined, url);
  ok('Omni 首次添加', r1.added);
  const dupCheck = panelReferencesAlreadyContainUrl(r1.referenceImages, url);
  ok('Omni 同 URL 入口去重命中', dupCheck, `dupCheck=${dupCheck}`);
  const r2 = tryAppendReferenceImageWithLabel(r1.referenceImages, r1.referenceImageLabels, url);
  ok('Omni 第二次跳过', !r2.added, `added=${r2.added}`);
}

console.log('\n=== 场景5：Seedance 参考生同 URL（seedanceReferenceFromUrlRef 已有去重） ===\n');
{
  const refs = ['blob:http://localhost:3001/sd-1'];
  const dupCheck = panelReferencesAlreadyContainUrl(refs, 'blob:http://localhost:3001/sd-1');
  ok('Seedance 同 URL 去重命中', dupCheck, `dupCheck=${dupCheck}`);
}

console.log('\n=== 场景6：压缩后 URL 不同但原 URL 相同 → 入口去重拦截 ===\n');
{
  // 模拟：画布节点 imagePreview = blob:abc，首次拖入压缩成 data:xxx 存入 referenceImages
  // 第二次拖入同一画布节点，原 URL 仍是 blob:abc，但 referenceImages 里是 data:xxx
  // 入口去重按原 URL（blob:abc）检查，与 referenceImages（data:xxx）不同 → 不命中
  // 这种情况靠 tryAppendReferenceImageWithLabel 按压缩后 URL 去重（若压缩确定则 data URL 相同）
  const refs = ['data:image/jpeg;base64,AAAA'];
  const originalUrl = 'blob:http://localhost:3001/abc';
  const dupCheck = panelReferencesAlreadyContainUrl(refs, originalUrl);
  ok('原 URL 与压缩后 URL 不同时入口去重不命中（靠 tryAppend 兜底）', !dupCheck, `dupCheck=${dupCheck}`);
  // tryAppend 按压缩后 URL：若第二次压缩成相同 data URL 则去重
  const r2 = tryAppendReferenceImageWithLabel(refs, undefined, 'data:image/jpeg;base64,AAAA');
  ok('tryAppend 按压缩后 URL 去重命中（同 data URL）', !r2.added, `added=${r2.added}`);
}

console.log('\n=== 场景7：压缩失败 fallback 到原 blob URL → 入口去重命中 ===\n');
{
  // 模拟：首次拖入压缩失败，fallback 存入原 blob URL；第二次同 URL 拖入
  const refs = ['blob:http://localhost:3001/abc'];
  const dupCheck = panelReferencesAlreadyContainUrl(refs, 'blob:http://localhost:3001/abc');
  ok('压缩失败存原 URL 时入口去重命中', dupCheck, `dupCheck=${dupCheck}`);
}

console.log('\n=== 场景8：压缩后 data URL panelReferencesAlreadyContainIncoming ===\n');
{
  const refs = ['data:image/jpeg;base64,AAAA'];
  const labels = ['图片1'];
  ok(
    'blob 原 URL 未单独命中',
    !panelReferencesAlreadyContainIncoming(refs, labels, 'blob:http://localhost/abc'),
    ''
  );
  ok(
    '压缩后 data URL 命中',
    panelReferencesAlreadyContainIncoming(refs, labels, 'data:image/jpeg;base64,AAAA'),
    ''
  );
}

console.log(`\n=== 汇总：${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) process.exit(1);

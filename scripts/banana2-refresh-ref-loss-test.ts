/**
 * 复现：Banana2 面板拖入多张图片，刷新后只显示主图，其他图片丢失
 * npx tsx scripts/banana2-refresh-ref-loss-test.ts
 */
import type { NodeData } from '../types.ts';
import { sanitizePersistValueDeep } from '../utils/persistSanitize.mjs';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++; else fail++;
}

// 模拟用户拖入：主图 + 3张参考图（本地 data URL，>8KB 会被 sanitize 剥离）
// 用长 data URL 模拟真实图片（>8192 字符）
const longData = 'data:image/jpeg;base64,/9j/4AAQ' + 'A'.repeat(9000) + '==';
const mainBlob = 'blob:http://localhost:3001/main-test';

// 场景1：用户刚拖入图片（未运行），referenceImages 有 3 张 data URL，referenceImageLocalRefs 有 3 个 ref
const beforeRefresh = {
  selectedModel: 'Nano Banana 2.0',
  imagePreview: mainBlob,
  imageLocalRef: 'flowgen-local:uid_pid:node:main',
  referenceImages: [longData, longData, longData],
  referenceImageLabels: ['图片1', '图片2', '图片3'],
  referenceImageLocalRefs: [
    'flowgen-local:uid_pid:node:ref:0',
    'flowgen-local:uid_pid:node:ref:1',
    'flowgen-local:uid_pid:node:ref:2',
  ],
  prompt: '',
  status: 'idle',
} as NodeData;

console.log('=== 场景1：Banana2 拖入3张参考图，未运行，刷新 ===');
console.log('刷新前 referenceImages:', beforeRefresh.referenceImages.map(u => u.slice(0, 30)));
console.log('刷新前 referenceImageLocalRefs:', beforeRefresh.referenceImageLocalRefs);

// 模拟保存（sanitize 剥离 blob 和 >8KB data URL）
const saved = sanitizePersistValueDeep(beforeRefresh) as NodeData;
console.log('保存后 referenceImages:', (saved.referenceImages || []).map(u => u ? u.slice(0, 30) : 'EMPTY'));
console.log('保存后 referenceImageLocalRefs:', saved.referenceImageLocalRefs);
console.log('保存后 imagePreview:', String(saved.imagePreview || ''));
console.log('保存后 imageLocalRef:', saved.imageLocalRef);

ok('referenceImageLocalRefs 保留', Array.isArray(saved.referenceImageLocalRefs) && saved.referenceImageLocalRefs.length === 3, JSON.stringify(saved.referenceImageLocalRefs));
ok('referenceImages data URL 被 sanitize 剥离但保留槽位', (saved.referenceImages || []).length === 3 && (saved.referenceImages || []).every(u => !u || !u.startsWith('data:')), JSON.stringify((saved.referenceImages||[]).map(u=>u?u.slice(0,20):'EMPTY')));
ok('imageLocalRef 保留', Boolean(saved.imageLocalRef), String(saved.imageLocalRef || ''));

// 模拟刷新后 hydrate：从 referenceImageLocalRefs 恢复 referenceImages
// hydrateAllPanelReferenceLocalRefs 逻辑：refs=[], localRefs=[ref0,ref1,ref2], needsHydrate('')=true → 恢复
const savedRefs = (saved.referenceImages || []).map(u => String(u || ''));
const savedLocalRefs = saved.referenceImageLocalRefs || [];
const maxLen = Math.max(savedRefs.length, savedLocalRefs.length);
const nextRefs = [...savedRefs];
while (nextRefs.length < maxLen) nextRefs.push('');
let hydrated = false;
for (let i = 0; i < maxLen; i++) {
  const localRef = String(savedLocalRefs[i] || '').trim();
  if (!localRef) continue;
  const cur = String(nextRefs[i] || '').trim();
  // needsHydrate: 空串 → true
  if (!cur) {
    // 实际会从 IndexedDB getLocalMediaBlob(localRef) 恢复
    // 这里模拟：如果 localRef 存在，认为能恢复
    nextRefs[i] = 'blob:recovered-from-idb-' + i;
    hydrated = true;
  }
}
console.log('\nhydrate 后 referenceImages:', nextRefs.map(u => u ? u.slice(0, 30) : 'EMPTY'));
ok('hydrate 恢复参考图', hydrated, JSON.stringify(nextRefs.map(u => u ? u.slice(0, 30) : 'EMPTY')));
ok('hydrate 恢复 3 个参考槽', nextRefs.filter(u => u && u.startsWith('blob:recovered')).length === 3, JSON.stringify(nextRefs.map(u => u ? u.slice(0, 30) : 'EMPTY')));

// 场景2：referenceImageLocalRefs 为空（未写入 IndexedDB）→ 刷新后无法恢复
const noLocalRefs = { ...beforeRefresh, referenceImageLocalRefs: [] };
const savedNoRefs = sanitizePersistValueDeep(noLocalRefs) as NodeData;
console.log('\n=== 场景2：referenceImageLocalRefs 为空（未写入 IDB）===');
console.log('保存后 referenceImages:', (savedNoRefs.referenceImages || []).map(u => u ? u.slice(0, 30) : 'EMPTY'));
console.log('保存后 referenceImageLocalRefs:', savedNoRefs.referenceImageLocalRefs);
ok('无 localRefs 时 referenceImages 空', (savedNoRefs.referenceImages || []).every(u => !u), JSON.stringify((savedNoRefs.referenceImages||[]).map(u=>u?u.slice(0,20):'EMPTY')));
ok('无 localRefs 时无法恢复', !savedNoRefs.referenceImageLocalRefs?.length, JSON.stringify(savedNoRefs.referenceImageLocalRefs || []));

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);

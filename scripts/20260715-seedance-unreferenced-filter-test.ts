/**
 * §11.28 门禁：Seedance 参考生 Node Details 不得展示未 @ 引用的面板图片
 *
 * 场景：面板拖入 3 张图（图片1、石头、图片3），创意描述仅 @资产:石头 + @图片1，
 *       generationParams.referenceImages 包含全部 3 张 URL。
 *       修复前：buildSeedanceReferenceDetailsFromSnapshot 展示 3 张（多出图片3）。
 *       修复后：按 prompt @ 标签过滤，仅展示 2 张（图片1、石头）。
 */
import { buildSeedanceReferenceDetailsFromSnapshot } from '../utils/nodeDetailsPreview';

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  [OK] ${label}`); }
  else { fail++; console.log(`  [FAIL] ${label}`); }
}

console.log('\n=== §1 面板3张图(图片1/石头/图片3)，prompt仅@资产:石头+@图片1 ===\n');

const projectAssets = [
  { slug: '石头', name: '石头', url: 'https://cos.example.com/stone.png' },
];

const details = buildSeedanceReferenceDetailsFromSnapshot({
  snapshotRefs: [
    'https://cos.example.com/pic1.png',
    'https://cos.example.com/stone.png',
    'https://cos.example.com/pic3.png',
  ],
  snapshotLabels: ['图片1', '石头', '图片3'],
  prompt: '@资产:石头出现在@图片1中，他们碰到一起，聊起天来',
  projectAssets,
});

ok(`Details 仅 2 张（非 3 张） — 实际=${details.referenceImages.length}`, details.referenceImages.length === 2);
ok(`不含图片3 URL`, !details.referenceImages.includes('https://cos.example.com/pic3.png'));
ok(`含图片1 URL`, details.referenceImages.includes('https://cos.example.com/pic1.png'));
ok(`含石头 URL`, details.referenceImages.includes('https://cos.example.com/stone.png'));
ok(`标签含图片1`, details.referenceImageDetailItems.some(i => i.label === '图片1'));
ok(`标签含石头`, details.referenceImageDetailItems.some(i => i.label === '石头'));
ok(`标签不含图片3`, !details.referenceImageDetailItems.some(i => i.label === '图片3'));

console.log('\n=== §2 正确场景：5槽(空槽+图片3+图片5)，prompt @图片3+@图片5 不受影响 ===\n');

const details2 = buildSeedanceReferenceDetailsFromSnapshot({
  snapshotRefs: ['', '', 'https://cos.example.com/url3.png', '', 'https://cos.example.com/url5.png'],
  snapshotLabels: ['图片1', '图片2', '图片3', '图片4', '图片5'],
  prompt: '@图片3看到@图片5的狮子后很怕，准备逃跑',
});

ok(`Details 仅 2 张 — 实际=${details2.referenceImages.length}`, details2.referenceImages.length === 2);
ok(`含图片3 URL`, details2.referenceImages.includes('https://cos.example.com/url3.png'));
ok(`含图片5 URL`, details2.referenceImages.includes('https://cos.example.com/url5.png'));
ok(`标签含图片3`, details2.referenceImageDetailItems.some(i => i.label === '图片3'));
ok(`标签含图片5`, details2.referenceImageDetailItems.some(i => i.label === '图片5'));

console.log('\n=== §3 无 prompt 时不过滤（兼容旧数据） ===\n');

const details3 = buildSeedanceReferenceDetailsFromSnapshot({
  snapshotRefs: ['https://cos.example.com/a.png', 'https://cos.example.com/b.png', 'https://cos.example.com/c.png'],
  snapshotLabels: ['图片1', '图片2', '图片3'],
});

ok(`无 prompt 时展示全部 3 张 — 实际=${details3.referenceImages.length}`, details3.referenceImages.length === 3);

console.log('\n=== §4 prompt @ 数 = 面板数时不过滤 ===\n');

const details4 = buildSeedanceReferenceDetailsFromSnapshot({
  snapshotRefs: ['https://cos.example.com/a.png', 'https://cos.example.com/b.png'],
  snapshotLabels: ['图片1', '图片2'],
  prompt: '@图片1和@图片2一起玩',
});

ok(`@数=面板数时展示 2 张 — 实际=${details4.referenceImages.length}`, details4.referenceImages.length === 2);

console.log('\n=== §5 标签缺失时回退：不过滤（安全保守） ===\n');

const details5 = buildSeedanceReferenceDetailsFromSnapshot({
  snapshotRefs: ['https://cos.example.com/a.png', 'https://cos.example.com/b.png', 'https://cos.example.com/c.png'],
  // 无标签
  prompt: '@图片1和@图片2一起玩',
});

ok(`标签缺失时不过滤，展示全部 3 张 — 实际=${details5.referenceImages.length}`, details5.referenceImages.length === 3);

console.log('\n=== §6 @资产: prompt 但无 projectAssets 时不过滤（安全保守） ===\n');

const details6 = buildSeedanceReferenceDetailsFromSnapshot({
  snapshotRefs: [
    'https://cos.example.com/pic1.png',
    'https://cos.example.com/stone.png',
    'https://cos.example.com/pic3.png',
  ],
  snapshotLabels: ['图片1', '石头', '图片3'],
  prompt: '@资产:石头出现在@图片1中',
  // 无 projectAssets
});

ok(`无 projectAssets 时不过滤，展示全部 3 张 — 实际=${details6.referenceImages.length}`, details6.referenceImages.length === 3);

console.log(`\n=== 汇总: ${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) process.exit(1);

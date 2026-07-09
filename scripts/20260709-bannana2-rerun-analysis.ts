/**
 * 20260709-bannana2.json：Banana 二次运行前后面板/@/gp 隐藏问题分析
 * npx tsx scripts/20260709-bannana2-rerun-analysis.ts
 */
import fs from 'fs';
import type { NodeData } from '../types.ts';
import {
  buildPromptMediaRefContextFromNode,
  buildPromptMediaRefLabels,
  collectReferencedMediaFromPrompt,
} from '../utils/promptMediaRefs.ts';
import {
  buildPanelReferenceDisplayEntries,
  firstEmptyPanelReferenceSlotIndex,
} from '../utils/referenceImageSlotLabels.ts';
import {
  panelReferenceDisplaySlots,
  shouldShowPanelMainImageSlot,
  resolvePanelMainSlotPreviewUrl,
} from '../utils/referencedMediaRun.ts';
import { panelNeedsPostRunBlobHydrateRecheck } from '../utils/hydratePanelReferenceLocalRefs.ts';

const json = JSON.parse(fs.readFileSync('d:/json/20260709-bannana2.json', 'utf8'));
const src = json.nodes.find(
  (n: { type: string }) => n.type === 'processorNode' || n.type === 'inputNode'
)!;
const data = src.data as NodeData;

console.log('=== 20260709-bannana2 二次运行隐藏问题分析 ===\n');

const refs = data.referenceImages || [];
const labels = data.referenceImageLabels || [];
const localRefs = data.referenceImageLocalRefs || [];
const eids = data.referenceElementIds || [];

console.log('【1】参考槽规模');
console.log(`  槽位数: ${refs.length} (Banana 上限 14)`);
console.log(`  非空槽: ${refs.filter((u) => String(u || '').trim()).length}`);
console.log(`  空槽下标: ${firstEmptyPanelReferenceSlotIndex(refs)} (>=14 则无法再拖入)`);

console.log('\n【2】标签重复 / @ 歧义');
const labelCounts = new Map<string, number[]>();
labels.forEach((l, i) => {
  const k = String(l || '').trim();
  if (!k) return;
  if (!labelCounts.has(k)) labelCounts.set(k, []);
  labelCounts.get(k)!.push(i);
});
for (const [label, idxs] of labelCounts) {
  if (idxs.length > 1) {
    console.log(`  ⚠ 重复标签「${label}」出现在槽 ${idxs.join(', ')}`);
    idxs.forEach((i) => {
      console.log(`      槽${i}: ${String(refs[i] || '').slice(0, 72)}`);
    });
  }
}

console.log('\n【3】localRef / eids 与槽错位');
localRefs.forEach((lr, i) => {
  const hasUrl = !!String(refs[i] || '').trim();
  const hasLr = !!String(lr || '').trim();
  if (hasUrl && !hasLr && !String(refs[i]).includes('/flowgen-api/projects/')) {
    console.log(`  ⚠ 槽${i} 有 URL 但无 localRef: ${String(refs[i]).slice(0, 60)}`);
  }
  if (hasLr && lr.includes(':ref:') && !lr.endsWith(`:${i}`)) {
    console.log(`  ⚠ 槽${i} localRef 后缀与下标不一致: ${lr}`);
  }
});
eids.forEach((eid, i) => {
  if (String(refs[i] || '').trim() && !String(eid || '').trim()) {
    console.log(`  · 槽${i} 有图但 referenceElementIds 为空 (拖入去重可能失效)`);
  }
});

console.log('\n【4】运行后三态');
console.log(`  imagePreview(画布): ${String(data.imagePreview || '').slice(0, 80)}`);
console.log(`  panelMainImageUrl: ${String(data.panelMainImageUrl || '').slice(0, 80)}`);
console.log(`  主图格应显示: ${shouldShowPanelMainImageSlot(data)}`);
console.log(`  主图格 URL: ${String(resolvePanelMainSlotPreviewUrl(data) || '').slice(0, 80)}`);
console.log(`  gp.referenceImages (${data.generationParams?.referenceImages?.length}):`);
(data.generationParams?.referenceImages || []).forEach((u: string, i: number) => {
  const lb = data.generationParams?.referenceImageLabels?.[i] || '';
  console.log(`    [${i}] ${lb} → ${String(u).slice(0, 72)}`);
});
console.log(`  gp.outputUrl: ${String(data.generationParams?.outputUrl || '').slice(0, 80)}`);
const canvasIsOutput = data.imagePreview === data.generationParams?.outputUrl;
console.log(`  画布大图=生成结果? ${canvasIsOutput ? '是' : '否（未@主图时为首个@参考 URL）'}`);

console.log('\n【5】创意描述 @ 解析（当前 prompt）');
const prompt = String(data.prompt || '').trim();
const ctx = buildPromptMediaRefContextFromNode(data);
const refLabels = buildPromptMediaRefLabels(data, ctx);
const plan = collectReferencedMediaFromPrompt(
  prompt,
  data,
  ctx,
  new Map(),
  []
);
console.log(`  prompt: ${prompt}`);
console.log(`  @下拉可见项: ${refLabels.length}`);
plan.images.forEach((img, i) => {
  console.log(
    `  plan[${i}] token=${img.token} slot=${img.imageIndex} url=${String(img.resolvedUrl || img.panelUrl || '').slice(0, 60)}`
  );
});
const dup5 = refLabels.filter((r) => r.label === '图片5' || r.insertText === '@图片5');
if (dup5.length > 1) {
  console.log(`  ⚠ @下拉中「图片5」出现 ${dup5.length} 次，@图片5 可能绑错槽`);
}

console.log('\n【6】blob 持久化风险');
const blobSlots = refs
  .map((u, i) => ({ i, u: String(u || '') }))
  .filter(({ u }) => u.startsWith('blob:'));
console.log(`  blob 槽数: ${blobSlots.length}`);
console.log(`  运行后需 hydrate 复检: ${panelNeedsPostRunBlobHydrateRecheck(data)}`);
if (blobSlots.length > 0) {
  console.log('  ⚠ 导出 JSON 含 blob: URL，换机器/刷新后若无 IDB 对应项会裂图');
}

console.log('\n【7】OUTPUT 子节点');
for (const n of json.nodes.filter((x: { type: string }) => x.type === 'outputNode')) {
  const d = n.data;
  const modelOk = d.selectedModel === 'Nano Banana 2.0';
  console.log(
    `  ${n.id}: selectedModel=${d.selectedModel}${modelOk ? '' : ' ⚠ 非 Banana'} numberOfImages=${d.numberOfImages}`
  );
  if (d.quality || d.klingOmniTab) {
    console.log(`    ⚠ 继承可灵字段: quality=${d.quality} klingOmniTab=${d.klingOmniTab}`);
  }
}

console.log('\n【8】modelConfigs 与顶层漂移');
const mc = data.modelConfigs?.['Nano Banana 2.0'];
if (mc) {
  const mcRefs = mc.referenceImages?.length ?? 0;
  const topRefs = refs.length;
  const mcPrompt = String(mc.prompt || '');
  if (mcPrompt !== prompt) {
    console.log(`  ⚠ modelConfigs.prompt 与顶层 prompt 不一致`);
    console.log(`    顶层: ${prompt}`);
    console.log(`    configs: ${mcPrompt}`);
  }
  if (mcRefs !== topRefs) {
    console.log(`  ⚠ modelConfigs 参考槽数 ${mcRefs} ≠ 顶层 ${topRefs}`);
  }
  if (mc.panelMainSlotVisible === false && !data.panelMainSlotVisible) {
    console.log(`  · panelMainSlotVisible=false 仅在 modelConfigs，切模型再切回可能恢复主图格`);
  }
}

const display = buildPanelReferenceDisplayEntries(refs, {
  referenceImageLabels: labels,
  imagePreview: data.imagePreview,
});
console.log('\n【9】面板展示条目');
console.log(`  buildPanelReferenceDisplayEntries: ${display.length} 条`);
console.log(`  panelReferenceDisplaySlots: ${panelReferenceDisplaySlots(refs).length} 槽`);

console.log('\n=== 分析完成 ===');

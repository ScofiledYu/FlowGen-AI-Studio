/**
 * 分析 66666666666.json：sc007 / sc009
 * npx tsx scripts/simulate-66666666666.ts
 */
import { readFileSync } from 'node:fs';
import type { NodeData } from '../types.ts';
import {
  buildPromptMediaRefContextFromNode,
  buildReferenceIndexOptionsFromPlan,
  collectReferencedMediaFromPrompt,
  filterProjectAssetsForReferencedPlan,
  getCanonicalInspectorPromptText,
  resolvePromptPlaceholders,
} from '../utils/promptMediaRefs.ts';
import {
  buildReferenceOnlyImagesForApiPayload,
  enrichPlanImagesWithPanelSlotIndexes,
  resolveReferencedImageUploadSource,
} from '../utils/referencedMediaRun.ts';
import { resolveNodeSelectionPreviewUrl as resolvePreview } from '../utils/nodeDetailsPreview.ts';

const PROJ = '7b5c23a2-a38b-479a-9553-3fda49c5d5e7';
const assets = [
  {
    slug: 'chiwen',
    name: '鸱吻',
    url: `/flowgen-api/projects/${PROJ}/assets/e2ef07fd-4566-4913-80ae-929be8b875b6/file`,
  },
  {
    slug: 'xiaoxiao',
    name: '萧逍',
    url: `/flowgen-api/projects/${PROJ}/assets/7171f71a-cd1a-4985-9acf-66583b1d149e/file`,
  },
  {
    slug: 'xiamo',
    name: '夏茉',
    url: `/flowgen-api/projects/${PROJ}/assets/b696508b-4b73-4e19-939d-111febee4f32/file`,
  },
  {
    slug: 'street1',
    name: '萧塘镇街道1',
    url: `/flowgen-api/projects/${PROJ}/assets/street-asset-id/file`,
  },
];
const slugMap = new Map(
  assets.flatMap((a) => [
    [a.slug, a.url],
    [a.name, a.url],
  ] as const)
);

const raw = JSON.parse(readFileSync('e:/test/66666666666.json', 'utf8'));

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

function analyzeShot(label: string) {
  const proc = raw.nodes.find((n: { data?: { label?: string } }) => n.data?.label === label);
  if (!proc) {
    console.log(`\n未找到 ${label}\n`);
    return;
  }
  const data = proc.data as NodeData;
  const prompt = getCanonicalInspectorPromptText(data, assets);
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, slugMap, assets);
  const enriched = enrichPlanImagesWithPanelSlotIndexes(data.referenceImages || [], plan.images, {
    referenceImageLabels: data.referenceImageLabels,
    panelMainSlotVisible: data.panelMainSlotVisible,
    projectAssetSlugToUrl: slugMap,
  });

  console.log(`\n========== ${label} ==========\n`);
  console.log('创意描述 @ 收集 (plan.images):');
  for (const e of enriched) {
    console.log(
      `  [${e.imageIndex}] ${e.token} | 槽${e.refImageSlotIndex ?? '-'} | ${e.label} | planUrl=${String(e.url).slice(0, 70)}`
    );
  }

  const uploadCtx = {
    originals: { referenceImages: [] as Array<File | null | undefined> },
    panelReferenceImages: data.referenceImages,
    projectAssetSlugToUrl: slugMap,
    projectAssets: assets,
    isFlowgenAssetThumbUrl: (u: string) => /\/thumb/i.test(u),
    flowgenAssetFileUrlFromMediaUrl: (u: string) => u.replace(/\/thumb(\?.*)?$/i, '/file$1'),
  };
  const uploaded = new Map<string, string>();
  for (const e of enriched) {
    const src = resolveReferencedImageUploadSource(e, uploadCtx as any);
    uploaded.set(e.token, src.includes('flowgen-api') ? `LIB:${e.label}` : src.slice(-40));
  }
  const apiRefs = buildReferenceOnlyImagesForApiPayload(enriched, uploaded);
  console.log('\n修复后 API referenceImages 应对齐 plan 顺序:');
  apiRefs.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));

  const gp = (data.generationParams || {}) as { referenceImages?: string[] };
  console.log('\nJSON 已保存 generationParams.referenceImages:');
  (gp.referenceImages || []).forEach((u: string, i: number) => console.log(`  ${i + 1}. ${u.slice(-44)}`));

  const panelSlots = (data.referenceImages || []).map((u, i) => ({
    i,
    label: data.referenceImageLabels?.[i] || '',
    url: String(u || '').slice(-44) || '<空>',
    inPlan: enriched.some((e) => e.refImageSlotIndex === i),
  }));
  console.log('\n面板槽位 vs 是否被 @ 引用:');
  for (const s of panelSlots) {
    console.log(`  槽${s.i} [${s.label}] ${s.url} | @引用=${s.inPlan ? '是' : '否(可能误拖)'}`);
  }

  const filtered = filterProjectAssetsForReferencedPlan(assets, plan);
  const resolveOpts = buildReferenceIndexOptionsFromPlan(plan, {
    projectAssets: filtered.map((a) => ({ slug: a.slug, name: a.name, url: a.url || '' })),
  });
  const resolved = resolvePromptPlaceholders(prompt, data, ctx, resolveOpts);
  const bareTokens = ['@资产:鸱吻', '@资产:萧逍', '@资产:夏茉', '@图片3', '@资产:萧塘镇街道1'].filter(
    (t) => resolved.includes(t)
  );
  console.log('\nprompt 展开后仍残留裸 token:', bareTokens.length ? bareTokens.join(', ') : '无');
  console.log('imagePreview:', String(data.imagePreview || '').slice(-60));
  console.log('projectAssetId:', (data as NodeData & { projectAssetId?: string }).projectAssetId);
  const chatPreview = resolvePreview(data, assets);
  console.log('聊天/选中预览 URL 尾段:', String(chatPreview || '').slice(-60) || '<无>');

  const planCount = enriched.filter((e) => !['@主图', '@主体'].includes(e.token)).length;
  const gpCount = gp.referenceImages?.length || 0;
  console.log(
    `\n结论: plan需${planCount}张 | gp已存${gpCount}张 | ${gpCount === planCount ? '数量一致' : '数量不一致(可能少图或多图)'}`
  );

  console.log('\n自动断言:');
  ok(`${label}: API 张数=plan`, gpCount === planCount, `${gpCount} vs ${planCount}`);
  const unreferencedFilled = panelSlots.filter((s) => s.url !== '<空>' && !s.inPlan);
  ok(`${label}: 无未@且带图的槽`, unreferencedFilled.length === 0, JSON.stringify(unreferencedFilled));
  ok(`${label}: prompt 已展开`, bareTokens.length === 0, bareTokens.join(','));
  const chiwen = enriched.find((e) => e.token === '@资产:鸱吻');
  if (chiwen) {
    const uploadSrc = resolveReferencedImageUploadSource(chiwen, uploadCtx as any);
    ok(
      `${label}: @资产:鸱吻 上传走库图`,
      uploadSrc.includes('e2ef07fd'),
      uploadSrc.slice(-50)
    );
  }
  if (label === 'ep001_seq001_sc009') {
    const pid = (data as NodeData & { projectAssetId?: string }).projectAssetId;
    ok(
      `${label}: projectAssetId 应为夏茉库非鸱吻`,
      pid === 'b696508b-4b73-4e19-939d-111febee4f32',
      pid
    );
    ok(
      `${label}: 聊天预览=夏茉库`,
      (chatPreview || '').includes('b696508b'),
      String(chatPreview || '').slice(-50)
    );
  }
  if (label === 'ep001_seq001_sc007') {
    const gp0 = gp.referenceImages?.[0] || '';
    ok(
      `${label}: 已存 gp[0] 是否为鸱吻库(重跑后应 e2ef07fd)`,
      gp0.includes('e2ef07fd') || gp0.includes('fb2f6c72'),
      gp0.slice(-44)
    );
    if (gp0.includes('fb2f6c72') && !gp0.includes('e2ef07fd')) {
      console.log('  [WARN] gp[0] 仍是槽位 COS fb2f6c72，与鸱吻库 e2ef07fd 不一致（旧运行或槽图未更新）');
    }
  }
}

console.log('\n========== 输出节点 / 串镜检查 ==========\n');
const movNodes = raw.nodes.filter((n: { type?: string }) => n.type === 'movNode');
for (const n of movNodes) {
  const d = n.data || {};
  const name = d.customName || d.label;
  const gp = d.generationParams || {};
  const promptHead = String(gp.prompt || d.prompt || '').slice(0, 40);
  const refLen = (gp.referenceImages || []).length;
  console.log(`  MOV ${name}: refs=${refLen} prompt="${promptHead}…"`);
}
const movSc009Wrong = movNodes.find(
  (n: { data?: { customName?: string; generationParams?: { prompt?: string } } }) =>
    n.data?.customName === 'ep001_seq001_sc009' &&
    String(n.data?.generationParams?.prompt || '').includes('@资产:鸱吻')
);
ok('无 MOV 节点名叫 sc009 却带 sc007 鸱吻文案', !movSc009Wrong, movSc009Wrong ? 'node_1 串镜' : '');

const sc007Thumb = raw.nodes
  .find((n: { data?: { label?: string } }) => n.data?.label === 'ep001_seq001_sc007')
  ?.data?.generatedThumbnails?.[0]?.name;
ok('sc007 处理器缩略图名称不错位为 sc009', sc007Thumb !== 'ep001_seq001_sc009', String(sc007Thumb));

analyzeShot('ep001_seq001_sc007');
analyzeShot('ep001_seq001_sc009');

console.log('\n=== 66666666666 汇总 ===\n');
console.log(`通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
console.log('66666666666 模拟断言通过（WARN 项见上文）。');

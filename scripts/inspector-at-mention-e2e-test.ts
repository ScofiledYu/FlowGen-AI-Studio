/**
 * 属性面板 @ 提及端到端模拟：下拉列表 / 创意描述展示 token / 模型解析 plan。
 * npx tsx scripts/inspector-at-mention-e2e-test.ts
 */
import type { NodeData } from '../types.ts';
import {
  buildInspectorPromptMentionItems,
  mergeInspectorAtMentionItems,
  inspectorMentionDisplayNameForItem,
  buildPromptMediaRefContextForRun,
  buildPromptMediaRefLabels,
  buildCanonicalInspectorPromptPatch,
  getCanonicalInspectorPromptText,
  collectReferencedMediaFromPrompt,
  buildReferenceIndexOptionsFromPlan,
  resolvePromptPlaceholders,
  filterMediaRefs,
  findPromptMediaRefItemForToken,
  buildProjectAssetSlugUrlMap,
  repairPromptStraySlotLabelDuplicates,
  PROMPT_MEDIA_TOKEN_RE,
} from '../utils/promptMediaRefs.ts';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

function simNode(partial: Partial<NodeData> & { selectedModel: string }): NodeData {
  return { label: 'sim', ...partial } as NodeData;
}

const PROJ = 'p-test';
const huangtangId = 'a1111111-1111-1111-1111-111111111101';
const xiamoId = 'a2222222-2222-2222-2222-222222222202';
const baizeId = 'a3333333-3333-3333-3333-333333333303';

const ASSETS = [
  {
    slug: '荒塘镇街道1',
    name: '荒塘镇街道1',
    url: `http://localhost:3001/flowgen-api/projects/${PROJ}/assets/${huangtangId}/file`,
  },
  {
    slug: '夏茉',
    name: '夏茉',
    url: `http://localhost:3001/flowgen-api/projects/${PROJ}/assets/${xiamoId}/file`,
  },
  {
    slug: 'baize',
    name: '白泽',
    url: `http://localhost:3001/flowgen-api/projects/${PROJ}/assets/${baizeId}/file`,
  },
];

const slugMap = buildProjectAssetSlugUrlMap(ASSETS);

console.log('\n=== A. Nano 多图：@ 下拉仅面板槽 @资产:展示名 ===\n');

{
  const data = simNode({
    selectedModel: 'Nano Banana 2.0',
    imagePreview: ASSETS[0].url,
    imageName: '荒塘镇街道1',
    referenceImages: [ASSETS[1].url, ASSETS[2].url],
    referenceImageLabels: ['夏茉', '白泽'],
    prompt: '@主图 萧塘镇街道1 主图',
  });
  const ctx = buildPromptMediaRefContextForRun(data, ASSETS);
  const libItems = ASSETS.map((a) => ({
    label: `素材·${a.name}`,
    kind: 'projectAsset' as const,
    insertText: `@资产:${a.name}`,
  }));
  const mentions = buildInspectorPromptMentionItems(data, ctx);
  const withLib = buildInspectorPromptMentionItems(data, ctx, libItems);
  ok('下拉至少 3 项 @资产', mentions.filter((m) => m.insertText.startsWith('@资产:')).length >= 3);
  ok('含 @资产:荒塘镇街道1', mentions.some((m) => m.insertText === '@资产:荒塘镇街道1'));
  ok('含 @资产:夏茉', mentions.some((m) => m.insertText === '@资产:夏茉'));
  ok('含 @资产:白泽', mentions.some((m) => m.insertText === '@资产:白泽'));
  ok('过滤「夏」命中夏茉', filterMediaRefs(mentions, '夏').some((m) => m.insertText === '@资产:夏茉'));
  ok('过滤「荒塘」命中街道1', filterMediaRefs(mentions, '荒塘').some((m) => m.insertText === '@资产:荒塘镇街道1'));
  ok('不传项目库时不额外增加条目', withLib.length === mentions.length);
}

console.log('\n=== A1b. mergeInspectorAtMentionItems 工具函数（UI @ 下拉不用）===\n');

{
  const data = simNode({
    selectedModel: 'Nano Banana 2.0',
    imagePreview: ASSETS[0].url,
    imageName: '荒塘镇街道1',
    referenceImages: [],
    prompt: '',
  });
  const ctx = buildPromptMediaRefContextForRun(data, ASSETS);
  const panel = buildInspectorPromptMentionItems(data, ctx);
  const libItems = ASSETS.map((a) => ({
    label: `素材·${a.name}`,
    kind: 'projectAsset' as const,
    insertText: `@资产:${a.name}`,
  }));
  const merged = mergeInspectorAtMentionItems(panel, libItems);
  ok('合并后含项目库 @资产:熊二/白泽等', merged.some((m) => m.insertText === '@资产:白泽'));
  ok('过滤「白泽」命中库内资产', filterMediaRefs(merged, '白泽').some((m) => m.insertText === '@资产:白泽'));
  ok('面板主图与库内同名不重复', merged.filter((m) => m.insertText === '@资产:荒塘镇街道1').length === 1);
}

console.log('\n=== A2. 同资产名去重：主图与参考槽仅一项 ===\n');

{
  const data = simNode({
    selectedModel: 'Nano Banana 2.0',
    imagePreview: '',
    referenceImages: [ASSETS[1].url, ASSETS[1].url],
    referenceImageLabels: ['夏茉', '夏茉'],
    prompt: '',
  });
  const ctx = buildPromptMediaRefContextForRun(data, ASSETS);
  const mentions = buildInspectorPromptMentionItems(data, ctx);
  const xiamo = mentions.filter(
    (m) => inspectorMentionDisplayNameForItem(m) === '夏茉'
  );
  ok('双槽同资产名夏茉仅 1 条', xiamo.length === 1, JSON.stringify(mentions.map((m) => m.insertText)));
}

{
  const data = simNode({
    selectedModel: 'Nano Banana 2.0',
    imagePreview: ASSETS[0].url,
    imageName: '荒塘镇街道1',
    referenceImages: [ASSETS[1].url],
    referenceImageLabels: ['夏茉'],
    prompt: '',
  });
  const ctx = buildPromptMediaRefContextForRun(data, ASSETS);
  const mentions = buildInspectorPromptMentionItems(data, ctx);
  const huang = mentions.filter(
    (m) => inspectorMentionDisplayNameForItem(m) === '荒塘镇街道1'
  );
  ok('主图+参考槽：荒塘镇街道1 仅 1 条', huang.length === 1);
}

console.log('\n=== B. 创意描述规范：误扫 @主图 … 主图 → @资产:展示名 ===\n');

{
  const data = simNode({
    selectedModel: 'Nano Banana 2.0',
    imagePreview: ASSETS[0].url,
    imageName: '荒塘镇街道1',
    referenceImages: [ASSETS[1].url, ASSETS[2].url],
    referenceImageLabels: ['夏茉', '白泽'],
    prompt: '@主图 萧塘镇街道1 主图',
  });
  const canon = getCanonicalInspectorPromptText(data, ASSETS);
  ok('canonical 无 @主图', !canon.includes('@主图'));
  ok('canonical 为 @资产:荒塘镇街道1', canon.includes('@资产:荒塘镇街道1'));
  const patch = buildCanonicalInspectorPromptPatch(data, ASSETS);
  ok('patch 写回', patch != null && String(patch.prompt).includes('@资产:荒塘镇街道1'));
}

console.log('\n=== C. 模型 plan：@资产:名称 与 @图片n 均可解析到正确 URL/label ===\n');

{
  const data = simNode({
    selectedModel: 'Nano Banana 2.0',
    imagePreview: ASSETS[0].url,
    referenceImages: [ASSETS[1].url, ASSETS[2].url],
    referenceImageLabels: ['夏茉', '白泽'],
    prompt: '主场景@资产:荒塘镇街道1，人物@资产:夏茉与@资产:白泽，辅参考@图片2',
  });
  const ctx = buildPromptMediaRefContextForRun(data, ASSETS);
  const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, slugMap, ASSETS);
  ok('plan 至少 2 张不重复图', plan.images.length >= 2, `len=${plan.images.length}`);
  const ht = plan.images.find((e) => e.token === '@资产:荒塘镇街道1');
  const xm = plan.images.find((e) => e.token === '@资产:夏茉');
  ok('荒塘镇街道1 label', ht?.label === '荒塘镇街道1');
  ok('荒塘 URL', Boolean(ht?.url.includes(huangtangId)));
  ok('夏茉 URL', Boolean(xm?.url.includes(xiamoId)));
  ok(
    '白泽 URL（@资产:白泽 或 @图片2 去重后仍入 plan）',
    plan.images.some((e) => e.url.includes(baizeId))
  );
  const opts = buildReferenceIndexOptionsFromPlan(plan, { projectAssets: ASSETS });
  const resolved = resolvePromptPlaceholders(data.prompt!, data, ctx, opts);
  ok('展开含荒塘镇街道1', resolved.includes('荒塘镇街道1'));
  ok('展开含 [图1]', resolved.includes('[图1]'));
}

console.log('\n=== D. findPromptMediaRefItem：@图片n 映射到 @资产 槽 ===\n');

{
  const data = simNode({
    selectedModel: 'Nano Banana 2.0',
    imagePreview: ASSETS[0].url,
    referenceImages: [ASSETS[1].url, ASSETS[2].url],
    referenceImageLabels: ['夏茉', '白泽'],
    prompt: '',
  });
  const ctx = buildPromptMediaRefContextForRun(data, ASSETS);
  const labels = buildPromptMediaRefLabels(data, ctx);
  const item = findPromptMediaRefItemForToken(labels, '@图片2', '@图片2');
  ok('@图片2 → projectAsset 白泽', item?.kind === 'projectAsset' && item.label === '白泽');
}

console.log('\n=== E. @资产 token 不在中文逗号后粘连 ===\n');

{
  const prompt = '场景@资产:荒塘镇街道1，人物@资产:夏茉';
  const tokens = [...prompt.matchAll(PROMPT_MEDIA_TOKEN_RE)].map((m) => m[0]);
  ok('token 仅 2 个', tokens.length === 2, JSON.stringify(tokens));
  ok('第一个不含逗号', tokens[0] === '@资产:荒塘镇街道1');
  ok('第二个为夏茉', tokens[1] === '@资产:夏茉');
}

console.log('\n=== F. Seedance 参考生：主图+双参考槽下拉完整且主图为 @资产:名 ===\n');

{
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    imagePreview: ASSETS[2].url,
    imageName: '白泽',
    referenceImages: ['', ASSETS[0].url, ASSETS[1].url],
    referenceImageLabels: ['', '荒塘镇街道1', '夏茉'],
    prompt: '',
  });
  const ctx = buildPromptMediaRefContextForRun(data, ASSETS);
  const mentions = buildInspectorPromptMentionItems(data, ctx);
  ok('下拉 3 项', mentions.length === 3, JSON.stringify(mentions.map((m) => m.insertText)));
  ok('主图为 @资产:白泽', mentions.some((m) => m.insertText === '@资产:白泽'));
  ok('无 @主图 项', !mentions.some((m) => m.insertText === '@主图'));
  ok('含 @资产:荒塘镇街道1', mentions.some((m) => m.insertText === '@资产:荒塘镇街道1'));
  ok('含 @资产:夏茉', mentions.some((m) => m.insertText === '@资产:夏茉'));
}

console.log('\n=== F2. Seedance 参考生：无前导空槽时 @ 下拉仍 3 项 ===\n');

{
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    imagePreview: ASSETS[2].url,
    imageName: '白泽',
    referenceImages: [ASSETS[0].url, ASSETS[1].url],
    referenceImageLabels: ['荒塘镇街道1', '夏茉'],
    prompt: '',
  });
  const ctx = buildPromptMediaRefContextForRun(data, ASSETS);
  const mentions = buildInspectorPromptMentionItems(data, ctx);
  ok('紧凑槽位下拉 3 项', mentions.length === 3, JSON.stringify(mentions.map((m) => m.insertText)));
  ok('主图 @资产:白泽', mentions.some((m) => m.insertText === '@资产:白泽'));
  ok('街道 @资产', mentions.some((m) => m.insertText === '@资产:荒塘镇街道1'));
  ok('夏茉 @资产', mentions.some((m) => m.insertText === '@资产:夏茉'));
}

console.log('\n=== G. 首尾帧：下拉与规范文案为 @资产:展示名 ===\n');

{
  const data = simNode({
    selectedModel: '可灵 2.5 Turbo',
    firstFrameImageUrl: ASSETS[0].url,
    firstFrameImageLabel: '荒塘镇街道1',
    lastFrameImageUrl: ASSETS[1].url,
    lastFrameImageLabel: '夏茉',
    prompt: '从 @首帧图 到 @尾帧图',
  });
  const ctx = buildPromptMediaRefContextForRun(data, ASSETS);
  const mentions = buildInspectorPromptMentionItems(data, ctx);
  ok('首尾帧下拉含 @资产:荒塘镇街道1', mentions.some((m) => m.insertText === '@资产:荒塘镇街道1'));
  ok('首尾帧下拉含 @资产:夏茉', mentions.some((m) => m.insertText === '@资产:夏茉'));
  const canon = getCanonicalInspectorPromptText(data, ASSETS);
  ok('规范文案含 @资产:荒塘镇街道1', canon.includes('@资产:荒塘镇街道1'));
  ok('规范文案含 @资产:夏茉', canon.includes('@资产:夏茉'));
  const plan = collectReferencedMediaFromPrompt(canon, data, ctx, slugMap, ASSETS);
  ok('plan 解析首帧资产 URL', plan.images.some((i) => i.url === ASSETS[0].url));
  ok('plan 解析尾帧资产 URL', plan.images.some((i) => i.url === ASSETS[1].url));
}

console.log('\n=== G2. Image2：三格图仅 3 项 @ 下拉（主图+参考不重复计） ===\n');

{
  const main = ASSETS[2].url;
  const thumb = main.replace('/file', '/thumb');
  const data = simNode({
    selectedModel: 'image 2',
    imagePreview: main,
    imageName: '白泽',
    referenceImages: [thumb, ASSETS[0].url, ASSETS[1].url],
    referenceImageLabels: ['白泽', '荒塘镇街道1', '夏茉'],
  });
  const ctx = buildPromptMediaRefContextForRun(data, ASSETS);
  const mentions = buildInspectorPromptMentionItems(data, ctx);
  ok('image2 下拉 3 项', mentions.length === 3, JSON.stringify(mentions.map((m) => m.insertText)));
  ok('无第 4 项 @图片3', !mentions.some((m) => m.insertText === '@图片3'));
}

console.log('\n=== H. 全模型抽样：Seedance 参考生 plan ===\n');

{
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    imagePreview: ASSETS[0].url,
    referenceImages: ['', ASSETS[1].url, ASSETS[2].url],
    referenceImageLabels: ['', '夏茉', '白泽'],
    prompt: '@资产:荒塘镇街道1 走向 @资产:夏茉',
  });
  const ctx = buildPromptMediaRefContextForRun(data, ASSETS);
  const mentions = buildInspectorPromptMentionItems(data, ctx);
  ok('Seedance 下拉含夏茉', mentions.some((m) => m.insertText === '@资产:夏茉'));
  const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, slugMap, ASSETS);
  ok('Seedance plan 2 图', plan.images.length === 2);
}

console.log('\n=== I. 运行后追加参考图：@ 下拉含新槽 ===\n');

{
  const main = 'https://cos.example/main-cat.png';
  const ref1 = 'https://cos.example/ref1.png';
  const ref2 = 'https://cos.example/ref2.png';
  const refNew = 'https://cos.example/ref-new.png';
  const afterRun = simNode({
    selectedModel: 'Nano Banana 2.0',
    imagePreview: ref1,
    panelMainImageUrl: main,
    referenceImages: [ref1, ref2],
    referenceImageLabels: ['图片1', '图片2'],
    prompt: '@图片1参考@图片2风格',
    generationParams: {
      referenceImages: [ref1, ref2],
      prompt: '@图片1参考@图片2风格',
    },
  });
  const withNew = {
    ...afterRun,
    referenceImages: [...(afterRun.referenceImages || []), refNew],
    referenceImageLabels: [...(afterRun.referenceImageLabels || []), '新图'],
  };
  const ctx = buildPromptMediaRefContextForRun(withNew, ASSETS);
  const mentions = buildInspectorPromptMentionItems(withNew, ctx);
  ok('@ 下拉含 @主图', mentions.some((m) => m.insertText === '@主图'));
  ok('@ 下拉含新槽 @图片3', mentions.some((m) => m.insertText === '@图片3' && m.refImageIndex === 2));
  ok('ref1 槽为 @图片1', mentions.some((m) => m.insertText === '@图片1' && m.refImageIndex === 0));
  ok('过滤「新图」命中新槽', filterMediaRefs(mentions, '新图').some((m) => m.refImageIndex === 2));
}

console.log('\n=== 汇总 ===\n');
console.log(`通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
console.log('属性面板 @ 端到端模拟全部通过。');

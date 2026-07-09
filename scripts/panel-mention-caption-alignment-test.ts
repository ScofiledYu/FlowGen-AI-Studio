/**
 * 面板底栏标识 ↔ 创意描述 @ token 对齐
 * npx tsx scripts/panel-mention-caption-alignment-test.ts
 */
import type { NodeData } from '../types.ts';
import {
  buildInspectorPromptMentionItems,
  buildPromptMediaRefContextForRun,
  collectReferencedMediaFromPrompt,
  effectiveFirstFramePanelUrl,
  inspectorMentionDisplayNameForItem,
  mentionInsertTextForPanelCaption,
  resolvePromptPlaceholders,
  buildReferenceIndexOptionsFromPlan,
  buildProjectAssetSlugUrlMap,
} from '../utils/promptMediaRefs.ts';
import { assignStartEndUrlsFromImagePlan } from '../utils/referencedMediaRun.ts';
import {
  resolveFirstLastFramePanelDisplayLabel,
  resolveMainImagePanelDisplayLabel,
} from '../utils/referenceImageSlotLabels.ts';

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
const ASSETS = [
  {
    slug: '萧道',
    name: '萧道',
    url: `http://localhost:3001/flowgen-api/projects/${PROJ}/assets/a1111111-1111-1111-1111-111111111101/file`,
  },
  {
    slug: '鸱吻',
    name: '鸱吻',
    url: `http://localhost:3001/flowgen-api/projects/${PROJ}/assets/a2222222-2222-2222-2222-222222222202/file`,
  },
];

const slugMap = buildProjectAssetSlugUrlMap(ASSETS);

function assertPanelMentionAlign(
  name: string,
  data: NodeData,
  slot: { kind: 'main' | 'first' | 'last'; caption: string }
) {
  const ctx = buildPromptMediaRefContextForRun(data, ASSETS);
  const expectedToken = mentionInsertTextForPanelCaption(
    slot.caption,
    slot.kind,
    data,
    ctx
  );
  const mentions = buildInspectorPromptMentionItems(data, ctx);
  const hit = mentions.find((m) => m.insertText === expectedToken);
  ok(
    `${name}: 面板「${slot.caption}」→ ${expectedToken}`,
    Boolean(hit),
    `mentions=${JSON.stringify(mentions.map((m) => m.insertText))}`
  );
  if (hit) {
    ok(
      `${name}: @展示名与底栏一致`,
      inspectorMentionDisplayNameForItem(hit) === slot.caption ||
        (slot.caption === '主图' && hit.insertText === '@主图') ||
        (slot.caption === '首帧图' && hit.insertText === '@首帧图'),
      `display=${inspectorMentionDisplayNameForItem(hit)}`
    );
  }
}

console.log('\n=== 1. 泛称：主图 / 首帧图 ===\n');

{
  const data = simNode({
    selectedModel: '可灵 2.5 Turbo',
    imagePreview: 'https://ex/cat.jpg',
    prompt: '@首帧图 动起来',
  });
  const ctx = buildPromptMediaRefContextForRun(data, ASSETS);
  ok('首帧有效 URL 回退主预览', effectiveFirstFramePanelUrl(data, ctx) === 'https://ex/cat.jpg');
  const cap =
    resolveFirstLastFramePanelDisplayLabel(
      { ...data, firstFrameImageUrl: effectiveFirstFramePanelUrl(data, ctx) },
      'first',
      ASSETS
    ) || '首帧图';
  ok('面板首帧底栏=首帧图', cap === '首帧图');
  assertPanelMentionAlign('可灵仅主预览', data, { kind: 'first', caption: '首帧图' });
  ok('无 @主图 误项', !buildInspectorPromptMentionItems(data, ctx).some((m) => m.insertText === '@主图'));
  const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, slugMap, ASSETS);
  ok('@首帧图 解析到主预览 URL', plan.images.some((i) => i.url === data.imagePreview));
}

console.log('\n=== 2. 资产名：面板与 @资产 一致 ===\n');

{
  const data = simNode({
    selectedModel: '可灵 2.5 Turbo',
    firstFrameImageUrl: ASSETS[0].url,
    firstFrameImageLabel: '萧道',
    lastFrameImageUrl: ASSETS[1].url,
    lastFrameImageLabel: '鸱吻',
    prompt: '@资产:萧道 衔接 @资产:鸱吻',
  });
  assertPanelMentionAlign('首帧资产', data, { kind: 'first', caption: '萧道' });
  assertPanelMentionAlign('尾帧资产', data, { kind: 'last', caption: '鸱吻' });
}

console.log('\n=== 3. Nano 主图槽 ===\n');

{
  const data = simNode({
    selectedModel: 'Nano Banana 2.0',
    imagePreview: ASSETS[0].url,
    imageName: '萧道',
    referenceImages: [ASSETS[1].url],
    referenceImageLabels: ['鸱吻'],
    prompt: '@资产:萧道 与 @资产:鸱吻',
  });
  const mainCap = resolveMainImagePanelDisplayLabel(data.imagePreview, {
    projectAssets: ASSETS,
    imageName: data.imageName,
  });
  ok('主图底栏=萧道', mainCap === '萧道');
  assertPanelMentionAlign('Nano主图', data, { kind: 'main', caption: mainCap });
}

console.log('\n=== 4. Seedance 图生：首帧泛称 + 模型展开 ===\n');

{
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'image',
    imagePreview: 'https://ex/start.png',
    prompt: '以 @首帧图 生成视频',
  });
  const ctx = buildPromptMediaRefContextForRun(data, ASSETS);
  assertPanelMentionAlign('Seedance图生', data, { kind: 'first', caption: '首帧图' });
  const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, slugMap, ASSETS);
  const opts = buildReferenceIndexOptionsFromPlan(plan, { projectAssets: ASSETS });
  const expanded = resolvePromptPlaceholders(data.prompt!, data, ctx, opts);
  ok('展开含首帧图', expanded.includes('首帧'));
}

console.log('\n=== 5. 仅拖尾帧：主预览回退首帧，@ 下拉仍含首帧图 ===\n');

{
  const data = simNode({
    selectedModel: '可灵 2.5 Turbo',
    imagePreview: 'https://ex/main.jpg',
    lastFrameImageUrl: ASSETS[1].url,
    lastFrameImageLabel: '鸱吻',
    prompt: '',
  });
  const ctx = buildPromptMediaRefContextForRun(data, ASSETS);
  const mentions = buildInspectorPromptMentionItems(data, ctx);
  ok('仅尾帧时含 @首帧图', mentions.some((m) => m.insertText === '@首帧图'), JSON.stringify(mentions.map((m) => m.insertText)));
  ok('仅尾帧时含 @资产:鸱吻', mentions.some((m) => m.insertText === '@资产:鸱吻'));
  ok('下拉 2 项', mentions.length === 2, `count=${mentions.length}`);
}

{
  const data = simNode({
    selectedModel: '可灵 2.5 Turbo',
    imagePreview: 'https://ex/main.jpg',
    firstFrameLocalRef: 'flowgen-local:test:main',
    lastFrameImageUrl: ASSETS[1].url,
    lastFrameImageLabel: '鸱吻',
    prompt: '',
  });
  const ctx = buildPromptMediaRefContextForRun(data, ASSETS);
  const mentions = buildInspectorPromptMentionItems(data, ctx);
  ok('首帧 localRef + 仅尾帧：含 @首帧图', mentions.some((m) => m.insertText === '@首帧图'));
}

console.log('\n=== 6. 发模型：@ 解析 URL + 首尾帧 API 槽位 ===\n');

{
  const data = simNode({
    selectedModel: '可灵 2.5 Turbo',
    imagePreview: 'https://ex/main.jpg',
    lastFrameImageUrl: ASSETS[1].url,
    lastFrameImageLabel: '鸱吻',
    prompt: '从 @首帧图 过渡到 @尾帧图',
  });
  const ctx = buildPromptMediaRefContextForRun(data, ASSETS);
  const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, slugMap, ASSETS);
  const startEntry = plan.images.find((e) => e.token === '@首帧图');
  const endEntry = plan.images.find((e) => e.token === '@尾帧图');
  ok('@首帧图 解析到主预览', startEntry?.url === data.imagePreview);
  ok('@首帧图 refFrameIndex=0', startEntry?.refFrameIndex === 0);
  ok('@尾帧图 refFrameIndex=1', endEntry?.refFrameIndex === 1);
  const uploaded = new Map<string, string>([
    ['@首帧图', data.imagePreview!],
    ['@尾帧图', ASSETS[1].url],
  ]);
  const { startUrl, endUrl } = assignStartEndUrlsFromImagePlan(plan, uploaded);
  ok('API 首帧=主预览', startUrl === data.imagePreview);
  ok('API 尾帧=鸱吻', endUrl === ASSETS[1].url);
  const opts = buildReferenceIndexOptionsFromPlan(plan, { projectAssets: ASSETS });
  const expanded = resolvePromptPlaceholders(data.prompt!, data, ctx, opts);
  ok('展开含首帧说明', expanded.includes('首帧'));
  ok('展开含尾帧说明', expanded.includes('尾帧'));
}

{
  const data = simNode({
    selectedModel: '可灵 2.5 Turbo',
    firstFrameImageUrl: ASSETS[0].url,
    firstFrameImageLabel: '萧道',
    lastFrameImageUrl: ASSETS[1].url,
    lastFrameImageLabel: '鸱吻',
    prompt: '@资产:萧道 衔接到 @资产:鸱吻',
  });
  const ctx = buildPromptMediaRefContextForRun(data, ASSETS);
  const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, slugMap, ASSETS);
  ok('@资产:萧道 refFrameIndex=0', plan.images.find((e) => e.token === '@资产:萧道')?.refFrameIndex === 0);
  ok('@资产:鸱吻 refFrameIndex=1', plan.images.find((e) => e.token === '@资产:鸱吻')?.refFrameIndex === 1);
  const uploaded = new Map([
    ['@资产:萧道', ASSETS[0].url],
    ['@资产:鸱吻', ASSETS[1].url],
  ]);
  const { startUrl, endUrl } = assignStartEndUrlsFromImagePlan(plan, uploaded);
  ok('@资产 双帧 API start', startUrl === ASSETS[0].url);
  ok('@资产 双帧 API end', endUrl === ASSETS[1].url);
}

console.log(`\n=== 汇总 ===\n通过 ${pass}，失败 ${fail}\n`);
if (fail > 0) process.exit(1);

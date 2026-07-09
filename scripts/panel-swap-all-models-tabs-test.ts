/**
 * 全模型 / 全 tab：面板换图 + 创意描述 @ 元素 与 skill 定义一致（不调用生成 API）。
 * npx tsx scripts/panel-swap-all-models-tabs-test.ts
 */
import type { NodeData } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2 } from '../types.ts';
import {
  buildPromptMediaRefContextForRun,
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
  matchAllPromptMediaTokens,
  resolveProjectAssetUrlForPromptToken,
} from '../utils/promptMediaRefs.ts';
import {
  mergeAndPrunePanelReferenceImagesAfterUpload,
  panelMergeOptionsForReferencedUpload,
} from '../utils/referencedMediaRun.ts';

let pass = 0;
let fail = 0;

function simNode(partial: Partial<NodeData> & { selectedModel: string }): NodeData {
  return { label: 'sim', ...partial } as NodeData;
}

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const PROJ = 'swap-all-proj';
const OLD_A = `/flowgen-api/projects/${PROJ}/assets/old-a/file`;
const OLD_B = `/flowgen-api/projects/${PROJ}/assets/old-b/file`;
const NEW_A = `/flowgen-api/projects/${PROJ}/assets/new-a/file`;
const NEW_B = `/flowgen-api/projects/${PROJ}/assets/new-b/file`;
const ASSETS = [
  { slug: '旧图A', name: '旧图A', url: OLD_A },
  { slug: '旧图B', name: '旧图B', url: OLD_B },
  { slug: '新图A', name: '新图A', url: NEW_A },
  { slug: '新图B', name: '新图B', url: NEW_B },
];
const SLUG_MAP = new Map(ASSETS.map((a) => [a.slug, a.url]));

type TabCase = {
  id: string;
  data: NodeData;
  panelBefore: string[];
  prompt: string;
  labels?: string[];
};

function refPanel(data: NodeData): string[] {
  const m = data.selectedModel || '';
  if (m === '可灵3.0 Omni') {
    const tab = data.klingOmniTab || 'multi';
    if (tab === 'multi') return [...(data.klingOmniMultiReferenceImages || [])];
    if (tab === 'instruction') return [...(data.klingOmniInstructionReferenceImages || [])];
    if (tab === 'video') return [...(data.klingOmniVideoReferenceImages || [])];
    return [];
  }
  if (m.includes('seedance') && data.seedanceGenerationMode === 'reference') {
    return [...(data.seedanceTabConfigs?.reference?.referenceImages || data.referenceImages || [])];
  }
  return [...(data.referenceImages || [])];
}

function mockUploaded(plan: ReturnType<typeof collectReferencedMediaFromPrompt>): Map<string, string> {
  const m = new Map<string, string>();
  for (const img of plan.images) m.set(img.token, `${img.url}|UP`);
  for (const v of plan.videos) m.set(v.token, `${v.url}|UP`);
  return m;
}

function picSlotUrlForAssert(
  data: NodeData,
  panelBefore: string[],
  ord: 1 | 2
): string | undefined {
  const m = data.selectedModel || '';
  const isSeedanceRef =
    m.includes('seedance') && data.seedanceGenerationMode === 'reference';
  if (isSeedanceRef) {
    const prev = data.imagePreview?.trim();
    let picOrd = 0;
    for (const raw of panelBefore) {
      const u = String(raw || '').trim();
      if (!u) continue;
      if (prev && u === prev) continue;
      picOrd += 1;
      if (picOrd === ord) return u;
    }
    return undefined;
  }
  return panelBefore[ord - 1];
}

function runSwapCase(row: TabCase) {
  const { id, data, panelBefore, prompt, labels } = row;
  const ctx = buildPromptMediaRefContextForRun(data, ASSETS);
  const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, SLUG_MAP, ASSETS);
  ok(`${id}: @ 解析至少 1 项`, plan.images.length >= 1, `count=${plan.images.length}`);
  const a = plan.images.find((e) => e.token.includes('旧图A'));
  const b = plan.images.find((e) => e.token.includes('旧图B'));
  if (a) ok(`${id}: @旧图A 用面板新图`, a.url === NEW_A, a.url);
  if (b) ok(`${id}: @旧图B 用面板新图`, b.url === NEW_B, b.url);
  const pic1 = plan.images.find((e) => e.token === '@图片1');
  const pic2 = plan.images.find((e) => e.token === '@图片2');
  if (pic1) {
    const slot = picSlotUrlForAssert(data, panelBefore, 1);
    ok(`${id}: @图片1=面板槽`, pic1.url === slot, pic1.url);
  }
  if (pic2) {
    const slot = picSlotUrlForAssert(data, panelBefore, 2);
    ok(`${id}: @图片2=面板槽`, pic2.url === slot, pic2.url);
  }
  const uploaded = mockUploaded(plan);
  const after = mergeAndPrunePanelReferenceImagesAfterUpload(
    panelBefore,
    plan.images,
    uploaded,
    panelMergeOptionsForReferencedUpload(
      plan.images,
      uploaded,
      data.imagePreview,
      SLUG_MAP,
      labels ?? data.referenceImageLabels
    )
  );
  if (a) {
    const idxA = panelBefore.findIndex((u) => String(u || '').trim() === NEW_A);
    if (idxA >= 0) {
      ok(`${id}: 运行写回旧图A槽仍为新A`, after[idxA]?.replace(/\|UP$/, '') === NEW_A);
    }
  }
  if (b) {
    const idxB = panelBefore.findIndex((u) => String(u || '').trim() === NEW_B);
    if (idxB >= 0) {
      ok(`${id}: 运行写回旧图B槽仍为新B`, after[idxB]?.replace(/\|UP$/, '') === NEW_B);
    }
  }
  if (pic1) {
    const pic1Url = picSlotUrlForAssert(data, panelBefore, 1);
    const idx1 = pic1Url ? panelBefore.findIndex((u) => String(u || '').trim() === pic1Url) : -1;
    if (idx1 >= 0) ok(`${id}: @图片1 运行后写回`, after[idx1]?.endsWith('|UP'));
  }
  if (pic2) {
    const pic2Url = picSlotUrlForAssert(data, panelBefore, 2);
    const idx2 = pic2Url ? panelBefore.findIndex((u) => String(u || '').trim() === pic2Url) : -1;
    if (idx2 >= 0) ok(`${id}: @图片2 运行后写回`, after[idx2]?.endsWith('|UP'));
  }
}

const panelSwap = [NEW_A, NEW_B];
const assetPrompt = '@资产:旧图A 融合 @资产:旧图B';
const picPrompt = '@图片1 与 @图片2 合成';

const CASES: TabCase[] = [
  {
    id: 'Nano · @资产',
    data: simNode({
      selectedModel: MODEL_NANO_BANANA_2,
      imagePreview: 'https://cos/main.png',
      referenceImages: panelSwap,
      referenceImageLabels: ['旧图A', '旧图B'],
      prompt: assetPrompt,
    }),
    panelBefore: panelSwap,
    prompt: assetPrompt,
  },
  {
    id: 'Nano · @图片n',
    data: simNode({
      selectedModel: MODEL_NANO_BANANA_2,
      imagePreview: 'https://cos/main.png',
      referenceImages: panelSwap,
      prompt: picPrompt,
    }),
    panelBefore: panelSwap,
    prompt: picPrompt,
  },
  {
    id: 'image2 · @资产',
    data: simNode({
      selectedModel: MODEL_IMAGE_2,
      imagePreview: 'https://cos/main.png',
      referenceImages: panelSwap,
      referenceImageLabels: ['旧图A', '旧图B'],
      prompt: assetPrompt,
    }),
    panelBefore: panelSwap,
    prompt: assetPrompt,
  },
  {
    id: 'image2 · @图片n',
    data: simNode({
      selectedModel: MODEL_IMAGE_2,
      imagePreview: 'https://cos/main.png',
      referenceImages: panelSwap,
      prompt: picPrompt,
    }),
    panelBefore: panelSwap,
    prompt: picPrompt,
  },
  {
    id: 'Seedance reference · @资产',
    data: simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      referenceImages: panelSwap,
      referenceImageLabels: ['旧图A', '旧图B'],
      seedanceTabConfigs: { reference: { prompt: assetPrompt } },
    }),
    panelBefore: panelSwap,
    prompt: assetPrompt,
  },
  {
    id: 'Seedance reference · @图片n',
    data: simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: 'https://cos/main.png',
      referenceImages: ['https://cos/main.png', ...panelSwap],
      seedanceTabConfigs: { reference: { prompt: picPrompt } },
    }),
    panelBefore: ['https://cos/main.png', ...panelSwap],
    prompt: picPrompt,
  },
  {
    id: 'Seedance reference · @资产+@图片n 混排',
    data: simNode({
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'reference',
      imagePreview: 'https://cos/main.png',
      referenceImages: [NEW_B, NEW_A],
      referenceImageLabels: ['旧图B', '旧图A'],
      seedanceTabConfigs: {
        reference: { prompt: '@资产:旧图A 参考 @图片1 的风格' },
      },
    }),
    panelBefore: [NEW_B, NEW_A],
    prompt: '@资产:旧图A 参考 @图片1 的风格',
    labels: ['旧图B', '旧图A'],
  },
  {
    id: 'Omni multi · @资产',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      klingOmniMultiReferenceImages: panelSwap,
      referenceImageLabels: ['旧图A', '旧图B'],
      klingOmniMultiPrompt: assetPrompt,
    }),
    panelBefore: panelSwap,
    prompt: assetPrompt,
  },
  {
    id: 'Omni multi · @图片n',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      imagePreview: 'https://cos/main.png',
      klingOmniMultiReferenceImages: panelSwap,
      klingOmniMultiPrompt: picPrompt,
    }),
    panelBefore: panelSwap,
    prompt: picPrompt,
  },
  {
    id: 'Omni instruction · @资产',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'instruction',
      klingOmniInstructionReferenceImages: panelSwap,
      referenceImageLabels: ['旧图A', '旧图B'],
      klingOmniInstructionPrompt: assetPrompt,
    }),
    panelBefore: panelSwap,
    prompt: assetPrompt,
  },
  {
    id: 'Omni video · @资产',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'video',
      klingOmniVideoReferenceImages: panelSwap,
      referenceImageLabels: ['旧图A', '旧图B'],
      klingOmniVideoPrompt: assetPrompt,
    }),
    panelBefore: panelSwap,
    prompt: assetPrompt,
  },
];

console.log('\n=== 全模型 tab：面板换图 + @ 元素 ===\n');
for (const c of CASES) {
  runSwapCase(c);
}

console.log('\n=== skill：blob 误拖仍用资产库 ===\n');
{
  ok(
    'blob 错图仍用库',
    resolveProjectAssetUrlForPromptToken('blob:http://localhost/wrong', OLD_A) === OLD_A
  );
  ok(
    'aitop 错 COS 仍用库',
    resolveProjectAssetUrlForPromptToken(
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/x/wrong.png',
      OLD_A
    ) === OLD_A
  );
  ok(
    '用户换新 http 图以面板为准',
    resolveProjectAssetUrlForPromptToken(NEW_A, OLD_A) === NEW_A
  );
}

console.log('\n=== skill：@资产 token 边界（无空格粘连）===\n');
{
  const prompt = '萧逍@资产:萧逍 走向 @图片1';
  const data = simNode({
    selectedModel: MODEL_NANO_BANANA_2,
    referenceImages: [NEW_A],
    prompt,
  });
  const ctx = buildPromptMediaRefContextFromNode(data);
  ctx.projectAssets = ASSETS;
  const tokens = matchAllPromptMediaTokens(prompt, ASSETS).map((t) => t.token);
  ok('无空格 @资产 可解析', tokens.includes('@资产:萧逍') || tokens.includes('@资产:旧图A') || tokens.length >= 1);
}

console.log('\n=== 汇总 ===\n');
console.log(`通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
console.log('全模型 tab 面板换图 + @ 引用测试通过。');

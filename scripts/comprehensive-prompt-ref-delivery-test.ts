/**
 * 交付级综合测试：各生图/生视频模型（含 tab）、无空格 @ 引用解析/展开/高亮、分镜下游创意描述。
 * npx tsx scripts/comprehensive-prompt-ref-delivery-test.ts
 */
import type { NodeData } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2 } from '../types.ts';
import {
  buildPromptMediaRefContextForRun,
  buildReferenceIndexOptionsFromPlan,
  collectReferencedMediaFromPrompt,
  matchAllPromptMediaTokens,
  resolvePromptPlaceholders,
  scanPromptAppendAllTokens,
  getCanonicalInspectorPromptText,
  buildInspectorPromptMentionItems,
} from '../utils/promptMediaRefs.ts';
import { enrichSpawnedStoryboardNodeData } from '../utils/enrichSpawnedStoryboardNode.ts';
import {
  buildPromptFromRow,
  parseStoryboardSpawnRows,
} from '../utils/storyboardTableSpawn.ts';

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

type ModelTabCase = {
  id: string;
  data: Partial<NodeData> & { selectedModel: string };
  /** 写入对应 tab 的创意描述字段 */
  applyPrompt: (data: NodeData, prompt: string) => NodeData;
  readPrompt: (data: NodeData) => string;
};

const PROJ = 'delivery-proj';
const ASSETS = [
  { slug: '萧逍', name: '萧逍', url: `/flowgen-api/projects/${PROJ}/assets/id-xd/file` },
  { slug: '鸱吻', name: '鸱吻', url: `/flowgen-api/projects/${PROJ}/assets/id-cw/file` },
  { slug: '夏茉', name: '夏茉', url: `/flowgen-api/projects/${PROJ}/assets/id-xm/file` },
  { slug: 'street2', name: '萧塘镇街道2', url: `/flowgen-api/projects/${PROJ}/assets/id-st/file` },
];
const slugMap = new Map(ASSETS.map((a) => [a.slug, a.url]));

function promptRefKind(token: string): string {
  if (token === '@主图' || token === '@首帧图' || token === '@尾帧图') return 'mainImage';
  if (token === '@主视频') return 'mainVideo';
  if (token.startsWith('@视频')) return 'video';
  if (token.startsWith('@音频')) return 'audio';
  if (token.startsWith('@资产:')) return 'projectAsset';
  return 'image';
}

function simulateColoredSegments(text: string): Array<{ token: string; kind: string }> {
  return matchAllPromptMediaTokens(text, ASSETS).map(({ token }) => ({
    token,
    kind: promptRefKind(token),
  }));
}

function baseRefs() {
  return {
    imagePreview: ASSETS[0].url,
    imageName: '萧逍',
    referenceImages: ASSETS.map((a) => a.url!),
    referenceImageLabels: ['萧逍', '鸱吻', '夏茉', '萧塘镇街道2'],
  };
}

const MODEL_TAB_CASES: ModelTabCase[] = [
  {
    id: 'Nano Banana 2.0',
    data: { selectedModel: MODEL_NANO_BANANA_2, ...baseRefs() },
    applyPrompt: (d, p) => ({ ...d, prompt: p }),
    readPrompt: (d) => d.prompt || '',
  },
  {
    id: 'image 2',
    data: { selectedModel: MODEL_IMAGE_2, ...baseRefs() },
    applyPrompt: (d, p) => ({ ...d, prompt: p }),
    readPrompt: (d) => d.prompt || '',
  },
  {
    id: '可灵3.0 Omni · multi',
    data: {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      ...baseRefs(),
      klingOmniMultiReferenceImages: ASSETS.slice(0, 3).map((a) => a.url!),
    },
    applyPrompt: (d, p) => ({ ...d, prompt: p, klingOmniMultiPrompt: p }),
    readPrompt: (d) => d.klingOmniMultiPrompt ?? d.prompt ?? '',
  },
  {
    id: '可灵3.0 Omni · instruction',
    data: {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'instruction',
      ...baseRefs(),
      klingOmniInstructionReferenceImages: ASSETS.slice(0, 2).map((a) => a.url!),
    },
    applyPrompt: (d, p) => ({ ...d, prompt: p, klingOmniInstructionPrompt: p }),
    readPrompt: (d) => d.klingOmniInstructionPrompt ?? d.prompt ?? '',
  },
  {
    id: '可灵3.0 Omni · video',
    data: {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'video',
      ...baseRefs(),
      klingOmniVideoReferenceImages: ASSETS.slice(0, 2).map((a) => a.url!),
    },
    applyPrompt: (d, p) => ({ ...d, prompt: p, klingOmniVideoPrompt: p }),
    readPrompt: (d) => d.klingOmniVideoPrompt ?? d.prompt ?? '',
  },
  {
    id: '可灵3.0 Omni · frames',
    data: {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'frames',
      ...baseRefs(),
      firstFrameImageUrl: ASSETS[3].url,
      firstFrameImageLabel: '萧塘镇街道2',
      lastFrameImageUrl: ASSETS[2].url,
      lastFrameImageLabel: '夏茉',
    },
    applyPrompt: (d, p) => ({ ...d, prompt: p, klingOmniFramesPrompt: p }),
    readPrompt: (d) => d.klingOmniFramesPrompt ?? d.prompt ?? '',
  },
  {
    id: '可灵 2.5 Turbo',
    data: { selectedModel: '可灵 2.5 Turbo', ...baseRefs() },
    applyPrompt: (d, p) => ({ ...d, prompt: p }),
    readPrompt: (d) => d.prompt || '',
  },
  {
    id: 'vidu 2.0',
    data: { selectedModel: 'vidu 2.0', ...baseRefs() },
    applyPrompt: (d, p) => ({ ...d, prompt: p }),
    readPrompt: (d) => d.prompt || '',
  },
  {
    id: 'seedance2.0 · text',
    data: {
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'text',
      ...baseRefs(),
    },
    applyPrompt: (d, p) => ({
      ...d,
      prompt: p,
      seedanceTabConfigs: { ...(d.seedanceTabConfigs || {}), text: { prompt: p } },
    }),
    readPrompt: (d) => d.seedanceTabConfigs?.text?.prompt ?? d.prompt ?? '',
  },
  {
    id: 'seedance2.0 · image',
    data: {
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'image',
      ...baseRefs(),
      firstFrameImageUrl: ASSETS[0].url,
      lastFrameImageUrl: ASSETS[2].url,
    },
    applyPrompt: (d, p) => ({
      ...d,
      prompt: p,
      seedanceTabConfigs: { ...(d.seedanceTabConfigs || {}), image: { prompt: p } },
    }),
    readPrompt: (d) => d.seedanceTabConfigs?.image?.prompt ?? d.prompt ?? '',
  },
  {
    id: 'seedance2.0 · reference',
    data: {
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      ...baseRefs(),
      seedanceTabConfigs: {
        reference: {
          referenceImages: ASSETS.map((a) => a.url!),
          referenceImageLabels: ['萧逍', '鸱吻', '夏茉', '萧塘镇街道2'],
        },
      },
    },
    applyPrompt: (d, p) => ({
      ...d,
      prompt: p,
      seedanceTabConfigs: {
        ...(d.seedanceTabConfigs || {}),
        reference: { ...(d.seedanceTabConfigs?.reference || {}), prompt: p },
      },
    }),
    readPrompt: (d) => d.seedanceTabConfigs?.reference?.prompt ?? d.prompt ?? '',
  },
  {
    id: 'seedance1.5-pro · image',
    data: {
      selectedModel: 'seedance1.5-pro',
      seedanceGenerationMode: 'image',
      ...baseRefs(),
      firstFrameImageUrl: ASSETS[0].url,
    },
    applyPrompt: (d, p) => ({ ...d, prompt: p }),
    readPrompt: (d) => d.prompt || '',
  },
  {
    id: '即梦3.0 Pro',
    data: {
      selectedModel: '即梦3.0 Pro',
      ...baseRefs(),
      firstFrameImageUrl: ASSETS[0].url,
    },
    applyPrompt: (d, p) => ({ ...d, prompt: p }),
    readPrompt: (d) => d.prompt || '',
  },
];

console.log('\n=== 1. 各模型 tab：无空格扫描 + 解析 + 展开 + 高亮 token ===\n');

const noSpaceRaw =
  '【身份锁定】萧逍@资产:萧逍走向鸱吻@资产:鸱吻，夏茉@资产:夏茉在@资产:萧塘镇街道2';
const scanRefs = ASSETS.map((a) => ({ label: a.name, insertText: `@资产:${a.name}` }));

for (const tc of MODEL_TAB_CASES) {
  const base = simNode(tc.data as Partial<NodeData> & { selectedModel: string });
  const scanned = scanPromptAppendAllTokens(noSpaceRaw, scanRefs);
  ok(`${tc.id}: 扫描无尾随空格`, !/@资产:[^\s]+ /.test(scanned));

  let data = tc.applyPrompt(base, scanned);
  const ctx = buildPromptMediaRefContextForRun(data, ASSETS);
  const readBack = tc.readPrompt(data);
  ok(`${tc.id}: tab 创意描述已写入`, readBack.length > 0);

  const canon = getCanonicalInspectorPromptText(data, ASSETS);
  const plan = collectReferencedMediaFromPrompt(canon, data, ctx, slugMap, ASSETS);
  ok(
    `${tc.id}: plan 含萧逍/鸱吻/夏茉`,
    plan.images.some((e) => e.label === '萧逍') &&
      plan.images.some((e) => e.label === '鸱吻') &&
      plan.images.some((e) => e.label === '夏茉')
  );

  const opts = buildReferenceIndexOptionsFromPlan(plan, { projectAssets: ASSETS });
  const expanded = resolvePromptPlaceholders(canon, data, ctx, opts);
  ok(`${tc.id}: 展开后无裸 @资产:`, !/@资产:/.test(expanded));
  ok(`${tc.id}: 展开保留走向`, expanded.includes('走向'));

  const segments = simulateColoredSegments(canon);
  ok(
    `${tc.id}: 高亮 ≥4 个不同 token`,
    segments.length >= 4,
    segments.map((s) => s.token).join(', ')
  );
  ok(
    `${tc.id}: 高亮含 projectAsset 色类`,
    segments.every((s) => s.kind === 'projectAsset'),
    segments.map((s) => s.kind).join(',')
  );

  const mentions = buildInspectorPromptMentionItems(data, ctx);
  ok(`${tc.id}: 素材引用 chip ≥1`, mentions.length >= 1);
}

console.log('\n=== 2. 分镜表 → 下游节点创意描述 + enrich ===\n');

{
  const tableRows = [
    ['镜头编码', '单镜秒数', '关联剧本', '景别/视角/构图', '画面描述'],
    [
      'ep003_seq008_sc056',
      '15',
      '08场·颁奖台',
      '近景/平视',
      '萧逍@资产:萧逍 与鸱吻@资产:鸱吻 在萧塘镇街道2',
    ],
  ];
  const template = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    referenceImages: ASSETS.map((a) => a.url!),
    referenceImageLabels: ['萧逍', '鸱吻', '夏茉', '萧塘镇街道2'],
    seedanceTabConfigs: {
      reference: {
        referenceImages: ASSETS.map((a) => a.url!),
        referenceImageLabels: ['萧逍', '鸱吻', '夏茉', '萧塘镇街道2'],
        prompt: '模板',
      },
    },
  });
  const parsed = parseStoryboardSpawnRows(tableRows, template);
  ok('分镜表解析成功', !('error' in parsed) && parsed.length === 1);
  if ('error' in parsed) throw new Error(parsed.error);
  const rowPrompt = parsed[0].prompt;
  ok('分镜 prompt 含关联剧本', rowPrompt.includes('关联剧本：08场·颁奖台'));
  ok('分镜 prompt 含画面描述', rowPrompt.includes('画面描述：'));
  ok('分镜 prompt 含无空格 @资产', rowPrompt.includes('@资产:萧逍'));

  const spawned = enrichSpawnedStoryboardNodeData(
    { ...template, prompt: rowPrompt, seedanceTabConfigs: { reference: { ...template.seedanceTabConfigs!.reference!, prompt: rowPrompt } } },
    PROJ,
    slugMap,
    ASSETS
  );
  ok('下游 prompt 保留', (spawned.seedanceTabConfigs?.reference?.prompt || spawned.prompt || '').includes('@资产:萧逍'));
  ok('下游底栏仍为资产名', spawned.referenceImageLabels?.[0] === '萧逍');

  const ctx = buildPromptMediaRefContextForRun(spawned, ASSETS);
  const plan = collectReferencedMediaFromPrompt(
    spawned.seedanceTabConfigs?.reference?.prompt || spawned.prompt || '',
    spawned,
    ctx,
    slugMap,
    ASSETS
  );
  ok('分镜下游 plan 含萧逍鸱吻', plan.images.some((e) => e.label === '萧逍') && plan.images.some((e) => e.label === '鸱吻'));

  const scannedRow = scanPromptAppendAllTokens('萧塘镇街道2全景', [
    { label: '萧塘镇街道2', insertText: '@资产:萧塘镇街道2' },
  ]);
  ok('分镜扫描无空格', scannedRow === '萧塘镇街道2@资产:萧塘镇街道2全景');
  const hl = simulateColoredSegments(scannedRow);
  ok('分镜扫描高亮 1 token', hl.length === 1 && hl[0].token === '@资产:萧塘镇街道2');
}

console.log('\n=== 3. buildPromptFromRow 多列拼接 ===\n');

{
  const p = buildPromptFromRow(
    ['id', '5', '剧本A', '全景', '萧逍@资产:萧逍 特写'],
    [
      { header: '关联剧本', idx: 2 },
      { header: '景别/视角/构图', idx: 3 },
      { header: '画面描述', idx: 4 },
    ]
  );
  ok('多列 prompt', p.includes('关联剧本：剧本A') && p.includes('画面描述：萧逍@资产:萧逍 特写'));
  ok('高亮可识别 @资产', simulateColoredSegments(p).some((s) => s.token === '@资产:萧逍'));
}

console.log('\n=== 汇总 ===\n');
console.log(`通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
console.log('交付级综合测试全部通过。');

/**
 * 复现 2026070802-可灵.json：可灵3.0 Omni 多图参考运行后
 * - 面板保留 4 槽（含未@ blob/资产库图）
 * - gp/Details 仅 @图片1+@图片4（API 3 张：首帧+图片1+图片4）
 * - mediaPatch 不得用 gp-only 覆盖 klingOmniMultiReferenceImages / referenceImageLabels
 * - gp.referenceImageLabels 与 API 顺序对齐（勿串成 图片3）
 *
 * npx tsx scripts/2026070802-kling-omni-panel-verify-test.ts [jsonPath]
 */
import fs from 'fs';
import type { NodeData } from '../types.ts';
import { resolveFixtureFile } from './fixturePath.ts';
import {
  buildPanelReferenceDisplayEntries,
  filterPanelReferenceDisplayEntriesExcludingMainPreview,
  dedupePanelReferenceDisplayEntries,
  isPanelRefDuplicateOfMainImageSlot,
} from '../utils/referenceImageSlotLabels.ts';
import { collectReferencedMediaFromPrompt, buildPromptMediaRefContextFromNode } from '../utils/promptMediaRefs.ts';
import {
  shouldShowPanelMainImageSlot,
  shouldDedupePanelRefsAgainstMainPreview,
  panelReferenceLabelImagePreview,
  buildOmniMultiGenerationParamsLabels,
  buildPanelImagePreviewPatchAfterRun,
  panelReferenceDisplaySlots,
} from '../utils/referencedMediaRun.ts';
import {
  buildOmniMultiTabDetailsReferencePreview,
  buildOmniPanelSourceForNodeDetails,
} from '../utils/nodeDetailsPreview.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  [OK] ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function omniMultiPanelDisplayCount(data: NodeData): number {
  const refs = data.klingOmniMultiReferenceImages || [];
  const mainForDedupe = panelReferenceLabelImagePreview(data) ?? data.imagePreview;
  const base = buildPanelReferenceDisplayEntries(refs, {
    imagePreview: mainForDedupe,
    dedupeAgainstMain: shouldDedupePanelRefsAgainstMainPreview(data),
    referenceImageLabels: data.referenceImageLabels,
  });
  let entries = dedupePanelReferenceDisplayEntries(base, data.referenceImageLabels);
  if (shouldShowPanelMainImageSlot(data)) {
    entries = filterPanelReferenceDisplayEntriesExcludingMainPreview(
      entries,
      mainForDedupe,
      data.imageName,
      data.referenceImageLabels,
      undefined,
      data
    );
  }
  return entries.length;
}

function simulateOmniMultiPanelAfterRun(input: {
  panelBefore: string[];
  labelsBefore: string[];
  prompt: string;
  gpRefs: string[];
  gpLabels: string[];
  previewPatch: Partial<NodeData>;
  skipMediaPatchPanelRefs: boolean;
  skipMediaPatchOmniRefs: boolean;
  omniMultiMergedRefs: string[] | null;
  omniMultiMergedLabels: string[] | null;
}): NodeData {
  const dataIn = {
    label: 'n',
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'multi' as const,
    klingOmniMultiReferenceImages: [...input.panelBefore],
    referenceImageLabels: [...input.labelsBefore],
    klingOmniMultiPrompt: input.prompt,
    prompt: input.prompt,
    panelMainSlotVisible: false,
    status: 'completed',
  } as NodeData;

  const mergedRefs = input.omniMultiMergedRefs ?? [...input.panelBefore];
  const mergedPanelLabels = input.omniMultiMergedLabels ?? [...input.labelsBefore];

  let liveOmniRefs = [...mergedRefs];
  let liveLabels = [...mergedPanelLabels];
  if (!input.skipMediaPatchOmniRefs) {
    // 修复前：mediaPatch 可能用 gp-only 2~3 张覆盖 4 槽
    liveOmniRefs = input.gpRefs.length >= mergedRefs.length ? [...mergedRefs] : [...input.gpRefs];
  }
  if (!input.skipMediaPatchPanelRefs) {
    liveLabels = input.gpLabels.length < mergedPanelLabels.length ? [...input.gpLabels] : [...mergedPanelLabels];
  }

  const panelRefsFromRun = input.omniMultiMergedRefs?.length
    ? [...input.omniMultiMergedRefs]
    : liveOmniRefs;
  const panelLabelsFromRun = input.omniMultiMergedLabels?.some((l) => l.trim())
    ? [...input.omniMultiMergedLabels]
    : liveLabels;

  return {
    ...dataIn,
    ...input.previewPatch,
    klingOmniMultiReferenceImages: panelRefsFromRun,
    referenceImageLabels: panelLabelsFromRun,
    generationParams: {
      referenceImages: input.gpRefs,
      referenceImageLabels: input.gpLabels,
      prompt: input.prompt,
      model: '可灵3.0 Omni',
      klingOmniTab: 'multi',
    },
  };
}

function simulateInstructionVideoTabAfterRun(input: {
  tab: 'instruction' | 'video';
  panelBefore: string[];
  labelsBefore: string[];
  apiOnlyRefs: string[];
  panelMergedRefs: string[] | null;
  panelMergedLabels: string[] | null;
  useApiFallback: boolean;
}): NodeData {
  const key =
    input.tab === 'instruction'
      ? 'klingOmniInstructionReferenceImages'
      : 'klingOmniVideoReferenceImages';
  const panelRefs = input.useApiFallback
    ? [...input.apiOnlyRefs]
    : input.panelMergedRefs?.length
      ? [...input.panelMergedRefs]
      : [...input.panelBefore];
  const labels = input.panelMergedLabels?.some((l) => l.trim())
    ? [...input.panelMergedLabels]
    : [...input.labelsBefore];
  return {
    label: 'n',
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: input.tab,
    [key]: panelRefs,
    referenceImageLabels: labels,
  } as NodeData;
}

const jsonPath =
  process.argv[2] || resolveFixtureFile('2026070802-可灵.json', 'd:/json/2026070802-可灵.json');
const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const exported = raw.nodes[0].data as NodeData;
const gp = exported.generationParams!;

const URL1 =
  'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/c99fa3f0-fe6a-4993-9b63-31ef1fb526fb.png';
const BLOB2 = 'blob:http://localhost:3001/bac8d71e-1c3b-415b-a35c-061e45f0e111';
const ASSET3 = '/flowgen-api/projects/14/assets/90bdcd95-b552-42ab-9562-255b8557d92d/file';
const URL4 =
  'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/20e0605b-709d-497a-9428-c509f559214d.png';
const FIRST =
  'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/4357a077-d0c8-42c2-b4c4-6b00a8085603.png';

const panelBefore = [URL1, BLOB2, ASSET3, URL4];
const labelsBefore = ['图片1', '图片2', '大牙-有牙', '图片4'];
const prompt = '@图片1运行完成后来到@图片4的场景欣赏@图片4的女孩弹琴';
const gpRefs = [FIRST, URL1, URL4];
const brokenGpLabels = ['图片1', '图片4', '图片3'];
const previewPatch = {
  imagePreview: URL1,
  panelMainSlotVisible: false as const,
  firstFrameImageUrl: FIRST,
  firstFrameImage: FIRST,
};

console.log('\n=== 导出 JSON 当前态（multi 面板 4 槽）===\n');
ok(
  '导出 klingOmniMultiReferenceImages=4',
  (exported.klingOmniMultiReferenceImages || []).filter(Boolean).length === 4
);
ok('导出 labels 与 refs 等长', (exported.referenceImageLabels || []).length === 4);
ok('导出 UI 显示 4 槽', omniMultiPanelDisplayCount(exported) === 4);

const detailsBroken = buildOmniMultiTabDetailsReferencePreview({
  panelSource: {
    ...exported,
    klingOmniMultiReferenceImages: [],
  },
  urlPool: gpRefs,
  snapshotRefs: gpRefs,
  snapshotLabels: brokenGpLabels,
  prompt,
  movUrlSet: new Set(),
});
ok(
  '错误 gp 标签时 Details 出现错位图片3',
  detailsBroken.referenceImageDetailItems.some((i) => i.label === '图片3')
);

console.log('\n=== buildOmniMultiGenerationParamsLabels（API 顺序）===\n');
const uploadedByToken = new Map<string, string>([
  ['@图片1', URL1],
  ['@图片4', URL4],
]);
const planImages = [
  { token: '@图片1', url: URL1, label: '图片1' },
  { token: '@图片4', url: URL4, label: '图片4' },
];
const fixedGpLabels = buildOmniMultiGenerationParamsLabels(
  gpRefs,
  planImages as any,
  uploadedByToken,
  FIRST
);
ok('gp 标签数量=3', fixedGpLabels.length === 3);
ok('gp 标签末位=图片4', fixedGpLabels[2] === '图片4');
ok('gp 标签不含错位图片3', !fixedGpLabels.includes('图片3'));

const detailsFixed = buildOmniMultiTabDetailsReferencePreview({
  panelSource: {
    ...exported,
    klingOmniMultiReferenceImages: [],
  },
  urlPool: gpRefs,
  snapshotRefs: gpRefs,
  snapshotLabels: fixedGpLabels,
  prompt,
  movUrlSet: new Set(),
});
ok(
  '修复后 Details 快照标签对齐 @图片1+@图片4',
  detailsFixed.referenceImageDetailItems.filter((i) => i.label === '图片1' || i.label === '图片4').length >= 2 &&
    !detailsFixed.referenceImageDetailItems.some((i) => i.label === '图片3')
);

console.log('\n=== 修复前：mediaPatch clobber → 面板少图/标签串位 ===\n');
const broken = simulateOmniMultiPanelAfterRun({
  panelBefore,
  labelsBefore,
  prompt,
  gpRefs,
  gpLabels: brokenGpLabels,
  previewPatch,
  skipMediaPatchPanelRefs: false,
  skipMediaPatchOmniRefs: false,
  omniMultiMergedRefs: null,
  omniMultiMergedLabels: null,
});
ok(
  '修复前 omni refs 被 clobber 为 3',
  (broken.klingOmniMultiReferenceImages || []).length === 3
);
ok('修复前 UI 仅显示 3 槽', omniMultiPanelDisplayCount(broken) === 3);

console.log('\n=== 修复后：skip mediaPatch + omniMultiMerged* ===\n');
const fixed = simulateOmniMultiPanelAfterRun({
  panelBefore,
  labelsBefore,
  prompt,
  gpRefs,
  gpLabels: fixedGpLabels,
  previewPatch,
  skipMediaPatchPanelRefs: true,
  skipMediaPatchOmniRefs: true,
  omniMultiMergedRefs: panelBefore,
  omniMultiMergedLabels: labelsBefore,
});
ok('修复后 omni refs=4', (fixed.klingOmniMultiReferenceImages || []).length === 4);
ok(
  '修复后 labels 与 refs 等长',
  (fixed.referenceImageLabels || []).length === (fixed.klingOmniMultiReferenceImages || []).length
);
ok('修复后 UI 显示 4 槽', omniMultiPanelDisplayCount(fixed) === 4);

console.log('\n=== 指令变换/视频参考：禁止 API-only 回退 clobber 面板 ===\n');
const tabPanel = ['blob:http://localhost/a', 'blob:http://localhost/b', 'blob:http://localhost/c'];
const tabLabels = ['图片1', '图片2', '图片3'];
const apiOnly = ['https://cos.example/uploaded1.png'];
for (const tab of ['instruction', 'video'] as const) {
  const badTab = simulateInstructionVideoTabAfterRun({
    tab,
    panelBefore: tabPanel,
    labelsBefore: tabLabels,
    apiOnlyRefs: apiOnly,
    panelMergedRefs: tabPanel,
    panelMergedLabels: tabLabels,
    useApiFallback: true,
  });
  const goodTab = simulateInstructionVideoTabAfterRun({
    tab,
    panelBefore: tabPanel,
    labelsBefore: tabLabels,
    apiOnlyRefs: apiOnly,
    panelMergedRefs: tabPanel,
    panelMergedLabels: tabLabels,
    useApiFallback: false,
  });
  const key =
    tab === 'instruction'
      ? 'klingOmniInstructionReferenceImages'
      : 'klingOmniVideoReferenceImages';
  ok(
    `${tab} 修复前 API-only 回退仅 1 槽`,
    ((badTab as any)[key] || []).length === 1
  );
  ok(
    `${tab} 修复后面板保留 3 槽`,
    ((goodTab as any)[key] || []).length === 3
  );
}

console.log('\n=== 首尾帧 tab：面板字段独立（frames 不走 multi refs）===\n');
ok(
  '导出 klingOmniTab=multi 时 firstFrame 已写入',
  Boolean(exported.firstFrameImageUrl || exported.firstFrameImage)
);
ok(
  'frames 专用 prompt 字段存在且可区分',
  typeof exported.klingOmniFramesPrompt === 'string'
);

const json2Path = resolveFixtureFile('2026070802-可灵2.json', 'd:/json/2026070802-可灵2.json');
if (fs.existsSync(json2Path)) {
  console.log('\n=== 2026070802-可灵2.json：主图备份 + MOV Details 仅@ ===\n');
  const raw2 = JSON.parse(fs.readFileSync(json2Path, 'utf8'));
  const proc2 = raw2.nodes[0].data as NodeData;
  const mov2 = raw2.nodes[1].data as NodeData;
  const gp2 = proc2.generationParams!;
  const prompt2 = String(gp2.prompt || proc2.klingOmniMultiPrompt || '');

  const previewPatch2 = buildPanelImagePreviewPatchAfterRun(
    [
      { token: '@图片2', url: proc2.imagePreview!, label: '图片2' },
      { token: '@图片4', url: (proc2.klingOmniMultiReferenceImages || [])[3]!, label: '图片4' },
    ] as any,
    new Map<string, string>([
      ['@图片2', gp2.referenceImages![1] as string],
      ['@图片4', gp2.referenceImages![2] as string],
    ]),
    {
      nodeData: proc2,
      mergedPanelRefs: proc2.klingOmniMultiReferenceImages || [],
      mergedPanelLabels: proc2.referenceImageLabels,
    }
  );
  ok(
    '可灵2 运行后备份 panelMainImageUrl',
    Boolean(previewPatch2.panelMainImageUrl?.trim())
  );
  ok(
    '可灵2 运行后 shouldShowPanelMainImageSlot（有备份）',
    shouldShowPanelMainImageSlot({
      ...proc2,
      ...previewPatch2,
    })
  );

  const movPanelSource = buildOmniPanelSourceForNodeDetails({
    previewNodeData: mov2,
    generationParams: mov2.generationParams as any,
    ancestorData: proc2,
    isOutputLike: true,
    omniTab: 'multi',
    modelStr: '可灵3.0 Omni',
    resolvedPrompt: prompt2,
  });
  const movDetails = buildOmniMultiTabDetailsReferencePreview({
    panelSource: movPanelSource,
    urlPool: [
      ...(gp2.referenceImages as string[]),
      ...(proc2.klingOmniMultiReferenceImages || []),
      mov2.imagePreview!,
    ],
    snapshotRefs: gp2.referenceImages as string[],
    snapshotLabels: gp2.referenceImageLabels as string[],
    prompt: prompt2,
    movUrlSet: new Set([mov2.imagePreview!]),
  });
  ok(
    '可灵2 MOV Details 仅 @图片2+@图片4',
    movDetails.referenceImageDetailItems.map((i) => i.label).join('+') === '图片2+图片4'
  );
  ok('可灵2 MOV Details 不含未@ 图片1/大牙', !movDetails.referenceImageDetailItems.some((i) => i.label === '图片1' || i.label === '大牙-有牙'));
}

const json3Path = resolveFixtureFile('2026070802-可灵3.json', 'd:/json/2026070802-可灵3.json');
if (fs.existsSync(json3Path)) {
  console.log('\n=== 2026070802-可灵3.json：@图片2/3/4 槽位解析 + 面板 5 槽 ===\n');
  const raw3 = JSON.parse(fs.readFileSync(json3Path, 'utf8'));
  const proc3 = raw3.nodes[0].data as NodeData;
  const prompt3 = proc3.klingOmniMultiPrompt || proc3.prompt || '';
  const plan3 = collectReferencedMediaFromPrompt(
    prompt3,
    proc3,
    buildPromptMediaRefContextFromNode(proc3),
    new Map(),
    []
  );
  ok(
    'plan 含 @图片2+@图片4+@图片3',
    plan3.images.map((e) => e.token).join('+') === '@图片2+@图片4+@图片3'
  );
  ok(
    'plan @图片2→槽1',
    plan3.images.find((e) => e.token === '@图片2')?.refImageSlotIndex === 1
  );
  ok(
    'plan @图片3→槽2',
    plan3.images.find((e) => e.token === '@图片3')?.refImageSlotIndex === 2
  );
  ok(
    'plan @图片4→槽3',
    plan3.images.find((e) => e.token === '@图片4')?.refImageSlotIndex === 3
  );
  ok('持久化 klingOmniMultiReferenceImages=5', (proc3.klingOmniMultiReferenceImages || []).length === 5);
  const slots3 = panelReferenceDisplaySlots(proc3.klingOmniMultiReferenceImages);
  ok('面板 UI 显示 5 槽', slots3.length === 5);
  const afterRunDisplay = {
    ...proc3,
    panelMainSlotVisible: false as const,
    panelMainImageUrl: proc3.panelMainImageUrl,
  };
  ok(
    '运行后 @图片2 槽不因 imagePreview 重复被隐藏',
    !slots3.some(({ url, slotIndex }) => slotIndex === 1 && isPanelRefDuplicateOfMainImageSlot(url, afterRunDisplay, []))
  );
}

console.log(`\n=== 最终汇总：${pass} 通过, ${fail} 失败 ===\n`);
if (fail > 0) process.exit(1);

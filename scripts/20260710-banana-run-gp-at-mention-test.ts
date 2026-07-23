/**
 * banana-源 / banana-问题：无 @ 创意描述运行后
 * - §5.9.1 #1 面板 referenceImages 全保留
 * - §5.9.1 #2 generationParams.referenceImages 不得写入面板全量（仅 @ 到的 API 快照）
 * - §5.9.1 #3 无 @ 时缩略图仍为主图
 *
 * npx tsx scripts/20260710-banana-run-gp-at-mention-test.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Node as RFNode } from 'reactflow';
import { NodeType } from '../types.ts';
import { resolveFixtureFile } from './fixturePath.ts';
import {
  mergeRecoveryGenerationParamsFromRunNode,
  buildRecoveryGraphUpdates,
} from '../utils/runRecovery.ts';
import {
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
  buildCanonicalInspectorPromptPatch,
  getCanonicalInspectorPromptText,
  getNodeInspectorPromptText,
} from '../utils/promptMediaRefs.ts';
import {
  buildPanelImagePreviewPatchAfterRun,
  mergeAndPrunePanelReferenceImagesAfterUpload,
  panelMergeOptionsForReferencedUpload,
  pickStillImageRecoveryApiReferenceImages,
  resolveCanvasNodePreviewUrl,
} from '../utils/referencedMediaRun.ts';
import { buildStillImageGenNodeDetailsReferencePreview } from '../utils/nodeDetailsPreview.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

/** 模拟 FlowEditor Nano 运行收尾：无 snapshot 时 gp 不得落面板全量 */
function resolveNanoGpReferenceImages(params: {
  nanoRunReferenceSnapshot: string[] | null;
  mergedRefImages: string[];
  mainPreview?: string;
}): string[] | undefined {
  const { nanoRunReferenceSnapshot, mergedRefImages } = params;
  if (nanoRunReferenceSnapshot?.length) {
    const seen = new Set<string>();
    return nanoRunReferenceSnapshot.filter((u) => {
      const s = String(u || '').trim();
      if (!s || seen.has(s)) return false;
      seen.add(s);
      return true;
    });
  }
  // 旧 bug：strip 主图后把 mergedRefImages 全写入 gp
  void mergedRefImages;
  return undefined;
}

const MAIN =
  '/flowgen-api/projects/14/assets/62803dee-e53e-4f51-b0c7-b297829bea54/file';
const PANEL_REFS = Array.from({ length: 9 }, (_, i) =>
  i < 2
    ? `/flowgen-api/projects/14/assets/ref-${i}/file`
    : `data:image/jpeg;base64,/${i}`
);

console.log('\n=== §1 无 @ 运行：gp 不得含面板 9 张 ===\n');
const gpRefs = resolveNanoGpReferenceImages({
  nanoRunReferenceSnapshot: null,
  mergedRefImages: PANEL_REFS,
  mainPreview: MAIN,
});
ok('无 @ snapshot 时 gp.referenceImages=undefined', gpRefs === undefined);
ok('面板 9 槽仍保留（数据层）', PANEL_REFS.filter(Boolean).length === 9);

console.log('\n=== §2 仅 @图片3：gp 仅 1 张 + 画布=参考 ===\n');
const PIC3 = 'https://cos.example/pic3.png';
const withMention: RFNode = {
  id: 'nano',
  type: NodeType.PROCESSOR,
  position: { x: 0, y: 0 },
  data: {
    selectedModel: 'Nano Banana 2.0',
    prompt: '@图片3参考生成',
    imagePreview: MAIN,
    panelMainImageUrl: MAIN,
    referenceImages: [
      PANEL_REFS[0],
      PANEL_REFS[1],
      PIC3,
      '',
      '',
      '',
      '',
      '',
      '',
    ],
    referenceImageLabels: ['光头强', '祭司老人', '图片3', '图片4', '图片5', '图片6', '图片7', '图片8', '图片9'],
    taskId: 't1',
    generationParams: { taskId: 't1', model: 'Nano Banana 2.0' },
  },
};
const picked = pickStillImageRecoveryApiReferenceImages(withMention.data);
ok('pick @图片3 → 1 张', picked?.referenceImages?.length === 1);
ok('pick[0]=PIC3', picked?.referenceImages?.[0] === PIC3);

const previewPatch = buildPanelImagePreviewPatchAfterRun(
  [{ token: '@图片3', url: PIC3, refImageSlotIndex: 2, imageIndex: 3, label: '图片3' } as never],
  new Map([['@图片3', PIC3]]),
  {
    nodeData: withMention.data,
    mergedPanelRefs: withMention.data.referenceImages as string[],
    mergedPanelLabels: withMention.data.referenceImageLabels as string[],
  }
);
ok('preview patch imagePreview=PIC3', previewPatch.imagePreview === PIC3);
ok('preview patch panelMainSlotVisible=false', previewPatch.panelMainSlotVisible === false);
const canvasAfter = resolveCanvasNodePreviewUrl({
  ...withMention.data,
  ...previewPatch,
});
ok('画布 resolve=PIC3', canvasAfter === PIC3);

console.log('\n=== §3 recovery merge：勿继承坏 gp 全量 ===\n');
const polluted: RFNode = {
  ...withMention,
  data: {
    ...withMention.data,
    prompt: '',
    generationParams: {
      referenceImages: [...PANEL_REFS],
      taskId: 't-bad',
      model: 'Nano Banana 2.0',
    },
  },
};
const merged = mergeRecoveryGenerationParamsFromRunNode(polluted, {
  taskId: 't-bad',
  model: 'Nano Banana 2.0',
  outputUrl: 'https://cos.example/out.png',
});
ok('空 prompt recovery gp 无 referenceImages', !merged.referenceImages?.length);

console.log('\n=== §4 buildRecoveryGraphUpdates：OUTPUT 继承 Nano ===\n');
const { nodes: afterRec } = buildRecoveryGraphUpdates({
  nodes: [withMention],
  edges: [],
  runNodeId: withMention.id,
  mediaUrls: ['https://cos.example/out.png'],
  taskIdJoined: 't1',
  createNodeId: () => 'out-1',
});
const recRun = afterRec.find((n) => n.id === withMention.id)!;
const recOut = afterRec.find((n) => n.type === NodeType.OUTPUT)!;
ok('recovery run panelMainSlotVisible=false', recRun.data.panelMainSlotVisible === false);
ok('recovery OUTPUT=Nano', recOut?.data.selectedModel === 'Nano Banana 2.0');

console.log('\n=== §5 用户 JSON banana-问题 坏态指纹 ===\n');
try {
  const userBad = JSON.parse(fs.readFileSync(resolveFixtureFile('banana-问题.json', 'd:/json/banana-问题.json'), 'utf8'));
  const proc = userBad.nodes.find((n: RFNode) => n.type === 'processorNode');
  if (proc) {
    ok('banana-问题 gp 误写 9 张（坏态）', (proc.data.generationParams?.referenceImages?.length || 0) === 9);
    ok('banana-问题 面板仍 9 槽', (proc.data.referenceImages || []).filter(Boolean).length === 9);
    const fixedGp = resolveNanoGpReferenceImages({
      nanoRunReferenceSnapshot: null,
      mergedRefImages: proc.data.referenceImages || [],
      mainPreview: proc.data.imagePreview,
    });
    ok('修复逻辑下 gp=undefined', fixedGp === undefined);
  }
} catch {
  console.log('  [skip] d:/json/banana-问题.json 未找到');
}

console.log('\n=== §6 banana-源 + @图片4/@图片7：上传后槽位不串图 ===\n');
const PIC3_B64 = 'data:image/jpeg;base64,/9j/PIC3_UNIQUE_SLOT2';
const PIC4_B64 = 'data:image/jpeg;base64,/9j/PIC4_UNIQUE_SLOT3';
const srcLike = {
  selectedModel: 'Nano Banana 2.0',
  prompt: '@图片4参考@图片7风格生成',
  imagePreview: MAIN,
  referenceImages: [
    '/flowgen-api/projects/14/assets/guang/file',
    '/flowgen-api/projects/14/assets/jisi/file',
    PIC3_B64,
    PIC4_B64,
    'data:image/jpeg;base64,/9j/pic5',
    'data:image/jpeg;base64,/9j/pic6',
    'data:image/jpeg;base64,/9j/pic7',
    'data:image/jpeg;base64,/9j/pic8',
    'data:image/jpeg;base64,/9j/pic9',
  ],
  referenceImageLabels: ['光头强', '祭司老人', '图片3', '图片4', '图片5', '图片6', '图片7', '图片8', '图片9'],
};
const ctxSrc = buildPromptMediaRefContextFromNode(srcLike);
const planSrc = collectReferencedMediaFromPrompt(srcLike.prompt, srcLike, ctxSrc, new Map());
const upSrc = new Map<string, string>();
for (const e of planSrc.images) {
  upSrc.set(e.token, `https://cos.example/up-from-slot-${e.refImageSlotIndex}.png`);
}
const mergedSrc = mergeAndPrunePanelReferenceImagesAfterUpload(
  srcLike.referenceImages,
  planSrc.images,
  upSrc,
  panelMergeOptionsForReferencedUpload(
    planSrc.images,
    upSrc,
    srcLike.imagePreview,
    undefined,
    srcLike.referenceImageLabels
  )
);
ok('slot2 仍保留 PIC3 b64', String(mergedSrc[2]).includes('PIC3_UNIQUE'));
ok('slot3 写回 PIC4 上传 COS', String(mergedSrc[3]).includes('up-from-slot-3'));
ok('slot2≠slot3', mergedSrc[2] !== mergedSrc[3]);
ok('9 槽标签保留', mergedSrc.filter(Boolean).length === 9);

console.log('\n=== §7 @图片4+@图片7：gp 空时 Details 仅 2 张（banana-问题2）===\n');
const problem2Like = {
  selectedModel: 'Nano Banana 2.0',
  prompt: '@图片4参考@图片7的风格生成',
  imagePreview: 'https://cos.example/c3e5-e985-457a-9405-6f80f9998176.png',
  panelMainImageUrl: '/flowgen-api/projects/14/assets/f2e869b4/file',
  panelMainSlotVisible: false,
  referenceImages: [
    '/flowgen-api/a0/file',
    '/flowgen-api/a1/file',
    'data:image/jpeg;base64,pic3',
    'https://cos.example/c3e5-e985-457a-9405-6f80f9998176.png',
    'data:image/jpeg;base64,pic5',
    'data:image/jpeg;base64,pic6',
    'https://cos.example/a6a5-7639-421d-bd00-7a7f93700d76.png',
    'data:image/jpeg;base64,pic8',
  ],
  referenceImageLabels: ['萧塘镇街道', '大牙', '图片3', '图片4', '图片5', '图片6', '图片7', '图片8'],
  generationParams: { model: 'Nano Banana 2.0' },
};
const recoveredDetails = buildStillImageGenNodeDetailsReferencePreview({
  panelSource: problem2Like,
  snapRefs: [],
  prompt: problem2Like.prompt,
});
ok('gp 空时 Details=2 张', recoveredDetails?.referenceImages?.length === 2);
ok(
  'Details 标签=图片4+图片7',
  recoveredDetails?.referenceImageDetailItems?.map((i) => i.label).join(',') === '图片4,图片7'
);
ok('面板 8 槽数据层保留', problem2Like.referenceImages.filter(Boolean).length === 8);

console.log('\n=== §8 二次运行：创意描述 @ 引用不 rewrite 到节点 ===\n');
const MIXED_PROMPT = '@资产:光头强参考@图片3风格生成';
const GUANG_ASSET = '/flowgen-api/projects/14/assets/eec77159-9e6c-4b01-afd7-55780135e010/file';
const PIC3_COS = 'https://cos.example/906e4ec3-f1be-4a83-a24f-33e9807772f7.png';
const projectAssetsRerun = [
  { slug: 'guangtouqiang', name: '光头强', url: GUANG_ASSET },
  { slug: 'street', name: '萧塘镇街道', url: '/flowgen-api/projects/14/assets/street/file' },
];
const postRunForRerun = {
  selectedModel: 'Nano Banana 2.0',
  prompt: MIXED_PROMPT,
  imagePreview: PIC3_COS,
  panelMainImageUrl: GUANG_ASSET,
  panelMainSlotVisible: false,
  referenceImages: [
    '/flowgen-api/projects/14/assets/jisi/file',
    'data:image/jpeg;base64,pic2',
    '/flowgen-api/projects/14/assets/street/file',
    'data:image/jpeg;base64,pic4',
  ],
  referenceImageLabels: ['祭司老人', '图片2', '图片3', '图片4'],
  taskId: 't-rerun',
  generationParams: { taskId: 't-rerun', model: 'Nano Banana 2.0' },
};
/** 运行前：canonical 可存在，但 FlowEditor 不再 updateNodeDataById(promptCanonPatch) */
const rerunPatch = buildCanonicalInspectorPromptPatch(postRunForRerun, projectAssetsRerun);
const inspectorPromptAfterRunStart = getNodeInspectorPromptText(postRunForRerun);
ok('二次运行 inspector prompt 保持用户原文', inspectorPromptAfterRunStart === MIXED_PROMPT);
ok(
  'canonical patch 仅用于 run 快照、不写回节点',
  rerunPatch != null && rerunPatch.prompt !== MIXED_PROMPT && inspectorPromptAfterRunStart === MIXED_PROMPT
);
const runSnapshot = { ...postRunForRerun, ...rerunPatch };
ok(
  'run 快照 plan 能解析混排引用',
  collectReferencedMediaFromPrompt(
    getCanonicalInspectorPromptText(runSnapshot as never, projectAssetsRerun),
    runSnapshot as never,
    buildPromptMediaRefContextFromNode(runSnapshot as never),
    new Map(),
    projectAssetsRerun
  ).images.length >= 1
);

console.log('\n=== §9 全模型二次运行：Inspector 创意描述保持用户原文 ===\n');
const ALL_MIXED = '景别：@图片3全景/高角度\n画面：萧道@资产:萧道 与 @图片2';
const PROJ9 = 'rerun-all-models';
const xd = `/flowgen-api/projects/${PROJ9}/assets/xd/file`;
const xm = `/flowgen-api/projects/${PROJ9}/assets/xm/file`;
const st = `/flowgen-api/projects/${PROJ9}/assets/st/file`;
const assets9 = [
  { slug: '萧道', name: '萧道', url: xd },
  { slug: '夏茉', name: '夏茉', url: xm },
  { slug: '荒塘镇街道1', name: '荒塘镇街道1', url: st },
];
const base9 = {
  referenceImages: [xd, xm, st],
  referenceImageLabels: ['萧道', '夏茉', '荒塘镇街道1'],
  taskId: 't-rerun-all',
};
const allModels: Array<{ name: string; data: Record<string, unknown> }> = [
  { name: 'Nano', data: { selectedModel: 'Nano Banana 2.0', prompt: ALL_MIXED, ...base9 } },
  { name: 'image2', data: { selectedModel: 'image 2', prompt: ALL_MIXED, ...base9 } },
  {
    name: 'Omni multi',
    data: {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      klingOmniMultiPrompt: ALL_MIXED,
      klingOmniMultiReferenceImages: [...base9.referenceImages],
      referenceImageLabels: [...base9.referenceImageLabels],
      taskId: 't-rerun-all',
    },
  },
  {
    name: 'Seedance 参考生',
    data: {
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      seedanceTabConfigs: { reference: { prompt: ALL_MIXED, ...base9 } },
      ...base9,
    },
  },
  {
    name: '即梦3.0 Pro',
    data: { selectedModel: '即梦3.0 Pro', prompt: ALL_MIXED, imagePreview: xd, ...base9 },
  },
  {
    name: 'vidu 2.0',
    data: { selectedModel: 'vidu 2.0', prompt: ALL_MIXED, firstFrameImageUrl: xd, ...base9 },
  },
];
for (const { name, data } of allModels) {
  const patch = buildCanonicalInspectorPromptPatch(data as never, assets9);
  ok(`${name}: inspector 保持用户原文`, getNodeInspectorPromptText(data as never) === ALL_MIXED);
  ok(
    `${name}: canonical 仅用于 run 快照`,
    patch != null && getNodeInspectorPromptText(data as never) === ALL_MIXED
  );
  ok(
    `${name}: run 快照 plan 可解析`,
    collectReferencedMediaFromPrompt(
      getCanonicalInspectorPromptText({ ...(data as object), ...(patch || {}) } as never, assets9),
      data as never,
      buildPromptMediaRefContextFromNode(data as never),
      new Map(),
      assets9
    ).images.length >= 1
  );
}

console.log(`\n=== 汇总: ${pass} 通过, ${fail} 失败 ===\n`);
process.exit(fail ? 1 : 0);

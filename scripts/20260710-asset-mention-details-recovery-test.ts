/**
 * banana-问题4 / banana-源：gp 空 + @资产:光头强 + @图片3
 * - slug map 未建时 projectAssets[].url 仍须解析 @资产（§5.9.1 #2 Details 仅 @）
 * - fixture：`scripts/fixtures/20260710-banana-source-9slot.json`（源自 d:/json/banana-源.json）
 * - fixture：`scripts/fixtures/20260710-banana-problem4-asset-pic3.json`（源自 d:/json/banana-问题4.json）
 * - 全模型：Nano / image2 / 可灵3.0 Omni multi / seedance2.0 参考生
 *
 * npx tsx scripts/20260710-asset-mention-details-recovery-test.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { NodeData } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2 } from '../types.ts';
import {
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
  getNodeInspectorPromptText,
  resolveProjectAssetUrlFromTokenKey,
  type ProjectAssetLabelRow,
} from '../utils/promptMediaRefs.ts';
import {
  mergeAndPrunePanelReferenceImagesAfterUpload,
  panelMergeOptionsForReferencedUpload,
  panelReferenceImagesForUpload,
  pickStillImageRecoveryApiReferenceImages,
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

const GUANG = '/flowgen-api/projects/14/assets/eec77159-9e6c-4b01-afd7-55780135e010/file';
const PIC3 = 'https://cos.example/906e4ec3-f1be-4a83-a24f-33e9807772f7.png';
const PROMPT = '@资产:光头强参考@图片3风格生成';

const PROJECT_ASSETS: ProjectAssetLabelRow[] = [
  { slug: 'guangtouqiang', name: '光头强', url: GUANG },
];

type ModelSpec = {
  id: string;
  stillImage?: boolean;
  apply: (data: NodeData) => NodeData;
};

function applyStandardModel(data: NodeData, selectedModel: string): NodeData {
  return { ...data, selectedModel };
}

function applyOmniMulti(data: NodeData): NodeData {
  const refs = data.referenceImages || [];
  const labels = data.referenceImageLabels || [];
  const prompt = data.prompt || PROMPT;
  return {
    ...data,
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'multi',
    prompt,
    klingOmniMultiPrompt: prompt,
    klingOmniMultiReferenceImages: refs,
    klingOmniMultiReferenceImageLabels: labels,
    referenceImages: refs,
    referenceImageLabels: labels,
  };
}

function applySeedanceRef(data: NodeData): NodeData {
  const prompt = data.prompt || PROMPT;
  return {
    ...data,
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    prompt,
    seedanceTabConfigs: {
      ...(data.seedanceTabConfigs || {}),
      reference: { ...(data.seedanceTabConfigs?.reference || {}), prompt },
    },
  };
}

const MODEL_SPECS: ModelSpec[] = [
  {
    id: 'Nano Banana 2.0',
    stillImage: true,
    apply: (d) => applyStandardModel(d, MODEL_NANO_BANANA_2),
  },
  {
    id: 'image 2',
    stillImage: true,
    apply: (d) => applyStandardModel(d, MODEL_IMAGE_2),
  },
  { id: '可灵3.0 Omni multi', apply: (d) => applyOmniMulti(d) },
  { id: 'seedance2.0 参考生', apply: (d) => applySeedanceRef(d) },
];

function baseNodeData(selectedModel: string): NodeData {
  return {
    selectedModel,
    prompt: PROMPT,
    imagePreview: PIC3,
    panelMainImageUrl: GUANG,
    panelMainSlotVisible: false,
    imageName: '光头强',
    referenceImages: [
      '/flowgen-api/projects/14/assets/jisi/file',
      'data:image/jpeg;base64,pic2',
      PIC3,
      'data:image/jpeg;base64,pic4',
    ],
    referenceImageLabels: ['祭司老人', '图片2', '图片3', '图片4'],
    generationParams: { model: selectedModel },
  } as NodeData;
}

function loadFixture(name: string): {
  data: NodeData;
  projectAssets: ProjectAssetLabelRow[];
} {
  const p = path.join(__dirname, 'fixtures', name);
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const node = raw.nodes.find(
    (n: { type?: string; data?: NodeData }) =>
      n.type === 'processorNode' || n.data?.selectedModel
  );
  if (!node?.data) throw new Error(`fixture ${name} missing processor node`);
  return {
    data: node.data as NodeData,
    projectAssets: (raw.projectAssets || []) as ProjectAssetLabelRow[],
  };
}

/** 将 banana-源 9 槽态 morph 为 banana-问题4 同类 prompt（@资产 + @图片3，gp 空） */
function applyProblem4StateFromBananaSource(data: NodeData): NodeData {
  const refs = [...(data.referenceImages || [])];
  const pic3 = refs[2] || PIC3;
  const guang = data.panelMainImageUrl || refs[0] || GUANG;
  return {
    ...data,
    selectedModel: data.selectedModel || MODEL_NANO_BANANA_2,
    prompt: PROMPT,
    imagePreview: pic3,
    panelMainImageUrl: guang,
    panelMainSlotVisible: false,
    imageName: '光头强',
    generationParams: { model: data.selectedModel || MODEL_NANO_BANANA_2 },
  };
}

function stripDataUrls(data: NodeData): NodeData {
  const refs = (data.referenceImages || []).map((u, i) => {
    const s = String(u || '').trim();
    if (s.startsWith('data:')) return `https://cos.example/user-slot-${i}.png`;
    return s;
  });
  return { ...data, referenceImages: refs };
}

function assertAllModelsFixtureScenario(
  prefix: string,
  baseData: NodeData,
  projectAssets: ProjectAssetLabelRow[],
  expectPanelFilled: number
) {
  const guangUrl = projectAssets.find((a) => a.name === '光头强')?.url || GUANG;
  const pic3Url = String(baseData.referenceImages?.[2] || baseData.imagePreview || PIC3).trim();

  for (const spec of MODEL_SPECS) {
    const data = spec.apply({ ...baseData });
    const ctx = buildPromptMediaRefContextFromNode(data);
    const promptText = getNodeInspectorPromptText(data) || PROMPT;

    const plan = collectReferencedMediaFromPrompt(
      promptText,
      data,
      ctx,
      new Map(),
      projectAssets
    );
    ok(
      `${prefix} ${spec.id} plan=2`,
      plan.images.length === 2,
      plan.images.map((e) => e.token).join(',')
    );
    ok(
      `${prefix} ${spec.id} plan tokens`,
      plan.images[0]?.token === '@资产:光头强' && plan.images[1]?.token === '@图片3'
    );

    const panelFilled = (panelReferenceImagesForUpload(data) || []).filter(Boolean).length;
    ok(
      `${prefix} ${spec.id} 面板槽保留`,
      panelFilled >= expectPanelFilled,
      `filled=${panelFilled}`
    );

    if (spec.stillImage) {
      const picked = pickStillImageRecoveryApiReferenceImages(data, projectAssets);
      ok(`${prefix} ${spec.id} pick=2`, picked?.referenceImages?.length === 2);
      ok(
        `${prefix} ${spec.id} pick labels`,
        picked?.referenceImageLabels?.join(',') === '光头强,图片3'
      );
      ok(`${prefix} ${spec.id} pick 含资产`, picked?.referenceImages?.includes(guangUrl));
      ok(`${prefix} ${spec.id} pick 含图片3`, picked?.referenceImages?.includes(pic3Url));

      const details = buildStillImageGenNodeDetailsReferencePreview({
        panelSource: data,
        snapRefs: [],
        prompt: promptText,
        projectAssets,
      });
      ok(`${prefix} ${spec.id} Details=2`, details?.referenceImageDetailItems?.length === 2);
      ok(
        `${prefix} ${spec.id} Details labels`,
        details?.referenceImageDetailItems?.map((i) => i.label).join(',') === '光头强,图片3'
      );
    }

    const slugMap = new Map(
      projectAssets.filter((a) => a.slug && a.url).map((a) => [a.slug!.trim(), a.url!.trim()])
    );
    const planRun = collectReferencedMediaFromPrompt(
      promptText,
      data,
      ctx,
      slugMap,
      projectAssets
    );
    const uploaded = new Map<string, string>();
    for (const e of planRun.images) {
      uploaded.set(e.token, `https://cos.example/up-${encodeURIComponent(e.label)}.png`);
    }
    const panelBefore = panelReferenceImagesForUpload(data) || [];
    const panelAfter = mergeAndPrunePanelReferenceImagesAfterUpload(
      panelBefore,
      planRun.images,
      uploaded,
      panelMergeOptionsForReferencedUpload(
        planRun.images,
        uploaded,
        data.imagePreview,
        slugMap,
        data.referenceImageLabels
      )
    );
    ok(
      `${prefix} ${spec.id} 模拟运行后面板不减`,
      panelAfter.filter(Boolean).length >= expectPanelFilled,
      `after=${panelAfter.filter(Boolean).length}`
    );
    ok(`${prefix} ${spec.id} 模拟 plan 上传=2`, planRun.images.length === 2);
  }
}

function tryUserJsonScenario(label: string, filePath: string) {
  if (!fs.existsSync(filePath)) {
    console.log(`  [skip] ${label} 未找到 ${filePath}`);
    return;
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let data = raw.nodes?.find(
    (n: { data?: NodeData }) => n.data?.selectedModel?.includes('Banana')
  )?.data as NodeData | undefined;
  if (!data) {
    data = raw.nodes?.[0]?.data as NodeData;
  }
  if (!data) {
    ok(`${label} 可读节点`, false);
    return;
  }
  data = stripDataUrls(data);
  const projectAssets: ProjectAssetLabelRow[] = raw.projectAssets?.length
    ? raw.projectAssets
    : data.panelMainImageUrl
      ? [{ slug: 'guangtouqiang', name: '光头强', url: data.panelMainImageUrl }]
      : PROJECT_ASSETS;
  if (!data.prompt?.includes('@资产') && !data.prompt?.includes('@图片3')) {
    data = applyProblem4StateFromBananaSource(data);
  }
  if (!data.generationParams) {
    data.generationParams = { model: data.selectedModel };
  } else {
    data.generationParams = { ...data.generationParams };
    delete (data.generationParams as { referenceImages?: string[] }).referenceImages;
  }
  const filled = (data.referenceImages || []).filter(Boolean).length;
  assertAllModelsFixtureScenario(label, data, projectAssets, filled);
}

console.log('\n=== §1 resolveProjectAssetUrlFromTokenKey：无 slug map 回退 row.url ===\n');
ok(
  '空 map + projectAssets.url → GUANG',
  resolveProjectAssetUrlFromTokenKey('光头强', new Map(), PROJECT_ASSETS) === GUANG
);
ok(
  'slug map 优先于 row.url',
  resolveProjectAssetUrlFromTokenKey(
    '光头强',
    new Map([['guangtouqiang', 'https://cos.example/from-map.png']]),
    PROJECT_ASSETS
  ) === 'https://cos.example/from-map.png'
);
ok(
  '无 projectAssets → undefined',
  resolveProjectAssetUrlFromTokenKey('光头强', new Map()) === undefined
);

console.log('\n=== §2 内联 mock：全模型 plan（空 slug map）===\n');
for (const spec of MODEL_SPECS) {
  const data = spec.apply(baseNodeData(MODEL_NANO_BANANA_2));
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(
    getNodeInspectorPromptText(data) || PROMPT,
    data,
    ctx,
    new Map(),
    PROJECT_ASSETS
  );
  ok(`${spec.id} plan=2`, plan.images.length === 2);
}

console.log('\n=== §3 内联 mock：Nano/image2 gp 空 Details recovery ===\n');
for (const spec of MODEL_SPECS.filter((s) => s.stillImage)) {
  const data = spec.apply(baseNodeData(MODEL_NANO_BANANA_2));
  const picked = pickStillImageRecoveryApiReferenceImages(data, PROJECT_ASSETS);
  ok(`${spec.id} pick=2`, picked?.referenceImages?.length === 2);
  const details = buildStillImageGenNodeDetailsReferencePreview({
    panelSource: data,
    snapRefs: [],
    prompt: PROMPT,
    projectAssets: PROJECT_ASSETS,
  });
  ok(`${spec.id} Details=2`, details?.referenceImageDetailItems?.length === 2);
}

console.log('\n=== §4 无 projectAssets 边界（导出 JSON）===\n');
const nanoOnly = baseNodeData(MODEL_NANO_BANANA_2);
const planNoPa = collectReferencedMediaFromPrompt(
  PROMPT,
  nanoOnly,
  buildPromptMediaRefContextFromNode(nanoOnly),
  new Map()
);
ok('无 pa plan=1', planNoPa.images.length === 1 && planNoPa.images[0]?.token === '@图片3');

console.log('\n=== §5 fixture banana-源 9 槽 → @资产+@图片3 × 全模型 ===\n');
{
  const { data, projectAssets } = loadFixture('20260710-banana-source-9slot.json');
  const problemLike = applyProblem4StateFromBananaSource(data);
  const filled = (problemLike.referenceImages || []).filter(Boolean).length;
  ok('banana-源 fixture 9 槽', filled === 9);
  assertAllModelsFixtureScenario('banana-源→p4', problemLike, projectAssets, 9);
}

console.log('\n=== §6 fixture banana-问题4 × 全模型 ===\n');
{
  const { data, projectAssets } = loadFixture('20260710-banana-problem4-asset-pic3.json');
  ok('banana-问题4 prompt', data.prompt === PROMPT);
  ok('banana-问题4 gp 空', !data.generationParams?.referenceImages?.length);
  const filled = (data.referenceImages || []).filter(Boolean).length;
  ok('banana-问题4 面板 4 槽', filled === 4);
  assertAllModelsFixtureScenario('banana-问题4', data, projectAssets, 4);
}

console.log('\n=== §7 用户 JSON（若存在）× 全模型 ===\n');
tryUserJsonScenario('d:/json/banana-源.json', 'd:/json/banana-源.json');
tryUserJsonScenario('d:/json/banana-问题4.json', 'd:/json/banana-问题4.json');

console.log(`\n=== 汇总: ${pass} 通过, ${fail} 失败 ===\n`);
process.exit(fail ? 1 : 0);

/**
 * 主图来自资产库 × 多种拖入/@ 方式 × 全多图参考模型
 * 对齐 d:/json/banana-正常2.json + banana-主图是资产库中图片.json
 *
 * 关键例：主图=/flowgen-api/.../assets/.../file，仅 @图片n 运行后：
 * - 面板槽数不减、@槽不被按 imagePreview 去重清掉
 * - preserve 不得清 panelMainSlotVisible=false
 * - 展示层 主图格=资产库备份，参考槽全在
 *
 * npx tsx scripts/20260710-asset-main-all-models-test.ts
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
  resolvePromptMainImagePreviewForRefs,
  type ProjectAssetLabelRow,
} from '../utils/promptMediaRefs.ts';
import {
  buildPanelImagePreviewPatchAfterRun,
  buildPanelMainImagePreservePatchOnEdit,
  buildPanelMainImageRestorePatchForEditing,
  mergeAndPrunePanelReferenceImagesAfterUpload,
  panelMergeOptionsForReferencedUpload,
  panelReferenceImagesForUpload,
  panelReferenceLabelImagePreview,
  promptPlanReferencesMainImage,
  resolvePanelMainSlotPreviewUrl,
  shouldDedupePanelRefsAgainstMainForSync,
  shouldShowPanelMainImageSlot,
} from '../utils/referencedMediaRun.ts';
import {
  buildPanelReferenceDisplayEntries,
  referenceImagesDedupePatchIfNeeded,
  resolveReferenceImageLabelsAfterPanelRun,
} from '../utils/referenceImageSlotLabels.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  [OK] ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    failures.push(name + (detail ? `: ${detail}` : ''));
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const MAIN_ASSET =
  '/flowgen-api/projects/14/assets/a4293204-b435-4667-829d-20efa78ea272/file';
const MAIN_ASSET_ID = 'a4293204-b435-4667-829d-20efa78ea272';
const REF = {
  xiong: '/flowgen-api/projects/14/assets/26a2ceb6-8175-4599-b33a-3bf119f35668/file',
  tukeng: '/flowgen-api/projects/14/assets/f2e869b4-9bc5-4a53-b9b3-61083f1301d9/file',
  pic3: 'https://cos.example/canvas-pic3.jpg',
  pic4: 'https://cos.example/canvas-pic4.jpg',
  pic5: 'https://cos.example/canvas-pic5.jpg',
  pic6: 'https://cos.example/canvas-pic6.jpg',
  pic7: 'https://cos.example/canvas-pic7.jpg',
  pic8: 'https://cos.example/canvas-pic8.jpg',
  xiamo: '/flowgen-api/projects/14/assets/750c6f9f-f893-4995-837c-8fa40b61eb4e/file',
} as const;

const UP = {
  pic3: 'https://aitop-cos/signed/PIC3.png',
  pic5: 'https://aitop-cos/signed/PIC5.png',
  pic7: 'https://aitop-cos/signed/PIC7.png',
  baize: 'https://aitop-cos/signed/BAIZE.png',
  xiamo: 'https://aitop-cos/signed/XIAMO.png',
} as const;

const PROJECT_ASSETS: ProjectAssetLabelRow[] = [
  { slug: '白泽', name: '白泽', url: MAIN_ASSET },
  { slug: '熊二', name: '熊二', url: REF.xiong },
  { slug: '土坑', name: '土坑', url: REF.tukeng },
  { slug: '夏茉', name: '夏茉', url: REF.xiamo },
];

type ModelSpec = {
  id: string;
  base: Partial<NodeData>;
  applyPrompt: (data: NodeData, prompt: string) => NodeData;
  applyRefs: (data: NodeData, refs: string[], labels: string[]) => NodeData;
};

function applyStandardRefs(data: NodeData, refs: string[], labels: string[]): NodeData {
  return { ...data, referenceImages: refs, referenceImageLabels: labels };
}

function applyOmniMultiRefs(data: NodeData, refs: string[], labels: string[]): NodeData {
  return {
    ...data,
    klingOmniMultiReferenceImages: refs,
    klingOmniMultiReferenceImageLabels: labels,
    referenceImages: refs,
    referenceImageLabels: labels,
  };
}

const MODELS: ModelSpec[] = [
  {
    id: 'Nano Banana 2.0',
    base: { selectedModel: MODEL_NANO_BANANA_2 },
    applyPrompt: (d, p) => ({ ...d, prompt: p }),
    applyRefs: applyStandardRefs,
  },
  {
    id: 'image 2',
    base: { selectedModel: MODEL_IMAGE_2 },
    applyPrompt: (d, p) => ({ ...d, prompt: p }),
    applyRefs: applyStandardRefs,
  },
  {
    id: '可灵3.0 Omni multi',
    base: { selectedModel: '可灵3.0 Omni', klingOmniTab: 'multi' },
    applyPrompt: (d, p) => ({ ...d, prompt: p, klingOmniMultiPrompt: p }),
    applyRefs: applyOmniMultiRefs,
  },
  {
    id: '可灵3.0 Omni instruction',
    base: { selectedModel: '可灵3.0 Omni', klingOmniTab: 'instruction' },
    applyPrompt: (d, p) => ({ ...d, prompt: p, klingOmniInstructionPrompt: p }),
    applyRefs: (d, refs, labels) => ({
      ...d,
      klingOmniInstructionReferenceImages: refs,
      klingOmniInstructionReferenceImageLabels: labels,
      referenceImages: refs,
      referenceImageLabels: labels,
    }),
  },
  {
    id: 'seedance2.0 参考生',
    base: {
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
    },
    applyPrompt: (d, p) => ({
      ...d,
      prompt: p,
      seedanceTabConfigs: {
        ...(d.seedanceTabConfigs || {}),
        reference: { ...(d.seedanceTabConfigs?.reference || {}), prompt: p },
      },
    }),
    applyRefs: applyStandardRefs,
  },
];

type PatternSpec = {
  id: string;
  title: string;
  prompt: string;
  refs: string[];
  labels: string[];
  uploads: Record<string, string>;
  /** 运行后期望 imagePreview */
  expectPreview: string;
  /** 未@槽须保留的下标 */
  preserveSlots: number[];
  /** @槽下标（上传后变为 signed，仍须在面板） */
  mentionedSlots: number[];
};

const PATTERNS: PatternSpec[] = [
  {
    id: 'E_assetMain_picOnly',
    title: 'E 主图=资产库 + 仅@图片5+@图片7（丢图复现）',
    prompt: '@图片5参考@图片7风格生成',
    refs: [REF.xiong, REF.tukeng, REF.pic3, REF.pic4, REF.pic5, REF.pic6, REF.pic7, REF.pic8],
    labels: ['熊二', '土坑', '图片3', '图片4', '图片5', '图片6', '图片7', '图片8'],
    uploads: { '@图片5': UP.pic5, '@图片7': UP.pic7 },
    expectPreview: UP.pic5,
    preserveSlots: [0, 1, 2, 3, 5, 7],
    mentionedSlots: [4, 6],
  },
  {
    id: 'F_assetMain_assetSelf',
    title: 'F 主图=资产库 + @资产:白泽+@图片3（正常2 node_0）',
    prompt: '@资产:白泽参考@图片3风格生成',
    refs: [REF.pic3, REF.pic4, REF.pic5, REF.pic6],
    labels: ['图片1', '图片2', '图片3', '图片4'],
    uploads: { '@资产:白泽': UP.baize, '@图片3': UP.pic5 },
    expectPreview: UP.baize,
    preserveSlots: [0, 1, 3],
    mentionedSlots: [2],
  },
  {
    id: 'G_assetMain_mainPlusPic',
    title: 'G 主图=资产库 + @主图+@图片3',
    prompt: '@主图参考@图片3风格生成',
    refs: [REF.pic3, REF.pic4, REF.pic5],
    labels: ['图片1', '图片2', '图片3'],
    uploads: { '@主图': UP.baize, '@图片3': UP.pic5 },
    expectPreview: UP.baize,
    preserveSlots: [0, 1],
    mentionedSlots: [2],
  },
];

function simulate(model: ModelSpec, pattern: PatternSpec) {
  let data: NodeData = {
    label: 'asset-main',
    imagePreview: MAIN_ASSET,
    imageName: '白泽',
    projectAssetId: MAIN_ASSET_ID,
    ...model.base,
  } as NodeData;
  data = model.applyRefs(data, pattern.refs, pattern.labels);
  data = model.applyPrompt(data, pattern.prompt);

  const ctx = buildPromptMediaRefContextFromNode(data);
  const promptText = getNodeInspectorPromptText(data) || pattern.prompt;
  const plan = collectReferencedMediaFromPrompt(
    promptText,
    data,
    ctx,
    new Map(PROJECT_ASSETS.map((a) => [a.slug, a.url])),
    PROJECT_ASSETS
  );
  const uploaded = new Map<string, string>();
  for (const e of plan.images) {
    uploaded.set(
      e.token,
      pattern.uploads[e.token] || `https://aitop-cos/signed/${encodeURIComponent(e.token)}.png`
    );
  }

  const panelBefore = panelReferenceImagesForUpload(data) || [];
  const panelAfter = mergeAndPrunePanelReferenceImagesAfterUpload(
    panelBefore,
    plan.images,
    uploaded,
    panelMergeOptionsForReferencedUpload(
      plan.images,
      uploaded,
      data.imagePreview,
      new Map(PROJECT_ASSETS.map((a) => [a.slug, a.url])),
      data.referenceImageLabels
    )
  );
  const labelsAfter = resolveReferenceImageLabelsAfterPanelRun({
    panelBefore,
    labelsBefore: data.referenceImageLabels,
    panelAfter,
    plan,
    projectAssets: PROJECT_ASSETS,
  });
  const previewPatch = buildPanelImagePreviewPatchAfterRun(plan.images, uploaded, {
    nodeData: data,
    mergedPanelRefs: panelAfter,
    mergedPanelLabels: labelsAfter,
    projectAssets: PROJECT_ASSETS,
  });

  const after: NodeData = {
    ...data,
    ...previewPatch,
    referenceImages: panelAfter,
    referenceImageLabels: labelsAfter,
    status: 'idle',
    generationParams: {
      prompt: pattern.prompt,
      referenceImages: plan.images.map((e) => uploaded.get(e.token)!).filter(Boolean),
      model: String(data.selectedModel || ''),
    },
  };
  if (model.id.includes('Omni multi')) {
    after.klingOmniMultiReferenceImages = panelAfter;
    after.klingOmniMultiReferenceImageLabels = labelsAfter;
  }
  if (model.id.includes('Omni instruction')) {
    after.klingOmniInstructionReferenceImages = panelAfter;
    after.klingOmniInstructionReferenceImageLabels = labelsAfter;
  }

  return { after, panelAfter, plan, uploaded };
}

console.log('=== 主图=资产库 × 引用方式 × 全模型 ===\n');

for (const model of MODELS) {
  console.log(`\n######## ${model.id} ########`);
  for (const pattern of PATTERNS) {
    console.log(`\n-- ${pattern.title}`);
    const { after, panelAfter } = simulate(model, pattern);
    const nonEmpty = panelAfter.filter((u) => String(u || '').trim()).length;
    ok(`${pattern.id} 面板槽数≥拖入`, nonEmpty >= pattern.refs.length, `actual=${nonEmpty}`);

    for (const i of pattern.preserveSlots) {
      ok(
        `${pattern.id} 未@槽${i}保留`,
        String(panelAfter[i] || '').trim() === pattern.refs[i],
        String(panelAfter[i] || '').slice(0, 60)
      );
    }
    for (const i of pattern.mentionedSlots) {
      ok(
        `${pattern.id} @槽${i}仍在`,
        Boolean(String(panelAfter[i] || '').trim()),
        String(panelAfter[i] || '').slice(0, 60)
      );
    }

    ok(
      `${pattern.id} imagePreview`,
      after.imagePreview === pattern.expectPreview,
      String(after.imagePreview || '').slice(0, 60)
    );
    ok(
      `${pattern.id} panelMainImageUrl=资产库备份`,
      String(after.panelMainImageUrl || '') === MAIN_ASSET ||
        after.panelMainSlotVisible === true ||
        promptPlanReferencesMainImage(
          collectReferencedMediaFromPrompt(
            pattern.prompt,
            after,
            buildPromptMediaRefContextFromNode(after),
            new Map(PROJECT_ASSETS.map((a) => [a.slug, a.url])),
            PROJECT_ASSETS
          ).images
        ),
      String(after.panelMainImageUrl || after.panelMainSlotVisible)
    );

    const preserve = buildPanelMainImagePreservePatchOnEdit(after);
    if (pattern.id === 'E_assetMain_picOnly') {
      ok(`${pattern.id} preserve 不得清 false`, preserve === undefined);
      ok(
        `${pattern.id} panelMainSlotVisible=false`,
        after.panelMainSlotVisible === false
      );
    }

    const restore = buildPanelMainImageRestorePatchForEditing(after);
    if (pattern.id === 'E_assetMain_picOnly' || pattern.id === 'F_assetMain_assetSelf') {
      ok(`${pattern.id} restore=undefined（未@主图）`, restore === undefined);
    }

    ok(`${pattern.id} 展示主图格`, shouldShowPanelMainImageSlot(after) === true);
    const mainSlot = resolvePanelMainSlotPreviewUrl(after);
    ok(
      `${pattern.id} 主图格=备份或主图`,
      Boolean(mainSlot),
      String(mainSlot || '').slice(0, 60)
    );

    const mainFor = panelReferenceLabelImagePreview(after) ?? after.imagePreview;
    const entries = buildPanelReferenceDisplayEntries(panelAfter, {
      imagePreview: mainFor,
      dedupeAgainstMain: shouldShowPanelMainImageSlot(after),
      referenceImageLabels: after.referenceImageLabels,
      projectAssets: PROJECT_ASSETS,
    });
    ok(
      `${pattern.id} 展示参考槽不丢`,
      entries.length >= pattern.refs.length,
      `display=${entries.length}`
    );

    // 强制/默认去重不得掏空 @槽（修前会清掉 imagePreview 同 URL 的槽）
    const forced = referenceImagesDedupePatchIfNeeded(after, { dedupeAgainstMain: true });
    const afterForced = forced?.referenceImages || panelAfter;
    for (const i of pattern.mentionedSlots) {
      ok(
        `${pattern.id} 强制去重后@槽${i}仍在`,
        Boolean(String(afterForced[i] || '').trim()),
        String(afterForced[i] || '').slice(0, 40)
      );
    }
    ok(
      `${pattern.id} sync 门禁`,
      pattern.id !== 'E_assetMain_picOnly' ||
        shouldDedupePanelRefsAgainstMainForSync(after) === false,
      `syncDedupe=${shouldDedupePanelRefsAgainstMainForSync(after)}`
    );
    ok(
      `${pattern.id} resolvePromptMain≠canvasRef`,
      pattern.id !== 'E_assetMain_picOnly' ||
        resolvePromptMainImagePreviewForRefs(after) === MAIN_ASSET,
      String(resolvePromptMainImagePreviewForRefs(after) || '').slice(0, 50)
    );
  }
}

// Fixture 实装：banana-主图是资产库中图片.json
console.log('\n######## fixture banana-主图是资产库中图片 ########');
const fixturePath = path.join(__dirname, 'fixtures', '20260710-banana-asset-main-panel-loss.json');
if (fs.existsSync(fixturePath)) {
  const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  for (const id of ['node_1_1783662587839', 'node_2_1783662589794']) {
    const d = raw.nodes.find((n: { id: string }) => n.id === id).data as NodeData;
    const n = (d.referenceImages || []).length;
    ok(`${id} 数据层槽数`, n >= 7, String(n));
    ok(`${id} preserve 不得清`, buildPanelMainImagePreservePatchOnEdit(d) === undefined);
    ok(`${id} restore 不得盖回`, buildPanelMainImageRestorePatchForEditing(d) === undefined);
    const forced = referenceImagesDedupePatchIfNeeded(d, { dedupeAgainstMain: true });
    const kept = (forced?.referenceImages || d.referenceImages || []).filter((u) =>
      String(u || '').trim()
    ).length;
    ok(`${id} 强制去重不减槽`, kept >= n, `kept=${kept}`);
    const mainFor = panelReferenceLabelImagePreview(d) ?? d.imagePreview;
    const entries = buildPanelReferenceDisplayEntries(d.referenceImages, {
      imagePreview: mainFor,
      dedupeAgainstMain: shouldShowPanelMainImageSlot(d),
      referenceImageLabels: d.referenceImageLabels,
    });
    ok(`${id} 展示不丢`, entries.length >= n, `display=${entries.length}`);
  }
} else {
  ok('fixture 存在', false, fixturePath);
}

console.log(`\n=== 结果: ${pass} passed, ${fail} failed ===`);
if (failures.length) {
  console.log('Failures:');
  for (const f of failures) console.log(' -', f);
}
process.exit(fail > 0 ? 1 : 0);

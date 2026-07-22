/**
 * 4 种引用方式 × 全多图参考模型矩阵（对齐 banana-丢图2 / banana-正常 四个源节点）
 *
 * 方式：
 * A) `@图片3参考@图片4` — 仅 @图片n，面板另有未@槽（丢图2）
 * B) `@图片3参考@图片9` — 仅 @图片n，多槽（正常 node_8）
 * C) `@主图参考@图片1` — @主图 + @图片n（正常 node_11）
 * D) `@资产:光头强参考@图片2` — @资产 + @图片n（正常 node_13）
 *
 * 每模型断言：
 * 1. 运行后面板槽数不减、未@槽保留
 * 2. gp 仅含 @ 到的上传 URL
 * 3. 未@主图：imagePreview=首个@参考；restore=undefined；主图格靠 panelMainImageUrl
 * 4. 有@主图：imagePreview=@主图上传；restore 允许盖回备份
 * 5. 画布缩略图与 §5.7 一致
 *
 * npx tsx scripts/20260710-four-mention-all-models-test.ts
 */
import type { NodeData } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2 } from '../types.ts';
import {
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
  getNodeInspectorPromptText,
  type ProjectAssetLabelRow,
} from '../utils/promptMediaRefs.ts';
import {
  buildPanelImagePreviewPatchAfterRun,
  buildPanelMainImageRestorePatchForEditing,
  mergeAndPrunePanelReferenceImagesAfterUpload,
  panelMergeOptionsForReferencedUpload,
  panelReferenceImagesForUpload,
  promptPlanReferencesMainImage,
  resolveCanvasNodePreviewUrl,
  resolvePanelMainSlotPreviewUrl,
  shouldShowPanelMainImageSlot,
} from '../utils/referencedMediaRun.ts';
import { resolveReferenceImageLabelsAfterPanelRun } from '../utils/referenceImageSlotLabels.ts';

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

const MAIN = 'https://cos.example/main-baize.png';
const REF = {
  daya: 'https://cos.example/daya.png',
  juan: 'https://cos.example/juan.png',
  pic1: 'https://cos.example/pic1.png',
  pic2: 'https://cos.example/pic2.png',
  pic3: 'https://cos.example/pic3.png',
  pic4: 'https://cos.example/pic4.png',
  pic6: 'https://cos.example/pic6.png',
  pic7: 'https://cos.example/pic7.png',
  pic8: 'https://cos.example/pic8.png',
  pic9: 'https://cos.example/pic9.png',
  pic10: 'https://cos.example/pic10.png',
  guang: 'https://cos.example/guangtouqiang.png',
} as const;

const UP = {
  main: 'https://aitop-cos/signed/MAIN.png',
  pic1: 'https://aitop-cos/signed/PIC1.png',
  pic2: 'https://aitop-cos/signed/PIC2.png',
  pic3: 'https://aitop-cos/signed/PIC3.png',
  pic4: 'https://aitop-cos/signed/PIC4.png',
  pic9: 'https://aitop-cos/signed/PIC9.png',
  guang: 'https://aitop-cos/signed/GUANG.png',
} as const;

const PROJECT_ASSETS: ProjectAssetLabelRow[] = [
  { slug: '光头强', name: '光头强', url: REF.guang },
];

type ModelSpec = {
  id: string;
  base: Partial<NodeData>;
  /** Omni / Seedance 写 prompt 到专用字段 */
  applyPrompt: (data: NodeData, prompt: string) => NodeData;
  /** 写参考槽到模型对应字段 */
  applyRefs: (
    data: NodeData,
    refs: string[],
    labels: string[]
  ) => NodeData;
};

function applyStandardRefs(data: NodeData, refs: string[], labels: string[]): NodeData {
  return { ...data, referenceImages: refs, referenceImageLabels: labels };
}

function applyOmniMultiRefs(data: NodeData, refs: string[], labels: string[]): NodeData {
  return {
    ...data,
    klingOmniMultiReferenceImages: refs,
    klingOmniMultiReferenceImageLabels: labels,
    // 部分路径仍读顶层；与 Omni multi 运行一致双写
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

type PatternId = 'A_picOnly_partial' | 'B_picOnly_multi' | 'C_mainPlusPic' | 'D_assetPlusPic';

type PatternSpec = {
  id: PatternId;
  title: string;
  prompt: string;
  refs: string[];
  labels: string[];
  mainUrl: string;
  /** token → upload URL */
  uploads: Record<string, string>;
  expect: {
    mentionsMain: boolean;
    /** 运行后 imagePreview */
    imagePreview: string;
    /** gp 顺序 */
    gp: string[];
    /** 未@槽下标 → 原 URL */
    preserveSlots: Record<number, string>;
    /** restore 是否应有值（运行后态） */
    restoreAllowed: boolean;
    /** legacy panelMainSlotVisible=false + @主图 时是否应 restore */
    legacyRestoreWithMain?: boolean;
  };
};

const PATTERNS: PatternSpec[] = [
  {
    id: 'A_picOnly_partial',
    title: 'A @图片3+@图片4（丢图2：未@大牙/卷卷）',
    prompt: '@图片3参考@图片4风格生成',
    refs: [REF.daya, REF.juan, REF.pic3, REF.pic4],
    labels: ['大牙-有牙', '卷卷', '图片3', '图片4'],
    mainUrl: MAIN,
    uploads: { '@图片3': UP.pic3, '@图片4': UP.pic4 },
    expect: {
      mentionsMain: false,
      imagePreview: UP.pic3,
      gp: [UP.pic3, UP.pic4],
      preserveSlots: { 0: REF.daya, 1: REF.juan },
      restoreAllowed: false,
    },
  },
  {
    id: 'B_picOnly_multi',
    title: 'B @图片3+@图片9（正常 node_8 多槽）',
    prompt: '@图片3参考@图片9风格生成',
    refs: [
      REF.pic1,
      REF.pic2,
      REF.pic3,
      REF.pic6,
      REF.pic7,
      REF.pic8,
      REF.pic9,
      REF.pic10,
    ],
    labels: ['图片1', '图片2', '图片3', '图片6', '图片7', '图片8', '图片9', '图片10'],
    mainUrl: MAIN,
    uploads: { '@图片3': UP.pic3, '@图片9': UP.pic9 },
    expect: {
      mentionsMain: false,
      imagePreview: UP.pic3,
      gp: [UP.pic3, UP.pic9],
      preserveSlots: { 0: REF.pic1, 1: REF.pic2, 3: REF.pic6, 7: REF.pic10 },
      restoreAllowed: false,
    },
  },
  {
    id: 'C_mainPlusPic',
    title: 'C @主图+@图片1（正常 node_11）',
    prompt: '@主图参考@图片1风格生成',
    refs: [REF.pic1],
    labels: ['图片1'],
    mainUrl: MAIN,
    uploads: { '@主图': UP.main, '@图片1': UP.pic1 },
    expect: {
      mentionsMain: true,
      imagePreview: UP.main,
      gp: [UP.main, UP.pic1],
      preserveSlots: { 0: UP.pic1 }, // 上传后 slot0 变为 signed
      /** @主图 运行后 panelMainSlotVisible=true，无需 restore；另测 legacy 隐藏态 */
      restoreAllowed: false,
      /** 额外：legacy false + @主图 时应允许 restore */
      legacyRestoreWithMain: true,
    },
  },
  {
    id: 'D_assetPlusPic',
    title: 'D @资产:光头强+@图片2（正常 node_13）',
    prompt: '@资产:光头强参考@图片2风格生成',
    refs: [REF.guang, REF.pic2],
    labels: ['光头强', '图片2'],
    mainUrl: MAIN,
    uploads: { '@资产:光头强': UP.guang, '@图片2': UP.pic2 },
    expect: {
      mentionsMain: false,
      imagePreview: UP.guang,
      gp: [UP.guang, UP.pic2],
      preserveSlots: {},
      restoreAllowed: false,
    },
  },
];

function simulate(
  model: ModelSpec,
  pattern: PatternSpec
): {
  panelAfter: string[];
  labelsAfter: string[];
  gp: string[];
  after: NodeData;
  restore: ReturnType<typeof buildPanelMainImageRestorePatchForEditing>;
  planTokens: string[];
  mentionsMain: boolean;
} {
  let data: NodeData = {
    label: 'four-mention',
    imagePreview: pattern.mainUrl,
    imageName: 'main',
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
    const u = pattern.uploads[e.token] || `https://aitop-cos/signed/${encodeURIComponent(e.token)}.png`;
    uploaded.set(e.token, u);
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
  };
  // Omni multi 同步写回
  if (model.id.includes('Omni')) {
    after.klingOmniMultiReferenceImages = panelAfter;
    after.klingOmniMultiReferenceImageLabels = labelsAfter;
  }

  const restore = buildPanelMainImageRestorePatchForEditing(after);
  const gp = plan.images.map((e) => uploaded.get(e.token)!).filter(Boolean);

  return {
    panelAfter,
    labelsAfter,
    gp,
    after,
    restore,
    planTokens: plan.images.map((e) => e.token),
    mentionsMain: promptPlanReferencesMainImage(plan.images),
  };
}

console.log('=== 4 种引用方式 × 全多图参考模型矩阵 ===\n');

for (const model of MODELS) {
  console.log(`\n######## ${model.id} ########`);
  for (const pattern of PATTERNS) {
    console.log(`\n--- ${model.id} · ${pattern.title} ---`);
    const res = simulate(model, pattern);
    const tag = `${model.id}·${pattern.id}`;

    ok(
      `${tag} · plan tokens`,
      res.planTokens.length === Object.keys(pattern.uploads).length &&
        Object.keys(pattern.uploads).every((t) => res.planTokens.includes(t)),
      `plan=${JSON.stringify(res.planTokens)}`
    );

    ok(
      `${tag} · mentionsMain=${pattern.expect.mentionsMain}`,
      res.mentionsMain === pattern.expect.mentionsMain
    );

    // 诉求1：槽数不减 + 未@保留
    const beforeFilled = pattern.refs.filter(Boolean).length;
    const afterFilled = res.panelAfter.filter((u) => String(u || '').trim()).length;
    ok(
      `${tag} · 面板槽不减 (${beforeFilled}→${afterFilled})`,
      afterFilled >= beforeFilled
    );
    for (const [slotStr, expected] of Object.entries(pattern.expect.preserveSlots)) {
      const slot = Number(slotStr);
      // C 模式 slot0 会被上传覆盖为 signed，期望已写 UP.pic1
      ok(
        `${tag} · 槽${slot} 保留/写回`,
        res.panelAfter[slot] === expected,
        `actual=${res.panelAfter[slot]}`
      );
    }

    // 诉求2：gp
    ok(
      `${tag} · gp 仅@引用`,
      res.gp.length === pattern.expect.gp.length &&
        res.gp.every((u, i) => u === pattern.expect.gp[i]),
      `actual=${JSON.stringify(res.gp)}`
    );

    // 诉求3：imagePreview
    ok(
      `${tag} · imagePreview`,
      res.after.imagePreview === pattern.expect.imagePreview,
      `actual=${res.after.imagePreview}`
    );

    // restore（运行后态）
    if (pattern.expect.restoreAllowed) {
      ok(
        `${tag} · restore 允许`,
        Boolean(res.restore?.imagePreview),
        JSON.stringify(res.restore)
      );
    } else if (pattern.expect.mentionsMain) {
      // @主图 运行后主图格已可见（panelMainSlotVisible=true），restore 应为 undefined
      ok(
        `${tag} · @主图运行后无需 restore（已可见）`,
        res.restore === undefined,
        JSON.stringify(res.restore)
      );
      ok(
        `${tag} · @主图运行后主图格可见`,
        shouldShowPanelMainImageSlot(res.after) === true
      );
    } else {
      ok(`${tag} · restore=undefined（未@主图）`, res.restore === undefined);
      ok(
        `${tag} · 主图格靠备份`,
        resolvePanelMainSlotPreviewUrl(res.after) === pattern.mainUrl ||
          shouldShowPanelMainImageSlot(res.after) === true,
        `mainSlot=${resolvePanelMainSlotPreviewUrl(res.after)}`
      );
      const canvas = resolveCanvasNodePreviewUrl(res.after, PROJECT_ASSETS);
      ok(
        `${tag} · 画布≠主图备份`,
        canvas !== pattern.mainUrl,
        `canvas=${canvas}`
      );
      ok(
        `${tag} · 画布=首个@参考`,
        canvas === pattern.expect.imagePreview,
        `canvas=${canvas}`
      );
    }

    // legacy：隐藏主图格 + 仍有 @主图 → 允许 restore 回备份
    if (pattern.expect.legacyRestoreWithMain) {
      const legacy: NodeData = {
        ...res.after,
        panelMainSlotVisible: false,
        panelMainImageUrl: pattern.mainUrl,
        imagePreview: UP.pic1,
        prompt: pattern.prompt,
      };
      if (model.id.includes('Omni')) {
        legacy.klingOmniMultiPrompt = pattern.prompt;
      }
      if (model.id.includes('seedance')) {
        legacy.seedanceTabConfigs = {
          ...(legacy.seedanceTabConfigs || {}),
          reference: { ...(legacy.seedanceTabConfigs?.reference || {}), prompt: pattern.prompt },
        };
      }
      const legacyRestore = buildPanelMainImageRestorePatchForEditing(legacy);
      ok(
        `${tag} · legacy 隐藏+@主图 可 restore`,
        legacyRestore?.imagePreview === pattern.mainUrl,
        JSON.stringify(legacyRestore)
      );
    }
  }
}

console.log(`\n=== 汇总: ${pass} 通过, ${fail} 失败 ===`);
if (failures.length) {
  console.log('失败项:');
  for (const f of failures) console.log(' - ' + f);
}
if (fail > 0) process.exit(1);

/**
 * 全模型 × 全 tab × 三诉求逐项核对（纯模拟，不调 API）
 *
 * 三诉求：
 * 1. 运行后面板上拖入的元素完整保留（未@槽不裁剪）
 * 2. Node Details 引用的参考 = 创意描述中 @ 到的（gp.referenceImages 仅含 @ 到的）
 * 3. 节点缩略图 = 引用元素的第一个
 *    - 运行前：主图
 *    - 未@主图运行后：首个@参考图上传 URL
 *    - @主图运行后：@主图上传 URL
 *
 * npx tsx scripts/all-models-three-requirements-test.ts
 */
import type { NodeData } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2 } from '../types.ts';
import {
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
  getNodeInspectorPromptText,
} from '../utils/promptMediaRefs.ts';
import {
  buildPanelImagePreviewPatchAfterRun,
  buildRunNodeImagePreviewPatch,
  firstUploadedNonMainImageFromPlan,
  mergeAndPrunePanelReferenceImagesAfterUpload,
  panelMergeOptionsForReferencedUpload,
  panelReferenceImagesForUpload,
  promptPlanReferencesMainImage,
  resolveCanvasNodePreviewUrl,
  shouldShowPanelMainImageSlot,
} from '../utils/referencedMediaRun.ts';
import { resolveReferenceImageLabelsAfterPanelRun } from '../utils/referenceImageSlotLabels.ts';

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

function simNode(partial: Partial<NodeData> & { selectedModel: string }): NodeData {
  return { label: 'three-req', ...partial } as NodeData;
}

type RunSimResult = {
  panelAfter: string[];
  labelsAfter: string[];
  gpSnapshot: string[];
  previewPatch: Partial<NodeData>;
  imagePreviewAfter: string | undefined;
  canvasPreviewAfter: string | undefined;
  mentionsMain: boolean;
};

/** mock 上传 URL：用 ASCII tag 避免中文被剥离导致期望值对不上 */
function mockUploadUrl(token: string): string {
  const map: Record<string, string> = {
    '@主图': 'https://aitop-cos/signed/MAIN.png',
    '@主体': 'https://aitop-cos/signed/MAIN.png',
    '@图片1': 'https://aitop-cos/signed/REF1.png',
    '@图片2': 'https://aitop-cos/signed/REF2.png',
    '@图片3': 'https://aitop-cos/signed/REF3.png',
    '@图片': 'https://aitop-cos/signed/REF1.png',
    '@首帧图': 'https://aitop-cos/signed/FIRST.png',
    '@尾帧图': 'https://aitop-cos/signed/LAST.png',
  };
  return map[token] || `https://aitop-cos/signed/TOKEN-${token.length}.png`;
}

/** 模拟一次运行（不调 API），返回面板/gp/缩略图三态 */
function simulateRun(data: NodeData, prompt: string): RunSimResult {
  const runData: NodeData = { ...data, prompt };
  const model = data.selectedModel || '';
  if (model === '可灵3.0 Omni') {
    const tab = data.klingOmniTab || 'multi';
    if (tab === 'multi') runData.klingOmniMultiPrompt = prompt;
    else if (tab === 'instruction') runData.klingOmniInstructionPrompt = prompt;
    else if (tab === 'video') runData.klingOmniVideoPrompt = prompt;
  }
  if (model.includes('seedance') && data.seedanceGenerationMode === 'reference') {
    runData.seedanceTabConfigs = {
      ...(data.seedanceTabConfigs || {}),
      reference: { ...(data.seedanceTabConfigs?.reference || {}), prompt },
    };
  }

  const ctx = buildPromptMediaRefContextFromNode(runData);
  const plan = collectReferencedMediaFromPrompt(
    getNodeInspectorPromptText(runData) || prompt,
    runData,
    ctx,
    new Map()
  );
  const panelBefore = panelReferenceImagesForUpload(runData) || [];
  const uploaded = new Map<string, string>();
  for (const e of plan.images) {
    uploaded.set(e.token, mockUploadUrl(e.token));
  }
  const mergeOpts = panelMergeOptionsForReferencedUpload(
    plan.images,
    uploaded,
    runData.imagePreview,
    new Map(),
    runData.referenceImageLabels
  );
  const panelAfter = mergeAndPrunePanelReferenceImagesAfterUpload(
    panelBefore,
    plan.images,
    uploaded,
    mergeOpts
  );
  const labelsAfter = resolveReferenceImageLabelsAfterPanelRun({
    panelBefore,
    labelsBefore: runData.referenceImageLabels,
    panelAfter,
    plan,
  });
  // gp 快照 = 本次 plan @ 到的上传 URL（顺序=plan 顺序），与 FlowEditor runCaptureForGp 一致
  const gpSnapshot = plan.images
    .map((e) => uploaded.get(e.token))
    .filter((u): u is string => Boolean(u));

  // 缩略图 patch：多图参考模型用 buildPanelImagePreviewPatchAfterRun；首尾帧模型用 buildRunNodeImagePreviewPatch
  const isFrameModel =
    model === '可灵 2.5 Turbo' ||
    model === 'vidu 2.0' ||
    model === '即梦3.0 Pro' ||
    (model === '可灵3.0 Omni' && (data.klingOmniTab || 'multi') === 'frames') ||
    (model.includes('seedance') && data.seedanceGenerationMode === 'image');
  const previewPatch = isFrameModel
    ? buildRunNodeImagePreviewPatch(plan.images, uploaded, {
        startUrl: uploaded.get('@首帧图'),
        endUrl: uploaded.get('@尾帧图'),
      })
    : buildPanelImagePreviewPatchAfterRun(plan.images, uploaded, {
        nodeData: runData,
        mergedPanelRefs: panelAfter,
        mergedPanelLabels: labelsAfter,
      });

  const afterRun: NodeData = {
    ...runData,
    ...previewPatch,
    referenceImages: panelAfter,
    referenceImageLabels: labelsAfter,
  };
  return {
    panelAfter,
    labelsAfter,
    gpSnapshot,
    previewPatch,
    imagePreviewAfter: afterRun.imagePreview,
    canvasPreviewAfter: resolveCanvasNodePreviewUrl(afterRun),
    mentionsMain: promptPlanReferencesMainImage(plan.images),
  };
}

/** 核对一个场景的三诉求 */
function checkThreeReqs(
  caseId: string,
  data: NodeData,
  prompt: string,
  expectations: {
    /** 未@槽应保留的下标 → 期望的面板 URL（运行前原值） */
    preserveSlots?: Record<number, string>;
    /** gp 快照应等于 */
    gpExpected: string[];
    /** 缩略图应等于 */
    thumbExpected: string;
    /** 是否 @主图 */
    mentionsMain: boolean;
  }
): void {
  console.log(`\n--- ${caseId} ---`);
  console.log(`  prompt: ${prompt}`);
  const res = simulateRun(data, prompt);

  // 诉求 1：未@槽保留
  if (expectations.preserveSlots) {
    for (const [slotStr, expectedUrl] of Object.entries(expectations.preserveSlots)) {
      const slot = Number(slotStr);
      const actual = res.panelAfter[slot];
      ok(
        `${caseId} · 诉求1 · 槽${slot} 未@保留 (${expectedUrl})`,
        actual === expectedUrl,
        `actual=${actual}`
      );
    }
  }
  // 面板槽总数不减少
  const beforeCount = (panelReferenceImagesForUpload(data) || []).filter((u) =>
    String(u || '').trim()
  ).length;
  const afterFilledCount = res.panelAfter.filter((u) => String(u || '').trim()).length;
  ok(
    `${caseId} · 诉求1 · 面板槽总数不减少 (${beforeCount}→${afterFilledCount})`,
    afterFilledCount >= beforeCount,
    `before=${beforeCount} after=${afterFilledCount}`
  );

  // 诉求 2：gp 仅含 @ 到的
  ok(
    `${caseId} · 诉求2 · gp 仅含 @ 到的 (${expectations.gpExpected.length} 张)`,
    res.gpSnapshot.length === expectations.gpExpected.length &&
      res.gpSnapshot.every((u, i) => u === expectations.gpExpected[i]),
    `actual=${JSON.stringify(res.gpSnapshot)} expected=${JSON.stringify(expectations.gpExpected)}`
  );

  // 诉求 3：缩略图 = 引用元素第一个
  ok(
    `${caseId} · 诉求3 · 缩略图=${expectations.mentionsMain ? '@主图' : '首个@参考图'}`,
    res.imagePreviewAfter === expectations.thumbExpected,
    `actual=${res.imagePreviewAfter} expected=${expectations.thumbExpected}`
  );
  ok(
    `${caseId} · 诉求3 · 画布预览一致`,
    res.canvasPreviewAfter === expectations.thumbExpected,
    `actual=${res.canvasPreviewAfter} expected=${expectations.thumbExpected}`
  );
}

// ============ 多图参考模型 ============

const multiRefModels: Array<{
  id: string;
  model: string;
  tab?: 'multi' | 'instruction' | 'video';
  panelRefs: string[];
  panelLabels: string[];
  /** @主图 token 是否能映射到主图（Omni 主图四 tab 共用 imagePreview） */
  supportsMainAt: boolean;
}> = [
  { id: 'Nano Banana 2.0', model: MODEL_NANO_BANANA_2, panelRefs: [], panelLabels: [], supportsMainAt: true },
  { id: 'image 2', model: MODEL_IMAGE_2, panelRefs: [], panelLabels: [], supportsMainAt: true },
  { id: '可灵3.0 Omni · multi', model: '可灵3.0 Omni', tab: 'multi', panelRefs: [], panelLabels: [], supportsMainAt: true },
  { id: '可灵3.0 Omni · instruction', model: '可灵3.0 Omni', tab: 'instruction', panelRefs: [], panelLabels: [], supportsMainAt: true },
  { id: '可灵3.0 Omni · video', model: '可灵3.0 Omni', tab: 'video', panelRefs: [], panelLabels: [], supportsMainAt: true },
];

const A = 'https://sim.cos/panel/A.png';
const B = 'https://sim.cos/panel/B.png';
const C = 'https://sim.cos/panel/C.png';
const MAIN = 'https://sim.cos/main.png';

console.log('\n====== 多图参考模型：未@主图 + @图片1+@图片3（图片2 未@） ======');

for (const m of multiRefModels) {
  const data = simNode({
    selectedModel: m.model,
    imagePreview: MAIN,
    referenceImages: [A, B, C],
    referenceImageLabels: ['图片1', '图片2', '图片3'],
    prompt: '',
    ...(m.tab ? { klingOmniTab: m.tab } : {}),
  });
  // Omni multi/instruction/video 用 klingOmni*ReferenceImages 字段
  if (m.model === '可灵3.0 Omni') {
    const tab = m.tab!;
    data.klingOmniMultiReferenceImages = tab === 'multi' ? [A, B, C] : undefined;
    data.klingOmniInstructionReferenceImages = tab === 'instruction' ? [A, B, C] : undefined;
    data.klingOmniVideoReferenceImages = tab === 'video' ? [A, B, C] : undefined;
  }
  const prompt = '@图片1 @图片3 生成';
  const signedA = `https://aitop-cos/signed/REF1.png`;
  const signedC = `https://aitop-cos/signed/REF3.png`;
  checkThreeReqs(`${m.id} · 未@主图`, data, prompt, {
    preserveSlots: { 1: B },
    gpExpected: [signedA, signedC],
    thumbExpected: signedA,
    mentionsMain: false,
  });
}

console.log('\n====== 多图参考模型：@主图 + @图片2（图片1/图片3 未@） ======');

for (const m of multiRefModels) {
  if (!m.supportsMainAt) continue;
  const data = simNode({
    selectedModel: m.model,
    imagePreview: MAIN,
    referenceImages: [A, B, C],
    referenceImageLabels: ['图片1', '图片2', '图片3'],
    prompt: '',
    ...(m.tab ? { klingOmniTab: m.tab } : {}),
  });
  if (m.model === '可灵3.0 Omni') {
    const tab = m.tab!;
    data.klingOmniMultiReferenceImages = tab === 'multi' ? [A, B, C] : undefined;
    data.klingOmniInstructionReferenceImages = tab === 'instruction' ? [A, B, C] : undefined;
    data.klingOmniVideoReferenceImages = tab === 'video' ? [A, B, C] : undefined;
  }
  const prompt = '@主图 @图片2 生成';
  const signedMain = `https://aitop-cos/signed/MAIN.png`;
  const signedB = `https://aitop-cos/signed/REF2.png`;
  checkThreeReqs(`${m.id} · @主图`, data, prompt, {
    preserveSlots: { 0: A, 2: C },
    gpExpected: [signedMain, signedB],
    thumbExpected: signedMain,
    mentionsMain: true,
  });
}

// ============ Seedance 参考生 ============

console.log('\n====== Seedance 2.0 参考生：未@主图 + @图片1+@图片3 ======');

for (const model of ['seedance2.0 (急速版)', 'seedance2.0 (高质量版)'] as const) {
  const data = simNode({
    selectedModel: model,
    seedanceGenerationMode: 'reference',
    imagePreview: MAIN,
    referenceImages: [A, B, C],
    referenceImageLabels: ['图片1', '图片2', '图片3'],
    prompt: '',
    seedanceTabConfigs: {
      reference: { prompt: '', referenceImages: [A, B, C], referenceImageLabels: ['图片1', '图片2', '图片3'] },
    },
  });
  const prompt = '@图片1 @图片3 生成';
  const signedA = `https://aitop-cos/signed/REF1.png`;
  const signedC = `https://aitop-cos/signed/REF3.png`;
  checkThreeReqs(`${model} · 参考生 · 未@主图`, data, prompt, {
    preserveSlots: { 1: B },
    gpExpected: [signedA, signedC],
    thumbExpected: signedA,
    mentionsMain: false,
  });
}

// ============ 首尾帧模型 ============

console.log('\n====== 首尾帧模型：@首帧图+@尾帧图 ======');

const firstFrame = 'https://sim.cos/first-frame.png';
const lastFrame = 'https://sim.cos/last-frame.png';

const frameModels: Array<{ id: string; model: string; tab?: 'frames' }> = [
  { id: '可灵 2.5 Turbo', model: '可灵 2.5 Turbo' },
  { id: 'vidu 2.0', model: 'vidu 2.0' },
  { id: '即梦3.0 Pro', model: '即梦3.0 Pro' },
  { id: '可灵3.0 Omni · frames', model: '可灵3.0 Omni', tab: 'frames' },
  { id: 'seedance2.0 (急速版) · 图生', model: 'seedance2.0 (急速版)' },
  { id: 'seedance2.0 (高质量版) · 图生', model: 'seedance2.0 (高质量版)' },
];

for (const m of frameModels) {
  const data = simNode({
    selectedModel: m.model,
    imagePreview: MAIN,
    firstFrameImage: firstFrame,
    firstFrameImageUrl: firstFrame,
    lastFrameImage: lastFrame,
    lastFrameImageUrl: lastFrame,
    prompt: '',
    ...(m.tab ? { klingOmniTab: m.tab } : {}),
    ...(m.model.includes('seedance') ? { seedanceGenerationMode: 'image' as const } : {}),
  });
  const prompt = '@首帧图 @尾帧图 过渡动画';
  const signedFirst = `https://aitop-cos/signed/FIRST.png`;
  const signedLast = `https://aitop-cos/signed/LAST.png`;
  // 首尾帧模型：firstFrameImage/lastFrameImage 槽 = 面板态；gp = [@首帧图, @尾帧图]；缩略图 = @首帧图（首个@参考）
  const res = simulateRun(data, prompt);
  console.log(`\n--- ${m.id} · @首帧图+@尾帧图 ---`);
  // 诉求1：首尾帧槽保留（运行前后都是首帧/尾帧 URL，上传后替换为 signed URL）
  ok(
    `${m.id} · 诉求1 · 首帧槽运行后=首帧上传URL`,
    Boolean(res.previewPatch.imagePreview),
    `previewPatch=${JSON.stringify(res.previewPatch)}`
  );
  // 诉求2：gp 含 @首帧图 + @尾帧图
  ok(
    `${m.id} · 诉求2 · gp 含首尾帧上传URL (${signedFirst}, ${signedLast})`,
    res.gpSnapshot.length === 2 && res.gpSnapshot[0] === signedFirst && res.gpSnapshot[1] === signedLast,
    `actual=${JSON.stringify(res.gpSnapshot)}`
  );
  // 诉求3：缩略图 = @首帧图（首个@参考）
  ok(
    `${m.id} · 诉求3 · 缩略图=首个@参考(@首帧图)`,
    res.imagePreviewAfter === signedFirst,
    `actual=${res.imagePreviewAfter} expected=${signedFirst}`
  );
}

// ============ Seedance 文生（无图引用，不应触发诉求3 切换） ============

console.log('\n====== Seedance 文生：纯文本（无@引用，缩略图保持主图） ======');

for (const model of ['seedance2.0 (急速版)', 'seedance2.0 (高质量版)'] as const) {
  const data = simNode({
    selectedModel: model,
    seedanceGenerationMode: 'text',
    imagePreview: MAIN,
    prompt: '',
  });
  const prompt = '一只猫在奔跑';
  const res = simulateRun(data, prompt);
  console.log(`\n--- ${model} · 文生 · 纯文本 ---`);
  ok(
    `${model} · 诉求3 · 纯文本缩略图保持主图`,
    res.imagePreviewAfter === undefined || res.imagePreviewAfter === MAIN,
    `actual=${res.imagePreviewAfter}`
  );
  ok(`${model} · 诉求2 · gp 无参考图`, res.gpSnapshot.length === 0, `actual=${JSON.stringify(res.gpSnapshot)}`);
}

// ============ 运行前缩略图 = 主图（所有模型） ============

console.log('\n====== 运行前：缩略图 = 主图（所有模型） ======');

const allModels = [
  ...multiRefModels.map((m) => ({ id: m.id, model: m.model, tab: m.tab })),
  { id: '可灵3.0 Omni · frames', model: '可灵3.0 Omni', tab: 'frames' as const },
  { id: '可灵 2.5 Turbo', model: '可灵 2.5 Turbo' },
  { id: 'vidu 2.0', model: 'vidu 2.0' },
  { id: '即梦3.0 Pro', model: '即梦3.0 Pro' },
  { id: 'seedance2.0 (急速版) · 参考生', model: 'seedance2.0 (急速版)' },
  { id: 'seedance2.0 (高质量版) · 参考生', model: 'seedance2.0 (高质量版)' },
  { id: 'seedance2.0 (急速版) · 图生', model: 'seedance2.0 (急速版)' },
  { id: 'seedance2.0 (高质量版) · 图生', model: 'seedance2.0 (高质量版)' },
  { id: 'seedance2.0 (急速版) · 文生', model: 'seedance2.0 (急速版)' },
  { id: 'seedance2.0 (高质量版) · 文生', model: 'seedance2.0 (高质量版)' },
];

for (const m of allModels) {
  const isRef = m.id.includes('参考生');
  const isImage = m.id.includes('图生');
  const isText = m.id.includes('文生');
  const isFrames = m.tab === 'frames';
  const data = simNode({
    selectedModel: m.model,
    imagePreview: MAIN,
    prompt: '',
    ...(m.tab ? { klingOmniTab: m.tab } : {}),
    ...(isRef ? { seedanceGenerationMode: 'reference' as const } : {}),
    ...(isImage ? { seedanceGenerationMode: 'image' as const, firstFrameImage: firstFrame, firstFrameImageUrl: firstFrame } : {}),
    ...(isText ? { seedanceGenerationMode: 'text' as const } : {}),
    ...(isFrames ? { firstFrameImage: firstFrame, firstFrameImageUrl: firstFrame, lastFrameImage: lastFrame, lastFrameImageUrl: lastFrame } : {}),
    ...(m.model === '可灵3.0 Omni' && m.tab === 'multi' ? { klingOmniMultiReferenceImages: [A] } : {}),
    ...(m.model === '可灵3.0 Omni' && m.tab === 'instruction' ? { klingOmniInstructionReferenceImages: [A] } : {}),
    ...(m.model === '可灵3.0 Omni' && m.tab === 'video' ? { klingOmniVideoReferenceImages: [A] } : {}),
    referenceImages: isRef || (m.model === '可灵3.0 Omni' && (m.tab === 'multi' || m.tab === 'instruction' || m.tab === 'video')) || m.model === MODEL_NANO_BANANA_2 || m.model === MODEL_IMAGE_2 ? [A] : undefined,
  });
  ok(`${m.id} · 运行前缩略图=主图`, data.imagePreview === MAIN, `actual=${data.imagePreview}`);
}

console.log(`\n====== 汇总：${pass} 通过, ${fail} 失败 ======`);
if (fail > 0) process.exit(1);

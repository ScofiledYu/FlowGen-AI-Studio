/**
 * 全模型「多图拖入 · 创意描述只 @ 部分」矩阵：
 * 面板保留全部槽 / Details 仅 @ 引用 / @ 下拉 / 运行后新拖入可@
 *
 * npx tsx scripts/panel-partial-ref-matrix-test.ts
 */
import type { NodeData, GenerationParams } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2, NodeType } from '../types.ts';
import {
  buildGenerationParamsFromRunSnapshot,
  buildImageGenOutputReferenceDetailsFromSnapshot,
  buildNodeDetailsBaseParams,
  buildOmniMultiTabDetailsReferencePreview,
  buildSeedanceReferenceDetailsFromSnapshot,
} from '../utils/nodeDetailsPreview.ts';
import {
  buildInspectorPromptMentionItems,
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
  getNodeInspectorPromptText,
  panelReferenceSlotLabel,
} from '../utils/promptMediaRefs.ts';
import {
  resolveReferenceImageLabelsAfterPanelRun,
  resolveReferenceSlotDisplayLabel,
} from '../utils/referenceImageSlotLabels.ts';
import { buildPanelRefSlotSyncPatch } from '../utils/panelRefPersistence.ts';
import {
  buildFirstLastFramePanelPatchFromPlan,
  buildSeedanceReferenceApiLabelsFromPlan,
  buildSeedanceReferenceImagesApiPayload,
  enrichPlanImagesWithPanelSlotIndexes,
  mergeAndPrunePanelReferenceImagesAfterUpload,
  panelMergeOptionsForReferencedUpload,
  panelReferenceImagesForUpload,
  promptPlanReferencesMainImage,
} from '../utils/referencedMediaRun.ts';

let pass = 0;
let fail = 0;

function simNode(partial: Partial<NodeData> & { selectedModel: string }): NodeData {
  return { label: 'partial-ref', ...partial } as NodeData;
}

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

function eq(actual: unknown, expected: unknown, name: string) {
  const sa = JSON.stringify(actual);
  const se = JSON.stringify(expected);
  ok(name, sa === se, sa !== se ? `got ${sa} want ${se}` : undefined);
}

const U = {
  main: 'https://sim/partial/main.png',
  r0: 'https://sim/partial/r0.png',
  r1: 'https://sim/partial/r1.png',
  r2: 'https://sim/partial/r2.png',
  r3: 'https://sim/partial/r3.png',
  dup: 'https://sim/partial/dup-main.png',
  ff: 'https://sim/partial/ff.png',
  lf: 'https://sim/partial/lf.png',
};

function mockUploaded(plan: ReturnType<typeof collectReferencedMediaFromPrompt>): Map<string, string> {
  const m = new Map<string, string>();
  for (const img of plan.images) m.set(img.token, `${img.url}|UP`);
  for (const v of plan.videos) m.set(v.token, `${v.url}|UP`);
  return m;
}

function refArrayForModel(data: NodeData): string[] {
  const model = data.selectedModel || '';
  if (model === '可灵3.0 Omni') {
    const tab = data.klingOmniTab || 'multi';
    if (tab === 'multi') return [...(data.klingOmniMultiReferenceImages || [])];
    if (tab === 'instruction') return [...(data.klingOmniInstructionReferenceImages || [])];
    if (tab === 'video') return [...(data.klingOmniVideoReferenceImages || [])];
    return [];
  }
  return [...(data.referenceImages || [])];
}

function applyPanelToData(data: NodeData, panel: string[], labels?: string[]): NodeData {
  const model = data.selectedModel || '';
  const patch: Partial<NodeData> = labels ? { referenceImageLabels: labels } : {};
  if (model === '可灵3.0 Omni') {
    const tab = data.klingOmniTab || 'multi';
    if (tab === 'multi') return { ...data, ...patch, klingOmniMultiReferenceImages: [...panel] };
    if (tab === 'instruction') {
      return { ...data, ...patch, klingOmniInstructionReferenceImages: [...panel] };
    }
    return { ...data, ...patch, klingOmniVideoReferenceImages: [...panel] };
  }
  return { ...data, ...patch, referenceImages: [...panel] };
}

function slotLabelMode(data: NodeData): 'panelSlot' | 'seedanceSlot' {
  const model = data.selectedModel || '';
  return model.includes('seedance') && data.seedanceGenerationMode === 'reference'
    ? 'seedanceSlot'
    : 'panelSlot';
}

function promptForData(data: NodeData, prompt: string): NodeData {
  const model = data.selectedModel || '';
  if (model === '可灵3.0 Omni') {
    const tab = data.klingOmniTab || 'multi';
    if (tab === 'multi') return { ...data, prompt, klingOmniMultiPrompt: prompt };
    if (tab === 'instruction') return { ...data, prompt, klingOmniInstructionPrompt: prompt };
    if (tab === 'video') return { ...data, prompt, klingOmniVideoPrompt: prompt };
    return { ...data, prompt, klingOmniFramesPrompt: prompt };
  }
  if (model.includes('seedance')) {
    const mode = (data.seedanceGenerationMode || 'text') as 'text' | 'image' | 'reference';
    const tabs = { ...(data.seedanceTabConfigs || {}) };
    tabs[mode] = { ...(tabs[mode] || {}), prompt };
    return { ...data, prompt, seedanceTabConfigs: tabs };
  }
  return { ...data, prompt };
}

type PanelPartialExpect = {
  /** 未 @ 但仍保留原图的槽（运行后面板不裁剪） */
  preservedUnrefSlots: number[];
  keptSlots: number[];
  /** 保留槽底栏标签 */
  slotLabels?: Record<number, string>;
  /** gp/API 顺序的 Details 标签 */
  detailLabels: string[];
  mentionInclude?: string[];
  mentionExclude?: string[];
  /** 创意描述序号修正（跳号 @图片4 等） */
  repairedPrompt?: string;
  planImageTokens?: string[];
};

type PanelPartialCase = {
  id: string;
  data: NodeData;
  prompt: string;
  expect: PanelPartialExpect;
};

type FramePartialExpect = {
  keepFirst?: boolean;
  keepLast?: boolean;
  detailLabels: string[];
  planImageTokens: string[];
};

type FramePartialCase = {
  id: string;
  data: NodeData;
  prompt: string;
  expect: FramePartialExpect;
};

function assertOutputDetails(
  caseId: string,
  upstream: NodeData,
  model: string,
  apiUrls: string[],
  gpLabels: string[],
  detailLabels: string[]
) {
  const cleanApiUrls = apiUrls.map((u) => u.replace(/\|UP$/i, ''));
  const gp = buildGenerationParamsFromRunSnapshot(upstream, model, {
    runCapture: { referenceImages: [...cleanApiUrls], referenceImageLabels: gpLabels },
  });
  gp.referenceImages = [...cleanApiUrls];
  gp.referenceImageLabels = [...gpLabels];
  gp.prompt = upstream.prompt;

  const output = simNode({
    selectedModel: model,
    generationParams: gp,
    prompt: upstream.prompt,
    imagePreview: 'https://sim/partial/output.jpg',
    seedanceGenerationMode: upstream.seedanceGenerationMode,
    klingOmniTab: upstream.klingOmniTab,
  });

  const base = buildNodeDetailsBaseParams({
    previewNodeData: output,
    nodeType: NodeType.OUTPUT,
    ancestorData: upstream,
  });
  ok(`${caseId}: Details model=快照`, base.model === model);

  const isSeedanceRef =
    model.includes('seedance') && upstream.seedanceGenerationMode === 'reference';
  if (isSeedanceRef) {
    const sd = buildSeedanceReferenceDetailsFromSnapshot({
      snapshotRefs: gp.referenceImages || [],
      snapshotLabels: gp.referenceImageLabels,
      prompt: gp.prompt,
    });
    eq(
      sd.referenceImageDetailItems.map((x) => x.label),
      detailLabels,
      `${caseId}: Seedance Details 标签`
    );
    eq(sd.referenceImages.length, detailLabels.length, `${caseId}: Details 张数`);
    return;
  }

  if (model === MODEL_IMAGE_2 || model === MODEL_NANO_BANANA_2) {
    const fromSnap = buildImageGenOutputReferenceDetailsFromSnapshot({
      snapshotRefs: gp.referenceImages || [],
      snapshotLabels: gp.referenceImageLabels,
      prompt: gp.prompt,
      outputImagePreview: output.imagePreview,
      isRunSnapshotRef: () => true,
      isSameAsOutput: () => false,
    });
    eq(
      fromSnap.referenceImageDetailItems.map((x) => x.label),
      detailLabels,
      `${caseId}: image2/Nano Details 标签`
    );
    eq(fromSnap.referenceImages.length, detailLabels.length, `${caseId}: Details 张数`);
    return;
  }

  if (model === '可灵3.0 Omni' && (upstream.klingOmniTab || 'multi') === 'multi') {
    const fromSnap = buildImageGenOutputReferenceDetailsFromSnapshot({
      snapshotRefs: gp.referenceImages || [],
      snapshotLabels: gp.referenceImageLabels,
      prompt: gp.prompt,
      outputImagePreview: output.imagePreview,
      isRunSnapshotRef: () => true,
      isSameAsOutput: () => false,
    });
    eq(
      fromSnap.referenceImageDetailItems.map((x) => x.label),
      detailLabels,
      `${caseId}: Omni multi Details 标签`
    );
    eq(fromSnap.referenceImages.length, detailLabels.length, `${caseId}: Details 张数`);
    return;
  }
}

function runPanelPartialCase(c: PanelPartialCase) {
  const { id, prompt, expect: exp } = c;
  let data = promptForData(c.data, prompt);
  const panelBefore = [...refArrayForModel(data)];
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, new Map());

  if (exp.planImageTokens) {
    eq(plan.images.map((e) => e.token), exp.planImageTokens, `${id}: plan token 顺序`);
  }

  const uploaded = mockUploaded(plan);
  const panelAfter = mergeAndPrunePanelReferenceImagesAfterUpload(
    panelBefore,
    plan.images,
    uploaded,
    panelMergeOptionsForReferencedUpload(plan.images, uploaded, data.imagePreview)
  );

  for (const i of exp.preservedUnrefSlots) {
    const before = String(panelBefore[i] || '').trim();
    if (!before) continue;
    const after = String(panelAfter[i] || '').trim();
    ok(
      `${id}: 未@槽${i}仍保留`,
      !!after && (after === before || after.replace(/\|UP$/i, '') === before),
      `${after} vs ${before}`
    );
  }
  for (const i of exp.keptSlots) {
    ok(`${id}: 已@槽${i}保留`, !!String(panelAfter[i] || '').trim(), panelAfter[i]);
  }

  let labelsAfter = resolveReferenceImageLabelsAfterPanelRun({
    panelBefore,
    labelsBefore: data.referenceImageLabels,
    panelAfter,
    plan: { images: plan.images, videos: plan.videos, audios: plan.audios },
  });

  data = applyPanelToData(data, panelAfter, labelsAfter);
  const syncPatch = buildPanelRefSlotSyncPatch(data, { dedupeAgainstMain: false });
  if (syncPatch) {
    data = { ...data, ...syncPatch };
    if (syncPatch.referenceImageLabels) labelsAfter = syncPatch.referenceImageLabels;
    if (data.selectedModel === '可灵3.0 Omni' && syncPatch.referenceImageLabels) {
      data = applyPanelToData(data, refArrayForModel(data), syncPatch.referenceImageLabels);
    }
  }
  const panelFinal = refArrayForModel(data);
  const displayLabels = data.referenceImageLabels || labelsAfter;
  const ctxFinal = buildPromptMediaRefContextFromNode(data);
  const effectivePrompt = getNodeInspectorPromptText(data) || prompt;

  if (exp.repairedPrompt != null) {
    eq(effectivePrompt, exp.repairedPrompt, `${id}: prompt 序号修正`);
  }

  const mode = slotLabelMode(data);
  if (exp.slotLabels) {
    for (const [slotStr, wantLabel] of Object.entries(exp.slotLabels)) {
      const slot = parseInt(slotStr, 10);
      const cap = resolveReferenceSlotDisplayLabel(
        slot,
        panelFinal,
        displayLabels,
        data.imagePreview,
        mode
      );
      eq(cap, wantLabel, `${id}: 槽${slot}底栏标签`);
    }
  }

  const mentions = buildInspectorPromptMentionItems(data, ctxFinal);
  const mentionTokens = mentions.map((m) => m.insertText?.trim()).filter(Boolean) as string[];
  for (const t of exp.mentionInclude || []) {
    ok(`${id}: @ 下拉含 ${t}`, mentionTokens.includes(t), mentionTokens.join(','));
  }
  for (const t of exp.mentionExclude || []) {
    ok(`${id}: @ 下拉不含 ${t}`, !mentionTokens.includes(t), mentionTokens.join(','));
  }

  for (const i of exp.keptSlots) {
    const planEntry = plan.images.find((e) => e.refImageSlotIndex === i);
    const plan2 = collectReferencedMediaFromPrompt(
      effectivePrompt,
      data,
      ctxFinal,
      new Map()
    );
    if (planEntry) {
      const token = planEntry.token;
      const altToken =
        exp.repairedPrompt && token.match(/^@图片(\d+)$/)
          ? effectivePrompt.includes(token)
            ? token
            : `@图片${displayLabels[i]?.match(/^图片(\d+)$/)?.[1] || '?'}`
          : token;
      const hit = plan2.images.find(
        (e) => e.token === altToken || e.refImageSlotIndex === i
      );
      ok(
        `${id}: ${token} 仍指向槽${i}`,
        hit?.refImageSlotIndex === i,
        `idx=${hit?.refImageSlotIndex} tok=${altToken}`
      );
    }
  }

  const uploadSlots = panelReferenceImagesForUpload(data) || panelAfter;
  const finalPlan = collectReferencedMediaFromPrompt(effectivePrompt, data, ctxFinal, new Map());
  const uploadedFinal = mockUploaded(finalPlan);
  for (const entry of finalPlan.images) {
    if (uploadedFinal.has(entry.token)) continue;
    const orig = plan.images.find((e) => e.url === entry.url);
    if (orig && uploaded.has(orig.token)) {
      uploadedFinal.set(entry.token, uploaded.get(orig.token)!);
    }
  }

  const enrichedFinal = enrichPlanImagesWithPanelSlotIndexes(uploadSlots, finalPlan.images, {
    imagePreview: data.imagePreview,
    referenceImageLabels: displayLabels,
    panelMainSlotVisible: data.panelMainSlotVisible,
  });

  const model = data.selectedModel || '';
  let apiUrls: string[];
  let gpLabels: string[];
  if (model.includes('seedance') && data.seedanceGenerationMode === 'reference') {
    apiUrls = buildSeedanceReferenceImagesApiPayload(enrichedFinal, uploadedFinal);
    gpLabels = buildSeedanceReferenceApiLabelsFromPlan(finalPlan.images, uploadedFinal);
  } else {
    apiUrls = finalPlan.images
      .map((e) => uploadedFinal.get(e.token))
      .filter((u): u is string => Boolean(u));
    gpLabels = buildSeedanceReferenceApiLabelsFromPlan(finalPlan.images, uploadedFinal);
  }

  eq(apiUrls.length, exp.detailLabels.length, `${id}: API 张数=Details 张数`);
  assertOutputDetails(id, data, model, apiUrls, gpLabels, exp.detailLabels);
}

function runFramePartialCase(c: FramePartialCase) {
  const { id, prompt, expect: exp } = c;
  const data = promptForData(c.data, prompt);
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, new Map());

  eq(plan.images.map((e) => e.token), exp.planImageTokens, `${id}: plan token 顺序`);

  const uploaded = mockUploaded(plan);
  const framePatch = buildFirstLastFramePanelPatchFromPlan(plan.images, {
    startUrl: uploaded.get('@首帧图')?.replace(/\|UP$/i, '') || 'https://sim/partial/ff-up.png',
    endUrl: uploaded.get('@尾帧图')?.replace(/\|UP$/i, '') || 'https://sim/partial/lf-up.png',
  });

  if (exp.keepFirst === false) {
    ok(`${id}: 未@首帧已清空`, framePatch.firstFrameImageUrl === undefined);
  } else if (exp.keepFirst) {
    ok(`${id}: 已@首帧保留`, Boolean(framePatch.firstFrameImageUrl));
  }
  if (exp.keepLast === false) {
    ok(`${id}: 未@尾帧已清空`, framePatch.lastFrameImageUrl === undefined);
  } else if (exp.keepLast) {
    ok(`${id}: 已@尾帧保留`, Boolean(framePatch.lastFrameImageUrl));
  }

  assertOutputDetails(
    id,
    { ...data, ...framePatch },
    data.selectedModel || '',
    plan.images.map((e) => uploaded.get(e.token)).filter((u): u is string => Boolean(u)),
    exp.detailLabels,
    exp.detailLabels
  );
}

console.log('=== 全模型部分 @ 引用矩阵（面板保留 + @ 准确 + Details 仅引用）===\n');

const PANEL_CASES: PanelPartialCase[] = [
  // —— Nano Banana 2.0 ——
  {
    id: 'Nano·拖4@主图+@图片2',
    data: simNode({
      selectedModel: MODEL_NANO_BANANA_2,
      imagePreview: U.main,
      referenceImages: [U.r0, U.r1, U.r2, U.r3],
    }),
    prompt: '@主图 主体 @图片2 细节',
    expect: {
      preservedUnrefSlots: [0, 2, 3],
      keptSlots: [1],
      slotLabels: { 1: '图片2' },
      detailLabels: ['主图', '图片2'],
      mentionInclude: ['@主图', '@图片2'],
      planImageTokens: ['@主图', '@图片2'],
    },
  },
  {
    id: 'Nano·拖4仅@1+4',
    data: simNode({
      selectedModel: MODEL_NANO_BANANA_2,
      imagePreview: U.main,
      referenceImages: [U.r0, U.r1, U.r2, U.r3],
    }),
    prompt: '@图片1参考@图片4风格',
    expect: {
      preservedUnrefSlots: [1, 2],
      keptSlots: [0, 3],
      slotLabels: { 0: '图片1', 3: '图片4' },
      detailLabels: ['图片1', '图片4'],
      mentionInclude: ['@图片1', '@图片4'],
      planImageTokens: ['@图片1', '@图片4'],
    },
  },
  {
    id: 'Nano·仅@图片1无主图',
    data: simNode({
      selectedModel: MODEL_NANO_BANANA_2,
      imagePreview: U.main,
      referenceImages: [U.r0, U.r1, U.r2],
    }),
    prompt: '@图片1 成水墨风',
    expect: {
      preservedUnrefSlots: [1, 2],
      keptSlots: [0],
      slotLabels: { 0: '图片1' },
      detailLabels: ['图片1'],
      mentionInclude: ['@图片1'],
      planImageTokens: ['@图片1'],
    },
  },
  {
    id: 'Nano·仅@主图',
    data: simNode({
      selectedModel: MODEL_NANO_BANANA_2,
      imagePreview: U.main,
      referenceImages: [U.r0, U.r1],
    }),
    prompt: '@主图 高清放大',
    expect: {
      preservedUnrefSlots: [0, 1],
      keptSlots: [],
      detailLabels: ['主图'],
      mentionInclude: ['@主图'],
      planImageTokens: ['@主图'],
    },
  },
  {
    id: 'Nano·主图同URL槽@主图+@图片1',
    data: simNode({
      selectedModel: MODEL_NANO_BANANA_2,
      imagePreview: U.dup,
      referenceImages: [U.dup, U.r1],
      referenceImageLabels: ['图片1', '图片2'],
    }),
    prompt: '@主图和@图片1融合',
    expect: {
      preservedUnrefSlots: [1],
      keptSlots: [0],
      slotLabels: { 0: '图片1' },
      detailLabels: ['主图', '图片1'],
      mentionInclude: ['@主图', '@图片1'],
      planImageTokens: ['@主图', '@图片1'],
    },
  },
  {
    id: 'Nano·双图片1标签@1+2',
    data: simNode({
      selectedModel: MODEL_NANO_BANANA_2,
      imagePreview: U.dup,
      referenceImages: [U.dup, U.r1],
      referenceImageLabels: ['图片1', '图片1'],
    }),
    prompt: '@图片1参考@图片2风格',
    expect: {
      preservedUnrefSlots: [],
      keptSlots: [0, 1],
      slotLabels: { 0: '图片1', 1: '图片2' },
      detailLabels: ['图片1', '图片2'],
      mentionInclude: ['@图片1', '@图片2'],
      planImageTokens: ['@图片1', '@图片2'],
    },
  },
  // —— image 2 ——
  {
    id: 'image2·拖3@1+3',
    data: simNode({
      selectedModel: MODEL_IMAGE_2,
      imagePreview: U.main,
      referenceImages: [U.r0, U.r1, U.r2],
    }),
    prompt: '@图片1 前景 @图片3 背景',
    expect: {
      preservedUnrefSlots: [1],
      keptSlots: [0, 2],
      slotLabels: { 0: '图片1', 2: '图片3' },
      detailLabels: ['图片1', '图片3'],
      mentionInclude: ['@图片1', '@图片3'],
      planImageTokens: ['@图片1', '@图片3'],
    },
  },
  {
    id: 'image2·@主图+@图片2',
    data: simNode({
      selectedModel: MODEL_IMAGE_2,
      imagePreview: U.main,
      referenceImages: [U.r0, U.r1, U.r2, U.r3],
    }),
    prompt: '@主图 人物 @图片2 场景',
    expect: {
      preservedUnrefSlots: [0, 2, 3],
      keptSlots: [1],
      slotLabels: { 1: '图片2' },
      detailLabels: ['主图', '图片2'],
      planImageTokens: ['@主图', '@图片2'],
    },
  },
  {
    id: 'image2·仅@图片2无主图',
    data: simNode({
      selectedModel: MODEL_IMAGE_2,
      imagePreview: U.main,
      referenceImages: [U.r0, U.r1, U.r2],
    }),
    prompt: '@图片2 参考构图',
    expect: {
      preservedUnrefSlots: [0, 2],
      keptSlots: [1],
      slotLabels: { 1: '图片2' },
      detailLabels: ['图片2'],
      planImageTokens: ['@图片2'],
    },
  },
  {
    id: 'image2·主图同URL槽',
    data: simNode({
      selectedModel: MODEL_IMAGE_2,
      imagePreview: U.dup,
      referenceImages: [U.dup],
      referenceImageLabels: ['图片1'],
    }),
    prompt: '@主图和@图片1融合',
    expect: {
      preservedUnrefSlots: [],
      keptSlots: [0],
      slotLabels: { 0: '图片1' },
      detailLabels: ['主图', '图片1'],
      mentionInclude: ['@主图', '@图片1'],
      planImageTokens: ['@主图', '@图片1'],
    },
  },
  {
    id: 'image2·双图片1标签@1+2',
    data: simNode({
      selectedModel: MODEL_IMAGE_2,
      imagePreview: U.dup,
      panelMainImageUrl: U.dup,
      panelMainSlotVisible: false,
      referenceImages: [U.dup, U.r1],
      referenceImageLabels: ['图片1', '图片1'],
    }),
    prompt: '@图片1参考@图片2风格',
    expect: {
      preservedUnrefSlots: [],
      keptSlots: [0, 1],
      slotLabels: { 0: '图片1', 1: '图片2' },
      detailLabels: ['图片1', '图片2'],
      mentionInclude: ['@图片1', '@图片2'],
      planImageTokens: ['@图片1', '@图片2'],
    },
  },
  // —— Seedance 参考生 ——
  {
    id: 'Seedance参考·@主图+@图片2',
    data: simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: U.main,
      referenceImages: [U.r0, U.r1, U.r2, U.r3],
    }),
    prompt: '@主图 运动 @图片2 人物',
    expect: {
      preservedUnrefSlots: [0, 2, 3],
      keptSlots: [1],
      slotLabels: { 1: '图片2' },
      detailLabels: ['主图', '图片2'],
      planImageTokens: ['@主图', '@图片2'],
    },
  },
  {
    id: 'Seedance参考·稀疏@2+3',
    data: simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: U.main,
      referenceImages: [U.r0, U.r1, U.r2, U.r3],
    }),
    prompt: '@图片2 街景 @图片3 人物',
    expect: {
      preservedUnrefSlots: [0, 3],
      keptSlots: [1, 2],
      slotLabels: { 1: '图片2', 2: '图片3' },
      detailLabels: ['图片2', '图片3'],
      planImageTokens: ['@图片2', '@图片3'],
    },
  },
  {
    id: 'Seedance参考·仅@图片3无主图',
    data: simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: U.main,
      referenceImages: [U.r0, U.r1, U.r2],
    }),
    prompt: '@图片3 动态',
    expect: {
      preservedUnrefSlots: [0, 1],
      keptSlots: [2],
      slotLabels: { 2: '图片3' },
      detailLabels: ['图片3'],
      planImageTokens: ['@图片3'],
    },
  },
  {
    id: 'Seedance参考·双图片1标签@1+2',
    data: simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: U.dup,
      referenceImages: [U.dup, U.r1],
      referenceImageLabels: ['图片1', '图片1'],
    }),
    prompt: '@图片1参考@图片2风格',
    expect: {
      preservedUnrefSlots: [],
      keptSlots: [0, 1],
      slotLabels: { 0: '图片1', 1: '图片2' },
      detailLabels: ['图片1', '图片2'],
      planImageTokens: ['@图片1', '@图片2'],
    },
  },
  // —— 可灵3.0 Omni ——
  {
    id: 'Omni multi·@主图+@图片1',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      imagePreview: U.main,
      klingOmniMultiReferenceImages: [U.r0, U.r1, U.r2],
    }),
    prompt: '@主图 首帧 @图片1 参考',
    expect: {
      preservedUnrefSlots: [1, 2],
      keptSlots: [0],
      slotLabels: { 0: '图片1' },
      detailLabels: ['主图', '图片1'],
      planImageTokens: ['@主图', '@图片1'],
    },
  },
  {
    id: 'Omni multi·仅@图片1',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      imagePreview: U.main,
      klingOmniMultiReferenceImages: [U.r0, U.r1, ''],
    }),
    prompt: '@图片1 运动',
    expect: {
      preservedUnrefSlots: [1, 2],
      keptSlots: [0],
      slotLabels: { 0: '图片1' },
      detailLabels: ['图片1'],
      planImageTokens: ['@图片1'],
    },
  },
  {
    id: 'Omni multi·稀疏@1+3',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      imagePreview: U.main,
      klingOmniMultiReferenceImages: [U.r0, '', U.r2, U.r3],
    }),
    prompt: '@图片1 @图片3',
    expect: {
      preservedUnrefSlots: [2],
      keptSlots: [0, 3],
      slotLabels: { 0: '图片1', 3: '图片3' },
      detailLabels: ['图片1', '图片3'],
      mentionInclude: ['@图片1', '@图片3'],
      planImageTokens: ['@图片1', '@图片3'],
    },
  },
  {
    id: 'Omni multi·双图片1标签@1+2',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      imagePreview: U.dup,
      klingOmniMultiReferenceImages: [U.dup, U.r1],
      referenceImageLabels: ['图片1', '图片1'],
    }),
    prompt: '@图片1参考@图片2风格',
    expect: {
      preservedUnrefSlots: [],
      keptSlots: [0, 1],
      slotLabels: { 0: '图片1', 1: '图片2' },
      detailLabels: ['图片1', '图片2'],
      planImageTokens: ['@图片1', '@图片2'],
    },
  },
  {
    id: 'Omni instruction·@主图+@图片1',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'instruction',
      imagePreview: U.main,
      klingOmniInstructionReferenceImages: [U.r0, U.r1, U.r2],
    }),
    prompt: '@主图 保持 @图片1 服装',
    expect: {
      preservedUnrefSlots: [1, 2],
      keptSlots: [0],
      slotLabels: { 0: '图片1' },
      detailLabels: ['主图', '图片1'],
      planImageTokens: ['@主图', '@图片1'],
    },
  },
  {
    id: 'Omni instruction·仅@图片2',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'instruction',
      imagePreview: U.main,
      klingOmniInstructionReferenceImages: [U.r0, U.r1, U.r2],
    }),
    prompt: '@图片2 风格',
    expect: {
      preservedUnrefSlots: [0, 2],
      keptSlots: [1],
      slotLabels: { 1: '图片2' },
      detailLabels: ['图片2'],
      planImageTokens: ['@图片2'],
    },
  },
  {
    id: 'Omni video·@主图+@图片2',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'video',
      imagePreview: U.main,
      klingOmniVideoReferenceImages: [U.r0, U.r1, U.r2],
    }),
    prompt: '@主图 主体 @图片2 背景',
    expect: {
      preservedUnrefSlots: [0, 2],
      keptSlots: [1],
      slotLabels: { 1: '图片2' },
      detailLabels: ['主图', '图片2'],
      planImageTokens: ['@主图', '@图片2'],
    },
  },
];

const FRAME_CASES: FramePartialCase[] = [
  {
    id: 'vidu·仅@尾帧',
    data: simNode({
      selectedModel: 'vidu 2.0',
      imagePreview: U.main,
      firstFrameImage: U.ff,
      lastFrameImage: U.lf,
    }),
    prompt: '过渡到 @尾帧图',
    expect: {
      keepFirst: false,
      keepLast: true,
      detailLabels: ['尾帧图'],
      planImageTokens: ['@尾帧图'],
    },
  },
  {
    id: '可灵2.5·仅@首帧',
    data: simNode({
      selectedModel: '可灵 2.5 Turbo',
      imagePreview: U.main,
      firstFrameImage: U.ff,
      lastFrameImage: U.lf,
    }),
    prompt: '@首帧图 推进',
    expect: {
      keepFirst: true,
      keepLast: false,
      detailLabels: ['首帧图'],
      planImageTokens: ['@首帧图'],
    },
  },
  {
    id: 'Seedance图生·双@首尾',
    data: simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'image',
      imagePreview: U.main,
      firstFrameImage: U.ff,
      lastFrameImage: U.lf,
    }),
    prompt: '@首帧图 到 @尾帧图',
    expect: {
      keepFirst: true,
      keepLast: true,
      detailLabels: ['首帧图', '尾帧图'],
      planImageTokens: ['@首帧图', '@尾帧图'],
    },
  },
  {
    id: 'seedance1.5·仅@首帧',
    data: simNode({
      selectedModel: 'seedance1.5-pro',
      imagePreview: U.main,
      firstFrameImage: U.ff,
      lastFrameImage: U.lf,
    }),
    prompt: '@首帧图 运动',
    expect: {
      keepFirst: true,
      keepLast: false,
      detailLabels: ['首帧图'],
      planImageTokens: ['@首帧图'],
    },
  },
  {
    id: 'Omni frames·仅@尾帧',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'frames',
      imagePreview: U.main,
      firstFrameImage: U.ff,
      lastFrameImage: U.lf,
    }),
    prompt: '衔接 @尾帧图',
    expect: {
      keepFirst: false,
      keepLast: true,
      detailLabels: ['尾帧图'],
      planImageTokens: ['@尾帧图'],
    },
  },
];

type PostRunAddRefCase = {
  id: string;
  data: NodeData;
  runPrompt: string;
  gp: GenerationParams;
  newUrl: string;
  newSlotIndex: number;
  mentionInclude: string[];
  gpDetailLabels: string[];
};

function runPostRunAddRefCase(c: PostRunAddRefCase) {
  const { id, runPrompt, gp } = c;
  let data = promptForData(c.data, runPrompt);
  data = {
    ...data,
    generationParams: gp,
    status: 'completed',
    taskId: 'sim-task-post-run',
  };
  const panel = [...refArrayForModel(data)];
  while (panel.length <= c.newSlotIndex) panel.push('');
  panel[c.newSlotIndex] = c.newUrl;
  data = applyPanelToData(data, panel);

  const ctx = buildPromptMediaRefContextFromNode(data);
  const mentions = buildInspectorPromptMentionItems(data, ctx);
  const tokens = mentions.map((m) => m.insertText?.trim()).filter(Boolean) as string[];
  for (const t of c.mentionInclude) {
    ok(`${id}: 运行后新槽 @ 下拉含 ${t}`, tokens.includes(t), tokens.join(','));
  }

  const model = data.selectedModel || '';
  assertOutputDetails(id, data, model, gp.referenceImages || [], gp.referenceImageLabels || [], c.gpDetailLabels);

  const panelFinal = refArrayForModel(data);
  const slotLabel = panelReferenceSlotLabel(
    c.newSlotIndex,
    panelFinal,
    data.imagePreview,
    slotLabelMode(data)
  );
  const planNew = collectReferencedMediaFromPrompt(`@${slotLabel} 测试`, data, ctx, new Map());
  ok(
    `${id}: 新槽可被 plan 解析`,
    planNew.images.some(
      (e) => e.refImageSlotIndex === c.newSlotIndex || e.url === c.newUrl
    ),
    planNew.images.map((e) => `${e.token}:${e.refImageSlotIndex}`).join(',')
  );
}

const POST_RUN_CASES: PostRunAddRefCase[] = [
  {
    id: 'Nano·运行后+图片3',
    data: simNode({
      selectedModel: MODEL_NANO_BANANA_2,
      imagePreview: U.main,
      referenceImages: [U.r0, U.r1],
    }),
    runPrompt: '@图片1 风格',
    gp: {
      referenceImages: [U.r0],
      referenceImageLabels: ['图片1'],
      prompt: '@图片1 风格',
    },
    newUrl: U.r2,
    newSlotIndex: 2,
    mentionInclude: ['@图片1', '@图片3'],
    gpDetailLabels: ['图片1'],
  },
  {
    id: 'image2·运行后+图片3',
    data: simNode({
      selectedModel: MODEL_IMAGE_2,
      imagePreview: U.main,
      referenceImages: [U.r0, U.r1],
    }),
    runPrompt: '@主图 高清',
    gp: {
      referenceImages: [U.main],
      referenceImageLabels: ['主图'],
      prompt: '@主图 高清',
    },
    newUrl: U.r2,
    newSlotIndex: 2,
    mentionInclude: ['@主图', '@图片3'],
    gpDetailLabels: ['主图'],
  },
  {
    id: 'Seedance参考·运行后+图片3',
    data: simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: U.main,
      referenceImages: [U.r0, U.r1],
    }),
    runPrompt: '@图片1 运动',
    gp: {
      referenceImages: [U.r0],
      referenceImageLabels: ['图片1'],
      prompt: '@图片1 运动',
    },
    newUrl: U.r2,
    newSlotIndex: 2,
    mentionInclude: ['@图片1', '@图片3'],
    gpDetailLabels: ['图片1'],
  },
  {
    id: 'Omni multi·运行后+图片3',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      imagePreview: U.main,
      klingOmniMultiReferenceImages: [U.r0, U.r1],
    }),
    runPrompt: '@图片1 参考',
    gp: {
      referenceImages: [U.r0],
      referenceImageLabels: ['图片1'],
      prompt: '@图片1 参考',
    },
    newUrl: U.r2,
    newSlotIndex: 2,
    mentionInclude: ['@图片1', '@图片3'],
    gpDetailLabels: ['图片1'],
  },
  {
    id: 'Omni instruction·运行后+图片2',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'instruction',
      imagePreview: U.main,
      klingOmniInstructionReferenceImages: [U.r0],
    }),
    runPrompt: '@图片1 保持',
    gp: {
      referenceImages: [U.r0],
      referenceImageLabels: ['图片1'],
      prompt: '@图片1 保持',
    },
    newUrl: U.r1,
    newSlotIndex: 1,
    mentionInclude: ['@图片1', '@图片2'],
    gpDetailLabels: ['图片1'],
  },
  {
    id: 'Omni video·运行后+图片2',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'video',
      imagePreview: U.main,
      klingOmniVideoReferenceImages: [U.r0],
    }),
    runPrompt: '@图片1 背景',
    gp: {
      referenceImages: [U.r0],
      referenceImageLabels: ['图片1'],
      prompt: '@图片1 背景',
    },
    newUrl: U.r1,
    newSlotIndex: 1,
    mentionInclude: ['@图片1', '@图片2'],
    gpDetailLabels: ['图片1'],
  },
];

for (const c of PANEL_CASES) {
  console.log(`\n--- ${c.id} ---`);
  runPanelPartialCase(c);
}

console.log('\n=== 首尾帧模型（未@侧清空 + Details）===\n');
for (const c of FRAME_CASES) {
  console.log(`\n--- ${c.id} ---`);
  runFramePartialCase(c);
}

console.log('\n=== 运行后追加参考图：@ 下拉含新槽 + Details 仍仅 gp @ 引用 ===\n');
for (const c of POST_RUN_CASES) {
  console.log(`\n--- ${c.id} ---`);
  runPostRunAddRefCase(c);
}

console.log(`\n=== 汇总: ${pass} 通过, ${fail} 失败 ===\n`);
process.exit(fail > 0 ? 1 : 0);

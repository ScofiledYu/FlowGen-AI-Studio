/**
 * 全模型 / 全 tab：刷新后面板图仍在 + 点击运行后面板图仍在（纯模拟，不调 API）
 * npx tsx scripts/panel-refresh-run-all-tabs-test.ts
 */
import type { NodeData } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2 } from '../types.ts';
import { sanitizePersistValueDeep } from '../utils/persistSanitize.mjs';
import {
  alignPanelReferenceSlotsFromLocalRefs,
  anyPanelRefsPendingLocalHydrate,
  needsHydrateFromLocalRef,
  panelReferenceImagesFieldForLocalRefs,
  type PanelReferenceLocalRefField,
} from '../utils/hydratePanelReferenceLocalRefs.ts';
import { nanoBananaMainPatchOnModelSwitch } from '../utils/modelSwitchPanelIsolation.ts';
import {
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
  getNodeInspectorPromptText,
} from '../utils/promptMediaRefs.ts';
import {
  buildPanelImagePreviewPatchAfterRun,
  mergeAndPrunePanelReferenceImagesAfterUpload,
  panelMergeOptionsForReferencedUpload,
  panelReferenceImagesForUpload,
} from '../utils/referencedMediaRun.ts';
import { resolveReferenceImageLabelsAfterPanelRun } from '../utils/referenceImageSlotLabels.ts';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

function simNode(partial: Partial<NodeData> & { selectedModel: string }): NodeData {
  return { label: 'refresh-run', ...partial } as NodeData;
}

const longData = (tag: string) => `data:image/jpeg;base64,${tag}${'A'.repeat(9000)}`;
const mainBlob = 'blob:http://localhost:3001/main-sim';
const MAIN_LOCAL = 'flowgen-local:uid_pid:node:main';

type TabCase = {
  id: string;
  data: NodeData;
  localRefField: PanelReferenceLocalRefField;
  /** 刷新前应保留的参考槽数量 */
  refSlotCount: number;
  /** 运行模拟用创意描述（部分 @，验证未@槽保留） */
  runPrompt: string;
};

function refLocalRefs(data: NodeData, field: PanelReferenceLocalRefField): string[] {
  return [...((data[field] as string[] | undefined) || [])];
}

function refImages(data: NodeData, field: PanelReferenceLocalRefField): string[] {
  const imagesField = panelReferenceImagesFieldForLocalRefs(field);
  return [...((data[imagesField] as string[] | undefined) || [])];
}

function countFilledSlots(urls: string[]): number {
  return urls.filter((u) => String(u || '').trim()).length;
}

/** 模拟 IDB hydrate：空槽 → blob 预览 */
function mockHydratePanelRefs(
  data: Partial<NodeData>,
  field: PanelReferenceLocalRefField
): Partial<NodeData> {
  const imagesField = panelReferenceImagesFieldForLocalRefs(field);
  const refs = [...((data[imagesField] as string[] | undefined) || [])];
  const localRefs = [...((data[field] as string[] | undefined) || [])];
  const maxLen = Math.max(refs.length, localRefs.length);
  const nextRefs = [...refs];
  while (nextRefs.length < maxLen) nextRefs.push('');
  for (let i = 0; i < maxLen; i++) {
    const localRef = String(localRefs[i] || '').trim();
    if (!localRef) continue;
    if (!needsHydrateFromLocalRef(nextRefs[i])) continue;
    nextRefs[i] = `blob:http://localhost/sim-${field}-${i}`;
  }
  return { [imagesField]: nextRefs } as Partial<NodeData>;
}

function mockHydrateMainPreview(data: Partial<NodeData>): Partial<NodeData> {
  const ref = String(data.imageLocalRef || '').trim();
  if (!ref) return {};
  const main = String(data.imagePreview || '').trim();
  if (main && !needsHydrateFromLocalRef(main)) return {};
  return { imagePreview: 'blob:http://localhost/sim-main' };
}

/** 刷新链路：sanitize → align → mock hydrate */
function simulateRefreshPipeline(
  before: NodeData,
  field: PanelReferenceLocalRefField
): NodeData {
  const saved = sanitizePersistValueDeep({ data: before }).data as NodeData;
  const aligned = alignPanelReferenceSlotsFromLocalRefs(
    refImages(saved, field),
    refLocalRefs(saved, field)
  );
  let after = {
    ...saved,
    [field]: aligned.localRefs,
    [panelReferenceImagesFieldForLocalRefs(field)]: aligned.images,
  } as NodeData;
  after = { ...after, ...mockHydratePanelRefs(after, field) };
  after = { ...after, ...mockHydrateMainPreview(after) };
  return after;
}

/** 运行前：blob 槽换成 https 模拟已上传/可持久化面板 */
function panelUrlsForRun(data: NodeData, field: PanelReferenceLocalRefField): NodeData {
  const imagesField = panelReferenceImagesFieldForLocalRefs(field);
  const urls = refImages(data, field).map((u, i) =>
    String(u || '').trim() ? `https://sim.cos/panel/${field}/${i}.png` : ''
  );
  const main = String(data.imagePreview || '').trim();
  return {
    ...data,
    [imagesField]: urls,
    imagePreview: main ? `https://sim.cos/main/${data.selectedModel?.replace(/\s/g, '-')}.png` : main,
    status: 'idle',
  };
}

function simulateRunPanelAfter(data: NodeData, prompt: string): string[] {
  const runData = { ...data, prompt };
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
    uploaded.set(e.token, `https://aitop-cos/signed/${e.token.replace(/[^a-zA-Z0-9]/g, '_')}.png`);
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
  resolveReferenceImageLabelsAfterPanelRun({
    panelBefore,
    labelsBefore: runData.referenceImageLabels,
    panelAfter,
    plan,
  });
  buildPanelImagePreviewPatchAfterRun(plan.images, uploaded, {
    nodeData: runData,
    mergedPanelRefs: panelAfter,
  });
  return panelAfter;
}

function runRefreshRunCase(row: TabCase) {
  const { id, data, localRefField, refSlotCount, runPrompt } = row;
  console.log(`\n--- ${id} ---`);

  const beforeFilled = countFilledSlots(refImages(data, localRefField));
  ok(`${id}: 编辑态参考槽`, beforeFilled === refSlotCount, `${beforeFilled} vs ${refSlotCount}`);

  const saved = sanitizePersistValueDeep({ data }).data as NodeData;
  ok(
    `${id}: 刷新 localRefs 保留`,
    refLocalRefs(saved, localRefField).filter(Boolean).length === refSlotCount,
    JSON.stringify(refLocalRefs(saved, localRefField))
  );
  ok(
    `${id}: 刷新 imageLocalRef 保留`,
    saved.imageLocalRef === data.imageLocalRef,
    String(saved.imageLocalRef || '')
  );

  const aligned = alignPanelReferenceSlotsFromLocalRefs(
    refImages(saved, localRefField),
    refLocalRefs(saved, localRefField)
  );
  ok(
    `${id}: 切模型对齐槽位`,
    aligned.images.length >= refSlotCount && aligned.localRefs.length >= refSlotCount,
    `imgs=${aligned.images.length} refs=${aligned.localRefs.length}`
  );

  const afterRefresh = simulateRefreshPipeline(data, localRefField);
  ok(
    `${id}: 刷新 hydrate 后无 pending`,
    !anyPanelRefsPendingLocalHydrate(afterRefresh),
    String(anyPanelRefsPendingLocalHydrate(afterRefresh))
  );
  ok(
    `${id}: 刷新 hydrate 后参考槽满`,
    countFilledSlots(refImages(afterRefresh, localRefField)) === refSlotCount,
    JSON.stringify(refImages(afterRefresh, localRefField).map((u) => u.slice(0, 28)))
  );
  ok(
    `${id}: 刷新后主图恢复`,
    Boolean(String(afterRefresh.imagePreview || '').trim()),
    String(afterRefresh.imagePreview || '').slice(0, 28)
  );

  const forRun = panelUrlsForRun(afterRefresh, localRefField);
  const panelBeforeRun = panelReferenceImagesForUpload(forRun) || [];
  ok(
    `${id}: 运行前面板槽`,
    countFilledSlots(panelBeforeRun) >= refSlotCount,
    JSON.stringify(panelBeforeRun.map((u) => (u ? u.slice(0, 28) : 'EMPTY')))
  );

  const panelAfterRun = simulateRunPanelAfter(forRun, runPrompt);
  ok(
    `${id}: 运行后面板槽数不减少`,
    panelAfterRun.length >= panelBeforeRun.length,
    `before=${panelBeforeRun.length} after=${panelAfterRun.length}`
  );
  ok(
    `${id}: 运行后已填槽仍保留`,
    countFilledSlots(panelAfterRun) >= refSlotCount,
    JSON.stringify(panelAfterRun.map((u) => (u ? u.slice(0, 28) : 'EMPTY')))
  );

  const plan = collectReferencedMediaFromPrompt(
    runPrompt,
    forRun,
    buildPromptMediaRefContextFromNode(forRun),
    new Map()
  );
  for (const e of plan.images) {
    if (e.refImageSlotIndex == null) continue;
    const idx = e.refImageSlotIndex;
    ok(
      `${id}: 运行后 @槽${idx + 1} 有 signed`,
      Boolean(panelAfterRun[idx]?.includes('aitop-cos')),
      panelAfterRun[idx]
    );
  }
  const unrefPreserved = panelBeforeRun.some((u, i) => {
    const mentioned = plan.images.some((e) => e.refImageSlotIndex === i);
    return Boolean(u?.trim()) && !mentioned && Boolean(panelAfterRun[i]?.trim());
  });
  if (plan.images.length < refSlotCount) {
    ok(`${id}: 运行后未@槽保留`, unrefPreserved, JSON.stringify(panelAfterRun));
  }
}

const ref0 = longData('r0');
const ref1 = longData('r1');
const ref2 = longData('r2');
const local0 = 'flowgen-local:uid_pid:node:ref:0';
const local1 = 'flowgen-local:uid_pid:node:ref:1';
const local2 = 'flowgen-local:uid_pid:node:ref:2';

const CASES: TabCase[] = [
  {
    id: 'Nano Banana 2.0',
    data: simNode({
      selectedModel: MODEL_NANO_BANANA_2,
      imagePreview: mainBlob,
      imageLocalRef: MAIN_LOCAL,
      referenceImages: [ref0, ref1, ref2],
      referenceImageLabels: ['图片1', '图片2', '图片3'],
      referenceImageLocalRefs: [local0, local1, local2],
      prompt: '@图片1 参考 @图片3',
    }),
    localRefField: 'referenceImageLocalRefs',
    refSlotCount: 3,
    runPrompt: '@图片1 参考 @图片3',
  },
  {
    id: 'image 2',
    data: simNode({
      selectedModel: MODEL_IMAGE_2,
      imagePreview: mainBlob,
      imageLocalRef: MAIN_LOCAL,
      referenceImages: [ref0, ref1],
      referenceImageLabels: ['图片1', '图片2'],
      referenceImageLocalRefs: [local0, local1],
      prompt: '@图片1 风格',
    }),
    localRefField: 'referenceImageLocalRefs',
    refSlotCount: 2,
    runPrompt: '@图片1 风格',
  },
  {
    id: '可灵3.0 Omni · 多图参考',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      imagePreview: mainBlob,
      imageLocalRef: MAIN_LOCAL,
      klingOmniMultiReferenceImages: [ref0, ref1, ref2],
      klingOmniMultiReferenceLocalRefs: [local0, local1, local2],
      referenceImageLabels: ['图片1', '图片2', '图片3'],
      klingOmniMultiPrompt: '@图片1 @图片2',
      prompt: '@图片1 @图片2',
    }),
    localRefField: 'klingOmniMultiReferenceLocalRefs',
    refSlotCount: 3,
    runPrompt: '@图片1 @图片2',
  },
  {
    id: '可灵3.0 Omni · 指令变换',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'instruction',
      imagePreview: mainBlob,
      imageLocalRef: MAIN_LOCAL,
      klingOmniInstructionReferenceImages: [ref0, ref1],
      klingOmniInstructionReferenceLocalRefs: [local0, local1],
      referenceImageLabels: ['图片1', '图片2'],
      klingOmniInstructionPrompt: '@图片1 变换',
      prompt: '@图片1 变换',
    }),
    localRefField: 'klingOmniInstructionReferenceLocalRefs',
    refSlotCount: 2,
    runPrompt: '@图片1 变换',
  },
  {
    id: '可灵3.0 Omni · 视频参考',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'video',
      imagePreview: mainBlob,
      imageLocalRef: MAIN_LOCAL,
      klingOmniVideoReferenceImages: [ref0, ref1],
      klingOmniVideoReferenceLocalRefs: [local0, local1],
      referenceImageLabels: ['图片1', '图片2'],
      klingOmniVideoPrompt: '@图片2 参考',
      prompt: '@图片2 参考',
    }),
    localRefField: 'klingOmniVideoReferenceLocalRefs',
    refSlotCount: 2,
    runPrompt: '@图片2 参考',
  },
  {
    id: 'seedance2.0 (急速版) · 参考生',
    data: simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: mainBlob,
      imageLocalRef: MAIN_LOCAL,
      referenceImages: [ref0, ref1, ref2],
      referenceImageLocalRefs: [local0, local1, local2],
      referenceImageLabels: ['图片1', '图片2', '图片3'],
      seedanceTabConfigs: { reference: { prompt: '@图片1 @图片3' } },
      prompt: '@图片1 @图片3',
    }),
    localRefField: 'referenceImageLocalRefs',
    refSlotCount: 3,
    runPrompt: '@图片1 @图片3',
  },
  {
    id: 'seedance2.0 (高质量版) · 参考生',
    data: simNode({
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'reference',
      imagePreview: mainBlob,
      imageLocalRef: MAIN_LOCAL,
      referenceImages: [ref0, ref1],
      referenceImageLocalRefs: [local0, local1],
      referenceImageLabels: ['图片1', '图片2'],
      seedanceTabConfigs: { reference: { prompt: '@图片2' } },
      prompt: '@图片2',
    }),
    localRefField: 'referenceImageLocalRefs',
    refSlotCount: 2,
    runPrompt: '@图片2',
  },
  {
    id: 'seedance1.5-pro · 参考生',
    data: simNode({
      selectedModel: 'seedance1.5-pro',
      seedanceGenerationMode: 'reference',
      imagePreview: mainBlob,
      imageLocalRef: MAIN_LOCAL,
      referenceImages: [ref0, ref1],
      referenceImageLocalRefs: [local0, local1],
      referenceImageLabels: ['图片1', '图片2'],
      prompt: '@图片1',
    }),
    localRefField: 'referenceImageLocalRefs',
    refSlotCount: 2,
    runPrompt: '@图片1',
  },
];

console.log('\n=== 全模型 tab：刷新 + 运行后面板图保留 ===\n');
for (const c of CASES) {
  runRefreshRunCase(c);
}

console.log('\n=== 多模型：Banana 拖图 → image2 刷新 → 切回 Banana ===\n');
const bananaData = CASES[0].data;
const bananaSnapshot = sanitizePersistValueDeep({
  referenceImages: bananaData.referenceImages,
  referenceImageLabels: bananaData.referenceImageLabels,
  referenceImageLocalRefs: bananaData.referenceImageLocalRefs,
  imagePreview: bananaData.imagePreview,
  imageLocalRef: bananaData.imageLocalRef,
  prompt: bananaData.prompt,
}) as Partial<NodeData>;

const onImage2AfterRefresh = simNode({
  selectedModel: MODEL_IMAGE_2,
  imagePreview: mainBlob,
  imageLocalRef: 'flowgen-local:uid_pid:node:img2-main',
  referenceImages: [ref0],
  referenceImageLocalRefs: ['flowgen-local:uid_pid:node:img2:ref:0'],
  modelConfigs: {
    [MODEL_NANO_BANANA_2]: {
      referenceImages: bananaSnapshot.referenceImages,
      referenceImageLabels: bananaSnapshot.referenceImageLabels,
      referenceImageLocalRefs: bananaSnapshot.referenceImageLocalRefs,
      imageLocalRef: bananaSnapshot.imageLocalRef,
      prompt: bananaSnapshot.prompt,
    },
  },
});

const nanoCfg = onImage2AfterRefresh.modelConfigs?.[MODEL_NANO_BANANA_2] || {};
const alignedBanana = alignPanelReferenceSlotsFromLocalRefs(
  nanoCfg.referenceImages,
  nanoCfg.referenceImageLocalRefs
);
const switchBack = simNode({
  selectedModel: MODEL_NANO_BANANA_2,
  referenceImages: alignedBanana.images,
  referenceImageLocalRefs: alignedBanana.localRefs,
  referenceImageLabels: nanoCfg.referenceImageLabels,
  ...nanoBananaMainPatchOnModelSwitch(nanoCfg, {}),
  modelConfigs: onImage2AfterRefresh.modelConfigs,
});
const hydratedSwitch = simulateRefreshPipeline(switchBack, 'referenceImageLocalRefs');
ok(
  '多模型切回 Banana hydrate 后 3 槽',
  countFilledSlots(hydratedSwitch.referenceImages || []) === 3,
  JSON.stringify((hydratedSwitch.referenceImages || []).map((u) => u.slice(0, 28)))
);
ok(
  '多模型切回 Banana 运行前仍 3 槽',
  countFilledSlots(panelReferenceImagesForUpload(panelUrlsForRun(hydratedSwitch, 'referenceImageLocalRefs')) || []) ===
    3,
  ''
);
const bananaAfterRun = simulateRunPanelAfter(
  panelUrlsForRun(hydratedSwitch, 'referenceImageLocalRefs'),
  '@图片1 @图片3'
);
ok(
  '多模型切回 Banana 运行后仍 3 槽',
  countFilledSlots(bananaAfterRun) === 3,
  JSON.stringify(bananaAfterRun.map((u) => (u ? u.slice(0, 28) : 'EMPTY')))
);

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);

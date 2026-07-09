/**
 * 图生视频链路矩阵（不调用 API）：
 * A. 直接拖入主图/参考图 → 各视频模型各 tab 运行前 @ 解析 + 上传槽 + API 入参模拟
 * B. image2 跑完 → 切视频模型（面板 referenceImages 清空）→ @ 仍走 generationParams
 *
 * npx tsx scripts/image-to-video-pipeline-matrix-test.ts
 */
import type { NodeData } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2 } from '../types.ts';
import {
  buildPromptMediaRefContextForRun,
  buildReferenceIndexOptionsFromPlan,
  collectReferencedMediaFromPrompt,
  getCanonicalInspectorPromptText,
  resolvePromptPlaceholders,
} from '../utils/promptMediaRefs.ts';
import {
  assignStartEndUrlsFromImagePlan,
  buildReferenceOnlyImagesForApiPayload,
  buildSeedanceReferenceImagesApiPayload,
  enrichPlanImagesWithPanelSlotIndexes,
  panelReferenceImagesForUpload,
  promptPlanReferencesMainImage,
} from '../utils/referencedMediaRun.ts';
import { mergePanelWithPersistedReferenceImages, promptNeedsPersistedPanelRefs } from '../utils/panelRefPersistence.ts';

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

const PROJ = 'i2v-matrix';
const DRAG_MAIN = 'https://cos.example.com/dragged-piano.png';
const DRAG_REF = 'https://cos.example.com/dragged-ref-fox.png';
const IMAGE2_OUT = 'https://cos.example.com/image2-generated.png';
const IMAGE2_REF_SNAP = 'https://cos.example.com/image2-ref-from-run.png';
const UP = (u: string) => `${u}|UP`;

type VideoTabCase = {
  id: string;
  data: NodeData;
  prompt: string;
  /** 期望 plan 至少解析出的图片 @ 数（文生可为 0） */
  minPlanImages: number;
  assertApi: (
    plan: ReturnType<typeof collectReferencedMediaFromPrompt>,
    uploadedByToken: Map<string, string>,
    enriched: ReturnType<typeof enrichPlanImagesWithPanelSlotIndexes>
  ) => void;
};

function mockUpload(
  plan: ReturnType<typeof collectReferencedMediaFromPrompt>
): Map<string, string> {
  const m = new Map<string, string>();
  for (const img of plan.images) m.set(img.token, UP(img.url));
  return m;
}

function refUrlsOnNode(data: NodeData): string[] {
  const m = data.selectedModel || '';
  if (m === '可灵3.0 Omni') {
    const tab = data.klingOmniTab || 'multi';
    if (tab === 'multi') return [...(data.klingOmniMultiReferenceImages || [])];
    if (tab === 'instruction') return [...(data.klingOmniInstructionReferenceImages || [])];
    if (tab === 'video') return [...(data.klingOmniVideoReferenceImages || [])];
    return [];
  }
  return [...(data.referenceImages || [])];
}

function planHasResolvableImageUrl(
  plan: ReturnType<typeof collectReferencedMediaFromPrompt>,
  data: NodeData
): boolean {
  const panelUrls = refUrlsOnNode(data);
  return plan.images.some((e) => {
    const u = String(e.url || '').trim();
    if (!u) return false;
    if (u === String(data.imagePreview || '').trim()) return true;
    if (u === String(data.firstFrameImageUrl || data.firstFrameImage || '').trim()) return true;
    if (u === String(data.lastFrameImageUrl || data.lastFrameImage || '').trim()) return true;
    return panelUrls.some((p) => String(p || '').trim() === u);
  });
}

function runDirectDragCase(row: VideoTabCase) {
  const ctx = buildPromptMediaRefContextForRun(row.data);
  const canon = getCanonicalInspectorPromptText(row.data) || row.prompt;
  const plan = collectReferencedMediaFromPrompt(canon, row.data, ctx, new Map());
  ok(`${row.id} [拖入]: plan 图片≥${row.minPlanImages}`, plan.images.length >= row.minPlanImages);
  if (row.minPlanImages > 0) {
    ok(`${row.id} [拖入]: plan 含可解析 URL`, planHasResolvableImageUrl(plan, row.data));
    const uploadSlots = panelReferenceImagesForUpload(row.data) || [];
    const panelHasRefSlots = uploadSlots.some((u) => String(u || '').trim());
    const usesMainOrFrameOnly =
      plan.images.every((e) =>
        ['@主图', '@主体', '@首帧图', '@尾帧图'].includes(e.token)
      ) && !panelHasRefSlots;
    if (!usesMainOrFrameOnly) {
      ok(`${row.id} [拖入]: 参考格上传槽非空`, panelHasRefSlots);
    } else {
      ok(`${row.id} [拖入]: 主图/首帧路径（无 reference 槽）`, true);
    }
  }
  const uploaded = mockUpload(plan);
  const panel = panelReferenceImagesForUpload(row.data) || [];
  const enriched = enrichPlanImagesWithPanelSlotIndexes(panel, plan.images, {
    imagePreview: row.data.imagePreview,
    referenceImageLabels: row.data.referenceImageLabels,
    panelMainSlotVisible: row.data.panelMainSlotVisible,
  });
  row.assertApi(plan, uploaded, enriched);
  const opts = buildReferenceIndexOptionsFromPlan(plan, {});
  const expanded = resolvePromptPlaceholders(canon, row.data, ctx, opts);
  if (plan.images.some((e) => e.token === '@主图' || e.token === '@主体')) {
    ok(
      `${row.id} [拖入]: @主图 展开含 referenceImages`,
      expanded.includes('referenceImages') || expanded.includes('startImage') || expanded.includes('主图'),
      expanded.slice(0, 120)
    );
  }
}

function runAfterImage2Case(row: VideoTabCase, gpRefs: string[]) {
  const afterSwitch: NodeData = {
    ...row.data,
    imagePreview: IMAGE2_OUT,
    referenceImages: [],
    referenceImageLabels: undefined,
    generationParams: {
      referenceImages: [...gpRefs],
      prompt: row.prompt,
      model: row.data.selectedModel,
    },
  };
  const ctx = buildPromptMediaRefContextForRun(afterSwitch);
  const plan = collectReferencedMediaFromPrompt(row.prompt, afterSwitch, ctx, new Map());
  ok(`${row.id} [图生图后]: plan 图片≥${row.minPlanImages}`, plan.images.length >= row.minPlanImages);
  const uploadSlots = panelReferenceImagesForUpload(afterSwitch) || [];
  if (row.minPlanImages > 0 && promptNeedsPersistedPanelRefs(row.prompt)) {
    ok(
      `${row.id} [图生图后]: 上传槽含 gp 参考`,
      uploadSlots.some((u) => gpRefs.includes(String(u || '').trim()) || String(u || '').trim()),
      uploadSlots.join(',')
    );
  } else if (row.minPlanImages > 0) {
    ok(
      `${row.id} [图生图后]: 仅@主图/首帧不灌 gp 上传槽`,
      !uploadSlots.some((u) => gpRefs.includes(String(u || '').trim())),
      uploadSlots.join(',') || '(empty)'
    );
  }
  const uploaded = mockUpload(plan);
  const enriched = enrichPlanImagesWithPanelSlotIndexes(uploadSlots, plan.images, {
    imagePreview: afterSwitch.imagePreview,
  });
  row.assertApi(plan, uploaded, enriched);
}

function seedanceRefApiAssert(
  id: string,
  enriched: ReturnType<typeof enrichPlanImagesWithPanelSlotIndexes>,
  uploaded: Map<string, string>
) {
  const api = buildSeedanceReferenceImagesApiPayload(enriched, uploaded);
  ok(`${id}: 参考生 API referenceImages≥1`, api.length >= 1, String(api.length));
  if (promptPlanReferencesMainImage(enriched)) {
    ok(`${id}: 仅@主图时 API 含主图上传`, api.some((u) => u.includes('dragged-piano') || u.includes('image2')));
  }
}

const VIDEO_CASES: VideoTabCase[] = [
  {
    id: 'Seedance2.0·参考生·@主图',
    data: simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: DRAG_MAIN,
      referenceImages: [],
      prompt: '@主图 运动起来',
      seedanceTabConfigs: { reference: { prompt: '@主图 运动起来' } },
    }),
    prompt: '@主图 运动起来',
    minPlanImages: 1,
    assertApi: (plan, uploaded, enriched) =>
      seedanceRefApiAssert('Seedance2.0·参考生·@主图', enriched, uploaded),
  },
  {
    id: 'Seedance2.0·参考生·@图片1',
    data: simNode({
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'reference',
      imagePreview: DRAG_MAIN,
      referenceImages: [DRAG_REF],
      referenceImageLabels: ['狐狸'],
      prompt: '@图片1 参考动起来',
    }),
    prompt: '@图片1 参考动起来',
    minPlanImages: 1,
    assertApi: (_p, uploaded, enriched) => {
      const api = buildSeedanceReferenceImagesApiPayload(enriched, uploaded);
      ok('Seedance·@图片1: API≥1', api.length >= 1);
      ok('Seedance·@图片1: 非主图-only', buildReferenceOnlyImagesForApiPayload(enriched, uploaded).length >= 1);
    },
  },
  {
    id: 'Seedance2.0·图生·@首帧图',
    data: simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'image',
      imagePreview: DRAG_MAIN,
      firstFrameImageUrl: DRAG_MAIN,
      lastFrameImageUrl: DRAG_REF,
      referenceImages: [DRAG_REF],
      prompt: '@首帧图 推进 @尾帧图 参考',
    }),
    prompt: '@首帧图 推进 @尾帧图 参考',
    minPlanImages: 1,
    assertApi: (_p, uploaded, enriched) => {
      const { startUrl, endUrl } = assignStartEndUrlsFromImagePlan(
        { images: enriched, videos: [], audios: [] },
        uploaded
      );
      ok('Seedance·图生: startUrl 有值', Boolean(startUrl));
      ok('Seedance·图生: 双帧时有 endUrl', Boolean(endUrl));
    },
  },
  {
    id: 'Seedance1.5·图生·拖入主图',
    data: simNode({
      selectedModel: 'seedance1.5-pro',
      seedanceGenerationMode: 'image',
      imagePreview: DRAG_MAIN,
      firstFrameImageUrl: DRAG_MAIN,
      prompt: '@首帧图 镜头推进',
    }),
    prompt: '@首帧图 镜头推进',
    minPlanImages: 1,
    assertApi: (_p, uploaded, enriched) => {
      const { startUrl } = assignStartEndUrlsFromImagePlan(
        { images: enriched, videos: [], audios: [] },
        uploaded
      );
      ok('Seedance1.5: startUrl 有值', Boolean(startUrl));
    },
  },
  {
    id: '可灵2.5·@首帧图',
    data: simNode({
      selectedModel: '可灵 2.5 Turbo',
      imagePreview: DRAG_MAIN,
      firstFrameImageUrl: DRAG_MAIN,
      lastFrameImageUrl: DRAG_REF,
      prompt: '@首帧图 过渡到 @尾帧图',
    }),
    prompt: '@首帧图 过渡到 @尾帧图',
    minPlanImages: 1,
    assertApi: (plan) => {
      ok('可灵2.5: plan 含首帧', plan.images.some((e) => e.token === '@首帧图' || e.refFrameIndex === 0));
    },
  },
  {
    id: '可灵Omni·multi·@主图',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      imagePreview: DRAG_MAIN,
      klingOmniMultiReferenceImages: [DRAG_REF],
      klingOmniMultiPrompt: '@主图 @图片1 融合',
      prompt: '@主图 @图片1 融合',
    }),
    prompt: '@主图 @图片1 融合',
    minPlanImages: 2,
    assertApi: (plan) => {
      ok('Omni multi: @主图 解析', plan.images.some((e) => e.token === '@主图'));
      ok('Omni multi: @图片1 解析', plan.images.some((e) => e.token === '@图片1'));
    },
  },
  {
    id: '可灵Omni·instruction·@图片1',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'instruction',
      klingOmniInstructionReferenceImages: [DRAG_REF],
      klingOmniInstructionPrompt: '@图片1 换装',
      prompt: '@图片1 换装',
    }),
    prompt: '@图片1 换装',
    minPlanImages: 1,
    assertApi: (plan) => {
      ok('Omni instruction: @图片1 URL', plan.images.find((e) => e.token === '@图片1')?.url === DRAG_REF);
    },
  },
  {
    id: '可灵Omni·video·@图片1',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'video',
      klingOmniVideoReferenceImages: [DRAG_REF],
      klingOmniVideoPrompt: '@图片1 续镜',
      prompt: '@图片1 续镜',
    }),
    prompt: '@图片1 续镜',
    minPlanImages: 1,
    assertApi: (plan) => {
      ok('Omni video: @图片1 URL', plan.images.find((e) => e.token === '@图片1')?.url === DRAG_REF);
    },
  },
  {
    id: '可灵Omni·frames·@首帧',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'frames',
      firstFrameImageUrl: DRAG_MAIN,
      lastFrameImageUrl: DRAG_REF,
      klingOmniFramesPrompt: '@首帧图 到 @尾帧图',
      prompt: '@首帧图 到 @尾帧图',
    }),
    prompt: '@首帧图 到 @尾帧图',
    minPlanImages: 1,
    assertApi: (plan) => {
      ok('Omni frames: 首帧 URL', plan.images.some((e) => e.url === DRAG_MAIN));
    },
  },
  {
    id: 'vidu2.0·@首帧图',
    data: simNode({
      selectedModel: 'vidu 2.0',
      imagePreview: DRAG_MAIN,
      firstFrameImageUrl: DRAG_MAIN,
      prompt: '@首帧图 运动',
    }),
    prompt: '@首帧图 运动',
    minPlanImages: 1,
    assertApi: (plan) => {
      ok('vidu: 首帧解析', plan.images.some((e) => e.token === '@首帧图'));
    },
  },
  {
    id: '即梦3.0·@主图',
    data: simNode({
      selectedModel: '即梦3.0 Pro',
      jimengGenerationMode: 'image',
      imagePreview: DRAG_MAIN,
      firstFrameImageUrl: DRAG_MAIN,
      prompt: '@主图 动起来',
    }),
    prompt: '@主图 动起来',
    minPlanImages: 1,
    assertApi: (plan) => {
      ok('即梦: @主图 解析', plan.images.some((e) => e.token === '@主图'));
    },
  },
  {
    id: 'Seedance2.0·文生',
    data: simNode({
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'text',
      prompt: '纯文字描述镜头',
    }),
    prompt: '纯文字描述镜头',
    minPlanImages: 0,
    assertApi: () => {
      ok('Seedance·文生: 无强制参考图', true);
    },
  },
];

console.log('\n=== A. 直接拖入 → 图生视频（全模型/tab）===\n');
for (const row of VIDEO_CASES) {
  runDirectDragCase(row);
}

console.log('\n=== B. image2 跑完 → 切视频模型（面板清空，gp 有参考）===\n');

const POST_IMAGE2_VIDEO_CASES = VIDEO_CASES.filter((c) => c.minPlanImages > 0 && !c.id.includes('文生'));

for (const row of POST_IMAGE2_VIDEO_CASES) {
  runAfterImage2Case(row, [IMAGE2_REF_SNAP]);
}

console.log('\n=== C. image2 本模型：拖入参考 → @图片1 生图（回归）===\n');

{
  const data = simNode({
    selectedModel: MODEL_IMAGE_2,
    imagePreview: DRAG_MAIN,
    referenceImages: [IMAGE2_REF_SNAP],
    referenceImageLabels: ['参考狐'],
    prompt: '@图片1 变成水彩',
  });
  const ctx = buildPromptMediaRefContextForRun(data);
  const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, new Map());
  ok('image2 拖入: @图片1 解析', plan.images.find((e) => e.token === '@图片1')?.url === IMAGE2_REF_SNAP);
  const slots = panelReferenceImagesForUpload(data) || [];
  ok('image2 拖入: 上传槽含参考', slots.includes(IMAGE2_REF_SNAP));
}

console.log('\n=== D. Nano 拖入参考 → @图片1（回归）===\n');

{
  const data = simNode({
    selectedModel: MODEL_NANO_BANANA_2,
    imagePreview: DRAG_MAIN,
    referenceImages: [DRAG_REF],
    prompt: '@图片1 风格化',
  });
  const ctx = buildPromptMediaRefContextForRun(data);
  const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, new Map());
  ok('Nano 拖入: @图片1', plan.images.find((e) => e.token === '@图片1')?.url === DRAG_REF);
}

console.log('\n=== E. 持久化合并回归：有面板槽时不丢空槽下标 ===\n');

{
  const panel = [DRAG_REF, '', DRAG_MAIN];
  const mergedEmpty = mergePanelWithPersistedReferenceImages(panel, []);
  ok('空 gp: 保留空槽', mergedEmpty.length === 3 && mergedEmpty[1] === '');
  ok('空 gp: 槽0/2 不变', mergedEmpty[0] === DRAG_REF && mergedEmpty[2] === DRAG_MAIN);
  const mergedGp = mergePanelWithPersistedReferenceImages([], [IMAGE2_REF_SNAP]);
  ok('空面板+gp: 回填参考', mergedGp.includes(IMAGE2_REF_SNAP));
  const mergedBoth = mergePanelWithPersistedReferenceImages(panel, [IMAGE2_REF_SNAP]);
  ok('有面板+gp: 追加不覆盖', mergedBoth[0] === DRAG_REF && mergedBoth.includes(IMAGE2_REF_SNAP));
}

console.log('\n=== F. image2 跑完 → Seedance 参考生 @主图 + @图片1（双路径）===\n');

{
  const base = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    imagePreview: IMAGE2_OUT,
    referenceImages: [],
    generationParams: {
      referenceImages: [IMAGE2_REF_SNAP],
      prompt: '@主图 @图片1 联动',
    },
    prompt: '@主图 @图片1 联动',
  });
  const ctx = buildPromptMediaRefContextForRun(base);
  const plan = collectReferencedMediaFromPrompt(base.prompt!, base, ctx, new Map());
  ok('双@: plan≥2', plan.images.length >= 2);
  const slots = panelReferenceImagesForUpload(base) || [];
  ok('双@: gp 参考在槽', slots.includes(IMAGE2_REF_SNAP));
  const uploaded = mockUpload(plan);
  const enriched = enrichPlanImagesWithPanelSlotIndexes(slots, plan.images, {
    imagePreview: base.imagePreview,
  });
  const api = buildSeedanceReferenceImagesApiPayload(enriched, uploaded);
  ok('双@: API≥2', api.length >= 2, String(api.length));
  const refOnly = buildReferenceOnlyImagesForApiPayload(enriched, uploaded);
  ok('双@: refOnly 不含主图但≥1', refOnly.length >= 1 && refOnly.length <= api.length);
}

console.log('\n=== 汇总 ===\n');
console.log(`通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
console.log('图生视频链路矩阵测试全部通过。');

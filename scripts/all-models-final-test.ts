/**
 * 全模型终检（不调用 API）：
 * - 属性面板：@ 后槽位不丢、不乱序
 * - @ 解析：token → 面板 URL → API 顺序
 * - Node Details：上游=面板/tab；下游=generationParams 快照
 *
 * npx tsx scripts/all-models-final-test.ts
 */
import type { NodeData } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2, NodeType } from '../types.ts';
import {
  buildGenerationParamsFromRunSnapshot,
  buildNodeDetailsBaseParams,
  buildNanoBananaDetailsReferenceImages,
  expectedProcessorReferenceImagesFromPanel,
  mergeOmniMultiTabReferenceImagesForDetails,
  resolveOmniTabPromptFromData,
} from '../utils/nodeDetailsPreview.ts';
import {
  buildPromptMediaRefContextFromNode,
  buildPromptMediaRefLabels,
  buildReferenceIndexOptionsFromPlan,
  collectReferencedMediaFromPrompt,
  resolvePromptPlaceholders,
} from '../utils/promptMediaRefs.ts';
import {
  mergeAndPrunePanelReferenceImagesAfterUpload,
  OMNI_MULTI_FIRST_FRAME_TOKENS,
  promptPlanReferencesPanelImages,
} from '../utils/referencedMediaRun.ts';

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

function refArrayForModel(data: NodeData): string[] {
  const model = data.selectedModel || '';
  if (model === '可灵3.0 Omni') {
    const tab = data.klingOmniTab || 'multi';
    if (tab === 'multi') return [...(data.klingOmniMultiReferenceImages || [])];
    if (tab === 'instruction') return [...(data.klingOmniInstructionReferenceImages || [])];
    if (tab === 'video') return [...(data.klingOmniVideoReferenceImages || [])];
    return [];
  }
  if (model === '即梦3.0 Pro') {
    const f = data.firstFrameImageUrl || data.firstFrameImage;
    return f ? [f] : [];
  }
  return [...(data.referenceImages || [])];
}

function applyPanelAfterRun(data: NodeData, panelAfter: string[]): NodeData {
  const model = data.selectedModel || '';
  if (model === '可灵3.0 Omni') {
    const tab = data.klingOmniTab || 'multi';
    if (tab === 'multi') return { ...data, klingOmniMultiReferenceImages: [...panelAfter] };
    if (tab === 'instruction') {
      return { ...data, klingOmniInstructionReferenceImages: [...panelAfter] };
    }
    if (tab === 'video') return { ...data, klingOmniVideoReferenceImages: [...panelAfter] };
  }
  return { ...data, referenceImages: [...panelAfter] };
}

function mockUploaded(plan: ReturnType<typeof collectReferencedMediaFromPrompt>): Map<string, string> {
  const m = new Map<string, string>();
  for (const img of plan.images) m.set(img.token, `${img.url}|UP`);
  for (const v of plan.videos) m.set(v.token, `${v.url}|UP`);
  return m;
}

function urlAtToken(data: NodeData, token: string): string | null {
  const ctx = buildPromptMediaRefContextFromNode(data);
  const labels = buildPromptMediaRefLabels(data, ctx);
  const alias =
    token === '@图片' ? '@图片1' : token === '@视频' ? '@视频1' : token === '@音频' ? '@音频1' : token;
  const item = labels.find((i) => i.insertText === alias);
  if (!item) return null;
  if (item.kind === 'image' && item.refImageIndex != null) {
    return refArrayForModel(data)[item.refImageIndex]?.trim() || null;
  }
  if (token === '@主图' || token === '@主体') return data.imagePreview?.trim() || null;
  if (token === '@首帧图') return data.firstFrameImageUrl || data.firstFrameImage || null;
  if (token === '@尾帧图') return data.lastFrameImageUrl || data.lastFrameImage || null;
  return null;
}

type Scenario = {
  id: string;
  data: NodeData;
  /** 模拟 API 参考图 URL 列表（按 @ 出现顺序） */
  apiImageUrls: string[];
};

function runPanelAndAtScenario(s: Scenario) {
  const prompt = String(s.data.prompt || '').trim();
  const panelBefore = [...refArrayForModel(s.data)];
  const ctx = buildPromptMediaRefContextFromNode(s.data);
  const plan = collectReferencedMediaFromPrompt(prompt, s.data, ctx, new Map());
  ok(`${s.id}: 解析出@素材`, plan.images.length + plan.videos.length >= 1);

  const uploaded = mockUploaded(plan);
  const shouldPrunePanel = promptPlanReferencesPanelImages(plan.images);
  const panelAfter = mergeAndPrunePanelReferenceImagesAfterUpload(
    panelBefore,
    plan.images,
    uploaded,
    { imagePreview: s.data.imagePreview }
  );
  const dataAfter = applyPanelAfterRun(s.data, panelAfter);

  const maxRefSlot = Math.max(-1, ...plan.images.map((e) => e.refImageSlotIndex ?? -1));
  ok(
    `${s.id}: 面板长度覆盖已@最大槽`,
    panelAfter.length > maxRefSlot || maxRefSlot < 0,
    `${panelAfter.length}/${panelBefore.length} max=${maxRefSlot}`
  );
  for (let i = 0; i < panelBefore.length; i++) {
    const inPlan = plan.images.some(
      (e) =>
        e.refImageSlotIndex === i &&
        !['@主图', '@主体'].includes(e.token) &&
        uploaded.has(e.token)
    );
    if (!inPlan && shouldPrunePanel) {
      ok(`${s.id}: 槽${i}未@已清空`, !String(panelAfter[i] || '').trim(), `${panelAfter[i]}`);
    } else if (inPlan) {
      ok(
        `${s.id}: 槽${i}已@写回`,
        String(panelAfter[i] || '').endsWith('|UP'),
        `${panelAfter[i]}`
      );
    }
  }

  const normUrl = (u: string | null) =>
    u ? u.replace(/\|UP$/i, '').split('?')[0] : null;
  for (const entry of plan.images) {
    const resolved = urlAtToken(dataAfter, entry.token);
    const slot =
      entry.refImageSlotIndex != null ? panelBefore[entry.refImageSlotIndex] : null;
    ok(
      `${s.id}: ${entry.token} 定位面板`,
      resolved != null && (slot == null || normUrl(resolved) === normUrl(slot)),
      `token→${resolved?.slice(0, 40)} slot→${slot?.slice(0, 40)}`
    );
    ok(`${s.id}: ${entry.token} API映射`, uploaded.get(entry.token) === `${entry.url}|UP`);
  }

  const apiFromPlan = plan.images.map((e) => uploaded.get(e.token)!);
  ok(
    `${s.id}: API顺序=@顺序`,
    JSON.stringify(apiFromPlan) === JSON.stringify(s.apiImageUrls.map((u) => `${u}|UP`)),
    JSON.stringify(apiFromPlan)
  );

  const opts = buildReferenceIndexOptionsFromPlan(plan);
  const expanded = resolvePromptPlaceholders(prompt, s.data, ctx, opts);
  for (const entry of plan.images) {
    const n = opts.referenceImageIndexByToken?.get(entry.token);
    ok(`${s.id}: ${entry.token}→[图${n}]`, n != null && expanded.includes(`[图${n}]`));
  }
}

function runProcessorDetails(s: Scenario) {
  const expected = expectedProcessorReferenceImagesFromPanel(s.data);
  const model = s.data.selectedModel || '';
  let actual = expected;
  if (model === '可灵3.0 Omni' && (s.data.klingOmniTab || 'multi') === 'multi') {
    actual = mergeOmniMultiTabReferenceImagesForDetails({
      nodeData: s.data,
      isOutputLike: false,
    });
  }
  ok(
    `${s.id}: 上游 Details 参考图`,
    JSON.stringify(actual.map((u) => u.split('?')[0].slice(-24))) ===
      JSON.stringify(expected.map((u) => u.split('?')[0].slice(-24))),
    `len ${actual.length}/${expected.length}`
  );

  const tab = s.data.klingOmniTab || 'multi';
  const tabPrompt =
    model === '可灵3.0 Omni'
      ? resolveOmniTabPromptFromData(s.data, tab as 'multi' | 'instruction' | 'video' | 'frames').prompt
      : String(s.data.prompt || '').trim();

  const base = buildNodeDetailsBaseParams({
    previewNodeData: {
      ...s.data,
      generationParams: { model: '可灵 2.5 Turbo' },
    },
    nodeType: NodeType.PROCESSOR,
  });
  ok(`${s.id}: 上游 model`, (s.data.selectedModel || base.model) === model);
  ok(`${s.id}: 上游 prompt=tab/面板`, (base.prompt || '').trim() === tabPrompt);
}

function runOutputDetails(s: Scenario) {
  const model = s.data.selectedModel || '';
  const gp = buildGenerationParamsFromRunSnapshot(s.data, model, {
    runCapture: { referenceImages: [...s.apiImageUrls] },
  });
  gp.referenceImages = [...s.apiImageUrls];
  gp.prompt = String(s.data.prompt || gp.prompt || '');
  applyRunSnapshotPrompt(gp, s.data, model);

  const sidebarDefault =
    model === MODEL_NANO_BANANA_2 ? MODEL_IMAGE_2 : MODEL_NANO_BANANA_2;
  const output = simNode({
    selectedModel: sidebarDefault,
    aspectRatio: '1:1',
    generationParams: gp,
  });

  const base = buildNodeDetailsBaseParams({
    previewNodeData: output,
    nodeType: NodeType.OUTPUT,
    ancestorData: s.data,
  });
  ok(`${s.id}: 下游 model=快照`, base.model === model);
  ok(
    `${s.id}: 下游 Details 不用侧栏默认模型`,
    base.model !== output.selectedModel,
    `details=${base.model} sidebar=${output.selectedModel}`
  );

  const detailsRefs = buildNanoBananaDetailsReferenceImages({
    snapRefs: gp.referenceImages || [],
    fallbackRefs: [],
    prompt: gp.prompt || '',
    isOutputLike: true,
    ancestorData: s.data,
    isRunSnapshotRef: () => true,
  });
  ok(
    `${s.id}: 下游参考图=API张数`,
    detailsRefs.length === s.apiImageUrls.length,
    `len=${detailsRefs.length}`
  );
}

function applyRunSnapshotPrompt(gp: ReturnType<typeof buildGenerationParamsFromRunSnapshot>, data: NodeData, model: string) {
  if (model === '可灵3.0 Omni') {
    const tab = data.klingOmniTab || 'multi';
    gp.prompt = resolveOmniTabPromptFromData(data, tab as 'multi' | 'instruction' | 'video' | 'frames').prompt;
  }
}

const SCENARIOS: Scenario[] = [
  {
    id: 'Nano Banana 2.0',
    data: simNode({
      selectedModel: MODEL_NANO_BANANA_2,
      imagePreview: 'https://ex/main.png',
      referenceImages: ['https://ex/r0.png', 'https://ex/r1.png'],
      prompt: '@主图 主体 @图片1 细节',
    }),
    apiImageUrls: ['https://ex/main.png', 'https://ex/r0.png'],
  },
  {
    id: 'image 2',
    data: simNode({
      selectedModel: MODEL_IMAGE_2,
      imagePreview: 'https://ex/i2main.png',
      referenceImages: ['https://ex/a.png', 'https://ex/b.png', 'https://ex/c.png'],
      prompt: '@图片3 背景 @图片1 前景',
    }),
    apiImageUrls: ['https://ex/c.png', 'https://ex/a.png'],
  },
  {
    id: '可灵 2.5 Turbo',
    data: simNode({
      selectedModel: '可灵 2.5 Turbo',
      firstFrameImageUrl: 'https://ex/ff.png',
      lastFrameImageUrl: 'https://ex/lf.png',
      referenceImages: ['https://ex/ref.png'],
      prompt: '@首帧图 运动 @尾帧图 衔接',
    }),
    apiImageUrls: ['https://ex/ff.png', 'https://ex/lf.png'],
  },
  {
    id: 'vidu 2.0',
    data: simNode({
      selectedModel: 'vidu 2.0',
      firstFrameImageUrl: 'https://ex/vidu-start.png',
      prompt: '@首帧图 推进',
    }),
    apiImageUrls: ['https://ex/vidu-start.png'],
  },
  {
    id: 'seedance1.5-pro 图生',
    data: simNode({
      selectedModel: 'seedance1.5-pro',
      seedanceGenerationMode: 'image',
      firstFrameImageUrl: 'https://ex/s15s.png',
      lastFrameImageUrl: 'https://ex/s15e.png',
      prompt: '@首帧图 到 @尾帧图',
    }),
    apiImageUrls: ['https://ex/s15s.png', 'https://ex/s15e.png'],
  },
  {
    id: 'seedance2.0 参考生',
    data: simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: 'https://ex/sd-main.png',
      referenceImages: ['https://ex/sd1.png', 'https://ex/sd2.png', 'https://ex/sd3.png'],
      prompt: '@主图 场景 @图片2 人物',
    }),
    apiImageUrls: ['https://ex/sd-main.png', 'https://ex/sd3.png'],
  },
  {
    id: 'seedance2.0 图生',
    data: simNode({
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'image',
      firstFrameImageUrl: 'https://ex/sd2s.png',
      lastFrameImageUrl: 'https://ex/sd2e.png',
      prompt: '@首帧图 过渡',
    }),
    apiImageUrls: ['https://ex/sd2s.png'],
  },
  {
    id: '即梦3.0 Pro 图生',
    data: simNode({
      selectedModel: '即梦3.0 Pro',
      jimengGenerationMode: 'image',
      imagePreview: 'https://ex/jm-main.png',
      firstFrameImageUrl: 'https://ex/jm-first.png',
      prompt: '@首帧图 人物',
    }),
    apiImageUrls: ['https://ex/jm-first.png'],
  },
  {
    id: '可灵3.0 Omni 多图',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      klingOmniMultiPrompt: 'Omni @主图 @图片2',
      imagePreview: 'https://ex/omni-main.png',
      klingOmniMultiReferenceImages: ['https://ex/o0.png', 'https://ex/o1.png'],
      prompt: '@主图 首帧 @图片2 参考',
    }),
    apiImageUrls: ['https://ex/omni-main.png', 'https://ex/o1.png'],
  },
  {
    id: '可灵3.0 Omni 指令',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'instruction',
      klingOmniInstructionPrompt: '指令 @图片1',
      klingOmniInstructionReferenceImages: ['https://ex/inst1.png'],
      klingOmniInstructionVideoPreviewUrl: 'blob:vid',
      prompt: '@图片1 换装 @视频1',
    }),
    apiImageUrls: ['https://ex/inst1.png'],
  },
  {
    id: '可灵3.0 Omni 视频',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'video',
      klingOmniVideoPrompt: '视频续写 @图片1',
      klingOmniVideoReferenceImages: ['https://ex/vref.png'],
      klingOmniVideoPreviewUrl: 'blob:vref',
      prompt: '@图片1 续镜',
    }),
    apiImageUrls: ['https://ex/vref.png'],
  },
  {
    id: '可灵3.0 Omni 首尾帧',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'frames',
      klingOmniFramesPrompt: '首尾 @首帧图',
      firstFrameImageUrl: 'https://ex/off.png',
      lastFrameImageUrl: 'https://ex/ole.png',
      prompt: '@首帧图 过渡到 @尾帧图',
    }),
    apiImageUrls: ['https://ex/off.png', 'https://ex/ole.png'],
  },
];

console.log('\n=== 全模型：属性面板 @ / 槽位 / API 顺序 ===\n');
for (const s of SCENARIOS) runPanelAndAtScenario(s);

console.log('\n=== 全模型：上游 Node Details ===\n');
for (const s of SCENARIOS) runProcessorDetails(s);

console.log('\n=== 全模型：下游 Node Details（模拟 API 快照）===\n');
for (const s of SCENARIOS) runOutputDetails(s);

console.log('\n=== 回归：Omni @图片1 不占首帧槽 ===\n');
ok('@图片1 不在首帧 token', !OMNI_MULTI_FIRST_FRAME_TOKENS.has('@图片1'));

console.log(`\n=== 汇总 ===\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
console.log('全模型终检通过。请执行 npm run build 后按 docs/最终验收-NodeDetails与面板.md 做浏览器点验。');

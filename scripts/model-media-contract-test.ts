/**
 * 全模型媒体契约测试（纯模拟、不调 API）
 * 表驱动：面板槽 → @ 下拉 → plan → API payload → gp → Details → OUTPUT sanitize
 *
 * npx tsx scripts/model-media-contract-test.ts
 */
import type { NodeData, GenerationParams } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2, NodeType } from '../types.ts';
import {
  buildGenerationParamsFromRunSnapshot,
  buildNodeDetailsBaseParams,
  buildSeedanceReferenceDetailsFromSnapshot,
  buildNanoBananaDetailsReferenceImages,
  buildOmniMultiTabDetailsReferencePreview,
  buildImageGenOutputReferenceDetailsFromSnapshot,
  buildNodeDetailsVideoLabelSource,
  buildReferenceVideoDetailItems,
  seedanceReferenceMovsForOutputDetails,
} from '../utils/nodeDetailsPreview.ts';
import { isGeneratedOutputPersistableUrl } from '../utils/generatedOutputUrl.ts';
import {
  buildInspectorPromptMentionItems,
  buildPromptMediaRefContextForRun,
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
  getCanonicalInspectorPromptText,
} from '../utils/promptMediaRefs.ts';
import {
  assignStartEndUrlsFromImagePlan,
  buildReferenceOnlyImagesForApiPayload,
  buildSeedanceReferenceApiLabelsFromPlan,
  buildSeedanceReferenceImagesApiPayload,
  enrichPlanImagesWithPanelSlotIndexes,
  mergeSeedancePanelReferenceMovsAfterUpload,
  panelReferenceImagesForUpload,
} from '../utils/referencedMediaRun.ts';
import {
  outputNodePanelReferenceImagesFromRun,
  promptNeedsPersistedPanelRefs,
  sanitizeOutputNodeFramePanelPatch,
  sanitizeOutputNodePanelReferenceImages,
} from '../utils/panelRefPersistence.ts';

let pass = 0;
let fail = 0;

function simNode(partial: Partial<NodeData> & { selectedModel: string }): NodeData {
  return { label: 'contract', ...partial } as NodeData;
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

function mockUploaded(plan: ReturnType<typeof collectReferencedMediaFromPrompt>): Map<string, string> {
  const m = new Map<string, string>();
  for (const img of plan.images) m.set(img.token, `${img.url}|UP`);
  for (const v of plan.videos) m.set(v.token, `${v.url}|UP`);
  return m;
}

type ContractExpect = {
  /** plan 图片 token 顺序 */
  planImageTokens?: string[];
  planVideoTokens?: string[];
  /** @ 下拉必须出现 */
  mentionInclude?: string[];
  /** @ 下拉不得出现（空槽） */
  mentionExclude?: string[];
  /** API referenceImages 数量（不含 @主图 的 reference-only；Seedance 参考生用专用 builder） */
  apiRefCount?: number;
  /** 含 @主图 在内的 plan 上传张数（图模型 Details / 全 plan API） */
  apiPlanUploadCount?: number;
  /** API 首尾帧 */
  apiHasStart?: boolean;
  apiHasEnd?: boolean;
  /** 上传槽 referenceImages 长度 */
  uploadSlotCount?: number;
  /** OUTPUT 侧栏参考格清空 */
  outputPanelRefsEmpty?: boolean;
  /** OUTPUT 首尾帧格清空 */
  outputFramePanelClear?: boolean;
  /** Node Details 参考图张数（OUTPUT，读 gp） */
  detailRefCount?: number;
  /** Node Details 标签（Seedance 参考生优先） */
  detailLabels?: string[];
  /** spawn 面板参考快照长度（仅断言关键场景时填写） */
  spawnPanelRefCount?: number;
  /** gp.referenceImageLabels */
  gpLabels?: string[];
  /** gp / 面板合并后 referenceMovs 条数（Seedance 参考生纯图应为 0） */
  gpRefMovCount?: number;
  /** OUTPUT Details Reference Videos 条数（seedanceReferenceMovsForOutputDetails） */
  detailRefMovCount?: number;
  /** Node Details Reference Videos 角标（@视频1 / @主视频） */
  detailRefVideoLabels?: string[];
  /** 模拟 gp.outputUrl 须为 AiTop 持久化链 */
  gpOutputUrlAitop?: boolean;
};

type ContractCase = {
  id: string;
  data: NodeData;
  prompt?: string;
  projectAssets?: { slug: string; name: string; url: string }[];
  expect: ContractExpect;
};

function resolvePrompt(data: NodeData, override?: string): string {
  if (override) return override;
  return getCanonicalInspectorPromptText(data) || String(data.prompt || '').trim();
}

function apiUrlsFromPlan(
  data: NodeData,
  plan: ReturnType<typeof collectReferencedMediaFromPrompt>,
  uploaded: Map<string, string>,
  enriched: ReturnType<typeof enrichPlanImagesWithPanelSlotIndexes>
): string[] {
  const model = data.selectedModel || '';
  const mode = data.seedanceGenerationMode;
  if (model.includes('seedance') && mode === 'reference') {
    return buildSeedanceReferenceImagesApiPayload(enriched, uploaded);
  }
  return plan.images
    .map((e) => uploaded.get(e.token))
    .filter((u): u is string => Boolean(u));
}

function referenceOnlyApiCount(
  enriched: ReturnType<typeof enrichPlanImagesWithPanelSlotIndexes>,
  uploaded: Map<string, string>
): number {
  return buildReferenceOnlyImagesForApiPayload(enriched, uploaded).length;
}

function assertApiShape(
  id: string,
  data: NodeData,
  plan: ReturnType<typeof collectReferencedMediaFromPrompt>,
  uploaded: Map<string, string>,
  enriched: ReturnType<typeof enrichPlanImagesWithPanelSlotIndexes>,
  exp: ContractExpect
) {
  const model = data.selectedModel || '';
  const mode = data.seedanceGenerationMode;

  if (exp.apiRefCount != null) {
    if (model.includes('seedance') && mode === 'reference') {
      const api = buildSeedanceReferenceImagesApiPayload(enriched, uploaded);
      eq(api.length, exp.apiRefCount, `${id}: Seedance 参考生 API 张数`);
      const labels = buildSeedanceReferenceApiLabelsFromPlan(plan.images, uploaded);
      if (exp.gpLabels) eq(labels, exp.gpLabels, `${id}: API 标签顺序`);
    } else {
      eq(referenceOnlyApiCount(enriched, uploaded), exp.apiRefCount, `${id}: reference-only API 张数`);
    }
  }

  if (exp.apiPlanUploadCount != null) {
    eq(apiUrlsFromPlan(data, plan, uploaded, enriched).length, exp.apiPlanUploadCount, `${id}: plan 上传总张数`);
  }

  if (exp.apiHasStart != null || exp.apiHasEnd != null) {
    const { startUrl, endUrl } = assignStartEndUrlsFromImagePlan(
      { images: enriched, videos: plan.videos, audios: plan.audios },
      uploaded
    );
    if (exp.apiHasStart != null) ok(`${id}: API startUrl`, Boolean(startUrl) === exp.apiHasStart);
    if (exp.apiHasEnd != null) ok(`${id}: API endUrl`, Boolean(endUrl) === exp.apiHasEnd);
  }
}

function assertOutputContract(
  id: string,
  upstream: NodeData,
  model: string,
  apiUrls: string[],
  gpLabels: string[] | undefined,
  exp: ContractExpect,
  projectAssets?: Array<{ slug: string; name: string; url: string }>
) {
  const prompt = resolvePrompt(upstream);
  const cleanApiUrls = apiUrls.map((u) => u.replace(/\|UP$/i, ''));
  const gp = buildGenerationParamsFromRunSnapshot(upstream, model, {
    runCapture: { referenceImages: [...cleanApiUrls], referenceImageLabels: gpLabels },
  });
  gp.referenceImages = [...cleanApiUrls];
  if (gpLabels) gp.referenceImageLabels = [...gpLabels];
  gp.prompt = prompt;

  if (exp.gpOutputUrlAitop && gp.outputUrl) {
    ok(
      `${id}: gp.outputUrl 为持久化链`,
      isGeneratedOutputPersistableUrl(gp.outputUrl) &&
        /aitop100app-.*\.myqcloud\.com/i.test(gp.outputUrl),
      gp.outputUrl
    );
  }

  const output = simNode({
    selectedModel: model,
    generationParams: gp,
    prompt,
    imagePreview: 'https://ex/output-result.jpg',
  });

  if (exp.outputPanelRefsEmpty != null) {
    if (!exp.outputPanelRefsEmpty && promptNeedsPersistedPanelRefs(prompt)) {
      output.referenceImages = refArrayForModel(upstream).filter((u) => String(u || '').trim());
    }
    const sanitized = sanitizeOutputNodePanelReferenceImages(output, NodeType.OUTPUT);
    ok(
      `${id}: OUTPUT 侧栏参考格为空`,
      sanitized.length === 0 === exp.outputPanelRefsEmpty,
      JSON.stringify(sanitized)
    );
  }

  if (exp.outputFramePanelClear) {
    const withFrames = {
      ...output,
      firstFrameImageUrl: upstream.firstFrameImageUrl,
      lastFrameImageUrl: upstream.lastFrameImageUrl,
    };
    const framePatch = sanitizeOutputNodeFramePanelPatch(withFrames, NodeType.OUTPUT);
    ok(`${id}: OUTPUT 首尾帧格清空`, framePatch != null && framePatch.firstFrameImageUrl === undefined);
  }

  const isSeedanceRef =
    model.includes('seedance') && upstream.seedanceGenerationMode === 'reference';
  const isVideo = !model.includes('Nano Banana') && model !== MODEL_IMAGE_2;

  if (exp.spawnPanelRefCount != null) {
    const spawnRefs = outputNodePanelReferenceImagesFromRun({
      isImage2Run: model === MODEL_IMAGE_2,
      isVideoModel: isVideo,
      isSeedance20RefOutput: isSeedanceRef,
      seedancePanelSnapshot: isSeedanceRef
        ? promptNeedsPersistedPanelRefs(prompt)
          ? refArrayForModel(upstream).filter((u) => u && !u.includes('sd-main'))
          : []
        : undefined,
      snapPanelRefs: [],
      inheritedRefs: refArrayForModel(upstream),
    });
    eq((spawnRefs || []).length, exp.spawnPanelRefCount, `${id}: spawn 面板参考快照张数`);
  }

  if (exp.detailRefCount != null || exp.detailLabels || exp.detailRefVideoLabels) {
    const base = buildNodeDetailsBaseParams({
      previewNodeData: output,
      nodeType: NodeType.OUTPUT,
      ancestorData: upstream,
    });
    ok(`${id}: Details model=快照`, base.model === model);

    if (isSeedanceRef && exp.detailLabels) {
      const sd = buildSeedanceReferenceDetailsFromSnapshot({
        snapshotRefs: gp.referenceImages || [],
        snapshotLabels: gp.referenceImageLabels,
        prompt: gp.prompt,
        projectAssets,
      });
      eq(
        sd.referenceImageDetailItems.map((x) => x.label),
        exp.detailLabels,
        `${id}: Seedance Details 标签`
      );
      const panelOrderLabels = (upstream.referenceImageLabels || []).filter((l) =>
        String(l || '').trim()
      );
      if (panelOrderLabels.length >= (gp.referenceImages?.length || 0)) {
        const sdPanelMisaligned = buildSeedanceReferenceDetailsFromSnapshot({
          snapshotRefs: gp.referenceImages || [],
          snapshotLabels: upstream.referenceImageLabels,
          prompt: gp.prompt,
          projectAssets,
        });
        eq(
          sdPanelMisaligned.referenceImageDetailItems.map((x) => x.label),
          exp.detailLabels,
          `${id}: Seedance Details 标签（面板序误存 gp 时仍对齐 prompt）`
        );
      }
      if (exp.detailRefCount != null) eq(sd.referenceImages.length, exp.detailRefCount, `${id}: Details 张数`);
      if (exp.detailRefMovCount != null) {
        const movs = seedanceReferenceMovsForOutputDetails(gp.referenceMovs, output.imagePreview);
        eq(movs.length, exp.detailRefMovCount, `${id}: Details Reference Videos 条数`);
      }
    }

    if (exp.detailRefVideoLabels != null) {
      const refMovs =
        (gp.referenceMovs?.length ? gp.referenceMovs : upstream.referenceMovs) || [];
      const gpForVideo: GenerationParams = {
        ...gp,
        klingOmniTab: upstream.klingOmniTab ?? gp.klingOmniTab,
        klingOmniInstructionVideoUrl:
          upstream.klingOmniInstructionVideoUrl ?? gp.klingOmniInstructionVideoUrl,
        klingOmniVideoUrl: upstream.klingOmniVideoUrl ?? gp.klingOmniVideoUrl,
        referenceMovs: refMovs.length ? refMovs : gp.referenceMovs,
      };
      const outputForVideo = simNode({
        selectedModel: model,
        generationParams: gpForVideo,
        prompt,
        imagePreview: upstream.imagePreview || output.imagePreview,
        klingOmniTab: upstream.klingOmniTab,
        klingOmniInstructionVideoUrl: upstream.klingOmniInstructionVideoUrl,
        klingOmniVideoUrl: upstream.klingOmniVideoUrl,
        klingOmniInstructionReferenceImages: upstream.klingOmniInstructionReferenceImages,
        klingOmniVideoReferenceImages: upstream.klingOmniVideoReferenceImages,
        referenceMovs: refMovs,
      });
      const videoItems = buildReferenceVideoDetailItems(
        buildNodeDetailsVideoLabelSource(outputForVideo, { prompt, model }),
        refMovs
      );
      eq(
        videoItems.map((i) => i.label),
        exp.detailRefVideoLabels,
        `${id}: Details Reference Videos 标签`
      );
    } else if (
      (model === MODEL_IMAGE_2 || model === MODEL_NANO_BANANA_2) &&
      exp.detailLabels
    ) {
      const fromSnap = buildImageGenOutputReferenceDetailsFromSnapshot({
        snapshotRefs: gp.referenceImages || [],
        snapshotLabels: gp.referenceImageLabels,
        prompt: gp.prompt,
        projectAssets,
        outputImagePreview: output.imagePreview,
        isRunSnapshotRef: () => true,
        isSameAsOutput: () => false,
      });
      eq(
        fromSnap.referenceImageDetailItems.map((x) => x.label),
        exp.detailLabels,
        `${id}: image2/Nano Details 标签（API 快照顺序）`
      );
      if (exp.detailRefCount != null) {
        eq(fromSnap.referenceImages.length, exp.detailRefCount, `${id}: Details 参考张数`);
      }
    } else if (exp.detailRefCount != null) {
      const isOmniMulti =
        model === '可灵3.0 Omni' && (upstream.klingOmniTab || 'multi') === 'multi';
      const refs = isOmniMulti
        ? buildOmniMultiTabDetailsReferencePreview({
            panelSource: {
              ...output,
              klingOmniTab: 'multi',
              klingOmniMultiPrompt: gp.prompt,
            },
            urlPool: gp.referenceImages || [],
            snapshotRefs: gp.referenceImages || [],
            snapshotLabels: gp.referenceImageLabels,
            prompt: gp.prompt,
            movUrlSet: new Set(),
            projectAssets,
          }).referenceImages
        : buildNanoBananaDetailsReferenceImages({
            snapRefs: gp.referenceImages || [],
            fallbackRefs: [],
            prompt: gp.prompt || '',
            isOutputLike: true,
            ancestorData: upstream,
            isRunSnapshotRef: () => true,
          });
      eq(refs.length, exp.detailRefCount, `${id}: Details 参考张数`);
    }
  }
}

function runContract(c: ContractCase) {
  const { id, data, expect: exp } = c;
  const prompt = resolvePrompt(data, c.prompt);
  const ctxRun = buildPromptMediaRefContextForRun(data);
  const ctxUi = buildPromptMediaRefContextFromNode(data);
  const assetBySlug = new Map<string, string>();
  if (c.projectAssets) {
    for (const a of c.projectAssets) {
      assetBySlug.set(a.slug, a.url);
    }
    ctxRun.projectAssets = c.projectAssets;
    ctxUi.projectAssets = c.projectAssets;
  }
  const plan = collectReferencedMediaFromPrompt(prompt, data, ctxRun, assetBySlug);
  const uploaded = mockUploaded(plan);
  const uploadSlots = panelReferenceImagesForUpload(data) || [];
  const enriched = enrichPlanImagesWithPanelSlotIndexes(uploadSlots, plan.images, {
    imagePreview: data.imagePreview,
    referenceImageLabels: data.referenceImageLabels,
    panelMainSlotVisible: data.panelMainSlotVisible,
  });

  console.log(`\n--- ${id} ---`);

  if (exp.planImageTokens) {
    eq(
      plan.images.map((e) => e.token),
      exp.planImageTokens,
      `${id}: plan 图片 token 顺序`
    );
  }
  if (exp.planVideoTokens) {
    eq(
      plan.videos.map((e) => e.token),
      exp.planVideoTokens,
      `${id}: plan 视频 token`
    );
  }

  const mentions = buildInspectorPromptMentionItems(data, ctxUi);
  const mentionTokens = mentions.map((m) => m.insertText?.trim()).filter(Boolean) as string[];
  for (const t of exp.mentionInclude || []) {
    ok(`${id}: @ 下拉含 ${t}`, mentionTokens.includes(t), mentionTokens.join(','));
  }
  for (const t of exp.mentionExclude || []) {
    ok(`${id}: @ 下拉不含 ${t}`, !mentionTokens.includes(t), mentionTokens.join(','));
  }

  if (exp.uploadSlotCount != null) {
    eq(uploadSlots.filter((u) => String(u || '').trim()).length, exp.uploadSlotCount, `${id}: 上传槽非空数`);
  }

  assertApiShape(id, data, plan, uploaded, enriched, exp);

  if (exp.gpRefMovCount != null && data.seedanceGenerationMode === 'reference') {
    const mergedMovs = mergeSeedancePanelReferenceMovsAfterUpload(
      data.referenceMovs,
      plan.videos,
      plan.videos.map((v) => uploaded.get(v.token) || v.url).filter(Boolean)
    );
    eq(mergedMovs.length, exp.gpRefMovCount, `${id}: 运行后 gp referenceMovs 条数`);
  }

  const apiUrls = apiUrlsFromPlan(data, plan, uploaded, enriched);

  if (exp.gpOutputUrlAitop) {
    const mockOutput = `https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/mock/${id.replace(/\s+/g, '_')}.png`;
    const gp = buildGenerationParamsFromRunSnapshot(data, data.selectedModel || '', {
      runCapture: {
        referenceImages: apiUrls.map((u) => u.replace(/\|UP$/i, '')),
        outputUrl: mockOutput,
      },
    });
    gp.outputUrl = mockOutput;
    ok(
      `${id}: 模拟 outputUrl 持久化`,
      isGeneratedOutputPersistableUrl(gp.outputUrl) &&
        /aitop100app-.*\.myqcloud\.com/i.test(String(gp.outputUrl)),
      String(gp.outputUrl)
    );
  }

  const gpLabels =
    exp.gpLabels ||
    (data.selectedModel?.includes('seedance') && data.seedanceGenerationMode === 'reference'
      ? buildSeedanceReferenceApiLabelsFromPlan(plan.images, uploaded)
      : undefined);

  assertOutputContract(id, data, data.selectedModel || '', apiUrls, gpLabels, exp, c.projectAssets);

  ok(
    `${id}: promptNeedsPersistedPanelRefs 与 @图片n 一致`,
    promptNeedsPersistedPanelRefs(prompt) === /@图片\d|@资产:/.test(prompt)
  );
}

const CASES: ContractCase[] = [
  {
    id: 'Nano Banana 2.0',
    data: simNode({
      selectedModel: MODEL_NANO_BANANA_2,
      imagePreview: 'https://ex/main.png',
      referenceImages: ['https://ex/r0.png', 'https://ex/r1.png'],
      prompt: '@主图 主体 @图片1 细节',
    }),
    expect: {
      planImageTokens: ['@主图', '@图片1'],
      mentionInclude: ['@主图', '@图片1'],
      apiRefCount: 1,
      apiPlanUploadCount: 2,
      uploadSlotCount: 2,
      detailRefCount: 2,
      outputPanelRefsEmpty: true,
    },
  },
  {
    id: 'Nano Banana 2.0·@图片1同主图URL 不丢失',
    data: simNode({
      selectedModel: MODEL_NANO_BANANA_2,
      imagePreview: 'https://ex/woods.png',
      referenceImages: ['https://ex/woods.png', 'https://ex/lion.png'],
      referenceImageLabels: ['图片1', '图片2'],
      prompt: '@主图和@图片1融合',
    }),
    expect: {
      planImageTokens: ['@主图', '@图片1'],
      mentionInclude: ['@主图', '@图片1', '@图片2'],
      uploadSlotCount: 2,
      detailRefCount: 2,
    },
  },
  {
    id: 'image 2',
    data: simNode({
      selectedModel: MODEL_IMAGE_2,
      imagePreview: 'https://ex/i2main.png',
      referenceImages: ['https://ex/a.png', 'https://ex/b.png', 'https://ex/c.png'],
      prompt: '@图片3 背景 @图片1 前景',
    }),
    expect: {
      planImageTokens: ['@图片3', '@图片1'],
      mentionInclude: ['@图片1', '@图片3'],
      apiRefCount: 2,
      apiPlanUploadCount: 2,
      uploadSlotCount: 3,
      detailRefCount: 2,
      detailLabels: ['图片3', '图片1'],
      gpOutputUrlAitop: true,
    },
  },
  {
    id: 'image 2·主图+3参考 @图片3 可选',
    data: simNode({
      selectedModel: MODEL_IMAGE_2,
      imagePreview: 'https://ex/i2main.png',
      referenceImages: ['https://ex/a.png', 'https://ex/b.png', 'https://ex/c.png'],
      referenceImageLabels: ['图片1', '图片2', '图片3'],
      prompt: '@主图 融合 @图片1 @图片2 @图片3',
    }),
    expect: {
      planImageTokens: ['@主图', '@图片1', '@图片2', '@图片3'],
      mentionInclude: ['@主图', '@图片1', '@图片2', '@图片3'],
      apiRefCount: 3,
      apiPlanUploadCount: 4,
      uploadSlotCount: 3,
      detailRefCount: 4,
      detailLabels: ['主图', '图片1', '图片2', '图片3'],
    },
  },
  {
    id: 'image 2·@资产:大牙+@图片1 Details 对齐 API 顺序',
    data: simNode({
      selectedModel: MODEL_IMAGE_2,
      imagePreview: 'https://ex/i2main.png',
      referenceImages: ['https://ex/pic1.png', 'https://ex/daya-lib.png'],
      referenceImageLabels: ['图片1', '大牙'],
      prompt: '@资产:大牙 参考 @图片1 的风格',
    }),
    projectAssets: [{ slug: '大牙', name: '大牙', url: 'https://ex/daya-lib.png' }],
    expect: {
      planImageTokens: ['@资产:大牙', '@图片1'],
      mentionInclude: ['@资产:大牙', '@图片1'],
      apiRefCount: 2,
      apiPlanUploadCount: 2,
      uploadSlotCount: 2,
      detailRefCount: 2,
      detailLabels: ['大牙', '图片1'],
    },
  },
  {
    id: 'image 2·@图片1同主图URL 不丢失',
    data: simNode({
      selectedModel: MODEL_IMAGE_2,
      imagePreview: 'https://ex/woods.png',
      referenceImages: ['https://ex/woods.png'],
      referenceImageLabels: ['图片1'],
      prompt: '@主图和@图片1融合在一起',
    }),
    expect: {
      planImageTokens: ['@主图', '@图片1'],
      mentionInclude: ['@主图', '@图片1'],
      uploadSlotCount: 1,
      apiRefCount: 1,
      detailRefCount: 2,
    },
  },
  {
    id: '可灵 2.5 Turbo',
    data: simNode({
      selectedModel: '可灵 2.5 Turbo',
      firstFrameImageUrl: 'https://ex/ff.png',
      lastFrameImageUrl: 'https://ex/lf.png',
      referenceImages: [],
      prompt: '@首帧图 运动 @尾帧图 衔接',
    }),
    expect: {
      planImageTokens: ['@首帧图', '@尾帧图'],
      mentionInclude: ['@首帧图', '@尾帧图'],
      apiHasStart: true,
      apiHasEnd: true,
      apiPlanUploadCount: 2,
      outputFramePanelClear: true,
      detailRefCount: 2,
      spawnPanelRefCount: 0,
    },
  },
  {
    id: 'vidu 2.0',
    data: simNode({
      selectedModel: 'vidu 2.0',
      firstFrameImageUrl: 'https://ex/vidu-start.png',
      prompt: '@首帧图 推进',
    }),
    expect: {
      planImageTokens: ['@首帧图'],
      mentionInclude: ['@首帧图'],
      apiHasStart: true,
      apiHasEnd: false,
      outputFramePanelClear: true,
      detailRefCount: 1,
    },
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
    expect: {
      planImageTokens: ['@首帧图', '@尾帧图'],
      apiHasStart: true,
      apiHasEnd: true,
      outputFramePanelClear: true,
    },
  },
  {
    id: 'seedance2.0 文生',
    data: simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'text',
      prompt: '纯文字描述',
    }),
    expect: {
      planImageTokens: [],
      mentionExclude: ['@主图', '@图片1'],
      apiRefCount: 0,
      uploadSlotCount: 0,
    },
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
    expect: {
      planImageTokens: ['@首帧图'],
      apiHasStart: true,
    },
  },
  {
    id: 'seedance2.0 参考生·仅@主图',
    data: simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: 'https://ex/sd-main.png',
      referenceImages: [],
      prompt: '@主图 运动',
      seedanceTabConfigs: { reference: { prompt: '@主图 运动' } },
    }),
    expect: {
      planImageTokens: ['@主图'],
      mentionInclude: ['@主图'],
      mentionExclude: ['@图片1'],
      apiRefCount: 1,
      uploadSlotCount: 0,
      gpLabels: ['主图'],
      detailRefCount: 1,
      detailLabels: ['主图'],
      outputPanelRefsEmpty: true,
      spawnPanelRefCount: 0,
    },
  },
  {
    id: 'seedance2.0 参考生·@主图+@图片2',
    data: simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: 'https://ex/sd-main.png',
      referenceImages: ['https://ex/sd-main.png', 'https://ex/sd2.png', 'https://ex/sd3.png'],
      prompt: '@主图 场景 @图片2 人物',
    }),
    expect: {
      planImageTokens: ['@主图', '@图片2'],
      mentionInclude: ['@主图', '@图片2'],
      apiRefCount: 2,
      uploadSlotCount: 3,
      detailRefCount: 2,
      outputPanelRefsEmpty: true,
      spawnPanelRefCount: 0,
    },
  },
  {
    id: 'seedance2.0 参考生·@资产:主图素材+@资产:参考素材',
    data: simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: 'https://ex/asset-stone.png',
      imageName: '石头',
      referenceImages: ['', 'https://ex/asset-bald.png'],
      referenceImageLabels: ['', '光头强'],
      prompt: '@资产:石头和@资产:光头强有了冲突，他们打了起来',
      seedanceTabConfigs: { reference: { prompt: '@资产:石头和@资产:光头强有了冲突，他们打了起来' } },
    }),
    projectAssets: [
      { slug: '石头', name: '石头', url: 'https://ex/asset-stone.png' },
      { slug: '光头强', name: '光头强', url: 'https://ex/asset-bald.png' },
    ],
    expect: {
      planImageTokens: ['@资产:石头', '@资产:光头强'],
      apiRefCount: 2,
      uploadSlotCount: 1,
      detailRefCount: 2,
      detailLabels: ['石头', '光头强'],
      outputPanelRefsEmpty: true,
      spawnPanelRefCount: 0,
    },
  },
  {
    id: 'seedance2.0 参考生·@主图+@图片3 纯图无参考视频',
    data: simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: 'https://ex/sd-main.png',
      referenceImages: ['https://ex/sd-main.png', '', 'https://ex/sd-pic3.png'],
      referenceImageLabels: ['主图', '', '图片3'],
      referenceMovs: [{ url: 'https://ex/stale-chain.mp4', posterDataUrl: 'https://ex/stale-poster.jpg' }],
      prompt: '@主图出现在@图片3中，让画面融合起来',
      seedanceTabConfigs: {
        reference: { prompt: '@主图出现在@图片3中，让画面融合起来' },
      },
    }),
    expect: {
      planImageTokens: ['@主图', '@图片3'],
      mentionInclude: ['@主图', '@图片3'],
      apiRefCount: 2,
      uploadSlotCount: 2,
      detailRefCount: 2,
      detailLabels: ['主图', '图片3'],
      gpRefMovCount: 0,
      detailRefMovCount: 0,
      outputPanelRefsEmpty: true,
      spawnPanelRefCount: 0,
    },
  },
  {
    id: 'seedance2.0 参考生·@资产:大牙+@图片1 Details 对齐 API 顺序',
    data: simNode({
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'reference',
      imagePreview: 'https://ex/sd-main.png',
      referenceImages: ['https://ex/sd-pic1.png', 'https://ex/sd-daya.png'],
      referenceImageLabels: ['图片1', '大牙'],
      prompt: '@资产:大牙 参考 @图片1 的风格',
      seedanceTabConfigs: { reference: { prompt: '@资产:大牙 参考 @图片1 的风格' } },
    }),
    projectAssets: [{ slug: '大牙', name: '大牙', url: 'https://ex/sd-daya.png' }],
    expect: {
      planImageTokens: ['@资产:大牙', '@图片1'],
      mentionInclude: ['@资产:大牙', '@图片1'],
      apiRefCount: 2,
      uploadSlotCount: 2,
      detailRefCount: 2,
      detailLabels: ['大牙', '图片1'],
      outputPanelRefsEmpty: true,
      spawnPanelRefCount: 0,
    },
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
    expect: {
      planImageTokens: ['@首帧图'],
      apiHasStart: true,
      detailRefCount: 1,
    },
  },
  {
    id: '可灵3.0 Omni multi',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      klingOmniMultiPrompt: 'Omni @主图 @图片2',
      imagePreview: 'https://ex/omni-main.png',
      klingOmniMultiReferenceImages: ['https://ex/o0.png', 'https://ex/o1.png'],
      prompt: '@主图 首帧 @图片2 参考',
    }),
    expect: {
      planImageTokens: ['@主图', '@图片2'],
      mentionInclude: ['@主图', '@图片2'],
      apiRefCount: 1,
      apiPlanUploadCount: 2,
      uploadSlotCount: 2,
      detailRefCount: 2,
    },
  },
  {
    id: '可灵3.0 Omni multi 视频槽',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      klingOmniMultiPrompt: '@主图 @视频1 运动',
      imagePreview: 'https://ex/omni-main.png',
      klingOmniMultiReferenceImages: ['https://ex/ref-vid.mp4'],
      prompt: '@主图 @视频1 运动',
    }),
    expect: {
      planVideoTokens: ['@视频1'],
      mentionInclude: ['@主图', '@视频1'],
      mentionExclude: ['@图片1'],
    },
  },
  {
    id: '可灵3.0 Omni multi 视频poster槽',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      klingOmniMultiPrompt: '@主图 @视频1 融合',
      imagePreview: 'https://ex/omni-main.png',
      klingOmniMultiReferenceImages: ['https://ex/ref-poster.png'],
      referenceImageLabels: ['视频1'],
      referenceMovs: [{ url: 'https://ex/ref-vid.mp4', posterDataUrl: 'https://ex/ref-poster.png' }],
      prompt: '@主图 @视频1 融合',
    }),
    expect: {
      planVideoTokens: ['@视频1'],
      mentionInclude: ['@视频1'],
      mentionExclude: ['@图片1'],
    },
  },
  {
    id: '可灵3.0 Omni instruction',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'instruction',
      klingOmniInstructionPrompt: '指令 @图片1 @视频1',
      klingOmniInstructionReferenceImages: ['https://ex/inst1.png'],
      klingOmniInstructionVideoUrl: 'https://ex/inst-vid.mp4',
      klingOmniInstructionVideoPreviewUrl: 'blob:vid',
      prompt: '@图片1 换装 @视频1',
    }),
    expect: {
      planImageTokens: ['@图片1'],
      planVideoTokens: ['@视频1'],
      mentionInclude: ['@图片1', '@视频1'],
      apiRefCount: 1,
      uploadSlotCount: 1,
    },
  },
  {
    id: '可灵3.0 Omni instruction·@主视频 PNG截帧（900788）',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'instruction',
      klingOmniInstructionPrompt: '@主视频中角色替换@图片3中的角色',
      imagePreview: 'https://ex/poster.png',
      klingOmniInstructionVideoUrl: 'https://ex/ref-vid.mp4',
      klingOmniInstructionReferenceImages: ['', '', 'https://ex/p3.png'],
      referenceMovs: [{ url: 'https://ex/ref-vid.mp4' }],
      prompt: '@主视频中角色替换@图片3中的角色',
    }),
    expect: {
      planVideoTokens: ['@主视频'],
      mentionInclude: ['@主视频'],
      mentionExclude: ['@视频1'],
      detailRefVideoLabels: ['主视频'],
    },
  },
  {
    id: '可灵3.0 Omni video',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'video',
      klingOmniVideoPrompt: '视频续写 @图片1',
      klingOmniVideoReferenceImages: ['https://ex/vref.png'],
      prompt: '@图片1 续镜',
    }),
    expect: {
      planImageTokens: ['@图片1'],
      apiRefCount: 1,
      uploadSlotCount: 1,
    },
  },
  {
    id: '可灵3.0 Omni video·@视频1 Details 标签（990）',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'video',
      klingOmniVideoPrompt: '@主图中的角色参考@视频1的动作运动起来',
      imagePreview: 'https://ex/main.png',
      klingOmniVideoUrl: 'https://ex/ref-vid.mp4',
      klingOmniVideoReferenceImages: [],
      referenceMovs: [{ url: 'https://ex/ref-vid.mp4' }],
      prompt: '@主图中的角色参考@视频1的动作运动起来',
    }),
    expect: {
      planVideoTokens: ['@视频1'],
      mentionInclude: ['@视频1'],
      detailRefVideoLabels: ['视频1'],
    },
  },
  {
    id: '可灵3.0 Omni frames',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'frames',
      klingOmniFramesPrompt: '@首帧图 过渡到 @尾帧图',
      firstFrameImageUrl: 'https://ex/off.png',
      lastFrameImageUrl: 'https://ex/ole.png',
      prompt: '@首帧图 过渡到 @尾帧图',
    }),
    expect: {
      planImageTokens: ['@首帧图', '@尾帧图'],
      apiHasStart: true,
      apiHasEnd: true,
    },
  },
  {
    id: '空参考槽·@图片1 不可选',
    data: simNode({
      selectedModel: MODEL_NANO_BANANA_2,
      imagePreview: 'https://ex/only-main.png',
      referenceImages: [],
      prompt: '无 @',
    }),
    expect: {
      planImageTokens: [],
      mentionInclude: ['@主图'],
      mentionExclude: ['@图片1', '@图片2'],
      uploadSlotCount: 0,
    },
  },
];

console.log('\n=== 全模型媒体契约（表驱动）===\n');
for (const c of CASES) runContract(c);

console.log(`\n=== 契约测试汇总: ${pass} 通过, ${fail} 失败 ===\n`);
if (fail > 0) process.exit(1);

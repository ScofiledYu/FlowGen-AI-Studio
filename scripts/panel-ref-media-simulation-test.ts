/**
 * 模拟测试：属性面板参考图运行后不错位/丢失，且创意描述 @ 与 API 入参序号一致。
 * 不调用任何生成 API。
 *
 * npx tsx scripts/panel-ref-media-simulation-test.ts
 */
import type { NodeData } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2 } from '../types.ts';
import {
  buildPromptMediaRefContextFromNode,
  buildPromptMediaRefContextForRun,
  buildPromptMediaRefLabels,
  buildReferenceIndexOptionsFromPlan,
  collectReferencedMediaFromPrompt,
  resolveProjectAssetUrlForPromptToken,
  panelReferenceSlotLabel,
  omniMixedRefSlotCaption,
  resolvePromptPlaceholders,
  isDuplicateOfMainImagePreview,
  stripPanelRefsDuplicateOfMain,
  getNodeInspectorPromptText,
  buildNodePromptUpdatePatch,
  buildCanonicalInspectorPromptPatch,
  filterProjectAssetsForReferencedPlan,
  getCanonicalInspectorPromptText,
  remapPromptPanelImageTokensToAssetTokens,
  repairPromptStraySlotLabelDuplicates,
  remapPromptMainImageToAssetToken,
  collectPromptAssetScanRefs,
  scanPromptAppendMediaTokensForNode,
  scanPromptAppendAllTokens,
  matchAllPromptMediaTokens,
} from '../utils/promptMediaRefs.ts';
import {
  panelReferencesAlreadyContainUrl,
  tryAppendReferenceImageWithLabel,
  resolveMainImagePanelDisplayLabel,
  resolveReferenceSlotDisplayLabel,
  resolveReferenceImageLabelsAfterPanelRun,
  dedupeReferenceUrlList,
  appendPromptReferencedAssetDisplayEntries,
  buildPanelReferenceDisplayEntries,
  dedupePanelReferenceDisplayEntries,
  dedupeReferenceImageSlots,
  filterPanelReferenceDisplayEntriesExcludingMainPreview,
  panelRefDisplayDedupeKey,
  referenceImagesDedupePatchIfNeeded,
} from '../utils/referenceImageSlotLabels.ts';
import { enrichSpawnedStoryboardNodeData } from '../utils/enrichSpawnedStoryboardNode.ts';
import {
  applySeedanceReferencePlanToPanelSlots,
  buildPanelReferenceImagesAfterUpload,
  mergeReferenceImageUrlsPreservingPanelOrder,
  buildFirstLastFramePanelPatchFromPlan,
  mergeAndPrunePanelReferenceImagesAfterUpload,
  collectReferencedPanelImageSlots,
  mergeSeedancePanelReferenceImagesAfterUpload,
  OMNI_MULTI_FIRST_FRAME_TOKENS,
  populateUploadedRefBySlotFromMediaPlan,
  buildPanelImagePreviewPatchAfterRun,
  buildRunNodeImagePreviewPatch,
  panelReferenceDisplaySlots,
  shouldShowPanelMainImageSlot,
  shouldDedupePanelRefsAgainstMainPreview,
  panelReferenceLabelImagePreview,
  panelMergeOptionsForReferencedUpload,
  enrichPlanImagesWithPanelSlotIndexes,
  prunePanelReferenceImagesToPromptRefs,
  promptMentionsMainImageInText,
  promptPlanReferencesMainImage,
  slotOriginalFileConflictsWithPlanEntry,
  shouldUseSlotOriginalFileForUpload,
  buildReferenceOnlyImagesForApiPayload,
  assertDistinctUploadedRefsForPlan,
  resolveReferencedImageUploadSource,
} from '../utils/referencedMediaRun.ts';
import { buildReferenceImageDetailItemsFromPanel } from '../utils/promptMediaRefs.ts';
import {
  nodeUsesHiddenMainPreviewSlot,
  resolveNodeSelectionPreviewUrl,
} from '../utils/nodeDetailsPreview.ts';

let pass = 0;
let fail = 0;

/** 模拟节点数据（满足 NodeData 类型检查） */
function simNode(partial: Partial<NodeData> & { selectedModel: string }): NodeData {
  return { label: 'sim', ...partial } as NodeData;
}

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

function eq(a: unknown, b: unknown, name: string) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  ok(name, sa === sb, sa !== sb ? `got ${sa} want ${sb}` : undefined);
}

/** 模拟上传：URL 后加 |UP 标记 */
function mockUploadedByToken(
  plan: ReturnType<typeof collectReferencedMediaFromPrompt>
): Map<string, string> {
  const m = new Map<string, string>();
  for (const img of plan.images) {
    m.set(img.token, `${img.url}|UP`);
  }
  for (const v of plan.videos) {
    m.set(v.token, `${v.url}|UP`);
  }
  return m;
}

/** 模拟运行成功后的面板写回：按槽合并上传 URL，再去掉未 @ 的参考槽 */
function simulatePanelAfterRun(
  panelBefore: string[],
  plan: ReturnType<typeof collectReferencedMediaFromPrompt>,
  uploadedByToken: Map<string, string>,
  imagePreview?: string,
  projectAssetSlugToUrl?: Map<string, string>
): string[] {
  return mergeAndPrunePanelReferenceImagesAfterUpload(
    panelBefore,
    plan.images,
    uploadedByToken,
    panelMergeOptionsForReferencedUpload(
      plan.images,
      uploadedByToken,
      imagePreview,
      projectAssetSlugToUrl
    )
  );
}

function applyPrunedPanelToData(data: NodeData, panelAfter: string[]): NodeData {
  const model = data.selectedModel || '';
  if (model === '可灵3.0 Omni') {
    const tab = data.klingOmniTab || 'multi';
    if (tab === 'multi') {
      return { ...data, klingOmniMultiReferenceImages: [...panelAfter] };
    }
    if (tab === 'instruction') {
      return { ...data, klingOmniInstructionReferenceImages: [...panelAfter] };
    }
    if (tab === 'video') {
      return { ...data, klingOmniVideoReferenceImages: [...panelAfter] };
    }
  }
  return { ...data, referenceImages: [...panelAfter] };
}

function apiImageUrlsFromPlan(
  plan: ReturnType<typeof collectReferencedMediaFromPrompt>,
  uploadedByToken: Map<string, string>
): string[] {
  return plan.images.map((e) => uploadedByToken.get(e.token) || e.url);
}

function refArrayForModel(data: NodeData): string[] {
  const model = data.selectedModel || '';
  if (model === '可灵3.0 Omni') {
    const tab = data.klingOmniTab || 'multi';
    if (tab === 'multi') return [...(data.klingOmniMultiReferenceImages || [])];
    if (tab === 'instruction') {
      return [...(data.klingOmniInstructionReferenceImages || [])];
    }
    return [...(data.klingOmniVideoReferenceImages || [])];
  }
  if (model === '即梦3.0 Pro') {
    const f = data.firstFrameImageUrl || data.firstFrameImage;
    return f ? [f] : [];
  }
  return [...(data.referenceImages || [])];
}

function urlAtToken(data: NodeData, token: string): string | null {
  const ctx = buildPromptMediaRefContextFromNode(data);
  const labels = buildPromptMediaRefLabels(data, ctx);
  const alias =
    token === '@图片' ? '@图片1' : token === '@视频' ? '@视频1' : token === '@音频' ? '@音频1' : token;
  const item = labels.find((i) => i.insertText === alias);
  if (!item) return null;
  if (item.kind === 'image' && item.refImageIndex != null) {
    const arr = refArrayForModel(data);
    return arr[item.refImageIndex]?.trim() || null;
  }
  if (item.refFrameIndex === 0) {
    return (data.firstFrameImageUrl || data.firstFrameImage || '').trim() || null;
  }
  if (item.refFrameIndex === 1) {
    return (data.lastFrameImageUrl || data.lastFrameImage || '').trim() || null;
  }
  if (token === '@主图' || token === '@主体') return data.imagePreview?.trim() || null;
  return null;
}

function runModelScenario(
  name: string,
  data: NodeData,
  _panelKey: 'referenceImages' | 'klingOmniMultiReferenceImages' | 'klingOmniInstructionReferenceImages' | 'jimengImages',
  options?: { skipPanelPrune?: boolean }
) {
  const prompt = String(data.prompt || '').trim();
  const panelBefore = [...refArrayForModel(data)];
  const skipPrune = options?.skipPanelPrune || data.selectedModel === '即梦3.0 Pro';
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, new Map());
  ok(
    `${name}: 创意描述至少解析出1个@图片`,
    plan.images.length >= 1,
    plan.images.length === 0
      ? `labels=${buildPromptMediaRefLabels(data, ctx).map((i) => i.insertText).join(',')}`
      : undefined
  );
  const uploadedByToken = mockUploadedByToken(plan);
  const panelAfter = skipPrune
    ? buildPanelReferenceImagesAfterUpload(panelBefore, plan.images, uploadedByToken, {
        imagePreview: data.imagePreview,
      })
    : simulatePanelAfterRun(panelBefore, plan, uploadedByToken, data.imagePreview);
  const dataAfter = applyPrunedPanelToData(data, panelAfter);

  const maxRefSlot = Math.max(-1, ...plan.images.map((e) => e.refImageSlotIndex ?? -1));
  ok(
    `${name}: 面板长度覆盖已@最大槽`,
    panelAfter.length > maxRefSlot,
    `len=${panelAfter.length} maxSlot=${maxRefSlot}`
  );

  for (let i = 0; i < panelBefore.length; i++) {
    const before = panelBefore[i];
    const after = panelAfter[i] ?? '';
    const inPlan = plan.images.some(
      (e) =>
        e.refImageSlotIndex === i &&
        !['@主图', '@主体'].includes(e.token) &&
        uploadedByToken.has(e.token)
    );
    if (!inPlan) {
      if (skipPrune) {
        ok(`${name}: 未@槽${i}保留原图`, after === before || after === `${before}|UP`, `${after} vs ${before}`);
      } else {
        ok(`${name}: 未@槽${i}已清空`, !String(after).trim(), `got ${after}`);
      }
    } else {
      ok(`${name}: 已@槽${i}写回上传URL`, after.endsWith('|UP'), after);
    }
    void before;
  }

  for (const entry of plan.images) {
    const slotUrl = entry.refImageSlotIndex != null ? panelBefore[entry.refImageSlotIndex] : null;
    const resolved = urlAtToken(dataAfter, entry.token);
    const norm = (u: string | null) =>
      u ? u.replace(/\|UP$/i, '').split('?')[0] : null;
    ok(
      `${name}: ${entry.token} 解析到面板URL`,
      resolved != null &&
        (slotUrl == null || norm(resolved) === norm(slotUrl)),
      `token→${resolved} slot→${slotUrl}`
    );
    const up = uploadedByToken.get(entry.token);
    ok(
      `${name}: ${entry.token} API URL 来自该素材`,
      up === `${entry.url}|UP`,
      up || 'missing'
    );
  }

  const opts = buildReferenceIndexOptionsFromPlan(plan);
  const resolvedPrompt = resolvePromptPlaceholders(prompt, data, ctx, opts);
  for (const entry of plan.images) {
    const n = opts.referenceImageIndexByToken?.get(entry.token);
    ok(
      `${name}: ${entry.token} 展开含 [图${n}]`,
      n != null && resolvedPrompt.includes(`[图${n}]`),
      resolvedPrompt.slice(0, 120)
    );
    ok(
      `${name}: plan.imageIndex 与 token 映射一致`,
      entry.imageIndex === n,
      `imageIndex=${entry.imageIndex} map=${n}`
    );
  }

  const apiUrls = apiImageUrlsFromPlan(plan, uploadedByToken);
  ok(
    `${name}: API 参考图顺序=文案@出现顺序`,
    apiUrls.length === plan.images.length &&
      apiUrls.every((u, i) => u === `${plan.images[i].url}|UP`),
    JSON.stringify(apiUrls)
  );

  const videoTokens = [...prompt.matchAll(/@视频\d+/g)].map((m) => m[0]);
  for (const vt of videoTokens) {
    const ve = plan.videos.find((v) => v.token === vt);
    ok(`${name}: ${vt} 进入 API 视频列表`, ve != null, `videos=${plan.videos.map((v) => v.token).join(',')}`);
    if (ve) {
      const up = uploadedByToken.get(vt);
      ok(`${name}: ${vt} 上传映射`, up === `${ve.url}|UP`, up || 'missing');
    }
  }

  void _panelKey;
}

console.log('\n=== 1. 面板槽位合并（通用） ===\n');

{
  const panel = ['https://asset/a.png', 'https://drag/extra.png', 'https://asset/b.png'];
  const plan = {
    images: [
      {
        token: '@图片2',
        url: 'https://drag/extra.png',
        label: '图片2',
        refImageSlotIndex: 1,
        imageIndex: 1,
      },
      {
        token: '@图片1',
        url: 'https://asset/a.png',
        label: '图片1',
        refImageSlotIndex: 0,
        imageIndex: 2,
      },
    ],
    videos: [],
    audios: [],
  };
  const uploadedByToken = mockUploadedByToken(plan);
  const after = simulatePanelAfterRun(panel, plan, uploadedByToken);
  eq(
    after,
    ['https://asset/a.png|UP', 'https://drag/extra.png|UP'],
    '逆序@后保留槽0,1（未@槽2清空并去掉尾部空槽）'
  );
  ok('未@槽2已去掉', after.length === 2);
}

console.log('\n=== 2. 分镜克隆合并参考图 ===\n');

{
  const data = simNode({
    selectedModel: 'seedance2.0 (高质量版)',
    seedanceGenerationMode: 'reference',
    referenceImages: ['https://existing.png', 'https://drag-only.png'],
    prompt: '@资产:hero @图片2',
  });
  const enriched = enrichSpawnedStoryboardNodeData(
    data,
    'proj',
    new Map([['hero', 'https://hero.png']]),
    [{ slug: 'hero', name: '英雄', url: 'https://hero.png' }]
  );
  ok('分镜合并保留拖入项', enriched.referenceImages?.includes('https://drag-only.png') === true);
  ok('分镜合并含资产', enriched.referenceImages?.includes('https://hero.png') === true);
  ok('分镜合并格数>=2', (enriched.referenceImages?.length || 0) >= 2);
  ok('分镜合并资产槽展示名', enriched.referenceImageLabels?.some((l) => l === '英雄') === true);
}

{
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'image',
    imagePreview: 'https://cos/main-asset.png',
    firstFrameImage: 'https://cos/horse.png',
    lastFrameImage: 'https://cos/wolf.png',
    referenceImages: ['https://stale-ref.png'],
    prompt: '过渡 @首帧图 到 @尾帧图',
  });
  const enriched = enrichSpawnedStoryboardNodeData(data, 'proj', new Map());
  ok('图生克隆清空 referenceImages', (enriched.referenceImages || []).length === 0);
  ok('图生克隆保留首帧', enriched.firstFrameImage === 'https://cos/horse.png');
  ok('图生克隆保留尾帧', enriched.lastFrameImage === 'https://cos/wolf.png');
  ok(
    '图生 tab 快照同步首帧',
    enriched.seedanceTabConfigs?.image?.firstFrameImage === 'https://cos/horse.png'
  );
}

console.log('\n=== 3. 各模型场景（@ ↔ 面板 ↔ API） ===\n');

runModelScenario(
  'Seedance2.0 参考生',
  simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    imagePreview: 'https://main.png',
    referenceImages: ['https://lib/1.png', 'https://user/drag.png', 'https://lib/2.png'],
    prompt: '融合风格 @图片2 为主参考，@图片1 为辅',
  }),
  'referenceImages'
);

runModelScenario(
  'Nano Banana 2.0',
  simNode({
    selectedModel: 'Nano Banana 2.0',
    imagePreview: 'https://main.png',
    referenceImages: ['https://r0.png', 'https://r1-extra.png'],
    prompt: '@主图 主体 @图片1 细节',
  }),
  'referenceImages'
);

runModelScenario(
  'Image 2',
  simNode({
    selectedModel: 'image 2',
    imagePreview: 'https://main.png',
    referenceImages: ['https://a.png', 'https://b-drag.png', 'https://c.png'],
    prompt: '@图片3 背景 @图片1 前景',
  }),
  'referenceImages'
);

runModelScenario(
  '可灵3.0 Omni 多图',
  simNode({
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'multi',
    imagePreview: 'https://first-frame.png',
    klingOmniMultiReferenceImages: [
      'https://ref0.png',
      'https://ref1-drag.png',
      'https://ref2.png',
    ],
    prompt: '@主图 首帧 @图片2 参考人物',
  }),
  'klingOmniMultiReferenceImages'
);

runModelScenario(
  '可灵3.0 Omni 指令变换',
  simNode({
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'instruction',
    imagePreview: 'https://poster.jpg',
    klingOmniInstructionReferenceImages: ['https://inst0.png', 'https://inst1-drag.png'],
    klingOmniInstructionVideoPreviewUrl: 'blob:video-local',
    prompt: '@图片2 保持服装 @视频1',
  }),
  'klingOmniInstructionReferenceImages'
);

runModelScenario(
  '即梦3.0 Pro',
  simNode({
    selectedModel: '即梦3.0 Pro',
    jimengGenerationMode: 'image',
    imagePreview: 'https://jimeng-main.png',
    firstFrameImage: 'https://j0.png',
    prompt: '@首帧图 首帧人物',
  }),
  'referenceImages'
);

console.log('\n=== 4. 回归：Image2 不再压紧丢槽 ===\n');

{
  const panel = ['https://s0.png', 'https://s1.png', 'https://s2.png'];
  const data = simNode({
    selectedModel: 'image 2',
    referenceImages: panel,
    prompt: '@图片1 @图片3',
  });
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, new Map());
  const uploadedByToken = mockUploadedByToken(plan);
  const after = simulatePanelAfterRun(panel, plan, uploadedByToken);
  ok('槽0已@保留', after[0]?.endsWith('|UP'));
  ok('槽1未@已清空', !String(after[1] || '').trim());
  ok('槽2已@保留', after[2]?.endsWith('|UP'));
  ok('中间空槽保留占位', after.length === 3, `len=${after.length}`);
}

console.log('\n=== 5. 可灵 Omni multi：@图片1 不得占用首帧 URL ===\n');

{
  const firstFrameUrl = 'https://cos/first-frame.png';
  const foxUrl = 'https://cos/fox.png';
  const panel = ['https://local/fox.png', 'https://local/bg.png'];
  const plan = {
    images: [
      { token: '@主图', url: 'https://local/main.png', label: '主图', imageIndex: 1 },
      {
        token: '@图片1',
        url: 'https://local/fox.png',
        label: '图片1',
        refImageSlotIndex: 0,
        imageIndex: 2,
      },
    ],
    videos: [],
    audios: [],
  };
  const uploadedByToken = new Map<string, string>([
    ['@主图', firstFrameUrl],
    ['@图片1', firstFrameUrl],
    ['@图片2', 'https://cos/bg-up.png'],
  ]);
  const wrongMerged = buildPanelReferenceImagesAfterUpload(panel, plan.images, uploadedByToken, {
    uploadedMainUrl: firstFrameUrl,
    imagePreview: 'https://local/main.png',
  });
  ok('错误映射时图片1槽可能被掏空', wrongMerged[0] !== foxUrl || !wrongMerged[0]);

  uploadedByToken.set('@图片1', 'https://cos/fox-up.png');
  const fixedMerged = buildPanelReferenceImagesAfterUpload(panel, plan.images, uploadedByToken, {
    uploadedMainUrl: firstFrameUrl,
    imagePreview: 'https://local/main.png',
  });
  ok('修正后图片1槽保留狐狸上传URL', fixedMerged[0] === 'https://cos/fox-up.png', fixedMerged[0]);
  ok('@图片1 不在 Omni multi 首帧 token 集', !OMNI_MULTI_FIRST_FRAME_TOKENS.has('@图片1'));
}

console.log('\n=== 6. Omni multi：运行后主图 COS 不得占参考槽「图片1」 ===\n');

{
  const dataUrl = 'data:image/jpeg;base64,/9j/MAIN_PREVIEW_STUB';
  const foxUrl = 'https://cos/fox.png';
  const cosMain = 'https://cos/main-uploaded.png';
  const panel = [dataUrl, foxUrl];
  const plan = {
    images: [
      { token: '@主图', url: dataUrl, label: '主图', imageIndex: 1 },
      {
        token: '@图片2',
        url: foxUrl,
        label: '图片2',
        refImageSlotIndex: 1,
        imageIndex: 2,
      },
    ],
    videos: [],
    audios: [],
  };
  const uploadedByToken = new Map<string, string>([
    ['@主图', cosMain],
    ['@图片2', `${foxUrl}|UP`],
  ]);
  const after = buildPanelReferenceImagesAfterUpload(panel, plan.images, uploadedByToken, {
    uploadedMainUrl: cosMain,
    imagePreview: dataUrl,
  });
  ok('合并后仅保留狐狸参考槽', after.length === 1, JSON.stringify(after));
  ok('参考槽为狐狸上传 URL', after[0] === `${foxUrl}|UP`);
  ok('不含主图 COS', !after.includes(cosMain));
}

console.log('\n=== 7. Seedance 参考生：主图+三参考 @图片3 槽位对齐 ===\n');

{
  const main = 'https://cos.example.com/proj/assets/aa/file';
  const mainThumb = 'https://cos.example.com/proj/assets/aa/thumb';
  const dragon = 'https://cos.example.com/dragon.png';
  const street = 'https://cos.example.com/street.png';
  const man = 'https://cos.example.com/man-denim.png';
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    imagePreview: main,
    referenceImages: [mainThumb, dragon, street, man],
    prompt: '景别：@图片3全景/高角度',
  });
  const ctx = buildPromptMediaRefContextFromNode(data);
  const labels = buildPromptMediaRefLabels(data, ctx);
  const img3 = labels.find((i) => i.insertText === '@图片3');
  ok('@图片3 标签存在', img3 != null, labels.map((i) => i.insertText).join(','));
  const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, new Map());
  const entry3 = plan.images.find((e) => e.token === '@图片3');
  ok('@图片3 解析到牛仔男', entry3?.url === man, `got ${entry3?.url}`);
  ok('@图片3 refImageSlotIndex=3', entry3?.refImageSlotIndex === 3, `idx=${entry3?.refImageSlotIndex}`);
  const panelBefore = [...(data.referenceImages || [])];
  const uploadedByToken = new Map<string, string>([['@图片3', `${man}|UP`]]);
  const uploadedRefBySlot = new Map<number, string>();
  populateUploadedRefBySlotFromMediaPlan(plan.images, uploadedByToken, uploadedRefBySlot);
  const after = mergeSeedancePanelReferenceImagesAfterUpload(
    panelBefore,
    uploadedRefBySlot,
    main,
    main
  );
  ok('运行后槽3仍为牛仔上传URL', after[3] === `${man}|UP`, JSON.stringify(after));
  ok('运行后槽1仍为龙', after[1] === dragon, JSON.stringify(after));
  const slotted = applySeedanceReferencePlanToPanelSlots(
    [dragon, street],
    plan.images,
    { imagePreview: main }
  );
  ok('分镜按槽补全 @图片3', slotted[3] === man, JSON.stringify(slotted));
  const enriched = enrichSpawnedStoryboardNodeData(
    {
      ...data,
      referenceImages: [mainThumb, dragon, street, man],
      prompt: '@图片2 街景 @图片3 人物',
    },
    'proj',
    new Map()
  );
  ok('分镜 enrich @图片3 在槽3', enriched.referenceImages?.[3] === man, JSON.stringify(enriched.referenceImages));
  ok('分镜 enrich @图片2 在槽2', enriched.referenceImages?.[2] === street);
  const panelPersist = mergeSeedancePanelReferenceImagesAfterUpload(
    panelBefore,
    uploadedRefBySlot,
    main,
    main
  );
  ok('面板持久化长度不变', panelPersist.length === panelBefore.length, String(panelPersist.length));
}

console.log('\n=== 8. 运行后 prune：未@槽清空，@图片2/3 名称不变 ===\n');

{
  const main = 'https://cos.example.com/proj/assets/aa/file';
  const thumb = 'https://cos.example.com/proj/assets/aa/thumb';
  const dragon = 'https://cos.example.com/dragon.png';
  const street = 'https://cos.example.com/street.png';
  const man = 'https://cos.example.com/man.png';
  const sheet = 'https://cos.example.com/sheet.png';
  const panel = [thumb, dragon, street, man, sheet];
  const plan = collectReferencedMediaFromPrompt(
    '@图片2 街景 @图片3 人物',
    simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: main,
      referenceImages: panel,
    }),
    buildPromptMediaRefContextFromNode(
      simNode({
        selectedModel: 'seedance2.0 (急速版)',
        seedanceGenerationMode: 'reference',
        imagePreview: main,
        referenceImages: panel,
      })
    ),
    new Map()
  );
  const uploadedRefBySlot = new Map<number, string>([
    [2, `${street}|UP`],
    [3, `${man}|UP`],
  ]);
  const mergedFull = mergeSeedancePanelReferenceImagesAfterUpload(panel, uploadedRefBySlot, main, main);
  const pruned = prunePanelReferenceImagesToPromptRefs(panel, plan.images, mergedFull);
  ok('未@槽1/4 已清空', pruned[1] === '' && pruned[4] === undefined, JSON.stringify(pruned));
  ok('槽2仍为街景', pruned[2] === `${street}|UP`);
  ok('槽3仍为人物', pruned[3] === `${man}|UP`);
  const labels = resolveReferenceImageLabelsAfterPanelRun({
    panelBefore: panel,
    panelAfter: pruned,
    plan: { images: plan.images, videos: [], audios: [] },
  });
  ok('prune 后槽2/3 保留图片2/3 标签', labels[2] === '图片2' && labels[3] === '图片3', labels.join('|'));
  const prunedNode = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    imagePreview: main,
    referenceImages: pruned,
    referenceImageLabels: labels,
  });
  const plan2 = collectReferencedMediaFromPrompt(
    '@图片3 人物',
    prunedNode,
    buildPromptMediaRefContextFromNode(prunedNode),
    new Map()
  );
  ok('@图片3 仍指向槽3', plan2.images.find((e) => e.token === '@图片3')?.refImageSlotIndex === 3);
  const enrichedAfterPrune = enrichPlanImagesWithPanelSlotIndexes(pruned, plan.images, {
    referenceImageLabels: labels,
    imagePreview: main,
  });
  ok(
    '@图片3 enrich 仍指向槽3',
    enrichedAfterPrune.find((e) => e.token === '@图片3')?.refImageSlotIndex === 3
  );
}

console.log('\n=== 9. 全模型运行后 prune（Nano / image2 / Omni）===\n');

function runPruneScenario(
  name: string,
  data: NodeData,
  prompt: string,
  expectedSlots: { empty: number[]; kept: number[] }
) {
  const panelBefore = [...refArrayForModel(data)];
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, new Map());
  const uploadedByToken = mockUploadedByToken(plan);
  const panelAfter = simulatePanelAfterRun(panelBefore, plan, uploadedByToken, data.imagePreview);
  const dataAfter = applyPrunedPanelToData(data, panelAfter);
  for (const i of expectedSlots.empty) {
    ok(`${name}: 未@槽${i}已清空`, !String(panelAfter[i] || '').trim());
  }
  for (const i of expectedSlots.kept) {
    ok(`${name}: 已@槽${i}保留`, String(panelAfter[i] || '').endsWith('|UP'));
    const label = panelReferenceSlotLabel(
      i,
      panelAfter,
      data.imagePreview,
      data.selectedModel?.includes('seedance') ? 'seedanceSlot' : 'panelSlot'
    );
    const expectLabel =
      data.selectedModel?.includes('seedance') && i >= 1
        ? `图片${i}`
        : `图片${i + 1}`;
    ok(`${name}: 槽${i}标签仍为${expectLabel}`, label === expectLabel, label);
  }
  for (const entry of plan.images) {
    if (entry.refImageSlotIndex == null) continue;
    const plan2 = collectReferencedMediaFromPrompt(prompt, dataAfter, ctx, new Map());
    const hit = plan2.images.find((e) => e.token === entry.token);
    ok(
      `${name}: ${entry.token} 仍指向槽${entry.refImageSlotIndex}`,
      hit?.refImageSlotIndex === entry.refImageSlotIndex,
      `idx=${hit?.refImageSlotIndex}`
    );
  }
}

runPruneScenario(
  'Nano Banana 2.0',
  simNode({
    selectedModel: 'Nano Banana 2.0',
    imagePreview: 'https://main.png',
    referenceImages: ['https://r0.png', '', 'https://r2.png'],
  }),
  '@图片1 主体 @图片2 细节',
  { empty: [1], kept: [0, 2] }
);

runPruneScenario(
  'image 2',
  simNode({
    selectedModel: 'image 2',
    imagePreview: 'https://main.png',
    referenceImages: ['https://a.png', '', 'https://c.png'],
  }),
  '@图片1 前景 @图片2 背景',
  { empty: [1], kept: [0, 2] }
);

runPruneScenario(
  '可灵3.0 Omni 多图',
  simNode({
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'multi',
    imagePreview: 'https://first.png',
    klingOmniMultiReferenceImages: ['', 'https://r1.png', ''],
  }),
  '@主图 @图片1',
  { empty: [0, 2], kept: [1] }
);

console.log('\n=== 10. 首尾帧模型：仅 @首帧 / 仅 @尾帧 面板 prune ===\n');

{
  const planStartOnly = collectReferencedMediaFromPrompt(
    '镜头 @首帧图 推进',
    simNode({
      selectedModel: 'vidu 2.0',
      firstFrameImage: 'https://cos/first.png',
      lastFrameImage: 'https://cos/last.png',
    }),
    buildPromptMediaRefContextFromNode(
      simNode({
        selectedModel: 'vidu 2.0',
        firstFrameImage: 'https://cos/first.png',
        lastFrameImage: 'https://cos/last.png',
      })
    ),
    new Map()
  );
  const patchStart = buildFirstLastFramePanelPatchFromPlan(planStartOnly.images, {
    startUrl: 'https://cos/first-up.png',
  });
  ok('仅@首帧：保留首帧 URL', patchStart.firstFrameImageUrl === 'https://cos/first-up.png');
  ok('仅@首帧：清空尾帧', patchStart.lastFrameImage === undefined);
  ok('仅@首帧：尾帧 URL 已清', patchStart.lastFrameImageUrl === undefined);

  const planEndOnly = collectReferencedMediaFromPrompt(
    '过渡到 @尾帧图',
    simNode({
      selectedModel: '可灵 2.5 Turbo',
      firstFrameImage: 'https://cos/first.png',
      lastFrameImage: 'https://cos/last.png',
    }),
    buildPromptMediaRefContextFromNode(
      simNode({
        selectedModel: '可灵 2.5 Turbo',
        firstFrameImage: 'https://cos/first.png',
        lastFrameImage: 'https://cos/last.png',
      })
    ),
    new Map()
  );
  const patchEnd = buildFirstLastFramePanelPatchFromPlan(planEndOnly.images, {
    endUrl: 'https://cos/last-up.png',
  });
  ok('仅@尾帧：保留尾帧 URL', patchEnd.lastFrameImageUrl === 'https://cos/last-up.png');
  ok('仅@尾帧：清空首帧', patchEnd.firstFrameImage === undefined);

  const planBoth = collectReferencedMediaFromPrompt(
    '@首帧图 到 @尾帧图',
    simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'image',
      firstFrameImage: 'https://cos/a.png',
      lastFrameImage: 'https://cos/b.png',
    }),
    buildPromptMediaRefContextFromNode(
      simNode({
        selectedModel: 'seedance2.0 (急速版)',
        seedanceGenerationMode: 'image',
        firstFrameImage: 'https://cos/a.png',
        lastFrameImage: 'https://cos/b.png',
      })
    ),
    new Map()
  );
  const patchBoth = buildFirstLastFramePanelPatchFromPlan(planBoth.images, {
    startUrl: 'https://cos/a-up.png',
    endUrl: 'https://cos/b-up.png',
  });
  ok('双@：首帧保留', patchBoth.firstFrameImageUrl === 'https://cos/a-up.png');
  ok('双@：尾帧保留', patchBoth.lastFrameImageUrl === 'https://cos/b-up.png');
}

console.log('\n=== 12. 未 @主图：全模型主预览 / Details / 面板 ===\n');

function mockPlanUploaded(
  plan: ReturnType<typeof collectReferencedMediaFromPrompt>
): Map<string, string> {
  return mockUploadedByToken(plan);
}

{
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    imagePreview: 'https://cos/mountain.png',
    referenceImages: ['https://cos/thumb.png', 'https://cos/dragon.png', '', 'https://cos/fox.png'],
    prompt: '@图片3 动态',
  });
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, new Map());
  const uploaded = mockPlanUploaded(plan);
  const foxEntry = plan.images.find((e) => e.token === '@图片3');
  ok('Seedance参考: 未@主图', !promptPlanReferencesMainImage(plan.images));
  const preview = buildPanelImagePreviewPatchAfterRun(plan.images, uploaded);
  ok(
    'Seedance参考: 预览=首个@',
    preview.imagePreview === `${foxEntry?.url}|UP`,
    String(preview.imagePreview)
  );
  ok('Seedance参考: 运行后隐藏面板主图格', preview.panelMainSlotVisible === false);
  const merged = prunePanelReferenceImagesToPromptRefs(
    data.referenceImages || [],
    plan.images,
    mergeSeedancePanelReferenceImagesAfterUpload(
      data.referenceImages || [],
      new Map([[2, 'https://cos/fox.png|UP']]),
      undefined,
      undefined
    )
  );
  const details = buildReferenceImageDetailItemsFromPanel({
    ...data,
    imagePreview: preview.imagePreview,
    referenceImages: merged,
  });
  ok('Seedance参考: Details 无「主图」', !details.some((i) => i.label === '主图'));
}

{
  const data = simNode({
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'multi',
    imagePreview: 'https://cos/main.png',
    klingOmniMultiReferenceImages: ['https://cos/fox.png'],
    prompt: '@图片1 运动',
    klingOmniMultiPrompt: '@图片1 运动',
  });
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(
    data.klingOmniMultiPrompt!,
    data,
    ctx,
    new Map()
  );
  const uploaded = mockPlanUploaded(plan);
  const preview = buildPanelImagePreviewPatchAfterRun(plan.images, uploaded);
  ok('Omni multi: 未@主图', !promptPlanReferencesMainImage(plan.images));
  ok('Omni multi: 预览=图片1', preview.imagePreview === 'https://cos/fox.png|UP');
  const details = buildReferenceImageDetailItemsFromPanel({
    ...data,
    imagePreview: preview.imagePreview,
    klingOmniMultiReferenceImages: ['https://cos/fox.png|UP'],
  });
  ok('Omni multi: Details 无「主图」', !details.some((i) => i.label === '主图'));
}

{
  const data = simNode({
    selectedModel: 'vidu 2.0',
    imagePreview: 'https://cos/old-main.png',
    firstFrameImage: 'https://cos/horse.png',
    lastFrameImage: 'https://cos/wolf.png',
    prompt: '@尾帧图 过渡',
  });
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, new Map());
  const uploaded = mockPlanUploaded(plan);
  const preview = buildRunNodeImagePreviewPatch(plan.images, uploaded, {
    startUrl: 'https://cos/horse-up.png',
    endUrl: 'https://cos/wolf-up.png',
  });
  ok(
    'vidu: 仅@尾帧预览=尾帧',
    preview.imagePreview === 'https://cos/wolf.png|UP',
    String(preview.imagePreview)
  );
}

console.log('\n=== 12a. Nano 未 @主图：主预览=首个 @ 参考图 ===\n');

{
  const data = simNode({
    selectedModel: 'Nano Banana 2.0',
    imagePreview: 'https://cos/mountain.png',
    referenceImages: ['https://cos/fox.png'],
    prompt: '@图片1 成水墨风',
  });
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, new Map());
  const uploaded = mockUploadedByToken(plan);
  ok('文案未 @主图', !promptMentionsMainImageInText(data.prompt!));
  const previewPatch = buildPanelImagePreviewPatchAfterRun(plan.images, uploaded);
  ok('imagePreview 改为首个 @ 图', previewPatch.imagePreview === 'https://cos/fox.png|UP');
  ok('运行后隐藏面板主图格', previewPatch.panelMainSlotVisible === false);
  ok(
    '拖入后默认展示主图格',
    shouldShowPanelMainImageSlot({
      imagePreview: 'https://cos/mountain.png',
      panelMainSlotVisible: undefined,
    })
  );
  ok(
    '运行后未@主图不展示主图格',
    !shouldShowPanelMainImageSlot({
      imagePreview: 'https://cos/fox.png|UP',
      panelMainSlotVisible: false,
    })
  );
  const merged = mergeAndPrunePanelReferenceImagesAfterUpload(
    data.referenceImages || [],
    plan.images,
    uploaded,
    panelMergeOptionsForReferencedUpload(plan.images, uploaded, data.imagePreview)
  );
  ok('参考槽仍保留狐狸', merged[0] === 'https://cos/fox.png|UP');
  ok('合并时未因主图去重掏空参考', merged.length >= 1);
}

console.log('\n=== 12a-main. Nano 仅 @主图：勿出现重复「图片1」槽 ===\n');

{
  const main = 'https://cos.example.com/proj/assets/aa/file';
  const dupRef = 'https://cos.example.com/proj/assets/aa/thumb';
  const data = simNode({
    selectedModel: 'Nano Banana 2.0',
    imagePreview: main,
    referenceImages: [dupRef],
    prompt: '把这张图片@主图变成二维风格',
  });
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, new Map());
  ok('plan 仅含 @主图', plan.images.length === 1 && plan.images[0].token === '@主图');
  const uploaded = mockUploadedByToken(plan);
  const merged = mergeAndPrunePanelReferenceImagesAfterUpload(
    data.referenceImages || [],
    plan.images,
    uploaded,
    panelMergeOptionsForReferencedUpload(plan.images, uploaded, data.imagePreview)
  );
  ok('运行合并后参考槽为空', merged.length === 0, JSON.stringify(merged));
  const pruned = prunePanelReferenceImagesToPromptRefs(
    data.referenceImages,
    plan.images,
    merged
  );
  ok('prune 后参考槽为空', pruned.length === 0);
  const display = buildPanelReferenceDisplayEntries(data.referenceImages, {
    imagePreview: main,
    dedupeAgainstMain: true,
    projectAssets: [],
  });
  const filtered = filterPanelReferenceDisplayEntriesExcludingMainPreview(
    display,
    main,
    undefined,
    data.referenceImageLabels,
    []
  );
  ok('展示层过滤后与主图同素材的参考格', filtered.length === 0, JSON.stringify(filtered));
  const patch = referenceImagesDedupePatchIfNeeded(data, { dedupeAgainstMain: true });
  ok('面板去重 patch 清空重复槽', patch?.referenceImages?.length === 0);
}

/** 同屏「图片n」底栏不得重复（主图格单独展示时不计入图片n） */
function assertDistinctImageNumberLabels(
  name: string,
  labels: string[],
  options?: { allowMain?: boolean }
) {
  const imageNs = labels.filter((l) => /^图片\d+$/.test(l));
  const ones = imageNs.filter((l) => l === '图片1');
  ok(`${name}: 至多一个「图片1」`, ones.length <= 1, imageNs.join(','));
  ok(`${name}: 图片n 标签互不重复`, new Set(imageNs).size === imageNs.length, imageNs.join(','));
  if (options?.allowMain) {
    ok(`${name}: 主图与图片1 可并存`, labels.includes('主图') || ones.length <= 1);
  }
}

console.log('\n=== 15. 全模型参考格底栏：不与 @ 槽位错位、不重复图片1 ===\n');

{
  const main = 'https://cos/main.png';
  const a = 'https://cos/a.png';
  const b = 'https://cos/b.png';
  const refs = [a, b];
  const nanoLabels = refs.map((_, i) =>
    panelReferenceSlotLabel(i, refs, panelReferenceLabelImagePreview({ imagePreview: main }))
  );
  assertDistinctImageNumberLabels('Nano panelSlot', nanoLabels, { allowMain: true });
  ok('Nano 槽0=图片1', nanoLabels[0] === '图片1');
  ok('Nano 槽1=图片2', nanoLabels[1] === '图片2');

  const image2Labels = refs.map((_, i) =>
    panelReferenceSlotLabel(i, refs, panelReferenceLabelImagePreview({ imagePreview: main }))
  );
  assertDistinctImageNumberLabels('image2 panelSlot', image2Labels, { allowMain: true });

  const omniLabels = [0, 1].map((i) => omniMixedRefSlotCaption(i, [a, b], main));
  assertDistinctImageNumberLabels('Omni multi 连续槽', omniLabels, { allowMain: true });
  ok('Omni 槽0=图片1', omniLabels[0] === '图片1');
  ok('Omni 槽1=图片2', omniLabels[1] === '图片2');

  const omniGapped = ['', a, b];
  const omniGapLabels = [1, 2].map((i) => omniMixedRefSlotCaption(i, omniGapped, main));
  assertDistinctImageNumberLabels('Omni 前置空槽 origIdx', omniGapLabels, { allowMain: true });
  ok('Omni origIdx1=图片2', omniGapLabels[0] === '图片2');
  ok('Omni origIdx2=图片3', omniGapLabels[1] === '图片3');

  const omniAfterRun = [a, b];
  const omniRunLabels = [0, 1].map((i) =>
    omniMixedRefSlotCaption(
      i,
      omniAfterRun,
      panelReferenceLabelImagePreview({
        imagePreview: a,
        panelMainSlotVisible: false,
      })
    )
  );
  assertDistinctImageNumberLabels('Omni 未@主图', omniRunLabels);
  ok(
    'Omni 首槽与画布同图仍标图片1',
    omniRunLabels[0] === '图片1' && omniRunLabels[1] === '图片2'
  );
}

console.log('\n=== 16. Seedance 参考生：运行后保留 @ 到的参考图槽 ===\n');

{
  const main = 'https://cos.example.com/proj/assets/aa/file';
  const thumb = 'https://cos.example.com/proj/assets/aa/thumb';
  const dragon = 'https://cos.example.com/dragon.png';
  const street = 'https://cos.example.com/street.png';
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    imagePreview: main,
    referenceImages: [thumb, dragon, street],
    prompt: '@图片1 龙 @图片2 街景',
    seedanceTabConfigs: {
      reference: { prompt: '@图片1 龙 @图片2 街景' },
    },
  });
  const ctx = buildPromptMediaRefContextFromNode(data);
  const prompt = data.seedanceTabConfigs?.reference?.prompt || data.prompt!;
  const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, new Map());
  const uploaded = mockUploadedByToken(plan);
  const panelAfter = mergeAndPrunePanelReferenceImagesAfterUpload(
    data.referenceImages || [],
    plan.images,
    uploaded,
    panelMergeOptionsForReferencedUpload(plan.images, uploaded, data.imagePreview)
  );
  const slots = collectReferencedPanelImageSlots(data.referenceImages || [], plan.images);
  ok('plan 含 @图片1/@图片2', slots.has(1) && slots.has(2), [...slots].join(','));
  ok('槽1 龙保留上传 URL', panelAfter[1]?.endsWith('|UP'), panelAfter[1]);
  ok('槽2 街景保留上传 URL', panelAfter[2]?.endsWith('|UP'), panelAfter[2]);
  ok('未@槽0 已清空', !String(panelAfter[0] || '').trim());
  const previewPatch = buildPanelImagePreviewPatchAfterRun(plan.images, uploaded);
  const nodeAfter = {
    ...data,
    ...previewPatch,
    referenceImages: panelAfter,
  };
  const display = (nodeAfter.referenceImages || [])
    .map((url, slotIndex) => ({ url: String(url || '').trim(), slotIndex }))
    .filter((e) => Boolean(e.url))
    .filter(
      ({ url }) =>
        !shouldDedupePanelRefsAgainstMainPreview(nodeAfter) ||
        !isDuplicateOfMainImagePreview(url, nodeAfter.imagePreview)
    );
  ok('面板展示至少 2 张 @ 图', display.length >= 2, String(display.length));
}

console.log('\n=== 17. 全模型运行后 @ 槽写回（Omni 指令 tab）===\n');

runPruneScenario(
  '可灵3.0 Omni 指令',
  simNode({
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'instruction',
    imagePreview: 'https://main.png',
    klingOmniInstructionReferenceImages: [
      'https://r0.png',
      '',
      'https://r2.png',
    ],
  }),
  '@图片1 主体 @图片2 细节',
  { empty: [1], kept: [0, 2] }
);

{
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    prompt: '顶层旧文案',
    seedanceTabConfigs: { reference: { prompt: '@图片1 龙 @图片2 街景' } },
  });
  const prompt = getNodeInspectorPromptText(data);
  ok('Seedance 参考 tab 文案优先于顶层', prompt.includes('@图片1') && !prompt.includes('顶层旧文案'));
}

console.log('\n=== 20. 主图格：资产库同素材显示资产名 ===\n');

{
  const main = '/flowgen-api/projects/p1/assets/a1/file';
  const assets = [{ slug: '萧道', name: '萧道', url: main }];
  ok(
    '主图 URL 匹配资产库',
    resolveMainImagePanelDisplayLabel(main, { projectAssets: assets }) === '萧道'
  );
  ok(
    '主图 imageName 与库内同名',
    resolveMainImagePanelDisplayLabel('blob:local', {
      imageName: '萧道',
      projectAssets: assets,
    }) === '萧道'
  );
  ok(
    '参考槽与主图同素材不再标「主图」',
    resolveReferenceSlotDisplayLabel(
      0,
      [main],
      [],
      main,
      'seedanceSlot',
      assets,
      '萧道'
    ) === '萧道'
  );
}

console.log('\n=== 19. 属性面板参考槽：资产库同图去重 ===\n');

{
  const thumb = '/flowgen-api/projects/p1/assets/a1/thumb';
  const file = '/flowgen-api/projects/p1/assets/a1/file';
  ok('thumb 与 file 视为同一素材', panelReferencesAlreadyContainUrl([thumb], file));
  const first = tryAppendReferenceImageWithLabel([], [], thumb, '萧道');
  ok('首次追加成功', first.added && first.referenceImages.length === 1);
  const dup = tryAppendReferenceImageWithLabel(
    first.referenceImages,
    first.referenceImageLabels,
    file,
    '萧道'
  );
  ok('重复追加被拒绝', !dup.added && dup.referenceImages.length === 1);
  ok('展示名保留', dup.referenceImageLabels[0] === '萧道');
}

console.log('\n=== 18. Seedance 参考生：仅 @资产 按 assetId 保留槽（thumb≠file）===\n');

{
  const proj = 'proj1';
  const idXiaodao = 'id-xd';
  const idChiwen = 'id-cw';
  const idXiamo = 'id-xm';
  const idStreet = 'id-st';
  const idBaize = 'id-bz';
  const slugMap = new Map<string, string>([
    ['萧道', `/flowgen-api/projects/${proj}/assets/${idXiaodao}/file`],
    ['鸱吻', `/flowgen-api/projects/${proj}/assets/${idChiwen}/file`],
    ['夏茉', `/flowgen-api/projects/${proj}/assets/${idXiamo}/file`],
  ]);
  const panel = [
    `/flowgen-api/projects/${proj}/assets/${idXiaodao}/thumb`,
    `/flowgen-api/projects/${proj}/assets/${idChiwen}/thumb`,
    `/flowgen-api/projects/${proj}/assets/${idXiamo}/thumb`,
    `/flowgen-api/projects/${proj}/assets/${idStreet}/thumb`,
    `/flowgen-api/projects/${proj}/assets/${idBaize}/thumb`,
  ];
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    referenceImages: panel,
    seedanceTabConfigs: {
      reference: { prompt: '@资产:萧道 联合 @资产:鸱吻 与 @资产:夏茉 特效' },
    },
  });
  const prompt = getNodeInspectorPromptText(data);
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, slugMap);
  ok('plan 含三个 @资产', plan.images.filter((e) => e.token.startsWith('@资产:')).length === 3);
  const uploaded = mockUploadedByToken(plan);
  const after = mergeAndPrunePanelReferenceImagesAfterUpload(
    panel,
    plan.images,
    uploaded,
    panelMergeOptionsForReferencedUpload(
      plan.images,
      uploaded,
      undefined,
      slugMap,
      ['萧道', '鸱吻', '夏茉', '', '']
    )
  );
  ok('槽0 萧道保留', after[0]?.endsWith('|UP'), after[0]);
  ok('槽1 鸱吻保留', after[1]?.endsWith('|UP'), after[1]);
  ok('槽2 夏茉保留', after[2]?.endsWith('|UP'), after[2]);
  ok('槽3 街景未@已清空', !String(after[3] || '').trim());
  ok('槽4 白泽未@已清空', !String(after[4] || '').trim());
  ok('未@资产尾部已弹', after.length === 3, `len=${after.length}`);
}

console.log('\n=== 18b. Seedance 运行：@资产: 萧逍（冒号后空格）按底栏标签保留槽 ===\n');

{
  const proj = 'proj-xiaoxiao';
  const idXiao = 'id-xx';
  const idChiwen = 'id-cw';
  const idXiamo = 'id-xm';
  const idStreet = 'id-st';
  const labels = ['萧逍', '鸱吻', '夏茉', '萧塘镇街道2'];
  const slugMap = new Map<string, string>([
    ['萧逍', `/flowgen-api/projects/${proj}/assets/${idXiao}/file`],
    ['鸱吻', `/flowgen-api/projects/${proj}/assets/${idChiwen}/file`],
    ['夏茉', `/flowgen-api/projects/${proj}/assets/${idXiamo}/file`],
    ['萧塘镇街道2', `/flowgen-api/projects/${proj}/assets/${idStreet}/file`],
  ]);
  const panel = [
    `/flowgen-api/projects/${proj}/assets/${idXiao}/thumb`,
    `/flowgen-api/projects/${proj}/assets/${idChiwen}/thumb`,
    `/flowgen-api/projects/${proj}/assets/${idXiamo}/thumb`,
    `/flowgen-api/projects/${proj}/assets/${idStreet}/thumb`,
  ];
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    referenceImages: panel,
    referenceImageLabels: labels,
    seedanceTabConfigs: {
      reference: {
        prompt:
          '萧逍@资产: 萧逍 的金光、鸱吻@资产:鸱吻 的风暴、夏茉@资产:夏茉 的箭、景别@资产: 萧塘镇街道2',
      },
    },
  });
  const prompt = getNodeInspectorPromptText(data);
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, slugMap);
  ok(
    'plan 含 @资产: 萧逍（空格）',
    plan.images.some((e) => e.token === '@资产:萧逍' || e.token === '@资产: 萧逍')
  );
  const uploaded = mockUploadedByToken(plan);
  const after = mergeAndPrunePanelReferenceImagesAfterUpload(
    panel,
    plan.images,
    uploaded,
    panelMergeOptionsForReferencedUpload(plan.images, uploaded, undefined, slugMap, labels)
  );
  ok('槽0 萧逍保留', after[0]?.endsWith('|UP'), after[0]);
  ok('槽1 鸱吻保留', after[1]?.endsWith('|UP'), after[1]);
  ok('槽2 夏茉保留', after[2]?.endsWith('|UP'), after[2]);
  ok('槽3 街景保留', after[3]?.endsWith('|UP'), after[3]);
  ok('四槽均保留', after.filter((u) => String(u).trim()).length === 4, `len=${after.length}`);
}

console.log('\n=== 28. 分镜克隆：下游参考格顺序一致，泛称「图片n」升级为资产名 ===\n');

{
  const proj = 'spawn-panel-proj';
  const idStreet = 'id-street';
  const idBoy = 'id-boy';
  const idDragon = 'id-dragon';
  const idGirl = 'id-girl';
  const streetThumb = `/flowgen-api/projects/${proj}/assets/${idStreet}/thumb`;
  const boyThumb = `/flowgen-api/projects/${proj}/assets/${idBoy}/thumb`;
  const dragonThumb = `/flowgen-api/projects/${proj}/assets/${idDragon}/thumb`;
  const girlThumb = `/flowgen-api/projects/${proj}/assets/${idGirl}/thumb`;
  const templateRefs = [streetThumb, boyThumb, dragonThumb, girlThumb];
  const templateLabels = ['图片1', '图片2', '图片3', '图片4'];
  const slugMap = new Map<string, string>([
    ['萧塘镇街道2', `/flowgen-api/projects/${proj}/assets/${idStreet}/file`],
    ['萧逍', `/flowgen-api/projects/${proj}/assets/${idBoy}/file`],
    ['鸱吻', `/flowgen-api/projects/${proj}/assets/${idDragon}/file`],
    ['夏茉', `/flowgen-api/projects/${proj}/assets/${idGirl}/file`],
  ]);
  const assets = [
    { slug: '萧塘镇街道2', name: '萧塘镇街道2', url: slugMap.get('萧塘镇街道2')! },
    { slug: '萧逍', name: '萧逍', url: slugMap.get('萧逍')! },
    { slug: '鸱吻', name: '鸱吻', url: slugMap.get('鸱吻')! },
    { slug: '夏茉', name: '夏茉', url: slugMap.get('夏茉')! },
  ];
  const rowPrompt =
    '景别@资产: 萧塘镇街道2\n画面：萧逍@资产: 萧逍、鸱吻@资产:鸱吻、夏茉@资产:夏茉';
  const template = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    referenceImages: templateRefs,
    referenceImageLabels: templateLabels,
    seedanceTabConfigs: {
      reference: {
        referenceImages: templateRefs,
        referenceImageLabels: templateLabels,
        prompt: '模板旧文案',
      },
    },
  });
  const spawned = enrichSpawnedStoryboardNodeData(
    {
      ...template,
      prompt: rowPrompt,
      seedanceTabConfigs: {
        reference: { ...(template.seedanceTabConfigs?.reference || {}), prompt: rowPrompt },
      },
    },
    proj,
    slugMap,
    assets
  );
  ok('下游仍为 4 槽', (spawned.referenceImages || []).length === 4);
  ok('槽0 仍为街景 thumb', spawned.referenceImages?.[0]?.includes(idStreet));
  ok('槽1 仍为萧逍 thumb', spawned.referenceImages?.[1]?.includes(idBoy));
  ok('槽2 仍为鸱吻 thumb', spawned.referenceImages?.[2]?.includes(idDragon));
  ok('槽3 仍为夏茉 thumb', spawned.referenceImages?.[3]?.includes(idGirl));
  ok('底栏槽0=萧塘镇街道2', spawned.referenceImageLabels?.[0] === '萧塘镇街道2');
  ok('底栏槽1=萧逍', spawned.referenceImageLabels?.[1] === '萧逍');
  ok('底栏槽2=鸱吻', spawned.referenceImageLabels?.[2] === '鸱吻');
  ok('底栏槽3=夏茉', spawned.referenceImageLabels?.[3] === '夏茉');
  ok('参考 tab 同步 4 槽', spawned.seedanceTabConfigs?.reference?.referenceImages?.length === 4);
  ok(
    '参考 tab 底栏为资产名',
    spawned.seedanceTabConfigs?.reference?.referenceImageLabels?.join(',') ===
      '萧塘镇街道2,萧逍,鸱吻,夏茉'
  );

  const nanoSpawned = enrichSpawnedStoryboardNodeData(
    simNode({
      selectedModel: 'Nano Banana 2.0',
      referenceImages: [boyThumb, dragonThumb],
      referenceImageLabels: ['图片1', '图片2'],
      prompt: '@资产:萧逍 @资产:鸱吻',
    }),
    proj,
    slugMap,
    assets
  );
  ok('Nano 克隆保留 2 槽顺序', (nanoSpawned.referenceImages || []).length === 2);
  ok('Nano 槽0 萧逍', nanoSpawned.referenceImages?.[0]?.includes(idBoy));
  ok('Nano 底栏萧逍', nanoSpawned.referenceImageLabels?.[0] === '萧逍');
  ok('Nano 底栏鸱吻', nanoSpawned.referenceImageLabels?.[1] === '鸱吻');
}

console.log('\n=== 29. Seedance 运行后：@资产:萧逍 槽保留（同 URL 不同槽 / 泛称底栏） ===\n');

{
  const proj = 'run-xiaoxiao';
  const idStreet = 'id-st';
  const idXiao = 'id-xx';
  const idCw = 'id-cw';
  const idXm = 'id-xm';
  const slugMap = new Map<string, string>([
    ['萧塘镇街道1', `/flowgen-api/projects/${proj}/assets/${idStreet}/file`],
    ['萧逍', `/flowgen-api/projects/${proj}/assets/${idXiao}/file`],
    ['鸱吻', `/flowgen-api/projects/${proj}/assets/${idCw}/file`],
    ['夏茉', `/flowgen-api/projects/${proj}/assets/${idXm}/file`],
  ]);
  const assets = [
    { slug: '萧塘镇街道1', name: '萧塘镇街道1', url: slugMap.get('萧塘镇街道1')! },
    { slug: '萧逍', name: '萧逍', url: slugMap.get('萧逍')! },
    { slug: '鸱吻', name: '鸱吻', url: slugMap.get('鸱吻')! },
    { slug: '夏茉', name: '夏茉', url: slugMap.get('夏茉')! },
  ];
  const panel = [
    `/flowgen-api/projects/${proj}/assets/${idStreet}/thumb`,
    `/flowgen-api/projects/${proj}/assets/${idXiao}/thumb`,
    `/flowgen-api/projects/${proj}/assets/${idCw}/thumb`,
    `/flowgen-api/projects/${proj}/assets/${idXm}/thumb`,
  ];
  const labels = ['萧塘镇街道1', '图片2', '鸱吻', '夏茉'];
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    referenceImages: panel,
    referenceImageLabels: labels,
    seedanceTabConfigs: {
      reference: {
        prompt:
          '景别@资产:萧塘镇街道1\n画面：萧逍@资产:萧逍 与 @资产:鸱吻、@资产:夏茉',
      },
    },
  });
  const prompt = getNodeInspectorPromptText(data);
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, slugMap, assets);
  ok('plan 含 @资产:萧逍', plan.images.some((e) => e.token.includes('萧逍')));
  ok(
    'plan 萧逍有槽位',
    plan.images.some(
      (e) =>
        (e.token.includes('萧逍') || e.label === '萧逍') &&
        e.refImageSlotIndex === 1
    )
  );
  const uploaded = mockUploadedByToken(plan);
  const after = mergeAndPrunePanelReferenceImagesAfterUpload(
    panel,
    plan.images,
    uploaded,
    panelMergeOptionsForReferencedUpload(plan.images, uploaded, undefined, slugMap, labels)
  );
  ok('运行后槽1 萧逍仍在', after[1]?.includes(idXiao), after[1]);
  ok('运行后四槽齐', after.filter((u) => String(u).trim()).length === 4, `len=${after.length}`);
  const synced = resolveReferenceImageLabelsAfterPanelRun({
    panelBefore: panel,
    labelsBefore: labels,
    panelAfter: after,
    plan,
    projectAssets: assets,
  });
  ok('运行后底栏萧逍', synced[1] === '萧逍', synced[1]);
}

console.log(
  '\n=== 30. Seedance：@资产:萧逍 仅在 imagePreview、参考格槽0 空（ep001 场景）===\n'
);

{
  const proj = '7b5c23a2-a38b-479a-9553-3fda49c5d5e7';
  const idXiao = '7171f71a-cd1a-4985-9acf-66583b1d149e';
  const idCw = 'id-cw';
  const idXm = 'id-xm';
  const idStreet = 'id-street';
  const xiaoFile = `/flowgen-api/projects/${proj}/assets/${idXiao}/file`;
  const panel = [
    '',
    `/flowgen-api/projects/${proj}/assets/${idCw}/thumb`,
    `/flowgen-api/projects/${proj}/assets/${idXm}/thumb`,
    `/flowgen-api/projects/${proj}/assets/${idStreet}/thumb`,
  ];
  const labels = ['', '鸱吻', '夏茉', '萧塘镇街道1'];
  const slugMap = new Map<string, string>([
    ['萧逍', xiaoFile],
    ['鸱吻', `/flowgen-api/projects/${proj}/assets/${idCw}/file`],
    ['夏茉', `/flowgen-api/projects/${proj}/assets/${idXm}/file`],
    ['萧塘镇街道1', `/flowgen-api/projects/${proj}/assets/${idStreet}/file`],
  ]);
  const assets = [
    { slug: '萧逍', name: '萧逍', url: xiaoFile },
    { slug: '鸱吻', name: '鸱吻', url: slugMap.get('鸱吻')! },
    { slug: '夏茉', name: '夏茉', url: slugMap.get('夏茉')! },
    { slug: '萧塘镇街道1', name: '萧塘镇街道1', url: slugMap.get('萧塘镇街道1')! },
  ];
  const prompt =
    '景别@资产:萧塘镇街道1 大全景\n画面：萧逍@资产:萧逍 的金光、鸱吻@资产:鸱吻 的风暴、夏茉@资产:夏茉 的箭';
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    imagePreview: xiaoFile,
    panelMainSlotVisible: undefined,
    referenceImages: panel,
    referenceImageLabels: labels,
    seedanceTabConfigs: { reference: { prompt } },
  });
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, slugMap, assets);
  ok('plan 含 @资产:萧逍', plan.images.some((e) => e.token.includes('萧逍')));
  const mergeOpts = panelMergeOptionsForReferencedUpload(
    plan.images,
    new Map(),
    xiaoFile,
    slugMap,
    labels,
    false
  );
  const enriched = enrichPlanImagesWithPanelSlotIndexes(panel, plan.images, mergeOpts);
  const xiaoEntry = enriched.find((e) => e.token.includes('萧逍'));
  ok(
    '萧逍 分配到槽0（主预览仅 imagePreview）',
    xiaoEntry?.refImageSlotIndex === 0,
    String(xiaoEntry?.refImageSlotIndex)
  );
  const uploaded = mockUploadedByToken(plan);
  const after = mergeAndPrunePanelReferenceImagesAfterUpload(
    panel,
    enriched,
    uploaded,
    panelMergeOptionsForReferencedUpload(
      enriched,
      uploaded,
      xiaoFile,
      slugMap,
      labels,
      false
    )
  );
  ok('运行后槽0=萧逍上传', after[0]?.includes(idXiao) && after[0]?.endsWith('|UP'), after[0]);
  ok('运行后槽1=鸱吻', after[1]?.includes(idCw), after[1]);
  ok('运行后槽3=街道', after[3]?.includes(idStreet), after[3]);
  ok('四槽均有内容', after.filter((u) => String(u).trim()).length === 4, JSON.stringify(after));
  const synced = resolveReferenceImageLabelsAfterPanelRun({
    panelBefore: panel,
    labelsBefore: labels,
    panelAfter: after,
    plan,
    projectAssets: assets,
  });
  ok('底栏槽0=萧逍', synced[0] === '萧逍', synced[0]);
}

console.log(
  '\n=== 31. @资产: 底栏标签命中但槽内为本地错图 → 解析/展示用资产库 URL ===\n'
);

{
  const proj = '7b5c23a2-a38b-479a-9553-3fda49c5d5e7';
  const idStreet = 'id-street-2';
  const libStreet = `/flowgen-api/projects/${proj}/assets/${idStreet}/file`;
  const wrongLocal = 'blob:http://localhost/wrong-gym-photo';
  ok(
    '解析优先资产库',
    resolveProjectAssetUrlForPromptToken(wrongLocal, libStreet) === libStreet
  );
  ok(
    '槽内 aitop COS 仍用资产库',
    resolveProjectAssetUrlForPromptToken(
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/567b17e9-c640-4c3d-a198-da6837842a20.png',
      libStreet
    ) === libStreet
  );
  ok(
    '同 assetId 仍可用槽内 URL',
    resolveProjectAssetUrlForPromptToken(
      `/flowgen-api/projects/${proj}/assets/${idStreet}/thumb`,
      libStreet
    )?.includes(idStreet)
  );
  const panel = [wrongLocal, '', '', ''];
  const labels = ['萧塘镇街道2', '', '', ''];
  const slugMap = new Map([['萧塘镇街道2', libStreet]]);
  const assets = [{ slug: '萧塘镇街道2', name: '萧塘镇街道2', url: libStreet }];
  const prompt = '景别@资产:萧塘镇街道2 全景';
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    referenceImages: panel,
    referenceImageLabels: labels,
    seedanceTabConfigs: { reference: { prompt } },
  });
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, slugMap, assets);
  const street = plan.images.find((e) => e.token.includes('萧塘镇街道2'));
  ok('plan URL 为资产库', street?.url === libStreet, street?.url);
  const display = buildPanelReferenceDisplayEntries(panel, {
    referenceImageLabels: labels,
    projectAssets: assets,
  });
  ok('展示用资产库缩略图', display[0]?.url === libStreet, display[0]?.url);
  const uploaded = mockUploadedByToken(plan);
  const mergeOpts = panelMergeOptionsForReferencedUpload(
    plan.images,
    uploaded,
    undefined,
    slugMap,
    labels,
    false
  );
  const enriched = enrichPlanImagesWithPanelSlotIndexes(panel, plan.images, mergeOpts);
  ok(
    '错图槽仍按标签落到槽0',
    enriched.find((e) => e.token.includes('萧塘镇街道2'))?.refImageSlotIndex === 0
  );
  const after = mergeAndPrunePanelReferenceImagesAfterUpload(
    panel,
    enriched,
    uploaded,
    mergeOpts
  );
  ok('运行后槽0 为街道上传', after[0]?.includes(idStreet) && after[0]?.endsWith('|UP'), after[0]);
}

console.log('\n=== 22. 无 prompt 分镜克隆仍去重参考槽 ===\n');

{
  const xiaodao =
    'https://cos.example.com/flowgen-api/projects/p1/assets/id-xd/file';
  const xiaodaoThumb =
    'https://cos.example.com/flowgen-api/projects/p1/assets/id-xd/thumb';
  const spawned = enrichSpawnedStoryboardNodeData(
    simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      referenceImages: [xiaodaoThumb, xiaodao, 'https://cos/cw.png'],
      referenceImageLabels: ['萧道', '萧道', '鸱吻'],
      prompt: '',
    }),
    'p1',
    new Map()
  );
  const filled = (spawned.referenceImages || []).filter((u) => String(u).trim());
  ok('无 prompt 也去重双萧道', filled.length === 2, JSON.stringify(filled));
  ok(
    '无 prompt 仅保留萧道+鸱吻各一',
    filled.filter((u) => u.includes('id-xd')).length === 1 &&
      filled.some((u) => u.includes('cw.png'))
  );
  ok(
    '展示层不出现双萧道',
    buildPanelReferenceDisplayEntries(spawned.referenceImages).filter((e) => e.url.includes('id-xd'))
      .length === 1
  );
  const patch = referenceImagesDedupePatchIfNeeded({
    referenceImages: [xiaodaoThumb, xiaodao],
    referenceImageLabels: ['萧道', '萧道'],
    imagePreview: xiaodao,
  });
  ok('inspector patch 去掉重复槽', patch != null && (patch.referenceImages?.filter((u) => u.trim()).length ?? 0) === 0);
}

console.log('\n=== 25. 全模型：@图片n → @资产:展示名（荒塘镇街道1 / @图片3） ===\n');

{
  const PROJ = 'prompt-canonical-proj';
  const xiaodao = `/flowgen-api/projects/${PROJ}/assets/id-xd/file`;
  const xiamo = `/flowgen-api/projects/${PROJ}/assets/id-xm/file`;
  const street = `/flowgen-api/projects/${PROJ}/assets/id-street/file`;
  const assets = [
    { slug: '萧道', name: '萧道', url: xiaodao },
    { slug: '夏茉', name: '夏茉', url: xiamo },
    { slug: '荒塘镇街道1', name: '荒塘镇街道1', url: street },
  ];
  const slugMap = new Map(assets.map((a) => [a.slug, a.url!]));
  const baseRefs = {
    referenceImages: [xiaodao, xiamo, street],
    referenceImageLabels: ['萧道', '夏茉', '荒塘镇街道1'],
  };
  const rawPrompt = '景别：@图片3全景/高角度\n画面：萧道@资产:萧道 与 @图片2';
  const models: Array<{ name: string; data: NodeData }> = [
    {
      name: 'Seedance2.0 参考生',
      data: simNode({
        selectedModel: 'seedance2.0 (急速版)',
        seedanceGenerationMode: 'reference',
        prompt: '顶层旧@图片3',
        seedanceTabConfigs: { reference: { prompt: rawPrompt, ...baseRefs } },
        ...baseRefs,
      }),
    },
    {
      name: 'Nano Banana 2.0',
      data: simNode({
        selectedModel: 'Nano Banana 2.0',
        prompt: rawPrompt,
        ...baseRefs,
      }),
    },
    {
      name: 'image 2',
      data: simNode({
        selectedModel: 'image 2',
        prompt: rawPrompt,
        ...baseRefs,
      }),
    },
    {
      name: '可灵3.0 Omni multi',
      data: simNode({
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'multi',
        klingOmniMultiPrompt: rawPrompt,
        klingOmniMultiReferenceImages: [...baseRefs.referenceImages],
        referenceImageLabels: [...baseRefs.referenceImageLabels],
      }),
    },
    {
      name: '即梦3.0 Pro',
      data: simNode({
        selectedModel: '即梦3.0 Pro',
        prompt: rawPrompt,
        imagePreview: xiaodao,
        ...baseRefs,
      }),
    },
    {
      name: 'vidu 2.0',
      data: simNode({
        selectedModel: 'vidu 2.0',
        prompt: rawPrompt,
        firstFrameImageUrl: xiaodao,
        ...baseRefs,
      }),
    },
  ];

  for (const { name, data } of models) {
    const canon = getCanonicalInspectorPromptText(data, assets);
    ok(`${name}: @图片3→@资产:荒塘镇街道1`, canon.includes('@资产:荒塘镇街道1'));
    ok(
      `${name}: @资产 与后文汉字有空格`,
      !/@资产:荒塘镇街道1[^\s@\/]/.test(canon) || canon.includes('@资产:荒塘镇街道1 ')
    );
    ok(`${name}: 不含裸 @图片3`, !/@图片3\b/.test(canon));
    const patch = buildCanonicalInspectorPromptPatch(data, assets);
    ok(`${name}: 写回 patch 存在`, patch != null);
    const merged = { ...data, ...patch } as NodeData;
    ok(
      `${name}: tab/顶层读取一致`,
      getNodeInspectorPromptText(merged) === canon
    );
    const ctx = buildPromptMediaRefContextForRun(merged, assets);
    const plan = collectReferencedMediaFromPrompt(canon, merged, ctx, slugMap, assets);
    ok(
      `${name}: plan 含 @资产:荒塘镇街道1`,
      plan.images.some((e) => e.token === '@资产:荒塘镇街道1' && e.url === street)
    );
    const labels = buildPromptMediaRefLabels(merged, ctx);
    const usesRefPanel =
      name.includes('Seedance') ||
      name.includes('Nano') ||
      name.includes('image') ||
      name.includes('Omni');
    if (usesRefPanel) {
      ok(
        `${name}: @ 列表含资产 token`,
        labels.some((i) => i.insertText === '@资产:荒塘镇街道1')
      );
    }
  }
}

console.log('\n=== 20c. Seedance 参考 tab 文案与顶层 prompt 不同步时以 tab 为准 ===\n');

{
  const tabPrompt = '景别：@资产:萧塘镇街道1 全景';
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    prompt: '景别：@图片1 全景',
    seedanceTabConfigs: {
      reference: { prompt: tabPrompt },
    },
  });
  ok('读取参考 tab 文案', getNodeInspectorPromptText(data) === tabPrompt);
  const syncPatch = buildNodePromptUpdatePatch(data, tabPrompt);
  ok('同步后顶层 prompt 与 tab 一致', syncPatch.prompt === tabPrompt);
  ok(
    '同步后 reference tab 保留 @资产',
    (syncPatch.seedanceTabConfigs as { reference?: { prompt?: string } })?.reference?.prompt ===
      tabPrompt
  );
}

console.log('\n=== 20b. 导出节点：主图相对路径 + 参考槽 localhost 同 assetId ===\n');

{
  const proj = '7b5c23a2-a38b-479a-9553-3fda49c5d5e7';
  const xiaodaoId = '7171f71a-cd1a-4985-9acf-66583b1d149e';
  const main = `/flowgen-api/projects/${proj}/assets/${xiaodaoId}/file`;
  const ref0 = `http://localhost:3001/flowgen-api/projects/${proj}/assets/${xiaodaoId}/file`;
  const chiwen = `http://localhost:3001/flowgen-api/projects/${proj}/assets/e2ef07fd-4566-4913-80ae-929be8b875b6/file`;
  const xiamo = `http://localhost:3001/flowgen-api/projects/${proj}/assets/b696508b-4b73-4e19-939d-111febee4f32/file`;
  ok('相对主图与绝对参考槽判为重复', isDuplicateOfMainImagePreview(ref0, main));
  const display = buildPanelReferenceDisplayEntries([ref0, chiwen, xiamo], {
    imagePreview: main,
    dedupeAgainstMain: true,
    referenceImageLabels: ['萧逍', '鸱吻', '夏茉'],
  });
  ok('展示层仅鸱吻+夏茉两格', display.length === 2, JSON.stringify(display.map((e) => e.slotIndex)));
  const patch = referenceImagesDedupePatchIfNeeded({
    imagePreview: main,
    referenceImages: [ref0, chiwen, xiamo],
    referenceImageLabels: ['萧逍', '鸱吻', '夏茉'],
    panelMainSlotVisible: true,
  });
  ok('写回 patch 清空与主图重复的槽0', patch != null && !String(patch.referenceImages?.[0] || '').trim());
  ok('写回后仍保留鸱吻夏茉', String(patch?.referenceImages?.[1] || '').includes('e2ef07fd'));
}

console.log('\n=== 21. 分镜克隆：参考格同素材不重复（萧道×2） ===\n');

{
  const xiaodao =
    'https://cos.example.com/flowgen-api/projects/p1/assets/id-xd/file';
  const xiaodaoThumb =
    'https://cos.example.com/flowgen-api/projects/p1/assets/id-xd/thumb';
  const chiwen = 'https://cos.example.com/flowgen-api/projects/p1/assets/id-cw/file';
  const xiamo = 'https://cos.example.com/flowgen-api/projects/p1/assets/id-xm/file';
  const assets = [
    { slug: '萧道/鸱吻/夏茉', name: '萧道', url: xiaodao },
    { slug: '鸱吻', name: '鸱吻', url: chiwen },
    { slug: '夏茉', name: '夏茉', url: xiamo },
  ];
  const slugMap = new Map(assets.map((a) => [a.slug, a.url]));
  const spawned = enrichSpawnedStoryboardNodeData(
    simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: xiaodao,
      referenceImages: [xiaodaoThumb, xiaodao, chiwen, xiamo],
      referenceImageLabels: ['萧道', '萧道', '鸱吻', '夏茉'],
      prompt: '@主图 男孩走向 @资产:萧道/鸱吻/夏茉 @资产:鸱吻 @资产:夏茉',
    }),
    'p1',
    slugMap,
    assets
  );
  const refs = (spawned.referenceImages || []).filter((u) => String(u).trim());
  const countXiaodao = refs.filter(
    (u) =>
      u.includes('id-xd') ||
      spawned.referenceImageLabels?.some((l, i) => l === '萧道' && spawned.referenceImages?.[i] === u)
  ).length;
  ok('分镜克隆后萧道至多 1 格', countXiaodao <= 1, `refs=${refs.length} xiaodao=${countXiaodao}`);
  ok('分镜仍保留鸱吻夏茉', refs.some((u) => u.includes('id-cw')) && refs.some((u) => u.includes('id-xm')));
  const nanoSpawned = enrichSpawnedStoryboardNodeData(
    simNode({
      selectedModel: 'Nano Banana 2.0',
      imagePreview: xiaodao,
      referenceImages: [xiaodao, chiwen],
      referenceImageLabels: ['萧道', '鸱吻'],
      prompt: '@主图 @图片1',
    }),
    'p1',
    slugMap,
    assets
  );
  const nanoRefs = (nanoSpawned.referenceImages || []).filter((u) => String(u).trim());
  ok(
    'Nano 分镜克隆去重主图重复槽',
    nanoRefs.filter((u) => u.includes('id-xd')).length <= 1,
    JSON.stringify(nanoRefs)
  );
  ok(
    'Omni 紧凑列表去重 thumb+file',
    dedupeReferenceUrlList([xiaodao, xiaodaoThumb, chiwen], { dedupeAgainstMain: false }).length === 2
  );
}

console.log('\n=== 14. Seedance 参考生：分镜下游参考格底栏不重复「图片1」 ===\n');

{
  const main = 'https://cos.example.com/proj/assets/aa/file';
  const dragon = 'https://cos.example.com/dragon.png';
  const other = 'https://cos.example.com/street.png';
  const refs = [dragon, other];
  ok(
    '槽0=图片1',
    panelReferenceSlotLabel(0, refs, main, 'seedanceSlot') === '图片1'
  );
  ok(
    '槽1=图片2（非重复图片1）',
    panelReferenceSlotLabel(1, refs, main, 'seedanceSlot') === '图片2'
  );
  const thumb = 'https://cos.example.com/proj/assets/aa/thumb';
  const refsWithDup = [dragon, thumb];
  ok(
    '槽0龙=图片1',
    panelReferenceSlotLabel(0, refsWithDup, main, 'seedanceSlot') === '图片1'
  );
  ok(
    '槽1与主图同素材=主图',
    panelReferenceSlotLabel(1, refsWithDup, main, 'seedanceSlot') === '主图'
  );
  const spawned = enrichSpawnedStoryboardNodeData(
    simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      imagePreview: main,
      referenceImages: [main, dragon, other],
      referenceImageLabels: ['', '图片1', '图片2'],
      prompt: '@主图 男孩 @图片1 龙 @图片2 街景',
    }),
    'proj',
    new Map()
  );
  const merged = spawned.referenceImages || [];
  ok('分镜 enrich 保留模板槽位数', merged.length >= 3, `len=${merged.length}`);
  ok('分镜仍含龙', merged.some((u) => u.includes('dragon')));
  ok('分镜仍含街景', merged.some((u) => u.includes('street')));
  ok('分镜底栏保留图片1', spawned.referenceImageLabels?.[1] === '图片1');
  ok('分镜底栏保留图片2', spawned.referenceImageLabels?.[2] === '图片2');
}

console.log('\n=== 12a-image2. image 2 未 @主图：主预览=首个 @ 参考图（对齐 Nano）===\n');

{
  const data = simNode({
    selectedModel: 'image 2',
    imagePreview: 'https://cos/mountain.png',
    referenceImages: ['https://cos/fox.png'],
    prompt: '@图片1 成水墨风',
  });
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, new Map());
  const uploaded = mockUploadedByToken(plan);
  ok('image2 文案未 @主图', !promptMentionsMainImageInText(data.prompt!));
  const previewPatch = buildPanelImagePreviewPatchAfterRun(plan.images, uploaded);
  ok('image2 imagePreview=首个 @ 图', previewPatch.imagePreview === 'https://cos/fox.png|UP');
  ok('image2 运行后隐藏面板主图格', previewPatch.panelMainSlotVisible === false);
  const merged = mergeAndPrunePanelReferenceImagesAfterUpload(
    data.referenceImages || [],
    plan.images,
    uploaded,
    panelMergeOptionsForReferencedUpload(plan.images, uploaded, previewPatch.imagePreview)
  );
  ok('image2 参考槽仍保留狐狸', merged[0] === 'https://cos/fox.png|UP');
  const nodeAfter = {
    ...data,
    ...previewPatch,
    referenceImages: merged,
  };
  ok('image2 未@主图时不按主预览去重参考格', !shouldDedupePanelRefsAgainstMainPreview(nodeAfter));
  ok('image2 画布主预览=上传后狐狸', nodeAfter.imagePreview === 'https://cos/fox.png|UP');
}

console.log('\n=== 12c-image2. image 2 @图片2+@图片1 未@主图：画布=首个@ ===\n');

{
  const mountain = 'https://cos/mountain-main.png';
  const ink = 'https://cos/ink-village.png';
  const photo = 'https://cos/misty-photo.png';
  const data = simNode({
    selectedModel: 'image 2',
    imagePreview: mountain,
    referenceImages: [ink, photo],
    prompt: '@图片2生成@图片1的风格',
  });
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, new Map());
  const uploaded = new Map<string, string>([
    ['@图片2', 'https://cos/misty-photo.png|UP'],
    ['@图片1', 'https://cos/ink-village.png|UP'],
  ]);
  const previewPatch = buildPanelImagePreviewPatchAfterRun(plan.images, uploaded);
  ok('image2 plan 顺序=文案出现顺序', plan.images[0]?.token === '@图片2' && plan.images[1]?.token === '@图片1');
  ok('image2 画布大图=首个@图片2', previewPatch.imagePreview === 'https://cos/misty-photo.png|UP');
  ok('image2 运行后隐藏主图格', previewPatch.panelMainSlotVisible === false);
}

console.log('\n=== 12c. Nano @图片2+@图片1 未@主图：画布=首个@，面板两格都显示 ===\n');

{
  const mountain = 'https://cos/mountain-main.png';
  const ink = 'https://cos/ink-village.png';
  const photo = 'https://cos/misty-photo.png';
  const data = simNode({
    selectedModel: 'Nano Banana 2.0',
    imagePreview: mountain,
    referenceImages: [ink, photo],
    prompt: '@图片2生成@图片1的风格',
  });
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, new Map());
  const uploaded = new Map<string, string>([
    ['@图片2', 'https://cos/misty-photo.png|UP'],
    ['@图片1', 'https://cos/ink-village.png|UP'],
  ]);
  ok('plan 顺序=文案出现顺序', plan.images[0]?.token === '@图片2' && plan.images[1]?.token === '@图片1');
  const previewPatch = buildPanelImagePreviewPatchAfterRun(plan.images, uploaded);
  ok('画布大图=首个@图片2', previewPatch.imagePreview === 'https://cos/misty-photo.png|UP');
  ok('运行后隐藏主图格', previewPatch.panelMainSlotVisible === false);
  const merged = mergeAndPrunePanelReferenceImagesAfterUpload(
    data.referenceImages || [],
    plan.images,
    uploaded,
    panelMergeOptionsForReferencedUpload(plan.images, uploaded, data.imagePreview)
  );
  ok('prune 后保留槽0/1', merged[0] === 'https://cos/ink-village.png|UP' && merged[1] === 'https://cos/misty-photo.png|UP');
  const nodeAfter = {
    ...data,
    imagePreview: previewPatch.imagePreview,
    panelMainSlotVisible: previewPatch.panelMainSlotVisible,
    referenceImages: merged,
  };
  ok('未@主图时不按主预览去重参考格', !shouldDedupePanelRefsAgainstMainPreview(nodeAfter));
  const display = panelReferenceDisplaySlots(merged).filter(
    ({ url }) =>
      !shouldDedupePanelRefsAgainstMainPreview(nodeAfter) ||
      !isDuplicateOfMainImagePreview(url, nodeAfter.imagePreview)
  );
  ok('面板展示 2 张', display.length === 2, `len=${display.length}`);
  ok('槽0 仍为图片1', panelReferenceSlotLabel(0, merged, undefined) === '图片1');
  ok(
    '槽1 仍为图片2（非主图）',
    panelReferenceSlotLabel(1, merged, panelReferenceLabelImagePreview(nodeAfter)) === '图片2'
  );
  ok(
    '槽1 URL 与画布预览相同也不标主图',
    panelReferenceSlotLabel(1, merged, nodeAfter.imagePreview) !== '主图' ||
      panelReferenceSlotLabel(1, merged, panelReferenceLabelImagePreview(nodeAfter)) === '图片2'
  );
}

console.log('\n=== 12b. 面板展示：prune 空槽不渲染 ===\n');

{
  const pruned = ['', 'https://cos/fox.png|UP', ''];
  const display = panelReferenceDisplaySlots(pruned);
  ok('空槽不进入展示列表', display.length === 1, JSON.stringify(display));
  ok('保留原槽下标 1', display[0]?.slotIndex === 1);
  ok('底栏仍为图片2', panelReferenceSlotLabel(1, pruned, undefined, 'panelSlot') === '图片2');
}

console.log('\n=== 13. 交付矩阵：剩余 tab / 模型 prune + @ 精准 ===\n');

runPruneScenario(
  '可灵3.0 Omni 视频参考',
  simNode({
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'video',
    klingOmniVideoReferenceImages: ['https://v0.png', '', 'https://v2.png'],
  }),
  '@图片1 续镜 @图片2 风格',
  { empty: [1], kept: [0, 2] }
);

runPruneScenario(
  'seedance1.5-pro 图生（面板无参考格）',
  simNode({
    selectedModel: 'seedance1.5-pro',
    seedanceGenerationMode: 'image',
    firstFrameImage: 'https://s15/a.png',
    lastFrameImage: 'https://s15/b.png',
  }),
  '@首帧图 推进',
  { empty: [], kept: [] }
);

{
  const data = simNode({
    selectedModel: '即梦3.0 Pro',
    jimengGenerationMode: 'image',
    imagePreview: 'https://jm/main.png',
    firstFrameImage: 'https://jm/first.png',
    lastFrameImage: 'https://jm/last.png',
  });
  const plan = collectReferencedMediaFromPrompt(
    '@首帧图 人物',
    data,
    buildPromptMediaRefContextFromNode(data),
    new Map()
  );
  const patch = buildFirstLastFramePanelPatchFromPlan(plan.images, {
    startUrl: 'https://jm/first-up.png',
  });
  ok('即梦仅@首帧：首帧保留', patch.firstFrameImageUrl === 'https://jm/first-up.png');
  ok('即梦仅@首帧：尾帧清空', patch.lastFrameImage === undefined);
  const labels = buildPromptMediaRefLabels(data, buildPromptMediaRefContextFromNode(data));
  ok('即梦标签含首帧图', labels.some((i) => i.insertText === '@首帧图'));
}

{
  const data = simNode({
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'frames',
    firstFrameImageUrl: 'https://omni/ff.png',
    lastFrameImageUrl: 'https://omni/lf.png',
  });
  const plan = collectReferencedMediaFromPrompt(
    '@尾帧图 结束',
    data,
    buildPromptMediaRefContextFromNode(data),
    new Map()
  );
  const patch = buildFirstLastFramePanelPatchFromPlan(plan.images, { endUrl: 'https://omni/lf-up.png' });
  ok('Omni首尾帧仅@尾帧：尾帧保留', patch.lastFrameImageUrl === 'https://omni/lf-up.png');
  ok('Omni首尾帧仅@尾帧：首帧清空', patch.firstFrameImage === undefined);
}

console.log('\n=== 11. Seedance 图生：blob 主图 + @首帧图 ===\n');

{
  const looksLikeVideo = (url: string): boolean => {
    if (!url) return false;
    if (/^data:image\//i.test(url)) return false;
    if (/\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/i.test(url)) return false;
    if (url.startsWith('blob:')) return false;
    return (
      /\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(url) ||
      /^data:video\//i.test(url) ||
      /kechuangai\.com\/ksc2\//i.test(url)
    );
  };
  const blobMain = 'blob:http://127.0.0.1/main-preview-abc';
  ok('blob 主预览不应判为视频', !looksLikeVideo(blobMain));
  const node = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'image',
    imagePreview: blobMain,
    lastFrameImage: 'https://cos/end.jpg',
    prompt: '让@首帧图合理运动到@尾帧图',
  });
  const ctx = buildPromptMediaRefContextFromNode(node);
  const plan = collectReferencedMediaFromPrompt(node.prompt!, node, ctx, new Map());
  ok('@首帧图 解析到主图 blob', plan.images.some((i) => i.token === '@首帧图' && i.url === blobMain));
  ok('@尾帧图 解析到尾帧', plan.images.some((i) => i.token === '@尾帧图'));
}

console.log('\n=== 12b. 运行后保留拖入展示名（URL 已上传替换） ===\n');

{
  const panelBefore = [
    '/flowgen-api/projects/p1/assets/id-xd/thumb',
    '/flowgen-api/projects/p1/assets/id-cw/thumb',
    'https://cos/street.png',
    'https://cos/man.png',
  ];
  const labelsBefore = ['萧道', '鸱吻', '街景', '牛仔男'];
  const panelAfter = [
    'https://cos-up.example.com/xd-up.png',
    'https://cos-up.example.com/cw-up.png',
    'https://cos-up.example.com/street-up.png',
    'https://cos-up.example.com/man-up.png',
  ];
  const assets = [
    {
      slug: 'xd',
      name: '萧道',
      url: '/flowgen-api/projects/p1/assets/id-xd/file',
    },
    {
      slug: 'cw',
      name: '鸱吻',
      url: '/flowgen-api/projects/p1/assets/id-cw/file',
    },
  ];
  const labels = resolveReferenceImageLabelsAfterPanelRun({
    panelBefore,
    labelsBefore,
    panelAfter,
    projectAssets: assets,
  });
  ok('运行后槽0仍为萧道', labels[0] === '萧道');
  ok('运行后槽1仍为鸱吻', labels[1] === '鸱吻');
  ok('运行后槽2仍为街景', labels[2] === '街景');
  ok('运行后槽3仍为牛仔男', labels[3] === '牛仔男');
}

console.log('\n=== 12. 模型 Prompt 展开：资产名 + [图N] ===\n');

const MODEL_DISPATCH_ASSETS = [
  { slug: '萧道/鸱吻/夏茉', name: '萧道', url: 'https://lib/xiaodao.png' },
  { slug: '荒塘镇街道1', name: '荒塘镇街道1', url: 'https://lib/huangtang.png' },
] as const;

function assertModelPromptDispatch(
  name: string,
  data: NodeData,
  prompt: string,
  slugMap: Map<string, string>
) {
  const ctx = buildPromptMediaRefContextForRun(data, [...MODEL_DISPATCH_ASSETS]);
  const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, slugMap, [...MODEL_DISPATCH_ASSETS]);
  const opts = buildReferenceIndexOptionsFromPlan(plan, { projectAssets: [...MODEL_DISPATCH_ASSETS] });
  const resolved = resolvePromptPlaceholders(prompt, data, ctx, opts);
  for (const entry of plan.images) {
    ok(`${name}: ${entry.token} plan.label 非 slug`, !entry.label.includes('萧道/鸱吻'));
    ok(
      `${name}: ${entry.token} 展开含资产/槽位名「${entry.label}」`,
      resolved.includes(entry.label),
      resolved.slice(0, 160)
    );
    const n = opts.referenceImageIndexByToken?.get(entry.token);
    ok(
      `${name}: ${entry.token} 展开含 [图${n}]`,
      n != null && resolved.includes(`[图${n}]`),
      resolved.slice(0, 160)
    );
  }
}

{
  const slugMap = new Map(MODEL_DISPATCH_ASSETS.map((a) => [a.slug, a.url]));
  const data = simNode({
    selectedModel: 'Nano Banana 2.0',
    referenceImages: ['https://panel/ref1.png'],
    referenceImageLabels: ['荒塘镇街道1'],
    prompt: '参考@图片1生成',
  });
  assertModelPromptDispatch('Nano @图片1', data, data.prompt!, slugMap);
}

{
  const slugMap = new Map([['萧道/鸱吻/夏茉', 'https://lib/xiaodao.png']]);
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    referenceImages: ['https://lib/xiaodao.png'],
    prompt: '用@资产:萧道/鸱吻/夏茉 做参考',
  });
  assertModelPromptDispatch('Seedance @资产', data, data.prompt!, slugMap);
  const ctx = buildPromptMediaRefContextForRun(data, [...MODEL_DISPATCH_ASSETS]);
  const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, slugMap, [...MODEL_DISPATCH_ASSETS]);
  ok('Seedance @资产 plan.label=萧道', plan.images[0]?.label === '萧道');
}

{
  const data = simNode({
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'frames',
    firstFrameImage: 'https://lib/huangtang.png',
    firstFrameImageLabel: '荒塘镇街道1',
    prompt: '从@首帧图 过渡到尾帧',
  });
  const ctx = buildPromptMediaRefContextForRun(data, [...MODEL_DISPATCH_ASSETS]);
  const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, new Map(), [...MODEL_DISPATCH_ASSETS]);
  const opts = buildReferenceIndexOptionsFromPlan(plan);
  const resolved = resolvePromptPlaceholders(data.prompt!, data, ctx, opts);
  const frame = plan.images.find((i) => i.token === '@首帧图');
  ok('Omni @首帧图 plan.label=荒塘镇街道1', frame?.label === '荒塘镇街道1');
  ok('Omni @首帧图 展开含荒塘镇街道1', resolved.includes('荒塘镇街道1'));
  ok('Omni @首帧图 展开含 [图1]', resolved.includes('[图1]'));
}

{
  const data = simNode({
    selectedModel: 'Nano Banana 2.0',
    imagePreview: 'https://lib/xiaodao.png',
    imageName: '萧道',
    prompt: '以@主图 为主体',
  });
  const ctx = buildPromptMediaRefContextForRun(data, [...MODEL_DISPATCH_ASSETS]);
  const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, new Map(), [...MODEL_DISPATCH_ASSETS]);
  const opts = buildReferenceIndexOptionsFromPlan(plan, { projectAssets: [...MODEL_DISPATCH_ASSETS] });
  const resolved = resolvePromptPlaceholders(data.prompt!, data, ctx, opts);
  ok('@主图 plan.label=萧道', plan.images[0]?.label === '萧道');
  ok('@主图 展开含萧道', resolved.includes('萧道'));
  ok('@主图 展开含 [图1]', resolved.includes('[图1]'));
}

console.log('\n=== 26. 扫描 @素材 不误匹配「主图」；修复 @主图 白泽 主图 ===\n');

{
  const assets = [{ slug: 'baize', name: '白泽', url: 'https://x/baize.png' }];
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    imagePreview: 'https://x/baize.png',
    imageName: '白泽',
    referenceImages: ['https://x/street2.png'],
    referenceImageLabels: ['荒塘镇街道2'],
    prompt: '白泽走向镜头',
  });
  const refs = collectPromptAssetScanRefs(data, [], assets);
  ok('扫描 refs 不含槽位标签「主图」', !refs.some((r) => r.label === '主图' || r.insertText === '@主图'));
  ok('扫描 refs 含白泽', refs.some((r) => r.label === '白泽' && r.insertText === '@资产:白泽'));
  const scanned = scanPromptAppendMediaTokensForNode(data, [], data.prompt, assets);
  ok('扫描后不含 @主图', !scanned.includes('@主图'));
  ok('扫描后含 @资产:白泽', scanned.includes('@资产:白泽'));
  const garbled = '@主图 白泽 主图 场景';
  const fixed = repairPromptStraySlotLabelDuplicates(garbled, data, assets);
  ok('修复 @主图 白泽 主图', fixed === '@资产:白泽 场景');
  const patch = buildCanonicalInspectorPromptPatch(
    { ...data, prompt: garbled, seedanceTabConfigs: { reference: { prompt: garbled } } },
    assets
  );
  ok('canonical patch 去掉冗余主图', patch != null && !String(patch.prompt).includes('@主图 白泽'));
  ok('canonical patch 写入 @资产:白泽', String(patch?.prompt).includes('@资产:白泽'));
}

console.log('\n=== 27. 误扫 @主图 错名（萧塘）→ 主槽资产名（荒塘镇街道1） ===\n');

{
  const assets = [
    { slug: 'street1', name: '荒塘镇街道1', url: 'https://x/huangtang.png' },
    { slug: 'xiamo', name: '夏茉', url: 'https://x/xiamo.png' },
    { slug: 'baize', name: '白泽', url: 'https://x/baize.png' },
  ];
  const data = simNode({
    selectedModel: 'Nano Banana 2.0',
    imagePreview: 'https://x/huangtang.png',
    imageName: '荒塘镇街道1',
    referenceImages: ['https://x/xiamo.png', 'https://x/baize.png'],
    referenceImageLabels: ['夏茉', '白泽'],
    prompt: '@主图 萧塘镇街道1 主图',
  });
  const fixed = repairPromptStraySlotLabelDuplicates(data.prompt!, data, assets);
  ok('错名误扫修复为 @资产:荒塘镇街道1', fixed === '@资产:荒塘镇街道1');
  const canon = getCanonicalInspectorPromptText(data, assets);
  ok('canonical 不含 @主图', !canon.includes('@主图'));
  ok('canonical 为资产名 token', canon.includes('@资产:荒塘镇街道1'));
  const remap = remapPromptMainImageToAssetToken('@主图 场景', data, assets);
  ok('裸 @主图 转资产名', remap === '@资产:荒塘镇街道1 场景');
}

console.log('\n=== 32. 125.json：槽1 空补 @资产:萧逍；MOV 下游 enrich 资产名底栏 ===\n');

{
  const chiwenCos =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/928ce8e0-b27a-42a0-a8f3-2f650fa34d79.png';
  const streetCos =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/4f8c2dbc-a6cf-45a3-b964-b5dd62cad19e.png';
  const gymCos =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/55367981-6a69-4871-ab27-d575968951e6.png';
  const xiaoLib =
    '/flowgen-api/projects/7b5c23a2-a38b-479a-9553-3fda49c5d5e7/assets/7171f71a-cd1a-4985-9acf-66583b1d149e/file';
  const panel = [chiwenCos, '', streetCos];
  const labels = ['鸱吻', '', '萧塘镇街道1'];
  const assets = [
    { slug: '萧逍', name: '萧逍', url: xiaoLib },
    { slug: '鸱吻', name: '鸱吻', url: 'https://lib/chiwen.png' },
    { slug: '萧塘镇街道1', name: '萧塘镇街道1', url: 'https://lib/street.png' },
  ];
  const slugMap = new Map([
    ['萧逍', xiaoLib],
    ['鸱吻', 'https://lib/chiwen.png'],
    ['萧塘镇街道1', 'https://lib/street.png'],
  ]);
  const prompt =
    '关联剧本：鸱吻@资产:鸱吻 亮相\n景别：@资产:萧塘镇街道1\n画面：萧逍@资产:萧逍 苦撑，鸱吻@资产:鸱吻 走出';
  const proc = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    panelMainSlotVisible: false,
    imagePreview: 'https://cos/generated.png',
    referenceImages: panel,
    referenceImageLabels: labels,
    prompt,
  });
  const ctx = buildPromptMediaRefContextForRun(proc, assets);
  const plan = collectReferencedMediaFromPrompt(prompt, proc, ctx, slugMap, assets);
  const enriched = enrichPlanImagesWithPanelSlotIndexes(panel, plan.images, {
    referenceImageLabels: labels,
    panelMainSlotVisible: false,
    projectAssetSlugToUrl: slugMap,
  });
  const xiao = enriched.find((e) => e.token.includes('萧逍'));
  ok('125 上游：萧逍 分配到空槽1', xiao?.refImageSlotIndex === 1, String(xiao?.refImageSlotIndex));
  const afterPlan = applySeedanceReferencePlanToPanelSlots(panel, enriched, {
    panelMainSlotVisible: false,
  });
  ok('125 上游：槽1 写入萧逍库图', afterPlan[1] === xiaoLib, afterPlan[1]);
  const mov = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    referenceImages: [chiwenCos, streetCos, gymCos],
    referenceImageLabels: ['', '', ''],
    prompt,
    seedanceTabConfigs: {
      reference: {
        referenceImages: [chiwenCos, streetCos, gymCos],
        referenceImageLabels: ['', '', ''],
      },
    },
  });
  const movEnriched = enrichSpawnedStoryboardNodeData(mov, '7b5c23a2', slugMap, assets);
  ok('125 下游：底栏含鸱吻', movEnriched.referenceImageLabels?.includes('鸱吻'));
  ok('125 下游：底栏含萧塘镇街道1', movEnriched.referenceImageLabels?.includes('萧塘镇街道1'));
  ok(
    '125 下游：底栏无泛称图片1',
    !(movEnriched.referenceImageLabels || []).some((l) => l === '图片1' || l === '图片2')
  );
  const inputOnly = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    imagePreview: xiaoLib,
    imageName: '萧逍',
    referenceImages: [],
    referenceImageLabels: [],
  });
  const inputEntries = buildPanelReferenceDisplayEntries(inputOnly.referenceImages, {
    projectAssets: assets,
  });
  let inputDisplay = appendPromptReferencedAssetDisplayEntries(
    inputEntries,
    '',
    assets,
    inputOnly.referenceImageLabels
  );
  if (!inputDisplay.length && inputOnly.imagePreview?.trim() && inputOnly.imageName?.trim()) {
    inputDisplay = [{ url: xiaoLib, slotIndex: 0 }];
  }
  ok('125 输入节点：空参考格仍展示萧逍', inputDisplay.some((e) => e.url.includes('7171f71a')));
}

console.log('\n=== 33. 同资产名不重复展示（萧逍 + 图片1 同槽）===\n');

{
  const xiaoLib =
    '/flowgen-api/projects/7b5c23a2-a38b-479a-9553-3fda49c5d5e7/assets/7171f71a-cd1a-4985-9acf-66583b1d149e/file';
  const assets = [{ slug: '萧逍', name: '萧逍', url: xiaoLib }];
  const prompt = '萧逍@资产:萧逍 苦撑';
  const refs = [xiaoLib, xiaoLib];
  const labels = ['萧逍', '图片1'];
  const base = buildPanelReferenceDisplayEntries(refs, {
    referenceImageLabels: labels,
    projectAssets: assets,
  });
  ok('buildPanel 同 assetId 只保留一格', base.length === 1, `len=${base.length}`);
  const merged = dedupePanelReferenceDisplayEntries(
    appendPromptReferencedAssetDisplayEntries(base, prompt, assets, labels),
    labels,
    assets
  );
  ok('append 后仍只有一张萧逍', merged.length === 1, `len=${merged.length}`);
  ok('底栏名为萧逍', merged[0] && labels[merged[0].slotIndex] !== '图片1' || merged.length === 1);
}

console.log('\n=== 34. 主图格 + 参考格同资产（萧道）只展示一次 ===\n');

{
  const xiaoLib =
    '/flowgen-api/projects/p1/assets/aa/file';
  const xiaoThumb = '/flowgen-api/projects/p1/assets/aa/thumb';
  const assets = [{ slug: '萧道', name: '萧道', url: xiaoLib }];
  const refs = [xiaoLib];
  const labels = ['萧道'];
  ok(
    'thumb/file 与主图判为重复',
    isDuplicateOfMainImagePreview(xiaoLib, xiaoThumb)
  );
  ok(
    'strip 参考表去掉与主图同 asset',
    stripPanelRefsDuplicateOfMain(refs, xiaoThumb).length === 0
  );
  const base = buildPanelReferenceDisplayEntries(refs, {
    imagePreview: xiaoThumb,
    dedupeAgainstMain: true,
    referenceImageLabels: labels,
    projectAssets: assets,
  });
  ok('展示列表不含与主图重复槽', base.length === 0, `len=${base.length}`);
  const withMain = filterPanelReferenceDisplayEntriesExcludingMainPreview(
    [{ url: xiaoLib, slotIndex: 0 }],
    xiaoThumb,
    '萧道',
    labels,
    assets
  );
  ok('主图已显时过滤参考格同资产', withMain.length === 0);
  ok(
    'dedupeKey 主图与参考一致',
    panelRefDisplayDedupeKey(xiaoThumb, '萧道', assets) ===
      panelRefDisplayDedupeKey(xiaoLib, '萧道', assets)
  );
}

console.log('\n=== 35. 同资产名双槽（COS+库图）展示与数据去重 ===\n');

{
  const lib =
    '/flowgen-api/projects/p1/assets/aa/file';
  const cos1 = 'https://cos.example.com/upload-a.png';
  const cos2 = 'https://cos.example.com/upload-b.png';
  const assets = [{ slug: '萧道', name: '萧道', url: lib }];
  const refs = [cos1, cos2];
  const labels = ['萧道', '萧道'];
  const display = buildPanelReferenceDisplayEntries(refs, {
    referenceImageLabels: labels,
    projectAssets: assets,
  });
  ok('双 COS+萧道 展示仅 1 张', display.length === 1, `len=${display.length}`);
  const deduped = dedupeReferenceImageSlots(refs, labels, { projectAssets: assets });
  const filled = deduped.referenceImages.filter((u) => String(u).trim()).length;
  ok('数据层去重后仅 1 个非空槽', filled === 1, JSON.stringify(deduped.referenceImages));
}

console.log('\n=== 36. 22.json：Input 仅 imagePreview，主图格与参考格不重复 ===\n');

{
  const lib =
    '/flowgen-api/projects/7b5c23a2-a38b-479a-9553-3fda49c5d5e7/assets/7171f71a-cd1a-4985-9acf-66583b1d149e/file';
  const assets = [
    { slug: '萧逍', name: '萧逍', url: lib },
    { slug: '萧道', name: '萧道', url: lib },
  ];
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    imagePreview: lib,
    imageName: '萧逍',
    referenceImages: [],
    referenceImageLabels: [],
    prompt: '',
  });
  const showMain = shouldShowPanelMainImageSlot(data);
  ok('22.json 展示主图格', showMain);
  const base = buildPanelReferenceDisplayEntries(data.referenceImages, {
    imagePreview: data.imagePreview,
    dedupeAgainstMain: shouldDedupePanelRefsAgainstMainPreview(data),
    referenceImageLabels: data.referenceImageLabels,
    projectAssets: assets,
  });
  let entries = dedupePanelReferenceDisplayEntries(
    appendPromptReferencedAssetDisplayEntries(
      base,
      '',
      assets,
      data.referenceImageLabels
    ),
    data.referenceImageLabels,
    assets
  );
  if (showMain) {
    entries = filterPanelReferenceDisplayEntriesExcludingMainPreview(
      entries,
      data.imagePreview,
      data.imageName,
      data.referenceImageLabels,
      assets
    );
  }
  if (
    !entries.length &&
    data.imagePreview?.trim() &&
    data.imageName?.trim() &&
    !shouldShowPanelMainImageSlot(data)
  ) {
    entries = [{ url: lib, slotIndex: 0 }];
  }
  const gridCount = (showMain ? 1 : 0) + entries.length;
  ok('22.json 参考区合计 1 张（非 2）', gridCount === 1, `main=${showMain} refs=${entries.length}`);
}

console.log('\n=== 37. 666.json：主图萧逍 + 参考鸱吻 + prompt @萧逍 不重复萧道 ===\n');

{
  const proj = '7b5c23a2-a38b-479a-9553-3fda49c5d5e7';
  const xiaoId = '7171f71a-cd1a-4985-9acf-66583b1d149e';
  const chiwenId = 'e2ef07fd-4566-4913-80ae-929be8b875b6';
  const xiaoLib = `/flowgen-api/projects/${proj}/assets/${xiaoId}/file`;
  const chiwenLib = `http://localhost:3001/flowgen-api/projects/${proj}/assets/${chiwenId}/file`;
  const assets = [
    { slug: '萧逍', name: '萧逍', url: xiaoLib },
    { slug: '鸱吻', name: '鸱吻', url: `/flowgen-api/projects/${proj}/assets/${chiwenId}/file` },
  ];
  const prompt =
    '就在萧逍@资产:萧逍 苦撑时，鸱吻@资产:鸱吻 走出';
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    imagePreview: xiaoLib,
    imageName: 'ep001_seq001_sc007',
    referenceImages: [chiwenLib],
    referenceImageLabels: ['鸱吻'],
    prompt,
  });
  const showMain = shouldShowPanelMainImageSlot(data);
  let entries = dedupePanelReferenceDisplayEntries(
    appendPromptReferencedAssetDisplayEntries(
      buildPanelReferenceDisplayEntries(data.referenceImages, {
        referenceImageLabels: data.referenceImageLabels,
        projectAssets: assets,
      }),
      prompt,
      assets,
      data.referenceImageLabels
    ),
    data.referenceImageLabels,
    assets
  );
  if (showMain) {
    entries = filterPanelReferenceDisplayEntriesExcludingMainPreview(
      entries,
      data.imagePreview,
      data.imageName,
      data.referenceImageLabels,
      assets
    );
  }
  const mainKey = panelRefDisplayDedupeKey(data.imagePreview!, data.imageName, assets);
  const xiaoKey = panelRefDisplayDedupeKey(xiaoLib, '萧逍', assets);
  ok('666 主图与萧逍同 assetId 键', mainKey === xiaoKey && mainKey.startsWith('asset:'));
  const xiaoCount = entries.filter(
    (e) => panelRefDisplayDedupeKey(e.url, data.referenceImageLabels?.[e.slotIndex], assets) === xiaoKey
  ).length;
  ok('666 参考格不含第二张萧逍', xiaoCount === 0, `xiaoInRefs=${xiaoCount}`);
  ok('666 参考格保留鸱吻', entries.some((e) => e.url.includes(chiwenId)));
  const gridCount = (showMain ? 1 : 0) + entries.length;
  ok('666 合计 2 格（萧逍+鸱吻）', gridCount === 2, `count=${gridCount}`);
}

console.log('\n=== 39. 全模型：拖入 @图片3 规范后不变成 @资产:其它名 3 ===\n');

{
  const xiao = 'https://cos.example.com/xiao.png';
  const chiwen = 'https://cos.example.com/chiwen.png';
  const img2 = 'https://cos.example.com/generic2.png';
  const img3 = 'https://cos.example.com/street-drag.png';
  const assets = [
    { slug: '萧道', name: '萧道', url: xiao },
    { slug: '鸱吻', name: '鸱吻', url: chiwen },
  ];
  const slugMap = new Map([
    ['萧道', xiao],
    ['鸱吻', chiwen],
  ]);
  const dragPrompt = '景别/视角/构图: @图片3 全景/高角度';
  const dragRefs = {
    referenceImages: [xiao, chiwen, img2, img3],
    referenceImageLabels: ['萧道', '鸱吻', '图片2', '图片3'],
  };

  const allModels: Array<{ name: string; data: NodeData }> = [
    {
      name: 'seedance2.0 参考生',
      data: simNode({
        selectedModel: 'seedance2.0 (急速版)',
        seedanceGenerationMode: 'reference',
        panelMainSlotVisible: false,
        imagePreview: xiao,
        prompt: dragPrompt,
        ...dragRefs,
      }),
    },
    {
      name: 'seedance2.0 图生',
      data: simNode({
        selectedModel: 'seedance2.0 (急速版)',
        seedanceGenerationMode: 'image',
        firstFrameImageUrl: xiao,
        lastFrameImageUrl: chiwen,
        prompt: dragPrompt,
        ...dragRefs,
      }),
    },
    {
      name: 'seedance1.5-pro',
      data: simNode({
        selectedModel: 'seedance1.5-pro',
        firstFrameImageUrl: xiao,
        prompt: dragPrompt,
        ...dragRefs,
      }),
    },
    {
      name: 'Nano Banana 2.0',
      data: simNode({
        selectedModel: 'Nano Banana 2.0',
        imagePreview: xiao,
        prompt: dragPrompt,
        ...dragRefs,
      }),
    },
    {
      name: 'image 2',
      data: simNode({
        selectedModel: 'image 2',
        imagePreview: xiao,
        prompt: dragPrompt,
        ...dragRefs,
      }),
    },
    {
      name: '可灵3.0 Omni multi',
      data: simNode({
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'multi',
        klingOmniMultiPrompt: dragPrompt,
        klingOmniMultiReferenceImages: dragRefs.referenceImages,
        referenceImageLabels: dragRefs.referenceImageLabels,
      }),
    },
    {
      name: '可灵3.0 Omni 指令',
      data: simNode({
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'instruction',
        imagePreview: xiao,
        klingOmniInstructionPrompt: dragPrompt,
        klingOmniInstructionReferenceImages: dragRefs.referenceImages,
        referenceImageLabels: dragRefs.referenceImageLabels,
      }),
    },
    {
      name: '可灵3.0 Omni 视频',
      data: simNode({
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'video',
        imagePreview: xiao,
        klingOmniVideoPrompt: dragPrompt,
        klingOmniVideoReferenceImages: dragRefs.referenceImages,
        referenceImageLabels: dragRefs.referenceImageLabels,
      }),
    },
    {
      name: '即梦3.0 Pro',
      data: simNode({
        selectedModel: '即梦3.0 Pro',
        jimengGenerationMode: 'image',
        firstFrameImageUrl: xiao,
        prompt: dragPrompt,
        ...dragRefs,
      }),
    },
    {
      name: 'vidu 2.0',
      data: simNode({
        selectedModel: 'vidu 2.0',
        firstFrameImageUrl: xiao,
        prompt: dragPrompt,
        ...dragRefs,
      }),
    },
    {
      name: '可灵 2.5 Turbo',
      data: simNode({
        selectedModel: '可灵 2.5 Turbo',
        imagePreview: xiao,
        prompt: dragPrompt,
        ...dragRefs,
      }),
    },
  ];

  for (const { name, data } of allModels) {
    const canon = getCanonicalInspectorPromptText(data, assets);
    ok(`${name}: 保留 @图片3`, canon.includes('@图片3'), canon);
    ok(`${name}: 无 @资产:鸱吻 3`, !/@资产:鸱吻\s*3/.test(canon), canon);
    const ctx = buildPromptMediaRefContextForRun(data, assets);
    const plan = collectReferencedMediaFromPrompt(canon, data, ctx, slugMap, assets);
    const hit = plan.images.find((e) => e.token === '@图片3');
    if (
      (name.includes('Seedance') && name.includes('参考')) ||
      name.includes('Nano') ||
      name.includes('image') ||
      name.includes('Omni')
    ) {
      ok(`${name}: plan 指向拖入街景`, hit?.url === img3, hit?.url);
    }
  }
}

console.log('\n=== 40. 42356.json：空槽误拖 File 不得参与 @资产 上传 / API 仅 plan ===\n');

{
  const chiwenCos =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/c6a67fb0-1324-420b-9660-a2e20c4862ae.png';
  const streetCos =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/fde9b9e6-e813-4571-9352-7c1bd40d84e0.png';
  const dragWrongCos =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/7bd111e5-cdd6-435c-be0d-782005b141c8.png';
  const xiaoLib =
    '/flowgen-api/projects/7b5c23a2-a38b-479a-9553-3fda49c5d5e7/assets/7171f71a-cd1a-4985-9acf-66583b1d149e/file';
  const chiwenLib =
    '/flowgen-api/projects/7b5c23a2-a38b-479a-9553-3fda49c5d5e7/assets/e2ef07fd-4566-4913-80ae-929be8b875b6/file';
  const assets = [
    { slug: '萧逍', name: '萧逍', url: xiaoLib },
    { slug: '鸱吻', name: '鸱吻', url: chiwenLib },
  ];
  const slugMap = new Map([
    ['萧逍', xiaoLib],
    ['鸱吻', chiwenLib],
  ]);
  const prompt =
    '鸱吻@资产:鸱吻 景别: @图片3 全景 萧逍@资产:萧逍 走出';
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    panelMainSlotVisible: false,
    imagePreview: chiwenCos,
    referenceImages: [chiwenCos, '', streetCos],
    referenceImageLabels: ['鸱吻', '', '图片3'],
    prompt,
  });
  const ctx = buildPromptMediaRefContextForRun(data, assets);
  const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, slugMap, assets);
  const enriched = enrichPlanImagesWithPanelSlotIndexes(
    data.referenceImages || [],
    plan.images,
    {
      referenceImageLabels: data.referenceImageLabels,
      panelMainSlotVisible: false,
      projectAssetSlugToUrl: slugMap,
    }
  );
  const xiaoEntry = enriched.find((e) => e.token.includes('萧逍'));
  ok(
    '42356：@萧逍 落到空槽1',
    xiaoEntry?.refImageSlotIndex === 1,
    String(xiaoEntry?.refImageSlotIndex)
  );
  ok(
    '42356：空槽勿用误拖 File',
    !shouldUseSlotOriginalFileForUpload(
      xiaoEntry!,
      '',
      { name: 'drag.png' } as File
    )
  );
  const img3Entry = enriched.find((e) => e.token === '@图片3');
  ok(
    '42356：有槽 URL 时允许槽位 File',
    img3Entry != null &&
      shouldUseSlotOriginalFileForUpload(img3Entry, streetCos, { name: 'street.png' } as File)
  );
  const uploadedByToken = new Map<string, string>();
  for (const e of enriched) {
    const up = e.token.includes('萧逍')
      ? xiaoLib
      : e.token.includes('鸱吻')
        ? chiwenLib
        : e.token === '@图片3'
          ? streetCos
          : '';
    if (up) uploadedByToken.set(e.token, up);
  }
  const apiRefs = buildReferenceOnlyImagesForApiPayload(enriched, uploadedByToken);
  eq(apiRefs.length, 3, `len=${apiRefs.length}`);
  ok('42356：API 不含误拖 7bd11', !apiRefs.includes(dragWrongCos), apiRefs.join(','));
  ok('42356：API 含萧逍库图', apiRefs.includes(xiaoLib), apiRefs.join(','));
  ok('42356：API 含街景', apiRefs.includes(streetCos), apiRefs.join(','));
}

console.log('\n=== 38b. 拖入 @图片3 选中节点时不应变成 @资产:鸱吻 3 ===\n');

{
  const xiao = 'https://cos.example.com/xiao.png';
  const chiwen = 'https://cos.example.com/chiwen.png';
  const img2 = 'https://cos.example.com/generic2.png';
  const img3 = 'https://cos.example.com/street-drag.png';
  const assets = [
    { slug: '萧道', name: '萧道', url: xiao },
    { slug: '鸱吻', name: '鸱吻', url: chiwen },
  ];
  const slugMap = new Map([
    ['萧道', xiao],
    ['鸱吻', chiwen],
  ]);
  const raw = '景别/视角/构图: @图片3 全景/高角度/倾斜构图';
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    referenceImages: [xiao, chiwen, img2, img3],
    referenceImageLabels: ['萧道', '鸱吻', '图片2', '图片3'],
    prompt: raw,
  });
  const canon = getCanonicalInspectorPromptText(data, assets);
  ok('规范后仍含 @图片3', canon.includes('@图片3'), canon);
  ok('不会变成 @资产:鸱吻 3', !/@资产:鸱吻\s*3/.test(canon), canon);
  ok('裸 @图片 可替换为萧道', remapPromptPanelImageTokensToAssetTokens('使用@图片 构图', data, buildPromptMediaRefContextForRun(data, assets), assets).includes('@资产:萧道'));
  const ctx = buildPromptMediaRefContextForRun(data, assets);
  const plan = collectReferencedMediaFromPrompt(canon, data, ctx, slugMap, assets);
  ok('@图片3 解析到拖入街景 URL', plan.images.find((e) => e.token === '@图片3')?.url === img3, JSON.stringify(plan.images));
}

console.log('\n=== 38. 9999.json：错槽标签 + 资产库解析时勿用槽位本地 File ===\n');

{
  const wrongCos =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/1e537047-c586-44db-ace8-2c2bdf5be5ea.png';
  const xiamoLib =
    '/flowgen-api/projects/7b5c23a2-a38b-479a-9553-3fda49c5d5e7/assets/id-xiamo/file';
  const panel = [wrongCos, '', 'https://lib/street.png'];
  const labels = ['夏茉', '', '萧塘镇街道1'];
  const assets = [
    { slug: '夏茉', name: '夏茉', url: xiamoLib },
    { slug: '萧塘镇街道1', name: '萧塘镇街道1', url: 'https://lib/street.png' },
  ];
  const slugMap = new Map([
    ['夏茉', xiamoLib],
    ['萧塘镇街道1', 'https://lib/street.png'],
  ]);
  const prompt = '夏茉@资产:夏茉 与 @资产:萧塘镇街道1 街景';
  const proc = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    panelMainSlotVisible: false,
    imagePreview: wrongCos,
    projectAssetId: '7171f71a-cd1a-4985-9acf-66583b1d149e',
    referenceImages: panel,
    referenceImageLabels: labels,
    prompt,
  });
  const ctx = buildPromptMediaRefContextForRun(proc, assets);
  const plan = collectReferencedMediaFromPrompt(prompt, proc, ctx, slugMap, assets);
  const enriched = enrichPlanImagesWithPanelSlotIndexes(panel, plan.images, {
    referenceImageLabels: labels,
    panelMainSlotVisible: false,
    projectAssetSlugToUrl: slugMap,
  });
  const xiamo = enriched.find((e) => e.token.includes('夏茉'));
  ok('9999：夏茉 解析为资产库 URL', xiamo?.url === xiamoLib, xiamo?.url);
  ok(
    '9999：错槽 COS 与解析 URL 冲突 → 跳过槽位 File',
    slotOriginalFileConflictsWithPlanEntry(xiamo!, wrongCos),
    String(xiamo?.refImageSlotIndex)
  );
  ok(
    '9999：同槽 COS 与库图一致时不冲突',
    !slotOriginalFileConflictsWithPlanEntry(
      { token: '@资产:夏茉', url: wrongCos, label: '夏茉', refImageSlotIndex: 0, imageIndex: 1 },
      wrongCos
    )
  );
}

console.log('\n=== 41b. 555599999：@资产:鸱吻 按展示名上传库图、prompt 展开含第 N 张 ===\n');

{
  const proj = '7b5c23a2-a38b-479a-9553-3fda49c5d5e7';
  const chiwenLib = `/flowgen-api/projects/${proj}/assets/e2ef07fd-4566-4913-80ae-929be8b875b6/file`;
  const xiaoLib = `/flowgen-api/projects/${proj}/assets/7171f71a-cd1a-4985-9acf-66583b1d149e/file`;
  const slot0Cos =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/737f95ec-ce8a-4c6a-a574-d9cfe48d6904.png';
  const img3Cos =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/ae187891-9bcb-4c5a-b3d0-38ce29c1aa69.png';
  const assets = [
    { slug: 'chiwen-slug', name: '鸱吻', url: chiwenLib },
    { slug: 'xiao-slug', name: '萧逍', url: xiaoLib },
  ];
  const slugMap = new Map([
    ['chiwen-slug', chiwenLib],
    ['鸱吻', chiwenLib],
    ['xiao-slug', xiaoLib],
    ['萧逍', xiaoLib],
  ]);
  const prompt =
    '鸱吻@资产:鸱吻 景别 @图片3 全景 萧逍@资产:萧逍 走出';
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    panelMainSlotVisible: false,
    referenceImages: [slot0Cos, '', img3Cos],
    referenceImageLabels: ['鸱吻', '', '图片3'],
    prompt,
  });
  const ctx = buildPromptMediaRefContextForRun(data, assets);
  const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, slugMap, assets);
  ok('555599999：plan 含 @资产:鸱吻', plan.images.some((e) => e.token === '@资产:鸱吻'));
  const enriched = enrichPlanImagesWithPanelSlotIndexes(data.referenceImages || [], plan.images, {
    referenceImageLabels: data.referenceImageLabels,
    panelMainSlotVisible: false,
    projectAssetSlugToUrl: slugMap,
  });
  const chiwen = enriched.find((e) => e.token === '@资产:鸱吻')!;
  const uploadCtx = {
    originals: { referenceImages: [] as Array<File | null | undefined> },
    panelReferenceImages: data.referenceImages,
    projectAssetSlugToUrl: slugMap,
    projectAssets: assets,
    isFlowgenAssetThumbUrl: () => false,
    flowgenAssetFileUrlFromMediaUrl: (u: string) => u,
  };
  const src = resolveReferencedImageUploadSource(chiwen, uploadCtx as any);
  ok('555599999：鸱吻上传源=库图', src === chiwenLib, src);
  ok('555599999：鸱吻上传源≠错槽COS', !src.includes('737f95ec'), src);
  const filtered = filterProjectAssetsForReferencedPlan(assets, plan);
  ok('555599999：resolve 资产含鸱吻(按名)', filtered.some((a) => a.name === '鸱吻'));
  const resolveOpts = buildReferenceIndexOptionsFromPlan(plan, {
    projectAssets: filtered.map((a) => ({ slug: a.slug, name: a.name, url: a.url || '' })),
  });
  const resolved = resolvePromptPlaceholders(prompt, data, ctx, resolveOpts);
  ok(
    '555599999：@资产:鸱吻 展开为第1张',
    resolved.includes('第1张') && !resolved.includes('@资产:鸱吻'),
    resolved.slice(0, 200)
  );
}

console.log('\n=== 41. 全模型：误拖主预览 / 空槽 File / 选中预览 / 运行后 patch ===\n');

{
  const proj = 'cross-model-proj';
  const libCw = `/flowgen-api/projects/${proj}/assets/id-cw/file`;
  const wrongMain = 'https://cos.example.com/wrong-cat.png';
  const street = 'https://cos.example.com/street.png';
  const assets = [
    { slug: '鸱吻', name: '鸱吻', url: libCw },
    { slug: '萧逍', name: '萧逍', url: `/flowgen-api/projects/${proj}/assets/id-xd/file` },
  ];
  const slugMap = new Map([
    ['鸱吻', libCw],
    ['萧逍', assets[1].url!],
  ]);
  const sharedRefs = {
    panelMainSlotVisible: false as const,
    imagePreview: wrongMain,
    referenceImages: [wrongMain, '', street],
    referenceImageLabels: ['鸱吻', '', '图片3'],
    prompt: '@资产:鸱吻 @图片3 @资产:萧逍',
  };

  for (const model of [
    { name: 'Seedance2.0 参考生', data: simNode({ selectedModel: 'seedance2.0 (急速版)', seedanceGenerationMode: 'reference', ...sharedRefs }) },
    { name: MODEL_NANO_BANANA_2, data: simNode({ selectedModel: MODEL_NANO_BANANA_2, ...sharedRefs }) },
    { name: MODEL_IMAGE_2, data: simNode({ selectedModel: MODEL_IMAGE_2, ...sharedRefs }) },
  ]) {
    ok(`${model.name}: 隐藏主图格`, nodeUsesHiddenMainPreviewSlot(model.data));
    const preview = resolveNodeSelectionPreviewUrl(model.data, assets);
    ok(`${model.name}: 选中预览=鸱吻库`, preview === libCw, preview);
    ok(`${model.name}: 选中预览≠猫图`, preview !== wrongMain, preview);
  }

  for (const modelName of [MODEL_NANO_BANANA_2, MODEL_IMAGE_2, 'seedance2.0 (急速版)']) {
    const data =
      modelName.includes('seedance')
        ? simNode({
            selectedModel: modelName,
            seedanceGenerationMode: 'reference',
            ...sharedRefs,
          })
        : simNode({ selectedModel: modelName, ...sharedRefs });
    const ctx = buildPromptMediaRefContextForRun(data, assets);
    const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, slugMap, assets);
    const enriched = enrichPlanImagesWithPanelSlotIndexes(data.referenceImages || [], plan.images, {
      referenceImageLabels: data.referenceImageLabels,
      panelMainSlotVisible: false,
      projectAssetSlugToUrl: slugMap,
    });
    const xiaoEntry = enriched.find((e) => e.token.includes('萧逍'));
    ok(
      `${modelName}: 空槽 @萧逍 不用槽位 File`,
      !shouldUseSlotOriginalFileForUpload(xiaoEntry!, '', { name: 'cat.png' } as File)
    );
    const uploadedByToken = new Map<string, string>();
    for (const e of enriched) {
      const up =
        e.token.includes('萧逍')
          ? assets[1].url!
          : e.token.includes('鸱吻')
            ? libCw
            : street;
      uploadedByToken.set(e.token, up);
    }
    if (modelName.includes('seedance')) {
      const apiRefs = buildReferenceOnlyImagesForApiPayload(enriched, uploadedByToken);
      ok(`${modelName}: API 仅 plan 3 条`, apiRefs.length === 3, String(apiRefs.length));
      ok(`${modelName}: API 无猫图`, !apiRefs.includes(wrongMain), apiRefs.join(','));
    } else {
      const apiUrls = [...uploadedByToken.values()];
      ok(`${modelName}: 上传映射无猫图`, !apiUrls.includes(wrongMain), apiUrls.join(','));
      ok(`${modelName}: 上传含萧逍库`, apiUrls.includes(assets[1].url!), apiUrls.join(','));
    }
    const merged = mergeAndPrunePanelReferenceImagesAfterUpload(
      data.referenceImages || [],
      enriched,
      uploadedByToken,
      panelMergeOptionsForReferencedUpload(
        enriched,
        uploadedByToken,
        data.imagePreview,
        slugMap,
        data.referenceImageLabels,
        false
      )
    );
    const labels = resolveReferenceImageLabelsAfterPanelRun({
      panelBefore: data.referenceImages || [],
      labelsBefore: data.referenceImageLabels,
      panelAfter: merged,
      plan: { images: enriched, videos: [], audios: [] },
      projectAssets: assets,
    });
    const patch = buildPanelImagePreviewPatchAfterRun(enriched, uploadedByToken, {
      nodeData: data,
      mergedPanelRefs: merged,
      mergedPanelLabels: labels,
      projectAssets: assets,
    });
    ok(`${modelName}: 运行后预览=鸱吻库`, patch.imagePreview === libCw, patch.imagePreview);
    ok(`${modelName}: 运行后隐藏主图格`, patch.panelMainSlotVisible === false);
  }
}

console.log('\n=== 41e. @图片3 串位：空槽导致物理槽2显示图片3 ===\n');

{
  const xiamo = 'https://cos.example.com/xiamo.png';
  const goat = 'https://cos.example.com/goat-ink.png';
  const refs = [xiamo, '', goat];
  const labels = ['夏茉', '', ''];
  ok(
    '槽2 展示名=图片2',
    panelReferenceSlotLabel(2, refs, undefined, 'seedanceSlot') === '图片2',
    panelReferenceSlotLabel(2, refs, undefined, 'seedanceSlot')
  );
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    panelMainSlotVisible: false,
    referenceImages: refs,
    referenceImageLabels: labels,
    prompt: '夏茉@资产:夏茉 @图片3',
  });
  const ctx = buildPromptMediaRefContextForRun(data, []);
  const plan = collectReferencedMediaFromPrompt(data.prompt!, data, ctx, new Map());
  ok(
    '仅两张参考时 @图片3 不进 plan',
    !plan.images.some((e) => e.token === '@图片3'),
    plan.images.map((e) => e.token).join(',')
  );
  const pic2 = collectReferencedMediaFromPrompt(
    '夏茉@资产:夏茉 @图片2',
    data,
    ctx,
    new Map()
  );
  ok(
    '@图片2 解析到误拖槽',
    pic2.images.find((e) => e.token === '@图片2')?.url === goat,
    pic2.images.find((e) => e.token === '@图片2')?.url
  );
}

console.log('\n=== 41d. sc007：@萧逍 勿因 COS 误对齐到 @图片3 槽 ===\n');

{
  const proj = '7b5c23a2-a38b-479a-9553-3fda49c5d5e7';
  const chiwenCos =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/fb2f6c72-8f72-4e59-9908-893d2412c11d.png';
  const xiaoCos =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/682c27ed-1acb-4919-812c-42d0b32b9f42.png';
  const img3Cos =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/3ecded7c-9653-454c-ba3a-f592cce02871.png';
  const chiwenLib = `/flowgen-api/projects/${proj}/assets/e2ef07fd-4566-4913-80ae-929be8b875b6/file`;
  const xiaoLib = `/flowgen-api/projects/${proj}/assets/7171f71a-cd1a-4985-9acf-66583b1d149e/file`;
  const assets = [
    { slug: 'chiwen', name: '鸱吻', url: chiwenLib },
    { slug: 'xiaoxiao', name: '萧逍', url: xiaoLib },
  ];
  const slugMap = new Map([
    ['鸱吻', chiwenLib],
    ['萧逍', xiaoLib],
  ]);
  const prompt =
    '鸱吻@资产:鸱吻 景别 @图片3 全景 萧逍@资产:萧逍 走出';
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    panelMainSlotVisible: false,
    imagePreview: chiwenLib,
    referenceImages: [chiwenCos, xiaoCos, '', img3Cos],
    referenceImageLabels: ['鸱吻', '萧逍', '', '图片3'],
    prompt,
  });
  const ctx = buildPromptMediaRefContextForRun(data, assets);
  const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, slugMap, assets);
  const enrichOpts = {
    referenceImageLabels: data.referenceImageLabels,
    panelMainSlotVisible: false,
    projectAssetSlugToUrl: slugMap,
    imagePreview: data.imagePreview,
  };
  const enriched = enrichPlanImagesWithPanelSlotIndexes(
    data.referenceImages || [],
    plan.images,
    enrichOpts
  );
  const xiao = enriched.find((e) => e.token === '@资产:萧逍');
  const img3 = enriched.find((e) => e.token === '@图片3');
  ok('sc007：@萧逍 槽=1 非图片3槽', xiao?.refImageSlotIndex === 1, String(xiao?.refImageSlotIndex));
  ok('sc007：@图片3 槽=3', img3?.refImageSlotIndex === 3, String(img3?.refImageSlotIndex));
  ok('sc007：plan 萧逍=库图', xiao?.url === xiaoLib, xiao?.url);
  const uploaded = new Map<string, string>([
    ['@资产:鸱吻', chiwenCos],
    ['@图片3', img3Cos],
    ['@资产:萧逍', xiaoCos],
  ]);
  const apiRefs = buildReferenceOnlyImagesForApiPayload(enriched, uploaded);
  ok('sc007：API 3 张且各不相同', apiRefs.length === 3 && new Set(apiRefs).size === 3, apiRefs.join('|'));
  let threw = false;
  try {
    assertDistinctUploadedRefsForPlan(enriched, new Map([
      ['@资产:鸱吻', chiwenCos],
      ['@图片3', img3Cos],
      ['@资产:萧逍', img3Cos],
    ]));
  } catch {
    threw = true;
  }
  ok('sc007：重复 COS 应拦截', threw);
  const wrongPlanUrl = enriched.map((e) =>
    e.token === '@资产:萧逍' ? { ...e, url: img3Cos } : e
  );
  const reEnrich = enrichPlanImagesWithPanelSlotIndexes(
    data.referenceImages || [],
    wrongPlanUrl,
    enrichOpts
  );
  ok(
    'sc007：plan.url 误为图片3 COS 时仍落萧逍槽',
    reEnrich.find((e) => e.token === '@资产:萧逍')?.refImageSlotIndex === 1,
    String(reEnrich.find((e) => e.token === '@资产:萧逍')?.refImageSlotIndex)
  );
}

console.log('\n=== 41c. sc009：夏茉槽水墨 COS + 槽位 File 仍上传库图 ===\n');

{
  const proj = '7b5c23a2-a38b-479a-9553-3fda49c5d5e7';
  const xiamoLib = `/flowgen-api/projects/${proj}/assets/b696508b-4b73-4e19-939d-111febee4f32/file`;
  const inkCos =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/567b17e9-c640-4c3d-a198-da6837842a20.png';
  const streetCos =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/a731af12-62b6-4069-8704-559990702c94.png';
  const assets = [
    { slug: 'xiamo', name: '夏茉', url: xiamoLib },
    { slug: 'street1', name: '萧塘镇街道1', url: streetCos },
  ];
  const slugMap = new Map([
    ['夏茉', xiamoLib],
    ['萧塘镇街道1', streetCos],
  ]);
  const prompt = '夏茉@资产:夏茉 景别 @资产:萧塘镇街道1';
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    panelMainSlotVisible: false,
    referenceImages: [inkCos, '', streetCos],
    referenceImageLabels: ['夏茉', '', '萧塘镇街道1'],
    prompt,
  });
  const ctx = buildPromptMediaRefContextForRun(data, assets);
  const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, slugMap, assets);
  const enriched = enrichPlanImagesWithPanelSlotIndexes(data.referenceImages || [], plan.images, {
    referenceImageLabels: data.referenceImageLabels,
    panelMainSlotVisible: false,
    projectAssetSlugToUrl: slugMap,
  });
  const xiamoPlan = plan.images.find((e) => e.token === '@资产:夏茉');
  ok('sc009：collect plan.url=夏茉库', xiamoPlan?.url === xiamoLib, xiamoPlan?.url);
  const xiamo = enriched.find((e) => e.token === '@资产:夏茉')!;
  const uploadCtx = {
    originals: {
      referenceImages: [{ name: 'ink-goat.png' } as File, undefined, undefined],
    },
    panelReferenceImages: data.referenceImages,
    projectAssetSlugToUrl: slugMap,
    projectAssets: assets,
    isFlowgenAssetThumbUrl: () => false,
    flowgenAssetFileUrlFromMediaUrl: (u: string) => u,
  };
  const src = resolveReferencedImageUploadSource(xiamo, uploadCtx as any);
  ok('sc009：@资产:夏茉 上传源=库图', src === xiamoLib, src);
  ok('sc009：上传源≠水墨 COS', !src.includes('567b17e9'), src);
  ok(
    'sc009：槽 COS 与库图一致时仍不用槽位 File',
    !shouldUseSlotOriginalFileForUpload(
      { ...xiamo, url: inkCos },
      inkCos,
      uploadCtx.originals.referenceImages[0],
      src
    )
  );
}

{
  const fox = 'https://cos/fox.png';
  const bg = 'https://cos/bg.png';
  const omni = simNode({
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'multi',
    imagePreview: 'https://cos/wrong-main.png',
    klingOmniMultiReferenceImages: [fox, bg],
    klingOmniMultiPrompt: '@图片1 @图片2',
    referenceImageLabels: ['图片1', '图片2'],
  });
  const ctx = buildPromptMediaRefContextFromNode(omni);
  const plan = collectReferencedMediaFromPrompt(omni.klingOmniMultiPrompt!, omni, ctx, new Map());
  const uploaded = mockUploadedByToken(plan);
  const after = buildPanelReferenceImagesAfterUpload(
    omni.klingOmniMultiReferenceImages || [],
    plan.images,
    uploaded,
    { imagePreview: omni.imagePreview }
  );
  ok('Omni multi: 合并后不含误拖主预览', !after.includes('https://cos/wrong-main.png'), JSON.stringify(after));
  ok('Omni multi: 保留 @ 参考狐狸', after.some((u) => u.includes('fox')), JSON.stringify(after));
}

console.log('\n=== 42. 无空格扫描 + 各模型 token 解析/展开 ===\n');

{
  const assets = [{ slug: 'baize', name: '白泽', url: 'https://x/baize.png' }];
  const slugMap = new Map([['baize', assets[0].url!]]);
  const raw = '白泽走向镜头';
  const scanned = scanPromptAppendAllTokens(raw, [
    { label: '白泽', insertText: '@资产:白泽' },
  ]);
  ok('扫描无尾随空格', !scanned.includes('@资产:白泽 '));
  ok('扫描结果', scanned === '白泽@资产:白泽走向镜头', scanned);
  const tokens = matchAllPromptMediaTokens(scanned, assets);
  ok('token 边界仅白泽', tokens.length === 1 && tokens[0].token === '@资产:白泽');
  ok('token 后保留走向', scanned.endsWith('走向镜头'));

  const models = [
    MODEL_NANO_BANANA_2,
    MODEL_IMAGE_2,
    '可灵3.0 Omni',
    '可灵 2.5 Turbo',
    'vidu 2.0',
    'seedance2.0 (高质量版)',
    '即梦3.0 Pro',
  ] as const;
  for (const selectedModel of models) {
    const data = simNode({
      selectedModel,
      imagePreview: assets[0].url,
      imageName: '白泽',
      referenceImages: [assets[0].url!],
      referenceImageLabels: ['白泽'],
      prompt: scanned,
      ...(selectedModel === '可灵3.0 Omni'
        ? { klingOmniTab: 'multi' as const, klingOmniMultiPrompt: scanned, klingOmniMultiReferenceImages: [assets[0].url!] }
        : {}),
      ...(selectedModel.startsWith('seedance2.0')
        ? {
            seedanceGenerationMode: 'reference' as const,
            seedanceTabConfigs: { reference: { prompt: scanned } },
          }
        : {}),
    });
    const ctx = buildPromptMediaRefContextForRun(data, assets);
    const plan = collectReferencedMediaFromPrompt(scanned, data, ctx, slugMap, assets);
    ok(`${selectedModel}: plan 含白泽`, plan.images.some((e) => e.label === '白泽'));
    const opts = buildReferenceIndexOptionsFromPlan(plan, { projectAssets: assets });
    const expanded = resolvePromptPlaceholders(scanned, data, ctx, opts);
    ok(`${selectedModel}: 展开后无裸 @资产:白泽`, !expanded.includes('@资产:白泽'));
    ok(`${selectedModel}: 展开保留走向`, expanded.includes('走向镜头'));
  }
}

console.log('\n=== 汇总 ===\n');
console.log(`通过 ${pass}，失败 ${fail}`);
if (fail > 0) {
  process.exit(1);
}
console.log('全部模拟测试通过。可部署 dist 后在真实环境点运行验证上传。');

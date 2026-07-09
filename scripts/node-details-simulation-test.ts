/**
 * 模拟测试：生成节点 Node Details 应展示本次运行上游快照，而非输出节点侧栏默认模型/参数。
 * 不调用任何生成 API。
 *
 * npx tsx scripts/node-details-simulation-test.ts
 */
import type { NodeData } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2, NodeType } from '../types.ts';
import {
  applyRunPanelFieldsToGenerationParams,
  buildGenerationParamsFromRunSnapshot,
  buildSeedanceReferenceDetailsFromSnapshot,
  buildNanoBananaDetailsReferenceImages,
  buildImageGenOutputReferenceDetailsFromSnapshot,
  buildNodeDetailsBaseParams,
  buildNodeDetailsReferencePreview,
  buildOmniInstructionVideoTabDetailsReferencePreview,
  buildOmniMultiTabDetailsReferencePreview,
  buildOmniPanelSourceForNodeDetails,
  ancestorOmniPanelMergeAllowedForDetails,
  collectOmniMultiTabReferenceMovsForDetails,
  mergeSeedanceImageModeDetailsReferenceImages,
  expectedProcessorReferenceImagesFromPanel,
  resolveNodeDetailsHeroImageUrl,
  resolveNodeSelectionPreviewUrl,
  resolveReferenceImageDetailItemsWithUrlPool,
  shouldIncludeImagePreviewInNodeDetailsUrlPool,
  nodeUsesHiddenMainPreviewSlot,
  isUsableReferenceMovPoster,
  pickReferenceMovPoster,
  pickNodeDetailsParam,
  seedanceReferenceMovsForOutputDetails,
  scrubGeneratedVideoFromReferenceMovs,
  isSameVideoAssetForDetails,
  buildNodeDetailsVideoLabelSource,
  buildReferenceVideoDetailItems,
  type NodeDetailsPickContext,
} from '../utils/nodeDetailsPreview.ts';
import {
  resolveNodeDetailsSourceUrl,
  isGeneratedOutputPersistableUrl,
} from '../utils/generatedOutputUrl.ts';
import { pickImageResourceUrlFromTaskStatus } from '../utils/taskStatusImageUrl.ts';
import {
  buildReferenceImageDetailItemsFromPanel,
  buildInspectorPromptMentionItems,
  buildPromptMediaRefContextFromNode,
  buildPromptMediaRefLabels,
  isOmniTabVideoMainVideoReference,
} from '../utils/promptMediaRefs.ts';
import { mergeSeedancePanelReferenceMovsAfterUpload } from '../utils/referencedMediaRun.ts';

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

function eq(actual: unknown, expected: unknown, name: string) {
  const sa = JSON.stringify(actual);
  const se = JSON.stringify(expected);
  ok(name, sa === se, sa !== se ? `got ${sa} want ${se}` : undefined);
}

/** 模拟运行后输出节点：侧栏常为下一步默认模型，顶层参数也可能被默认值污染 */
function simOutputNode(
  upstream: Partial<NodeData>,
  model: string,
  gpExtras?: Partial<ReturnType<typeof buildGenerationParamsFromRunSnapshot>>
) {
  const gp = buildGenerationParamsFromRunSnapshot(upstream, model);
  if (gpExtras) Object.assign(gp, gpExtras);
  return simNode({
    selectedModel: '可灵 2.5 Turbo',
    aspectRatio: '1:1',
    resolution: '1K',
    quality: '高质量',
    duration: '5s',
    prompt: '',
    negativePrompt: '',
    generationParams: gp,
  });
}

function assertOutputDetails(
  caseName: string,
  upstream: Partial<NodeData>,
  model: string,
  expected: Record<string, unknown>,
  gpOptions?: Parameters<typeof buildGenerationParamsFromRunSnapshot>[2]
) {
  const gp = buildGenerationParamsFromRunSnapshot(upstream, model, gpOptions);
  const output = simOutputNode(upstream, model);
  output.generationParams = gp;
  const base = buildNodeDetailsBaseParams({
    previewNodeData: output,
    nodeType: NodeType.OUTPUT,
    ancestorData: upstream as NodeData,
  });
  eq(base.model, model, `${caseName}: model 来自运行快照`);
  ok(
    `${caseName}: selectedModel 未污染 Details`,
    output.selectedModel === '可灵 2.5 Turbo' && base.model === model
  );
  for (const [k, v] of Object.entries(expected)) {
    eq((base as Record<string, unknown>)[k], v, `${caseName}: ${k}`);
  }
}

console.log('\n=== 1. pickNodeDetailsParam 优先级（输出节点） ===\n');

{
  const ctx: NodeDetailsPickContext = {
    isOutputLike: true,
    runGp: { aspectRatio: '16:9', model: 'Nano Banana 2.0' },
    upstreamGp: { aspectRatio: '9:16' },
    ancestorData: { aspectRatio: '4:3', selectedModel: '可灵 2.5 Turbo' },
    selfData: { aspectRatio: '1:1', selectedModel: '可灵 2.5 Turbo' },
  };
  eq(pickNodeDetailsParam(ctx, 'aspectRatio'), '16:9', '有 generationParams 时用 runGp');
  const ctx2: NodeDetailsPickContext = {
    ...ctx,
    runGp: {},
  };
  eq(pickNodeDetailsParam(ctx2, 'aspectRatio'), '9:16', '无 run 时用上游 generationParams');
  const ctx3: NodeDetailsPickContext = {
    ...ctx,
    runGp: {},
    upstreamGp: {},
  };
  eq(pickNodeDetailsParam(ctx3, 'aspectRatio'), '4:3', '再回落 ancestorData');
}

console.log('\n=== 2. 各模型 / 各 tab — 输出 Node Details Used Parameters ===\n');

assertOutputDetails(
  'Nano Banana 2.0',
  {
    selectedModel: MODEL_NANO_BANANA_2,
    prompt: 'nano 上游创意',
    aspectRatio: '16:9',
    resolution: '2K',
    numberOfImages: '2张',
  },
  MODEL_NANO_BANANA_2,
  {
    prompt: 'nano 上游创意',
    aspectRatio: '16:9',
    resolution: '2K',
    numberOfImages: '2张',
  }
);

assertOutputDetails(
  'image 2',
  {
    selectedModel: MODEL_IMAGE_2,
    prompt: 'image2 场景',
    image2AspectRatio: '9:16',
    image2ImageSize: '2048x1152',
    image2Style: 'natural',
  },
  MODEL_IMAGE_2,
  {
    prompt: 'image2 场景',
    aspectRatio: '9:16',
    resolution: '2048x1152',
  }
);

assertOutputDetails(
  '可灵 2.5 Turbo',
  {
    selectedModel: '可灵 2.5 Turbo',
    prompt: 'kling25 视频',
    quality: '标准',
    duration: '10s',
    aspectRatio: '9:16',
  },
  '可灵 2.5 Turbo',
  {
    prompt: 'kling25 视频',
    quality: '标准',
    duration: '10s',
    aspectRatio: '9:16',
  }
);

assertOutputDetails(
  '可灵3.0 Omni · 多图参考',
  {
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'multi',
    klingOmniMultiPrompt: 'Omni 多图专用提示',
    klingOmniMultiNegativePrompt: 'neg multi',
    aspectRatio: '16:9',
    klingAudioSync: true,
    duration: '5s',
  },
  '可灵3.0 Omni',
  {
    prompt: 'Omni 多图专用提示',
    negativePrompt: 'neg multi',
    klingOmniTab: 'multi',
    klingAudioSync: true,
    aspectRatio: '16:9',
  }
);

assertOutputDetails(
  '可灵3.0 Omni · 指令变换',
  {
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'instruction',
    klingOmniInstructionPrompt: '指令变换 prompt',
    klingOmniInstructionNegativePrompt: '指令 neg',
  },
  '可灵3.0 Omni',
  {
    prompt: '指令变换 prompt',
    negativePrompt: '指令 neg',
    klingOmniTab: 'instruction',
  }
);

assertOutputDetails(
  '可灵3.0 Omni · 视频参考',
  {
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'video',
    klingOmniVideoPrompt: '视频参考 prompt',
  },
  '可灵3.0 Omni',
  {
    prompt: '视频参考 prompt',
    klingOmniTab: 'video',
  }
);

assertOutputDetails(
  '可灵3.0 Omni · 首尾帧',
  {
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'frames',
    klingOmniFramesPrompt: '首尾帧 prompt',
    firstFrameImageUrl: 'https://ff.png',
    lastFrameImageUrl: 'https://lf.png',
  },
  '可灵3.0 Omni',
  {
    prompt: '首尾帧 prompt',
    klingOmniTab: 'frames',
  }
);

assertOutputDetails(
  '即梦3.0 Pro · 文生',
  {
    selectedModel: '即梦3.0 Pro',
    jimengGenerationMode: 'text',
    jimengResolution: '720p',
    jimengVideoRatio: '16:9',
    prompt: '即梦文生',
  },
  '即梦3.0 Pro',
  {
    prompt: '即梦文生',
    jimengGenerationMode: 'text',
    jimengResolution: '720p',
    jimengVideoRatio: '16:9',
    quality: '720p',
  }
);

assertOutputDetails(
  '即梦3.0 Pro · 图生',
  {
    selectedModel: '即梦3.0 Pro',
    jimengGenerationMode: 'image',
    jimengResolution: '1080p',
    jimengVideoRatio: '9:16',
    jimengImages: ['https://j1.png'],
    prompt: '即梦图生',
  },
  '即梦3.0 Pro',
  {
    jimengGenerationMode: 'image',
    jimengResolution: '1080p',
    jimengVideoRatio: '9:16',
    quality: '1080p',
  }
);

assertOutputDetails(
  'vidu 2.0',
  {
    selectedModel: 'vidu 2.0',
    prompt: 'vidu 镜头',
    aspectRatio: '16:9',
    viduDuration: '8s',
    viduClarity: '720p',
    viduMotionRange: '大',
    numberOfImages: '1条',
  },
  'vidu 2.0',
  {
    prompt: 'vidu 镜头',
    aspectRatio: '16:9',
    viduDuration: '8s',
    viduClarity: '720p',
    viduMotionRange: '大',
    numberOfImages: '1条',
  }
);

assertOutputDetails(
  'seedance1.5-pro · 文生',
  {
    selectedModel: 'seedance1.5-pro',
    seedanceGenerationMode: 'text',
    seedanceAspectRatio: '自动匹配',
    seedanceResolution: '480p',
    seedanceFixedCamera: true,
    prompt: 'seedance15',
  },
  'seedance1.5-pro',
  {
    seedanceGenerationMode: 'text',
    seedanceAspectRatio: '自动匹配',
    seedanceResolution: '480p',
    seedanceFixedCamera: true,
  }
);

assertOutputDetails(
  'seedance2.0 高质量 · 文生',
  {
    selectedModel: 'seedance2.0 (高质量版)',
    seedanceGenerationMode: 'text',
    seedanceAspectRatio: '16:9',
    seedanceResolution: '1080p',
    seedanceDuration: '8s',
    prompt: 'sd20 hq text',
  },
  'seedance2.0 (高质量版)',
  {
    seedanceGenerationMode: 'text',
    seedanceAspectRatio: '16:9',
    seedanceResolution: '1080p',
    seedanceDuration: '8s',
    seedanceFixedCamera: undefined,
  }
);

assertOutputDetails(
  'seedance2.0 急速 · 图生',
  {
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'image',
    seedanceAspectRatio: '9:16',
    seedanceResolution: '720p',
    prompt: 'sd20 fast image',
  },
  'seedance2.0 (急速版)',
  {
    seedanceGenerationMode: 'image',
    seedanceAspectRatio: '9:16',
    seedanceResolution: '720p',
  },
  { runCapture: { seedanceAspectRatio: '1:1' } }
);

assertOutputDetails(
  'seedance2.0 高质量 · 参考生',
  {
    selectedModel: 'seedance2.0 (高质量版)',
    seedanceGenerationMode: 'reference',
    seedanceAspectRatio: '21:9',
    seedanceResolution: '1080p',
    seedanceReferenceWebSearch: true,
    prompt: 'sd20 ref',
  },
  'seedance2.0 (高质量版)',
  {
    seedanceGenerationMode: 'reference',
    seedanceAspectRatio: '21:9',
    seedanceResolution: '1080p',
    seedanceReferenceWebSearch: true,
  }
);

console.log('\n=== 3. applyRunPanelFields 与空快照回归 ===\n');

{
  const gp: ReturnType<typeof buildGenerationParamsFromRunSnapshot> = { model: MODEL_NANO_BANANA_2 };
  applyRunPanelFieldsToGenerationParams(gp, { aspectRatio: '16:9', resolution: '4K' }, MODEL_NANO_BANANA_2);
  eq(gp.aspectRatio, '16:9', 'Nano gp.aspectRatio');
  eq(gp.resolution, '4K', 'Nano gp.resolution');
}

{
  const upstream = {
    selectedModel: MODEL_NANO_BANANA_2,
    aspectRatio: '16:9',
    resolution: '2K',
  };
  const output = simNode({
    selectedModel: '可灵 2.5 Turbo',
    aspectRatio: '1:1',
    resolution: '1K',
    generationParams: undefined,
  });
  const base = buildNodeDetailsBaseParams({
    previewNodeData: output,
    nodeType: NodeType.OUTPUT,
    ancestorData: {
      ...upstream,
      generationParams: buildGenerationParamsFromRunSnapshot(upstream, MODEL_NANO_BANANA_2),
    } as NodeData,
  });
  eq(base.model, MODEL_NANO_BANANA_2, '无 output.gp 时 model 来自上游 gp');
  eq(base.aspectRatio, '16:9', '无 output.gp 时比例来自上游');
  eq(base.resolution, '2K', '无 output.gp 时分辨率来自上游');
}

console.log('\n=== 4. Nano Banana：@主图 + @图片1 参考图应显示 2 张 ===\n');

{
  const upstream: Partial<NodeData> = {
    selectedModel: MODEL_NANO_BANANA_2,
    imagePreview: 'https://cos/main-gym.png',
    referenceImages: ['https://cos/face-ref.png'],
    prompt: '@主图不变，把面部换成@图片1的面部',
    aspectRatio: '1:1',
    resolution: '1K',
  };
  const apiImageUrls = ['https://cos/main-gym-uploaded.png', 'https://cos/face-ref-uploaded.png'];
  const gp = buildGenerationParamsFromRunSnapshot(upstream, MODEL_NANO_BANANA_2);
  gp.referenceImages = apiImageUrls;
  gp.prompt = upstream.prompt;
  gp.aspectRatio = '1:1';
  gp.resolution = '1K';

  const output = simNode({
    selectedModel: '可灵 2.5 Turbo',
    imagePreview: 'https://cos/generated-output.png',
    generationParams: gp,
  });

  const base = buildNodeDetailsBaseParams({
    previewNodeData: output,
    nodeType: NodeType.OUTPUT,
    ancestorData: upstream as NodeData,
  });
  eq(base.model, MODEL_NANO_BANANA_2, 'Nano 输出 Details model');

  const refsFromApiSnapshot = buildNanoBananaDetailsReferenceImages({
    snapRefs: apiImageUrls,
    fallbackRefs: [],
    prompt: String(upstream.prompt),
    isOutputLike: true,
    ancestorData: upstream,
    outputImagePreview: output.imagePreview,
  });
  eq(refsFromApiSnapshot.length, 2, '新快照含 API imageUrls 两张');

  const legacyGp = { ...gp, referenceImages: ['https://cos/face-ref-uploaded.png'] };
  const legacyRefs = buildNanoBananaDetailsReferenceImages({
    snapRefs: legacyGp.referenceImages || [],
    fallbackRefs: [],
    prompt: String(upstream.prompt),
    isOutputLike: true,
    ancestorData: upstream,
    outputImagePreview: output.imagePreview,
  });
  ok('旧快照仅面板参考图时按 @ 补全主图', legacyRefs.length >= 2, `len=${legacyRefs.length}`);
  ok('补全后含主图 URL', legacyRefs.some((u) => u.includes('main-gym')));
}

console.log('\n=== 5. Seedance2.0 参考生：@主图 + @图片1 ===\n');

{
  const upstream: Partial<NodeData> = {
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    imagePreview: 'https://cos/sd-main.png',
    referenceImages: ['https://cos/sd-dragon.png'],
    prompt: '@图片1在@主图中运动起来',
    seedanceTabConfigs: { reference: { referenceImages: ['https://cos/sd-dragon.png'] } },
  };
  const apiUrls = ['https://cos/sd-main-up.png', 'https://cos/sd-dragon-up.png'];
  const legacy = buildNanoBananaDetailsReferenceImages({
    snapRefs: ['https://cos/sd-dragon-up.png'],
    fallbackRefs: [],
    prompt: String(upstream.prompt),
    isOutputLike: true,
    ancestorData: upstream,
  });
  ok('Seedance 旧快照补全≥2', legacy.length >= 2, `len=${legacy.length}`);
  const fresh = buildNanoBananaDetailsReferenceImages({
    snapRefs: apiUrls,
    fallbackRefs: [],
    prompt: String(upstream.prompt),
    isOutputLike: true,
    ancestorData: upstream,
  });
  eq(fresh.length, 2, 'Seedance API 快照 2 张');
}

console.log('\n=== 6. image 2：@主图 + @图片 参考图 ===\n');

{
  const upstream: Partial<NodeData> = {
    selectedModel: MODEL_IMAGE_2,
    imagePreview: 'https://cos/i2-main.png',
    referenceImages: ['https://cos/i2-ref.png'],
    prompt: '@主图 场景 @图片1 风格',
    image2AspectRatio: '16:9',
    image2ImageSize: '1792x1024',
    image2Style: 'vivid',
  };
  const apiUrls = ['https://cos/i2-main-up.png', 'https://cos/i2-ref-up.png'];
  const legacySnap = ['https://cos/i2-ref-up.png'];
  const legacyRefs = buildNanoBananaDetailsReferenceImages({
    snapRefs: legacySnap,
    fallbackRefs: [],
    prompt: String(upstream.prompt),
    isOutputLike: true,
    ancestorData: upstream,
  });
  ok('image2 旧快照补全主图', legacyRefs.length >= 2, `len=${legacyRefs.length}`);
  const newRefs = buildNanoBananaDetailsReferenceImages({
    snapRefs: apiUrls,
    fallbackRefs: [],
    prompt: String(upstream.prompt),
    isOutputLike: true,
    ancestorData: upstream,
  });
  eq(newRefs.length, 2, 'image2 API 快照两张');
}

console.log('\n=== 7. MOV 输出节点同等逻辑 ===\n');

{
  const upstream: Partial<NodeData> = {
    selectedModel: 'vidu 2.0',
    viduClarity: '1080p',
    aspectRatio: '9:16',
    prompt: 'mov upstream',
  };
  const gp = buildGenerationParamsFromRunSnapshot(upstream, 'vidu 2.0');
  const mov = simNode({
    selectedModel: '可灵 2.5 Turbo',
    generationParams: gp,
  });
  const base = buildNodeDetailsBaseParams({
    previewNodeData: mov,
    nodeType: NodeType.MOV,
    ancestorData: upstream as NodeData,
  });
  eq(base.model, 'vidu 2.0', 'MOV model');
  eq(base.viduClarity, '1080p', 'MOV viduClarity');
  eq(base.aspectRatio, '9:16', 'MOV aspectRatio');
}

console.log('\n=== 8. Nano：未 @主图时 Details 仅参考槽标签 ===\n');

{
  const upstream: Partial<NodeData> = {
    selectedModel: MODEL_NANO_BANANA_2,
    imagePreview: 'https://cos.example.com/main.png',
    referenceImages: ['https://cos.example.com/ref1.png', 'https://cos.example.com/ref2.png'],
    prompt: '@图片2 风格',
  };
  const items = buildReferenceImageDetailItemsFromPanel(upstream);
  ok('Nano 详情不含主图', !items.some((i) => i.label === '主图'));
  ok('Nano 详情含图片2', items.some((i) => i.label === '图片2'));
  const panel = expectedProcessorReferenceImagesFromPanel(upstream);
  ok('Nano 面板推导不含主图 URL', !panel.includes(String(upstream.imagePreview)));
}

console.log('\n=== 9. Seedance 参考生：未 @主图时 Details 无「主图」项 ===\n');

{
  const main = 'https://cos.example.com/proj/assets/aa/file';
  const thumb = 'https://cos.example.com/proj/assets/aa/thumb';
  const refs = [
    thumb,
    'https://cos.example.com/street.png',
    'https://cos.example.com/man.png',
    'https://cos.example.com/dragon.png',
    'https://cos.example.com/sheet.png',
  ];
  const upstream: Partial<NodeData> = {
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    imagePreview: main,
    referenceImages: refs,
    prompt: '@图片3 街景',
  };
  const panelUrls = expectedProcessorReferenceImagesFromPanel(upstream);
  ok('面板推导为5张参考槽', panelUrls.length === 5, `len=${panelUrls.length}`);
  ok('面板推导不含主图 file URL', !panelUrls.includes(main));
  const items = buildReferenceImageDetailItemsFromPanel(upstream);
  ok('详情项不含主图标签', !items.some((i) => i.label === '主图'));
  ok('详情项含图片3', items.some((i) => i.label === '图片3'));
  ok('详情项末格为图片5', items[items.length - 1]?.label === '图片5');
  const resolved = resolveReferenceImageDetailItemsWithUrlPool(items, [
    'https://cos.example.com/man-up.png',
    'https://cos.example.com/street-up.png',
    main,
    ...refs,
  ]);
  ok('解析后仍保留图片4标签', resolved.some((i) => i.label === '图片4'));
}

console.log('\n=== 10b. Details：底栏标签优先匹配资产库 COS（错图槽） ===\n');

{
  const proj = '7b5c23a2-a38b-479a-9553-3fda49c5d5e7';
  const idXiao = '7171f71a-cd1a-4985-9acf-66583b1d149e';
  const idCw = 'id-cw';
  const libXiao = `/flowgen-api/projects/${proj}/assets/${idXiao}/file`;
  const libCw = `/flowgen-api/projects/${proj}/assets/${idCw}/file`;
  const wrongGym = 'https://cos.example.com/wrong-gym.jpg';
  const pool = [wrongGym, libCw, libXiao];
  const assets = [
    { slug: '萧逍', name: '萧逍', url: libXiao },
    { slug: '鸱吻', name: '鸱吻', url: libCw },
  ];
  const items = buildReferenceImageDetailItemsFromPanel(
    {
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      referenceImages: [wrongGym, libCw],
      referenceImageLabels: ['萧逍', '鸱吻'],
      prompt: '萧逍@资产:萧逍 与鸱吻@资产:鸱吻',
    },
    { projectAssets: assets }
  );
  const resolved = resolveReferenceImageDetailItemsWithUrlPool(items, pool, {
    projectAssets: assets,
  });
  ok(
    '萧逍 用资产库 URL',
    resolved.find((i) => i.label === '萧逍')?.url === libXiao,
    resolved.find((i) => i.label === '萧逍')?.url
  );
  ok(
    '鸱吻 用 pool 中鸱吻',
    resolved.find((i) => i.label === '鸱吻')?.url === libCw,
    resolved.find((i) => i.label === '鸱吻')?.url
  );
  ok('详情补全文案 @资产:萧逍', items.some((i) => i.label === '萧逍'), JSON.stringify(items.map((i) => i.label)));
}

console.log('\n=== 10. Seedance2.0 图生：参考图仅首尾帧（不叠 4 张） ===\n');

{
  const first = 'https://cos.example.com/a1111111-1111-1111-1111-111111111111/horse.jpg';
  const last = 'https://cos.example.com/b2222222-2222-2222-2222-222222222222/wolf.jpg';
  const dupFirst = 'https://cos.example.com/c3333333-3333-3333-3333-333333333333/horse-dup.jpg';
  const dupLast = 'https://cos.example.com/d4444444-4444-4444-4444-444444444444/wolf-dup.jpg';
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'image',
    firstFrameImageUrl: first,
    lastFrameImageUrl: last,
    referenceImages: [dupFirst, dupLast, first, last],
    generationParams: {
      model: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'image',
      referenceImages: [first, last],
      firstFrameImageUrl: first,
      lastFrameImageUrl: last,
    },
    prompt: '@首帧图 过渡到 @尾帧图',
  });
  const panel = expectedProcessorReferenceImagesFromPanel(data);
  eq(panel.length, 2, '面板推导仅首尾 2 张');
  const details = mergeSeedanceImageModeDetailsReferenceImages({
    nodeData: data,
    mergedPool: [
      dupFirst,
      dupLast,
      first,
      last,
      data.firstFrameImageUrl!,
      data.lastFrameImageUrl!,
    ],
  });
  eq(details.length, 2, 'Details 合并后仅 2 张');
  ok('Details 含首帧 COS', details[0] === first, details.join(','));
  ok('Details 含尾帧 COS', details[1] === last, details.join(','));
}

console.log('\n=== 10b. Seedance2.0 图生：Details 首尾帧槽优先于 gp.referenceImages ===\n');

{
  const first = 'https://cos.example.com/a1111111-1111-1111-1111-111111111111/composite.jpg';
  const last = 'https://cos.example.com/b2222222-2222-2222-2222-222222222222/landscape.jpg';
  const staleFox = 'https://cos.example.com/c3333333-3333-3333-3333-333333333333/fox.jpg';
  const staleGoat = 'https://cos.example.com/d4444444-4444-4444-4444-444444444444/goat.jpg';
  const data = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'image',
    firstFrameImageUrl: first,
    lastFrameImageUrl: last,
    generationParams: {
      model: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'image',
      referenceImages: [staleFox, staleGoat],
      firstFrameImageUrl: first,
      lastFrameImageUrl: last,
    },
    prompt: '@首帧图融合到@尾帧图',
  });
  const details = mergeSeedanceImageModeDetailsReferenceImages({
    nodeData: data,
    mergedPool: [staleFox, staleGoat, first, last],
  });
  eq(details.length, 2, 'Details 仍 2 张');
  ok('Details 首帧=面板槽 composite', details[0] === first, details.join(','));
  ok('Details 尾帧=面板槽 landscape', details[1] === last, details.join(','));
  const items = buildReferenceImageDetailItemsFromPanel({
    ...data,
    seedanceGenerationMode: 'image',
    firstFrameImageUrl: details[0],
    lastFrameImageUrl: details[1],
  });
  ok('面板推导标签=首帧+尾帧', items[0]?.label === '首帧图' && items[1]?.label === '尾帧图');
}

console.log('\n=== 11b. 888.json：未 @主图时 Details 不展示误拖 imagePreview ===\n');

{
  const proj = '7b5c23a2-a38b-479a-9553-3fda49c5d5e7';
  const idCw = 'id-cw-888';
  const libCw = `/flowgen-api/projects/${proj}/assets/${idCw}/file`;
  const wrongGym = 'https://cos.example.com/openApi/218412bd-gym.png';
  const assets = [{ slug: '鸱吻', name: '鸱吻', url: libCw }];
  const upstream: Partial<NodeData> = {
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    panelMainSlotVisible: false,
    imagePreview: wrongGym,
    referenceImages: [wrongGym],
    referenceImageLabels: ['鸱吻'],
    prompt: '鸱吻@资产:鸱吻 特写',
  };
  ok('url 池不含误拖主预览', !shouldIncludeImagePreviewInNodeDetailsUrlPool(upstream));
  const refPreview = buildNodeDetailsReferencePreview({
    panelSource: upstream,
    urlPool: [wrongGym, libCw],
    projectAssets: assets,
  });
  ok('参考列表为资产库鸱吻', refPreview.referenceImages[0] === libCw, refPreview.referenceImages[0]);
  ok('参考列表不含健身房 COS', !refPreview.referenceImages.includes(wrongGym));
  const hero = resolveNodeDetailsHeroImageUrl(upstream, {
    referenceImageDetailItems: refPreview.referenceImageDetailItems,
    projectAssets: assets,
  });
  ok('左侧大图用鸱吻资产而非健身房', hero === libCw, hero);
  ok('左侧大图不含健身房 URL', hero !== wrongGym, hero);
  const chatPreview = resolveNodeSelectionPreviewUrl(upstream, assets);
  ok('聊天/选中预览与 Details 大图一致', chatPreview === libCw, chatPreview);
  ok('聊天预览不含误拖健身房', chatPreview !== wrongGym, chatPreview);
}

console.log('\n=== 11d. Nano / image 2：未 @主图时聊天预览与 Details 一致 ===\n');

{
  const proj = '7b5c23a2-a38b-479a-9553-3fda49c5d5e7';
  const libCw = `/flowgen-api/projects/${proj}/assets/id-cw-nano/file`;
  const wrong = 'https://cos.example.com/gym.png';
  const assets = [{ slug: '鸱吻', name: '鸱吻', url: libCw }];
  for (const model of ['Nano Banana 2.0', 'image 2'] as const) {
    const data: Partial<NodeData> = {
      selectedModel: model,
      panelMainSlotVisible: false,
      imagePreview: wrong,
      referenceImages: [wrong, 'https://cos/street.png'],
      referenceImageLabels: ['鸱吻', '图片2'],
      prompt: '@资产:鸱吻 @图片2',
    };
    ok(`${model}: 隐藏主图格`, nodeUsesHiddenMainPreviewSlot(data));
    ok(`${model}: url 池不含误拖主预览`, !shouldIncludeImagePreviewInNodeDetailsUrlPool(data));
    const preview = resolveNodeSelectionPreviewUrl(data, assets);
    ok(`${model}: 选中预览=鸱吻库`, preview === libCw, preview);
  }
}

console.log('\n=== 11c. 89067 风格：主预览猫图 + 槽位鸱吻标签 ===\n');

{
  const proj = '7b5c23a2-a38b-479a-9553-3fda49c5d5e7';
  const idCw = 'id-cw-89067';
  const libCw = `/flowgen-api/projects/${proj}/assets/${idCw}/file`;
  const catCos = 'https://cos.example.com/c2e19bc1-cat.png';
  const img3Cos = 'https://cos.example.com/1996657e-img3.png';
  const assets = [{ slug: '鸱吻', name: '鸱吻', url: libCw }];
  const sc007: Partial<NodeData> = {
    selectedModel: 'seedance2.0 (高质量版)',
    seedanceGenerationMode: 'reference',
    panelMainSlotVisible: false,
    imagePreview: catCos,
    referenceImages: [catCos, '', img3Cos],
    referenceImageLabels: ['鸱吻', '', '图片3'],
    prompt: '@资产:鸱吻 @图片3 @资产:萧逍',
  };
  const preview = resolveNodeSelectionPreviewUrl(sc007, assets);
  ok('选中预览用鸱吻资产库而非猫 COS', preview === libCw, preview);
  ok('选中预览不是误拖猫图', preview !== catCos, preview);
}

console.log('\n=== 10c. Omni 指令变换：面板槽空时 Details 回退 gp.referenceImages ===\n');

{
  const refVideo = 'https://cos.example.com/omni/instruction-base.mp4';
  const refImg1 = 'https://cos.example.com/omni/ref-style.png';
  const refImg2 = 'https://cos.example.com/omni/ref-char.png';
  const upstream: Partial<NodeData> = {
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'instruction',
    klingOmniInstructionPrompt: '@图片1 风格 @图片2 人物',
    klingOmniInstructionVideoUrl: refVideo,
    imagePreview: refVideo,
    referenceMovs: [{ url: refVideo, posterDataUrl: 'data:image/jpeg;base64,poster' }],
    // 面板 instruction 槽未写回，仅 generationParams 快照有实际上传 URL
    klingOmniInstructionReferenceImages: [],
  };
  const gp = {
    model: '可灵3.0 Omni',
    klingOmniTab: 'instruction' as const,
    prompt: upstream.klingOmniInstructionPrompt,
    referenceImages: [refImg1, refImg2],
    referenceMovs: [{ url: refVideo }],
  };
  const mov = simNode({
    selectedModel: '可灵 2.5 Turbo',
    imagePreview: 'https://cos.example.com/omni/output.mp4',
    generationParams: gp,
  });
  const movUrlSet = new Set([refVideo]);
  const refPreview = buildOmniInstructionVideoTabDetailsReferencePreview({
    panelSource: { ...upstream, selectedModel: '可灵3.0 Omni', klingOmniTab: 'instruction' },
    omniTab: 'instruction',
    urlPool: [refImg1, refImg2],
    snapshotRefs: gp.referenceImages as string[],
    movUrlSet,
  });
  ok('指令变换 Details 含 2 张参考图', refPreview.referenceImages.length === 2, String(refPreview.referenceImages.length));
  ok('参考图 1 URL 正确', refPreview.referenceImages[0] === refImg1, refPreview.referenceImages[0]);
  ok('参考图 2 URL 正确', refPreview.referenceImages[1] === refImg2, refPreview.referenceImages[1]);
  ok('含图片1 标签', refPreview.referenceImageDetailItems.some((i) => i.label === '图片1'));
}

console.log('\n=== 10d. 5554443332211：Omni 视频 @资产-only Details 标签=资产名 ===\n');

{
  const mainUrl =
    '/flowgen-api/projects/14/assets/62803dee-e53e-4f51-b0c7-b297829bea54/file';
  const uploadedRef =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/12dd3de1-7212-47bb-aece-e1fbf05205dc.png';
  const refVideo =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/5fc2cf95-b86f-49e8-9e27-3d1bf5c2dccf.mp4';
  const upstream: Partial<NodeData> = {
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'video',
    klingOmniVideoPrompt: '把@资产:美女中的角色按照@视频1中的角色运动起来',
    imagePreview: mainUrl,
    imageName: '美女',
    projectAssetId: '62803dee-e53e-4f51-b0c7-b297829bea54',
    klingOmniVideoReferenceImages: [uploadedRef],
    klingOmniVideoUrl: refVideo,
    referenceMovs: [{ url: refVideo }],
  };
  const refPreview = buildOmniInstructionVideoTabDetailsReferencePreview({
    panelSource: upstream,
    omniTab: 'video',
    urlPool: [uploadedRef],
    snapshotRefs: [uploadedRef],
    movUrlSet: new Set([refVideo]),
  });
  ok('Details 含 1 张参考图', refPreview.referenceImages.length === 1, String(refPreview.referenceImages.length));
  ok(
    'Details 标签为美女非图片1',
    refPreview.referenceImageDetailItems[0]?.label === '美女',
    refPreview.referenceImageDetailItems[0]?.label
  );
}

console.log('\n=== 11. Reference Videos poster 校验 ===\n');

{
  const refVideo = 'https://cos.example.com/in/ref.mp4?sign=1';
  const outputPoster = 'data:image/jpeg;base64,outputframe';
  const inputPoster = 'data:image/jpeg;base64,inputframe';
  ok('视频 URL 不能当 poster', !isUsableReferenceMovPoster(refVideo, refVideo), undefined);
  ok('data:image poster 可用', isUsableReferenceMovPoster(inputPoster, refVideo), undefined);
  eq(
    pickReferenceMovPoster(refVideo, refVideo, inputPoster, outputPoster),
    inputPoster,
    '跳过视频 URL，取第一个有效 poster'
  );
  eq(
    pickReferenceMovPoster(refVideo, outputPoster),
    outputPoster,
    '无更好候选时仍可用 data:image poster'
  );
}

console.log('\n=== 11e. image2 / Nano：@主图+@图片1 同 URL 面板与 Details 均保留 ===\n');

{
  const tram = 'https://cos.example.com/tram.png';
  const prompt = '@图片1出现在@主图中，并让@主图参考@图片1的风格';
  for (const model of ['image 2', 'Nano Banana 2.0'] as const) {
    const data: Partial<NodeData> = {
      selectedModel: model,
      imagePreview: tram,
      panelMainSlotVisible: true,
      referenceImages: [tram],
      referenceImageLabels: ['图片1'],
      prompt,
    };
    const items = buildReferenceImageDetailItemsFromPanel(data);
    ok(`${model}: Details 2 张`, items.length === 2, items.map((i) => i.label).join(','));
    ok(`${model}: Details 含主图`, items.some((i) => i.label === '主图'));
    ok(`${model}: Details 含图片1`, items.some((i) => i.label === '图片1'));
    const preview = buildNodeDetailsReferencePreview({
      panelSource: data,
      urlPool: [tram],
    });
    ok(
      `${model}: ReferencePreview 2 张`,
      preview.referenceImageDetailItems.length === 2,
      preview.referenceImageDetailItems.map((i) => i.label).join(',')
    );
  }
}

console.log('\n=== 11f. 可灵 Omni 多图 MOV 输出：Details 读输出节点槽位 + gp 主图（非 INPUT 祖先）===\n');

{
  const mainPng = 'https://cos.example.com/omni/main.png';
  const refPng = 'https://cos.example.com/omni/ref-slot.png';
  const outputMp4 = 'https://cos.example.com/omni/output.mp4';
  const ancestorProcessor: Partial<NodeData> = {
    selectedModel: 'Nano Banana 2.0',
    imagePreview: 'https://cos.example.com/input/dog.png',
    prompt: '@图片3 换脸',
  };
  const gp = {
    model: '可灵3.0 Omni',
    klingOmniTab: 'multi' as const,
    prompt: '@主图和@图片1连接起来',
    referenceImages: [mainPng, refPng],
    firstFrameImage: mainPng,
    firstFrameImageUrl: mainPng,
  };
  const movData: Partial<NodeData> = {
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'multi',
    imagePreview: outputMp4,
    klingOmniMultiPrompt: '@主图和@图片1连接起来',
    klingOmniMultiReferenceImages: [refPng],
    referenceImageLabels: ['图片1'],
    generationParams: gp,
  };
  const panelSource = buildOmniPanelSourceForNodeDetails({
    previewNodeData: movData,
    generationParams: gp,
    ancestorData: ancestorProcessor,
    isOutputLike: true,
    omniTab: 'multi',
    modelStr: '可灵3.0 Omni',
    resolvedPrompt: gp.prompt,
  });
  ok('panelSource 保留 multi 参考槽', (panelSource.klingOmniMultiReferenceImages || []).length === 1);
  ok('panelSource 主图用 gp 首帧', panelSource.imagePreview === mainPng, panelSource.imagePreview);
  const preview = buildNodeDetailsReferencePreview({
    panelSource,
    urlPool: gp.referenceImages as string[],
  });
  ok('MOV Omni multi Details 2 张参考图', preview.referenceImageDetailItems.length === 2, preview.referenceImageDetailItems.map((i) => i.label).join(','));
  ok('含主图', preview.referenceImageDetailItems.some((i) => i.label === '主图'));
  ok('含图片1', preview.referenceImageDetailItems.some((i) => i.label === '图片1'));
}

console.log('\n=== 11h. Omni 多图 MOV：@图片1+@图片3 无 @主图，OUTPUT 槽空仍展示 gp 快照 ===\n');

{
  const img1 = 'https://cos.example.com/omni/cat-main.png';
  const img3 = 'https://cos.example.com/omni/forest-ref.png';
  const outputMp4 = 'https://cos.example.com/omni/out.mp4';
  const prompt = '@图片1中的角色出现在@图片3中';
  const gp = {
    model: '可灵3.0 Omni',
    klingOmniTab: 'multi' as const,
    prompt,
    referenceImages: [img1, img3],
    referenceImageLabels: ['图片1', '图片3'],
  };
  const movData: Partial<NodeData> = {
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'multi',
    imagePreview: outputMp4,
    generationParams: gp,
  };
  const panelSource = buildOmniPanelSourceForNodeDetails({
    previewNodeData: movData,
    generationParams: gp,
    isOutputLike: true,
    omniTab: 'multi',
    modelStr: '可灵3.0 Omni',
    resolvedPrompt: prompt,
  });
  ok('OUTPUT panelSource 无 multi 槽', !(panelSource.klingOmniMultiReferenceImages || []).length);
  const preview = buildOmniMultiTabDetailsReferencePreview({
    panelSource,
    urlPool: gp.referenceImages as string[],
    snapshotRefs: gp.referenceImages as string[],
    snapshotLabels: gp.referenceImageLabels,
    prompt,
    movUrlSet: new Set<string>(),
  });
  eq(preview.referenceImageDetailItems.length, 2, 'Details 2 张');
  ok('含图片1', preview.referenceImageDetailItems.some((i) => i.label === '图片1'), preview.referenceImageDetailItems.map((i) => i.label).join(','));
  ok('含图片3', preview.referenceImageDetailItems.some((i) => i.label === '图片3'), preview.referenceImageDetailItems.map((i) => i.url).join(','));
  ok('首项=猫主图 COS', preview.referenceImageDetailItems[0]?.url === img1);
  ok('次项=森林 COS', preview.referenceImageDetailItems[1]?.url === img3);
}

console.log('\n=== 11i. Omni 多图：刷新后面板槽+gp 快照不重复同 URL ===\n');

{
  const cat = 'https://cos.example.com/omni/cat.png';
  const forest = 'https://cos.example.com/omni/forest.png';
  const prompt = '@图片1中的角色出现在@图片3中';
  const preview = buildOmniMultiTabDetailsReferencePreview({
    panelSource: {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      imagePreview: cat,
      klingOmniMultiReferenceImages: [cat, forest],
      referenceImageLabels: ['图片1', '图片3'],
      klingOmniMultiPrompt: prompt,
    },
    urlPool: [cat, forest],
    snapshotRefs: [cat, forest],
    snapshotLabels: ['图片1', '图片3'],
    prompt,
    movUrlSet: new Set(),
  });
  eq(preview.referenceImageDetailItems.length, 2, '去重后 2 张');
  ok('无重复 URL', new Set(preview.referenceImages).size === 2);
  ok('含图片1', preview.referenceImageDetailItems.some((i) => i.label === '图片1'));
  ok('含图片3', preview.referenceImageDetailItems.some((i) => i.label === '图片3'));

  const dupSnap = buildOmniMultiTabDetailsReferencePreview({
    panelSource: {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      imagePreview: 'https://cos.example.com/out.mp4',
      generationParams: {
        prompt: '@图片1中的角色出现在@图片1中',
        referenceImages: [cat, cat],
      },
    },
    urlPool: [cat],
    snapshotRefs: [cat, cat],
    prompt: '@图片1中的角色出现在@图片1中',
    movUrlSet: new Set(),
  });
  eq(dupSnap.referenceImageDetailItems.length, 1, '同 URL 快照只 1 张');
}

console.log('\n=== 11j. Omni 多图：API 三槽快照 @图片1 @图片3 跳过中间槽（67811111.json）===\n');

{
  const img1 = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/f60c45e7-aa2c-436f-987a-c1bf36271f12.png';
  const img2 = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/eb23fa79-9ace-4f82-91da-d141e5e6ae32.png';
  const img3 = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/a16c76ae-8876-4e28-b8b5-782ed2206c43.png';
  const prompt = '@图片1中的角色出现在@图片3中';
  const preview = buildOmniMultiTabDetailsReferencePreview({
    panelSource: {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      imagePreview: img2,
      klingOmniMultiReferenceImages: [img2, '', img3],
      klingOmniMultiPrompt: prompt,
    },
    urlPool: [img1, img2, img3],
    snapshotRefs: [img1, img2, img3],
    prompt,
    movUrlSet: new Set(),
  });
  eq(preview.referenceImageDetailItems.length, 2, '只展示 @ 到的 2 张');
  ok('标签 图片1+图片3', preview.referenceImageDetailItems.map((i) => i.label).join(',') === '图片1,图片3');
  ok('跳过中间槽 img2', !preview.referenceImages.includes(img2));
  ok('槽0→img1', preview.referenceImages[0] === img1);
  ok('槽2→img3', preview.referenceImages[1] === img3);
}

console.log('\n=== 11k. Omni 多图：gp 残留上游 Nano 快照时 Details 对齐面板 图片1（uuuuu.json）===\n');

{
  const mainInk = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/cfcdb6fe-04bc-4c96-a8ff-d88505a9ae95.png';
  const dogRef = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/d2286a66-3c32-4a0c-b105-3c39d7b2fa85.png';
  const staleCat = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/053818f1-fc01-470a-8e8c-2384e44d80fb.png';
  const staleGoat = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/9ca827bd-7264-463d-b908-55deb1077d89.png';
  const prompt = '@主图大战@图片1，打斗过程中有中国水墨的线条';
  const preview = buildOmniMultiTabDetailsReferencePreview({
    panelSource: {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      imagePreview: mainInk,
      klingOmniMultiReferenceImages: [dogRef],
      referenceImageLabels: ['图片1'],
      klingOmniMultiPrompt: prompt,
    },
    urlPool: [mainInk, dogRef, staleCat, staleGoat],
    snapshotRefs: [staleCat, staleGoat],
    snapshotLabels: ['', '图片2'],
    prompt,
    movUrlSet: new Set(),
  });
  eq(preview.referenceImageDetailItems.length, 2, '主图+图片1 共 2 张');
  ok('主图=面板主图', preview.referenceImageDetailItems[0]?.url === mainInk);
  ok('图片1=面板狗图非 gp 山羊', preview.referenceImageDetailItems[1]?.url === dogRef);
  ok('标签 主图+图片1', preview.referenceImageDetailItems.map((i) => i.label).join(',') === '主图,图片1');
  ok('不含 stale 山羊', !preview.referenceImages.includes(staleGoat));
}

console.log('\n=== 11l. Omni 视频参考：@主图+@图片1 Details 对齐面板（tttttt.json）===\n');

{
  const mainInk = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/0319bfa6-41db-4eac-8ee0-13de3aee94f4.png';
  const dogRef = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/d2286a66-3c32-4a0c-b105-3c39d7b2fa85.png';
  const refVideo = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/36c5a66c-f7b0-40f2-a5a1-67cd68d54382.mp4';
  const outputVideo = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/70e6f61d-b6a0-4cb4-a0b6-8ff8108c4921.mp4';
  const prompt = '@主图和@图片1参考@视频1动作进行打斗';
  const snapRefs = [mainInk, dogRef];
  const movUrlSet = new Set([refVideo, outputVideo]);

  const panelPreview = buildOmniInstructionVideoTabDetailsReferencePreview({
    panelSource: {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'video',
      imagePreview: mainInk,
      klingOmniVideoReferenceImages: [dogRef],
      referenceImageLabels: ['图片1'],
      klingOmniVideoPrompt: prompt,
      prompt,
    },
    omniTab: 'video',
    urlPool: snapRefs,
    snapshotRefs: snapRefs,
    movUrlSet,
  });
  eq(panelPreview.referenceImageDetailItems.length, 2, '面板态 主图+图片1');
  ok(
    '面板态标签',
    panelPreview.referenceImageDetailItems.map((i) => i.label).join(',') === '主图,图片1'
  );
  ok('面板态图片1=狗', panelPreview.referenceImageDetailItems[1]?.url === dogRef);

  const movPreview = buildOmniInstructionVideoTabDetailsReferencePreview({
    panelSource: {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'video',
      imagePreview: outputVideo,
      klingOmniVideoPrompt: prompt,
      prompt,
      referenceMovs: [{ url: refVideo }],
      generationParams: {
        referenceImages: snapRefs,
        prompt,
      },
    },
    omniTab: 'video',
    urlPool: snapRefs,
    snapshotRefs: snapRefs,
    movUrlSet,
  });
  eq(movPreview.referenceImageDetailItems.length, 2, 'MOV 节点缺槽仍 2 张');
  ok(
    'MOV 标签非 图片1+图片2',
    movPreview.referenceImageDetailItems.map((i) => i.label).join(',') === '主图,图片1'
  );
  ok('MOV 主图=水墨图', movPreview.referenceImageDetailItems[0]?.url === mainInk);
  ok('MOV 图片1=狗', movPreview.referenceImageDetailItems[1]?.url === dogRef);
}

console.log('\n=== 11m. Omni 多图：刷新后 omni 槽空但顶层 referenceImages 对齐面板（uuuuu 刷新）===\n');

{
  const mainInk = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/cfcdb6fe-04bc-4c96-a8ff-d88505a9ae95.png';
  const dogRef = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/d2286a66-3c32-4a0c-b105-3c39d7b2fa85.png';
  const staleCat = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/053818f1-fc01-470a-8e8c-2384e44d80fb.png';
  const staleGoat = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/9ca827bd-7264-463d-b908-55deb1077d89.png';
  const prompt = '@主图大战@图片1，打斗过程中有中国水墨的线条';
  const preview = buildOmniMultiTabDetailsReferencePreview({
    panelSource: {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      imagePreview: mainInk,
      klingOmniMultiReferenceImages: [],
      referenceImages: [mainInk, dogRef],
      referenceImageLabels: ['图片1'],
      klingOmniMultiPrompt: prompt,
    },
    urlPool: [mainInk, dogRef, staleCat, staleGoat],
    snapshotRefs: [staleCat, staleGoat],
    snapshotLabels: ['', '图片2'],
    prompt,
    movUrlSet: new Set(),
  });
  eq(preview.referenceImageDetailItems.length, 2, '刷新后仍 2 张');
  ok(
    '标签 主图+图片1',
    preview.referenceImageDetailItems.map((i) => i.label).join(',') === '主图,图片1'
  );
  ok('图片1=狗非山羊', preview.referenceImageDetailItems[1]?.url === dogRef);
}

console.log('\n=== 11n. Omni MOV：缺 tab 槽/创意描述时从上游 OUTPUT + gp 对齐（99999966666）===\n');

{
  const mainInk = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/cfcdb6fe-04bc-4c96-a8ff-d88505a9ae95.png';
  const dogRef = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/d2286a66-3c32-4a0c-b105-3c39d7b2fa85.png';
  const staleCat = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/053818f1-fc01-470a-8e8c-2384e44d80fb.png';
  const staleGoat = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/9ca827bd-7264-463d-b908-55deb1077d89.png';
  const outputVideo = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/36c5a66c-f7b0-40f2-a5a1-67cd68d54382.mp4';
  const multiPrompt = '@主图大战@图片1，打斗过程中有中国水墨的线条';
  const multiTaskId = '1467690';
  const upstreamMulti: Partial<NodeData> = {
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'multi',
    taskId: multiTaskId,
    imagePreview: mainInk,
    klingOmniMultiReferenceImages: [dogRef],
    referenceImages: [mainInk, dogRef],
    referenceImageLabels: ['图片1'],
    klingOmniMultiPrompt: multiPrompt,
    generationParams: { taskId: multiTaskId, model: '可灵3.0 Omni' },
  };
  const movMultiPanel = buildOmniPanelSourceForNodeDetails({
    previewNodeData: {
      selectedModel: '可灵3.0 Omni',
      taskId: multiTaskId,
      imagePreview: outputVideo,
      generationParams: {
        model: '可灵3.0 Omni',
        taskId: multiTaskId,
        prompt: multiPrompt,
        klingOmniTab: 'multi',
        firstFrameImageUrl: mainInk,
        referenceImages: [staleCat, staleGoat],
        referenceImageLabels: ['', '图片2'],
      },
    },
    generationParams: {
      model: '可灵3.0 Omni',
      taskId: multiTaskId,
      prompt: multiPrompt,
      klingOmniTab: 'multi',
      firstFrameImageUrl: mainInk,
      referenceImages: [staleCat, staleGoat],
      referenceImageLabels: ['', '图片2'],
    },
    ancestorData: upstreamMulti,
    isOutputLike: true,
    omniTab: 'multi',
    modelStr: '可灵3.0 Omni',
    resolvedPrompt: multiPrompt,
  });
  const multiMovPreview = buildOmniMultiTabDetailsReferencePreview({
    panelSource: movMultiPanel,
    urlPool: [mainInk, dogRef, staleCat, staleGoat],
    snapshotRefs: [staleCat, staleGoat],
    snapshotLabels: ['', '图片2'],
    prompt: multiPrompt,
    movUrlSet: new Set([outputVideo]),
  });
  ok(
    'MOV multi 主图+图片1',
    multiMovPreview.referenceImageDetailItems.map((i) => i.label).join(',') === '主图,图片1'
  );
  ok('MOV multi 图片1=狗', multiMovPreview.referenceImageDetailItems[1]?.url === dogRef);

  const mainLion = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/0319bfa6-41db-4eac-8ee0-13de3aee94f4.png';
  const videoPrompt = '@主图和@图片1参考@视频1动作进行打斗';
  const refVideo = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/36c5a66c-f7b0-40f2-a5a1-67cd68d54382.mp4';
  const resultVideo = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/70e6f61d-b6a0-4cb4-a0b6-8ff8108c4921.mp4';
  const videoTaskId = '1467947';
  const upstreamVideo: Partial<NodeData> = {
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'video',
    taskId: videoTaskId,
    imagePreview: mainLion,
    klingOmniVideoReferenceImages: [dogRef],
    referenceImageLabels: ['图片1'],
    klingOmniVideoPrompt: videoPrompt,
    generationParams: { taskId: videoTaskId, model: '可灵3.0 Omni' },
  };
  const movVideoPanel = buildOmniPanelSourceForNodeDetails({
    previewNodeData: {
      selectedModel: '可灵3.0 Omni',
      taskId: videoTaskId,
      imagePreview: resultVideo,
      referenceMovs: [{ url: resultVideo }],
      generationParams: {
        model: '可灵3.0 Omni',
        taskId: videoTaskId,
        prompt: videoPrompt,
        klingOmniTab: 'video',
        referenceImages: [mainLion, dogRef],
        referenceMovs: [{ url: refVideo }],
      },
    },
    generationParams: {
      model: '可灵3.0 Omni',
      taskId: videoTaskId,
      prompt: videoPrompt,
      klingOmniTab: 'video',
      referenceImages: [mainLion, dogRef],
      referenceMovs: [{ url: refVideo }],
    },
    ancestorData: upstreamVideo,
    isOutputLike: true,
    omniTab: 'video',
    modelStr: '可灵3.0 Omni',
    resolvedPrompt: videoPrompt,
  });
  const videoMovPreview = buildOmniInstructionVideoTabDetailsReferencePreview({
    panelSource: movVideoPanel,
    omniTab: 'video',
    urlPool: [mainLion, dogRef],
    snapshotRefs: [mainLion, dogRef],
    movUrlSet: new Set([refVideo, resultVideo]),
    prompt: videoPrompt,
  });
  ok(
    'MOV video 主图+图片1',
    videoMovPreview.referenceImageDetailItems.map((i) => i.label).join(',') === '主图,图片1'
  );
  ok('MOV video 无 tab prompt 仍正确', videoMovPreview.referenceImageDetailItems[0]?.url === mainLion);
}

console.log('\n=== 11o. Omni 旧 MOV taskId≠ancestor：仅用 gp 快照，不 merge INPUT 参考图（0702 node_5）===\n');

{
  const mainLion = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/0319bfa6-41db-4eac-8ee0-13de3aee94f4.png';
  const dogRef = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/d2286a66-3c32-4a0c-b105-3c39d7b2fa85.png';
  const inputLion = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/55c5f31d-bbd8-489d-bf8c-8b3fcac578f4.png';
  const inputStyle = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/0cc619d6-7a84-4bbb-8060-d2061dce6f56.png';
  const refVideo = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/36c5a66c-f7b0-40f2-a5a1-67cd68d54382.mp4';
  const staleMovVideo = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/70e6f61d-b6a0-4cb4-a0b6-8ff8108c4921.mp4';
  const videoPrompt = '@主图和@图片1参考@视频1动作进行打斗';
  /** BFS 会找到的 image2 INPUT（task 与旧 MOV 不同） */
  const mismatchedInputAncestor: Partial<NodeData> = {
    selectedModel: 'image 2',
    taskId: '1467628',
    imagePreview: inputLion,
    referenceImages: [inputLion, inputStyle],
    referenceImageLabels: ['', '图片3'],
    generationParams: { taskId: '1467628', model: 'image 2' },
  };
  ok(
    'task 不一致时不 merge ancestor 槽',
    !ancestorOmniPanelMergeAllowedForDetails(
      { taskId: '1467947', generationParams: { taskId: '1467947' } },
      mismatchedInputAncestor
    )
  );
  const movVideoPanel = buildOmniPanelSourceForNodeDetails({
    previewNodeData: {
      selectedModel: '可灵3.0 Omni',
      taskId: '1467947',
      imagePreview: staleMovVideo,
      referenceMovs: [{ url: staleMovVideo }],
      generationParams: {
        model: '可灵3.0 Omni',
        taskId: '1467947',
        prompt: videoPrompt,
        klingOmniTab: 'video',
        referenceImages: [mainLion, dogRef],
        referenceMovs: [{ url: refVideo }],
        klingOmniVideoUrl: refVideo,
      },
    },
    generationParams: {
      model: '可灵3.0 Omni',
      taskId: '1467947',
      prompt: videoPrompt,
      klingOmniTab: 'video',
      referenceImages: [mainLion, dogRef],
      referenceMovs: [{ url: refVideo }],
      klingOmniVideoUrl: refVideo,
    },
    ancestorData: mismatchedInputAncestor,
    isOutputLike: true,
    omniTab: 'video',
    modelStr: '可灵3.0 Omni',
    resolvedPrompt: videoPrompt,
  });
  ok(
    'panel 未 merge INPUT referenceImages',
    !(movVideoPanel.referenceImages || []).includes(inputStyle)
  );
  ok(
    'panel 未 merge INPUT omni 槽',
    !(movVideoPanel.klingOmniVideoReferenceImages || []).length
  );
  const staleMovPreview = buildOmniInstructionVideoTabDetailsReferencePreview({
    panelSource: movVideoPanel,
    omniTab: 'video',
    urlPool: [mainLion, dogRef, inputLion, inputStyle],
    snapshotRefs: [mainLion, dogRef],
    movUrlSet: new Set([refVideo, staleMovVideo]),
    prompt: videoPrompt,
  });
  eq(staleMovPreview.referenceImageDetailItems.length, 2, '旧 MOV 仍 2 张');
  ok(
    '标签 主图+图片1',
    staleMovPreview.referenceImageDetailItems.map((i) => i.label).join(',') === '主图,图片1'
  );
  ok('主图=gp 快照狮子', staleMovPreview.referenceImageDetailItems[0]?.url === mainLion);
  ok('图片1=狗非 INPUT 风格图', staleMovPreview.referenceImageDetailItems[1]?.url === dogRef);
  ok('不含 INPUT 风格图', !staleMovPreview.referenceImages.includes(inputStyle));
}

console.log('\n=== 11g. Omni 多图：referenceMovs poster 槽位 → @视频1 与 Reference Videos ===\n');

{
  const mainPng = 'https://cos.example.com/omni/main2.png';
  const refVideo = 'https://cos.example.com/omni/ref.mp4';
  const refPoster = 'https://cos.example.com/omni/ref-poster.png';
  const data: Partial<NodeData> = {
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'multi',
    imagePreview: mainPng,
    klingOmniMultiPrompt: '@主图 @视频1 融合',
    klingOmniMultiReferenceImages: [refPoster],
    referenceImageLabels: ['视频1'],
    referenceMovs: [{ url: refVideo, posterDataUrl: refPoster }],
  };
  const mentions = buildInspectorPromptMentionItems(data as NodeData, buildPromptMediaRefContextFromNode(data as NodeData));
  ok('@ 下拉含 @视频1', mentions.some((m) => m.insertText === '@视频1'));
  ok('@ 下拉不含 @图片1', !mentions.some((m) => m.insertText === '@图片1'));
  const movs = collectOmniMultiTabReferenceMovsForDetails({ panelSource: data });
  ok('Details 解析 1 条参考视频', movs.length === 1 && movs[0].url === refVideo);
  const items = buildReferenceImageDetailItemsFromPanel(data);
  ok('视频槽不进 Reference Images', items.length === 1 && items[0].label === '主图');
}

console.log('\n=== 11g. image2 OUTPUT：@资产+@图片1 按 API 快照顺序（对齐 Banana2）===\n');

{
  const proj = '14';
  const idDaya = 'ff824bc5-94a7-4b52-acd7-079000000001';
  const libDaya = `/flowgen-api/projects/${proj}/assets/${idDaya}/file`;
  const pic1Up = 'https://cos.example.com/i2-pic1-up.png';
  const dayaUp = 'https://cos.example.com/i2-daya-up.png';
  const prompt = '@资产:大牙 参考 @图片1 的风格';
  const assets = [{ slug: '大牙', name: '大牙', url: libDaya }];
  const apiUrls = [dayaUp, pic1Up];
  const gp = {
    model: MODEL_IMAGE_2,
    prompt,
    referenceImages: apiUrls,
    image2AspectRatio: '1:1',
    image2ImageSize: '1024x1024',
    image2Style: 'vivid' as const,
  };
  const outputPreview = 'https://cos.example.com/i2-generated.png';
  const fromSnap = buildImageGenOutputReferenceDetailsFromSnapshot({
    snapshotRefs: apiUrls,
    projectAssets: assets,
    prompt,
    outputImagePreview: outputPreview,
    isRunSnapshotRef: (u) => apiUrls.includes(u),
    isSameAsOutput: (ref, out) => ref === out,
  });
  ok('image2 OUTPUT 快照 2 张', fromSnap.referenceImageDetailItems.length === 2);
  ok(
    'image2 OUTPUT 第1张标签=大牙',
    fromSnap.referenceImageDetailItems[0]?.label === '大牙',
    fromSnap.referenceImageDetailItems.map((i) => i.label).join(',')
  );
  ok(
    'image2 OUTPUT 第2张标签=图片1',
    fromSnap.referenceImageDetailItems[1]?.label === '图片1',
    fromSnap.referenceImageDetailItems.map((i) => i.label).join(',')
  );
  ok(
    'image2 OUTPUT URL 与快照一致（大牙可解析为资产库 URL）',
    fromSnap.referenceImageDetailItems[0]?.url === libDaya &&
      fromSnap.referenceImageDetailItems[1]?.url === pic1Up,
    `${fromSnap.referenceImageDetailItems.map((i) => i.url).join(' | ')}`
  );

  const ancestorWrongOrder: Partial<NodeData> = {
    selectedModel: MODEL_IMAGE_2,
    imagePreview: 'https://cos.example.com/main-wrong.png',
    referenceImages: [pic1Up, libDaya],
    referenceImageLabels: ['图片1', '大牙'],
    prompt,
  };
  const panelPreview = buildNodeDetailsReferencePreview({
    panelSource: ancestorWrongOrder,
    urlPool: [...apiUrls, libDaya],
    projectAssets: assets,
  });
  const snapPreview = buildImageGenOutputReferenceDetailsFromSnapshot({
    snapshotRefs: apiUrls,
    projectAssets: assets,
    prompt,
  });
  ok(
    '面板重排可能错序',
    panelPreview.referenceImageDetailItems[0]?.label !== snapPreview.referenceImageDetailItems[0]?.label ||
      panelPreview.referenceImageDetailItems[0]?.url !== snapPreview.referenceImageDetailItems[0]?.url
  );
  ok(
    '快照路径顺序=大牙,图片1',
    snapPreview.referenceImageDetailItems[0]?.label === '大牙' &&
      snapPreview.referenceImageDetailItems[1]?.label === '图片1'
  );
}

console.log('\n=== 11d. Seedance 参考生：runCapture 模式优先于快照 text ===\n');

{
  const model = 'seedance2.0 (急速版)';
  const upstream: Partial<NodeData> = {
    selectedModel: model,
    seedanceGenerationMode: 'text',
    prompt: '@主图出现在@图片3中，让画面融合起来',
  };
  const gp = buildGenerationParamsFromRunSnapshot(upstream, model, {
    runCapture: {
      seedanceGenerationMode: 'reference',
      referenceImages: ['https://cos.example/main.jpg', 'https://cos.example/img3.jpg'],
      referenceImageLabels: ['主图', '图片3'],
    },
  });
  ok('gp 模式=参考生', gp.seedanceGenerationMode === 'reference');
  ok('gp 含 API 参考图', (gp.referenceImages || []).length === 2);
  const details = buildSeedanceReferenceDetailsFromSnapshot({
    snapshotRefs: gp.referenceImages || [],
    snapshotLabels: gp.referenceImageLabels,
    prompt: gp.prompt,
  });
  ok('Details 含主图+图片3', details.referenceImageDetailItems.length === 2);
  ok(
    'Details 标签对齐',
    details.referenceImageDetailItems[0]?.label === '主图' &&
      details.referenceImageDetailItems[1]?.label === '图片3'
  );
}

console.log('\n=== 11e. Seedance 参考生·纯图参数：无 Reference Videos ===\n');

{
  const stalePanelMovs = [{ url: 'https://cos.example/stale-ref.mp4', posterDataUrl: 'https://cos.example/poster.jpg' }];
  const merged = mergeSeedancePanelReferenceMovsAfterUpload(stalePanelMovs, [], []);
  ok('plan 无 @视频 时清空面板 referenceMovs', merged.length === 0);

  const model = 'seedance2.0 (急速版)';
  const upstream: Partial<NodeData> = {
    selectedModel: model,
    seedanceGenerationMode: 'reference',
    referenceMovs: stalePanelMovs,
    prompt: '@主图出现在@图片3中，让画面融合起来',
  };
  const gp = buildGenerationParamsFromRunSnapshot(upstream, model, {
    runCapture: {
      seedanceGenerationMode: 'reference',
      referenceImages: ['https://cos.example/main.jpg', 'https://cos.example/img3.jpg'],
      referenceImageLabels: ['主图', '图片3'],
    },
  });
  ok('gp 无 referenceMovs', !gp.referenceMovs || gp.referenceMovs.length === 0);

  const details = buildSeedanceReferenceDetailsFromSnapshot({
    snapshotRefs: gp.referenceImages || [],
    snapshotLabels: gp.referenceImageLabels,
    prompt: gp.prompt,
  });
  ok('Details 仍含 2 张参考图', details.referenceImageDetailItems.length === 2);
  ok(
    'Details 标签=主图+图片3',
    details.referenceImageDetailItems[0]?.label === '主图' &&
      details.referenceImageDetailItems[1]?.label === '图片3'
  );
}

console.log('\n=== 11f. Seedance 参考生 OUTPUT：Reference Videos 仅信 gp 快照 ===\n');

{
  const outputUrl = 'https://cos.example/generated.mp4?v=1';
  const upstreamChain = 'https://proxy.example/upstream-chain.mp4';
  const gpMovs = [{ url: 'https://cos.example/user-ref.mp4' }];
  const fromGpOnly = seedanceReferenceMovsForOutputDetails(gpMovs, outputUrl);
  ok('gp 有参考视频时保留', fromGpOnly.length === 1);

  const emptyGp = seedanceReferenceMovsForOutputDetails(undefined, outputUrl);
  ok('gp 无 referenceMovs → 空', emptyGp.length === 0);

  const scrubbed = scrubGeneratedVideoFromReferenceMovs(
    [
      { url: outputUrl },
      { url: upstreamChain },
      { url: 'https://cos.example/ref-input.mp4' },
    ],
    outputUrl,
    isSameVideoAssetForDetails
  );
  ok('生成结果视频不进 Reference Videos', scrubbed.length === 2 && !scrubbed.some((m) => isSameVideoAssetForDetails(m.url, outputUrl)));
}

console.log('\n=== 12. 生成完成后 Source URL 须为 AiTop COS（非 blob） ===\n');

{
  const AITOP =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/generated.png';

  const src = resolveNodeDetailsSourceUrl(
    {
      selectedModel: 'image 2',
      imagePreview: 'blob:http://127.0.0.1/nangchen-9918045_1920.jpg',
      taskId: '1455190',
      generationParams: {
        model: 'image 2',
        taskId: '1455190',
        outputUrl: AITOP,
        referenceImages: [AITOP, 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/ref2.png'],
      },
    },
    NodeType.OUTPUT
  );
  ok('OUTPUT Details Source=gp.outputUrl', src === AITOP);
  ok('Source 非 blob', !src.startsWith('blob:'));

  const picked = pickImageResourceUrlFromTaskStatus({
    status: 'SUCCESS',
    resourceUrl: AITOP,
    imageUrl: 'blob:http://127.0.0.1/temp.png',
  });
  ok('轮询结果优先 COS', picked === AITOP);
}

console.log('\n=== 13. OUTPUT/MOV 仅 gp 快照：各模型参考图 Details 不得为 0 ===\n');

{
  type Case = { name: string; run: () => number };
  const cases: Case[] = [
    {
      name: 'Omni multi @图片1+@图片3',
      run: () =>
        buildOmniMultiTabDetailsReferencePreview({
          panelSource: {
            selectedModel: '可灵3.0 Omni',
            klingOmniTab: 'multi',
            imagePreview: 'https://cos/out.mp4',
            generationParams: {
              klingOmniTab: 'multi',
              prompt: '@图片1中的角色出现在@图片3中',
              referenceImages: ['https://cos/a.png', 'https://cos/b.png'],
              referenceImageLabels: ['图片1', '图片3'],
            },
          },
          urlPool: ['https://cos/a.png', 'https://cos/b.png'],
          snapshotRefs: ['https://cos/a.png', 'https://cos/b.png'],
          snapshotLabels: ['图片1', '图片3'],
          prompt: '@图片1中的角色出现在@图片3中',
          movUrlSet: new Set(),
        }).referenceImages.length,
    },
    {
      name: 'Omni instruction 槽空',
      run: () =>
        buildOmniInstructionVideoTabDetailsReferencePreview({
          panelSource: {
            selectedModel: '可灵3.0 Omni',
            klingOmniTab: 'instruction',
            klingOmniInstructionReferenceImages: [],
          },
          omniTab: 'instruction',
          urlPool: ['https://cos/i1.png'],
          snapshotRefs: ['https://cos/i1.png'],
          movUrlSet: new Set(),
        }).referenceImages.length,
    },
    {
      name: 'Seedance 图生首尾帧',
      run: () =>
        mergeSeedanceImageModeDetailsReferenceImages({
          nodeData: {
            generationParams: {
              seedanceGenerationMode: 'image',
              firstFrameImageUrl: 'https://cos/ff.png',
              lastFrameImageUrl: 'https://cos/lf.png',
              referenceImages: ['https://cos/stale.png'],
            },
          },
        }).length,
    },
    {
      name: 'image2 OUTPUT',
      run: () =>
        buildImageGenOutputReferenceDetailsFromSnapshot({
          snapshotRefs: ['https://cos/r1.png', 'https://cos/r2.png'],
          snapshotLabels: ['主图', '图片2'],
          prompt: '@主图 @图片2',
          isRunSnapshotRef: () => true,
        }).referenceImages.length,
    },
    {
      name: 'Seedance 参考生',
      run: () =>
        buildSeedanceReferenceDetailsFromSnapshot({
          snapshotRefs: ['https://cos/m.png', 'https://cos/r.png'],
          snapshotLabels: ['主图', '图片2'],
          prompt: '@主图 @图片2',
        }).referenceImages.length,
    },
  ];
  for (const c of cases) {
    const n = c.run();
    ok(`${c.name} Details≥1`, n >= 1, String(n));
  }
}

console.log('\n=== 11p. Omni 指令变换 @主视频：imagePreview=PNG 时 Details 视频角标=主视频（900788）===\n');

{
  const REF_VID = 'https://ex/900788-ref.mp4';
  const POSTER = 'https://ex/900788-poster.png';
  const panelSource = simNode({
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'instruction',
    klingOmniInstructionPrompt: '@主视频中角色替换@图片3中的角色',
    prompt: '@主视频中角色替换@图片3中的角色',
    imagePreview: POSTER,
    klingOmniInstructionVideoUrl: REF_VID,
    klingOmniInstructionReferenceImages: ['', '', 'https://ex/p3.png'],
    referenceMovs: [{ url: REF_VID }],
  });
  const ctx = buildPromptMediaRefContextFromNode(panelSource);
  const labels = buildPromptMediaRefLabels(panelSource, ctx);
  ok('@ 下拉含 @主视频', labels.some((l) => l.insertText === '@主视频'));
  ok('@ 下拉不含 @视频1', !labels.some((l) => l.insertText === '@视频1'));
  ok(
    '面板顶栏逻辑=主视频',
    isOmniTabVideoMainVideoReference(panelSource, REF_VID, 'instruction')
  );
  const videoItems = buildReferenceVideoDetailItems(
    buildNodeDetailsVideoLabelSource(panelSource, {
      prompt: panelSource.prompt,
      model: '可灵3.0 Omni',
    }),
    panelSource.referenceMovs!
  );
  eq(videoItems.map((i) => i.label), ['主视频'], 'Details Reference Videos 标签');
}

console.log('\n=== 11q. Omni 视频参考 @视频1：Details 视频角标=视频1 非泛化「视频」（990）===\n');

{
  const REF_VID = 'https://ex/990-ref.mp4';
  const gp = {
    model: '可灵3.0 Omni',
    prompt: '@主图中的角色参考@视频1的动作运动起来',
    klingOmniTab: 'video' as const,
    klingOmniVideoUrl: REF_VID,
    referenceMovs: [{ url: REF_VID }],
    referenceImages: ['https://ex/990-main.png'],
  };
  const movNode = simNode({
    selectedModel: '可灵3.0 Omni',
    imagePreview: 'https://ex/990-output.mp4',
    generationParams: gp,
  });
  const videoItems = buildReferenceVideoDetailItems(
    buildNodeDetailsVideoLabelSource(movNode, {
      prompt: gp.prompt,
      model: '可灵3.0 Omni',
    }),
    gp.referenceMovs
  );
  eq(videoItems.map((i) => i.label), ['视频1'], 'MOV Details Reference Videos 标签');
}

console.log('\n=== 11r. vvvvv：Nano 稀疏 @图片5+@图片2+@图片6，Details 仅 gp 3 张 + prompt 标签 ===\n');

{
  const prompt = '@图片5出现在@图片2中并且参考@图片6的风格';
  const gpRefs = [
    'https://cos.example/a8-9276-e3a5ff4a51f6.png',
    'https://cos.example/268e-7f06-4143-baac-47a0337ccb48.png',
    'https://cos.example/be4d-78c2-485d-b6da-ef20d710300f.png',
  ];
  const upstream: Partial<NodeData> = {
    selectedModel: MODEL_NANO_BANANA_2,
    imagePreview: '/flowgen-api/projects/14/assets/a4293204/file',
    panelMainImageUrl: 'blob:http://localhost:3001/f224d83b-main',
    referenceImages: [
      '/flowgen-api/projects/14/assets/a4293204/file',
      gpRefs[1],
      'data:image/jpeg;base64,slot3',
      'data:image/jpeg;base64,slot4',
      gpRefs[0],
      gpRefs[2],
    ],
    referenceImageLabels: ['白泽', '图片2', '图片3', '图片4', '图片5', '图片6'],
    prompt,
    generationParams: {
      model: MODEL_NANO_BANANA_2,
      prompt,
      referenceImages: gpRefs,
      referenceImageLabels: ['白泽', '图片2', '图片3', '图片4', '图片5', '图片6'],
    },
  };
  const panelItems = buildReferenceImageDetailItemsFromPanel(upstream);
  ok('面板态 6 槽（回归面板保留）', panelItems.length === 6, `len=${panelItems.length}`);
  const fromSnap = buildImageGenOutputReferenceDetailsFromSnapshot({
    snapshotRefs: gpRefs,
    snapshotLabels: upstream.generationParams!.referenceImageLabels,
    prompt,
  });
  eq(
    fromSnap.referenceImageDetailItems.map((i) => i.label),
    ['图片5', '图片2', '图片6'],
    'Details 标签跟 prompt 非面板'
  );
  eq(fromSnap.referenceImages.length, 3, 'Details 仅 API 3 张');
  ok('Details 不含未 @ 槽 data URL', !fromSnap.referenceImages.some((u) => u.startsWith('data:')));
  ok('Details 不含主图格', !fromSnap.referenceImageDetailItems.some((i) => i.label === '主图'));
}

console.log('\n=== 汇总 ===\n');
console.log(`通过 ${pass}，失败 ${fail}`);
if (fail > 0) {
  process.exit(1);
}
console.log('Node Details 模拟测试全部通过。请 npm run build 后部署 dist 做真实点击验证。');

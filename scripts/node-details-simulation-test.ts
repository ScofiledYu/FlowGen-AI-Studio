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
  buildNanoBananaDetailsReferenceImages,
  buildNodeDetailsBaseParams,
  buildNodeDetailsReferencePreview,
  buildOmniInstructionVideoTabDetailsReferencePreview,
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
  type NodeDetailsPickContext,
} from '../utils/nodeDetailsPreview.ts';
import { buildReferenceImageDetailItemsFromPanel } from '../utils/promptMediaRefs.ts';

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

console.log('\n=== 汇总 ===\n');
console.log(`通过 ${pass}，失败 ${fail}`);
if (fail > 0) {
  process.exit(1);
}
console.log('Node Details 模拟测试全部通过。请 npm run build 后部署 dist 做真实点击验证。');

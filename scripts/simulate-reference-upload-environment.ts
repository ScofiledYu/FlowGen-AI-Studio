/**
 * 参考图上传模拟环境（自包含，不依赖真实 API / 本地 JSON）
 *
 * 验证：不穿图、不多传、不重复传、按创意描述 @ 传对。
 *
 *   npm run test:ref-upload-env
 */
import type { NodeData } from '../types.ts';
import {
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
  filterProjectAssetsForReferencedPlan,
  getCanonicalInspectorPromptText,
  resolvePictureTokenSlotIndex,
  resolvePromptPlaceholders,
  buildReferenceIndexOptionsFromPlan,
  panelReferenceSlotLabel,
} from '../utils/promptMediaRefs.ts';
import {
  assertDistinctUploadedRefsForPlan,
  buildReferenceOnlyImagesForApiPayload,
  enrichPlanImagesWithPanelSlotIndexes,
  uploadReferencedImageEntry,
  resolveReferencedImageUploadSource,
  type UploadReferencedImageContext,
} from '../utils/referencedMediaRun.ts';

const PROJ = 'sim-proj-7b5c23a2';

const COS = {
  chiwenPanel: `https://aitop100app.cos/openApi/297409/fb2f6c72-8f72-4e59-9908-893d2412c11d.png`,
  xiaoPanel: `https://aitop100app.cos/openApi/297409/682c27ed-1acb-4919-812c-42d0b32b9f42.png`,
  img3: `https://aitop100app.cos/openApi/297409/3ecded7c-9653-454c-ba3a-f592cce02871.png`,
  inkWrong: `https://aitop100app.cos/openApi/297409/567b17e9-c640-4c3d-a198-da6837842a20.png`,
  street: `https://aitop100app.cos/openApi/297409/a731af12-62b6-4069-8704-559990702c94.png`,
  dragWrong: `https://aitop100app.cos/openApi/297409/7bd111e5-cdd6-435c-be0d-782005b141c8.png`,
  /** jjjjj.json sc007 槽0 误拖 */
  jjjjjSc007Drag: `https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/579f8d2b-2ed0-4fb9-b21f-76998af35b51.png`,
  /** jjjjj.json sc007 槽2 街景 */
  jjjjjSc007Street: `https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/d1f65e90-afc0-4466-b6ac-1c76f99d3bf3.png`,
  /** jjjjj.json sc009 槽0 误标夏茉的街景 */
  jjjjjSc009Wrong0: `https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/6a660c2a-1e2e-4001-9e84-091e647ca040.png`,
  /** jjjjj.json sc009 槽1 图片2 */
  jjjjjSc009Street: `https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/a4783ada-a7b1-459e-bab8-6d86b6622c9a.png`,
  goatUpload: `https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/a930a8b0-43f0-4a2d-ba3d-08c9385c746d.png`,
  dogUpload: `https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/3e8b2428-2bd2-46b2-b72a-bbffab5464a0.png`,
  chiwenUploaded: `https://aitop100app.cos/openApi/297409/upload-chiwen-lib.png`,
  xiaoUploaded: `https://aitop100app.cos/openApi/297409/upload-xiao-lib.png`,
  xiamoUploaded: `https://aitop100app.cos/openApi/297409/upload-xiamo-lib.png`,
  streetUploaded: `https://aitop100app.cos/openApi/297409/upload-street-lib.png`,
};

const LIB = {
  chiwen: `/flowgen-api/projects/${PROJ}/assets/e2ef07fd-4566-4913-80ae-929be8b875b6/file`,
  xiao: `/flowgen-api/projects/${PROJ}/assets/7171f71a-cd1a-4985-9acf-66583b1d149e/file`,
  xiamo: `/flowgen-api/projects/${PROJ}/assets/b696508b-4b73-4e19-939d-111febee4f32/file`,
  street: `/flowgen-api/projects/${PROJ}/assets/street-asset-id/file`,
};

const ASSETS = [
  { slug: 'chiwen', name: '鸱吻', url: LIB.chiwen },
  { slug: 'xiaoxiao', name: '萧逍', url: LIB.xiao },
  { slug: 'xiamo', name: '夏茉', url: LIB.xiamo },
  { slug: 'street1', name: '萧塘镇街道1', url: LIB.street },
];

const SLUG_MAP = new Map(
  ASSETS.flatMap((a) => [
    [a.slug, a.url],
    [a.name, a.url],
  ] as const)
);

function simNode(partial: Partial<NodeData> & { selectedModel: string }): NodeData {
  return {
    label: 'sim',
    status: 'idle',
    progress: 0,
    model: partial.selectedModel,
    ...partial,
  } as NodeData;
}

/** 模拟上传：库图 → 独立 upload-* URL；面板 COS → 原样（仅 @图片n 应走此路径） */
function mockUploadFromSrc(src: string): string {
  const s = String(src || '').trim();
  if (s.includes('7171f71a')) return COS.xiaoUploaded;
  if (s.includes('b696508b')) return COS.xiamoUploaded;
  if (s.includes('e2ef07fd')) return COS.chiwenUploaded;
  if (s.includes('street-asset-id')) return COS.streetUploaded;
  if (s.includes('3ecded7c')) return COS.img3;
  if (s.includes('682c27ed')) return COS.xiaoPanel;
  if (s.includes('fb2f6c72')) return COS.chiwenPanel;
  if (s.includes('567b17e9')) return COS.inkWrong;
  if (s.includes('7bd111e5')) return COS.dragWrong;
  if (s.includes('name=goat') || s.includes('goat-ink')) return COS.goatUpload;
  if (s.includes('name=dog')) return COS.dogUpload;
  if (s.includes('aitop100app')) return s;
  return `https://mock.upload/unknown-${s.length}.png`;
}

function buildMockUploadCtx(
  data: NodeData,
  files?: Array<File | null | undefined>
): UploadReferencedImageContext {
  return {
    originals: { referenceImages: files || [] },
    panelReferenceImages: data.referenceImages,
    projectAssetSlugToUrl: SLUG_MAP,
    projectAssets: ASSETS,
    isFlowgenAssetThumbUrl: (u) => /\/thumb(\?|$)/i.test(u),
    flowgenAssetFileUrlFromMediaUrl: (u) => u.replace(/\/thumb(\?.*)?$/i, '/file$1'),
    fileToDataUrlCached: async (f) => `data:image/mock;name=${encodeURIComponent(f.name)}`,
    prepareLocalImageSrcCached: async (src) => src,
    uploadImageCached: async (src) => mockUploadFromSrc(src),
    base64ToUrl: async (src) => mockUploadFromSrc(src),
  };
}

export type SimUploadResult = {
  prompt: string;
  plan: ReturnType<typeof enrichPlanImagesWithPanelSlotIndexes>;
  uploadedByToken: Map<string, string>;
  apiRefs: string[];
  resolvedPrompt: string;
};

export async function runReferenceUploadSimulation(
  data: NodeData,
  options?: { referenceFiles?: Array<File | null | undefined> }
): Promise<SimUploadResult> {
  const prompt = getCanonicalInspectorPromptText(data, ASSETS);
  const ctx = buildPromptMediaRefContextFromNode(data);
  const mediaPlan = collectReferencedMediaFromPrompt(prompt, data, ctx, SLUG_MAP, ASSETS);
  const plan = enrichPlanImagesWithPanelSlotIndexes(
    data.referenceImages || [],
    mediaPlan.images,
    {
      referenceImageLabels: data.referenceImageLabels,
      panelMainSlotVisible: data.panelMainSlotVisible,
      projectAssetSlugToUrl: SLUG_MAP,
      imagePreview: data.imagePreview,
    }
  );
  const uploadCtx = buildMockUploadCtx(data, options?.referenceFiles);
  const uploadedByToken = new Map<string, string>();
  for (const entry of plan) {
    const up = await uploadReferencedImageEntry(entry, uploadCtx);
    uploadedByToken.set(entry.token, up);
  }
  assertDistinctUploadedRefsForPlan(plan, uploadedByToken);
  const apiRefs = buildReferenceOnlyImagesForApiPayload(plan, uploadedByToken);
  const filtered = filterProjectAssetsForReferencedPlan(ASSETS, mediaPlan);
  const resolveOpts = buildReferenceIndexOptionsFromPlan(mediaPlan, {
    projectAssets: filtered.map((a) => ({
      slug: a.slug,
      name: a.name,
      url: a.url || '',
    })),
  });
  const resolvedPrompt = resolvePromptPlaceholders(prompt, data, ctx, resolveOpts);
  return { prompt, plan, uploadedByToken, apiRefs, resolvedPrompt };
}

type Expectation = {
  planTokens: string[];
  apiByToken: Record<string, string>;
  forbiddenInApi?: string[];
  slotByToken?: Record<string, number>;
  slotNotByToken?: Record<string, number>;
  planUrlIncludes?: Record<string, string>;
};

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail = '') {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

async function runScenario(name: string, data: NodeData, exp: Expectation, files?: File[]) {
  console.log(`\n── ${name} ──`);
  const r = await runReferenceUploadSimulation(data, {
    referenceFiles: files,
  });

  const planTokens = r.plan
    .filter((e) => e.token !== '@主图' && e.token !== '@主体')
    .map((e) => e.token);
  ok('plan token 集合', JSON.stringify(planTokens) === JSON.stringify(exp.planTokens), planTokens.join(','));

  ok('API 张数 = plan', r.apiRefs.length === exp.planTokens.length, `${r.apiRefs.length}`);

  const apiSet = new Set(r.apiRefs);
  ok('API 无重复 URL', apiSet.size === r.apiRefs.length, r.apiRefs.map((u) => u.slice(-36)).join(' | '));

  for (const t of exp.planTokens) {
    const up = r.uploadedByToken.get(t) || '';
    const want = exp.apiByToken[t];
    ok(`${t} 上传正确`, up.includes(want), up.slice(-48) || '<empty>');
    const apiIdx = exp.planTokens.indexOf(t);
    ok(`${t} 在 API[${apiIdx}]`, r.apiRefs[apiIdx] === up, r.apiRefs[apiIdx]?.slice(-48));
  }

  for (const bad of exp.forbiddenInApi || []) {
    ok(`API 不含 ${bad.slice(0, 20)}…`, !r.apiRefs.some((u) => u.includes(bad)), bad.slice(-40));
  }

  if (exp.slotByToken) {
    for (const [t, slot] of Object.entries(exp.slotByToken)) {
      const e = r.plan.find((x) => x.token === t);
      ok(`${t} 槽位=${slot}`, e?.refImageSlotIndex === slot, String(e?.refImageSlotIndex));
    }
  }
  if (exp.slotNotByToken) {
    for (const [t, badSlot] of Object.entries(exp.slotNotByToken)) {
      const e = r.plan.find((x) => x.token === t);
      ok(`${t} 不得占槽${badSlot}`, e?.refImageSlotIndex !== badSlot, String(e?.refImageSlotIndex));
    }
  }

  if (exp.planUrlIncludes) {
    for (const [t, frag] of Object.entries(exp.planUrlIncludes)) {
      const e = r.plan.find((x) => x.token === t);
      ok(`${t} plan.url`, Boolean(e?.url?.includes(frag)), e?.url?.slice(-60));
    }
  }

  for (const t of ['@资产:鸱吻', '@资产:萧逍', '@资产:夏茉', '@图片3']) {
    if (r.resolvedPrompt.includes(t)) {
      ok(`prompt 已展开 ${t}`, false, '残留裸 token');
    }
  }
}

async function main() {
  console.log('=== 参考图上传模拟环境 ===\n');
  console.log('规则：仅创意描述 @ 到的图进 API；@资产 走库图；不同 @ 不得同 URL。\n');

  await runScenario(
    'sc007 · 鸱吻 + @图片3 + 萧逍（面板 4 格）',
    simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      panelMainSlotVisible: false,
      imagePreview: LIB.chiwen,
      referenceImages: [COS.chiwenPanel, COS.xiaoPanel, '', COS.img3],
      referenceImageLabels: ['鸱吻', '萧逍', '', '图片3'],
      prompt: '鸱吻@资产:鸱吻 景别 @图片3 全景 萧逍@资产:萧逍 走出',
    }),
    {
      planTokens: ['@资产:鸱吻', '@图片3', '@资产:萧逍'],
      apiByToken: {
        '@资产:鸱吻': 'upload-chiwen-lib',
        '@图片3': '3ecded7c',
        '@资产:萧逍': 'upload-xiao-lib',
      },
      forbiddenInApi: ['567b17e9', '7bd111e5'],
      slotByToken: { '@图片3': 3, '@资产:萧逍': 1 },
      planUrlIncludes: {
        '@资产:鸱吻': 'e2ef07fd',
        '@资产:萧逍': '7171f71a',
      },
    }
  );

  await runScenario(
    'sc009 · 夏茉槽误拖水墨 + @萧塘镇街道1',
    simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      panelMainSlotVisible: false,
      imagePreview: LIB.xiamo,
      referenceImages: [COS.inkWrong, '', COS.street],
      referenceImageLabels: ['夏茉', '', '萧塘镇街道1'],
      prompt: '夏茉@资产:夏茉 景别 @资产:萧塘镇街道1 全景',
    }),
    {
      planTokens: ['@资产:夏茉', '@资产:萧塘镇街道1'],
      apiByToken: {
        '@资产:夏茉': 'upload-xiamo-lib',
        '@资产:萧塘镇街道1': 'upload-street-lib',
      },
      forbiddenInApi: ['567b17e9', '6a660c2a'],
      planUrlIncludes: { '@资产:夏茉': 'b696508b' },
    },
    [{ name: 'ink-goat.png' } as File, undefined, undefined]
  );

  await runScenario(
    '面板多图但未 @ · 不得进 API',
    simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      panelMainSlotVisible: false,
      referenceImages: [COS.chiwenPanel, COS.img3, COS.dragWrong],
      referenceImageLabels: ['鸱吻', '图片3', '误拖猫'],
      prompt: '鸱吻@资产:鸱吻 特写',
    }),
    {
      planTokens: ['@资产:鸱吻'],
      apiByToken: { '@资产:鸱吻': 'upload-chiwen-lib' },
      forbiddenInApi: ['3ecded7c', '7bd111e5', '682c27ed'],
    }
  );

  await runScenario(
    '42356 · 空槽误拖 File + @萧逍',
    simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      panelMainSlotVisible: false,
      referenceImages: [COS.chiwenPanel, '', COS.img3],
      referenceImageLabels: ['鸱吻', '', '图片3'],
      prompt: '鸱吻@资产:鸱吻 景别 @图片3 萧逍@资产:萧逍',
    }),
    {
      planTokens: ['@资产:鸱吻', '@图片3', '@资产:萧逍'],
      apiByToken: {
        '@资产:鸱吻': 'upload-chiwen-lib',
        '@图片3': '3ecded7c',
        '@资产:萧逍': 'upload-xiao-lib',
      },
      forbiddenInApi: ['7bd111e5'],
      slotByToken: { '@资产:萧逍': 1 },
    },
    [undefined, { name: 'wrong-drag.png' } as File, undefined]
  );

  console.log('\n── 重复上传应被拦截 ──');
  let blocked = false;
  try {
    const data = simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      panelMainSlotVisible: false,
      referenceImages: [COS.chiwenPanel, COS.xiaoPanel, '', COS.img3],
      referenceImageLabels: ['鸱吻', '萧逍', '', '图片3'],
      prompt: '鸱吻@资产:鸱吻 @图片3 萧逍@资产:萧逍',
    });
    const ctx = buildMockUploadCtx(data);
    const prompt = getCanonicalInspectorPromptText(data, ASSETS);
    const mediaCtx = buildPromptMediaRefContextFromNode(data);
    const plan = enrichPlanImagesWithPanelSlotIndexes(
      data.referenceImages || [],
      collectReferencedMediaFromPrompt(prompt, data, mediaCtx, SLUG_MAP, ASSETS).images,
      { referenceImageLabels: data.referenceImageLabels, projectAssetSlugToUrl: SLUG_MAP }
    );
    const dup = new Map<string, string>([
      ['@资产:鸱吻', COS.chiwenUploaded],
      ['@图片3', COS.img3],
      ['@资产:萧逍', COS.img3],
    ]);
    assertDistinctUploadedRefsForPlan(plan, dup);
  } catch {
    blocked = true;
  }
  ok('重复 COS 拦截', blocked);

  console.log('\n── sc007 上传源解析快照 ──');
  const sc007 = simNode({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    panelMainSlotVisible: false,
    referenceImages: [COS.chiwenPanel, COS.xiaoPanel, '', COS.img3],
    referenceImageLabels: ['鸱吻', '萧逍', '', '图片3'],
    prompt: '鸱吻@资产:鸱吻 @图片3 萧逍@资产:萧逍',
  });
  const ctx = buildMockUploadCtx(sc007);
  const prompt = getCanonicalInspectorPromptText(sc007, ASSETS);
  const mediaCtx = buildPromptMediaRefContextFromNode(sc007);
  const enriched = enrichPlanImagesWithPanelSlotIndexes(
    sc007.referenceImages || [],
    collectReferencedMediaFromPrompt(prompt, sc007, mediaCtx, SLUG_MAP, ASSETS).images,
    {
      referenceImageLabels: sc007.referenceImageLabels,
      projectAssetSlugToUrl: SLUG_MAP,
    }
  );
  for (const e of enriched) {
    const src = resolveReferencedImageUploadSource(e, ctx);
    console.log(
      `  ${e.token} 槽${e.refImageSlotIndex ?? '-'} resolve→${src.includes('flowgen-api') ? '库图' : src.slice(-44)}`
    );
  }

  await runScenario(
    'jjjjj sc007 · 鸱吻误拖槽 + 萧塘镇 + 萧逍',
    simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      panelMainSlotVisible: false,
      imagePreview: LIB.chiwen,
      referenceImages: [LIB.chiwen, '', LIB.street],
      referenceImageLabels: ['鸱吻', '', '萧塘镇街道1'],
      prompt:
        '关联剧本：前置建构（鸱吻@资产:鸱吻 亮相）\n景别/视角/构图：@资产:萧塘镇街道1 全景\n画面描述：萧逍@资产:萧逍 苦撑，鸱吻@资产:鸱吻 走出',
    }),
    {
      planTokens: ['@资产:鸱吻', '@资产:萧塘镇街道1', '@资产:萧逍'],
      apiByToken: {
        '@资产:鸱吻': 'upload-chiwen-lib',
        '@资产:萧塘镇街道1': 'upload-street-lib',
        '@资产:萧逍': 'upload-xiao-lib',
      },
      forbiddenInApi: ['a930a8b0', '3e8b2428', 'b10e08a0', '579f8d2b'],
      slotByToken: { '@资产:萧塘镇街道1': 2 },
      planUrlIncludes: {
        '@资产:鸱吻': 'e2ef07fd',
        '@资产:萧逍': '7171f71a',
        '@资产:萧塘镇街道1': 'street-asset-id',
      },
    },
    [{ name: 'goat-ink.png' } as File, undefined, { name: 'dog-road.png' } as File]
  );

  await runScenario(
    'jjjjj sc009 · 夏茉误标槽 + @图片2 街景',
    simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      panelMainSlotVisible: false,
      imagePreview: LIB.xiamo,
      referenceImages: [COS.jjjjjSc009Wrong0, COS.jjjjjSc009Street],
      referenceImageLabels: ['夏茉', '图片2'],
      prompt:
        '关联剧本：前置建构（夏茉@资产:夏茉 亮相）\n景别/视角/构图：@图片2 中景/俯视跟拍\n画面描述：夏茉@资产:夏茉 滑翔',
    }),
    {
      planTokens: ['@资产:夏茉', '@图片2'],
      apiByToken: {
        '@资产:夏茉': 'upload-xiamo-lib',
        '@图片2': 'a4783ada',
      },
      forbiddenInApi: ['6a660c2a'],
      slotByToken: { '@图片2': 1 },
      slotNotByToken: { '@资产:夏茉': 0 },
      planUrlIncludes: { '@资产:夏茉': 'b696508b' },
    }
  );

  await runScenario(
    '槽位 URL=库图但 originals 仍是山羊 File（鸱吻）',
    simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      panelMainSlotVisible: false,
      imagePreview: LIB.chiwen,
      referenceImages: [LIB.chiwen],
      referenceImageLabels: ['鸱吻'],
      prompt: '鸱吻@资产:鸱吻 亮相',
    }),
    {
      planTokens: ['@资产:鸱吻'],
      apiByToken: { '@资产:鸱吻': 'upload-chiwen-lib' },
      forbiddenInApi: ['a930a8b0', 'goatUpload', '3e8b2428'],
    },
    [{ name: 'goat-ink.png' } as File]
  );

  await runScenario(
    '槽位 URL=夏茉库但 originals 仍是山羊 File',
    simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      panelMainSlotVisible: false,
      imagePreview: LIB.xiamo,
      referenceImages: [LIB.xiamo, '', COS.jjjjjSc009Street],
      referenceImageLabels: ['夏茉', '', '图片3'],
      prompt: '夏茉@资产:夏茉 景别 @图片3 全景',
    }),
    {
      planTokens: ['@资产:夏茉', '@图片3'],
      apiByToken: {
        '@资产:夏茉': 'upload-xiamo-lib',
        '@图片3': 'a4783ada',
      },
      forbiddenInApi: ['a930a8b0'],
      planUrlIncludes: { '@资产:夏茉': 'b696508b' },
    },
    [{ name: 'goat-ink.png' } as File, undefined, undefined]
  );

  console.log('\n── @图片3 串位：夏茉 + 空槽 + 误拖图（仅 2 张可见）──');
  {
    const xiamoCos = 'https://cos.example.com/xiamo-panel.png';
    const goatCos = COS.inkWrong;
    const refs = [xiamoCos, '', goatCos];
    const labels = ['夏茉', '', ''];
    ok(
      '误拖槽底栏=图片2 非图片3',
      panelReferenceSlotLabel(2, refs, undefined, 'seedanceSlot') === '图片2',
      panelReferenceSlotLabel(2, refs, undefined, 'seedanceSlot')
    );
    ok(
      '@图片3 不命中误拖槽',
      resolvePictureTokenSlotIndex(3, refs, labels, undefined) == null,
      String(resolvePictureTokenSlotIndex(3, refs, labels, undefined))
    );
    ok(
      '@图片2 命中误拖槽',
      resolvePictureTokenSlotIndex(2, refs, labels, undefined) === 2,
      String(resolvePictureTokenSlotIndex(2, refs, labels, undefined))
    );
    const data = simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      panelMainSlotVisible: false,
      referenceImages: refs,
      referenceImageLabels: labels,
      prompt: '夏茉@资产:夏茉 景别 @图片3 应不存在',
    });
    const ctx = buildPromptMediaRefContextFromNode(data);
    const plan = collectReferencedMediaFromPrompt(
      getCanonicalInspectorPromptText(data, ASSETS),
      data,
      ctx,
      SLUG_MAP,
      ASSETS
    );
    ok(
      'prompt 含 @图片3 但无第三张参考 → plan 不含 @图片3',
      !plan.images.some((e) => e.token === '@图片3'),
      plan.images.map((e) => e.token).join(',')
    );
  }

  console.log(`\n=== 汇总：通过 ${pass}，失败 ${fail} ===\n`);
  if (fail > 0) process.exit(1);
  console.log('模拟环境全部通过。真实环境请 Ctrl+F5 后重跑节点，并对照 seedance-preload-summary。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

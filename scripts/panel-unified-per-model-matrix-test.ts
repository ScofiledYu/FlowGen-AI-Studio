/**
 * 各模型属性面板统一逻辑矩阵：资产名、去重、主图名、@资产 prune、标签同步。
 * 不调用生成 API。
 *
 * npx tsx scripts/panel-unified-per-model-matrix-test.ts
 */
import type { NodeData } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2 } from '../types.ts';
import {
  buildPromptMediaRefContextFromNode,
  buildPromptMediaRefLabels,
  collectReferencedMediaFromPrompt,
  getNodeInspectorPromptText,
  getCanonicalInspectorPromptText,
  buildCanonicalInspectorPromptPatch,
  buildPromptImageTokenToAssetTokenMap,
} from '../utils/promptMediaRefs.ts';
import {
  panelReferencesAlreadyContainUrl,
  tryAppendReferenceImageWithLabel,
  resolveFirstLastFramePanelDisplayLabel,
  resolveMainImagePanelDisplayLabel,
  resolveReferenceSlotDisplayLabel,
  syncReferenceImageLabelsAfterPanelPrune,
  buildReferenceImageLabelsForPanel,
} from '../utils/referenceImageSlotLabels.ts';
import {
  mergeAndPrunePanelReferenceImagesAfterUpload,
  panelMergeOptionsForReferencedUpload,
  buildFirstLastFramePanelPatchFromPlan,
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

function mockUploaded(
  plan: ReturnType<typeof collectReferencedMediaFromPrompt>
): Map<string, string> {
  const m = new Map<string, string>();
  for (const img of plan.images) m.set(img.token, `${img.url}|UP`);
  return m;
}

function refPanel(data: NodeData): string[] {
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

type MatrixRow = {
  id: string;
  data: NodeData;
  /** 有参考格时测 @资产 prune */
  assetPrune?: {
    slugMap: Map<string, string>;
    keepSlots: number[];
    emptySlots: number[];
  };
  mainUrl?: string;
  mainExpect?: string;
  refDedup?: { thumb: string; file: string; name: string };
};

const PROJ = 'matrix-proj';
const assets = [
  { slug: '萧道', name: '萧道', url: `/flowgen-api/projects/${PROJ}/assets/id-xd/file` },
  { slug: '鸱吻', name: '鸱吻', url: `/flowgen-api/projects/${PROJ}/assets/id-cw/file` },
];

const MATRIX: MatrixRow[] = [
  {
    id: 'Nano Banana 2.0',
    data: simNode({
      selectedModel: MODEL_NANO_BANANA_2,
      imagePreview: 'https://ex/nano-main.png',
      imageName: '萧道',
      referenceImages: [assets[0].url!, assets[1].url!, 'https://ex/extra.png'],
      referenceImageLabels: ['萧道', '鸱吻', ''],
      prompt: '@资产:萧道 @图片2',
    }),
    mainUrl: assets[0].url,
    mainExpect: '萧道',
    refDedup: {
      thumb: `/flowgen-api/projects/${PROJ}/assets/id-xd/thumb`,
      file: `/flowgen-api/projects/${PROJ}/assets/id-xd/file`,
      name: '萧道',
    },
    assetPrune: {
      slugMap: new Map([['萧道', assets[0].url!], ['鸱吻', assets[1].url!]]),
      keepSlots: [0, 1],
      emptySlots: [2],
    },
  },
  {
    id: 'image 2 主图+参考格底栏',
    data: simNode({
      selectedModel: MODEL_IMAGE_2,
      imagePreview: assets[0].url,
      imageName: '萧道',
      referenceImages: [assets[1].url!],
      referenceImageLabels: ['鸱吻'],
      prompt: '@主图 @图片1',
    }),
    mainUrl: assets[0].url,
    mainExpect: '萧道',
  },
  {
    id: 'image 2',
    data: simNode({
      selectedModel: MODEL_IMAGE_2,
      imagePreview: assets[1].url,
      referenceImages: [assets[1].url!, 'https://ex/only.png'],
      referenceImageLabels: ['鸱吻', ''],
      prompt: '@资产:鸱吻',
    }),
    mainUrl: assets[1].url,
    mainExpect: '鸱吻',
    assetPrune: {
      slugMap: new Map([['鸱吻', assets[1].url!]]),
      keepSlots: [0],
      emptySlots: [1],
    },
  },
  {
    id: 'seedance2.0 参考生',
    data: simNode({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      referenceImages: [assets[0].url!, assets[1].url!, 'https://ex/street.png'],
      seedanceTabConfigs: {
        reference: { prompt: '@资产:萧道 @资产:鸱吻' },
      },
    }),
    assetPrune: {
      slugMap: new Map([
        ['萧道', assets[0].url!],
        ['鸱吻', assets[1].url!],
      ]),
      keepSlots: [0, 1],
      emptySlots: [2],
    },
  },
  {
    id: '可灵3.0 Omni 多图',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      klingOmniMultiReferenceImages: [assets[0].url!, assets[1].url!, 'https://ex/skip.png'],
      referenceImageLabels: ['萧道', '鸱吻', ''],
      klingOmniMultiPrompt: '@资产:萧道 @图片2',
    }),
    assetPrune: {
      slugMap: new Map([
        ['萧道', assets[0].url!],
        ['鸱吻', assets[1].url!],
      ]),
      keepSlots: [0, 1],
      emptySlots: [2],
    },
  },
  {
    id: '可灵3.0 Omni 指令',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'instruction',
      imagePreview: assets[0].url,
      klingOmniInstructionReferenceImages: ['https://ex/a.png', 'https://ex/b.png'],
      klingOmniInstructionPrompt: '@主图 @图片1',
    }),
    mainUrl: assets[0].url,
    mainExpect: '萧道',
    assetPrune: undefined,
  },
  {
    id: '可灵3.0 Omni 视频',
    data: simNode({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'video',
      imagePreview: assets[0].url,
      klingOmniVideoReferenceImages: ['https://ex/v0.png', 'https://ex/v1.png'],
      klingOmniVideoPrompt: '@主图 @图片2',
    }),
    mainUrl: assets[0].url,
    mainExpect: '萧道',
    assetPrune: {
      slugMap: new Map(),
      keepSlots: [1],
      emptySlots: [0],
    },
  },
  {
    id: 'seedance2.0 图生',
    data: simNode({
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'image',
      firstFrameImageUrl: 'https://ex/ff.png',
      lastFrameImageUrl: 'https://ex/lf.png',
      prompt: '@首帧图',
    }),
  },
  {
    id: 'seedance1.5-pro',
    data: simNode({
      selectedModel: 'seedance1.5-pro',
      seedanceGenerationMode: 'image',
      firstFrameImageUrl: 'https://ex/s15f.png',
      prompt: '@首帧图',
    }),
  },
  {
    id: '即梦3.0 Pro',
    data: simNode({
      selectedModel: '即梦3.0 Pro',
      jimengGenerationMode: 'image',
      firstFrameImageUrl: assets[0].url,
      imagePreview: 'https://ex/blob-main',
      prompt: '@首帧图',
    }),
    mainUrl: assets[0].url,
    mainExpect: '萧道',
  },
  {
    id: 'vidu 2.0',
    data: simNode({
      selectedModel: 'vidu 2.0',
      firstFrameImageUrl: assets[1].url,
      prompt: '@首帧图',
    }),
  },
  {
    id: '可灵 2.5 Turbo',
    data: simNode({
      selectedModel: '可灵 2.5 Turbo',
      firstFrameImageUrl: 'https://ex/k25f.png',
      lastFrameImageUrl: 'https://ex/k25l.png',
      prompt: '@首帧图 @尾帧图',
    }),
  },
  {
    id: '首尾帧资产库名称',
    data: simNode({
      selectedModel: '可灵 2.5 Turbo',
      firstFrameImageUrl: assets[0].url,
      firstFrameImageLabel: '萧道',
      lastFrameImageUrl: assets[1].url,
      lastFrameImageLabel: '鸱吻',
    }),
  },
];

console.log('\n=== 各模型属性面板统一矩阵 ===\n');

for (const row of MATRIX) {
  const { id, data } = row;
  const panel = refPanel(data);
  const mode = data.selectedModel?.includes('seedance') && data.seedanceGenerationMode === 'reference'
    ? 'seedanceSlot'
    : 'panelSlot';

  {
    const ctx = buildPromptMediaRefContextFromNode(data);
    ctx.projectAssets = assets;
    const mentions = buildPromptMediaRefLabels(data, ctx);
    if (id === 'Nano Banana 2.0') {
      ok(
        `${id}: 主图槽为资产时 @资产:萧道`,
        mentions.find((m) => m.insertText === '@资产:萧道')?.label === '萧道'
      );
      ok(
        `${id}: 槽0 @资产展示名`,
        mentions.find((m) => m.insertText === '@资产:萧道')?.label === '萧道'
      );
      ok(
        `${id}: 槽1 @资产展示名`,
        mentions.find((m) => m.insertText === '@资产:鸱吻')?.label === '鸱吻'
      );
    }
    if (id === 'seedance2.0 参考生') {
      ok(
        `${id}: 槽1 @资产展示名`,
        mentions.find((m) => m.insertText === '@资产:鸱吻')?.label === '鸱吻'
      );
    }
    if (id === '首尾帧资产库名称') {
      const m = buildPromptMediaRefLabels(data, ctx);
      ok('@资产:萧道 首帧', m.find((x) => x.insertText === '@资产:萧道')?.label === '萧道');
      ok('@资产:鸱吻 尾帧', m.find((x) => x.insertText === '@资产:鸱吻')?.label === '鸱吻');
      ok('无泛称 @首帧图 token', !m.some((x) => x.insertText === '@首帧图'));
    }
  }

  if (id === '首尾帧资产库名称') {
    ok(
      '首帧底栏=资产名',
      resolveFirstLastFramePanelDisplayLabel(data, 'first', assets) === '萧道'
    );
    ok(
      '尾帧底栏=资产名',
      resolveFirstLastFramePanelDisplayLabel(data, 'last', assets) === '鸱吻'
    );
    ok(
      '首帧 URL 推断资产名',
      resolveFirstLastFramePanelDisplayLabel(
        { firstFrameImageUrl: assets[0].url },
        'first',
        assets
      ) === '萧道'
    );
  }

  if (row.mainUrl && row.mainExpect) {
    ok(
      `${id}: 主图格资产名`,
      resolveMainImagePanelDisplayLabel(row.mainUrl, { projectAssets: assets }) === row.mainExpect
    );
  }

  if (row.refDedup) {
    const { thumb, file, name } = row.refDedup;
    ok(`${id}: thumb/file 去重`, panelReferencesAlreadyContainUrl([thumb], file));
    const a = tryAppendReferenceImageWithLabel([], [], thumb, name);
    const b = tryAppendReferenceImageWithLabel(a.referenceImages, a.referenceImageLabels, file, name);
    ok(`${id}: 重复拖入不增格`, !b.added && b.referenceImages.length === 1);
    ok(`${id}: 标签保留`, b.referenceImageLabels[0] === name);
  }

  const labels = data.referenceImageLabels || [];
  if (
    (id === '可灵3.0 Omni 指令' || id === '可灵3.0 Omni 视频') &&
    data.imagePreview?.trim() &&
    !data.imagePreview.includes('.mp4')
  ) {
    const ctx = buildPromptMediaRefContextFromNode(data);
    const labels = buildPromptMediaRefLabels(data, ctx);
    ok(`${id}: 素材引用含@主图`, labels.some((i) => i.insertText === '@主图'));
    const mainInRefs =
      id === '可灵3.0 Omni 指令'
        ? data.klingOmniInstructionReferenceImages || []
        : data.klingOmniVideoReferenceImages || [];
    const mainUrl = data.imagePreview?.replace(/\|UP$/i, '') || '';
    const dupMain = mainInRefs.some(
      (u) => u && mainUrl && panelReferencesAlreadyContainUrl([u], mainUrl)
    );
    ok(`${id}: 参考数组不含与主图重复项`, !dupMain, JSON.stringify(mainInRefs));
  }

  if (id.includes('image 2 主图')) {
    const cap = resolveReferenceSlotDisplayLabel(
      0,
      data.referenceImages,
      data.referenceImageLabels,
      data.imagePreview,
      'panelSlot',
      assets,
      data.imageName
    );
    ok(`${id}: 参考格显示资产名非图片1`, cap === '鸱吻', cap);
  }

  const inspectorPrompt =
    getNodeInspectorPromptText(data) ||
    data.prompt ||
    data.klingOmniMultiPrompt ||
    data.klingOmniInstructionPrompt ||
    data.klingOmniVideoPrompt ||
    '';
  if (/@图片\d/.test(inspectorPrompt)) {
    const ctxForRemap = buildPromptMediaRefContextFromNode(data);
    ctxForRemap.projectAssets = assets;
    const tokenMap = buildPromptImageTokenToAssetTokenMap(data, ctxForRemap, assets);
    if (tokenMap.size > 0) {
      const canonPrompt = getCanonicalInspectorPromptText(data, assets);
      const promptPicTokens = inspectorPrompt.match(/@图片\d+/g) || [];
      const hasDragOnlyInPrompt = promptPicTokens.some((tok) => tokenMap.get(tok) === tok);
      if (hasDragOnlyInPrompt) {
        ok(
          `${id}: 未入库 @图片n 保留`,
          /@图片\d/.test(canonPrompt) && !/@资产:[^\s]+\s*\d/.test(canonPrompt),
          canonPrompt
        );
      } else {
        ok(
          `${id}: @图片n 规范为 @资产`,
          canonPrompt.includes('@资产:') && !/@图片\d/.test(canonPrompt),
          canonPrompt
        );
        ok(`${id}: 规范写回 patch`, buildCanonicalInspectorPromptPatch(data, assets) != null);
      }
    }
  }

  for (let i = 0; i < panel.length; i++) {
    const u = panel[i];
    if (!String(u || '').trim()) continue;
    const cap = resolveReferenceSlotDisplayLabel(
      i,
      panel,
      labels,
      data.imagePreview,
      mode,
      assets,
      data.imageName
    );
    const expectCustom = labels[i]?.trim();
    const expectAsset =
      expectCustom ||
      (u.includes('id-xd') ? '萧道' : u.includes('id-cw') ? '鸱吻' : '');
    if (expectAsset) {
      ok(`${id}: 槽${i}底栏`, cap === expectAsset || cap.startsWith('图片'), `${cap}`);
    }
  }

  if (row.assetPrune) {
    const prompt =
      getNodeInspectorPromptText(data) ||
      data.prompt ||
      data.klingOmniMultiPrompt ||
      data.klingOmniInstructionPrompt ||
      data.klingOmniVideoPrompt ||
      '';
    const ctx = buildPromptMediaRefContextFromNode(data);
    const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, row.assetPrune.slugMap);
    const uploaded = mockUploaded(plan);
    const after = mergeAndPrunePanelReferenceImagesAfterUpload(
      panel,
      plan.images,
      uploaded,
      panelMergeOptionsForReferencedUpload(
        plan.images,
        uploaded,
        data.imagePreview,
        row.assetPrune.slugMap,
        data.referenceImageLabels
      )
    );
    for (const i of row.assetPrune.keepSlots) {
      ok(`${id}: prune 保留槽${i}`, String(after[i] || '').endsWith('|UP'));
    }
    for (const i of row.assetPrune.emptySlots) {
      ok(`${id}: prune 清空槽${i}`, !String(after[i] || '').trim());
    }
    const synced = syncReferenceImageLabelsAfterPanelPrune(
      panel,
      labels,
      after
    );
    for (const i of row.assetPrune.keepSlots) {
      if (labels[i]) {
        ok(`${id}: prune 后标签槽${i}`, synced[i] === labels[i], `${synced[i]} vs ${labels[i]}`);
      }
    }
    const rebuilt = buildReferenceImageLabelsForPanel(
      after.map((u) => u.replace(/\|UP$/i, '')),
      plan,
      assets
    );
    for (const i of row.assetPrune.keepSlots) {
      const raw = after[i]?.replace(/\|UP$/i, '');
      if (raw?.includes('id-xd') || raw?.includes('id-cw')) {
        ok(`${id}: rebuild 标签槽${i}`, Boolean(rebuilt[i]?.trim()), rebuilt[i]);
      }
    }
  }

  if (
    data.selectedModel === '即梦3.0 Pro' ||
    data.selectedModel === 'vidu 2.0' ||
    data.selectedModel === '可灵 2.5 Turbo' ||
    (data.selectedModel?.includes('seedance') && data.seedanceGenerationMode === 'image')
  ) {
    const prompt = data.prompt || '';
    const plan = collectReferencedMediaFromPrompt(
      prompt,
      data,
      buildPromptMediaRefContextFromNode(data),
      new Map()
    );
    const patch = buildFirstLastFramePanelPatchFromPlan(plan.images, {
      startUrl: 'https://ex/uploaded-start|UP',
      endUrl: 'https://ex/uploaded-end|UP',
    });
    ok(`${id}: 首尾帧 patch 可写`, patch != null);
  }
}

console.log(`\n=== 汇总 ===\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
console.log('各模型属性面板统一矩阵通过。');

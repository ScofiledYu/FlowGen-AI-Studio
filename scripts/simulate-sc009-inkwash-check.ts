/**
 * sc009：API 实际 URL vs Node Details 展示 URL vs 创意描述 @
 * npx tsx scripts/simulate-sc009-inkwash-check.ts
 */
import { readFileSync } from 'node:fs';
import type { NodeData } from '../types.ts';
import {
  buildPromptMediaRefContextFromNode,
  buildReferenceImageDetailItemsFromPanel,
  collectReferencedMediaFromPrompt,
  getCanonicalInspectorPromptText,
} from '../utils/promptMediaRefs.ts';
import {
  buildReferenceOnlyImagesForApiPayload,
  enrichPlanImagesWithPanelSlotIndexes,
  resolveReferencedImageUploadSource,
} from '../utils/referencedMediaRun.ts';
import { buildNodeDetailsReferencePreview } from '../utils/nodeDetailsPreview.ts';

const PROJ = '7b5c23a2-a38b-479a-9553-3fda49c5d5e7';
const XIAOMO_LIB = `/flowgen-api/projects/${PROJ}/assets/b696508b-4b73-4e19-939d-111febee4f32/file`;
const assets = [
  { slug: 'xiamo', name: '夏茉', url: XIAOMO_LIB },
  { slug: 'street1', name: '萧塘镇街道1', url: `/flowgen-api/projects/${PROJ}/assets/street-real/file` },
];
const slugMap = new Map([
  ['夏茉', XIAOMO_LIB],
  ['萧塘镇街道1', assets[1].url],
]);

const raw = JSON.parse(readFileSync('e:/test/66666666666.json', 'utf8'));
const proc = raw.nodes.find((n: { data?: { label?: string } }) => n.data?.label === 'ep001_seq001_sc009');
const mov = raw.nodes.find(
  (n: { data?: { customName?: string; generationParams?: unknown } }) =>
    n.data?.customName === 'ep001_seq001_sc009' && n.data?.generationParams
);
const data = proc.data as NodeData;
const gp = (mov?.data?.generationParams || data.generationParams) as {
  referenceImages?: string[];
};

const SLOT0_COS = '567b17e9-c640-4c3d-a198-da6837842a20';
const SLOT2_COS = 'a731af12-62b6-4069-8704-559990702c94';

const prompt = getCanonicalInspectorPromptText(data, assets);
console.log('=== sc009 创意描述中的 @ ===\n');
console.log(prompt.includes('@资产:夏茉') ? '  有 @资产:夏茉' : '  无 @资产:夏茉');
console.log(
  prompt.includes('@资产:萧塘镇街道1') ? '  有 @资产:萧塘镇街道1（景别/构图行）' : '  无 @资产:萧塘镇街道1'
);
console.log(prompt.includes('@图片') ? '  有 @图片n' : '  无 @图片n');

const ctx = buildPromptMediaRefContextFromNode(data);
const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, slugMap, assets);
const enriched = enrichPlanImagesWithPanelSlotIndexes(data.referenceImages || [], plan.images, {
  referenceImageLabels: data.referenceImageLabels,
  panelMainSlotVisible: false,
  projectAssetSlugToUrl: slugMap,
});

console.log('\n=== 实际发给 Seedance API 的 referenceImages（generationParams）===\n');
(gp.referenceImages || []).forEach((u, i) => {
  const tag = u.includes(SLOT0_COS)
    ? '← 槽0 COS（面板标签：夏茉）'
    : u.includes(SLOT2_COS)
      ? '← 槽2 COS（面板标签：萧塘镇街道1）'
      : u.includes('b696508b')
        ? '← 夏茉资产库 file'
        : '';
  console.log(`  [${i + 1}] ${u.slice(-55)} ${tag}`);
});
console.log(
  '\n注意：API 用的是上传后的 COS，不是 Node Details 里显示的 localhost 库地址 b696508b。'
);

const uploadCtx = {
  originals: { referenceImages: [] as Array<File | null | undefined> },
  panelReferenceImages: data.referenceImages,
  projectAssetSlugToUrl: slugMap,
  projectAssets: assets,
  isFlowgenAssetThumbUrl: () => false,
  flowgenAssetFileUrlFromMediaUrl: (u: string) => u,
};
console.log('\n=== 当前代码：各 @ 实际上传源 ===\n');
for (const e of enriched) {
  const src = resolveReferencedImageUploadSource(e, uploadCtx as any);
  console.log(`  ${e.token} → ${src.includes('b696508b') ? '夏茉库 b696508b' : src.slice(-50)}`);
}

const snapRefs = gp.referenceImages || [];
const panelSource = { ...data, seedanceGenerationMode: 'reference' as const };
const urlPool = [...snapRefs, ...(data.referenceImages || []), data.imagePreview].filter(Boolean);
const details = buildNodeDetailsReferencePreview({
  panelSource,
  urlPool: urlPool as string[],
  projectAssets: assets,
});
console.log('\n=== Node Details 展示的 2 张（易与 API 混淆）===\n');
details.referenceImageDetailItems.forEach((it, i) => {
  console.log(`  [${i + 1}] 标签=${it.label} url尾段=${it.url.slice(-55)}`);
});

console.log('\n=== 结论 ===\n');
console.log(
  '若水墨图是第 2 张缩略图：创意描述里写了「@资产:萧塘镇街道1」，该图作为第 2 张参考进 API，不是未引用拖图。'
);
console.log(
  '若水墨图被拖在「夏茉」槽且旧运行用槽 COS：API 第 1 张会是 567b17e9 而非 b696508b 库图，会出现「Details 显示夏茉库、模型吃错图」。'
);
console.log('请对照 Node Details 两张图顺序与上面 [1][2] 标签是否一致。');

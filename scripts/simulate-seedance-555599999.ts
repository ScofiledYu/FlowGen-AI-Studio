/**
 * 复现 555599999.json：Seedance 2.0 参考生 @资产:鸱吻 / @图片3 / @资产:萧逍
 * npx tsx scripts/simulate-seedance-555599999.ts
 */
import { readFileSync } from 'node:fs';
import type { NodeData } from '../types.ts';
import {
  buildPromptMediaRefContextFromNode,
  buildReferenceIndexOptionsFromPlan,
  collectReferencedMediaFromPrompt,
  filterProjectAssetsForReferencedPlan,
  getCanonicalInspectorPromptText,
  resolvePromptPlaceholders,
} from '../utils/promptMediaRefs.ts';
import {
  buildReferenceOnlyImagesForApiPayload,
  enrichPlanImagesWithPanelSlotIndexes,
  resolveReferencedImageUploadSource,
  slotOriginalFileConflictsWithPlanEntry,
} from '../utils/referencedMediaRun.ts';

const PROJ = '7b5c23a2-a38b-479a-9553-3fda49c5d5e7';
const CHIWEN_LIB = `/flowgen-api/projects/${PROJ}/assets/e2ef07fd-4566-4913-80ae-929be8b875b6/file`;
const XIAO_LIB = `/flowgen-api/projects/${PROJ}/assets/7171f71a-cd1a-4985-9acf-66583b1d149e/file`;
const SLOT0_COS =
  'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/737f95ec-ce8a-4c6a-a574-d9cfe48d6904.png';
const IMG3_COS =
  'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/ae187891-9bcb-4c5a-b3d0-38ce29c1aa69.png';

const assets = [
  { slug: 'chiwen', name: '鸱吻', url: CHIWEN_LIB },
  { slug: 'xiaoxiao', name: '萧逍', url: XIAO_LIB },
];
const slugMap = new Map([
  ['chiwen', CHIWEN_LIB],
  ['鸱吻', CHIWEN_LIB],
  ['xiaoxiao', XIAO_LIB],
  ['萧逍', XIAO_LIB],
]);

const raw = JSON.parse(readFileSync('e:/test/555599999.json', 'utf8'));
const proc = raw.nodes.find((n: { id: string }) => n.id === 'node_7_1780574409861');
const data = proc.data as NodeData;

const prompt = getCanonicalInspectorPromptText(data, assets);
const ctx = buildPromptMediaRefContextFromNode(data);
const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, slugMap, assets);
const enriched = enrichPlanImagesWithPanelSlotIndexes(data.referenceImages || [], plan.images, {
  referenceImageLabels: data.referenceImageLabels,
  panelMainSlotVisible: false,
  projectAssetSlugToUrl: slugMap,
});

console.log('\n=== plan（创意描述 @ 顺序）===\n');
for (const e of enriched) {
  console.log(
    JSON.stringify({
      token: e.token,
      imageIndex: e.imageIndex,
      label: e.label,
      refImageSlotIndex: e.refImageSlotIndex,
      planUrl: e.url?.slice(0, 120),
    })
  );
}

const uploadCtx = {
  originals: { referenceImages: [] },
  panelReferenceImages: data.referenceImages,
  projectAssetSlugToUrl: slugMap,
  projectAssets: assets,
  isFlowgenAssetThumbUrl: (u: string) => /\/assets\/[^/]+\/thumb/i.test(u),
  flowgenAssetFileUrlFromMediaUrl: (u: string) => u.replace(/\/thumb(\?.*)?$/i, '/file$1'),
};

console.log('\n=== 上传源（@资产:鸱吻 应走库图 e2ef07fd，非槽位 737f95ec）===\n');
for (const e of enriched) {
  const src = resolveReferencedImageUploadSource(e, uploadCtx as any);
  const slot =
    e.refImageSlotIndex != null
      ? data.referenceImages?.[e.refImageSlotIndex]
      : undefined;
  console.log(
    e.token,
    '→',
    src.includes('e2ef07fd') ? 'OK 鸱吻库' : src.includes('737f95ec') ? 'BAD 错槽COS' : src.slice(0, 80),
    '| slotConflict=',
    slot ? slotOriginalFileConflictsWithPlanEntry(e, slot) : 'n/a'
  );
}

const mockUploaded = new Map<string, string>();
for (const e of enriched) {
  const src = resolveReferencedImageUploadSource(e, uploadCtx as any);
  mockUploaded.set(
    e.token,
    src.includes('flowgen-api') ? `https://cos.mock/uploaded-${e.imageIndex}.png` : src
  );
}
const apiRefs = buildReferenceOnlyImagesForApiPayload(enriched, mockUploaded);
console.log('\n=== API referenceImages（应对应 plan 顺序 3 张）===\n');
apiRefs.forEach((u, i) => console.log(i + 1, u.slice(0, 100)));

const filteredAssets = filterProjectAssetsForReferencedPlan(assets, plan);
const resolveOpts = buildReferenceIndexOptionsFromPlan(plan, {
  projectAssets: filteredAssets.map((a) => ({
    slug: a.slug,
    name: a.name,
    url: a.url || '',
  })),
});
const resolved = resolvePromptPlaceholders(prompt, data, ctx, resolveOpts);

console.log('\n=== preload：prompt 展开（@资产:鸱吻 须含「第1张」或 referenceImages）===\n');
const chiwenIdx = resolveOpts.referenceImageIndexByToken?.get('@资产:鸱吻');
console.log('imageIndex @资产:鸱吻 =', chiwenIdx);
console.log('鸱吻已展开为 [图', chiwenIdx, ']:', resolved.includes(`第${chiwenIdx}张`) || resolved.includes(`[图${chiwenIdx}]`));
console.log('仍留裸 token @资产:鸱吻:', resolved.includes('@资产:鸱吻'));
console.log('\n--- promptAfterResolve（前 800 字）---\n');
console.log(resolved.slice(0, 800));

const gp = data.generationParams as { referenceImages?: string[] } | undefined;
console.log('\n=== JSON 内已保存 generationParams.referenceImages ===\n');
(gp?.referenceImages || []).forEach((u: string, i: number) => {
  const tag = u.includes('737f95ec')
    ? '← 槽0错图(鸱吻位)'
    : u.includes('ae187891')
      ? '← @图片3'
      : u.includes('e2ef07fd')
        ? '← 鸱吻库(期望)'
        : '← 萧逍等';
  console.log(i + 1, u.slice(0, 90), tag);
});

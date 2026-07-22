/**
 * 全模型矩阵：主图 URL = 某参考槽 URL 时，是否出现「主图不展示 + 参考槽被去重/sync 清空」双边丢图。
 *
 * npx tsx scripts/20260709-all-models-main-dup-ref-panel-test.ts
 */
import type { NodeData } from '../types.ts';
import {
  buildPanelReferenceDisplayEntries,
  dedupePanelReferenceDisplayEntries,
  filterPanelReferenceDisplayEntriesExcludingMainPreview,
  isPanelRefDuplicateOfMainImageSlot,
  panelRefDisplayDedupeKey,
  resolvePanelReferenceSlotDisplayUrl,
} from '../utils/referenceImageSlotLabels.ts';
import {
  shouldShowPanelMainImageSlot,
  shouldDedupePanelRefsAgainstMainForSync,
  panelMainOverlapsAnyReferenceSlot,
  panelReferenceLabelImagePreview,
  resolvePanelMainSlotPreviewUrl,
  panelReferenceDisplaySlots,
} from '../utils/referencedMediaRun.ts';
import { isLikelyMainVideoUrl } from '../utils/promptMediaRefs.ts';
import { buildImage2PanelDisplayEntries } from '../utils/image2PanelRefs.ts';
import { buildPanelRefSlotSyncPatch } from '../utils/panelRefPersistence.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  [OK] ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const U = {
  a: 'https://example.com/a.png',
  b: 'https://example.com/b.png',
  c: 'https://example.com/c.png',
  d: 'https://example.com/d.png',
  e: 'https://example.com/e.png',
};
const LABELS = ['图A', '图B', '石头', '图D', '图E'];
const REFS = [U.a, U.b, U.c, U.d, U.e];

function baseData(partial: Partial<NodeData>): NodeData {
  return {
    label: 'n',
    referenceImages: [...REFS],
    referenceImageLabels: [...LABELS],
    imagePreview: U.c,
    panelMainSlotVisible: true,
    status: 'idle',
    ...partial,
  } as NodeData;
}

function seedanceShowMain(data: NodeData): boolean {
  if (!shouldShowPanelMainImageSlot(data)) return false;
  const p = resolvePanelMainSlotPreviewUrl(data);
  if (!p || isLikelyMainVideoUrl(p)) {
    return Boolean(String(data.imageLocalRef || '').trim());
  }
  const mainKey = panelRefDisplayDedupeKey(p, data.imageName, undefined);
  if (!mainKey) return true;
  const refs = data.referenceImages || [];
  const dupInRefs = refs.some((raw, i) => {
    const u = String(raw || '').trim();
    if (!u) return false;
    const cap = data.referenceImageLabels?.[i];
    const k = panelRefDisplayDedupeKey(
      resolvePanelReferenceSlotDisplayUrl(u, cap, undefined),
      cap,
      undefined
    );
    return k === mainKey;
  });
  if (dupInRefs && String(data.imageLocalRef || '').trim() && data.panelMainSlotVisible === false) {
    return true;
  }
  return !dupInRefs;
}

function seedanceDisplay(data: NodeData) {
  const showMain = seedanceShowMain(data);
  const mainForDedupe = panelReferenceLabelImagePreview(data) ?? data.imagePreview;
  const base = buildPanelReferenceDisplayEntries(data.referenceImages, {
    imagePreview: mainForDedupe,
    dedupeAgainstMain: showMain,
    referenceImageLabels: data.referenceImageLabels,
  });
  let entries = dedupePanelReferenceDisplayEntries(base, data.referenceImageLabels);
  if (showMain) {
    entries = filterPanelReferenceDisplayEntriesExcludingMainPreview(
      entries,
      mainForDedupe,
      data.imageName,
      data.referenceImageLabels,
      undefined,
      data
    );
  }
  return { showMain, labels: entries.map((e) => data.referenceImageLabels?.[e.slotIndex] || '') };
}

function nanoDisplay(data: NodeData) {
  const nanoHideVideoMain =
    !!resolvePanelMainSlotPreviewUrl(data) &&
    isLikelyMainVideoUrl(resolvePanelMainSlotPreviewUrl(data)!);
  const showMain =
    Boolean(resolvePanelMainSlotPreviewUrl(data)) &&
    shouldShowPanelMainImageSlot(data) &&
    !nanoHideVideoMain;
  const mainForRefGrid = panelReferenceLabelImagePreview(data) ?? data.imagePreview;
  const entries = buildPanelReferenceDisplayEntries(data.referenceImages, {
    imagePreview: mainForRefGrid,
    dedupeAgainstMain: showMain,
    referenceImageLabels: data.referenceImageLabels,
  });
  return { showMain, labels: entries.map((e) => data.referenceImageLabels?.[e.slotIndex] || '') };
}

function omniDisplay(data: NodeData) {
  const p = data.imagePreview?.trim();
  const showMain = Boolean(p && !isLikelyMainVideoUrl(p) && shouldShowPanelMainImageSlot(data));
  const slots = panelReferenceDisplaySlots(data.referenceImages || [])
    .map(({ url, slotIndex }) => ({ img: url, origIdx: slotIndex }))
    .filter(
      ({ img }) => !showMain || !isPanelRefDuplicateOfMainImageSlot(img, data, undefined)
    );
  return { showMain, labels: slots.map((s) => data.referenceImageLabels?.[s.origIdx] || '') };
}

function image2Display(data: NodeData) {
  const showMain =
    shouldShowPanelMainImageSlot(data) &&
    Boolean(
      (() => {
        const p = resolvePanelMainSlotPreviewUrl(data);
        if (p && !isLikelyMainVideoUrl(p)) return true;
        return Boolean(String(data.imageLocalRef || '').trim());
      })()
    );
  const entries = buildImage2PanelDisplayEntries(data);
  return { showMain, labels: entries.map((e) => data.referenceImageLabels?.[e.slotIndex] || '') };
}

function stoneVisible(showMain: boolean, labels: string[]): boolean {
  return labels.includes('石头') || showMain;
}

function syncKeepsStone(data: NodeData, dedupeAgainstMain: boolean): boolean {
  const patch = buildPanelRefSlotSyncPatch(data, { dedupeAgainstMain, skipGpRestore: true });
  const refs =
    patch?.klingOmniMultiReferenceImages ||
    patch?.referenceImages ||
    data.klingOmniMultiReferenceImages ||
    data.referenceImages ||
    [];
  return refs.includes(U.c) || String(refs[2] || '').trim() === U.c;
}

console.log('=== 全模型：主图=参考槽同 URL 双边丢图矩阵 ===\n');

console.log('--- A：展示层（panelMainSlotVisible=true, imagePreview=石头）---');
{
  // 真实用户态：imageName 与参考标签同名 → Seedance 隐藏主图格、保留 5 参考
  const seedanceReal = baseData({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    imageName: '石头',
  });
  const sd = seedanceDisplay(seedanceReal);
  ok('Seedance(imageName=石头)：主图格隐藏', sd.showMain === false);
  ok('Seedance：参考格 5 张含石头', sd.labels.length === 5 && sd.labels.includes('石头'), sd.labels.join(','));

  const nano = nanoDisplay(baseData({ selectedModel: 'Nano Banana 2.0' }));
  ok('Nano：石头可见（主图格或参考格）', stoneVisible(nano.showMain, nano.labels), `main=${nano.showMain} ${nano.labels.join(',')}`);

  const omni = omniDisplay(
    baseData({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      klingOmniMultiReferenceImages: [...REFS],
    })
  );
  ok('Omni：石头可见', stoneVisible(omni.showMain, omni.labels), `main=${omni.showMain} ${omni.labels.join(',')}`);

  const img2 = image2Display(baseData({ selectedModel: 'image 2' }));
  ok('image2：石头可见', stoneVisible(img2.showMain, img2.labels), `main=${img2.showMain} ${img2.labels.join(',')}`);
}

console.log('\n--- B：panelMainSlotVisible=false（画布=首个@，主图格隐藏）---');
for (const [name, fn, extra] of [
  [
    'Seedance',
    seedanceDisplay,
    { selectedModel: 'seedance2.0 (急速版)', seedanceGenerationMode: 'reference' },
  ],
  ['Nano', nanoDisplay, { selectedModel: 'Nano Banana 2.0' }],
  ['Omni', omniDisplay, { selectedModel: '可灵3.0 Omni', klingOmniTab: 'multi' }],
  ['image2', image2Display, { selectedModel: 'image 2' }],
] as const) {
  const d = fn(
    baseData({
      ...extra,
      panelMainSlotVisible: false,
      panelMainImageUrl: undefined,
    })
  );
  ok(`${name}：石头仍在参考格`, d.labels.includes('石头'), d.labels.join(','));
}

console.log('\n--- C：数据层 overlap 检测 + sync 策略 ---');
{
  const seedance = baseData({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    imageName: '石头',
  });
  const nano = baseData({ selectedModel: 'Nano Banana 2.0' });
  const image2 = baseData({ selectedModel: 'image 2' });
  const omni = baseData({
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'multi',
    klingOmniMultiReferenceImages: [...REFS],
  });

  ok('Seedance overlap=true', panelMainOverlapsAnyReferenceSlot(seedance));
  ok('Nano overlap=true', panelMainOverlapsAnyReferenceSlot(nano));
  ok('image2 overlap=true', panelMainOverlapsAnyReferenceSlot(image2));
  ok('Omni overlap=true', panelMainOverlapsAnyReferenceSlot(omni));

  ok('Seedance sync 不去重', shouldDedupePanelRefsAgainstMainForSync(seedance) === false);
  ok('image2 sync 不去重', shouldDedupePanelRefsAgainstMainForSync(image2) === false);
  ok('Omni sync 不去重', shouldDedupePanelRefsAgainstMainForSync(omni) === false);

  ok('Seedance sync 保留石头', syncKeepsStone(seedance, shouldDedupePanelRefsAgainstMainForSync(seedance)));
  ok('image2 sync 保留石头', syncKeepsStone(image2, shouldDedupePanelRefsAgainstMainForSync(image2)));
  ok('Omni sync 保留石头', syncKeepsStone(omni, shouldDedupePanelRefsAgainstMainForSync(omni)));
  ok('Nano sync 保留石头（历来 false）', syncKeepsStone(nano, false));
}

console.log('\n--- D：主图与参考不同 URL 时 sync 仍可去重 ---');
{
  const distinct = baseData({
    selectedModel: 'image 2',
    imagePreview: 'https://example.com/distinct-main.png',
    imageName: '独立主图',
  });
  ok('无 overlap', panelMainOverlapsAnyReferenceSlot(distinct) === false);
  ok('可 sync 去重', shouldDedupePanelRefsAgainstMainForSync(distinct) === true);
  // 去重不应误伤非主图槽
  ok('sync 后石头仍在（非主图）', syncKeepsStone(distinct, true));
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

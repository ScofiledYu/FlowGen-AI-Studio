/**
 * 复现 e:/问题/0709/nodes-Input Picture Node-Output Mov -1783590031269.json：
 * Seedance 参考生运行后 imagePreview 与某参考槽同 URL（石头）时，
 * 主图格因重复隐藏，参考槽又被按主图去重 → 该图从面板消失。
 *
 * 修复：仅当 seedanceShowMainInRefGrid 为 true 时才对参考槽去重。
 *
 * npx tsx scripts/20260709-seedance-main-dup-ref-panel-test.ts
 */
import fs from 'fs';
import type { NodeData } from '../types.ts';
import {
  buildPanelReferenceDisplayEntries,
  dedupePanelReferenceDisplayEntries,
  filterPanelReferenceDisplayEntriesExcludingMainPreview,
  panelRefDisplayDedupeKey,
  resolvePanelReferenceSlotDisplayUrl,
} from '../utils/referenceImageSlotLabels.ts';
import {
  shouldShowPanelMainImageSlot,
  shouldDedupePanelRefsAgainstMainPreview,
  panelReferenceLabelImagePreview,
  resolvePanelMainSlotPreviewUrl,
} from '../utils/referencedMediaRun.ts';
import { isLikelyMainVideoUrl } from '../utils/promptMediaRefs.ts';

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

/** 与 NodeInspector.seedanceShowMainInRefGrid 一致 */
function computeSeedanceShowMainInRefGrid(data: NodeData): boolean {
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

/** 与修复后 NodeInspector.seedanceRefDisplayEntries 一致 */
function computeSeedanceRefDisplayEntries(
  data: NodeData,
  showMainInRefGrid: boolean
): Array<{ url: string; slotIndex: number }> {
  const seedanceRefs = data.referenceImages || [];
  const mainForDedupe = panelReferenceLabelImagePreview(data) ?? data.imagePreview;
  const dedupeAgainstMain = showMainInRefGrid;
  const base = buildPanelReferenceDisplayEntries(seedanceRefs, {
    imagePreview: mainForDedupe,
    dedupeAgainstMain,
    referenceImageLabels: data.referenceImageLabels,
  });
  let entries = dedupePanelReferenceDisplayEntries(base, data.referenceImageLabels);
  if (dedupeAgainstMain) {
    entries = filterPanelReferenceDisplayEntriesExcludingMainPreview(
      entries,
      mainForDedupe,
      data.imageName,
      data.referenceImageLabels,
      undefined,
      data
    );
  }
  return entries;
}

/** 修复前：用 shouldShowPanelMainImageSlot / shouldDedupe… 去重（会丢石头） */
function computeBuggyEntries(data: NodeData): Array<{ url: string; slotIndex: number }> {
  const seedanceRefs = data.referenceImages || [];
  const mainForDedupe = panelReferenceLabelImagePreview(data) ?? data.imagePreview;
  const base = buildPanelReferenceDisplayEntries(seedanceRefs, {
    imagePreview: mainForDedupe,
    dedupeAgainstMain: shouldDedupePanelRefsAgainstMainPreview(data),
    referenceImageLabels: data.referenceImageLabels,
  });
  let entries = dedupePanelReferenceDisplayEntries(base, data.referenceImageLabels);
  if (shouldShowPanelMainImageSlot(data)) {
    entries = filterPanelReferenceDisplayEntriesExcludingMainPreview(
      entries,
      mainForDedupe,
      data.imageName,
      data.referenceImageLabels,
      undefined,
      data
    );
  }
  return entries;
}

const jsonPath =
  process.argv[2] || 'scripts/fixtures/20260709-seedance-main-dup-ref-panel.json';
const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const data = raw.nodes[0].data as NodeData;

console.log('=== 20260709 Seedance 主图=参考槽同 URL 面板丢图 ===\n');
console.log('model:', data.selectedModel, 'mode:', data.seedanceGenerationMode);
console.log('labels:', data.referenceImageLabels);
console.log(
  'imagePreview slot:',
  data.referenceImageLabels?.[(data.referenceImages || []).indexOf(data.imagePreview || '')]
);

const showMain = computeSeedanceShowMainInRefGrid(data);
const buggy = computeBuggyEntries(data);
const fixed = computeSeedanceRefDisplayEntries(data, showMain);
const buggyLabels = buggy.map((e) => data.referenceImageLabels?.[e.slotIndex] || '');
const fixedLabels = fixed.map((e) => data.referenceImageLabels?.[e.slotIndex] || '');

ok('主图格因与参考槽重复而不展示', showMain === false);
ok(
  '修复前展示缺「石头」（回归锚点）',
  buggy.length === 4 && !buggyLabels.includes('石头'),
  buggyLabels.join(',')
);
ok(
  '修复后 5 张参考图全在',
  fixed.length === 5 && fixedLabels.includes('石头'),
  fixedLabels.join(',')
);
ok(
  '修复后标签顺序完整',
  fixedLabels.join(',') === '原始丛林小路,卷卷,石头,大牙,土坑',
  fixedLabels.join(',')
);

// 对照：主图格实际展示时仍应去重（不回归）
const distinctMain = {
  ...data,
  imagePreview: 'https://example.com/distinct-main.png',
  imageName: '独立主图',
  panelMainSlotVisible: true,
  panelMainImageUrl: undefined,
} as NodeData;
const showMainDistinct = computeSeedanceShowMainInRefGrid(distinctMain);
const entriesDistinct = computeSeedanceRefDisplayEntries(distinctMain, showMainDistinct);
ok('独立主图时仍展示主图格', showMainDistinct === true);
ok(
  '独立主图时参考槽仍为 5（无同 URL 去重）',
  entriesDistinct.length === 5,
  String(entriesDistinct.length)
);

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

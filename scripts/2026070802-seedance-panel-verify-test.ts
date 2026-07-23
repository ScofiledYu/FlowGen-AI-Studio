/**
 * 复现 2026070802-seedance2.0面板少图.json：Seedance 参考生运行后
 * - 面板保留 4 槽（含未@ 的 图片2/图片3）
 * - gp/Details 仅 @图片1+@图片4
 * - mediaPatch 不得用 gp-only 2 张覆盖面板 4 张导致 labels 串位
 *
 * npx tsx scripts/2026070802-seedance-panel-verify-test.ts
 */
import fs from 'fs';
import type { NodeData } from '../types.ts';
import { resolveFixtureFile } from './fixturePath.ts';
import {
  buildPanelReferenceDisplayEntries,
  filterPanelReferenceDisplayEntriesExcludingMainPreview,
  dedupePanelReferenceDisplayEntries,
} from '../utils/referenceImageSlotLabels.ts';
import {
  shouldShowPanelMainImageSlot,
  shouldDedupePanelRefsAgainstMainPreview,
  panelReferenceLabelImagePreview,
} from '../utils/referencedMediaRun.ts';
import { buildSeedanceReferenceDetailsFromSnapshot } from '../utils/nodeDetailsPreview.ts';

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

function simulateSeedancePanelAfterRun(input: {
  panelBefore: string[];
  labelsBefore: string[];
  prompt: string;
  gpRefs: string[];
  gpLabels: string[];
  previewPatch: Partial<NodeData>;
  /** 修复后：mediaPatch 跳过 referenceImages/Labels */
  skipMediaPatchPanelRefs: boolean;
  seedancePanelMergedRefs: string[] | null;
  seedancePanelMergedLabels: string[] | null;
}): NodeData {
  const dataIn = {
    label: 'n',
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    referenceImages: [...input.panelBefore],
    referenceImageLabels: [...input.labelsBefore],
    prompt: input.prompt,
    panelMainImageUrl: 'blob:http://localhost:3001/c64fa17a-main-backup',
    panelMainSlotVisible: false,
    status: 'completed',
  } as NodeData;

  const mergedRefs = input.seedancePanelMergedRefs ?? [...input.panelBefore];
  const mergedPanelLabels = input.seedancePanelMergedLabels ?? [...input.labelsBefore];

  // 模拟 mediaPatch（修复前会 clobber 为 gp-only）
  let liveRefs = [...mergedRefs];
  let liveLabels = [...mergedPanelLabels];
  if (!input.skipMediaPatchPanelRefs) {
    liveRefs = [...input.gpRefs];
    liveLabels = [...input.gpLabels];
  }

  // 模拟 buildUpdatedRunNodeData Seedance 分支（修复后优先 seedancePanelMerged*）
  const panelRefsFromRun = input.seedancePanelMergedRefs?.length
    ? [...input.seedancePanelMergedRefs]
    : liveRefs;
  const panelLabelsFromRun = input.seedancePanelMergedLabels?.some((l) => l.trim())
    ? [...input.seedancePanelMergedLabels]
    : liveLabels;

  return {
    ...dataIn,
    ...input.previewPatch,
    referenceImages: panelRefsFromRun,
    referenceImageLabels: panelLabelsFromRun,
    generationParams: {
      referenceImages: input.gpRefs,
      referenceImageLabels: input.gpLabels,
      prompt: input.prompt,
      model: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
    },
  };
}

function panelDisplayCount(data: NodeData): number {
  const mainForDedupe = panelReferenceLabelImagePreview(data) ?? data.imagePreview;
  const base = buildPanelReferenceDisplayEntries(data.referenceImages, {
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
  return entries.length;
}

const jsonPath =
  process.argv[2] || resolveFixtureFile('2026070802-seedance2.0面板少图.json', 'd:/json/2026070802-seedance2.0面板少图.json');
const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const exported = raw.nodes[0].data as NodeData;
const mov = raw.nodes[1].data as NodeData;

const URL1 =
  'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/d46611d7-5d25-4175-a092-5859d5aa8baa.png';
const URL2 =
  'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/38fa157a-f96c-4da9-81b1-ea7d78698b79.png';
const BLOB3 = 'blob:http://localhost:3001/2453096a-11eb-49f2-8b51-d99bbc1d9116';
const URL4 =
  'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/9d40e364-f80f-4c87-b78f-49d5411804ff.png';
const panelBefore = [URL1, URL2, BLOB3, URL4];
const labelsBefore = ['图片1', '图片2', '图片3', '图片4'];
const prompt = '@图片1和@图片4的角色镜头融合';
const gpRefs = [URL1, URL4];
const gpLabels = ['图片1', '图片4'];
const previewPatch = {
  imagePreview: URL1,
  panelMainSlotVisible: false as const,
  panelMainImageUrl: exported.panelMainImageUrl,
};

console.log('\n=== 导出 JSON 当前态（面板 4 槽 + Details 2 张@）===\n');
ok('导出 referenceImages=4', (exported.referenceImages || []).filter(Boolean).length === 4);
ok('导出 labels 与 refs 等长', (exported.referenceImageLabels || []).length === 4);
ok('导出 UI 显示 4 槽', panelDisplayCount(exported) === 4);

const gp = mov.generationParams!;
const details = buildSeedanceReferenceDetailsFromSnapshot({
  snapshotRefs: (gp.referenceImages as string[]) || [],
  snapshotLabels: gp.referenceImageLabels as string[] | undefined,
  prompt: gp.prompt as string,
});
ok('MOV Details 仅 2 张@引用图', details.referenceImages.length === 2);
ok('MOV Details 标签=图片1+图片4', details.referenceImageDetailItems.map((i) => i.label).join('+') === '图片1+图片4');

console.log('\n=== 修复前：mediaPatch clobber gp-only → labels 串位 → 面板少图 ===\n');
const broken = simulateSeedancePanelAfterRun({
  panelBefore,
  labelsBefore,
  prompt,
  gpRefs,
  gpLabels,
  previewPatch,
  skipMediaPatchPanelRefs: false,
  seedancePanelMergedRefs: null,
  seedancePanelMergedLabels: null,
});
ok('修复前 refs 被 clobber 为 2（面板少图）', (broken.referenceImages || []).length === 2);
ok('修复前 UI 仅显示 2 槽', panelDisplayCount(broken) === 2);

console.log('\n=== 修复后：skip mediaPatch + seedancePanelMerged* ===\n');
const fixed = simulateSeedancePanelAfterRun({
  panelBefore,
  labelsBefore,
  prompt,
  gpRefs,
  gpLabels,
  previewPatch,
  skipMediaPatchPanelRefs: true,
  seedancePanelMergedRefs: panelBefore,
  seedancePanelMergedLabels: labelsBefore,
});
ok('修复后 refs=4', (fixed.referenceImages || []).length === 4);
ok(
  '修复后 labels 与 refs 等长',
  (fixed.referenceImageLabels || []).length === (fixed.referenceImages || []).length
);
ok('修复后 labels 仍为 图片1~4', fixed.referenceImageLabels?.join('+') === labelsBefore.join('+'));
ok('修复后 UI 显示 4 槽', panelDisplayCount(fixed) === 4);

console.log(`\n=== 汇总：${pass} 通过, ${fail} 失败 ===\n`);
if (fail > 0) process.exit(1);

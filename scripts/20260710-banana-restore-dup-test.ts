/**
 * 复现 d:/json/banana-丢图2.json vs banana-正常.json：
 * Nano 未 @主图运行后，选中节点时 buildPanelMainImageRestorePatchForEditing
 * 因「有 panelMainImageUrl 就 restore」把 imagePreview 盖回主图（白泽），
 * 造成：主图格与画布/参考语义错乱（重复感）+ modelConfigs 与顶层不一致 + 下次生成错乱。
 *
 * 正常态：imagePreview 保持首个 @ 参考；主图格仅用 panelMainImageUrl；restore=undefined。
 * 全模型：Nano / image2 / Omni 共用 restore 门禁。
 *
 * npx tsx scripts/20260710-banana-restore-dup-test.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { NodeData } from '../types.ts';
import { MODEL_NANO_BANANA_2 } from '../types.ts';
import {
  collectReferencedMediaFromPrompt,
  buildPromptMediaRefContextFromNode,
} from '../utils/promptMediaRefs.ts';
import {
  mergeAndPrunePanelReferenceImagesAfterUpload,
  panelMergeOptionsForReferencedUpload,
  buildPanelImagePreviewPatchAfterRun,
  buildPanelMainImageRestorePatchForEditing,
  shouldShowPanelMainImageSlot,
  resolvePanelMainSlotPreviewUrl,
  resolveCanvasNodePreviewUrl,
  panelReferenceLabelImagePreview,
} from '../utils/referencedMediaRun.ts';
import {
  resolveReferenceImageLabelsAfterPanelRun,
  buildPanelReferenceDisplayEntries,
} from '../utils/referenceImageSlotLabels.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const badPath = path.join(__dirname, 'fixtures', '20260710-banana-restore-dup.json');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

function simulateAfterRun(preRun: NodeData, uploaded: Map<string, string>) {
  const ctx = buildPromptMediaRefContextFromNode(preRun);
  const plan = collectReferencedMediaFromPrompt(preRun.prompt || '', preRun, ctx, new Map(), []);
  const panelBefore = [...(preRun.referenceImages || [])];
  const merged = mergeAndPrunePanelReferenceImagesAfterUpload(
    panelBefore,
    plan.images,
    uploaded,
    panelMergeOptionsForReferencedUpload(
      plan.images,
      uploaded,
      preRun.imagePreview,
      undefined,
      preRun.referenceImageLabels
    )
  );
  const labels = resolveReferenceImageLabelsAfterPanelRun({
    panelBefore,
    labelsBefore: preRun.referenceImageLabels,
    panelAfter: merged,
    plan,
  });
  const patch = buildPanelImagePreviewPatchAfterRun(plan.images, uploaded, {
    nodeData: preRun,
    mergedPanelRefs: merged,
    mergedPanelLabels: labels,
  });
  const after = {
    ...preRun,
    ...patch,
    referenceImages: merged,
    referenceImageLabels: labels,
  } as NodeData;
  const restore = buildPanelMainImageRestorePatchForEditing(after);
  const final = { ...after, ...(restore || {}) } as NodeData;
  return { plan, after, restore, final, merged, labels };
}

// --- fixture from banana-丢图2 ---
const src = JSON.parse(fs.readFileSync('d:/json/banana-丢图2.json', 'utf8'));
const badNode = src.nodes[0].data as NodeData;
fs.mkdirSync(path.dirname(badPath), { recursive: true });
fs.writeFileSync(
  badPath,
  JSON.stringify(
    {
      selectedModel: badNode.selectedModel,
      prompt: badNode.prompt,
      imagePreview: badNode.panelMainImageUrl || badNode.imagePreview,
      imageName: badNode.imageName,
      projectAssetId: badNode.projectAssetId,
      referenceImages: badNode.referenceImages,
      referenceImageLabels: badNode.referenceImageLabels,
      referenceElementIds: badNode.referenceElementIds,
      gpRefs: badNode.generationParams?.referenceImages,
      gpLabels: badNode.generationParams?.referenceImageLabels,
    },
    null,
    2
  ),
  'utf8'
);

const fixture = JSON.parse(fs.readFileSync(badPath, 'utf8'));
const preRun: NodeData = {
  selectedModel: MODEL_NANO_BANANA_2,
  prompt: fixture.prompt,
  imagePreview: fixture.imagePreview,
  imageName: fixture.imageName,
  projectAssetId: fixture.projectAssetId,
  referenceImages: fixture.referenceImages,
  referenceImageLabels: fixture.referenceImageLabels,
};

console.log('\n=== Banana 丢图2：未 @主图运行后不得 restore 盖回主图 ===');
{
  const uploaded = new Map<string, string>([
    ['@图片3', fixture.gpRefs[0]],
    ['@图片4', fixture.gpRefs[1]],
  ]);
  const { restore, final, merged } = simulateAfterRun(preRun, uploaded);
  ok('面板槽数不变', merged.length === 4, String(merged.length));
  ok('restore 必须为 undefined', restore === undefined);
  ok(
    'imagePreview 保持首个 @ 参考（图片3）',
    final.imagePreview === fixture.gpRefs[0],
    String(final.imagePreview).slice(0, 50)
  );
  ok(
    '主图格仍为白泽备份',
    resolvePanelMainSlotPreviewUrl(final) === fixture.imagePreview,
    String(resolvePanelMainSlotPreviewUrl(final)).slice(0, 50)
  );
  ok(
    '画布=图片3 非白泽',
    resolveCanvasNodePreviewUrl(final) === fixture.gpRefs[0],
    String(resolveCanvasNodePreviewUrl(final)).slice(0, 50)
  );
  ok(
    'imagePreview 不等于主图备份（无重复冒充）',
    final.imagePreview !== fixture.imagePreview
  );
  const show =
    Boolean(resolvePanelMainSlotPreviewUrl(final)) && shouldShowPanelMainImageSlot(final);
  const entries = buildPanelReferenceDisplayEntries(final.referenceImages, {
    imagePreview: panelReferenceLabelImagePreview(final) ?? final.imagePreview,
    dedupeAgainstMain: show,
    referenceImageLabels: final.referenceImageLabels,
  });
  ok('参考格仍 4 张', entries.length === 4, String(entries.length));
}

console.log('\n=== @主图 时仍允许 restore ===');
{
  const withMain: NodeData = {
    ...preRun,
    prompt: '@主图参考@图片3风格生成',
    panelMainSlotVisible: false,
    panelMainImageUrl: fixture.imagePreview,
    imagePreview: fixture.gpRefs[0],
    referenceImages: fixture.referenceImages,
    referenceImageLabels: fixture.referenceImageLabels,
  };
  const restore = buildPanelMainImageRestorePatchForEditing(withMain);
  ok('有 @主图 时可 restore', Boolean(restore?.imagePreview), JSON.stringify(restore));
  ok(
    'restore 回主图备份',
    restore?.imagePreview === fixture.imagePreview
  );
}

console.log('\n=== 全模型：未 @主图 + 有备份 → restore 必须 undefined ===');
const models: Array<{ id: string; data: Partial<NodeData> }> = [
  { id: 'Nano Banana 2.0', data: { selectedModel: MODEL_NANO_BANANA_2 } },
  { id: 'image 2', data: { selectedModel: 'image 2' } },
  {
    id: '可灵3.0 Omni multi',
    data: { selectedModel: '可灵3.0 Omni', klingOmniTab: 'multi' },
  },
  {
    id: 'seedance2.0 参考生',
    data: {
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
    },
  },
];
for (const m of models) {
  const data: NodeData = {
    ...m.data,
    prompt: '@图片1参考@图片2风格',
    imagePreview: 'https://cos.example/ref1.png',
    panelMainImageUrl: 'https://cos.example/main.png',
    panelMainSlotVisible: false,
    referenceImages: ['https://cos.example/ref1.png', 'https://cos.example/ref2.png'],
    referenceImageLabels: ['图片1', '图片2'],
  } as NodeData;
  const restore = buildPanelMainImageRestorePatchForEditing(data);
  ok(`${m.id}: restore=undefined`, restore === undefined);
  ok(`${m.id}: 主图格仍可见(备份)`, shouldShowPanelMainImageSlot(data) === true);
}

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);

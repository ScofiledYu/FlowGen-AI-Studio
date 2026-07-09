/**
 * 复现：主图=城市、图片1=猫、光头强、图片3=教堂；运行后图片1变城市
 * npx tsx scripts/778990-cat-church-panel-test.ts
 */
import type { NodeData } from '../types.ts';
import {
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
} from '../utils/promptMediaRefs.ts';
import {
  buildPanelImagePreviewPatchAfterRun,
  mergeAndPrunePanelReferenceImagesAfterUpload,
  panelMergeOptionsForReferencedUpload,
  panelReferenceImagesForUpload,
} from '../utils/referencedMediaRun.ts';
import {
  compactImage2PanelReferences,
  image2PanelRefsPatchIfChanged,
} from '../utils/image2PanelRefs.ts';
import { resolveReferenceImageLabelsAfterPanelRun } from '../utils/referenceImageSlotLabels.ts';

const city = 'https://cos/city-night.png';
const cat = 'https://cos/cat-forest.png';
const gtq = 'https://cos/guangtouqiang.png';
const church = 'https://cos/church-gold.png';
const prompt = '@图片1的角色出现在@图片3中';

const data = {
  selectedModel: 'image 2',
  imagePreview: city,
  referenceImages: [cat, gtq, church],
  referenceImageLabels: ['图片1', '光头强', '图片3'],
  prompt,
} as NodeData;

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const ctx = buildPromptMediaRefContextFromNode(data);
const plan = collectReferencedMediaFromPrompt(prompt, data, ctx, new Map());
ok('plan @图片1=猫', plan.images.find((e) => e.token === '@图片1')?.url === cat);
ok('plan @图片3=教堂', plan.images.find((e) => e.token === '@图片3')?.url === church);

const panelBefore = panelReferenceImagesForUpload(data) || [];
ok('upload 面板含猫', panelBefore[0] === cat, JSON.stringify(panelBefore));

const uploaded = new Map<string, string>([
  ['@图片1', `${cat}|UP`],
  ['@图片3', `${church}|UP`],
]);
const mergeOpts = panelMergeOptionsForReferencedUpload(
  plan.images,
  uploaded,
  city,
  undefined,
  data.referenceImageLabels
);
const panelAfter = mergeAndPrunePanelReferenceImagesAfterUpload(
  panelBefore,
  plan.images,
  uploaded,
  mergeOpts
);
ok('prune 槽0=猫', panelAfter[0] === `${cat}|UP`, JSON.stringify(panelAfter));
ok('prune 槽1保留未@光头强', panelAfter[1] === gtq, JSON.stringify(panelAfter));
ok('prune 槽2=教堂', panelAfter[2] === `${church}|UP`, JSON.stringify(panelAfter));

const labels = resolveReferenceImageLabelsAfterPanelRun({
  panelBefore,
  labelsBefore: data.referenceImageLabels,
  panelAfter,
  plan,
});
ok('标签0=图片1', labels[0] === '图片1');
ok('标签2=图片3', labels[2] === '图片3');

const previewPatch = buildPanelImagePreviewPatchAfterRun(plan.images, uploaded, {
  nodeData: data,
  mergedPanelRefs: panelAfter,
  mergedPanelLabels: labels,
});
ok('隐藏主图格', previewPatch.panelMainSlotVisible === false);
ok('imagePreview=首个@参考图(猫)', previewPatch.imagePreview === `${cat}|UP` && previewPatch.panelMainImageUrl === city, String(previewPatch.imagePreview));

const afterRun = {
  ...data,
  ...previewPatch,
  referenceImages: panelAfter,
  referenceImageLabels: labels,
} as NodeData;

const compact = compactImage2PanelReferences(afterRun);
ok('compact 后仍含猫', compact.referenceImages.includes(`${cat}|UP`), JSON.stringify(compact));
ok('compact 后仍含教堂', compact.referenceImages.includes(`${church}|UP`));
ok('compact 不含城市', !compact.referenceImages.includes(city) && !compact.referenceImages.includes(`${city}|UP`));

const patch = image2PanelRefsPatchIfChanged(afterRun);
ok('Inspector 无稀疏空槽，不需压紧', patch === undefined);
if (patch) {
  ok('compact patch 槽0=猫', patch.referenceImages?.[0] === `${cat}|UP`);
  ok('compact patch 槽1=教堂', patch.referenceImages?.[1] === `${church}|UP`);
}

console.log('\n--- 若 imagePreview 仍为城市（写回 bug）---\n');
const bugState = {
  ...data,
  panelMainSlotVisible: false as const,
  imagePreview: city,
  referenceImages: [`${cat}|UP`, '', `${church}|UP`],
  referenceImageLabels: ['图片1', '', '图片3'],
} as NodeData;
const bugCompact = compactImage2PanelReferences(bugState);
ok('city preview + sparse: compact 仍含猫', bugCompact.referenceImages.includes(`${cat}|UP`));
ok('city preview + sparse: compact 不含城市', !bugCompact.referenceImages.includes(city));

const wrongPanel = {
  ...data,
  panelMainSlotVisible: false as const,
  imagePreview: city,
  referenceImages: [city, `${church}|UP`],
  referenceImageLabels: ['图片1', '图片3'],
} as NodeData;
ok('错误态: 图片1=城市', wrongPanel.referenceImages[0] === city);
const wrongCompact = compactImage2PanelReferences(wrongPanel);
ok('错误态 compact 仍保留城市在槽0', wrongCompact.referenceImages[0] === city);

console.log('\n--- 主图 URL 误写入 referenceImages[0]（标签图片1）---\n');
{
  const dupData = {
    ...data,
    referenceImages: [city, cat, gtq, church],
    referenceImageLabels: ['', '图片1', '光头强', '图片3'],
  } as NodeData;
  const ctx2 = buildPromptMediaRefContextFromNode(dupData);
  const plan2 = collectReferencedMediaFromPrompt(prompt, dupData, ctx2, new Map());
  ok('dup: @图片1=猫(非城市)', plan2.images.find((e) => e.token === '@图片1')?.url === cat);
  ok('dup: @图片3=教堂', plan2.images.find((e) => e.token === '@图片3')?.url === church);
  const panelBefore2 = panelReferenceImagesForUpload(dupData) || [];
  ok('dup upload 保留槽0城市', panelBefore2[0] === city, JSON.stringify(panelBefore2));
  ok('dup upload 槽1=猫', panelBefore2[1] === cat);
  const panelAfter2 = mergeAndPrunePanelReferenceImagesAfterUpload(
    panelBefore2,
    plan2.images,
    uploaded,
    panelMergeOptionsForReferencedUpload(
      plan2.images,
      uploaded,
      city,
      undefined,
      dupData.referenceImageLabels
    )
  );
  ok('dup prune 槽1=猫', panelAfter2[1] === `${cat}|UP`, JSON.stringify(panelAfter2));
  ok('dup prune 槽3=教堂', panelAfter2[3] === `${church}|UP`, JSON.stringify(panelAfter2));
}

console.log('\n--- referenceImages[0]=城市 + 无自定义标签 ---\n');
{
  const badData = {
    ...data,
    referenceImages: [city, cat, gtq, church],
    referenceImageLabels: undefined,
  } as NodeData;
  const ctx3 = buildPromptMediaRefContextFromNode(badData);
  const plan3 = collectReferencedMediaFromPrompt(prompt, badData, ctx3, new Map());
  ok('无标签: @图片1=猫', plan3.images.find((e) => e.token === '@图片1')?.url === cat);
  const panelBefore3 = panelReferenceImagesForUpload(badData) || [];
  ok('无标签 upload 保留槽0城市', panelBefore3[0] === city);
  const panelAfter3 = mergeAndPrunePanelReferenceImagesAfterUpload(
    panelBefore3,
    plan3.images,
    uploaded,
    panelMergeOptionsForReferencedUpload(plan3.images, uploaded, city)
  );
  ok('无标签 prune 槽1=猫', panelAfter3[1] === `${cat}|UP`, JSON.stringify(panelAfter3));
  ok('无标签 prune 槽3=教堂', panelAfter3[3] === `${church}|UP`);
}

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);

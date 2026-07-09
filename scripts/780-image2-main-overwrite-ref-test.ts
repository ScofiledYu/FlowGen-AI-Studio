/**
 * 复现：image2 未 @主图，运行后图片1 被错误替换成主图
 * npx tsx scripts/780-image2-main-overwrite-ref-test.ts
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
import { resolveReferenceImageLabelsAfterPanelRun } from '../utils/referenceImageSlotLabels.ts';
import { buildImage2PanelDisplayEntries } from '../utils/image2PanelRefs.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const city = 'https://cos/city-street.png';
const hay = 'https://cos/dry-grass.png';
const wolf = 'https://cos/wolf-bw.png';
const other = 'https://cos/other-scene.png';

function simulateRun(label: string, dataIn: NodeData, prompt: string) {
  console.log(`\n=== ${label} ===`);
  console.log('  prompt:', prompt);
  console.log('  运行前 imagePreview:', dataIn.imagePreview);
  console.log('  运行前 referenceImages:', dataIn.referenceImages);
  console.log('  运行前 labels:', dataIn.referenceImageLabels);

  const ctx = buildPromptMediaRefContextFromNode(dataIn);
  const plan = collectReferencedMediaFromPrompt(prompt, dataIn, ctx, new Map());
  console.log('  plan.images:', plan.images.map((e) => ({ token: e.token, url: e.url, slot: e.refImageSlotIndex })));

  const panelBefore = panelReferenceImagesForUpload(dataIn) || [];
  console.log('  panelBefore (strip 后):', panelBefore);

  // 模拟 AITOP 上传：每个 plan entry 上传后得到不同 COS 签名 URL
  const uploaded = new Map<string, string>();
  for (const e of plan.images) {
    uploaded.set(e.token, `https://aitop-cos/${e.token.replace(/[^a-zA-Z0-9]/g, '')}-signed-${Date.now()}.png`);
  }

  const mergeOpts = panelMergeOptionsForReferencedUpload(
    plan.images,
    uploaded,
    dataIn.imagePreview,
    new Map(),
    dataIn.referenceImageLabels
  );
  const panelAfter = mergeAndPrunePanelReferenceImagesAfterUpload(
    panelBefore,
    plan.images,
    uploaded,
    mergeOpts
  );
  console.log('  panelAfter:', panelAfter);

  const labels = resolveReferenceImageLabelsAfterPanelRun({
    panelBefore,
    labelsBefore: dataIn.referenceImageLabels,
    panelAfter,
    plan,
  });
  const previewPatch = buildPanelImagePreviewPatchAfterRun(plan.images, uploaded, {
    nodeData: dataIn,
    mergedPanelRefs: panelAfter,
    mergedPanelLabels: labels,
  });
  console.log('  previewPatch:', previewPatch);

  const after = {
    ...dataIn,
    ...previewPatch,
    referenceImages: panelAfter,
    referenceImageLabels: labels,
  } as NodeData;
  console.log('  运行后 imagePreview:', after.imagePreview);
  console.log('  运行后 panelMainSlotVisible:', after.panelMainSlotVisible);
  console.log('  运行后 panelMainImageUrl:', after.panelMainImageUrl);
  console.log('  运行后 referenceImages:', after.referenceImages);

  const display = buildImage2PanelDisplayEntries(after);
  console.log('  展示 entries:', display);

  return { after, panelAfter, display };
}

// 场景 A：用户拖入 4 张不同图（主图=城市，参考=[干草, 狼, 别的]），未 @主图
const caseA = simulateRun(
  'A. 主图=城市, 参考=[干草,狼,别的], prompt=@图片1+@图片2+@图片3',
  {
    selectedModel: 'image 2',
    imagePreview: city,
    referenceImages: [hay, wolf, other],
    referenceImageLabels: ['图片1', '图片2', '图片3'],
    prompt: '@图片1 @图片2 @图片3 生成',
  } as NodeData,
  '@图片1 @图片2 @图片3 生成'
);

ok('A: panelAfter 不含城市', !caseA.panelAfter.some((u) => u === city), JSON.stringify(caseA.panelAfter));
ok('A: panelAfter[0]=干草上传URL(非城市)', caseA.panelAfter[0] !== city && Boolean(caseA.panelAfter[0]), caseA.panelAfter[0]);
ok('A: 展示图片1=干草上传URL', !caseA.display.some((e) => e.url === city), JSON.stringify(caseA.display));

// 场景 B：用户拖入时图片1=城市（与主图同素材），参考=[城市, 干草, 狼]
const caseB = simulateRun(
  'B. 主图=城市, 参考=[城市(同主图),干草,狼], prompt=@图片1+@图片2+@图片3',
  {
    selectedModel: 'image 2',
    imagePreview: city,
    referenceImages: [city, hay, wolf],
    referenceImageLabels: ['图片1', '图片2', '图片3'],
    prompt: '@图片1 @图片2 @图片3 生成',
  } as NodeData,
  '@图片1 @图片2 @图片3 生成'
);

ok('B: panelAfter 保留全部槽(含主图重复槽0)', caseB.panelAfter.length === 3, JSON.stringify(caseB.panelAfter));
ok('B: 展示不应含城市(主图除外)', !caseB.display.some((e) => e.url === city), JSON.stringify(caseB.display));

// 场景 C：用户拖入 4 张不同图，prompt 只 @图片1
const caseC = simulateRun(
  'C. 主图=城市, 参考=[干草,狼,别的], prompt=@图片1 生成',
  {
    selectedModel: 'image 2',
    imagePreview: city,
    referenceImages: [hay, wolf, other],
    referenceImageLabels: ['图片1', '图片2', '图片3'],
    prompt: '@图片1 生成',
  } as NodeData,
  '@图片1 生成'
);

ok('C: panelAfter 保留全部拖入槽', caseC.panelAfter.length === 3, JSON.stringify(caseC.panelAfter));
ok('C: panelAfter[0]=干草上传URL(非城市)', caseC.panelAfter[0] !== city && Boolean(caseC.panelAfter[0]), caseC.panelAfter[0]);
ok('C: 未@槽保留原图', caseC.panelAfter[1] === wolf && caseC.panelAfter[2] === other, JSON.stringify(caseC.panelAfter));

// 场景 E：复现 2026-07-06 用户报告「运行后面板少了一张图」
// 主图=森林在槽0，参考=[森林,野猫,干草,狼]（4 槽，槽0 与主图同素材）
// prompt=@图片1参考 @图片3风格（不 @图片2，不 @主图）
// 期望：运行后保留全部 4 张不同图（主图格 + 野猫 + 干草 + 狼），不应少图
const wildcat = 'https://cos/wildcat.png';
const forest = 'https://cos/forest.png';
const caseE = simulateRun(
  'E. 主图=森林, 参考=[森林(同主图),野猫,干草,狼], prompt=@图片1参考 @图片3风格',
  {
    selectedModel: 'image 2',
    imagePreview: forest,
    referenceImages: [forest, wildcat, hay, wolf],
    referenceImageLabels: ['图片1', '图片2', '图片3', '图片4'],
    prompt: '@图片1参考 @图片3风格',
  } as NodeData,
  '@图片1参考 @图片3风格'
);

ok('E: panelAfter 保留 4 槽(含主图重复槽0)', caseE.panelAfter.length === 4, JSON.stringify(caseE.panelAfter));
ok('E: 展示不含主图森林', !caseE.display.some((e) => e.url === forest), JSON.stringify(caseE.display));
ok('E: 展示应含野猫', caseE.display.some((e) => e.url !== forest && e.url !== hay && e.url !== wolf), JSON.stringify(caseE.display));
ok('E: 展示应含 3 个参考格(野猫+干草+狼)', caseE.display.length === 3, JSON.stringify(caseE.display));

// 场景 D：image2 @图片1 槽位无 original File（http URL），不应 fallback 主图
// 复现 780：用户报告 image2 运行后图片1 被错误替换成主图
const caseD = simulateRun(
  'D. 主图=城市(blob), 参考=[干草(http),狼(http),别的(http)], prompt=@图片1+@图片2+@图片3 (无 original File)',
  {
    selectedModel: 'image 2',
    imagePreview: city,
    referenceImages: [hay, wolf, other],
    referenceImageLabels: ['图片1', '图片2', '图片3'],
    prompt: '@图片1 @图片2 @图片3 生成',
  } as NodeData,
  '@图片1 @图片2 @图片3 生成'
);

ok('D: panelAfter[0] 不应是城市(主图)', caseD.panelAfter[0] !== city, JSON.stringify(caseD.panelAfter));
ok('D: panelAfter[0] 应是干草上传URL(非城市)', caseD.panelAfter[0] !== city && Boolean(caseD.panelAfter[0]), caseD.panelAfter[0]);
ok('D: 展示图片1 不应是城市', !caseD.display.some((e) => e.url === city), JSON.stringify(caseD.display));

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);

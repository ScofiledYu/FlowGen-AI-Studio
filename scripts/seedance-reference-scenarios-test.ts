import type { NodeData, GenerationParams } from '../types.ts';
import {
  buildSeedanceReferenceDetailsFromSnapshot,
  buildPromptReferencedDetailsImages,
} from '../utils/nodeDetailsPreview.ts';
import {
  pickSeedanceReferencePanelSnapshot,
  repairSeedanceReferenceGenerationParamsFromPanel,
  collectSeedanceReferencedMediaFromPrompt,
} from '../utils/referencedMediaRun.ts';
import {
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
} from '../utils/promptMediaRefs.ts';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

function eq<T>(a: T, b: T, name: string) {
  const same = JSON.stringify(a) === JSON.stringify(b);
  ok(name, same, same ? '' : `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

console.log('\n=== Seedance 参考生视频：各种参考图组合场景测试 ===\n');

function simulateSeedanceRun(
  panelRefs: string[],
  panelLabels: string[],
  prompt: string,
  imagePreview: string = 'https://cos/main.png'
): { gpRefs: string[]; gpLabels: string[]; panelAfterRun: { refs: string[]; labels: string[] } } {
  const projectAssets = panelLabels
    .map((label, index) => {
      if (/^图片\d+$/.test(label) || label === '主图') return null;
      return {
        slug: label,
        name: label,
        url: panelRefs[index] || `https://cos/asset-${label}.png`,
      };
    })
    .filter(Boolean);

  const nodeData: Partial<NodeData> = {
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    imagePreview,
    referenceImages: panelRefs,
    referenceImageLabels: panelLabels,
    prompt,
    seedanceTabConfigs: {
      reference: { referenceImages: panelRefs, referenceImageLabels: panelLabels },
    },
  };

  const ctx = buildPromptMediaRefContextFromNode(nodeData as NodeData);
  ctx.projectAssets = projectAssets as any;
  const plan = collectReferencedMediaFromPrompt(
    prompt,
    nodeData as NodeData,
    ctx,
    new Map(),
    projectAssets as any
  );

  const uploadedUrls: string[] = [];
  const uploadedLabels: string[] = [];
  for (const img of plan.images) {
    const slotIdx = img.refImageSlotIndex;
    if (slotIdx != null && slotIdx >= 0 && slotIdx < panelRefs.length) {
      const url = panelRefs[slotIdx] || img.url;
      uploadedUrls.push(url.replace('https://cos/', 'https://cos/upload/'));
      uploadedLabels.push(panelLabels[slotIdx] || img.token.replace('@', ''));
    } else if (img.url) {
      uploadedUrls.push(img.url.replace('https://cos/', 'https://cos/upload/'));
      uploadedLabels.push(img.token.replace('@', ''));
    }
  }

  return {
    gpRefs: uploadedUrls,
    gpLabels: uploadedLabels,
    panelAfterRun: { refs: panelRefs, labels: panelLabels },
  };
}

function testScenario(
  name: string,
  panelRefs: string[],
  panelLabels: string[],
  prompt: string,
  expectedDetailLabels: string[],
  imagePreview?: string
) {
  console.log(`\n--- ${name} ---`);
  console.log(`  prompt: "${prompt}"`);
  console.log(`  面板参考图: ${panelLabels.join(', ')}`);

  const result = simulateSeedanceRun(panelRefs, panelLabels, prompt, imagePreview);

  console.log(`  运行后 gp: ${result.gpLabels.join(', ')}`);

  const details = buildSeedanceReferenceDetailsFromSnapshot({
    snapshotRefs: result.gpRefs,
    snapshotLabels: result.gpLabels,
    prompt,
  });

  const detailLabels = details.referenceImageDetailItems.map((i) => i.label);
  console.log(`  Node Details: ${detailLabels.join(', ')}`);
  console.log(`  期望: ${expectedDetailLabels.join(', ')}`);

  eq(detailLabels.length, expectedDetailLabels.length, `参考图数量`);
  expectedDetailLabels.forEach((exp, i) => {
    ok(`第${i + 1}张图标签`, detailLabels[i] === exp, `实际=${detailLabels[i]}`);
  });

  const panelSnap = pickSeedanceReferencePanelSnapshot({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    referenceImages: panelRefs,
    referenceImageLabels: panelLabels,
    seedanceTabConfigs: { reference: { referenceImages: panelRefs, referenceImageLabels: panelLabels } },
  });
  const panelSnapValid = panelSnap.referenceImages.filter(Boolean);
  ok('面板快照不丢失', panelSnapValid.length === panelRefs.filter(Boolean).length);
}

testScenario(
  '场景1：顺序引用 @图片1 @图片2 @图片3',
  ['https://cos/ref1.png', 'https://cos/ref2.png', 'https://cos/ref3.png'],
  ['图片1', '图片2', '图片3'],
  '@图片1和@图片2在@图片3中互动',
  ['图片1', '图片2', '图片3']
);

testScenario(
  '场景2：跳序引用 @图片1 @图片3',
  ['https://cos/ref1.png', '', 'https://cos/ref3.png'],
  ['图片1', '图片2', '图片3'],
  '@图片1和@图片3互动',
  ['图片1', '图片3']
);

testScenario(
  '场景3：主图 + 图片引用 @主图 @图片2',
  ['', 'https://cos/ref2.png'],
  ['图片1', '图片2'],
  '@主图中出现@图片2的角色',
  ['主图', '图片2'],
  'https://cos/main.png'
);

testScenario(
  '场景4：资产引用 @资产:大牙',
  ['https://cos/ref1.png', 'https://cos/ref2.png'],
  ['图片1', '大牙'],
  '@资产:大牙在场景中',
  ['大牙']
);

testScenario(
  '场景5：重复引用 @图片2 @图片2',
  ['https://cos/ref1.png', 'https://cos/ref2.png'],
  ['图片1', '图片2'],
  '@图片2和@图片2互动',
  ['图片2']
);

testScenario(
  '场景6：混合引用 @主图 @资产:大牙 @图片3',
  ['', '', 'https://cos/ref3.png'],
  ['图片1', '大牙', '图片3'],
  '@主图中@资产:大牙和@图片3互动',
  ['主图', '资产:大牙', '图片3'],
  'https://cos/main.png'
);

testScenario(
  '场景7：空槽 + 跳序 @图片1 @图片4',
  ['https://cos/ref1.png', '', '', 'https://cos/ref4.png'],
  ['图片1', '图片2', '图片3', '图片4'],
  '@图片1和@图片4互动',
  ['图片1', '图片4']
);

testScenario(
  '场景8：面板图多于引用',
  ['https://cos/ref1.png', 'https://cos/ref2.png', 'https://cos/ref3.png'],
  ['图片1', '图片2', '图片3'],
  '@图片2',
  ['图片2']
);

testScenario(
  '场景9：不引用任何图（仅主图）',
  ['https://cos/ref1.png', 'https://cos/ref2.png'],
  ['图片1', '图片2'],
  '一只猫在草地上',
  [],
  'https://cos/main.png'
);

testScenario(
  '场景10：全部引用',
  ['https://cos/ref1.png', 'https://cos/ref2.png', 'https://cos/ref3.png'],
  ['图片1', '图片2', '图片3'],
  '@图片1 @图片2 @图片3',
  ['图片1', '图片2', '图片3']
);

console.log('\n=== 汇总 ===\n');
console.log(`通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
console.log('所有场景测试通过！');
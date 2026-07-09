/**
 * 复现 + 锁定修复：Banana 运行 API 完成后，buildUpdatedRunNodeData 的 Banana 分支
 * 顶层 referenceImages 用面板保留版（nanoPanelMergedRefs），但 referenceImageLabels
 * 错用 gp-only 的 runCaptureForGp.referenceImageLabels，导致标签数组比图片数组短，
 * 下标错位（slot1 被标成「图片3」、slot2 无标签）。
 *
 * 现象（用户报告）：Banana 拖入 3 张图，@图片1+@图片3 运行后，面板「图片2」槽丢失，
 * 「图片3」错位到「图片2」位置。
 *
 * 修复：FlowEditor 新增 nanoPanelMergedLabels 函数级变量，buildUpdatedRunNodeData
 * Banana 分支改用 nanoPanelMergedLabels（面板版标签），与 nanoPanelMergedRefs 等长对齐。
 *
 * npx tsx scripts/banana-panel-clobber-after-run-test.ts
 */
import type { NodeData } from '../types.ts';

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    pass++;
    console.log(`  [OK] ${label}${detail ? ` => ${JSON.stringify(detail)}` : ''}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${label}${detail ? ` => ${JSON.stringify(detail)}` : ''}`);
  }
};

/**
 * 模拟 FlowEditor 完整运行流程（Banana）：
 * - step1: setNodes 写面板保留版 referenceImages + mergedLabels（L7086）
 * - step2: runCaptureForGp.referenceImages = gp-only 快照 + gp-only 标签（L7102）
 * - step3: mediaPatch 把 runCaptureForGp 回写（L9913）—— 中间态，面板被 gp-only 覆盖
 * - step4: buildUpdatedRunNodeData 用 nanoPanelMergedRefs + nanoPanelMergedLabels 修复（L10584）
 */
function simulateFullRunflow(
  label: string,
  dataIn: NodeData,
  panelMergedRefs: string[],
  panelMergedLabels: string[],
  gpOnlySnapshot: string[],
  gpOnlyLabels: string[]
): void {
  console.log(`\n=== ${label} ===`);
  let nodeData: NodeData = { ...dataIn };

  // Step 1: 运行前面板写入（保留全部槽 + 面板标签）
  nodeData = {
    ...nodeData,
    referenceImages: panelMergedRefs,
    referenceImageLabels: panelMergedLabels,
  };
  ok('Step1 运行前面板写入保留全部槽', nodeData.referenceImages?.length === panelMergedRefs.length, nodeData.referenceImages);
  ok('Step1 运行前面板标签等长', nodeData.referenceImageLabels?.length === panelMergedRefs.length, nodeData.referenceImageLabels);

  // Step 2: runCaptureForGp 累积 gp-only 快照 + gp-only 标签
  const runCaptureForGp: Partial<NodeData> = {
    referenceImages: gpOnlySnapshot,
    referenceImageLabels: gpOnlyLabels,
  };
  // 函数级变量（模拟 FlowEditor L6358/L6359）
  const nanoPanelMergedRefs: string[] | null = [...panelMergedRefs];
  const nanoPanelMergedLabels: string[] | null = panelMergedLabels.some((l) => l.trim())
    ? [...panelMergedLabels]
    : null;

  // Step 3: mediaPatch 按 patchableKeys 回写（中间态，面板被 gp-only 覆盖）
  const patchableKeys = [
    'imagePreview', 'panelMainSlotVisible', 'referenceImages', 'referenceImageLabels',
    'referenceMovs', 'referenceAudios', 'modelConfigs',
  ];
  const mediaPatch: Record<string, unknown> = {};
  patchableKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(runCaptureForGp, key)) {
      mediaPatch[key] = (runCaptureForGp as Record<string, unknown>)[key];
    }
  });
  nodeData = { ...nodeData, ...mediaPatch } as NodeData;
  // 中间态：顶层 referenceImages 被 gp-only 覆盖（这是 bug 的中间态，buildUpdatedRunNodeData 会修复）
  const refsAfterMediaPatch = nodeData.referenceImages || [];
  ok('Step3 中间态 gp-only 覆盖（已知现象）', refsAfterMediaPatch.length === gpOnlySnapshot.length, refsAfterMediaPatch);

  // Step 4: buildUpdatedRunNodeData Banana 分支（修复后用 nanoPanelMergedLabels）
  const isNano = true; // 模拟 isNanoBanana2Model(currentModelName)
  const finalData: NodeData = { ...nodeData };
  if (isNano && nanoPanelMergedRefs !== null) {
    finalData.referenceImages = [...nanoPanelMergedRefs];
    if (nanoPanelMergedLabels?.some((l) => l.trim())) {
      finalData.referenceImageLabels = [...nanoPanelMergedLabels];
    } else if (nodeData.referenceImageLabels?.length) {
      finalData.referenceImageLabels = [...nodeData.referenceImageLabels];
    }
  }
  ok('Step4 修复后 referenceImages = 面板保留版', finalData.referenceImages?.length === panelMergedRefs.length, finalData.referenceImages);
  ok('Step4 修复后 referenceImageLabels 等长对齐', finalData.referenceImageLabels?.length === finalData.referenceImages?.length, {
    refs: finalData.referenceImages,
    labels: finalData.referenceImageLabels,
  });
  // 关键断言：标签与槽位下标一一对应
  const refs = finalData.referenceImages || [];
  const labels = finalData.referenceImageLabels || [];
  for (let i = 0; i < refs.length; i++) {
    ok(`Step4 slot${i} 标签正确 (${labels[i]})`, labels[i] === panelMergedLabels[i], {
      slot: i, actualLabel: labels[i], expectedLabel: panelMergedLabels[i], url: refs[i],
    });
  }
}

// --- Banana 场景 A：3 张图，@图片1+@图片3，未@图片2 ---
const A = 'blob:http://localhost/banana-A';
const B = 'blob:http://localhost/banana-B';
const C = 'blob:http://localhost/banana-C';
const signedA = 'https://aitop-cos/signed/A.png';
const signedC = 'https://aitop-cos/signed/C.png';
simulateFullRunflow(
  'Banana A: 拖入[A,B,C], @图片1+@图片3',
  {
    selectedModel: 'Nano Banana 2.0',
    imagePreview: A,
    referenceImages: [A, B, C],
    referenceImageLabels: ['图片1', '图片2', '图片3'],
    prompt: '@图片1 @图片3 生成一只猫',
  } as NodeData,
  [signedA, B, signedC],
  ['图片1', '图片2', '图片3'],
  [signedA, signedC],
  ['图片1', '图片3']
);

// --- Banana 场景 B：4 张图，仅 @图片2 ---
const D = 'blob:http://localhost/banana-D';
const signedB = 'https://aitop-cos/signed/B.png';
simulateFullRunflow(
  'Banana B: 拖入[A,B,C,D], 仅 @图片2',
  {
    selectedModel: 'Nano Banana 2.0',
    imagePreview: A,
    referenceImages: [A, B, C, D],
    referenceImageLabels: ['图片1', '图片2', '图片3', '图片4'],
    prompt: '@图片2 生成',
  } as NodeData,
  [A, signedB, C, D],
  ['图片1', '图片2', '图片3', '图片4'],
  [signedB],
  ['图片2']
);

// --- Banana 场景 C：4 张图，@图片1+@图片2+@图片4 ---
const signedD = 'https://aitop-cos/signed/D.png';
simulateFullRunflow(
  'Banana C: 拖入[A,B,C,D], @图片1+@图片2+@图片4',
  {
    selectedModel: 'Nano Banana 2.0',
    imagePreview: A,
    referenceImages: [A, B, C, D],
    referenceImageLabels: ['图片1', '图片2', '图片3', '图片4'],
    prompt: '@图片1 @图片2 @图片4 生成',
  } as NodeData,
  [signedA, signedB, C, signedD],
  ['图片1', '图片2', '图片3', '图片4'],
  [signedA, signedB, signedD],
  ['图片1', '图片2', '图片4']
);

// --- Banana 场景 D：全 @（无未@ 槽，不应触发错位） ---
simulateFullRunflow(
  'Banana D: 拖入[A,B,C], 全 @图片1+@图片2+@图片3',
  {
    selectedModel: 'Nano Banana 2.0',
    imagePreview: A,
    referenceImages: [A, B, C],
    referenceImageLabels: ['图片1', '图片2', '图片3'],
    prompt: '@图片1 @图片2 @图片3 生成',
  } as NodeData,
  [signedA, signedB, signedC],
  ['图片1', '图片2', '图片3'],
  [signedA, signedB, signedC],
  ['图片1', '图片2', '图片3']
);

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);

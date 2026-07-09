/**
 * 面板「主图」格 × 创意描述 @ 引用规则（全模型 / 未来模型须注册）
 * npm run test:panel-main-slot
 */
import type { NodeData } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2 } from '../types.ts';
import {
  PANEL_MAIN_IMAGE_SLOT_SCENARIOS,
  buildPanelMainImagePreservePatchOnEdit,
  buildPanelMainImageRestorePatchForEditing,
  shouldShowPanelMainImageSlot,
} from '../utils/referencedMediaRun.ts';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

function simNode(partial: Partial<NodeData> & { selectedModel: string }): NodeData {
  return { label: 'panel-main-slot', ...partial } as NodeData;
}

const main = 'https://cos.example/main-cat.png';
const ref1 = 'https://cos.example/ref-deer.png';
const ref2 = 'https://cos.example/ref-goat.png';
const promptPicOnly = '@图片1参考@图片2风格';
const promptWithMain = '@主图 参考 @图片2风格';

console.log('\n=== 1. 表驱动：各模型/tab 须遵守主图格 × prompt 规则 ===\n');

for (const scenario of PANEL_MAIN_IMAGE_SLOT_SCENARIOS) {
  const base = simNode({
    selectedModel: scenario.model,
    imagePreview: main,
    referenceImages: [ref1, ref2],
    referenceImageLabels: ['图片1', '图片2'],
    prompt: promptPicOnly,
    ...scenario.dataPatch,
  });
  const withMainPrompt = { ...base, prompt: promptWithMain, ...(scenario.mainPromptPatch || {}) };
  const emptyPrompt = { ...base, prompt: '', ...(scenario.emptyPromptPatch || {}) };

  ok(
    `${scenario.id} · @图片1@图片2 编辑态仍展示主图格`,
    shouldShowPanelMainImageSlot(base) === true
  );
  ok(
    `${scenario.id} · 运行后未@主图 → 仍展示主图格（panelMainImageUrl 备份）`,
    shouldShowPanelMainImageSlot({
      ...base,
      imagePreview: ref1,
      panelMainImageUrl: main,
    }) === true
  );
  ok(
    `${scenario.id} · 显式 panelMainSlotVisible=false → 隐藏`,
    shouldShowPanelMainImageSlot({ ...base, panelMainSlotVisible: false }) === false
  );
  ok(
    `${scenario.id} · @主图 → 展示主图格`,
    shouldShowPanelMainImageSlot(withMainPrompt) === true
  );
  if (scenario.expectShowMainWhenEmptyPrompt !== false) {
    ok(
      `${scenario.id} · 空 prompt → 默认展示主图格`,
      shouldShowPanelMainImageSlot(emptyPrompt) === true
    );
  }

  const afterRun = {
    ...base,
    imagePreview: ref1,
    panelMainImageUrl: main,
  };
  ok(
    `${scenario.id} · 运行后重选且无@主图 → 主图格已可见无需 restore`,
    buildPanelMainImageRestorePatchForEditing(afterRun) === undefined
  );

  if (scenario.expectRestoreWithMainPrompt) {
    const afterRunMain = {
      ...withMainPrompt,
      panelMainSlotVisible: false as const,
      panelMainImageUrl: main,
    };
    const restore = buildPanelMainImageRestorePatchForEditing(afterRunMain);
    ok(
      `${scenario.id} · legacy 隐藏 + @主图 运行后可恢复主图格`,
      restore?.panelMainSlotVisible === undefined
    );
  }
}

console.log('\n=== 2. hhhh.json 回归：Nano 仅 2 张参考槽 ===\n');

{
  const data = simNode({
    selectedModel: MODEL_NANO_BANANA_2,
    imagePreview: main,
    referenceImages: [ref1, ref2],
    referenceImageLabels: ['图片1', '图片2'],
    prompt: promptPicOnly,
  });
  ok('Nano 编辑态仍展示主图格', shouldShowPanelMainImageSlot(data));
  ok(
    'Nano 运行后未@主图仍展示主图格',
    shouldShowPanelMainImageSlot({
      ...data,
      imagePreview: ref1,
      panelMainImageUrl: main,
    })
  );
}

console.log('\n=== 3. 纯文本 prompt 仍展示主图（无 @ 图片类 token）===\n');

{
  const data = simNode({
    selectedModel: MODEL_NANO_BANANA_2,
    imagePreview: main,
    referenceImages: [],
    prompt: '水墨风猫咪',
  });
  ok('纯文本展示主图', shouldShowPanelMainImageSlot(data));
}

console.log('\n=== 4. 运行后改创意描述：legacy 隐藏标记仍保留主图格 ===\n');

{
  const afterRun = simNode({
    selectedModel: MODEL_NANO_BANANA_2,
    imagePreview: ref1,
    panelMainSlotVisible: false,
    panelMainImageUrl: main,
    referenceImages: [ref1, ref2],
    referenceImageLabels: ['图片1', '图片2'],
    prompt: promptPicOnly,
  });
  ok('legacy false + 备份 → 仍展示主图格', shouldShowPanelMainImageSlot(afterRun) === true);
  ok(
    '改 prompt 后仍展示主图格',
    shouldShowPanelMainImageSlot({ ...afterRun, prompt: `${promptPicOnly}，加强细节` }) === true
  );
  ok(
    '编辑时清除 legacy 隐藏标记',
    buildPanelMainImagePreservePatchOnEdit(afterRun)?.panelMainSlotVisible === undefined
  );
}

console.log(`\n=== 汇总: ${pass} 通过, ${fail} 失败 ===\n`);
if (fail > 0) process.exit(1);

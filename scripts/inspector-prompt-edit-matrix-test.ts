/**
 * 创意描述编辑矩阵：粘贴 / @ 下拉 / 扫描 / tab 同步 / 粘贴守卫
 * 覆盖各模型与 tab，不调用 API。
 *
 * npx tsx scripts/inspector-prompt-edit-matrix-test.ts
 */
import type { NodeData } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2 } from '../types.ts';
import {
  buildInspectorPromptMentionItems,
  buildNodePromptUpdatePatch,
  buildPromptMediaRefContextForRun,
  buildScanPromptAndPanelPatch,
  getNodeInspectorPromptText,
} from '../utils/promptMediaRefs.ts';

const ASSETS = [
  { name: '石头', slug: 'shi-tou', url: 'https://ex/stone' },
  { name: '卷卷', slug: 'juan-juan', url: 'https://ex/juan' },
  { name: '熊大', slug: 'xiong-da', url: 'https://ex/xiong' },
];

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

function sim(partial: Partial<NodeData> & { selectedModel: string }): NodeData {
  return { label: 'sim', ...partial } as NodeData;
}

/** 与 NodeInspector.handlePromptChange 粘贴守卫一致（2026-06 修复） */
function resolveInspectorPromptChangeAccept(
  pendingPasteText: string | null,
  nextValue: string,
  skipNext: boolean
): boolean {
  let pending = pendingPasteText;
  let skip = skipNext;
  if (pending !== null) {
    if (nextValue === pending) return false;
    pending = null;
    skip = false;
  }
  if (skip) return false;
  return true;
}

type MatrixRow = {
  id: string;
  data: NodeData;
  /** buildNodePromptUpdatePatch 后须写入的 tab 字段 */
  tabField?: keyof NodeData;
};

const MATRIX: MatrixRow[] = [
  { id: 'nano', data: sim({ selectedModel: MODEL_NANO_BANANA_2, prompt: '旧' }) },
  { id: 'image2', data: sim({ selectedModel: MODEL_IMAGE_2, prompt: '旧' }) },
  { id: 'kling25', data: sim({ selectedModel: '可灵 2.5 Turbo', prompt: '旧' }) },
  { id: 'jimeng', data: sim({ selectedModel: '即梦3.0 Pro', prompt: '旧' }) },
  { id: 'vidu', data: sim({ selectedModel: 'vidu 2.0', prompt: '旧' }) },
  { id: 'seedance15', data: sim({ selectedModel: 'seedance1.5-pro', prompt: '旧' }) },
  {
    id: 'seedance20-text',
    data: sim({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'text',
      prompt: '旧顶层',
      seedanceTabConfigs: { text: { prompt: '旧tab' } },
    }),
    tabField: 'seedanceTabConfigs',
  },
  {
    id: 'seedance20-image',
    data: sim({
      selectedModel: 'seedance2.0 (高质量版)',
      seedanceGenerationMode: 'image',
      prompt: '旧顶层',
      seedanceTabConfigs: { image: { prompt: '旧tab' } },
    }),
    tabField: 'seedanceTabConfigs',
  },
  {
    id: 'seedance20-reference',
    data: sim({
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference',
      prompt: '旧顶层',
      referenceImages: [ASSETS[0].url!],
      referenceImageLabels: ['石头'],
      seedanceTabConfigs: {
        reference: { prompt: '旧tab @资产:石头', referenceImages: [ASSETS[0].url!] },
      },
    }),
    tabField: 'seedanceTabConfigs',
  },
  {
    id: 'omni-multi',
    data: sim({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      prompt: '旧',
      klingOmniMultiPrompt: '旧multi',
      klingOmniMultiReferenceImages: [ASSETS[0].url!],
      referenceImageLabels: ['石头'],
    }),
    tabField: 'klingOmniMultiPrompt',
  },
  {
    id: 'omni-instruction',
    data: sim({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'instruction',
      prompt: '旧',
      klingOmniInstructionPrompt: '旧instruction',
      klingOmniInstructionReferenceImages: [ASSETS[0].url!],
      referenceImageLabels: ['石头'],
    }),
    tabField: 'klingOmniInstructionPrompt',
  },
  {
    id: 'omni-video',
    data: sim({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'video',
      prompt: '旧',
      klingOmniVideoPrompt: '旧video',
      klingOmniVideoReferenceImages: [ASSETS[0].url!],
      referenceImageLabels: ['石头'],
    }),
    tabField: 'klingOmniVideoPrompt',
  },
  {
    id: 'omni-frames',
    data: sim({
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'frames',
      prompt: '旧',
      klingOmniFramesPrompt: '旧frames',
      firstFrameImageUrl: ASSETS[0].url,
    }),
    tabField: 'klingOmniFramesPrompt',
  },
];

console.log('\n=== A. 各模型/tab：读取与写入 prompt 字段同步 ===\n');

for (const row of MATRIX) {
  const pasted = '镜头1 石头 与 卷卷 约束';
  const read = getNodeInspectorPromptText(row.data);
  ok(`${row.id}: 能读取当前 tab prompt`, typeof read === 'string');
  const patch = buildNodePromptUpdatePatch(row.data, pasted);
  const merged = { ...row.data, ...patch };
  ok(`${row.id}: patch 后 getNodeInspectorPromptText`, getNodeInspectorPromptText(merged) === pasted);
  ok(`${row.id}: 顶层 prompt 同步`, merged.prompt === pasted);
  if (row.tabField === 'klingOmniMultiPrompt') {
    ok(`${row.id}: multi tab 字段`, merged.klingOmniMultiPrompt === pasted);
  }
  if (row.tabField === 'klingOmniInstructionPrompt') {
    ok(`${row.id}: instruction tab 字段`, merged.klingOmniInstructionPrompt === pasted);
  }
  if (row.tabField === 'klingOmniVideoPrompt') {
    ok(`${row.id}: video tab 字段`, merged.klingOmniVideoPrompt === pasted);
  }
  if (row.tabField === 'klingOmniFramesPrompt') {
    ok(`${row.id}: frames tab 字段`, merged.klingOmniFramesPrompt === pasted);
  }
  if (row.tabField === 'seedanceTabConfigs') {
    const mode = row.data.seedanceGenerationMode || 'text';
    ok(
      `${row.id}: seedance tab 字段`,
      merged.seedanceTabConfigs?.[mode as 'text' | 'image' | 'reference']?.prompt === pasted
    );
  }
}

console.log('\n=== B. 粘贴纯文本：buildNodePromptUpdatePatch 不自动 scan ===\n');

for (const row of MATRIX) {
  const pasted = '镜头1 石头 与 卷卷';
  const patch = buildNodePromptUpdatePatch(row.data, pasted);
  const merged = { ...row.data, ...patch };
  const stored = getNodeInspectorPromptText(merged);
  ok(`${row.id}: 仅写入 patch 不追加 @资产`, stored === pasted && !stored.includes('@资产:'));
}

console.log('\n=== C. 点「扫描 @素材」：各 tab 可补全 ===\n');

for (const row of MATRIX) {
  const raw = '镜头1 石头 与 卷卷 约束';
  const patch = buildScanPromptAndPanelPatch(row.data, [], raw, ASSETS);
  if (!patch) {
    ok(`${row.id}: 扫描产生 patch`, false, 'undefined');
    continue;
  }
  const merged = { ...row.data, ...patch };
  const next = getNodeInspectorPromptText(merged);
  ok(`${row.id}: 扫描后含 @资产:石头`, next.includes('@资产:石头'));
  ok(`${row.id}: 扫描后含 @资产:卷卷`, next.includes('@资产:卷卷'));
}

console.log('\n=== D. @ 下拉：仅面板槽，不含资产库全量 ===\n');

for (const row of MATRIX) {
  const ctx = buildPromptMediaRefContextForRun(row.data, ASSETS);
  const panel = buildInspectorPromptMentionItems(row.data, ctx);
  const libOnlyWouldBe = ASSETS.length;
  ok(
    `${row.id}: 下拉条目 ≤ 面板槽数+主预览`,
    panel.length <= 8,
    String(panel.length)
  );
  ok(
    `${row.id}: 空面板时不等于全库 ${libOnlyWouldBe} 项`,
    panel.length === 0 || panel.length < libOnlyWouldBe,
    String(panel.length)
  );
}

{
  const withPanel = sim({
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    referenceImages: [ASSETS[0].url!],
    referenceImageLabels: ['石头'],
    seedanceTabConfigs: { reference: { referenceImages: [ASSETS[0].url!] } },
  });
  const ctx = buildPromptMediaRefContextForRun(withPanel, ASSETS);
  const panel = buildInspectorPromptMentionItems(withPanel, ctx);
  ok('有面板槽时含石头', panel.some((m) => m.insertText === '@资产:石头'));
  ok('有面板槽仍不含未拖入的熊大', !panel.some((m) => m.insertText === '@资产:熊大'));
}

console.log('\n=== E. 粘贴守卫：扫描/删除后须可继续编辑 ===\n');

{
  const pasted = '镜头1 石头 与 卷卷';
  ok('粘贴后同步 onChange 忽略一次', !resolveInspectorPromptChangeAccept(pasted, pasted, false));
  ok('扫描改写后接受编辑', resolveInspectorPromptChangeAccept(pasted, `${pasted}@资产:石头`, false));
  ok('删除字符后接受编辑', resolveInspectorPromptChangeAccept(pasted, '镜头1 石头', false));
  ok('粘贴后 skipNext 忽略一次', !resolveInspectorPromptChangeAccept(null, 'x', true));
  ok('守卫解除后可编辑', resolveInspectorPromptChangeAccept(pasted, 'ab', false));
}

console.log('\n=== 汇总 ===\n');
console.log(`通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);

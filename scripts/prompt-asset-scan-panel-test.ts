/**
 * 扫描 @素材 / @资产 高亮 / @ 下拉与面板一致
 * npx tsx scripts/prompt-asset-scan-panel-test.ts
 */
import type { NodeData } from '../types.ts';
import {
  buildInspectorPromptMentionItems,
  buildPromptMediaRefContextForRun,
  buildPromptReferencedAssetsPanelPatch,
  buildScanPromptAndPanelPatch,
  buildNodePromptUpdatePatch,
  filterMediaRefs,
  getActiveAtMention,
  matchAllPromptMediaTokens,
  repairPromptInvalidAssetTokens,
  stripPromptMediaTokensForPlainCopy,
} from '../utils/promptMediaRefs.ts';

const ASSETS = [
  { name: '美女', slug: 'mei-nv', url: 'https://ex/m1' },
  { name: '石头', slug: 'shi-tou', url: 'https://ex/m2' },
  { name: '卷卷', slug: 'juan-juan', url: 'https://ex/m3' },
  { name: '熊大', slug: 'xiong-da', url: 'https://ex/m4' },
  { name: '熊二', slug: 'xiong-er', url: 'https://ex/m5' },
  { name: '大牙', slug: 'da-ya', url: 'https://ex/m6' },
  { name: '光头强', slug: 'guang-tou-qiang', url: 'https://ex/m7' },
];

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

console.log('\n=== A. 无效 @资产 不高亮整句 ===\n');
{
  const bad = '@资产:野人围绕着广场中心石碑三三两两聚集成小群';
  ok('无库时不识别 token', matchAllPromptMediaTokens(bad, ASSETS).length === 0);
  ok(
    '修复后去掉 @资产 前缀',
    repairPromptInvalidAssetTokens(bad, ASSETS) === '野人围绕着广场中心石碑三三两两聚集成小群'
  );
}

console.log('\n=== B. 粘贴/编辑：未点扫描时 @ 下拉仅含面板槽；扫描后补全 ===\n');
{
  const data = {
    label: 'test',
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    referenceImages: [ASSETS[0].url!],
    referenceImageLabels: ['美女'],
    prompt: '镜头1 @资产:石头 与 @资产:卷卷 和 @资产:大牙',
  };
  const ctx = buildPromptMediaRefContextForRun(data as NodeData, ASSETS);
  const mentionsBefore = buildInspectorPromptMentionItems(data as NodeData, ctx);
  ok('未扫描时下拉仅面板项', mentionsBefore.length === 1, String(mentionsBefore.length));
  ok('未扫描时不含石头', !mentionsBefore.some((m) => m.insertText === '@资产:石头'));

  const patch = buildScanPromptAndPanelPatch(data as NodeData, [], data.prompt!, ASSETS);
  const merged = { ...data, ...patch } as NodeData;
  const ctxAfter = buildPromptMediaRefContextForRun(merged, ASSETS);
  const mentionsAfter = buildInspectorPromptMentionItems(merged, ctxAfter);
  ok('扫描后下拉含石头', mentionsAfter.some((m) => m.insertText === '@资产:石头'));
  ok('扫描后下拉含卷卷', mentionsAfter.some((m) => m.insertText === '@资产:卷卷'));
  ok('扫描后面板补入大牙', (merged.referenceImages || []).includes(ASSETS[5].url!));
}

console.log('\n=== C. 扫描同步面板参考数组 ===\n');
{
  const data = {
    label: 'test',
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'instruction',
    klingOmniInstructionReferenceImages: [ASSETS[0].url!],
    referenceImageLabels: ['美女'],
    klingOmniInstructionPrompt: '@资产:石头 与 @资产:卷卷',
  };
  const patch = buildScanPromptAndPanelPatch(data as NodeData, [], data.klingOmniInstructionPrompt!, ASSETS);
  ok('扫描产生 patch', Boolean(patch));
  const merged = { ...data, ...patch } as NodeData;
  const imgs = merged.klingOmniInstructionReferenceImages || [];
  ok('面板补入石头', imgs.includes(ASSETS[1].url!));
  ok('面板补入卷卷', imgs.includes(ASSETS[2].url!));

  const panelOnly = buildPromptReferencedAssetsPanelPatch(
    { ...(data as NodeData), klingOmniInstructionPrompt: '@资产:光头强' },
    ASSETS
  );
  ok('单独 panel patch 含光头强', (panelOnly?.klingOmniInstructionReferenceImages || []).includes(ASSETS[6].url!));
}

console.log('\n=== D. @ 下拉：长文案末尾 / 已完成 token 不误匹配 ===\n');
{
  const long =
    '镜头1 @资产:石头 约束\n镜头2 @资产:卷卷 约束\n镜头3 @资产:熊大 约束：';
  ok('文末输入 @ 可识别', getActiveAtMention(`${long}@`, long.length + 1, ASSETS)?.query === '');
  ok(
    '已完成 @资产:石头 不误匹配',
    getActiveAtMention('@资产:石头', '@资产:石头'.length, ASSETS) === null
  );
  ok(
    '长串误粘贴过滤为空',
    filterMediaRefs(
      [{ label: '石头', kind: 'projectAsset', insertText: '@资产:石头' }],
      '野人围绕着广场中心石碑三三两两聚集成小群'
    ).length === 0
  );
  ok(
    '粘连误 token 内光标不视为 @ 输入',
    getActiveAtMention('@资产:石头站于广场', '@资产:石头站于广场'.length, ASSETS) === null
  );
}

console.log('\n=== E. 粘贴纯文本：不自动扫描/规范改写 ===\n');
{
  const pasted = '镜头1 石头 与 卷卷 和 熊大 约束';
  const data = {
    label: 'test',
    selectedModel: '可灵3.0 Omni',
    klingOmniTab: 'instruction',
    klingOmniInstructionReferenceImages: [ASSETS[0].url!],
    referenceImageLabels: ['美女'],
    klingOmniInstructionPrompt: pasted,
    prompt: pasted,
  };
  ok('粘贴后文案保持原样', data.klingOmniInstructionPrompt === pasted);
  ok('粘贴后不自动追加 @资产', !pasted.includes('@资产:'));
  const scanPatch = buildScanPromptAndPanelPatch(data as NodeData, [], pasted, ASSETS);
  ok('点扫描才改写文案', scanPatch?.klingOmniInstructionPrompt !== pasted);
  ok(
    '点扫描才同步面板',
    (scanPatch?.klingOmniInstructionReferenceImages || []).length >= 2
  );
}

console.log('\n=== F. Seedance 参考生：写入 prompt 须同步 tab 快照（Chat/粘贴） ===\n');
{
  const plain = '镜头1 石头 与 卷卷 站在广场';
  const data = {
    label: 'test',
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    prompt: '旧顶层',
    seedanceTabConfigs: {
      reference: {
        prompt: '旧tab @资产:石头@资产:石头',
        referenceImages: [ASSETS[0].url!],
      },
    },
  };
  const patch = buildNodePromptUpdatePatch(data as NodeData, plain);
  ok('patch 含 seedanceTabConfigs', Boolean(patch.seedanceTabConfigs?.reference?.prompt));
  ok(
    'reference tab prompt 已同步纯文本',
    patch.seedanceTabConfigs?.reference?.prompt === plain
  );
  ok('顶层 prompt 同步', patch.prompt === plain);
  ok('未扫描时不含 @资产', !plain.includes('@资产:'));
}

console.log('\n=== G. @ 下拉：无面板槽时不含资产库 ===\n');
{
  const data = {
    label: 'test',
    selectedModel: 'seedance2.0 (急速版)',
    seedanceGenerationMode: 'reference',
    referenceImages: [],
    prompt: '镜头1 石头',
  };
  const ctx = buildPromptMediaRefContextForRun(data as NodeData, ASSETS);
  const panel = buildInspectorPromptMentionItems(data as NodeData, ctx);
  ok('无面板槽时下拉为空', panel.length === 0, String(panel.length));
}

console.log('\n=== H. 复制纯文本：去掉 @ 引用 ===\n');
{
  const raw =
    '画面描述：熊大@资产:熊大（棕色毛发、穿红色兽皮背心）在最前，熊二@资产:熊二（浅棕色毛发）跟在中间，光头强@资产:光头强（光头）在最后；@主图 与 @图片1';
  const plain = stripPromptMediaTokensForPlainCopy(raw, ASSETS);
  ok('不含 @资产', !plain.includes('@资产:'));
  ok('不含 @主图', !plain.includes('@主图'));
  ok('不含 @图片', !plain.includes('@图片'));
  ok('保留熊大正文', plain.includes('熊大（棕色毛发、穿红色兽皮背心）'));
  ok('保留熊二正文', plain.includes('熊二（浅棕色毛发）'));
  ok('保留光头强正文', plain.includes('光头强（光头）'));
}

console.log('\n=== 汇总 ===\n');
console.log(`通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);

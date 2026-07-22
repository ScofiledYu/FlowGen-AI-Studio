/**
 * Chat 展示/过程区/模式开关契约（纯离线，防回归 §5.10.4）
 * 覆盖 2026-07-13 已验收：
 * - 未开联网/思考：不误显过程区、合并过程区进正文、嵌套标记不丢文、raw 恢复
 * - 思考关闭：剥离正文英文 CoT，保留 Hello+中文双语自我介绍
 * - 开思考/开联网：总结 pass 仍写入思考区、过程区与正文分离（由 layout/pipeline 覆盖）
 *
 * npm run test:llm-chat-display-contract
 * 已并入 npm run test:chat-gate
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assistantReplyHasVisibleMain,
  composeAssistantMessage,
  extractThinkingBlockFromMain,
  flattenAssistantSectionsWhenProcessDisabled,
  parseAssistantMessage,
  recoverAssistantReplyFromRaw,
  stripLeakedThinkingFromMainWhenDisabled,
} from '../utils/assistantMessageLayout.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;

function ok(name, cond, detail = '') {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${String(detail).slice(0, 100)}` : ''}`);
  if (cond) pass++;
  else fail++;
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const modesOff = { webSearchEnabled: false, thinkingEnabled: false };

console.log('=== Chat 展示/模式开关契约（§5.10.4）===\n');

console.log('[1] 未开联网/思考：过程区合并 + 可见正文');
{
  const raw =
    '[联网检索]\n我是「Gemini 3.1 Pro」，擅长代码协作与复杂推理。\n\n' +
    '[思考过程]\n分析身份问题。';
  const recovered = recoverAssistantReplyFromRaw(raw, {
    userQuestion: '你是哪个模型？',
    ...modesOff,
  });
  const parsed = parseAssistantMessage(recovered);
  ok('Gemini 身份 raw 恢复可见正文', assistantReplyHasVisibleMain(recovered, modesOff));
  ok('合并不留 webSearch 标记', !parsed.webSearch.trim() && !parsed.thinking.trim());
  ok('正文含 Gemini', recovered.includes('Gemini 3.1 Pro'));
}

console.log('\n[2] 嵌套过程标记不丢正文');
{
  const nested =
    '[思考过程]\n分析用户身份问题\n\n[联网检索]\n我是「Gemini 3.1 Pro」，擅长推理。';
  const parsed = parseAssistantMessage(nested);
  ok('parse 保留联网段正文', parsed.webSearch.includes('Gemini 3.1 Pro'));
  const flat = flattenAssistantSectionsWhenProcessDisabled(parsed, modesOff);
  ok('flatten 合并进 main', flat.main.includes('Gemini') && !flat.webSearch.trim());
}

console.log('\n[3] 思考关闭：剥离英文 CoT');
{
  const cot =
    '**Assessing the Prompt**\nThe user wants the numeric result.\n\n' +
    '**Calculating the Solution**\n4 - 1 + 5 = 8.\n\n' +
    '根据计算，三人平分，每人最多能吃 2 个。';
  const stripped = stripLeakedThinkingFromMainWhenDisabled(cot);
  ok('去掉 Assessing 前缀', !stripped.includes('Assessing') && stripped.includes('每人最多'));
  const hello =
    'Hello! My areas of expertise are very broad.\n\n我擅长内容创作与剧本策划。';
  ok('保留 Hello+中文自我介绍', stripLeakedThinkingFromMainWhenDisabled(hello) === hello);
}

console.log('\n[4] 开思考：英文前言仍进思考区（modes on 不回退）');
{
  const summarizeRaw = `**Analyzing the request**\n\n**Planning**\n\n### 一、概况\n中海锦城位于龙华。\n\n### 二、价格走势\n近期挂牌价稳中有降。`;
  const split = extractThinkingBlockFromMain(summarizeRaw);
  ok('开思考时拆出 thinking（extractThinkingBlockFromMain）', split.thinking.includes('Analyzing'));
  ok(
    '开思考时正文保留章节',
    (split.main + split.thinking).includes('一、概况') && split.main.trim().length > 0
  );
}

console.log('\n[5] 源码契约（防回退）');
const layout = read('utils/assistantMessageLayout.ts');
const chatPanel = read('components/ChatPanel.tsx');
const chatGate = read('scripts/test-chat-gate.mjs');
const pkg = JSON.parse(read('package.json'));

ok('导出 flattenAssistantSectionsWhenProcessDisabled', /export function flattenAssistantSectionsWhenProcessDisabled/.test(layout));
ok('导出 stripLeakedThinkingFromMainWhenDisabled', /export function stripLeakedThinkingFromMainWhenDisabled/.test(layout));
ok('导出 recoverAssistantReplyFromRaw', /export function recoverAssistantReplyFromRaw/.test(layout));
ok('flatten 内调用 stripLeakedThinking', /stripLeakedThinkingFromMainWhenDisabled/.test(layout));
ok('parse 嵌套标记 tail 解析', /tailMatch\[1\] === '联网检索'/.test(layout));
ok('consolidate 尊重 webSearchEnabled', /consolidateWebSearchSections[\s\S]{0,200}webSearchEnabled/.test(layout));
ok(
  'resolveAssistantDisplay 默认不 legacy 拆思考',
  /allowLegacyThinkingExtract/.test(layout) &&
    /if \(!opts\?\.allowLegacyThinkingExtract\) return first/.test(layout)
);
ok(
  'compose 默认 allowWebSearchExtractFromMain=false',
  /allowWebSearchExtractFromMain = false/.test(chatPanel)
);
ok(
  'compose 传入 processModeOpts / flatten',
  /flattenAssistantSectionsWhenProcessDisabled\(sections, processModeOpts\)/.test(chatPanel)
);
ok(
  'Gemini 校验 rawFallback',
  /assistantReplyHasVisibleMain\(finalized\.content, visibilityOpts\)/.test(chatPanel) &&
    /rawFallback:/.test(chatPanel)
);
ok(
  'Gemini recoverAssistantReplyFromRaw',
  /recoverAssistantReplyFromRaw\(geminiStreamContent/.test(chatPanel)
);
ok(
  '总结 pass 尊重思考开关',
  /联网总结二次 pass：仍尊重用户思考开关/.test(chatPanel) &&
    /payload\.thinking = thinkingEnabledForTurn/.test(chatPanel)
);
ok('禁止 summarize 硬编码 thinking:true', !/summarizeRetry[\s\S]{0,400}thinking:\s*true/.test(chatPanel));
ok('package 含 test:llm-chat-display-contract', !!pkg.scripts?.['test:llm-chat-display-contract']);
ok(
  'chat-gate 含 display-contract 步',
  /test:llm-chat-display-contract|llm-chat-display-contract/.test(chatGate)
);

console.log(`\n=== 契约汇总: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);

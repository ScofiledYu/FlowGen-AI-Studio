/**
 * 端到端展示管线回归（无需联网 API）
 * npx tsx scripts/chat-pipeline-regression-test.ts
 */
import {
  ASSISTANT_MARKER_THINKING,
  ASSISTANT_MARKER_WEB_SEARCH,
  composeAssistantMessage,
  consolidateWebSearchDumpContent,
  extractThinkingBlockFromMain,
  localizeThinkingProcessForDisplay,
  localizeWebSearchProcessForDisplay,
  mergeWithWebSearchProcess,
  augmentWebSearchWithProbeQuery,
  normalizeAssistantStream,
  parseAssistantMessage,
  prepareWebSearchFirstPassContent,
  sanitizeWebSearchProcessText,
  splitWebSearchForDisplay,
} from '../utils/assistantMessageLayout.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail.slice(0, 100)}` : ''}`);
  if (cond) pass++;
  else fail++;
}

/** 与 ChatPanel.composeStreamedAssistantMessage 一致 */
function composeStreamedAssistantMessage(
  rawContent: string,
  apiReasoning: string,
  collectApiReasoning: boolean,
  probeQuery?: string
): string {
  let composed = composeAssistantMessage(
    normalizeAssistantStream({
      content: rawContent,
      apiReasoning,
      collectApiReasoning,
      skipExtractThinkingFromMain: collectApiReasoning,
    })
  );
  if ((probeQuery || '').trim()) {
    composed = augmentWebSearchWithProbeQuery(composed, probeQuery!);
  }
  return composed;
}

/** 简化版 finalize：仅测表格抽离后正文是否保留一二三四 */
function simulateTableFinalize(mainPart: string): string {
  const lines = mainPart.replace(/\r\n/g, '\n').split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith('```')) continue;
    if (t.includes('|') && t.split('|').filter((x) => x.trim().length > 0).length >= 2) {
      start = i;
      break;
    }
  }
  if (start < 0) return mainPart;
  let end = start;
  while (end < lines.length) {
    const t = lines[end].trim();
    if (!t) break;
    if (t.startsWith('```')) break;
    if (t.includes('|')) {
      end++;
      continue;
    }
    break;
  }
  const before = lines.slice(0, start).join('\n').trimEnd();
  const after = lines.slice(end).join('\n').trimStart();
  return (
    (before.trim() ? `${before.trim()}\n\n` : '') +
    '（表格见下方）\n\n' +
    (after.trim() || '')
  ).trim();
}

function assertNoTipLeakInProcess(webSearch: string) {
  const cleaned = sanitizeWebSearchProcessText(webSearch);
  const { process } = splitWebSearchForDisplay(cleaned);
  const display = localizeWebSearchProcessForDisplay(process, { completed: true });
  ok('过程区无简体 tip', !/请使用简体中文/.test(display));
  ok('过程区无 Please note', !/please note that these are web search/i.test(display));
}

function assertSectionsInMain(main: string, labels: string[]) {
  for (const lb of labels) {
    ok(`正文含「${lb}」`, main.includes(lb));
  }
}

console.log('=== 管线回归 ===\n[1] 联网首轮 → 总结合并（楼盘一二三四 + 表格）');

const probeQuery = '深圳中海锦城楼盘入手时机分析 当前房价走势及未来下跌风险';
const firstPassRaw = `I'll search for "${probeQuery}".

Search results for "${probeQuery}":
1. **中海锦城二手房**
   https://example.com/zhonghai
   龙华核心区`;

const firstComposed = composeStreamedAssistantMessage(firstPassRaw, '', false, probeQuery);
const prep = prepareWebSearchFirstPassContent(firstComposed, '中海锦城什么时候入手合适');
ok('首轮需总结', prep.needsSummarize);

const summarizeRaw = `**Analyzing the request**

**Planning**

### 一、楼盘概况
中海锦城位于龙华。

### 二、价格走势
近期挂牌价稳中有降。

### 三、入手建议
刚需可谈价。

| 你的情况 | 建议 |
| --- | --- |
| 刚需自住 | 可认真谈价 |

### 四、核查清单
1. 查近3个月成交价`;

const summarizedComposed = composeStreamedAssistantMessage(summarizeRaw, '正在分析用户购房问题。', true);
const merged = mergeWithWebSearchProcess(summarizedComposed, prep.content, '正在分析用户购房问题。', true);
const parsed = parseAssistantMessage(merged);
const displayMain = simulateTableFinalize(parsed.main);

assertSectionsInMain(displayMain, ['一、楼盘概况', '二、价格走势', '三、入手建议', '四、核查清单']);
assertNoTipLeakInProcess(parsed.webSearch);
ok('思考区与正文分离', parsed.thinking.length > 0 && parsed.main.includes('四、核查'));

console.log('\n[2] tip 误检索污染（用户曾反馈的长 blob）');
const tipBlob =
  '请使用简体中文（中国大陆）回复。\nPlease note that these are web search results.\nHere are the search results for "请使用简体中文":\n1. **简体中文**\n   https://dify.ai';
const tipComposed = composeStreamedAssistantMessage(
  `I'll search for "深圳天气".\n\n${tipBlob}`,
  '',
  false,
  '深圳天气'
);
assertNoTipLeakInProcess(parseAssistantMessage(tipComposed).webSearch);

console.log('\n[3] 思考关闭 + 英文前言（仅英文规划才拆入思考）');
const englishOnlySplit = extractThinkingBlockFromMain(summarizeRaw);
ok('英文前言可拆出思考', englishOnlySplit.thinking.includes('Analyzing'));
ok('拆后正文仍含一节', englishOnlySplit.main.includes('一、楼盘概况'));

const offThinkingNorm = normalizeAssistantStream({
  content: summarizeRaw,
  collectApiReasoning: false,
  skipExtractThinkingFromMain: false,
});
ok('无 reasoning 时仍保留完整主文或合理拆分', (offThinkingNorm.main + offThinkingNorm.thinking).includes('二、价格'));

console.log('\n[4] 展示层中文化');
ok(
  '思考展示中文化',
  localizeThinkingProcessForDisplay('**Planning the response**\nI need to compare.').includes('规划')
);

console.log('\n[5] 联网总结合并：思考关闭时不展示推理区');
const mergedNoThink = mergeWithWebSearchProcess(
  composeAssistantMessage({ main: '### 对比结论\n豆包多模态强，DeepSeek 代码强。', webSearch: '', thinking: '' }),
  composeAssistantMessage({ main: '', webSearch: '检索完成：「豆包 DeepSeek 对比」', thinking: '' }),
  '正在对比两款模型的优劣。',
  false,
  { userQuestion: '对比 deepseek v4 优缺点' }
);
const mergedNoThinkSections = parseAssistantMessage(mergedNoThink);
ok(
  '思考关闭时总结 pass 不写入思考区',
  !mergedNoThinkSections.thinking.includes('正在对比') &&
    mergedNoThinkSections.main.includes('对比结论')
);

console.log('\n[6] 联网检索过程仅保留有效检索行');
const { process: searchProcess } = splitWebSearchForDisplay(
  sanitizeWebSearchProcessText(parseAssistantMessage(firstComposed).webSearch, probeQuery)
);
ok(
  '过程含探测词',
  searchProcess.includes('中海锦城') || searchProcess.includes('正在检索') || searchProcess.includes('search for')
);

console.log(`\n=== SUMMARY PASS ${pass} FAIL ${fail} ===`);
if (fail > 0) process.exitCode = 1;

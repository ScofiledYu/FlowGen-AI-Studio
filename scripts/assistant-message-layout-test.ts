/**
 * npx tsx scripts/assistant-message-layout-test.ts
 */
import {
  augmentWebSearchWithProbeQuery,
  composeAssistantMessage,
  consolidateWebSearchSections,
  ensureWebSearchProcessLines,
  localizeWebSearchProcessForDisplay,
  needsWebSearchSynthesisPass,
  normalizeAssistantStream,
  parseAssistantMessage,
  splitWebSearchForDisplay,
  mergeWithWebSearchProcess,
  ensureAssistantSectionsHaveMain,
  guardAssistantReplyContent,
  assistantReplyHasVisibleMain,
  consolidateWebSearchDumpContent,
  isLikelyMainOnlySearchDump,
  isLikelyTraditionalChineseHeavy,
  mainHasRawSearchCitation,
  prepareWebSearchFirstPassContent,
  isInternalPromptLeakQuery,
  sanitizeWebSearchProcessText,
  stripLeakedSearchBlocks,
  stripInternalPromptBoilerplate,
  isInternalPromptBoilerplateLine,
  extractThinkingBlockFromMain,
  resolveAssistantDisplaySections,
  localizeThinkingProcessForDisplay,
  hasQuestionMarkPlaceholder,
  sanitizeAssistantDisplayText,
} from '../utils/assistantMessageLayout.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}`);
  if (cond) pass++;
  else fail++;
}

const dump = `Search results for "北京时间":\n\n1. **中国北京时间**\n   https://example.com\n\n现在是下午3点。`;

const norm = normalizeAssistantStream({ content: dump });
ok('检索进过程区', norm.webSearch.includes('Search results for'));
ok('正文为中文答', /下午|北京时间/.test(norm.main));
const dumpOnly = normalizeAssistantStream({ content: 'Search results for "test":\n\n1. **A**\n https://x.com' });
ok('纯检索快照需总结', needsWebSearchSynthesisPass(dumpOnly, 'test'));

const composed = composeAssistantMessage({
  main: '现在是北京时间下午3点。',
  webSearch: dump,
  thinking: "**Analyzing**\nI'm thinking",
});
const parsed = parseAssistantMessage(composed);
ok('往返解析', parsed.main.includes('下午3点') && parsed.webSearch.includes('Search results'));
const markerOnly = composeAssistantMessage({
  main: '',
  webSearch: `I'll search for "x".`,
  thinking: '',
});
ok(
  '仅过程区标记可解析',
  parseAssistantMessage(markerOnly).webSearch.includes('search for') &&
    !parseAssistantMessage(markerOnly).main.includes('[联网检索]')
);

const zh = localizeWebSearchProcessForDisplay('Search results for "深圳天气"');
ok('展示层中文标签', zh.startsWith('检索结果'));

const ensured = ensureWebSearchProcessLines('Search results for "上海行程":');
ok('补全正在检索', /i'?ll search for/i.test(ensured));
const split = splitWebSearchForDisplay(ensured + '\n\n1. **攻略**\n   https://x.com');
ok('过程与来源拆分', split.process.includes('search for') && split.sources.includes('https://'));
const augmented = augmentWebSearchWithProbeQuery(
  composeAssistantMessage({ main: '答', webSearch: 'Search results for "x":', thinking: '' }),
  '上海3天2晚第二天'
);
ok('注入探测检索词', parseAssistantMessage(augmented).webSearch.includes('上海3天2晚第二天'));

const merged = consolidateWebSearchSections({
  main: '1. **深圳美食**\n   https://example.com',
  webSearch: `I'll search for "深圳美食".`,
  thinking: '',
});
ok('正文检索列表并入过程区', merged.webSearch.includes('深圳美食') && !merged.main);

const firstPassDump = consolidateWebSearchDumpContent(
  composeAssistantMessage({
    main: '1. **深圳美食**\n   https://example.com\n   snippet',
    webSearch: `I'll search for "深圳近两天美食攻略推荐".`,
    thinking: '',
  })
);
const afterSummarize = mergeWithWebSearchProcess(
  composeAssistantMessage({ main: '## 美食\n推荐A', webSearch: '', thinking: '' }),
  firstPassDump
);
const mergedSplit = splitWebSearchForDisplay(parseAssistantMessage(afterSummarize).webSearch);
ok('总结后仍有检索来源', mergedSplit.sources.includes('https://'));
ok('总结后保留正文', parseAssistantMessage(afterSummarize).main.includes('美食'));

const emptySummarize = mergeWithWebSearchProcess(
  '',
  composeAssistantMessage({
    main: '',
    webSearch: `I'll search for "Anthropic投资".\n\n1. **标题**\n   https://example.com\n   科技巨头纷纷投资 Anthropic 以获取算力与合作。`,
    thinking: '',
  }),
  '',
  false,
  { userQuestion: '为何大厂愿意提供算力' }
);
ok(
  '总结正文为空时从检索区兜底',
  parseAssistantMessage(emptySummarize).main.includes('科技巨头') &&
    parseAssistantMessage(emptySummarize).webSearch.includes('Anthropic')
);

const weatherDump = `1. **深圳天气预报,深圳7天天气预报**
   https://www.weather.com.cn/weather/101280601.shtml
   分时段预报 生活指数

2. **【深圳天气】深圳40天天气预报**
   https://www.weather.com.cn/weather40d/weather40d/101280601.shtml
   未来三天江南维持多雨模式`;
ok('长检索列表判定为仅快照', isLikelyMainOnlySearchDump(weatherDump));
const prep = prepareWebSearchFirstPassContent(
  composeAssistantMessage({
    main: weatherDump,
    webSearch: `I'll search for "深圳未来一周天气预报".`,
    thinking: '',
  }),
  '深圳未来一周天气'
);
ok('长检索列表触发总结', prep.needsSummarize && !prep.sections.main);

const introThenDump =
  '根据检索为您整理如下参考信息，更多细节见链接。\n\n' +
  '1. **深圳好去处60+免费景點打卡**\n   https://www.hk01.com/%E6%97%85%E9%81%8A/article/1\n   清水河舊火車站';
ok('套话+编号链接仍判为检索快照', isLikelyMainOnlySearchDump(introThenDump));
const introPrep = prepareWebSearchFirstPassContent(
  composeAssistantMessage({
    main: introThenDump,
    webSearch: '检索完成：「深圳旅游景点推荐」',
    thinking: '',
  }),
  '你建议深圳旅游去哪里'
);
ok('套话+列表触发二次总结', introPrep.needsSummarize);
ok('长百分号 URL 识别', mainHasRawSearchCitation(introThenDump));
ok('繁体堆砌需总结', isLikelyTraditionalChineseHeavy(introThenDump));
ok('问号占位需总结', needsWebSearchSynthesisPass({ main: '实况如下：\n???????\n', webSearch: '', thinking: '' }));
const sanitized = sanitizeAssistantDisplayText('气温：\n???????\n');
ok('展示层替换问号行', !/\?{4,}/.test(sanitized) && sanitized.includes('检索来源'));

const tipLeakQuery =
  '请使用简体中文（中国大陆）回复，不要使用繁体中文。过程说明请用中文；可保留 Search results for / I\'ll search for 等检索原文于过程区。';
ok('识别 tip 误检索', isInternalPromptLeakQuery(tipLeakQuery));
const polluted = `I'll search for "深圳今日天气及未来几天天气预报".

Search results for "${tipLeakQuery}":
1. **简体中文**
   https://legacy-docs.dify.ai/zh-hans/guides/workflow/node
2. **关于在中国地区使用的问题汇总**
   https://github.com/lencx/ChatGPT/discussions/133`;
const cleaned = sanitizeWebSearchProcessText(polluted, '深圳今日天气及未来几天天气预报');
ok('剔除 tip 误检索块', cleaned.includes('深圳今日天气') && !cleaned.includes('legacy-docs.dify.ai'));
ok('误检索块 strip', !stripLeakedSearchBlocks(polluted).includes('legacy-docs.dify.ai'));

const userBlob =
  '请使用简体中文（中国大陆）回复，不要使用繁体中文。涉及行程、日程、列表、步骤时须写完整条目，勿用「…」或「...」省略未展开的内容。\n' +
  'Please note that these are web search results and may not be fully accurate or up-to-date.\n' +
  '过程说明请用中文；可保留 Search results for / I\'ll search for 等检索原文于过程区，正文写面向用户的完整回答。\n' +
  'Here are the search results for "请使用简体中文（中国大陆）回复":';
ok('识别 Please note 模板行', isInternalPromptBoilerplateLine('Please note that these are web search results'));
const stripped = stripInternalPromptBoilerplate(userBlob);
ok('页面不展示 tip 模板', !stripped.includes('请使用简体中文') && !stripped.includes('Please note'));

const mixedAnswer = `**Analyzing the request**

**Planning the response**

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
1. 查成交价`;
const splitWrong = extractThinkingBlockFromMain(mixedAnswer);
ok('中文章节不应被归入思考', splitWrong.main.includes('一、楼盘概况') && splitWrong.main.includes('二、价格走势'));
const withReasoning = normalizeAssistantStream({
  content: mixedAnswer,
  apiReasoning: 'Let me think in English.',
  collectApiReasoning: true,
  skipExtractThinkingFromMain: true,
});
ok('有 reasoning 流时不拆正文', withReasoning.main.includes('三、入手建议'));

const zhThink = localizeThinkingProcessForDisplay('**Analyzing the request**\nI need to search.');
ok('思考展示中文化', zhThink.includes('分析请求') && zhThink.includes('我需要'));

const zhThink2 = localizeThinkingProcessForDisplay('**Thinking**\n**Reasoning**\nThe user wants weather.');
ok(
  '思考英文标题中文化',
  zhThink2.includes('思考') && zhThink2.includes('推理') && zhThink2.includes('用户询问')
);

const geminiZhThinking =
  'RYa自然语言思考过程:\n1. **分析搜索结果:**\n整理师资与招聘要求。\n2. **组织回答结构:**\n分教学质量与特色介绍。\n\n' +
  '根据搜索结果，深圳龙华区未来小学教学质量较好。\n\n' +
  '[联网检索]\n检索完成：「深圳龙华区未来小学教学质量师资水平教师学历情况」';
const geminiZhParsed = resolveAssistantDisplaySections(geminiZhThinking);
ok(
  'Gemini 中文思考进过程区',
  geminiZhParsed.thinking.includes('分析搜索结果') &&
    !geminiZhParsed.main.includes('自然语言思考过程') &&
    geminiZhParsed.webSearch.includes('检索完成')
);

const geminiThink = localizeThinkingProcessForDisplay(
  "**Considering Ambiguity's Parameters**\nI'm wrestling with how to define 'ambiguous'.\n\n**Refining Boundary Definition**\nI'm now zeroing in on the safety constraints."
);
ok(
  'Gemini 思考标题与句式中文化',
  geminiThink.includes('考量话题边界') &&
    geminiThink.includes('我在权衡') &&
    geminiThink.includes('细化边界') &&
    geminiThink.includes('我正在聚焦') &&
    !geminiThink.includes('Considering Ambiguity')
);

const structured = `### 一、概况\n说明\n\n### 四、清单\n1. 查成交价\n2. 看挂牌量`;
ok('分节回答不算纯检索快照', !isLikelyMainOnlySearchDump(structured));
const mergedStruct = mergeWithWebSearchProcess(
  composeAssistantMessage({ main: structured, webSearch: '', thinking: '' }),
  composeAssistantMessage({ main: '', webSearch: `I'll search for "x".`, thinking: '' }),
  '',
  true
);
ok('总结合并保留分节正文', parseAssistantMessage(mergedStruct).main.includes('一、概况'));

const processOnly = composeAssistantMessage({
  main: '',
  webSearch: '检索完成：「中海锦城 抄底」\n1. **某论坛**\n   https://example.com\n   业主讨论抄底时机',
  thinking:
    '**分析抄底时机**\n中海锦城位于龙华，当前挂牌价约 5.2 万/平。\n**建议窗口**\n若政策宽松，2026 年下半年可关注笋盘，优先三房户型。',
});
const guardedProcessOnly = guardAssistantReplyContent(processOnly, {
  userQuestion: '这个盘抄底是什么时间比较好？',
});
const guardedSections = parseAssistantMessage(guardedProcessOnly);
ok(
  '仅过程区时补齐可见正文',
  assistantReplyHasVisibleMain(guardedProcessOnly) &&
    (guardedSections.main.includes('中海锦城') || guardedSections.main.includes('下半年')) &&
    guardedSections.webSearch.includes('检索完成')
);

console.log(`\nSUMMARY PASS ${pass} FAIL ${fail}`);
if (fail > 0) process.exitCode = 1;

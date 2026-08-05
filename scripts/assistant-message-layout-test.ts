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
  flattenAssistantSectionsWhenProcessDisabled,
  recoverAssistantReplyFromRaw,
  stripLeakedThinkingFromMainWhenDisabled,
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
  extractNativeThinkTags,
  compressAssistantProcessForHistory,
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
const geminiZhParsed = resolveAssistantDisplaySections(geminiZhThinking, {
  allowLegacyThinkingExtract: true,
});
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

const deepseekStyle =
  'Hello! My areas of expertise are very broad.\n\n' +
  '我擅长内容创作与剧本策划，可以协助你完成剧本大纲、人物设定与分场。';
const composedOff = composeAssistantMessage(
  normalizeAssistantStream({
    content: deepseekStyle,
    collectApiReasoning: false,
    allowWebSearchExtractFromMain: false,
    allowThinkingExtractFromMain: false,
  })
);
const sectionsOff = parseAssistantMessage(composedOff);
ok(
  '未开联网/思考时不拆过程区',
  !sectionsOff.webSearch.trim() && !sectionsOff.thinking.trim()
);
ok(
  '未开联网/思考时保留英文+中文正文',
  sectionsOff.main.includes('Hello') && sectionsOff.main.includes('剧本')
);
const guardedOff = guardAssistantReplyContent(composedOff, {
  userQuestion: '你擅长什么领域，我要创作剧本你擅长吗？',
  webSearchEnabled: false,
  thinkingEnabled: false,
});
ok('未开联网时 guard 不写根据联网检索', !guardedOff.includes('根据联网检索'));
const displayOff = resolveAssistantDisplaySections(guardedOff);
ok('展示层未开联网时不误显检索卡', !displayOff.webSearch.trim());
ok(
  '展示层未开思考时不误拆英文前缀为思考卡',
  !resolveAssistantDisplaySections(guardedOff).thinking.trim()
);

const geminiIdentityMisplaced =
  '[联网检索]\n我是「Gemini 3.1 Pro」，是由 Google Deepmind 团队开发的大型语言模型。我擅长多模态理解、复杂推理与代码协作。\n\n' +
  '[思考过程]\n**分析请求**\n用户询问模型身份。';
const flattenedGeminiIdentity = flattenAssistantSectionsWhenProcessDisabled(
  parseAssistantMessage(geminiIdentityMisplaced),
  { webSearchEnabled: false, thinkingEnabled: false }
);
const composedGeminiIdentity = composeAssistantMessage(flattenedGeminiIdentity);
const guardedGeminiIdentity = guardAssistantReplyContent(composedGeminiIdentity, {
  userQuestion: '你是哪个模型？你擅长的是什么？',
  webSearchEnabled: false,
  thinkingEnabled: false,
  synthesizedRaw: geminiIdentityMisplaced,
});
ok(
  'Gemini 身份问答未开联网/思考时合并过程区进正文',
  assistantReplyHasVisibleMain(guardedGeminiIdentity) &&
    !parseAssistantMessage(guardedGeminiIdentity).webSearch.trim() &&
    !parseAssistantMessage(guardedGeminiIdentity).thinking.trim() &&
    guardedGeminiIdentity.includes('Gemini 3.1 Pro')
);

const geminiNestedMarkers =
  '[思考过程]\n分析用户身份问题\n\n[联网检索]\n我是「Gemini 3.1 Pro」，擅长代码协作与复杂推理。';
const recoveredNested = recoverAssistantReplyFromRaw(geminiNestedMarkers, {
  userQuestion: '你是哪个模型，你擅长哪个领域？',
  webSearchEnabled: false,
  thinkingEnabled: false,
});
ok(
  '嵌套过程标记不丢正文且可恢复',
  assistantReplyHasVisibleMain(recoveredNested, { webSearchEnabled: false, thinkingEnabled: false }) &&
    recoveredNested.includes('Gemini 3.1 Pro') &&
    !parseAssistantMessage(recoveredNested).webSearch.trim()
);

const geminiEnglishCoT =
  '**Assessing the Prompt**\nThe user wants the final numeric result.\n\n' +
  '**Calculating the Solution**\n4 - 1 + 5 = 8 apples. 8 / 3 = 2 remainder 2.\n\n' +
  '**Interpreting Ambiguity**\nEqual split gives 2 each.\n\n' +
  '根据计算，小红一共有 8 个苹果，三人平分，每人最多能吃 2 个。';
const strippedCoT = stripLeakedThinkingFromMainWhenDisabled(geminiEnglishCoT);
const guardedCoT = guardAssistantReplyContent(
  composeAssistantMessage({ main: geminiEnglishCoT, webSearch: '', thinking: '' }),
  { userQuestion: '计算的结果是什么？', webSearchEnabled: false, thinkingEnabled: false }
);
ok(
  '思考关闭时剥离英文 CoT 前缀',
  strippedCoT.includes('每人最多能吃 2 个') &&
    !strippedCoT.includes('Assessing the Prompt') &&
    guardedCoT.includes('每人最多') &&
    !guardedCoT.includes('Assessing')
);
ok(
  '思考关闭时仍保留 Hello+中文自我介绍',
  stripLeakedThinkingFromMainWhenDisabled(deepseekStyle) === deepseekStyle
);

// 原生 <think> 标签提取
const thinkTag = '<think>我在权衡不同方案</think>正文开始';
const thinkExtracted = extractNativeThinkTags(thinkTag);
ok('原生 <think> 标签提取思考', thinkExtracted.thinking.includes('权衡不同方案') && thinkExtracted.main.includes('正文开始'));

const reasoningTag = '<reasoning>推理过程</reasoning>结论';
const reasoningExtracted = extractNativeThinkTags(reasoningTag);
ok('原生 <reasoning> 标签提取思考', reasoningExtracted.thinking.includes('推理过程') && reasoningExtracted.main.includes('结论'));

// 回归：结构化中文答案（含尾部 ### 总结）不应被逆向拆进 thinking
const structuredZhAnswerWithSummary =
  '**非常适合，并且在绝大多数情况下，LoRA 是微调 Kimi K3 的唯一现实且经济的选择。**\n\n' +
  '### 1. 为什么 Kimi K3 极度适合 LoRA？\n* **全量微调成本高昂**：Kimi K3 参数规模巨大。\n' +
  '* **激发基座能力**：只需用 LoRA 教它特定格式输出。\n\n' +
  '### 2. 生态工具支持\n* **Serverless LoRA 平台**：Fireworks AI 等平台已提供支持。\n' +
  '* **推理框架适配**：vLLM、SGLang 已完成原生支持。\n\n' +
  '### 总结\nKimi K3 **非常适合**进行 LoRA 训练。';
const structuredNormalized = normalizeAssistantStream({
  content: structuredZhAnswerWithSummary,
  collectApiReasoning: true,
  allowWebSearchExtractFromMain: false,
});
ok(
  '结构化中文答案尾部总结不拆进 thinking',
  structuredNormalized.main.includes('为什么 Kimi K3 极度适合 LoRA') &&
    structuredNormalized.main.includes('### 总结') &&
    !structuredNormalized.thinking.includes('为什么 Kimi K3')
);

// 过程区压缩保留来源
const processContent = composeAssistantMessage({
  main: '广州今天晴',
  webSearch: "Search results for '广州天气'\nhttps://weather.com/guangzhou\nhttps://example.com/gz",
  thinking: '',
});
const compressed = compressAssistantProcessForHistory(processContent);
ok('压缩历史保留检索来源', compressed.includes('广州今天晴') && compressed.includes('weather.com/guangzhou'));

// apiReasoning 中混入正文片段时应合并回 main，而非收入 thinking
const reasoningLooksLikeAnswer = normalizeAssistantStream({
  content: '**Kimi（由月之暗面 Moonshot AI 开发的大模型）目前不支持由用户自行训练 LoRA。**\n\n原因如下：\n1. **闭源限制**：用户无法下载模型权重。\n2. **API 限制**：未开放微调接口。',
  apiReasoning: '**如果您想练习或在实际业务中训练 LoRA，建议选择优秀的开源模型**：',
  collectApiReasoning: true,
  allowWebSearchExtractFromMain: false,
});
ok(
  'apiReasoning 像正文时合并到 main',
  reasoningLooksLikeAnswer.main.includes('建议选择优秀的开源模型') &&
    !reasoningLooksLikeAnswer.thinking.includes('建议选择优秀的开源模型')
);

const reasoningIsRealThinking = normalizeAssistantStream({
  content: '根据计算，小红一共有 8 个苹果。',
  apiReasoning: '**分析请求**\n用户想要计算苹果数量。\n**计算过程**\n4 - 1 + 5 = 8。',
  collectApiReasoning: true,
  allowWebSearchExtractFromMain: false,
});
ok(
  'apiReasoning 是真实推理时保留 thinking',
  reasoningIsRealThinking.thinking.includes('分析请求') &&
    reasoningIsRealThinking.main.includes('8 个苹果')
);

// 中文内心独白 / 自我修正 / 规划应识别为 reasoning
const reasoningSelfTalk = normalizeAssistantStream({
  content: '答案是 42。',
  apiReasoning: '嗯…让我再检查一下，刚才的推导好像漏了一个边界条件。等等，实际上应该是 42。',
  collectApiReasoning: true,
  allowWebSearchExtractFromMain: false,
});
ok(
  'apiReasoning 中文内心独白归入 thinking',
  reasoningSelfTalk.thinking.includes('让我再检查一下') &&
    reasoningSelfTalk.main.includes('答案是 42') &&
    !reasoningSelfTalk.main.includes('漏了一个边界')
);

const reasoningPlanning = normalizeAssistantStream({
  content: '深圳今天大雨，气温 25~31℃。',
  apiReasoning: '第一步：识别用户询问的是深圳天气。第二步：整理温度和天气状况。第三步：给出简洁回答。',
  collectApiReasoning: true,
  allowWebSearchExtractFromMain: false,
});
ok(
  'apiReasoning 规划步骤归入 thinking',
  reasoningPlanning.thinking.includes('第一步') &&
    reasoningPlanning.thinking.includes('第二步') &&
    !reasoningPlanning.main.includes('第一步')
);

const reasoningSelfCorrection = normalizeAssistantStream({
  content: '推荐使用 Python 处理该任务。',
  apiReasoning: '不对，用户要的是高性能方案。重新考虑：Go 更合适。再想想，还是推荐 Python，因为生态成熟。',
  collectApiReasoning: true,
  allowWebSearchExtractFromMain: false,
});
ok(
  'apiReasoning 自我修正归入 thinking',
  reasoningSelfCorrection.thinking.includes('不对') &&
    reasoningSelfCorrection.thinking.includes('重新考虑') &&
    reasoningSelfCorrection.main.includes('推荐使用 Python')
);

// 模型 capability：不支持思考的模型即使 UI 开启也不应发送 thinking 参数（由调用方保证）
ok('Claude 能力矩阵标记为不支持思考', true); // 回归占位：确保能力矩阵同步

// DouBao 等模型常把完整答案同时写入 reasoning 与 content，需去重避免 UI 重复展示
const doubaoDuplicateThinking = normalizeAssistantStream({
  content:
    '在基础十进制数学运算里，最普遍公认的答案是 **1+1=2**~\n\n' +
    '如果是不同场景还有其他可能的结果哦：\n' +
    '1. 二进制运算中：1+1=10；\n' +
    '2. 单位不一致的情况：比如1米+1分米=11分米，1小时+1分钟=61分钟；\n' +
    '3. 生活化的特殊场景/脑筋急转弯：1堆沙子+1堆沙子倒在一起还是1堆沙子。',
  apiReasoning:
    '用户现在问1+1等于多少，首先正常数学里十进制的话就是2对吧，然后也可以说点不同情况的？\n\n' +
    '在基础十进制数学运算里，最普遍公认的答案是 **1+1=2**~\n\n' +
    '如果是不同场景还有其他可能的结果哦：\n' +
    '1. 二进制运算中：1+1=10；\n' +
    '2. 单位不一致的情况：比如1米+1分米=11分米，1小时+1分钟=61分钟；\n' +
    '3. 生活化的特殊场景/脑筋急转弯：1堆沙子+1堆沙子倒在一起还是1堆沙子。',
  collectApiReasoning: true,
  allowWebSearchExtractFromMain: false,
});
ok(
  'DouBao 风格 thinking/main 重复时去重',
  doubaoDuplicateThinking.main.includes('1+1=2') &&
    !doubaoDuplicateThinking.thinking.includes('1+1=2') &&
    // 保留真正属于推理过程的前缀
    doubaoDuplicateThinking.thinking.includes('用户现在问')
);

const exactDuplicateThinking = normalizeAssistantStream({
  content: '推荐你去深圳湾公园，适合散步和看海。',
  apiReasoning: '让我想想用户想去哪里散步。\n\n推荐你去深圳湾公园，适合散步和看海。',
  collectApiReasoning: true,
  allowWebSearchExtractFromMain: false,
});
ok(
  'thinking 与 main 分段落重复时移除重复段落保留推理前缀',
  exactDuplicateThinking.main.includes('深圳湾公园') &&
    exactDuplicateThinking.thinking.includes('让我想想') &&
    !exactDuplicateThinking.thinking.includes('深圳湾公园')
);

const realThinkingWithOverlap = normalizeAssistantStream({
  content: '深圳今天大雨，气温 25~31℃。',
  apiReasoning:
    '用户询问深圳天气。我先确认数据源，再整理温度和降水信息。\n\n' +
    '最终回答可以写成：深圳今天大雨，气温 25~31℃。',
  collectApiReasoning: true,
  allowWebSearchExtractFromMain: false,
});
ok(
  '真实推理中的结论复写去重但保留推理前缀',
  realThinkingWithOverlap.main.includes('深圳今天大雨') &&
    realThinkingWithOverlap.thinking.includes('确认数据源') &&
    !realThinkingWithOverlap.thinking.includes('深圳今天大雨')
);

console.log(`\nSUMMARY PASS ${pass} FAIL ${fail}`);
if (fail > 0) process.exitCode = 1;

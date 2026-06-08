/**
 * 刁钻问题多角度回归：离线管线 + 可选真实 API
 * npx tsx scripts/chat-tricky-questions-test.ts
 * npx tsx scripts/chat-tricky-questions-test.ts --live
 */
import {
  augmentWebSearchWithProbeQuery,
  composeAssistantMessage,
  localizeThinkingProcessForDisplay,
  mergeWithWebSearchProcess,
  normalizeAssistantStream,
  parseAssistantMessage,
  prepareWebSearchFirstPassContent,
  sanitizeWebSearchProcessText,
  splitWebSearchForDisplay,
} from '../utils/assistantMessageLayout.ts';

const RUN_LIVE = process.argv.includes('--live');
const BASE = (process.env.LLM_TEST_BASE_URL || 'http://localhost:3001/aitop-llm-see').replace(/\/$/, '');
const API_KEY = process.env.LLM_TEST_API_KEY || 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma';
const USER_ID = process.env.LLM_TEST_USER_ID || '297409';
const CLAUDE = 'claude-sonnet-4-6';
const TIMEOUT = Number(process.env.LLM_TEST_TIMEOUT_MS || 180000);

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(caseId: string, name: string, cond: boolean, detail = '') {
  const tag = `[${caseId}] ${name}`;
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${tag}${detail ? ` — ${detail.slice(0, 100)}` : ''}`);
  if (cond) pass++;
  else {
    fail++;
    failures.push(`${tag}${detail ? `: ${detail.slice(0, 150)}` : ''}`);
  }
}

function composeLikeFrontend(
  raw: string,
  reasoning: string,
  collect: boolean,
  probe?: string
) {
  let c = composeAssistantMessage(
    normalizeAssistantStream({
      content: raw,
      apiReasoning: reasoning,
      collectApiReasoning: collect,
      skipExtractThinkingFromMain: collect,
    })
  );
  if (probe?.trim()) c = augmentWebSearchWithProbeQuery(c, probe);
  return c;
}

function assertPipeline(
  caseId: string,
  composed: string,
  opts: {
    minMainLen?: number;
    keywords?: string[];
    forbidInProcess?: RegExp[];
    noSectionJump?: boolean;
    sectionsInMain?: string[];
  }
) {
  const parsed = parseAssistantMessage(composed);
  const main = parsed.main;
  const proc = splitWebSearchForDisplay(sanitizeWebSearchProcessText(parsed.webSearch)).process;
  const minLen = opts.minMainLen ?? 60;
  ok(caseId, '正文足够长', main.replace(/\s/g, '').length >= minLen, main.slice(0, 80));
  ok(caseId, '过程区无简体tip', !/请使用简体中文/.test(proc) && !/please note/i.test(proc));
  for (const re of opts.forbidInProcess || []) {
    ok(caseId, `过程区不含 ${re}`, !re.test(proc));
  }
  if (opts.keywords) {
    for (const kw of opts.keywords) {
      ok(caseId, `正文含「${kw}」`, main.includes(kw));
    }
  }
  if (opts.sectionsInMain) {
    for (const s of opts.sectionsInMain) {
      ok(caseId, `正文含${s}`, main.includes(s));
    }
  }
  if (opts.noSectionJump !== false) {
    const jump =
      /[四4]、/.test(main) &&
      !/[一1]、/.test(main) &&
      !/##\s*[一1]/.test(main) &&
      !/###\s*[一1]/.test(main) &&
      !/第一天|Day\s*1/i.test(main);
    ok(caseId, '未从第四节跳写', !jump, main.slice(0, 200));
  }
}

/** 离线：模拟「联网首轮 → 总结」完整管线 */
function simulateWebSearchAnswer(
  caseId: string,
  question: string,
  probe: string,
  firstPassBody: string,
  summarizeBody: string,
  reasoning = '正在整理检索结果。',
  validate?: Parameters<typeof assertPipeline>[2]
) {
  const first = composeLikeFrontend(firstPassBody, '', false, probe);
  const prep = prepareWebSearchFirstPassContent(first, question);
  ok(caseId, '首轮触发总结', prep.needsSummarize);
  const merged = mergeWithWebSearchProcess(
    composeLikeFrontend(summarizeBody, reasoning, true),
    prep.content,
    reasoning,
    true
  );
  assertPipeline(caseId, merged, validate);
}

function runOfflineTricky() {
  console.log('\n========== 离线刁钻场景（展示管线）==========\n');

  simulateWebSearchAnswer(
    'tip-leak',
    '深圳天气',
    '深圳天气',
    `I'll search for "深圳天气".\n\n请使用简体中文。\nPlease note that these are web search results.\nHere are the search results for "请使用简体中文":\n1. **简体中文** https://x.com`,
    '## 深圳天气\n今日多云 28°C。',
    '分析中',
    { keywords: ['深圳', '天气'], minMainLen: 12 }
  );

  simulateWebSearchAnswer(
    'property-1234',
    '中海锦城什么时候入手',
    '深圳中海锦城入手时机',
    `I'll search for "深圳中海锦城".\n\n1. **中海锦城** https://example.com`,
    `**Analyzing**\n\n### 一、概况\n龙华中海锦城。\n\n### 二、价格\n稳中有降。\n\n### 三、建议\n刚需可谈。\n\n| 情况 | 建议 |\n| --- | --- |\n| 自住 | 可谈价 |\n\n### 四、核查\n1. 查成交价\n2. 看挂牌`,
    '购房分析',
    { sectionsInMain: ['一、', '二、', '三、', '四、'], keywords: ['中海'] }
  );

  simulateWebSearchAnswer(
    'itinerary',
    '北京四天三晚攻略',
    '北京四天三晚',
    `Search results for "北京攻略":\n\n1. **故宫** https://gugong.com`,
    `# 北京4天3晚\n## 第一天\n天安门 故宫\n## 第二天\n颐和园\n## 第三天\n长城\n## 第四天\n胡同 返程`,
    '行程规划',
    { keywords: ['第一天', '第二天'], noSectionJump: true, minMainLen: 35 }
  );

  simulateWebSearchAnswer(
    'glued-search-header',
    '现在几点',
    '北京时间 现在几点',
    `I'll search for "北京时间".Here are the search results for "北京时间":\n1. **北京时间** https://time.is`,
    '当前北京时间约下午3点（示例）。',
    '',
    { keywords: ['时间', '北京'], minMainLen: 12 }
  );

  simulateWebSearchAnswer(
    'numbered-not-search',
    '对比两所学校',
    '龙华实验 深中梅香 对比',
    `I'll search for "学校对比".\n\n1. **A校** https://a.com\n2. **B校** https://b.com`,
    `## 对比\n\n| 维度 | 龙华实验 | 深中梅香 |\n| --- | --- | --- |\n| 性质 | 公办 | 公办 |\n\n### 一、龙华实验\n...\n\n### 二、深中梅香\n...`,
    '',
    { keywords: ['龙华', '梅香'] }
  );

  const userEchoTip = composeLikeFrontend(
    '请使用简体中文回复：深圳今天热吗？',
    '',
    false
  );
  assertPipeline('user-echo-tip', userEchoTip, {
    minMainLen: 10,
    keywords: ['简体中文', '深圳'],
    forbidInProcess: [/请使用简体中文.*Search results/i],
  });

  const thinkZh = localizeThinkingProcessForDisplay(
    '**Planning the response**\nI need to search for weather.\n**Analyzing results**'
  );
  ok('think-zh', '思考区英转中', /规划|分析|检索|需要/i.test(thinkZh), thinkZh.slice(0, 80));

  simulateWebSearchAnswer(
    'empty-summarize-retry',
    '测试',
    '测试',
    `I'll search for "测试".\n\n1. **x** https://x.com`,
    '这是总结后的完整回答，包含足够中文字数用于展示正文区域，不应为空。',
    '思考',
    { minMainLen: 20 }
  );
}

// --- live API ---
function mkId(tag: string) {
  return `${USER_ID}_tricky_${tag}_${Date.now()}`.slice(0, 63);
}

function parseLine(line: string) {
  const t = (line || '').trim();
  if (!t || t === '[DONE]') return null;
  return t.startsWith('data:') ? t.slice(5).trim() : t;
}

async function streamChat(opts: {
  chatId: string;
  message: string;
  webSearch?: boolean;
  thinking?: boolean;
  thinkingLevel?: string;
  tip?: string;
}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': API_KEY },
      body: JSON.stringify({
        id: opts.chatId,
        message: opts.message,
        model: CLAUDE,
        tip: opts.tip ?? ' ',
        webSearch: !!opts.webSearch,
        thinking: !!opts.thinking,
        thinkingLevel: opts.thinkingLevel || 'low',
      }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => '')}`);
    if (!res.body) throw new Error('no body');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let content = '';
    let reasoning = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const raw of lines) {
        const pl = parseLine(raw);
        if (!pl) continue;
        try {
          const d = JSON.parse(pl);
          if (typeof d?.content === 'string') content += d.content;
          const r = d?.reasoning_content || d?.thinkingContent || d?.thinking_content;
          if (typeof r === 'string') reasoning += r;
        } catch {
          /* skip */
        }
      }
    }
    return { content, reasoning };
  } finally {
    clearTimeout(timer);
  }
}

async function probeQuery(question: string, hint: string) {
  const r = await streamChat({
    chatId: mkId('probe'),
    message: `将下列问题改写为一条中文搜索查询（仅一行）：\n${question}`,
    webSearch: false,
    thinking: false,
  });
  return (r.content || hint).split('\n')[0].trim().slice(0, 120) || hint;
}

async function liveWebSearchCase(
  caseId: string,
  question: string,
  probeHint: string,
  validate: Parameters<typeof assertPipeline>[2]
) {
  console.log(`\n--- [LIVE] ${caseId}: ${question.slice(0, 40)}... ---`);
  const pq = await probeQuery(question, probeHint);
  const first = await streamChat({
    chatId: mkId('ws'),
    message: pq,
    webSearch: true,
    thinking: false,
    tip: ' ',
  });
  const firstC = composeLikeFrontend(first.content, '', false, pq);
  const prep = prepareWebSearchFirstPassContent(firstC, question);
  const summarizeMsg = (compact: boolean) =>
    compact
      ? `用简体中文简要回答（至少200字）。\n\n【问题】${question}\n\n【检索】\n${prep.content.slice(0, 3500)}`
      : `请用简体中文根据下列检索内容回答问题；分节须完整；勿输出 Search results。\n\n【问题】${question}\n\n【检索】\n${prep.content.slice(0, 5000)}`;

  let sum = await streamChat({
    chatId: mkId('sum'),
    message: summarizeMsg(false),
    webSearch: false,
    thinking: true,
    thinkingLevel: 'high',
    tip: '思考过程请用简体中文。',
  });
  if ((sum.content || '').replace(/\s/g, '').length < 50) {
    sum = await streamChat({
      chatId: mkId('sum2'),
      message: summarizeMsg(true),
      webSearch: false,
      thinking: true,
      thinkingLevel: 'high',
    });
  }
  const merged = mergeWithWebSearchProcess(
    composeLikeFrontend(sum.content, sum.reasoning, true),
    prep.content,
    sum.reasoning,
    true
  );
  assertPipeline(caseId, merged, validate);
}

const LIVE_CASES: Array<{
  id: string;
  q: string;
  probe: string;
  v: Parameters<typeof assertPipeline>[2];
}> = [
  {
    id: 'weather',
    q: '今天深圳天气如何，未来几天天气情况',
    probe: '深圳天气预报',
    v: { keywords: ['深圳', '天气'] },
  },
  {
    id: 'property',
    q: '中海锦城这个楼盘你觉得什么时候入手合适，我怕未来还有下跌的风险',
    probe: '深圳中海锦城房价走势',
    v: { keywords: ['中海锦城', '入手'], noSectionJump: true },
  },
  {
    id: 'itinerary',
    q: '北京四天三晚旅游攻略，第二天下午去颐和园来得及吗',
    probe: '北京四天三晚行程',
    v: { keywords: ['北京', '天'] },
  },
  {
    id: 'time',
    q: '现在北京时间几点',
    probe: '北京时间 现在',
    v: { keywords: ['时间'] },
  },
  {
    id: 'table-school',
    q: '用表格对比龙华实验中学和深中梅香学校，从升学、师资、学区说',
    probe: '龙华实验 深中梅香 对比',
    v: { keywords: ['龙华', '梅香'] },
  },
  {
    id: 'short',
    q: '深圳天气',
    probe: '深圳天气',
    v: { keywords: ['深圳'], minMainLen: 30 },
  },
  {
    id: 'long',
    q: '请帮我规划深圳周末两天一夜：周六上午科技馆、下午海岸城、晚上人才公园灯光秀；周日大鹏古城+较场尾，要考虑地铁末班车和预约，给交通方式和大概花费',
    probe: '深圳周末两日游攻略',
    v: { keywords: ['深圳', '周六'] },
  },
  {
    id: 'food',
    q: '深圳近两天美食攻略，不要网红踩雷店',
    probe: '深圳美食推荐',
    v: { keywords: ['深圳', '美食'] },
  },
  {
    id: 'market',
    q: '深圳楼市2024年最新行情，房价是真回暖还是短期反弹',
    probe: '深圳楼市2024房价',
    v: { keywords: ['深圳', '楼市'] },
  },
  {
    id: 'english-q',
    q: 'What is the weather in Shenzhen today? Reply in Chinese.',
    probe: 'Shenzhen weather today',
    v: { keywords: ['深圳', '天气'], minMainLen: 40 },
  },
];

async function runLiveTricky() {
  const ping = await fetch(BASE.replace(/\/aitop-llm-see$/, '/'));
  if (!ping.ok) throw new Error('localhost:3001 未启动，请先 npm start');

  console.log('\n========== 真实 API 刁钻问题（Claude）==========');
  for (const c of LIVE_CASES) {
    try {
      await liveWebSearchCase(c.id, c.q, c.probe, c.v);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ok(c.id, '请求成功', false, msg);
    }
  }
}

async function main() {
  console.log('=== 刁钻问题多角度测试 ===');
  runOfflineTricky();
  if (RUN_LIVE) {
    await runLiveTricky();
  } else {
    console.log('\n（跳过真实 API；加 --live 运行联网实测，约 15–25 分钟）');
  }
  console.log(`\n=== 总计 PASS ${pass} FAIL ${fail} ===`);
  if (failures.length) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

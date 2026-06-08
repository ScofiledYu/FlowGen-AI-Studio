/**
 * 真实 API 冒烟 + 与前端一致的展示管线校验（需 localhost:3001 + aitop key）
 * npx tsx scripts/chat-live-smoke-test.ts
 */
import {
  augmentWebSearchWithProbeQuery,
  composeAssistantMessage,
  mergeWithWebSearchProcess,
  normalizeAssistantStream,
  parseAssistantMessage,
  prepareWebSearchFirstPassContent,
  sanitizeWebSearchProcessText,
  splitWebSearchForDisplay,
} from '../utils/assistantMessageLayout.ts';

const BASE = (process.env.LLM_TEST_BASE_URL || 'http://localhost:3001/aitop-llm-see').replace(/\/$/, '');
const API_KEY = process.env.LLM_TEST_API_KEY || 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma';
const USER_ID = process.env.LLM_TEST_USER_ID || '297409';
const CLAUDE = 'claude-sonnet-4-6';
const TIMEOUT = Number(process.env.LLM_TEST_TIMEOUT_MS || 120000);

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail.slice(0, 120)}` : ''}`);
  if (cond) pass++;
  else fail++;
}

function mkId(tag: string) {
  return `${USER_ID}_smoke_${tag}_${Date.now()}`.slice(0, 63);
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
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${txt.slice(0, 200)}`);
    }
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
          const data = JSON.parse(pl);
          if (typeof data?.content === 'string') content += data.content;
          const r = data?.reasoning_content || data?.thinkingContent || data?.thinking_content;
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

function composeLikeFrontend(
  rawContent: string,
  apiReasoning: string,
  collectApiReasoning: boolean,
  probeQuery?: string
) {
  let composed = composeAssistantMessage(
    normalizeAssistantStream({
      content: rawContent,
      apiReasoning,
      collectApiReasoning,
      skipExtractThinkingFromMain: collectApiReasoning,
    })
  );
  if (probeQuery?.trim()) composed = augmentWebSearchWithProbeQuery(composed, probeQuery);
  return composed;
}

function buildSummarizePrompt(question: string, dump: string) {
  const src = dump.slice(0, 5000);
  return (
    `请根据下面的联网检索内容，用简体中文回答用户问题；按你认为合适的方式组织即可。\n` +
    `若使用「一、二、三、四」等分节标题，每一节都须写完整正文，不得从中间某一节才开始写。\n` +
    `行程/日程类问题请逐条写全，不要用省略号代替未写出的内容。\n` +
    `检索原文已在过程区展示，正文只需写面向用户的回答，无需重复粘贴整段 Search results。\n\n` +
    `【用户问题】\n${question}\n\n` +
    `【联网检索内容】\n${src}`
  );
}

function validateDisplay(
  composed: string,
  opts: { needSections?: string[]; keywords?: string[]; question: string }
) {
  const parsed = parseAssistantMessage(composed);
  const main = parsed.main;
  const ws = sanitizeWebSearchProcessText(parsed.webSearch);
  const { process: searchProcess } = splitWebSearchForDisplay(ws);
  ok('正文非空', main.replace(/\s/g, '').length > 80, main.slice(0, 80));
  ok(
    '过程区无 tip 泄漏',
    !/请使用简体中文/.test(searchProcess) && !/please note that these are web search/i.test(searchProcess)
  );
  ok(
    '正文不在过程区',
    !searchProcess.includes('### 一、') && !searchProcess.includes('### 四、'),
    searchProcess.slice(0, 120)
  );
  if (opts.needSections) {
    for (const s of opts.needSections) {
      ok(`正文含${s}`, main.includes(s), main.slice(0, 200));
    }
  }
  if (opts.keywords) {
    for (const kw of opts.keywords) {
      ok(`正文含「${kw}」`, main.includes(kw), main.slice(0, 200));
    }
  }
  const hasSectionJump =
    /[四4]、/.test(main) && !/[一1]、/.test(main) && !/##\s*[一1]/.test(main) && !/###\s*[一1]/.test(main);
  ok('正文未从第四节跳写（缺一二三）', !hasSectionJump, main.slice(0, 300));
}

async function runWebSearchFlow(
  caseName: string,
  question: string,
  probeHint: string,
  extra?: { needSections?: string[]; keywords?: string[] }
) {
  console.log(`\n--- ${caseName} ---`);
  const probeId = mkId('probe');
  const searchId = mkId('search');
  const rewrite = await streamChat({
    chatId: probeId,
    message:
      `你是检索查询改写器。根据对话，将用户最后一问改写成一条适合搜索引擎的中文查询（仅一行）。\n\n【最后一问】\n${question}\n\n查询：`,
    webSearch: false,
    thinking: false,
  });
  const probeQuery = (rewrite.content || probeHint).split('\n')[0].trim().slice(0, 120) || probeHint;

  const first = await streamChat({
    chatId: searchId,
    message: probeQuery,
    webSearch: true,
    thinking: false,
    tip: ' ',
  });

  const firstComposed = composeLikeFrontend(first.content, '', false, probeQuery);
  const prep = prepareWebSearchFirstPassContent(firstComposed, question);
  let summarize = await streamChat({
    chatId: mkId('sum'),
    message: buildSummarizePrompt(question, prep.content),
    webSearch: false,
    thinking: true,
    thinkingLevel: 'high',
    tip: '请使用简体中文（中国大陆）回复。思考过程请使用简体中文。',
  });
  if ((summarize.content || '').replace(/\s/g, '').length < 40) {
    summarize = await streamChat({
      chatId: mkId('sum2'),
      message: buildSummarizePrompt(question, prep.content),
      webSearch: false,
      thinking: true,
      thinkingLevel: 'high',
      tip: '请使用简体中文（中国大陆）回复。思考过程请使用简体中文。',
    });
  }

  const merged = mergeWithWebSearchProcess(
    composeLikeFrontend(summarize.content, summarize.reasoning, true),
    prep.content,
    summarize.reasoning,
    true
  );
  validateDisplay(merged, { question, ...extra });
}

async function main() {
  const ping = await fetch(BASE.replace(/\/aitop-llm-see$/, '/'));
  if (!ping.ok) throw new Error(`服务不可用: ${BASE.replace(/\/aitop-llm-see$/, '')} (需 npm start)`);

  console.log('=== 真实 API 冒烟（Claude + 展示管线校验）===\n');

  await runWebSearchFlow(
    '深圳天气',
    '今天深圳天气如何，未来几天天气情况',
    '深圳今日天气及未来几天天气预报'
  );

  await runWebSearchFlow(
    '中海锦城入手',
    '中海锦城这个楼盘你觉得什么时候入手合适，我怕未来还有下跌的风险',
    '深圳中海锦城楼盘入手时机 房价走势',
    { keywords: ['中海锦城', '入手'] }
  );

  await runWebSearchFlow('北京行程', '北京四天三晚旅游攻略', '北京四天三晚旅游攻略 必去景点', {
    keywords: ['北京', '天'],
  });

  console.log(`\n=== SUMMARY PASS ${pass} FAIL ${fail} ===`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

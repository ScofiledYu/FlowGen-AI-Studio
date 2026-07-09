/**
 * DeepSeek V4 Pro / DouBao Seed 2.0 冒烟：联网、思考、识图
 * node scripts/llm-new-models-smoke.mjs
 */
const BASE = process.env.LLM_TEST_BASE_URL || 'http://localhost:3001/aitop-llm-see';
const API_KEY = process.env.LLM_TEST_API_KEY || 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma';
const USER_ID = process.env.LLM_TEST_USER_ID || '297409';
const TIMEOUT_MS = Number(process.env.LLM_TEST_TIMEOUT_MS || 180000);

const MODELS = [
  { label: 'DeepSeek V4 Pro', api: 'deepseek-v4-pro-260425' },
  { label: 'DouBao Seed 2.0', api: 'doubao-seed-2-0-pro-260215' },
];

const TEST_IMAGE =
  'https://fyscapptest-1251510006.cos.ap-shanghai.myqcloud.com/chatImage/540d8b4f-6f23-4909-ac11-bc60f7d84a36.jpg?imageMogr2/format/webp';

const UPSTREAM_FLAKY_RE = /请多试|未能回复|出了一些问题|稍后再试/i;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callModelResilient(apiModel, message, opts = {}, tag = 'req') {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const text = await callModel(apiModel, message, opts);
      if (UPSTREAM_FLAKY_RE.test(text) && i < 2) {
        await sleep(2500);
        continue;
      }
      if (UPSTREAM_FLAKY_RE.test(text)) throw new Error(text.slice(0, 120));
      return text;
    } catch (e) {
      last = e;
      if (i < 2) await sleep(2500);
    }
  }
  throw last ?? new Error('callModelResilient failed');
}

function mkId(tag) {
  return `${USER_ID}_smoke_${tag}_${Date.now()}`.slice(0, 63);
}

function getChunk(data) {
  if (!data || typeof data !== 'object') return '';
  const parts = [
    data.content,
    data.text,
    data.message,
    data.reasoning_content,
    data.reasoningContent,
    data.thinkingContent,
    data.data?.content,
    data.data?.response,
    data.delta?.content,
    data.delta?.reasoning_content,
  ];
  return parts.filter((p) => typeof p === 'string' && p).join('');
}

async function readSseText(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let full = '';
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const pl = line.startsWith('data:') ? line.slice(5).trim() : line;
      if (!pl || pl === '[DONE]') continue;
      try {
        const data = JSON.parse(pl);
        if (data?.success === false && data?.message) throw new Error(String(data.message));
        full += getChunk(data);
      } catch (e) {
        if (e instanceof SyntaxError && !pl.startsWith('{')) full += pl;
        else if (!(e instanceof SyntaxError)) throw e;
      }
    }
  }
  try {
    await reader.cancel();
  } catch {
    /* ignore */
  }
  return full.trim();
}

async function callModel(apiModel, message, opts = {}) {
  const body = {
    id: mkId(apiModel.slice(0, 12).replace(/[^a-z0-9]/gi, '')),
    message,
    model: apiModel,
    tip: ' ',
    webSearch: !!opts.webSearch,
    thinking: opts.thinking !== false,
    thinkingLevel: opts.thinkingLevel || 'low',
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': API_KEY },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
    }
    if (!res.body) {
      const t = await res.text().catch(() => '');
      throw new Error(`empty body: ${t.slice(0, 300)}`);
    }
    return await readSseText(res);
  } finally {
    clearTimeout(timer);
  }
}

let pass = 0;
let fail = 0;

function ok(name, cond, detail = '') {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail.slice(0, 120)}` : ''}`);
  if (cond) pass++;
  else fail++;
}

console.log('\n=== 新模型冒烟 (DeepSeek / DouBao) ===\n');
console.log(`BASE: ${BASE}\n`);

for (const m of MODELS) {
  console.log(`--- ${m.label} (${m.api}) ---`);

  try {
    const thinkText = await callModelResilient(m.api, '1+1等于几？只回答数字，不要解释。', {
      thinking: true,
      thinkingLevel: 'high',
      webSearch: false,
    });
    ok(`${m.label} 思考/基础`, /\b2\b/.test(thinkText), thinkText.slice(0, 80));
  } catch (e) {
    ok(`${m.label} 思考/基础`, false, e instanceof Error ? e.message : String(e));
  }

  try {
    const webText = await callModelResilient(
      m.api,
      '今天是2026年6月12日，请联网查一下今天深圳的天气概况，用一句话中文回答。',
      { webSearch: true, thinking: false }
    );
    const hasWeatherHint = /深圳|天气|雨|晴|云|温|℃|度/i.test(webText);
    ok(`${m.label} 联网`, hasWeatherHint && webText.length > 8, webText.slice(0, 100));
  } catch (e) {
    ok(`${m.label} 联网`, false, e instanceof Error ? e.message : String(e));
  }

  try {
    const imgMsg = `这张图片里主要是什么颜色？只回答颜色名。\n<p>![](${TEST_IMAGE})</p>`;
    const imgText = await callModelResilient(m.api, imgMsg, { webSearch: false, thinking: false }, 'img');
    const hasColor = /红|蓝|绿|黄|白|黑|灰|色|color/i.test(imgText);
    ok(`${m.label} 识图`, hasColor && imgText.length >= 2, imgText.slice(0, 100));
  } catch (e) {
    ok(`${m.label} 识图`, false, e instanceof Error ? e.message : String(e));
  }

  console.log('');
}

console.log(`=== 汇总: ${pass} 通过, ${fail} 失败 ===\n`);
if (fail > 0) process.exit(1);

/**
 * DeepSeek V4 Pro 单模型冒烟
 * node scripts/llm-deepseek-smoke.mjs
 */
const BASE = process.env.LLM_TEST_BASE_URL || 'http://localhost:3001/aitop-llm-see';
const API_KEY = process.env.LLM_TEST_API_KEY || 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma';
const USER_ID = process.env.LLM_TEST_USER_ID || '297409';
const TIMEOUT_MS = Number(process.env.LLM_TEST_TIMEOUT_MS || 180000);
const API = 'deepseek-v4-pro-260425';
const TEST_IMAGE =
  'https://fyscapptest-1251510006.cos.ap-shanghai.myqcloud.com/chatImage/540d8b4f-6f23-4909-ac11-bc60f7d84a36.jpg?imageMogr2/format/webp';
const UPSTREAM_FLAKY_RE = /请多试|未能回复|出了一些问题|稍后再试/i;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mkId(tag) {
  return `${USER_ID}_ds_${tag}_${Date.now()}`.slice(0, 63);
}

function getChunk(data) {
  if (!data || typeof data !== 'object') return '';
  return [
    data.content,
    data.text,
    data.message,
    data.reasoning_content,
    data.data?.content,
    data.delta?.content,
  ]
    .filter((p) => typeof p === 'string' && p)
    .join('');
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

async function callModel(message, opts = {}) {
  const body = {
    id: mkId('t'),
    message,
    model: API,
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
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    if (!res.body) throw new Error('empty body');
    return await readSseText(res);
  } finally {
    clearTimeout(timer);
  }
}

async function resilient(message, opts) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const text = await callModel(message, opts);
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
  throw last;
}

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail.slice(0, 120)}` : ''}`);
  if (cond) pass++;
  else fail++;
}

console.log(`\n=== DeepSeek V4 Pro (${API}) 冒烟 ===\nBASE: ${BASE}\n`);

try {
  const t = await resilient('1+1等于几？只回答数字。', {
    thinking: true,
    thinkingLevel: 'high',
    webSearch: false,
  });
  ok('思考/基础', /\b2\b/.test(t), t.slice(0, 80));
} catch (e) {
  ok('思考/基础', false, e instanceof Error ? e.message : String(e));
}

try {
  const w = await resilient('请联网查今天深圳天气，一句话中文。', { webSearch: true, thinking: false });
  ok('联网', /深圳|天气|雨|晴|云|温/i.test(w) && w.length > 8, w.slice(0, 100));
} catch (e) {
  ok('联网', false, e instanceof Error ? e.message : String(e));
}

try {
  const img = await resilient(`图片主色？只答颜色。\n<p>![](${TEST_IMAGE})</p>`, {
    webSearch: false,
    thinking: false,
  });
  ok('识图', /红|蓝|绿|黄|白|黑|灰|色|米/i.test(img) && img.length >= 2, img.slice(0, 100));
} catch (e) {
  ok('识图', false, e instanceof Error ? e.message : String(e));
}

console.log(`\n=== 汇总: ${pass} 通过, ${fail} 失败 ===\n`);
process.exit(fail > 0 ? 1 : 0);

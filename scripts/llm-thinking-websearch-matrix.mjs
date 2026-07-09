/**
 * 全 AiTop 聊天模型：思考 + 联网 能力矩阵
 * node scripts/llm-thinking-websearch-matrix.mjs
 */
const BASE = process.env.LLM_TEST_BASE_URL || 'http://localhost:3001/aitop-llm-see';
const API_KEY = process.env.LLM_TEST_API_KEY || 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma';
const USER_ID = process.env.LLM_TEST_USER_ID || '297409';
const TIMEOUT_MS = Number(process.env.LLM_TEST_TIMEOUT_MS || 180000);

/** 与 utils/aitopChatModels.ts 同步 */
const MODELS = [
  { label: 'Gemini 3.1 Pro', api: 'gemini-3.1-pro-preview:streamGenerateContent' },
  { label: 'Claude 4.6', api: 'claude-sonnet-4-6' },
  { label: 'DeepSeek V4 Pro', api: 'deepseek-v4-pro-260425' },
  { label: 'DouBao Seed 2.0', api: 'doubao-seed-2-0-pro-260215' },
];

const UPSTREAM_FLAKY_RE = /请多试|未能回复|出了一些问题|稍后再试/i;
const WEB_HINT_RE = /深圳|天气|雨|晴|云|温|℃|度/i;
const THINKING_HINT_RE =
  /\[思考过程\]|reasoning|思考|推理|分析步骤|let me think|step by step/i;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mkId(modelApi, tag) {
  const slug = modelApi.replace(/[^a-z0-9]/gi, '').slice(0, 12);
  return `${USER_ID}_tw_${slug}_${tag}_${Date.now()}`.slice(0, 63);
}

function extractFromChunk(data) {
  if (!data || typeof data !== 'object') return { content: '', reasoning: '' };
  const contentParts = [
    data.content,
    data.text,
    data.message,
    data.data?.content,
    data.data?.response,
    data.delta?.content,
  ];
  const reasoningParts = [
    data.reasoning_content,
    data.reasoningContent,
    data.thinkingContent,
    data.data?.reasoning_content,
    data.delta?.reasoning_content,
  ];
  return {
    content: contentParts.filter((p) => typeof p === 'string' && p).join(''),
    reasoning: reasoningParts.filter((p) => typeof p === 'string' && p).join(''),
  };
}

async function streamChat(modelApi, message, opts = {}) {
  const body = {
    id: mkId(modelApi, opts.tag || 'req'),
    message,
    model: modelApi,
    tip: ' ',
    webSearch: !!opts.webSearch,
    thinking: opts.thinking !== false,
    thinkingLevel: opts.thinkingLevel || (opts.thinking ? 'high' : 'low'),
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
    if (!res.body) throw new Error('empty body');

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let content = '';
    let reasoning = '';
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
          const parts = extractFromChunk(data);
          content += parts.content;
          reasoning += parts.reasoning;
        } catch (e) {
          if (e instanceof SyntaxError && !pl.startsWith('{')) content += pl;
          else if (!(e instanceof SyntaxError)) throw e;
        }
      }
    }
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    return {
      content: content.trim(),
      reasoning: reasoning.trim(),
      full: `${reasoning}\n${content}`.trim(),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function resilient(modelApi, message, opts) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const result = await streamChat(modelApi, message, opts);
      const text = result.full || result.content;
      if (UPSTREAM_FLAKY_RE.test(text) && i < 2) {
        await sleep(2500);
        continue;
      }
      if (UPSTREAM_FLAKY_RE.test(text)) throw new Error(text.slice(0, 120));
      return result;
    } catch (e) {
      last = e;
      if (i < 2) await sleep(2500);
    }
  }
  throw last ?? new Error('resilient failed');
}

const results = [];

function record(model, capability, ok, detail, extra = {}) {
  results.push({ model, capability, ok, detail, ...extra });
  console.log(`  [${ok ? 'OK' : 'FAIL'}] ${capability}${detail ? ` — ${detail.slice(0, 140)}` : ''}`);
}

console.log('\n=== LLM 思考 + 联网 能力矩阵 ===');
console.log(`BASE: ${BASE}\n`);

for (const m of MODELS) {
  console.log(`--- ${m.label} (${m.api}) ---`);

  try {
    const think = await resilient(m.api, '1+1等于几？只回答数字，不要解释。', {
      tag: 'think',
      thinking: true,
      thinkingLevel: 'high',
      webSearch: false,
    });
    const answerOk = /\b2\b/.test(think.content || think.full);
    const reasoningSignal =
      (think.reasoning && think.reasoning.length > 8) ||
      THINKING_HINT_RE.test(think.full);
    record(
      m.label,
      '思考',
      answerOk,
      think.content.slice(0, 80) || think.full.slice(0, 80),
      { reasoningDetected: reasoningSignal, reasoningLen: think.reasoning.length }
    );
    if (answerOk && !reasoningSignal) {
      console.log('       (注: 回答正确但未检测到独立 reasoning 流，可能合并在正文或上游静默思考)');
    }
  } catch (e) {
    record(m.label, '思考', false, e instanceof Error ? e.message : String(e));
  }

  try {
    const web = await resilient(
      m.api,
      '今天是2026年6月12日，请联网查一下今天深圳的天气概况，用一句话中文回答。',
      { tag: 'web', thinking: false, webSearch: true }
    );
    const text = web.content || web.full;
    const webOk = WEB_HINT_RE.test(text) && text.length > 8;
    record(m.label, '联网', webOk, text.slice(0, 120));
  } catch (e) {
    record(m.label, '联网', false, e instanceof Error ? e.message : String(e));
  }

  console.log('');
}

console.log('--- Qwen（预期不支持）---');
console.log('  [N/A] 思考 — UI 与 payload 均不发送 thinking');
console.log('  [N/A] 联网 — UI 与 payload 均不发送 webSearch\n');

console.log('=== 汇总表 ===');
console.log('模型\t\t\t思考\t联网');
for (const m of MODELS) {
  const think = results.find((r) => r.model === m.label && r.capability === '思考');
  const web = results.find((r) => r.model === m.label && r.capability === '联网');
  const pad = m.label.padEnd(20, ' ');
  console.log(`${pad}\t${think?.ok ? '✓' : '✗'}\t${web?.ok ? '✓' : '✗'}`);
}
console.log(`${'Qwen'.padEnd(20, '\t')}\t—\t—`);

const fail = results.filter((r) => !r.ok).length;
console.log(`\n=== ${results.length} 项实测, ${results.filter((r) => r.ok).length} 通过, ${fail} 失败 ===\n`);
process.exit(fail > 0 ? 1 : 0);

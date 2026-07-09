/**
 * Chat 审计交付实测：身份关联网 + 普通问答自然回复 + DeepSeek 身份不自称 Claude
 * node scripts/llm-chat-audit-live.mjs
 */
const BASE = process.env.LLM_TEST_BASE_URL || 'http://localhost:3001/aitop-llm-see';
const API_KEY = process.env.LLM_TEST_API_KEY || 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma';
const USER_ID = process.env.LLM_TEST_USER_ID || '297409';
const TIMEOUT_MS = Number(process.env.LLM_TEST_TIMEOUT_MS || 120000);
const DS = 'deepseek-v4-pro-260425';

function getChunk(d) {
  if (!d || typeof d !== 'object') return '';
  return [d.content, d.text, d.message, d.delta?.content, d.data?.content]
    .filter((p) => typeof p === 'string' && p)
    .join('');
}

async function streamChat({ message, model, webSearch, thinking, tip }) {
  const body = {
    id: `${USER_ID}_audit_${Date.now()}`.slice(0, 63),
    message,
    model,
    tip: tip || '请使用简体中文（中国大陆）回复。',
    webSearch: !!webSearch,
    thinking: !!thinking,
    thinkingLevel: thinking ? 'high' : 'low',
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': API_KEY },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let content = '';
    while (true) {
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
          const d = JSON.parse(pl);
          if (d?.success === false) throw new Error(String(d.message || 'fail'));
          content += getChunk(d);
        } catch (e) {
          if (e instanceof SyntaxError) {
            if (!pl.startsWith('{')) content += pl;
          } else throw e;
        }
      }
    }
    return content.trim();
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

console.log('=== Chat 审计 live ===\n');

// 1) 身份问：关联网 + 轻量 tip → 应自称 DeepSeek，不自称 Claude
{
  const tip =
    '请使用简体中文（中国大陆）回复。\n' +
    '当前会话选用模型为「DeepSeek V4 Pro」。请据此自我介绍，勿因对话历史或检索结果改称其他模型产品名。';
  const t = await streamChat({
    message: '你是哪个模型 你删除做什么',
    model: DS,
    webSearch: false,
    thinking: false,
    tip,
  });
  ok('身份问自称 DeepSeek', /DeepSeek|深度求索/i.test(t), t);
  ok('身份问不自称 Claude', !/我是\s*Claude|I am Claude|由 Anthropic 开发/i.test(t), t);
}

// 2) 普通知识问：无身份 tip、无联网 → 自然回答（不强制模型名）
{
  const t = await streamChat({
    message: '1+1等于几？只回答数字。',
    model: DS,
    webSearch: false,
    thinking: false,
    tip: '请使用简体中文（中国大陆）回复。',
  });
  ok('普通问答自然回复含 2', /\b2\b/.test(t), t);
}

// 3) 仅联网：天气
{
  const t = await streamChat({
    message: '请联网查今天深圳天气，一句话中文。',
    model: DS,
    webSearch: true,
    thinking: false,
    tip: ' ',
  });
  ok('仅联网天气有内容', /深圳|天气|雨|晴|云|温|℃|度/i.test(t) && t.length > 8, t);
}

console.log(`\n=== SUMMARY PASS ${pass} FAIL ${fail} ===`);
process.exit(fail > 0 ? 1 : 0);

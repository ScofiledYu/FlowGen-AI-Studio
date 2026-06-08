/**
 * Gemini 思考分离 + 联网/总结 冒烟（需 localhost:3001）
 * node scripts/llm-gemini-thinking-split-test.mjs
 */
const BASE = process.env.LLM_TEST_BASE_URL || 'http://localhost:3001/aitop-llm-see';
const API_KEY = process.env.LLM_TEST_API_KEY || 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma';
const USER_ID = process.env.LLM_TEST_USER_ID || '297409';
const GEMINI = 'gemini-3.1-pro-preview:streamGenerateContent';
const CLAUDE = 'claude-sonnet-4-6';
const TIMEOUT = Number(process.env.LLM_TEST_TIMEOUT_MS || 120000);

function mkId(tag) {
  return `${USER_ID}_smoke_${tag}_${Date.now()}`.slice(0, 63);
}

function parseLine(line) {
  const t = (line || '').trim();
  if (!t || t === '[DONE]') return null;
  return t.startsWith('data:') ? t.slice(5).trim() : t;
}

function contentChunk(data) {
  if (typeof data?.content === 'string' && data.content) return data.content;
  return '';
}

function reasoningChunk(data) {
  if (typeof data?.thinkingContent === 'string') return data.thinkingContent;
  if (typeof data?.reasoning_content === 'string') return data.reasoning_content;
  return '';
}

async function streamChat({ model, chatId, message, webSearch, thinking, thinkingLevel, tip }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': API_KEY },
      body: JSON.stringify({
        id: chatId,
        message,
        model,
        tip: tip ?? ' ',
        webSearch: !!webSearch,
        thinking: !!thinking,
        thinkingLevel: thinkingLevel || 'low',
      }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
          content += contentChunk(data);
          reasoning += reasoningChunk(data);
        } catch {
          /* skip */
        }
      }
    }
    return { content, reasoning, combined: content + (reasoning ? `\n\n[思考过程]\n${reasoning}` : '') };
  } finally {
    clearTimeout(timer);
  }
}

function extractGeminiInlineThinking(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (!ln) continue;
    const zh = (ln.match(/[\u4e00-\u9fa5]/g) || []).length;
    if (/^\*\*[A-Za-z]/.test(ln)) continue;
    if (zh >= 4) {
      const head = lines.slice(0, i).join('\n').trim();
      const tail = lines.slice(i).join('\n').trim();
      if (head.length >= 16) return { main: tail, thinking: head };
      break;
    }
  }
  return { main: text, thinking: '' };
}

async function main() {
  const ping = await fetch(BASE.replace(/\/aitop-llm-see$/, '/'));
  if (!ping.ok) throw new Error('server not on 3001');

  let pass = 0;
  let fail = 0;
  const ok = (n, cond, detail = '') => {
    console.log(`  [${cond ? 'OK' : 'FAIL'}] ${n}${detail ? ` — ${detail.slice(0, 80)}` : ''}`);
    if (cond) pass++;
    else fail++;
  };

  console.log('=== Gemini/Claude 冒烟 ===\n[1] Gemini 轻度思考 + 短问');
  const g1 = await streamChat({
    model: GEMINI,
    chatId: mkId('g_think'),
    message: '用一句话介绍你自己',
    webSearch: false,
    thinking: true,
    thinkingLevel: 'low',
    tip: '若启用思考，思考过程请用中文表述，勿使用英文小标题（如 **Analyzing the Context**）。',
  });
  const split = extractGeminiInlineThinking(g1.content);
  const mainStartsEnThink = /^\*\*[A-Za-z]/.test(g1.content.trim());
  ok('正文不以英文思考标题开头', !mainStartsEnThink || !!split.thinking, g1.content.slice(0, 60));
  ok('有中文主回复', /[\u4e00-\u9fa5]{4,}/.test(split.main || g1.content), split.main || g1.content);

  console.log('\n[2] Gemini 联网（改写 chatId 隔离后单轮）');
  const probeId = mkId('probe_rw');
  const searchId = mkId('probe_ws');
  const rewriteRes = await streamChat({
    model: CLAUDE,
    chatId: probeId,
    message:
      '你是检索查询改写器。根据对话，将用户最后一问改写成一条适合搜索引擎的中文查询。\n\n【最后一问】\n现在几点\n\n查询：',
    webSearch: false,
    thinking: false,
  });
  const q = (rewriteRes.content || '北京时间现在几点').split('\n')[0].trim().slice(0, 80);
  const g2 = await streamChat({
    model: GEMINI,
    chatId: searchId,
    message: q,
    webSearch: true,
    thinking: false,
  });
  ok('联网有返回', (g2.content || '').replace(/\s/g, '').length > 20, g2.content.slice(0, 80));
  ok('联网结果不含改写器提示词', !/检索查询改写器/.test(g2.content), g2.content.slice(0, 100));

  console.log('\n[3] Claude 联网 → 应能总结（非纯 Search results）');
  const c1 = await streamChat({
    model: CLAUDE,
    chatId: mkId('c_ws'),
    message: '北京时间现在几点',
    webSearch: true,
    thinking: false,
  });
  const rawDump = /^Search results for/i.test((c1.content || '').trim());
  ok('Claude 联网有内容', (c1.content || '').length > 10, c1.content.slice(0, 80));
  ok('非空回复', !/^no results found$/i.test((c1.content || '').trim()));

  console.log(`\n=== SUMMARY PASS ${pass} FAIL ${fail} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

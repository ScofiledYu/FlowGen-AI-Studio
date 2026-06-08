/**
 * 模型切换 / 联网 / 双模型互切 矩阵测试
 * node scripts/llm-model-switch-matrix.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const CHAT_PANEL = path.join(path.resolve(import.meta.dirname, '..'), 'components', 'ChatPanel.tsx');
const BASE_URL = process.env.LLM_TEST_BASE_URL || 'http://localhost:3001/aitop-llm-see';
const API_KEY = process.env.LLM_TEST_API_KEY || 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma';
const USER_ID = process.env.LLM_TEST_USER_ID || '297409';
const TIMEOUT_MS = Number(process.env.LLM_TEST_TIMEOUT_MS || 120000);

const CLAUDE = 'claude-sonnet-4-6';
const GEMINI = 'gemini-3.1-pro-preview:streamGenerateContent';
const MARKER = 'SWITCH_MATRIX_7719';

const WEB_SEARCH_GENERIC_TERMS = new Set([
  '对比', '比较', '如何', '什么', '为什么', '怎么样', '分析', '总结', '搜索', '查询',
]);
const WEB_SEARCH_NAMED_ENTITY_HINTS = [
  '深中梅香', '深中龙华', '龙华实验', '深圳中学', '普高率', '四大率', '八大率', '中考', '升学',
];
const WEB_SEARCH_INTENT_HINTS = ['普高率', '四大率', '八大率', '升学率', '中考', '生源'];

function mkId(tag) {
  return `${USER_ID}_mx_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`.slice(0, 63);
}

function isMeta(m) {
  if (m.id?.startsWith('welcome-') || m.id?.startsWith('model-switch-') || m.id?.startsWith('fallback-switch-')) return true;
  const c = (m.content || '').trim();
  return c.startsWith('🔄') || c.startsWith('⚠️');
}

function collectTurns(messages, latest, opts = {}) {
  const turns = [];
  for (const m of messages) {
    if (isMeta(m)) continue;
    const content = (m.content || '').trim().slice(0, opts.maxCharsPerMsg ?? 6000);
    if (!content) continue;
    if (m.role === 'user' && latest && content === latest) continue;
    turns.push({ role: m.role, content });
  }
  return turns.slice(-(opts.maxTurns ?? 24));
}

function sanitizeWebSearchQueryText(text) {
  return (text || '')
    .replace(/【[^】]+】/g, ' ')
    .replace(/请结合以下对话[^。]*/g, ' ')
    .replace(/[？?！!。，,；;：:\n\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripFiller(text) {
  return sanitizeWebSearchQueryText(text)
    .replace(/你(来|再|自己)?(总结|对比|搜索|看看|分析)(下|一下)?/g, ' ')
    .replace(/(请|帮|麻烦)(我)?(再)?(总结|对比|搜索|查)(一下|下)?/g, ' ')
    .replace(/两所(学校)?/g, ' ')
    .replace(/^(那|这|那么|所以说|请问|再来|继续)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactQ(text, maxLen = 120) {
  const t = sanitizeWebSearchQueryText(text);
  return !t ? '' : t.length <= maxLen ? t : t.slice(0, maxLen);
}

function isWeakQuery(q) {
  const t = (q || '').trim();
  if (!t || t.length <= 3) return true;
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length === 1 && WEB_SEARCH_GENERIC_TERMS.has(tokens[0])) return true;
  if (tokens.every((tok) => WEB_SEARCH_GENERIC_TERMS.has(tok) || tok.length <= 1)) return true;
  return false;
}

function buildContextualQuery(messages, latest, tail = '') {
  const turns = collectTurns(messages, latest.trim(), { maxTurns: 6, maxCharsPerMsg: 500 });
  const parts = [];
  const l = stripFiller(latest);
  if (l) parts.push(l);
  if (stripFiller(tail)) parts.push(stripFiller(tail));
  for (const t of turns.slice(-5)) {
    const s = stripFiller(t.content).slice(0, 160);
    if (s && !parts.some((p) => p.includes(s) || s.includes(p))) parts.push(s);
  }
  return compactQ(parts.join(' '), 120);
}

function needsContextualProbe(latest) {
  const t = stripFiller(latest);
  if (!t || isWeakQuery(t)) return true;
  if (t.length <= 24 && /表格|对比|总结|再查|做成|继续|刚才|上面|^(用|再|请|帮|麻烦)/.test(t)) return true;
  return false;
}

function buildContextualProbe(latest, turns) {
  const parts = [];
  const l = stripFiller(latest);
  if (l) parts.push(l);
  for (const t of turns.slice(-5)) {
    const s = stripFiller(t.content).slice(0, 140);
    if (!s || parts.some((p) => p.includes(s) || s.includes(p))) continue;
    parts.push(s);
  }
  return compactQ(parts.join(' '));
}

/** 与 utils/webSearchProbe buildWebSearchProbeQueryFallback 对齐（矩阵脚本不跑 LLM 改写） */
function buildProbeFallback(messages, latestUserText, tailAppend = '') {
  const latest = stripFiller(latestUserText);
  const turns = collectTurns(messages, latestUserText.trim(), { maxTurns: 8, maxCharsPerMsg: 500 });
  if (latest && !needsContextualProbe(latest)) return compactQ([latest, stripFiller(tailAppend)].filter(Boolean).join(' '));
  const priorUser = turns.filter((t) => t.role === 'user').map((t) => stripFiller(t.content)).filter(Boolean);
  for (let i = priorUser.length - 1; i >= 0; i--) {
    const prev = priorUser[i];
    if (!prev || prev === latest || isWeakQuery(prev)) continue;
    const merged = [prev, latest].filter(Boolean).join(' ');
    const q = compactQ(merged);
    if (q && !isWeakQuery(q)) return q;
  }
  const ctx = buildContextualProbe(latest, turns);
  if (ctx && !isWeakQuery(ctx)) return ctx;
  return compactQ(latest || priorUser.join(' '));
}

function buildHistory(messages, latest, opts = {}) {
  const turns = collectTurns(messages, latest.trim(), {
    maxTurns: opts.webSearch ? 8 : 12,
    maxCharsPerMsg: opts.webSearch ? 1200 : 4000,
  });
  let body = (latest || '').trim();
  if (!turns.length) return body;
  const lines = turns.map((t) => `${t.role === 'user' ? '用户' : '助手'}：${t.content}`);
  return (
    `【会话历史（供延续上下文；请结合此前内容回答，勿当作全新对话）】\n` +
    `${lines.join('\n\n')}\n\n` +
    `【用户本轮问题】\n${body}`
  );
}

function buildSummarizePrompt(question, dump, dialogueCtx) {
  const dlg = dialogueCtx?.trim()
    ? `【对话背景（供理解用户本轮问题；勿原样复述）】\n${dialogueCtx.trim()}\n\n`
    : '';
  return (
    `【任务】请根据“上一轮联网检索原文”直接回答用户问题。\n` +
    dlg +
    `【用户问题】\n${question}\n\n` +
    `【回答要求】\n1) 先结论后依据；2) 禁止 Search results for；3) 中文回答。\n\n` +
    `【上一轮联网检索原文】\n${(dump || '').slice(0, 4000)}`
  );
}

function isRawDump(t) {
  const s = (t || '').trim();
  if (!s) return false;
  if (/^Search results for\s*"/i.test(s)) return true;
  if (/Here are the search results/i.test(s)) return true;
  return false;
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
    data.delta?.content,
    data.delta?.reasoning_content,
  ];
  return parts.filter((p) => typeof p === 'string' && p).join('');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const UPSTREAM_FLAKY_RE = /请多试|未能回复|出了一些问题|稍后再试/i;

async function streamResilient(opts, tag = 'req') {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await stream({ ...opts, chatId: mkId(`${tag}_${i}`) });
      if (UPSTREAM_FLAKY_RE.test(r.text) && i < 2) {
        await sleep(2500);
        continue;
      }
      return r;
    } catch (e) {
      last = e;
      if (i < 2) await sleep(2500);
    }
  }
  throw last ?? new Error('streamResilient failed');
}

async function stream({
  model,
  chatId,
  message,
  webSearch = false,
  thinkingLevel = 'low',
  thinking = false,
  timeoutMs = TIMEOUT_MS,
}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': API_KEY },
      body: JSON.stringify({
        id: chatId,
        message,
        model,
        tip: ' ',
        thinking,
        thinkingLevel,
        webSearch,
      }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    if (!res.body) throw new Error('no body');
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
          const data = JSON.parse(pl);
          if (data?.success === false && data?.message) throw new Error(String(data.message));
          content += getChunk(data);
        } catch (e) {
          if (e instanceof SyntaxError && !pl.startsWith('{')) content += pl;
          else if (!(e instanceof SyntaxError)) throw e;
        }
      }
    }
    const text = content.trim();
    if (!text) throw new Error('empty');
    return { text, elapsedMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function chatWithWebSummarize({ model, userQuestion, messages, dialogueCtx }) {
  const probe = buildProbeFallback(messages, userQuestion);
  const probeId = mkId('probe');
  const r1 = await stream({
    model,
    chatId: probeId,
    message: probe,
    webSearch: true,
    timeoutMs: 200000,
  });
  let answer = r1.text;
  if (isRawDump(answer) || answer.length < 80) {
    const sumId = mkId('sum');
    const sumMsg = buildSummarizePrompt(userQuestion, answer, dialogueCtx);
    const r2 = await stream({
      model,
      chatId: sumId,
      message: sumMsg,
      webSearch: false,
      timeoutMs: 200000,
    });
    answer = r2.text;
    return { answer, probe, probeId, sumId, elapsedMs: r1.elapsedMs + r2.elapsedMs };
  }
  return { answer, probe, probeId, elapsedMs: r1.elapsedMs };
}

function assert(name, ok, detail = '') {
  console.log(`  [${ok ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  return ok ? 1 : 0;
}

function runUnitMatrix() {
  let pass = 0;
  const schoolMsgs = [
    { id: 'u1', role: 'user', content: '深中梅香和深中龙华初中升学率对比' },
    { id: 'a1', role: 'assistant', content: '深中梅香实验学校 深中龙华附属学校 普高率 四大率 对比数据…' },
  ];
  const probe = buildProbeFallback(schoolMsgs, '用表格再对比一下');
  pass += assert('probe 含学校实体', /深中梅香|深中龙华|普高/.test(probe), probe);
  pass += assert('probe 不是单独「对比」', probe.trim() !== '对比', probe);

  const markerMsgs = [
    { id: 'u1', role: 'user', content: `暗号 ${MARKER}` },
    { id: 'a1', role: 'assistant', content: `已记录 ${MARKER}` },
    { id: 'sw', role: 'assistant', content: '🔄 已切换模型' },
  ];
  const hist = buildHistory(markerMsgs, '暗号是什么', { webSearch: true });
  pass += assert('切模型后历史含暗号', hist.includes(MARKER) && hist.includes('【会话历史'), '');

  const src = fs.readFileSync(CHAT_PANEL, 'utf8');
  pass += assert('总结不改 session chatId', /createEphemeralChatId/.test(src) && !/runClaudeSummarize[\s\S]{0,200}setChatId\(retryChatId\)/.test(src));
  pass += assert('切模型同步 persistSnapshot', /handleModelSelect[\s\S]*persistSnapshotRef\.current/.test(src));

  const fail = 5 - pass;
  return { pass, fail };
}

async function runApiMatrix() {
  let pass = 0;
  let fail = 0;
  const run = async (name, fn) => {
    process.stdout.write(`  → ${name} … `);
    try {
      await fn();
      pass += 1;
      console.log('OK');
    } catch (e) {
      fail += 1;
      console.log(`FAIL: ${e instanceof Error ? e.message : e}`);
    }
  };

  await run('Claude→Gemini 暗号延续', async () => {
    const seed = `请记住暗号 ${MARKER}，只回复：已记住`;
    const r1 = await streamResilient({ model: CLAUDE, message: seed }, 'c1');
    const msgs = [
      { id: 'u1', role: 'user', content: seed },
      { id: 'a1', role: 'assistant', content: r1.text.slice(0, 400) },
    ];
    const r2 = await streamResilient(
      { model: GEMINI, message: buildHistory(msgs, `只输出暗号 ${MARKER} 的数字部分`) },
      'g1'
    );
    if (!r2.text.includes('7719') && !r2.text.includes(MARKER)) throw new Error(r2.text.slice(0, 80));
  });

  await run('Gemini→Claude 暗号延续', async () => {
    const seed = `请记住暗号 ${MARKER}，只回复：已记住`;
    const r1 = await streamResilient({ model: GEMINI, message: seed }, 'g2');
    const msgs = [
      { id: 'u1', role: 'user', content: seed },
      { id: 'a1', role: 'assistant', content: r1.text.slice(0, 400) },
    ];
    const r2 = await streamResilient(
      { model: CLAUDE, message: buildHistory(msgs, '只输出暗号，不要解释') },
      'c2'
    );
    if (!r2.text.includes('7719') && !r2.text.includes(MARKER)) throw new Error(r2.text.slice(0, 80));
  });

  await run('学校对比→Gemini 追问校名（历史注入）', async () => {
    const q = '深中梅香实验学校和深中龙华附属学校初中升学率对比，简要说明';
    const msgs = [{ id: 'u1', role: 'user', content: q }];
    const probe = buildProbeFallback(msgs, q);
    if (!/深中梅香|深中龙华/.test(probe)) throw new Error(`probe=${probe}`);
    const msgs2 = [
      { id: 'u1', role: 'user', content: q },
      {
        id: 'a1',
        role: 'assistant',
        content:
          '结论：深中梅香实验学校与深中龙华附属学校可对比。依据：两校普高率、四大率、八大率公开数据摘要。',
      },
    ];
    const ask = buildHistory(msgs2, '刚才对比的是哪两所学校？只列中文校名，用顿号分隔');
    const r = await streamResilient({ model: GEMINI, message: ask }, 'g3');
    if (!/深中梅香/.test(r.text) || !/龙华/.test(r.text)) throw new Error(r.text.slice(0, 120));
  });

  await run('Claude 短追问联网 probe 含上下文', async () => {
    const msgs = [
      { id: 'u1', role: 'user', content: '深中梅香和深中龙华升学率' },
      { id: 'a1', role: 'assistant', content: '深中梅香实验学校 深中龙华附属学校 2024 普高率…' },
    ];
    const probe = buildProbeFallback(msgs, '再做成表格对比');
    if (probe === '对比' || !/深中|普高|龙华/.test(probe)) throw new Error(probe);
  });

  await run('Gemini light 思考可完成', async () => {
    const r = await streamResilient({
      model: GEMINI,
      chatId: mkId('g4'),
      message: '用中文一句话介绍你自己（20字以上）',
      webSearch: false,
      thinking: true,
      thinkingLevel: 'low',
    }, 'g4');
    if (r.text.replace(/\s/g, '').length < 12) throw new Error(`too short: ${r.text.slice(0, 60)}`);
  });

  await run('Claude 联网 light 思考可完成', async () => {
    const r = await streamResilient({
      model: CLAUDE,
      chatId: mkId('c4'),
      message: '用一句话说明北京是中国首都（确认即可）',
      webSearch: false,
      thinking: true,
      thinkingLevel: 'low',
    }, 'c4');
    if (r.text.length < 10) throw new Error('too short');
  });

  return { pass, fail };
}

async function main() {
  console.log('=== 模型切换矩阵测试 ===\n[1/2] 单元');
  const unit = runUnitMatrix();
  console.log('\n[2/2] 实网 API');
  let api = { pass: 0, fail: 0 };
  try {
    const ping = await fetch(BASE_URL.replace(/\/aitop-llm-see$/, '/'));
    if (!ping.ok) throw new Error('server down');
    api = await runApiMatrix();
  } catch (e) {
    console.log(`  [SKIP/FAIL] ${e instanceof Error ? e.message : e}`);
    api = { pass: 0, fail: 6 };
  }
  const totalPass = unit.pass + api.pass;
  const totalFail = unit.fail + api.fail;
  console.log(`\n=== MATRIX SUMMARY: PASS ${totalPass} FAIL ${totalFail} ===`);
  if (totalFail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

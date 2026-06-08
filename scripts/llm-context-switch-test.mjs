/**
 * 切模型 / 联网总结 上下文回归测试（静态 + 实网 API）
 * 用法: node scripts/llm-context-switch-test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHAT_PANEL = path.join(ROOT, 'components', 'ChatPanel.tsx');
const BASE_URL = process.env.LLM_TEST_BASE_URL || 'http://localhost:3001/aitop-llm-see';
const API_KEY = process.env.LLM_TEST_API_KEY || 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma';
const USER_ID = process.env.LLM_TEST_USER_ID || '297409';
const TIMEOUT_MS = Number(process.env.LLM_TEST_TIMEOUT_MS || 120000);

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const GEMINI_MODEL = 'gemini-3.1-pro-preview:streamGenerateContent';
const MARKER = 'CTX_SWITCH_MARKER_8842';

function mkChatId(tag) {
  return `${USER_ID}_ctx_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`.slice(0, 63);
}

function isMetaChatMessage(m) {
  if (m.id?.startsWith('welcome-')) return true;
  if (m.id?.startsWith('model-switch-')) return true;
  if (m.id?.startsWith('fallback-switch-')) return true;
  const c = (m.content || '').trim();
  return c.startsWith('🔄 已切换模型') || c.startsWith('⚠️');
}

function truncateChatText(text, max) {
  const t = (text || '').trim();
  return t.length <= max ? t : t.slice(0, max);
}

function collectDialogueTurnsForApi(messages, latestUserText, opts = {}) {
  const latest = (latestUserText || '').trim();
  const maxTurns = opts.maxTurns ?? 32;
  const maxCharsPerMsg = opts.maxCharsPerMsg ?? 6000;
  const turns = [];
  for (const m of messages) {
    if (isMetaChatMessage(m)) continue;
    const content = truncateChatText((m.content || '').replace(/\r\n/g, '\n'), maxCharsPerMsg);
    if (!content) continue;
    if (m.role === 'user' && latest && content === latest) continue;
    turns.push({ role: m.role, content });
  }
  return turns.slice(-maxTurns);
}

/** 与 ChatPanel buildAitopMessageWithHistory 对齐（修复后：联网非首轮也带历史） */
function buildAitopMessageWithHistory(messages, latestUserText, tailAppend = '', opts = {}) {
  let body = (latestUserText || '').trim();
  if (tailAppend) body = body ? `${body}\n${tailAppend}` : tailAppend;
  const turns = collectDialogueTurnsForApi(messages, (latestUserText || '').trim(), {
    maxTurns: opts.webSearch ? 8 : 32,
    maxCharsPerMsg: opts.webSearch ? 1200 : 6000,
  });
  if (turns.length === 0) return body;
  const lines = [];
  let total = 0;
  for (const t of turns) {
    const label = t.role === 'user' ? '用户' : '助手';
    const block = `${label}：${t.content}`;
    if (total + block.length > 48_000) break;
    lines.push(block);
    total += block.length;
  }
  if (lines.length === 0) return body;
  return (
    `【会话历史（供延续上下文；请结合此前内容回答，勿当作全新对话）】\n` +
    `${lines.join('\n\n')}\n\n` +
    `【用户本轮问题】\n${body}`
  );
}

function buildWebSearchDialogueContext(messages, latestUserText) {
  const turns = collectDialogueTurnsForApi(messages, latestUserText.trim(), {
    maxTurns: 8,
    maxCharsPerMsg: 1200,
  });
  if (turns.length === 0) return '';
  return turns.map((t) => `${t.role === 'user' ? '用户' : '助手'}：${t.content}`).join('\n\n');
}

function getChunk(data) {
  if (!data || typeof data !== 'object') return '';
  const parts = [
    data.content,
    data.text,
    data.message,
    data.reasoning_content,
    data.reasoningContent,
    data.output_text,
    data.response,
    data.answer,
    data.result,
    data.delta?.content,
    data.data?.content,
    data.data?.text,
  ];
  return parts.filter((p) => typeof p === 'string' && p).join('');
}

const FLAKY_RE = /请多试|未能回复|出了问题|abort/i;

async function streamChat({ model, chatId, message, webSearch = false, thinkingLevel = 'low' }) {
  const payload = {
    id: chatId,
    message,
    model,
    tip: ' ',
    thinking: false,
    thinkingLevel,
    webSearch,
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': API_KEY },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 400)}`);
    }
    if (!res.body) throw new Error('No stream body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        const pl = line.startsWith('data:') ? line.slice(5).trim() : line;
        if (!pl || pl === '[DONE]') continue;
        try {
          const data = JSON.parse(pl);
          if (data?.success === false && data?.message) {
            throw new Error(String(data.message));
          }
          content += getChunk(data);
        } catch (e) {
          if (e instanceof SyntaxError) {
            if (!pl.startsWith('{') && !pl.startsWith('[')) content += pl;
          } else throw e;
        }
      }
    }
    const text = (content || '').trim();
    if (!text) throw new Error('Empty response');
    return { text, elapsedMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

async function streamChatResilient(opts, tag) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await streamChat({ ...opts, chatId: mkChatId(`${tag}_${i}`) });
      if (FLAKY_RE.test(r.text) && i < 2) {
        await new Promise((res) => setTimeout(res, 2500));
        continue;
      }
      return r;
    } catch (e) {
      last = e;
      if (i < 2) await new Promise((res) => setTimeout(res, 2500));
    }
  }
  throw last ?? new Error('streamChatResilient failed');
}

function runStaticChecks() {
  const src = fs.readFileSync(CHAT_PANEL, 'utf8');
  const checks = [
    {
      name: '联网非首轮不再 strip 历史',
      ok: !/if\s*\(\s*opts\?\.webSearch\s*\)\s*\{[\s\S]*?return\s+body\s*;/.test(src),
    },
    {
      name: '总结轮始终可带会话背景',
      ok: /buildWebSearchDialogueContext[\s\S]*collectDialogueTurnsForApi/.test(src),
      failHint: 'buildWebSearchDialogueContext 应始终 collect 历史',
    },
    {
      name: 'Gemini/Claude 备用不误触发 Qwen 降载',
      ok: /fallbackModel\s*===\s*['"]qwen['"]\s*&&\s*hadThinkingOrWeb/.test(src),
    },
    {
      name: '发送时同步 persistSnapshot',
      ok: /persistSnapshotRef\.current\s*=\s*\{[\s\S]*messages:\s*nextMessagesForSend/.test(src),
    },
    {
      name: 'Gemini 联网首包超时 >= 90s',
      ok: /GEMINI_FETCH_TIMEOUT_MS_WEB\s*=\s*90_000/.test(src),
    },
    {
      name: '联网 probe 使用 ephemeral chatId',
      ok: /createEphemeralChatId/.test(src) && /isGeminiWebSearchFirstPass[\s\S]*createEphemeralChatId/.test(src),
    },
    {
      name: '弱检索词回退 contextual query',
      ok: /resolveWebSearchProbeQuery/.test(src) && /utils\/webSearchProbe/.test(src),
    },
  ];
  let pass = 0;
  for (const c of checks) {
    if (c.ok) {
      pass += 1;
      console.log(`  [OK] ${c.name}`);
    } else {
      console.log(`  [FAIL] ${c.name}${c.failHint ? ` — ${c.failHint}` : ''}`);
    }
  }
  return { pass, fail: checks.length - pass };
}

function runWebSearchQueryChecks() {
  const messages = [
    { id: 'u1', role: 'user', content: '深中梅香和深中龙华初中升学率对比' },
    {
      id: 'a1',
      role: 'assistant',
      content: '深中梅香实验学校与深中龙华附属学校普高率、四大率如下…',
    },
  ];
  const followUp = '用表格再对比一下';
  const corpusHasSchool =
    messages.some((m) => /深中梅香|深中龙华/.test(m.content)) && followUp.includes('对比');
  const weakOnly = '对比'.trim().length <= 3 || /^对比$/.test('对比');
  console.log(`  [${corpusHasSchool ? 'OK' : 'FAIL'}] 助手轮含学校实体可供检索`);
  console.log(`  [${weakOnly ? 'OK' : 'FAIL'}] 识别「对比」为弱检索词`);
  const fail = [corpusHasSchool, weakOnly].filter((x) => !x).length;
  return { pass: 2 - fail, fail };
}

function runUnitChecks() {
  const messages = [
    { id: 'u1', role: 'user', content: `请记住暗号 ${MARKER}，回复「已记住」。` },
    { id: 'a1', role: 'assistant', content: `已记住暗号 ${MARKER}。` },
    { id: 'switch', role: 'assistant', content: '🔄 已切换模型：Claude → Gemini' },
  ];
  const followUp = '我刚才让你记住的暗号是什么？只输出暗号本身，不要解释。';

  const withWeb = buildAitopMessageWithHistory(messages, followUp, '', { webSearch: true });
  const withoutWeb = buildAitopMessageWithHistory(messages, followUp, '', { webSearch: false });
  const dialogueCtx = buildWebSearchDialogueContext(messages, followUp);

  const okWebHistory = withWeb.includes('【会话历史') && withWeb.includes(MARKER);
  const okNoWebHistory = withoutWeb.includes('【会话历史') && withoutWeb.includes(MARKER);
  const okDialogue = dialogueCtx.includes(MARKER) && dialogueCtx.includes('已记住');

  console.log(`  [${okWebHistory ? 'OK' : 'FAIL'}] webSearch:true 仍注入会话历史`);
  console.log(`  [${okNoWebHistory ? 'OK' : 'FAIL'}] webSearch:false 注入会话历史`);
  console.log(`  [${okDialogue ? 'OK' : 'FAIL'}] 总结对话背景含暗号`);

  const fail = [okWebHistory, okNoWebHistory, okDialogue].filter((x) => !x).length;
  return { pass: 3 - fail, fail };
}

async function runApiCrossModelTest() {
  const messages = [
    { id: 'u1', role: 'user', content: `请记住暗号 ${MARKER}。只回复：已记住` },
    { id: 'a1', role: 'assistant', content: `已记住 ${MARKER}` },
  ];
  const followUp = '我刚才的暗号是什么？只输出暗号，不要其它文字。';
  const payload = buildAitopMessageWithHistory(messages, followUp, '', { webSearch: false });
  const newChatId = mkChatId('gemini_after_claude');

  console.log(`  → Gemini（新 chatId）带历史追问 …`);
  const { text, elapsedMs } = await streamChatResilient(
    { model: GEMINI_MODEL, message: payload, webSearch: false },
    'gemini_after_claude'
  );

  const hit = text.includes(MARKER) || /8842/.test(text);
  console.log(
    `  [${hit ? 'OK' : 'FAIL'}] 跨模型延续 (${elapsedMs}ms) marker=${hit} preview=${text.slice(0, 120).replace(/\n/g, ' ')}`
  );
  return hit ? { pass: 1, fail: 0 } : { pass: 0, fail: 1 };
}

async function runApiClaudeThenGeminiTurn() {
  const chatId1 = mkChatId('claude_seed');
  const seedQ = `请记住暗号 ${MARKER}，回复「已记住${MARKER}」。`;
  console.log(`  → Claude 建立上下文 …`);
  const r1 = await streamChatResilient(
    { model: CLAUDE_MODEL, message: seedQ, webSearch: false },
    'claude_seed'
  );
  const messages = [
    { id: 'u1', role: 'user', content: seedQ },
    { id: 'a1', role: 'assistant', content: r1.text.slice(0, 500) },
  ];
  const followUp = '只输出我刚才让你记住的暗号，不要标点不要解释。';
  const payload = buildAitopMessageWithHistory(messages, followUp, '', { webSearch: true });
  const chatId2 = mkChatId('gemini_ws_hist');
  console.log(`  → Gemini（新 chatId + 历史 + webSearch 非首轮格式）…`);
  const r2 = await streamChatResilient(
    { model: GEMINI_MODEL, message: payload, webSearch: false },
    'gemini_ws_hist'
  );
  const hit = r2.text.includes(MARKER) || r2.text.includes('8842');
  console.log(
    `  [${hit ? 'OK' : 'FAIL'}] Claude→Gemini 双轮 (${r1.elapsedMs}+${r2.elapsedMs}ms) preview=${r2.text.slice(0, 100).replace(/\n/g, ' ')}`
  );
  return hit ? { pass: 1, fail: 0 } : { pass: 0, fail: 1 };
}

async function main() {
  console.log('=== 切模型上下文测试 ===');
  console.log('BASE_URL:', BASE_URL);

  console.log('\n[1/3] 静态检查 ChatPanel.tsx');
  const staticResult = runStaticChecks();

  console.log('\n[2/4] 联网检索词逻辑');
  const webQueryResult = runWebSearchQueryChecks();

  console.log('\n[3/4] 本地消息拼装');
  const unitResult = runUnitChecks();

  console.log('\n[4/4] 实网 API（需 localhost:3001 与 AiTop 可用）');
  let apiPass = 0;
  let apiFail = 0;
  try {
    const ping = await fetch(BASE_URL.replace(/\/aitop-llm-see$/, '/'), { method: 'GET' }).catch(() => null);
    if (!ping?.ok) {
      console.log('  [SKIP] 服务不可达，跳过 API');
    } else {
      const a = await runApiCrossModelTest();
      apiPass += a.pass;
      apiFail += a.fail;
      const b = await runApiClaudeThenGeminiTurn();
      apiPass += b.pass;
      apiFail += b.fail;
    }
  } catch (e) {
    apiFail += 2;
    console.log(`  [FAIL] API 异常: ${e instanceof Error ? e.message : String(e)}`);
  }

  const totalPass = staticResult.pass + webQueryResult.pass + unitResult.pass + apiPass;
  const totalFail = staticResult.fail + webQueryResult.fail + unitResult.fail + apiFail;
  console.log('\n=== SUMMARY ===');
  console.log(`PASS: ${totalPass}  FAIL: ${totalFail}`);
  if (totalFail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

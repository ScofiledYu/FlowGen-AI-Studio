/** 校验 ChatPanel 中大 payload 超时与 Qwen max_tokens 逻辑（纯数学，不调用 API） */

const QWEN_MAX_CHAT = 8192;
const QWEN_MAX_SKILL = 32768;
const CLAUDE_FETCH = 35_000;
const GEMINI_FETCH = 25_000;
const STREAM_IDLE = 60_000;
const STREAM_DEEP = 120_000;
const HEAVY_FETCH_CAP = 120_000;
const HEAVY_STREAM_CAP = 180_000;

function mult(n) {
  if (n >= 30_000) return 2.5;
  if (n >= 15_000) return 2;
  if (n >= 8_000) return 1.5;
  return 1;
}

function fetchTimeout(model, payloadLen) {
  const base = model === 'claude' ? CLAUDE_FETCH : GEMINI_FETCH;
  const m = mult(payloadLen);
  if (m <= 1) return base;
  return Math.min(Math.round(base * m), HEAVY_FETCH_CAP);
}

function streamIdle(thinkingDeep, payloadLen) {
  const base = thinkingDeep ? STREAM_DEEP : STREAM_IDLE;
  const m = mult(payloadLen);
  if (m <= 1) return base;
  return Math.min(Math.round(base * m), HEAVY_STREAM_CAP);
}

function qwenMaxTokens({ skillActive, userTextLen, fromFallback, lightweight }) {
  if (lightweight) return 2048;
  if (fromFallback || skillActive || userTextLen >= 3000) return QWEN_MAX_SKILL;
  return QWEN_MAX_CHAT;
}

let failed = 0;
function ok(name, cond) {
  if (!cond) {
    console.error('FAIL:', name);
    failed++;
  } else {
    console.log('ok:', name);
  }
}

// 20k payload（Skill+长剧本）应比默认 60s/35s 更长，且 deep 模式不应被压到 90s
ok('claude fetch 20k >= 70s', fetchTimeout('claude', 20_000) >= 70_000);
ok('claude stream 20k >= 120s', streamIdle(false, 20_000) >= 120_000);
ok('claude stream deep 20k >= 120s', streamIdle(true, 20_000) >= 120_000);
ok('claude stream deep 20k <= 180s cap', streamIdle(true, 20_000) <= HEAVY_STREAM_CAP);

// 小 payload 保持原样
ok('small payload fetch unchanged', fetchTimeout('claude', 1000) === CLAUDE_FETCH);
ok('small payload stream unchanged', streamIdle(false, 1000) === STREAM_IDLE);

// Qwen：Skill + 长输入 / fallback 应用 32768
ok('skill long input max_tokens', qwenMaxTokens({ skillActive: true, userTextLen: 12964, fromFallback: false, lightweight: false }) === QWEN_MAX_SKILL);
ok('fallback max_tokens', qwenMaxTokens({ skillActive: false, userTextLen: 100, fromFallback: true, lightweight: false }) === QWEN_MAX_SKILL);
ok('short chat max_tokens', qwenMaxTokens({ skillActive: false, userTextLen: 50, fromFallback: false, lightweight: false }) === QWEN_MAX_CHAT);

if (failed) process.exit(1);
console.log('chat-payload-limits-test: all passed');

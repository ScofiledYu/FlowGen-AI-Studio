const BASE_URL = process.env.LLM_TEST_BASE_URL || 'http://localhost:3001/aitop-llm-see';
const API_KEY = process.env.LLM_TEST_API_KEY || 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma';
const USER_ID = process.env.LLM_TEST_USER_ID || '297409';
const TIMEOUT_MS = Number(process.env.LLM_TEST_TIMEOUT_MS || 70000);
const ROUNDS = Number(process.env.LLM_TEST_ROUNDS || 3);

const MODELS = [
  { id: 'gemini', name: 'gemini-3.1-pro-preview:streamGenerateContent' },
  { id: 'claude', name: 'claude-sonnet-4-6' },
];

const FALLBACK_RE = /(系统繁忙|稍后再试|认证异常|upstream|gateway timeout|请稍后重试|重试几次|服务异常)/i;

function createLargeCorpus() {
  const rows = [];
  for (let i = 1; i <= 180; i += 1) {
    rows.push(
      `record_${String(i).padStart(3, '0')} | user=u${(i % 23) + 1} | region=${['CN', 'US', 'EU', 'JP'][i % 4]} | ` +
        `qps=${(100 + i * 7) % 997} | latency_p95=${(120 + i * 11) % 1800}ms | ` +
        `error_rate=${((i % 19) * 0.13).toFixed(2)}% | note=${'x'.repeat(40)}`
    );
  }
  return rows.join('\n');
}

function buildPrompt(round, modelId, corpus) {
  return [
    `你是稳定性分析助手。当前回合=${round}，模型=${modelId}。`,
    '下面是大量系统日志样本，请你仅返回三部分：',
    '1) 风险摘要（3条）',
    '2) 关键异常Top5（按严重度）',
    '3) 下一轮要保留的压缩记忆（不超过120字）',
    '',
    '日志样本：',
    corpus,
    '',
    `补充要求：输出必须包含标记 [ROUND_${round}_OK]。`,
  ].join('\n');
}

function getChunk(data) {
  if (!data || typeof data !== 'object') return '';
  return (
    data.content ||
    data.text ||
    data.message ||
    data.output_text ||
    data.response ||
    data.answer ||
    data.result ||
    data.delta?.content ||
    data.data?.content ||
    data.data?.text ||
    ''
  );
}

async function sendOnce({ model, chatId, prompt, round }) {
  const payload = {
    id: chatId,
    message: prompt,
    model,
    tip: ' ',
    thinking: false,
    thinkingLevel: 'low',
    webSearch: false,
  };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const startAt = Date.now();
  let firstChunkAt = 0;
  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': API_KEY,
      },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 500)}`);
    }
    if (!res.body) {
      throw new Error('No response body stream');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let rawTail = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!firstChunkAt) firstChunkAt = Date.now();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const payloadLine = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
        if (!payloadLine || payloadLine === '[DONE]') continue;
        try {
          const data = JSON.parse(payloadLine);
          if (data && typeof data === 'object' && data.success === false && data.message) {
            throw new Error(`Upstream failed: ${String(data.message)}`);
          }
          fullText += getChunk(data);
        } catch {
          rawTail += payloadLine;
        }
      }
    }

    if (!fullText.trim() && rawTail.trim()) {
      fullText = rawTail;
    }
    if (!fullText.trim()) {
      throw new Error('Empty response content');
    }
    if (FALLBACK_RE.test(fullText)) {
      throw new Error(`Fallback-like response detected: ${fullText.slice(0, 200)}`);
    }
    if (!fullText.includes(`[ROUND_${round}_OK]`)) {
      throw new Error('Missing required round marker, response likely unstable');
    }
    return {
      elapsedMs: Date.now() - startAt,
      firstTokenMs: firstChunkAt ? firstChunkAt - startAt : -1,
      chars: fullText.length,
      preview: fullText.slice(0, 120),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runModel(model) {
  const chatId = `${USER_ID}_codex_${model.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`.slice(0, 63);
  const corpus = createLargeCorpus();
  console.log(`\n=== ${model.id.toUpperCase()} stress test start (chatId=${chatId}) ===`);
  for (let round = 1; round <= ROUNDS; round += 1) {
    const prompt = buildPrompt(round, model.id, corpus);
    const result = await sendOnce({
      model: model.name,
      chatId,
      prompt,
      round,
    });
    console.log(
      `[${model.id}] round=${round} ok elapsed=${result.elapsedMs}ms firstToken=${result.firstTokenMs}ms chars=${result.chars}`
    );
  }
  console.log(`=== ${model.id.toUpperCase()} stress test passed ===`);
}

async function main() {
  const started = Date.now();
  for (const model of MODELS) {
    await runModel(model);
  }
  console.log(`\nALL PASSED in ${Date.now() - started}ms`);
}

main().catch((err) => {
  console.error('\nSTRESS TEST FAILED');
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});

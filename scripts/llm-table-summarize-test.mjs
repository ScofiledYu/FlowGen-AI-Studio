const BASE_URL = process.env.LLM_TEST_BASE_URL || 'http://localhost:3001/aitop-llm-see';
const API_KEY = process.env.LLM_TEST_API_KEY || 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma';
const USER_ID = process.env.LLM_TEST_USER_ID || '297409';
const TIMEOUT_MS = Number(process.env.LLM_TEST_TIMEOUT_MS || 95000);
const MODEL = 'claude-sonnet-4-6';
const QUESTION = process.env.LLM_TEST_QUESTION || '你用表格对比下龙华实验和深中梅香学校';

function summarizePrompt(question, dump, compact = false) {
  const max = compact ? 2200 : 4000;
  const src = String(dump || '').trim().slice(0, max);
  return (
    `【任务】请根据上一轮联网检索原文直接回答用户问题。\n` +
    `【用户问题】\n${question}\n\n` +
    `【要求】\n` +
    `1) 先结论再 2-4 条依据；\n` +
    `2) 用户要求对比时请用 Markdown 表格；\n` +
    `3) 禁止输出 Search results for / I'll search for。\n\n` +
    `【上一轮联网检索原文】\n${src}`
  );
}

function getChunk(data) {
  if (!data || typeof data !== 'object') return '';
  return data.content || data.text || data.message || '';
}

async function stream(payload, label) {
  const startedAt = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': API_KEY },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`${label} HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    if (!res.body) throw new Error(`${label}: no body`);

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
        const payloadLine = line.startsWith('data:') ? line.slice(5).trim() : line;
        if (!payloadLine || payloadLine === '[DONE]') continue;
        try {
          content += getChunk(JSON.parse(payloadLine));
        } catch {
          /* ignore */
        }
      }
    }

    const finalText = content.trim();
    if (!finalText) throw new Error(`${label}: empty content`);
    return { content: finalText, elapsedMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  const probeId = `${USER_ID}_table_probe_${Date.now()}`.slice(0, 63);
  console.log('[1] probe', { probeId, question: QUESTION });
  const probe = await stream(
    {
      id: probeId,
      message: QUESTION,
      model: MODEL,
      tip: ' ',
      webSearch: true,
      thinking: false,
      thinkingLevel: 'low',
    },
    'probe'
  );
  console.log('probe OK', { elapsedMs: probe.elapsedMs, chars: probe.content.length, preview: probe.content.slice(0, 120) });

  const summarizeOnce = async (compact) => {
    const sumId = `${USER_ID}_table_sum_${compact ? 'c' : 'n'}_${Date.now()}`.slice(0, 63);
    console.log(`[2] summarize${compact ? ' (compact)' : ''}`, sumId);
    return stream(
      {
        id: sumId,
        message: summarizePrompt(QUESTION, probe.content, compact),
        model: MODEL,
        tip: ' ',
        webSearch: false,
        thinking: true,
        thinkingLevel: 'high',
      },
      'summarize'
    );
  };

  let sum;
  try {
    sum = await summarizeOnce(false);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/abort/i.test(msg)) {
      console.warn('summarize aborted, retry compact...', msg);
      sum = await summarizeOnce(true);
    } else {
      throw e;
    }
  }

  const hasTable = /\|.+\|/.test(sum.content);
  console.log('summarize OK', {
    elapsedMs: sum.elapsedMs,
    chars: sum.content.length,
    hasMarkdownTable: hasTable,
    preview: sum.content.slice(0, 280),
  });
  if (sum.elapsedMs > TIMEOUT_MS - 5000) {
    console.warn('WARN: summarize used most of timeout budget');
  }
  if (!hasTable) {
    console.warn('WARN: no markdown table detected (may still be valid prose)');
  }
}

run().catch((e) => {
  console.error('TABLE TEST FAILED', e instanceof Error ? e.message : e);
  process.exit(1);
});

/**
 * 精确测量流式时序：TTFB、首 chunk、chunk 间隔、总时长
 * node scripts/test-stream-timing.mjs <model>
 * model: deepseek | gemini | claude | doubao
 */
const BASE = 'http://localhost:3001/aitop-llm-see';
const API_KEY = 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma';
const USER_ID = '297409';

const MODELS = {
  deepseek: 'deepseek-v4-pro-260425',
  gemini: 'gemini-3.1-pro-preview:streamGenerateContent',
  claude: 'claude-sonnet-4-6',
  doubao: 'doubao-seed-1-6-250615',
};

const modelKey = process.argv[2] || 'deepseek';
const apiModel = MODELS[modelKey];
if (!apiModel) {
  console.error('Unknown model:', modelKey, 'Available:', Object.keys(MODELS).join(', '));
  process.exit(1);
}

async function main() {
  const chatId = (USER_ID + '_timing_' + Date.now()).slice(0, 32);
  const payload = {
    id: chatId,
    message: '用三句话介绍一下中国航天事业的成就。',
    model: apiModel,
    tip: '请用简体中文回答。',
    webSearch: false,
    thinking: false,
  };

  console.log(`[TIMING] model=${modelKey} apiModel=${apiModel}`);
  const t0 = Date.now();
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 120000);

  const resp = await fetch(BASE, {
    method: 'POST',
    headers: { 'api-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: ac.signal,
  });

  const ttfb = Date.now() - t0;
  console.log(`[TIMING] TTFB (response headers): ${ttfb}ms status=${resp.status}`);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let chunkCount = 0;
  let firstChunkAt = 0;
  let lastChunkAt = 0;
  let firstContentAt = 0;
  const intervals = [];
  let prevChunkAt = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const now = Date.now();
    chunkCount++;
    if (chunkCount === 1) {
      firstChunkAt = now;
    } else {
      intervals.push(now - prevChunkAt);
    }
    prevChunkAt = now;
    lastChunkAt = now;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const raw of lines) {
      const t = raw.trim();
      if (!t || t === '[DONE]') continue;
      const pl = t.startsWith('data:') ? t.slice(5).trim() : t;
      try {
        const data = JSON.parse(pl);
        if (data.content && firstContentAt === 0) {
          firstContentAt = now;
          console.log(`[TIMING] First content chunk at: ${now - t0}ms (content="${data.content.slice(0, 30)}")`);
        }
        if (data.content) content += data.content;
      } catch { /* skip */ }
    }
  }

  const totalMs = Date.now() - t0;
  const streamMs = lastChunkAt - firstChunkAt;
  const avgInterval = intervals.length > 0 ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length) : 0;
  const maxInterval = intervals.length > 0 ? Math.max(...intervals) : 0;
  const minInterval = intervals.length > 0 ? Math.min(...intervals) : 0;

  console.log('\n[TIMING] ===== SUMMARY =====');
  console.log(`[TIMING] TTFB (headers):         ${ttfb}ms`);
  console.log(`[TIMING] First chunk at:         ${firstChunkAt - t0}ms`);
  console.log(`[TIMING] First content at:       ${firstContentAt - t0}ms`);
  console.log(`[TIMING] Last chunk at:          ${lastChunkAt - t0}ms`);
  console.log(`[TIMING] Total time:             ${totalMs}ms`);
  console.log(`[TIMING] Stream duration:        ${streamMs}ms`);
  console.log(`[TIMING] Total chunks:           ${chunkCount}`);
  console.log(`[TIMING] Avg chunk interval:     ${avgInterval}ms`);
  console.log(`[TIMING] Min chunk interval:     ${minInterval}ms`);
  console.log(`[TIMING] Max chunk interval:     ${maxInterval}ms`);
  console.log(`[TIMING] Content length:         ${content.length} chars`);
  console.log(`[TIMING] Content:                ${content.slice(0, 200)}`);

  // 关键诊断
  console.log('\n[TIMING] ===== DIAGNOSIS =====');
  if (chunkCount <= 2) {
    console.log('[TIMING] ⚠️  上游 API 一次性返回全部内容（非真正流式）— 这是 AiTop API 的限制');
  } else if (avgInterval < 20) {
    console.log('[TIMING] ✅ 上游 API 真正流式，chunk 间隔正常');
  } else {
    console.log(`[TIMING] ⚠️  chunk 间隔偏大（avg ${avgInterval}ms），可能是上游缓冲`);
  }
  if (firstContentAt - t0 > 5000) {
    console.log(`[TIMING] ⚠️  首 token 延迟较高（${firstContentAt - t0}ms），这是上游模型生成速度问题，非前端问题`);
  } else {
    console.log(`[TIMING] ✅ 首 token 延迟可接受（${firstContentAt - t0}ms）`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

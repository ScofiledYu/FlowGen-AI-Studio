/**
 * 直接请求 AiTop 上游 API，对比 stream:true 和不加 stream 的时序差异
 * node scripts/test-aitop-direct-stream.mjs <model>
 */
const AITOP_BASE = 'https://aitop100-api.hytch.com';
const API_KEY = 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma';
const USER_ID = '297409';

const MODELS = {
  deepseek: 'deepseek-v4-pro-260425',
  gemini: 'gemini-3.1-pro-preview:streamGenerateContent',
  claude: 'claude-sonnet-4-6',
};

const modelKey = process.argv[2] || 'deepseek';
const apiModel = MODELS[modelKey];
if (!apiModel) {
  console.error('Unknown model:', modelKey);
  process.exit(1);
}

async function testStream(withStream) {
  const chatId = (USER_ID + '_direct_' + Date.now()).slice(0, 32);
  const payload = {
    id: chatId,
    message: '用三句话介绍中国航天。',
    model: apiModel,
    tip: '请用简体中文。',
    webSearch: false,
    thinking: false,
  };
  if (withStream) {
    payload.stream = true;
  }

  const label = withStream ? 'stream:true' : 'no-stream';
  console.log('\n[DIRECT ' + label + '] model=' + modelKey + ' starting...');
  const t0 = Date.now();
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 120000);

  try {
    const resp = await fetch(AITOP_BASE + '/api/v1/llm/see', {
      method: 'POST',
      headers: { 'api-key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });

    const ttfb = Date.now() - t0;
    console.log('[DIRECT ' + label + '] TTFB: ' + ttfb + 'ms status=' + resp.status);
    console.log('[DIRECT ' + label + '] content-type: ' + resp.headers.get('content-type'));

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let chunkCount = 0;
    let firstChunkAt = 0;
    let lastChunkAt = 0;
    let content = '';
    let buffer = '';

    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const now = Date.now();
      chunkCount++;
      if (chunkCount === 1) firstChunkAt = now;
      lastChunkAt = now;

      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t || t === '[DONE]') continue;
        const pl = t.startsWith('data:') ? t.slice(5).trim() : t;
        try {
          const data = JSON.parse(pl);
          if (data.content) content += data.content;
        } catch (e) { /* skip */ }
      }
    }

    const totalMs = Date.now() - t0;
    console.log('[DIRECT ' + label + '] chunks=' + chunkCount + ' total=' + totalMs + 'ms content_len=' + content.length);
    console.log('[DIRECT ' + label + '] first_chunk_at=' + (firstChunkAt - t0) + 'ms last_chunk_at=' + (lastChunkAt - t0) + 'ms');
    console.log('[DIRECT ' + label + '] content: ' + content.slice(0, 120));
    return { chunkCount, totalMs, ttfb, firstChunkAt: firstChunkAt - t0, lastChunkAt: lastChunkAt - t0 };
  } catch (e) {
    console.log('[DIRECT ' + label + '] ERROR: ' + (e.message || String(e)));
    return null;
  }
}

async function main() {
  console.log('===== Testing ' + modelKey + ' =====');
  const noStream = await testStream(false);
  const withStreamFlag = await testStream(true);

  console.log('\n===== COMPARISON =====');
  if (noStream) {
    console.log('no-stream:   chunks=' + noStream.chunkCount + ' ttfb=' + noStream.ttfb + 'ms total=' + noStream.totalMs + 'ms');
  }
  if (withStreamFlag) {
    console.log('stream:true: chunks=' + withStreamFlag.chunkCount + ' ttfb=' + withStreamFlag.ttfb + 'ms total=' + withStreamFlag.totalMs + 'ms');
  }
  if (noStream && withStreamFlag) {
    if (withStreamFlag.chunkCount > noStream.chunkCount) {
      console.log('✅ stream:true 增加了 chunk 数量，上游支持流式！');
    } else if (withStreamFlag.ttfb < noStream.ttfb) {
      console.log('✅ stream:true 降低了 TTFB！');
    } else {
      console.log('⚠️ stream:true 无明显改善，上游可能不支持流式');
    }
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

/**
 * 用 Node.js 原生 https 模块直连 AiTop API，逐 data 事件打印时序
 * 排除 fetch/axios 的缓冲行为
 * node scripts/test-aitop-raw-stream.mjs <model>
 */
import https from 'https';

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

const chatId = (USER_ID + '_raw_' + Date.now()).slice(0, 32);
const useStream = process.argv.includes('--stream');
const payloadObj = {
  id: chatId,
  message: '用三句话介绍中国航天。',
  model: apiModel,
  tip: '请用简体中文。',
  webSearch: false,
  thinking: false,
};
if (useStream) {
  payloadObj.stream = true;
}
const payload = JSON.stringify(payloadObj);
console.log('[RAW] model=' + modelKey + ' stream=' + useStream + ' starting...');
const t0 = Date.now();

const req = https.request(
  {
    hostname: 'aitop100-api.hytch.com',
    path: '/api/v1/llm/see',
    method: 'POST',
    headers: {
      'api-key': API_KEY,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'Accept': 'text/event-stream',
    },
  },
  (res) => {
    console.log('[RAW] status=' + res.statusCode + ' ttfb=' + (Date.now() - t0) + 'ms');
    console.log('[RAW] content-type=' + res.headers['content-type']);

    let dataEventCount = 0;
    let firstDataAt = 0;
    let lastDataAt = 0;
    let totalContent = '';
    let buffer = '';

    res.on('data', (chunk) => {
      const now = Date.now();
      const chunkStr = chunk.toString('utf8');
      dataEventCount++;
      if (dataEventCount === 1) firstDataAt = now;
      lastDataAt = now;

      if (dataEventCount <= 10) {
        console.log('[RAW] data#' + dataEventCount + ' at ' + (now - t0) + 'ms size=' + chunk.length + 'B preview=' + JSON.stringify(chunkStr.slice(0, 120)));
      }

      buffer += chunkStr;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t || t === '[DONE]') continue;
        const pl = t.startsWith('data:') ? t.slice(5).trim() : t;
        try {
          const data = JSON.parse(pl);
          if (data.content) totalContent += data.content;
        } catch (e) { /* skip */ }
      }
    });

    res.on('end', () => {
      const totalMs = Date.now() - t0;
      console.log('\n[RAW] ===== SUMMARY =====');
      console.log('[RAW] data events: ' + dataEventCount);
      console.log('[RAW] first data at: ' + (firstDataAt - t0) + 'ms');
      console.log('[RAW] last data at: ' + (lastDataAt - t0) + 'ms');
      console.log('[RAW] total time: ' + totalMs + 'ms');
      console.log('[RAW] content length: ' + totalContent.length + ' chars');
      console.log('[RAW] content: ' + totalContent.slice(0, 200));

      if (dataEventCount > 3) {
        console.log('\n[RAW] ✅ 上游 API 真正流式！data 事件 > 3');
      } else if (dataEventCount > 1) {
        console.log('\n[RAW] ⚠️ 上游 API 部分流式，data 事件 ' + dataEventCount);
      } else {
        console.log('\n[RAW] ❌ 上游 API 非流式，仅 1 个 data 事件');
      }
      process.exit(0);
    });

    res.on('error', (e) => {
      console.error('[RAW] ERROR: ' + e.message);
      process.exit(1);
    });
  }
);

req.on('error', (e) => {
  console.error('[RAW] REQ ERROR: ' + e.message);
  process.exit(1);
});

req.write(payload);
req.end();

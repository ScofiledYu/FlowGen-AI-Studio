/**
 * 用 Node.js 原生 http 模块请求 BFF，测量 data 事件次数
 * 排除 fetch 的缓冲行为
 * node scripts/test-bff-raw-stream.mjs <model>
 */
import http from 'http';

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

const chatId = ('297409_bffraw_' + Date.now()).slice(0, 32);
const payload = JSON.stringify({
  id: chatId,
  message: '用三句话介绍中国航天。',
  model: apiModel,
  tip: '请用简体中文。',
  webSearch: false,
  thinking: false,
  stream: true,
});

console.log('[BFF-RAW] model=' + modelKey + ' starting...');
const t0 = Date.now();

const req = http.request(
  {
    hostname: 'localhost',
    port: 3001,
    path: '/aitop-llm-see',
    method: 'POST',
    headers: {
      'api-key': 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  },
  (res) => {
    console.log('[BFF-RAW] status=' + res.statusCode + ' ttfb=' + (Date.now() - t0) + 'ms');
    console.log('[BFF-RAW] content-type=' + res.headers['content-type']);

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
        console.log('[BFF-RAW] data#' + dataEventCount + ' at ' + (now - t0) + 'ms size=' + chunk.length + 'B preview=' + JSON.stringify(chunkStr.slice(0, 120)));
      }

      buffer += chunkStr;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t || t ===
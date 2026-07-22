/**
 * 测试 SSE 流式 chunk 到达情况
 * 用法: node scripts/test-stream-chunks.mjs
 */
import http from 'http';

const USER_ID = '297409';
const chatId = (USER_ID + '_streamtest_' + Date.now()).slice(0, 32);

const data = {
  id: chatId,
  message: '请用100个字介绍一下北京',
  model: 'deepseek-v4-pro-260425',
  tip: ' ',
  webSearch: false,
  thinking: false,
};
const postData = JSON.stringify(data);

console.log('[TEST] chatId=' + chatId + ' len=' + chatId.length);

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/aitop-llm-see',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'api-key': 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma',
    'Content-Length': Buffer.byteLength(postData),
  },
};

const req = http.request(options, (res) => {
  let chunkCount = 0;
  let totalBytes = 0;
  let firstChunkAt = 0;
  const t0 = Date.now();
  let lastChunkAt = 0;

  res.on('data', (chunk) => {
    if (chunkCount === 0) firstChunkAt = Date.now() - t0;
    chunkCount++;
    lastChunkAt = Date.now() - t0;
    totalBytes += chunk.length;
    const text = chunk.toString().slice(0, 100).replace(/\n/g, '\\n');
    console.log('chunk#' + chunkCount + ' size=' + chunk.length + 'B time=' + lastChunkAt + 'ms preview=' + text);
  });

  res.on('end', () => {
    const elapsed = Date.now() - t0;
    console.log('DONE: chunks=' + chunkCount + ' totalBytes=' + totalBytes + ' firstChunkAt=' + firstChunkAt + 'ms lastChunkAt=' + lastChunkAt + 'ms totalTime=' + elapsed + 'ms');
    if (chunkCount > 0) {
      console.log('avg chunk size=' + (totalBytes / chunkCount).toFixed(0) + 'B');
      console.log('avg interval=' + (lastChunkAt / chunkCount).toFixed(0) + 'ms');
    }
    if (chunkCount >= 3) {
      console.log('RESULT: STREAMING OK (' + chunkCount + ' chunks, good streaming)');
    } else if (chunkCount >= 2) {
      console.log('RESULT: WEAK STREAMING (' + chunkCount + ' chunks, barely streaming)');
    } else if (chunkCount === 1) {
      console.log('RESULT: SINGLE CHUNK - NOT STREAMING!');
    }
    process.exit(0);
  });

  res.on('error', (err) => {
    console.error('ERROR:', err.message);
    process.exit(1);
  });
});

req.on('error', (err) => {
  console.error('REQUEST ERROR:', err.message);
  process.exit(1);
});

req.write(postData);
req.end();

setTimeout(() => {
  console.error('TIMEOUT: no response in 30s');
  req.destroy();
  process.exit(1);
}, 30000);
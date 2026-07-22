/**
 * 短文本回复快速验证脚本
 * 用法: node scripts/test-short-text.mjs <model>
 */
const API_URL = 'http://localhost:3001/aitop-llm-see';
const API_KEY = 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma';
const USER_ID = '297409';

const MODEL_MAP = {
  'deepseek': 'deepseek-v4-pro-260425',
  'claude': 'claude-sonnet-4-6',
  'gemini': 'gemini-3.1-pro-preview:streamGenerateContent',
  'doubao': 'doubao-seed-2-0-pro-260215',
};

const modelKey = process.argv[2] || 'deepseek';
const apiModel = MODEL_MAP[modelKey];
if (!apiModel) {
  console.error('Unknown model:', modelKey, 'Available:', Object.keys(MODEL_MAP).join(', '));
  process.exit(1);
}

const PROMPT = '你好，请简单自我介绍';

async function main() {
  const chatId = (USER_ID + '_shorttest_' + Date.now()).slice(0, 32);
  const payload = {
    id: chatId,
    message: PROMPT,
    model: apiModel,
    tip: ' ',
    webSearch: false,
    thinking: false,
    thinkingLevel: 'low',
  };

  console.log('[TEST] model=' + modelKey + ' apiModel=' + apiModel + ' chatId=' + chatId);

  const t0 = Date.now();
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'api-key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  console.log('[TEST] response status=' + resp.status + ' headers_time=' + (Date.now() - t0) + 'ms');

  if (!resp.ok) {
    const text = await resp.text();
    console.error('[TEST] HTTP error ' + resp.status + ': ' + text.slice(0, 500));
    process.exit(1);
  }

  if (!resp.body) {
    console.error('[TEST] no response body');
    process.exit(1);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let totalContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let jsonStr = null;
      if (trimmed.startsWith('data:')) jsonStr = trimmed.slice(5).trim();
      else if (trimmed.startsWith('{')) jsonStr = trimmed;
      if (!jsonStr) continue;
      try {
        const data = JSON.parse(jsonStr);
        if (typeof data.content === 'string') totalContent += data.content;
      } catch (e) {
        // skip
      }
    }
  }

  console.log('[TEST] content length: ' + totalContent.length);
  console.log('[TEST] content: ' + totalContent.slice(0, 300));

  if (totalContent.length >= 10) {
    console.log('[TEST] RESULT: PASS');
  } else {
    console.log('[TEST] RESULT: FAIL');
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

/**
 * 上下文记忆测试脚本
 * 用法: node scripts/test-context-memory.mjs <model>
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

async function sendMessage(chatId, message, opts = {}) {
  const payload = {
    id: chatId,
    message: message,
    model: apiModel,
    tip: ' ',
    webSearch: false,
    thinking: false,
    thinkingLevel: 'low',
    ...opts,
  };

  const t0 = Date.now();
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'api-key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error('HTTP ' + resp.status + ': ' + text.slice(0, 500));
  }

  if (!resp.body) throw new Error('no response body');

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

  return { content: totalContent, elapsed: Date.now() - t0 };
}

async function main() {
  const chatId = (USER_ID + '_ctxtest_' + Date.now()).slice(0, 32);
  console.log('[TEST] model=' + modelKey + ' apiModel=' + apiModel + ' chatId=' + chatId);

  const first = await sendMessage(chatId, '我喜欢吃苹果和香蕉，请记住这个偏好。');
  console.log('[TEST] first response length: ' + first.content.length + ' elapsed: ' + first.elapsed + 'ms');
  console.log('[TEST] first response first 200: ' + first.content.slice(0, 200));

  const second = await sendMessage(chatId, '我刚才说我喜欢吃什么水果？请列出。');
  console.log('[TEST] second response length: ' + second.content.length + ' elapsed: ' + second.elapsed + 'ms');
  console.log('[TEST] second response first 500: ' + second.content.slice(0, 500));

  const hasApple = second.content.includes('苹果');
  const hasBanana = second.content.includes('香蕉');
  console.log('[TEST] contains apple: ' + hasApple);
  console.log('[TEST] contains banana: ' + hasBanana);

  if (hasApple && hasBanana) {
    console.log('[TEST] RESULT: PASS (context memory works)');
  } else {
    console.log('[TEST] RESULT: FAIL (missing fruits in context memory)');
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

/**
 * Claude 思考模式不同级别测试脚本
 * 用法: node scripts/test-claude-thinking-levels.mjs
 */
const API_URL = 'http://localhost:3001/aitop-llm-see';
const API_KEY = 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma';
const USER_ID = '297409';

const PROMPT = '推理一下：一个房间里有3个开关，隔壁房间有3个灯泡，你只能进入一次隔壁房间，如何确定每个开关对应哪个灯泡？';

async function testLevel(thinking, thinkingLevel) {
  const chatId = (USER_ID + '_claude_think_' + Date.now()).slice(0, 32);
  const payload = {
    id: chatId,
    message: PROMPT,
    model: 'claude-sonnet-4-6',
    tip: ' ',
    webSearch: false,
    thinking: thinking,
    thinkingLevel: thinkingLevel,
  };

  console.log('[TEST] testing thinking=' + thinking + ' thinkingLevel=' + thinkingLevel);

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
  let totalReasoning = '';

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
        if (data.reasoning_content) totalReasoning += data.reasoning_content;
        if (data.thinkingContent) totalReasoning += data.thinkingContent;
        if (data.thinking_content) totalReasoning += data.thinking_content;
      } catch (e) {
        // skip
      }
    }
  }

  const elapsed = Date.now() - t0;
  console.log('[TEST] elapsed=' + elapsed + 'ms contentLen=' + totalContent.length + ' reasoningLen=' + totalReasoning.length);
  console.log('[TEST] content first 200: ' + totalContent.slice(0, 200));
  console.log('[TEST] content last 200: ' + totalContent.slice(-200));
  console.log('[TEST] pass=' + (totalContent.length >= 50 && totalContent.includes('灯泡')));
  console.log('');
  return { thinking, thinkingLevel, contentLen: totalContent.length, reasoningLen: totalReasoning.length, content: totalContent };
}

async function main() {
  console.log('[TEST] Claude thinking mode level tests\n');

  await testLevel(false, 'low');
  await testLevel(true, 'low');
  await testLevel(true, 'high');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

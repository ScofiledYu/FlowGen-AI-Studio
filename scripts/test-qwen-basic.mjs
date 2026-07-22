/**
 * Qwen 基本测试脚本
 * 用法: node scripts/test-qwen-basic.mjs
 */
const API_URL = 'http://localhost:3001/api/v1/chat/completions';
const API_KEY = '0fd502c3-7d1b-43d3-9eb6-4e91918af979';

async function sendMessage(messages, opts = {}) {
  const payload = {
    model: 'Qwen3-VL-235B-A22B-Instruct',
    messages: messages,
    max_tokens: opts.maxTokens || 8192,
    stream: true,
  };

  const t0 = Date.now();
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
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
      if (!trimmed || trimmed === 'data: [DONE]') continue;
      let jsonStr = null;
      if (trimmed.startsWith('data:')) jsonStr = trimmed.slice(5).trim();
      else if (trimmed.startsWith('{')) jsonStr = trimmed;
      if (!jsonStr) continue;
      try {
        const data = JSON.parse(jsonStr);
        const delta = data.choices?.[0]?.delta;
        if (delta?.content) totalContent += delta.content;
      } catch (e) {
        // skip
      }
    }
  }

  return { content: totalContent, elapsed: Date.now() - t0 };
}

async function main() {
  console.log('[TEST] Qwen basic test');

  // 场景1：短文本回复
  const short = await sendMessage([{ role: 'user', content: '用一句话介绍自己' }]);
  console.log('[TEST] short response length: ' + short.content.length + ' elapsed: ' + short.elapsed + 'ms');
  console.log('[TEST] short response: ' + short.content.slice(0, 300));
  const shortPass = short.content.length >= 10;

  // 场景2：上下文记忆
  const ctx1 = await sendMessage([{ role: 'user', content: '我喜欢吃苹果和香蕉' }]);
  const ctx2 = await sendMessage([
    { role: 'user', content: '我喜欢吃苹果和香蕉' },
    { role: 'assistant', content: ctx1.content },
    { role: 'user', content: '我刚才说我喜欢吃什么水果？请列出。' }
  ]);
  console.log('[TEST] context response: ' + ctx2.content.slice(0, 500));
  const ctxPass = ctx2.content.includes('苹果') && ctx2.content.includes('香蕉');

  // 场景3：长文本输出（缩短要求，因为 Qwen max_tokens 可能有限）
  const longPrompt = '请写一篇关于中国航天发展史的文章，至少2000字，涵盖东方红一号、神舟、嫦娥、天宫、北斗、天问等里程碑。';
  const long = await sendMessage([{ role: 'user', content: longPrompt }], { maxTokens: 8192 });
  console.log('[TEST] long response length: ' + long.content.length + ' elapsed: ' + long.elapsed + 'ms');
  console.log('[TEST] long response first 300: ' + long.content.slice(0, 300));
  console.log('[TEST] long response last 300: ' + long.content.slice(-300));
  const longPass = long.content.length >= 1000;

  console.log('[TEST] ===== SUMMARY =====');
  console.log('[TEST] short text: ' + (shortPass ? 'PASS' : 'FAIL'));
  console.log('[TEST] context memory: ' + (ctxPass ? 'PASS' : 'FAIL'));
  console.log('[TEST] long output: ' + (longPass ? 'PASS' : 'FAIL'));

  if (shortPass && ctxPass && longPass) {
    console.log('[TEST] RESULT: PASS');
  } else {
    console.log('[TEST] RESULT: FAIL');
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

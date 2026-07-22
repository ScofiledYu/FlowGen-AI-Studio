/**
 * 快速测试思考模式：验证 API 是否返回 reasoning_content
 * node scripts/test-thinking-quick.mjs <model>
 */
const BASE = 'http://localhost:3001/aitop-llm-see';
const API_KEY = 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma';
const USER_ID = '297409';

const MODELS = {
  gemini: 'gemini-3.1-pro-preview:streamGenerateContent',
  claude: 'claude-sonnet-4-6',
  deepseek: 'deepseek-v4-pro-260425',
};

const modelKey = process.argv[2] || 'gemini';
const apiModel = MODELS[modelKey];
if (!apiModel) {
  console.error('Unknown model:', modelKey, 'Available:', Object.keys(MODELS).join(', '));
  process.exit(1);
}

async function main() {
  const chatId = (USER_ID + '_thinktest_' + Date.now()).slice(0, 32);
  const payload = {
    id: chatId,
    message: '请详细分析一下：一个球从10米高度自由落体到地面，反弹到原来高度的一半，问第5次落地时总共经过了多少米？请一步步思考。',
    model: apiModel,
    tip: '若启用思考，思考过程请用中文，使用小标题（如 **分析问题**、**计算过程**）组织思考步骤。',
    webSearch: false,
    thinking: true,
    thinkingLevel: 'high',
  };

  console.log('[TEST] model=' + modelKey + ' apiModel=' + apiModel);
  console.log('[TEST] payload.thinking=' + payload.thinking + ' thinkingLevel=' + payload.thinkingLevel);

  const t0 = Date.now();
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 120000);

  const resp = await fetch(BASE, {
    method: 'POST',
    headers: { 'api-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: ac.signal,
  });

  console.log('[TEST] status=' + resp.status + ' time=' + (Date.now() - t0) + 'ms');

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';
  let chunkCount = 0;
  let fieldCounts = { reasoning_content: 0, thinkingContent: 0, reasoningContent: 0, thinking_content: 0, choicesDeltaReasoning: 0 };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunkCount++;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const raw of lines) {
      const t = raw.trim();
      if (!t || t === '[DONE]') continue;
      const pl = t.startsWith('data:') ? t.slice(5).trim() : t;
      try {
        const data = JSON.parse(pl);
        if (data.content) content += data.content;
        if (data.reasoning_content) { reasoning += data.reasoning_content; fieldCounts.reasoning_content++; }
        if (data.thinkingContent) { reasoning += data.thinkingContent; fieldCounts.thinkingContent++; }
        if (data.reasoningContent) { reasoning += data.reasoningContent; fieldCounts.reasoningContent++; }
        if (data.thinking_content) { reasoning += data.thinking_content; fieldCounts.thinking_content++; }
        if (data.choices?.[0]?.delta?.reasoning_content) {
          reasoning += data.choices[0].delta.reasoning_content;
          fieldCounts.choicesDeltaReasoning++;
        }
        // 打印前 10 个 chunk 的字段
        if (chunkCount <= 10) {
          const keys = Object.keys(data).filter(k => !['id', 'model', 'object', 'created'].includes(k));
          if (keys.length > 0) {
            const sample = {};
            for (const k of keys) {
              const v = data[k];
              sample[k] = typeof v === 'string' ? v.slice(0, 80) : v;
            }
            console.log('[CHUNK#' + chunkCount + ']', JSON.stringify(sample));
          }
        }
      } catch { /* skip */ }
    }
  }

  const elapsed = Date.now() - t0;
  console.log('\n[TEST] ===== RESULT =====');
  console.log('[TEST] total chunks:', chunkCount);
  console.log('[TEST] elapsed:', elapsed + 'ms');
  console.log('[TEST] content length:', content.length + ' chars');
  console.log('[TEST] reasoning length:', reasoning.length + ' chars');
  console.log('[TEST] field counts:', JSON.stringify(fieldCounts));
  console.log('[TEST] content first 200:', content.slice(0, 200));
  console.log('[TEST] reasoning first 200:', reasoning.slice(0, 200));

  if (reasoning.length > 0) {
    console.log('[TEST] RESULT: reasoning_content found! thinking works.');
  } else if (content.includes('**') && content.length > 0) {
    console.log('[TEST] RESULT: no reasoning_content field, but content may contain inline thinking (check first 200 chars)');
  } else {
    console.log('[TEST] RESULT: no reasoning or thinking content found');
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
/**
 * 思考模式测试脚本
 * 用法: node scripts/test-thinking.mjs <model>
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

const PROMPT = '推理一下：一个房间里有3个开关，隔壁房间有3个灯泡，你只能进入一次隔壁房间，如何确定每个开关对应哪个灯泡？';

async function main() {
  const chatId = (USER_ID + '_thinktest_' + Date.now()).slice(0, 32);
  const payload = {
    id: chatId,
    message: PROMPT,
    model: apiModel,
    tip: ' ',
    webSearch: false,
    thinking: true,
    thinkingLevel: 'high',
  };

  console.log('[TEST] model=' + modelKey + ' apiModel=' + apiModel + ' chatId=' + chatId);

  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 300000);

  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'api-key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: ac.signal,
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
    let totalReasoning = '';
    let chunkCount = 0;
    let firstChunkAt = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log('[TEST] stream DONE chunks=' + chunkCount + ' contentLen=' + totalContent.length + ' reasoningLen=' + totalReasoning.length);
        break;
      }
      if (chunkCount === 0) {
        firstChunkAt = Date.now() - t0;
        console.log('[TEST] first chunk at ' + firstChunkAt + 'ms bytes=' + value.length);
      }
      chunkCount++;

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
          if (data.error) {
            console.log('[TEST] stream error: ' + JSON.stringify(data.error));
          }
        } catch (e) {
          // skip
        }
      }
    }

    const elapsed = Date.now() - t0;
    console.log('[TEST] ===== SUMMARY =====');
    console.log('[TEST] model: ' + modelKey + ' (' + apiModel + ')');
    console.log('[TEST] total elapsed: ' + elapsed + 'ms');
    console.log('[TEST] total content length: ' + totalContent.length + ' chars');
    console.log('[TEST] total reasoning length: ' + totalReasoning.length + ' chars');
    console.log('[TEST] reasoning first 300: ' + totalReasoning.slice(0, 300));
    console.log('[TEST] content first 500: ' + totalContent.slice(0, 500));
    console.log('[TEST] contains switch: ' + totalContent.includes('开关'));
    console.log('[TEST] contains bulb: ' + totalContent.includes('灯泡'));
    console.log('[TEST] contains correct approach hint: ' + (/开一段时间|摸灯泡|温度|发热|亮着/.test(totalContent)));
    
    if (totalContent.length >= 50) {
      console.log('[TEST] RESULT: PASS (got content, ' + totalContent.length + ' chars)');
    } else {
      console.log('[TEST] RESULT: FAIL (content only ' + totalContent.length + ' chars)');
    }

  } catch (e) {
    const elapsed = Date.now() - t0;
    console.error('[TEST] ERROR after ' + elapsed + 'ms: ' + e.message);
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

const BASE_URL = process.env.LLM_TEST_BASE_URL || 'http://localhost:3001/aitop-llm-see';
const API_KEY = process.env.LLM_TEST_API_KEY || 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma';
const USER_ID = process.env.LLM_TEST_USER_ID || '297409';
const TIMEOUT_MS = Number(process.env.LLM_TEST_TIMEOUT_MS || 120000);

const MODELS = [
  { id: 'gemini', name: 'gemini-3.1-pro-preview:streamGenerateContent' },
  { id: 'claude', name: 'claude-sonnet-4-6' },
];

const THINKING_MODES = [
  { id: 'off', thinking: false, thinkingLevel: 'low' },
  { id: 'light', thinking: true, thinkingLevel: 'low' },
  { id: 'deep', thinking: true, thinkingLevel: 'high' },
];

const WEB_SEARCH_OPTIONS = [false, true];
const FALLBACK_RE = /(系统繁忙|稍后再试|认证异常|upstream|gateway timeout|请稍后重试|重试几次|服务异常|network error)/i;

function buildPrompt(caseId, modelId, thinkingModeId, webSearch) {
  const dataset = Array.from({ length: 80 }, (_, i) => {
    return `kpi_${String(i + 1).padStart(2, '0')}=${(i * 13) % 97}, lag=${(i * 29) % 211}ms, err=${((i % 9) * 0.17).toFixed(2)}%`;
  }).join('\n');
  return [
    `你是企业风控分析助手。`,
    `当前测试组合：case=${caseId}, model=${modelId}, thinking=${thinkingModeId}, webSearch=${webSearch ? 'on' : 'off'}.`,
    `请返回三段：风险摘要(2条)、关键发现(3条)、可执行建议(2条)。`,
    `末尾必须输出标记：[[CASE_OK:${caseId}]]`,
    '',
    '数据样本：',
    dataset,
  ].join('\n');
}

function getChunk(data) {
  if (!data || typeof data !== 'object') return '';
  return (
    data.content ||
    data.text ||
    data.message ||
    data.output_text ||
    data.response ||
    data.answer ||
    data.result ||
    data.delta?.content ||
    data.data?.content ||
    data.data?.text ||
    ''
  );
}

function isLikelyRawDumpOrTooShort(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (t.length <= 24) return true;
  if (/^search results for\s*"/i.test(t)) return true;
  if (/^i'?ll search for\s*"/i.test(t)) return true;
  if (/^no results found\b/i.test(t)) return true;
  if (/^未找到相关结果/.test(t)) return true;
  return false;
}

function buildSummarizePrompt(question, rawDump) {
  const q = String(question || '').trim();
  const src = String(rawDump || '').trim() || '（上一轮联网结果为空）';
  return (
    `【任务】根据上一轮联网检索结果，直接回答用户问题。\n` +
    `【用户问题】\n${q}\n\n` +
    `【要求】\n` +
    `- 先给结论，再给2-4条依据；\n` +
    `- 若证据不足，明确说明不确定点与下一步验证方向；\n` +
    `- 不要输出“Search results for”或“I'll search for”；\n` +
    `- 避免一句话回答。\n\n` +
    `【上一轮联网结果】\n${src}`
  );
}

async function sendCombo({ modelName, chatId, caseId, thinking, thinkingLevel, webSearch, prompt }) {
  const payload = {
    id: chatId,
    message: prompt,
    model: modelName,
    tip: ' ',
    thinking,
    thinkingLevel,
    webSearch,
  };

  const startedAt = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let firstTokenMs = -1;
  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': API_KEY,
      },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 300)}`);
    }
    if (!res.body) throw new Error('No response stream body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (firstTokenMs < 0) firstTokenMs = Date.now() - startedAt;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        const payloadLine = line.startsWith('data:') ? line.slice(5).trim() : line;
        if (!payloadLine || payloadLine === '[DONE]') continue;
        try {
          const data = JSON.parse(payloadLine);
          if (data && typeof data === 'object' && data.success === false && data.message) {
            throw new Error(`Upstream failed: ${String(data.message)}`);
          }
          content += getChunk(data);
        } catch {
          if (payloadLine.startsWith('{') || payloadLine.startsWith('[')) {
            // ignore parse noise
          } else {
            content += payloadLine;
          }
        }
      }
    }

    let finalText = (content || '').trim();
    if (webSearch && isLikelyRawDumpOrTooShort(finalText)) {
      const retryPayload = {
        ...payload,
        id: `${chatId}_s1`.slice(0, 63),
        webSearch: false,
        message: buildSummarizePrompt(prompt, finalText),
      };
      const retryRes = await fetch(BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': API_KEY,
        },
        body: JSON.stringify(retryPayload),
      });
      if (retryRes.ok && retryRes.body) {
        const retryReader = retryRes.body.getReader();
        const retryDecoder = new TextDecoder();
        let retryBuffer = '';
        let retryContent = '';
        while (true) {
          const { done, value } = await retryReader.read();
          if (done) break;
          retryBuffer += retryDecoder.decode(value, { stream: true });
          const retryLines = retryBuffer.split('\n');
          retryBuffer = retryLines.pop() || '';
          for (const retryRawLine of retryLines) {
            const retryLine = retryRawLine.trim();
            if (!retryLine) continue;
            const retryPayloadLine = retryLine.startsWith('data:') ? retryLine.slice(5).trim() : retryLine;
            if (!retryPayloadLine || retryPayloadLine === '[DONE]') continue;
            try {
              retryContent += getChunk(JSON.parse(retryPayloadLine));
            } catch {
              if (!retryPayloadLine.startsWith('{') && !retryPayloadLine.startsWith('[')) {
                retryContent += retryPayloadLine;
              }
            }
          }
        }
        if (retryContent.trim()) {
          finalText = retryContent.trim();
        }
      }
    }
    if (!finalText) throw new Error('Empty content');
    if (FALLBACK_RE.test(finalText)) throw new Error(`Fallback-like response: ${finalText.slice(0, 140)}`);
    const hasMarker = finalText.includes(`[[CASE_OK:${caseId}]]`);
    if (!hasMarker && !webSearch) {
      throw new Error(`Missing marker [[CASE_OK:${caseId}]]`);
    }
    return {
      ok: true,
      elapsedMs: Date.now() - startedAt,
      firstTokenMs,
      chars: finalText.length,
      hasMarker,
      preview: finalText.slice(0, 100),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  let pass = 0;
  let fail = 0;
  const failedCases = [];

  for (const model of MODELS) {
    for (const mode of THINKING_MODES) {
      for (const webSearch of WEB_SEARCH_OPTIONS) {
        const caseId = `${model.id}_${mode.id}_${webSearch ? 'ws_on' : 'ws_off'}`;
        const chatId = `${USER_ID}_combo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`.slice(0, 63);
        const prompt = buildPrompt(caseId, model.id, mode.id, webSearch);
        process.stdout.write(`\n[RUN] ${caseId} ... `);
        try {
          let result;
          let lastErr;
          for (let attempt = 0; attempt < 3; attempt++) {
            const retryChatId =
              attempt === 0
                ? chatId
                : `${USER_ID}_combo_r${attempt}_${Date.now()}`.slice(0, 63);
            try {
              result = await sendCombo({
                modelName: model.name,
                chatId: retryChatId,
                caseId,
                thinking: mode.thinking,
                thinkingLevel: mode.thinkingLevel,
                webSearch,
                prompt,
              });
              lastErr = null;
              break;
            } catch (error) {
              lastErr = error;
              const msg = error instanceof Error ? error.message : String(error);
              const retryable =
                /abort|timeout|请多试|未能回复|出了问题|Missing marker/i.test(msg);
              if (!retryable || attempt >= 2) throw error;
              await new Promise((r) => setTimeout(r, 3000));
            }
          }
          if (!result) throw lastErr ?? new Error('no result');
          if (webSearch && result.chars < 80) {
            throw new Error(`Web-search answer too short (${result.chars} chars)`);
          }
          pass += 1;
          console.log(`OK elapsed=${result.elapsedMs}ms firstToken=${result.firstTokenMs}ms chars=${result.chars} marker=${result.hasMarker ? 'yes' : 'no'}`);
        } catch (error) {
          fail += 1;
          const msg = error instanceof Error ? error.message : String(error);
          failedCases.push({ caseId, msg });
          console.log(`FAIL ${msg}`);
        }
      }
    }
  }

  console.log('\n=== COMBO TEST SUMMARY ===');
  console.log(`PASS: ${pass}`);
  console.log(`FAIL: ${fail}`);
  if (failedCases.length > 0) {
    for (const item of failedCases) {
      console.log(`- ${item.caseId}: ${item.msg}`);
    }
    process.exit(1);
  }
}

run().catch((error) => {
  console.error('COMBO TEST CRASHED', error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

const API_KEY = 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma';
const base = process.env.LLM_TEST_BASE_URL || 'http://localhost:3001/aitop-llm-see';
const id = `297409_probe_${Date.now()}`;

async function tryCase(label, body) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 25000);
  try {
    const r = await fetch(base, {
      method: 'POST',
      headers: { 'api-key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await r.text();
    const has10001 = /10001|出了一些问题/.test(text);
    const hasOkChunk = /"content":"[^"]{3,}"/.test(text);
    console.log(
      label,
      'status',
      r.status,
      '10001',
      has10001,
      'hasChunk',
      hasOkChunk,
      'preview',
      text.slice(0, 220).replace(/\n/g, ' ')
    );
  } catch (e) {
    console.log(label, 'ERR', e.message);
  } finally {
    clearTimeout(t);
  }
}

const msg = '深圳当前时间和实时天气';
await tryCase('gemini web+think', {
  id,
  message: msg,
  model: 'gemini-3.1-pro-preview:streamGenerateContent',
  tip: ' ',
  webSearch: true,
  thinking: true,
  thinkingLevel: 'low',
});
await tryCase('gemini web no think', {
  id: id + 'b',
  message: msg,
  model: 'gemini-3.1-pro-preview:streamGenerateContent',
  tip: ' ',
  webSearch: true,
  thinking: false,
});
await tryCase('gemini no web', {
  id: id + 'c',
  message: msg,
  model: 'gemini-3.1-pro-preview:streamGenerateContent',
  tip: ' ',
  webSearch: false,
  thinking: false,
});
await tryCase('claude web+think', {
  id: id + 'd',
  message: msg,
  model: 'claude-sonnet-4-6',
  tip: ' ',
  webSearch: true,
  thinking: true,
  thinkingLevel: 'low',
});

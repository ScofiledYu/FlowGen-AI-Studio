/**
 * 全语言模型 × 四模式矩阵（国际通用问答风格）
 *
 * 模式：
 *   off      — 无联网 + 无思考
 *   web      — 仅联网
 *   think    — 仅思考
 *   webthink — 联网 + 思考
 *
 * 模型：Gemini / Claude / DeepSeek / DouBao（Qwen 预期 N/A）
 *
 * node scripts/llm-four-mode-matrix.mjs
 * LLM_TEST_TIMEOUT_MS=240000 node scripts/llm-four-mode-matrix.mjs
 */
const BASE = process.env.LLM_TEST_BASE_URL || 'http://localhost:3001/aitop-llm-see';
const API_KEY = process.env.LLM_TEST_API_KEY || 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma';
const USER_ID = process.env.LLM_TEST_USER_ID || '297409';
const TIMEOUT_MS = Number(process.env.LLM_TEST_TIMEOUT_MS || 240000);

/** 与 utils/aitopChatModels.ts 同步 */
const MODELS = [
  { label: 'Gemini 3.1 Pro', api: 'gemini-3.1-pro-preview:streamGenerateContent' },
  { label: 'Claude 4.6', api: 'claude-sonnet-4-6' },
  { label: 'DeepSeek V4 Pro', api: 'deepseek-v4-pro-260425' },
  { label: 'DouBao Seed 2.0', api: 'doubao-seed-2-0-pro-260215' },
];

/**
 * 四模式 × 国际通用问答题型
 * 参考：OpenAI / Anthropic / Google 助手常见交互（问候、事实、推理、检索）
 */
const MODES = [
  {
    id: 'off',
    label: '无联网无思考',
    webSearch: false,
    thinking: false,
    thinkingLevel: 'low',
    // 身份/能力说明（不依赖检索）
    prompt:
      '你好，你是谁？请用简体中文自我介绍：你是什么助手、能帮用户做什么。回答控制在 80～200 字，不要编造实时新闻。',
    check: (text) => {
      const t = text || '';
      if (t.length < 40) return { ok: false, reason: `太短(${t.length})` };
      if (/Claude Code|Anthropic AI 编程助手介绍/i.test(t) && !/助手|AI|模型|帮助/.test(t)) {
        return { ok: false, reason: '疑似历史话题污染' };
      }
      if (!/助手|AI|模型|帮助|对话|回答|我是/i.test(t)) {
        return { ok: false, reason: '未体现自我介绍' };
      }
      return { ok: true };
    },
  },
  {
    id: 'web',
    label: '仅联网',
    webSearch: true,
    thinking: false,
    thinkingLevel: 'low',
    prompt:
      '请联网查询今天深圳的天气概况（温度、天气现象即可），用一两句简体中文回答，不要粘贴 Search results 列表。',
    check: (text) => {
      const t = text || '';
      if (t.length < 12) return { ok: false, reason: `太短(${t.length})` };
      if (/^Search results for|^I'?ll search for/i.test(t.trim())) {
        return { ok: false, reason: '仍是原始检索 dump' };
      }
      if (!/深圳|天气|雨|晴|云|温|℃|度|湿度|风/i.test(t)) {
        return { ok: false, reason: '未含天气相关信息' };
      }
      return { ok: true };
    },
  },
  {
    id: 'think',
    label: '仅思考',
    webSearch: false,
    thinking: true,
    thinkingLevel: 'high',
    // 需推理的经典题（不依赖联网）
    prompt:
      '一个农场有鸡和兔子共 35 个头、94 只脚。鸡和兔子各有多少只？请先简要推理再给出答案，用简体中文。',
    check: (text, meta) => {
      const t = text || '';
      if (t.length < 20) return { ok: false, reason: `太短(${t.length})` };
      // 鸡 23、兔 12（或等价表述）
      const hasChicken = /鸡[^0-9]{0,12}23|23[^0-9]{0,8}鸡/.test(t);
      const hasRabbit = /兔[^0-9]{0,12}12|12[^0-9]{0,8}兔/.test(t);
      if (!(hasChicken && hasRabbit)) {
        // 宽松：正文同时出现 23 与 12
        if (!(/\b23\b/.test(t) && /\b12\b/.test(t))) {
          return { ok: false, reason: `答案不对: ${t.slice(0, 80)}` };
        }
      }
      return {
        ok: true,
        note:
          meta?.reasoningLen > 8
            ? `reasoning=${meta.reasoningLen}`
            : '无独立 reasoning 流（可能合并正文）',
      };
    },
  },
  {
    id: 'webthink',
    label: '联网+思考',
    webSearch: true,
    thinking: true,
    thinkingLevel: 'high',
    prompt:
      '请联网查一下 Anthropic 公司是哪一年成立的，用一两句简体中文回答，并说明依据来自公开信息。不要粘贴原始 Search results 编号列表。',
    check: (text) => {
      const t = text || '';
      if (t.length < 20) return { ok: false, reason: `太短(${t.length})` };
      if (/^Search results for|^I'?ll search for/i.test(t.trim())) {
        return { ok: false, reason: '仍是原始检索 dump' };
      }
      // 2021 成立为公开事实；允许「约 2021」等表述
      if (!/Anthropic|安索ropic|安索|2021|成立|创立/i.test(t)) {
        return { ok: false, reason: '未含 Anthropic/成立信息' };
      }
      return { ok: true };
    },
  },
];

const UPSTREAM_FLAKY_RE = /请多试|未能回复|出了一些问题|稍后再试|系统繁忙|认证异常/i;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mkId(modelApi, tag) {
  const slug = modelApi.replace(/[^a-z0-9]/gi, '').slice(0, 10);
  return `${USER_ID}_4m_${slug}_${tag}_${Date.now()}`.slice(0, 63);
}

function extractFromChunk(data) {
  if (!data || typeof data !== 'object') return { content: '', reasoning: '' };
  const contentParts = [
    data.content,
    data.text,
    data.message,
    data.data?.content,
    data.data?.response,
    data.delta?.content,
  ];
  const reasoningParts = [
    data.reasoning_content,
    data.reasoningContent,
    data.thinkingContent,
    data.data?.reasoning_content,
    data.delta?.reasoning_content,
  ];
  return {
    content: contentParts.filter((p) => typeof p === 'string' && p).join(''),
    reasoning: reasoningParts.filter((p) => typeof p === 'string' && p).join(''),
  };
}

async function streamChat(modelApi, message, opts = {}) {
  const body = {
    id: mkId(modelApi, opts.tag || 'req'),
    message,
    model: modelApi,
    tip: '请使用简体中文（中国大陆）回复。',
    webSearch: !!opts.webSearch,
    thinking: !!opts.thinking,
    thinkingLevel: opts.thinkingLevel || (opts.thinking ? 'high' : 'low'),
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': API_KEY },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
    }
    if (!res.body) throw new Error('empty body');

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let content = '';
    let reasoning = '';
    const deadline = Date.now() + TIMEOUT_MS;

    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        const pl = line.startsWith('data:') ? line.slice(5).trim() : line;
        if (!pl || pl === '[DONE]') continue;
        try {
          const data = JSON.parse(pl);
          if (data?.success === false && data?.message) throw new Error(String(data.message));
          const parts = extractFromChunk(data);
          content += parts.content;
          reasoning += parts.reasoning;
        } catch (e) {
          if (e instanceof SyntaxError && !pl.startsWith('{')) content += pl;
          else if (!(e instanceof SyntaxError)) throw e;
        }
      }
    }
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    return {
      content: content.trim(),
      reasoning: reasoning.trim(),
      full: `${reasoning}\n${content}`.trim(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 联网首轮若只返回 dump，做一次 summarize-only（对齐 ChatPanel 行为） */
async function maybeSummarizeWebDump(modelApi, userPrompt, first) {
  const text = (first.content || first.full || '').trim();
  const looksDump =
    text.length < 40 ||
    /^Search results for/i.test(text) ||
    /^I'?ll search for/i.test(text) ||
    (/https?:\/\//.test(text) && text.length < 120 && !/深圳|天气|Anthropic|成立/.test(text));
  if (!looksDump && text.length >= 40) return first;

  const summarizeMsg =
    `你是中文助手。请根据下方「用户问题」与「参考资料」写面向用户的完整回答。\n` +
    `要求：必须使用简体中文；不要复述 Search results 编号列表。\n\n` +
    `【用户问题】\n${userPrompt}\n\n` +
    `【参考资料】\n${text || '（检索为空）'}`;

  const second = await streamChat(modelApi, summarizeMsg, {
    tag: 'sum',
    webSearch: false,
    thinking: true,
    thinkingLevel: 'high',
  });
  return {
    content: second.content || second.full,
    reasoning: [first.reasoning, second.reasoning].filter(Boolean).join('\n'),
    full: second.full || second.content,
    summarized: true,
  };
}

async function resilient(modelApi, message, opts) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      let result = await streamChat(modelApi, message, opts);
      if (opts.webSearch) {
        result = await maybeSummarizeWebDump(modelApi, message, result);
      }
      const text = result.content || result.full;
      if (UPSTREAM_FLAKY_RE.test(text) && i < 2) {
        await sleep(2500);
        continue;
      }
      if (UPSTREAM_FLAKY_RE.test(text)) throw new Error(text.slice(0, 120));
      return result;
    } catch (e) {
      last = e;
      if (i < 2) await sleep(2500);
    }
  }
  throw last ?? new Error('resilient failed');
}

const results = [];

function record(model, modeId, modeLabel, ok, detail, extra = {}) {
  results.push({ model, modeId, modeLabel, ok, detail, ...extra });
  const flag = ok ? 'OK' : 'FAIL';
  console.log(`  [${flag}] ${modeLabel}${detail ? ` — ${String(detail).slice(0, 160)}` : ''}`);
}

console.log('\n=== LLM 四模式矩阵（国际通用问答）===');
console.log(`BASE: ${BASE}`);
console.log(`TIMEOUT: ${TIMEOUT_MS}ms\n`);

for (const m of MODELS) {
  console.log(`--- ${m.label} ---`);
  for (const mode of MODES) {
    try {
      const started = Date.now();
      const result = await resilient(m.api, mode.prompt, {
        tag: mode.id,
        webSearch: mode.webSearch,
        thinking: mode.thinking,
        thinkingLevel: mode.thinkingLevel,
      });
      const text = result.content || result.full;
      const verdict = mode.check(text, {
        reasoningLen: (result.reasoning || '').length,
        summarized: !!result.summarized,
      });
      record(m.label, mode.id, mode.label, !!verdict.ok, verdict.ok ? text.slice(0, 100) : verdict.reason, {
        ms: Date.now() - started,
        chars: text.length,
        reasoningLen: (result.reasoning || '').length,
        note: verdict.note,
        summarized: !!result.summarized,
      });
    } catch (e) {
      record(m.label, mode.id, mode.label, false, e instanceof Error ? e.message : String(e));
    }
    await sleep(800);
  }
  console.log('');
}

console.log('--- Qwen ---');
console.log('  [N/A] 四模式 — UI 禁用联网/思考，走独立 completions 通道\n');

console.log('=== 汇总表 ===');
const header = ['模型', ...MODES.map((x) => x.label)].join('\t');
console.log(header);
for (const m of MODELS) {
  const cells = MODES.map((mode) => {
    const r = results.find((x) => x.model === m.label && x.modeId === mode.id);
    return r?.ok ? '✓' : '✗';
  });
  console.log([m.label, ...cells].join('\t'));
}
console.log(['Qwen', '—', '—', '—', '—'].join('\t'));

const fail = results.filter((r) => !r.ok).length;
const pass = results.filter((r) => r.ok).length;
console.log(`\n=== ${results.length} 项实测, ${pass} 通过, ${fail} 失败 ===\n`);
if (fail > 0) {
  console.log('失败明细:');
  for (const r of results.filter((x) => !x.ok)) {
    console.log(`- ${r.model} / ${r.modeLabel}: ${r.detail}`);
  }
}
process.exit(fail > 0 ? 1 : 0);

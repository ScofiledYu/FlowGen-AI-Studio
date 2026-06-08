/**
 * 助手消息布局：正文 + 过程区（联网检索 / 思考），对齐主流产品的 tool/thinking 展示。
 * 存储格式：[正文]\n\n[联网检索]\n…\n\n[思考过程]\n…
 */

export const ASSISTANT_MARKER_WEB_SEARCH = '[联网检索]';
export const ASSISTANT_MARKER_THINKING = '[思考过程]';

/** 与 ChatPanel AITOP_* 提示语对齐，用于识别误当作检索词的内部说明 */
const INTERNAL_TIP_MARKERS = [
  '请使用简体中文',
  '不要使用繁体中文',
  '过程说明请用中文',
  'Search results for / I\'ll search for',
  '正文写面向用户的完整回答',
  'Please note that these are web search results',
];

function extractQuotedSearchQuery(line: string): string {
  const t = (line || '').trim();
  const m =
    t.match(/search results for\s*"([^"]*)"/i) ||
    t.match(/here are the search results for\s*"([^"]*)"/i) ||
    t.match(/i'?ll search for\s*"([^"]*)"/i) ||
    t.match(/"([^"]*)"/) ||
    t.match(/「([^」]*)」/);
  return m ? m[1].trim() : '';
}

/** 单行是否为系统 tip / 上游模板废话（不应展示给用户） */
export function isInternalPromptBoilerplateLine(line: string): boolean {
  const t = (line || '').trim();
  if (!t) return false;
  if (/^please note that these are web search results/i.test(t)) return true;
  if (/^may not be fully accurate or up-to-date/i.test(t)) return true;
  const markerHits = INTERNAL_TIP_MARKERS.filter((m) => t.includes(m)).length;
  if (markerHits >= 1) {
    if (isSearchProcessLine(t) || isSearchResultHeaderLine(t)) {
      const q = extractQuotedSearchQuery(t);
      return q ? isInternalPromptLeakQuery(q) : true;
    }
    return true;
  }
  if (/请使用简体中文/.test(t) && /search results|here are the search results/i.test(t)) return true;
  return false;
}

/** 去掉 tip 模板、Please note 等不应出现在过程区的文本（含误检索带来的来源列表） */
export function stripInternalPromptBoilerplate(text: string): string {
  let t = (text || '').replace(/\r\n/g, '\n');
  t = t.replace(/\.Here are the search results/gi, '.\n\nHere are the search results');
  t = t.replace(/\.Search results for/gi, '.\n\nSearch results for');
  t = t.replace(
    /[「「]?请使用简体中文[\s\S]*?(?:search results for|here are the search results)\s*"[^"]*"\s*:?/gi,
    ''
  );
  t = t.replace(/please note that these are web search results[^\n]*/gi, '');
  t = t.replace(/may not be fully accurate or up-to-date[^\n]*/gi, '');

  const lines = t.split('\n');
  const out: string[] = [];
  let skipping = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (isInternalPromptBoilerplateLine(trimmed)) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (!trimmed) continue;
      if (/^\d+\.\s/.test(trimmed) || /^Source:\s*https?:\/\//i.test(trimmed)) continue;
      if (/https?:\/\//i.test(trimmed)) continue;
      if (isSearchProcessLine(trimmed) || isSearchResultHeaderLine(trimmed)) {
        skipping = false;
        i--;
        continue;
      }
      skipping = false;
    }
    out.push(line);
  }
  return out.join('\n').trim();
}

/** 检索词疑似把系统 tip 当成了搜索内容 */
export function isInternalPromptLeakQuery(query: string): boolean {
  const q = (query || '').replace(/\s+/g, ' ').trim();
  if (!q) return false;
  const markerHits = INTERNAL_TIP_MARKERS.filter((m) => q.includes(m)).length;
  if (markerHits >= 2) return true;
  if (markerHits >= 1 && q.length >= 48) return true;
  if (/请使用简体中文/.test(q) && /过程说明|繁体|完整条目|web search results/i.test(q)) return true;
  return false;
}

/** 去掉误检索内部 tip 的过程行及其紧随的编号来源块 */
export function stripLeakedSearchBlocks(text: string): string {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let skipping = false;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (isInternalPromptBoilerplateLine(t)) {
      skipping = true;
      continue;
    }
    if (isSearchProcessLine(t) || isSearchResultHeaderLine(t)) {
      const q = extractQuotedSearchQuery(t);
      if (isInternalPromptLeakQuery(q)) {
        skipping = true;
        continue;
      }
      skipping = false;
      out.push(lines[i]);
      continue;
    }
    if (skipping) {
      if (!t) continue;
      if (/^\d+\.\s/.test(t) || /^Source:\s*https?:\/\//i.test(t)) continue;
      if (/https?:\/\//i.test(t)) continue;
      if (isSearchProcessLine(t) || isSearchResultHeaderLine(t)) {
        skipping = false;
        i--;
        continue;
      }
      skipping = false;
    }
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

function normalizeQueryKey(q: string): string {
  return (q || '').replace(/\s+/g, '').toLowerCase();
}

/** 过程区去重：完全相同的过程行只保留一条；preferredQuery 时剔除其它检索词的过程行 */
export function dedupeWebSearchProcessLines(text: string, preferredQuery?: string): string {
  const raw = stripLeakedSearchBlocks((text || '').replace(/\r\n/g, '\n').trim());
  if (!raw) return raw;

  const lines = raw.split('\n');
  const out: string[] = [];
  const seenExact = new Set<string>();
  const pq = normalizeQueryKey(preferredQuery || '');

  for (const line of lines) {
    const t = line.trim();
    if (!isSearchProcessLine(t) && !isSearchResultHeaderLine(t)) {
      out.push(line);
      continue;
    }
    const q = extractQuotedSearchQuery(t);
    if (q && isInternalPromptLeakQuery(q)) continue;
    if (pq && q) {
      const kq = normalizeQueryKey(q);
      if (kq !== pq && !kq.includes(pq) && !pq.includes(kq)) continue;
    }
    const exactKey = t.replace(/\s+/g, ' ').toLowerCase();
    if (seenExact.has(exactKey)) continue;
    seenExact.add(exactKey);
    out.push(line);
  }
  return out.join('\n').trim();
}

/** 清理过程区：剔除 tip 误检索、去重过程行 */
export function sanitizeWebSearchProcessText(text: string, preferredQuery?: string): string {
  return dedupeWebSearchProcessLines(
    stripLeakedSearchBlocks(stripInternalPromptBoilerplate(text)),
    preferredQuery
  );
}

export type AssistantMessageSections = {
  main: string;
  webSearch: string;
  thinking: string;
};

export function composeAssistantMessage(sections: AssistantMessageSections): string {
  const parts: string[] = [];
  const main = (sections.main || '').trim();
  const webSearch = (sections.webSearch || '').trim();
  const thinking = (sections.thinking || '').trim();
  if (main) parts.push(main);
  if (webSearch) parts.push(`${ASSISTANT_MARKER_WEB_SEARCH}\n${webSearch}`);
  if (thinking) parts.push(`${ASSISTANT_MARKER_THINKING}\n${thinking}`);
  return parts.join('\n\n');
}

export function parseAssistantMessage(text: string): AssistantMessageSections {
  let rest = (text || '').replace(/\r\n/g, '\n');
  let webSearch = '';
  let thinking = '';

  const pull = (marker: string): void => {
    const midToken = `\n\n${marker}\n`;
    const headToken = `${marker}\n`;
    let idx = rest.indexOf(midToken);
    let tokenLen = midToken.length;
    if (idx < 0 && rest.startsWith(headToken)) {
      idx = 0;
      tokenLen = headToken.length;
    }
    if (idx < 0) return;
    const block = rest.slice(idx + tokenLen);
    const nextMain = rest.slice(0, idx).trimEnd();
    const nextMarkerIdx = block.search(/\n\n\[(?:联网检索|思考过程)\]\n/);
    const body = (nextMarkerIdx >= 0 ? block.slice(0, nextMarkerIdx) : block).trim();
    if (marker === ASSISTANT_MARKER_WEB_SEARCH) webSearch = body;
    else thinking = body;
    rest = nextMain;
  };

  pull(ASSISTANT_MARKER_THINKING);
  pull(ASSISTANT_MARKER_WEB_SEARCH);

  return { main: rest.trim(), webSearch, thinking };
}

const THINKING_HEADING_ZH: Record<string, string> = {
  "ambiguity's parameters": '暧昧话题边界',
  'boundary definition': '边界界定',
  'safety constraints': '安全边界',
  'safety boundary': '安全边界',
  'response strategy': '回答策略',
  'content boundaries': '内容边界',
};

function localizeThinkingBoldHeading(inner: string): string {
  const raw = inner.trim();
  if (!raw) return raw;
  const key = raw.replace(/\s+/g, ' ').toLowerCase();
  if (THINKING_HEADING_ZH[key]) return THINKING_HEADING_ZH[key];
  if (/^considering\b/i.test(raw)) {
    const rest = raw.replace(/^considering\s*/i, '').trim();
    return rest ? `考量：${THINKING_HEADING_ZH[rest.toLowerCase()] || rest}` : '考量';
  }
  if (/^refining\b/i.test(raw)) {
    const rest = raw.replace(/^refining\s*/i, '').trim();
    return rest ? `细化：${THINKING_HEADING_ZH[rest.toLowerCase()] || rest}` : '细化';
  }
  if (/^defining\b/i.test(raw)) return `界定：${raw.replace(/^defining\s*/i, '').trim()}`;
  if (/^evaluating\b/i.test(raw)) return `评估：${raw.replace(/^evaluating\s*/i, '').trim()}`;
  if (/^exploring\b/i.test(raw)) return `探索：${raw.replace(/^exploring\s*/i, '').trim()}`;
  if (/^assessing\b/i.test(raw)) return `评估：${raw.replace(/^assessing\s*/i, '').trim()}`;
  if (/^determining\b/i.test(raw)) return `判断：${raw.replace(/^determining\s*/i, '').trim()}`;
  if (/[\u4e00-\u9fff]/.test(raw) && /[A-Za-z]{3,}/.test(raw)) {
    return raw
      .replace(/Ambiguity's Parameters/gi, '暧昧话题边界')
      .replace(/Boundary Definition/gi, '边界界定')
      .replace(/Safety(?:\s+Constraints)?/gi, '安全边界');
  }
  if (/^[A-Za-z][A-Za-z\s'’,.-]{2,}$/.test(raw)) {
    return THINKING_HEADING_ZH[key] || raw;
  }
  return raw;
}

/** 展示层：思考过程常见英文标题/句式 → 简体中文标签（不改动实质内容） */
export function localizeThinkingProcessForDisplay(text: string): string {
  let out = (text || '').replace(/\r\n/g, '\n');
  const phraseMap: Array<[RegExp, string | ((m: string) => string)]> = [
    [/^\*\*Analyzing(?: the request)?\*\*/gim, '**分析请求**'],
    [/^\*\*Analysis\*\*/gim, '**分析**'],
    [/^\*\*Planning(?: the response)?\*\*/gim, '**规划回答**'],
    [/^\*\*Researching\*\*/gim, '**检索与整理**'],
    [/^\*\*Synthesizing\*\*/gim, '**综合结论**'],
    [/^\*\*Thinking\*\*/gim, '**思考**'],
    [/^\*\*Reasoning\*\*/gim, '**推理**'],
    [/^\*\*Thought process\*\*/gim, '**思考过程**'],
    [/^[\u4e00-\u9fffA-Za-z]{0,8}自然语言思考过程\s*[：:]?/gim, '**思考过程**'],
    [/^RYa自然语言思考过程\s*[：:]?/gim, '**思考过程**'],
    [/^\*\*Brainstorming\*\*/gim, '**构思**'],
    [/^\*\*Reflecting\*\*/gim, '**反思**'],
    [/^\*\*Drafting(?: the response)?\*\*/gim, '**起草回答**'],
    [/^\*\*Refining(?: the response)?\*\*/gim, '**润色回答**'],
    [/^\*\*Gathering (?:information|context)\*\*/gim, '**收集信息**'],
    [/^\*\*Checking(?:\s+[^*]+)?\*\*/gim, '**核对**'],
    [/^\*\*Verifying(?:\s+[^*]+)?\*\*/gim, '**验证**'],
    [/^\*\*Breaking down\b[^*]*\*\*/gim, '**拆解问题**'],
    [/^\*\*Exploring\b[^*]*\*\*/gim, '**探索**'],
    [/^\*\*Considering\b[^*]*\*\*/gim, '**考量话题边界**'],
    [/^\*\*Refining\b[^*]*\*\*/gim, '**细化边界**'],
    [/^\*\*Defining\b[^*]*\*\*/gim, '**界定概念**'],
    [/^\*\*Assessing\b[^*]*\*\*/gim, '**评估**'],
    [/^\*\*Determining\b[^*]*\*\*/gim, '**判断**'],
    [/^\*\*考量\s+[A-Za-z][^*]*\*\*/gim, '**考量话题边界**'],
    [/^\*\*Step\s+(\d+)\s*[:\-]?\s*([^*]*)\*\*/gim, '**步骤 $1：** $2'],
    [/^I'm wrestling with\b/gim, '我在权衡'],
    [/^I'm now zeroing in on\b/gim, '我正在聚焦'],
    [/^I'm zeroing in on\b/gim, '我正在聚焦'],
    [/^I'm focusing on\b/gim, '我正在关注'],
    [/^I need to define\b/gim, '我需要界定'],
    [/^I need to establish\b/gim, '我需要明确'],
    [/^I should avoid\b/gim, '我应避免'],
    [/^I must avoid\b/gim, '我必须避免'],
    [/^I have to avoid\b/gim, '我必须避免'],
    [/^My focus is\b/gim, '我的重点是'],
    [/^My approach is\b/gim, '我的思路是'],
    [/^The challenge is\b/gim, '难点在于'],
    [/^The key is\b/gim, '关键在于'],
    [/^Safety constraints\b/gim, '安全边界'],
    [/^I'll search for\s*"([^"]*)"\s*:?/gim, '正在检索：「$1」'],
    [/^I will search for\s*"([^"]*)"\s*:?/gim, '正在检索：「$1」'],
    [/^Let me search for\s*"([^"]*)"\s*:?/gim, '正在检索：「$1」'],
    [/^I'm searching for\s*"([^"]*)"\s*:?/gim, '正在检索：「$1」'],
    [/^I should search for\s*"([^"]*)"\s*:?/gim, '需要检索：「$1」'],
    [/^The user (?:is asking|wants|asked)\b/gim, '用户询问'],
    [/^Based on (?:the )?search results/gim, '根据检索结果'],
    [/^According to (?:the )?search/gim, '根据检索'],
    [/^In summary\b/gim, '总结'],
    [/^To summarize\b/gim, '总结'],
    [/^My goal is to\b/gim, '目标是'],
    [/^I need to\b/gim, '我需要'],
    [/^I'm going to\b/gim, '我将'],
    [/^I am going to\b/gim, '我将'],
    [/^I will\b/gim, '我将'],
    [/^I'll\b/gim, '我将'],
    [/^\*\*Looking at\b[^*]*\*\*/gim, '**查看**'],
    [/^\*\*Understanding\b[^*]*\*\*/gim, '**理解**'],
    [/^\*\*Evaluating\b[^*]*\*\*/gim, '**评估**'],
    [/^\*\*Formulating\b[^*]*\*\*/gim, '**组织回答**'],
    [/^Let me (?:now )?/gim, '让我'],
    [/^First,/gim, '首先，'],
    [/^Next,/gim, '接下来，'],
    [/^Then,/gim, '然后，'],
    [/^Finally,/gim, '最后，'],
    [/^Additionally,/gim, '此外，'],
    [/^However,/gim, '不过，'],
  ];
  for (const [re, rep] of phraseMap) {
    out = typeof rep === 'string' ? out.replace(re, rep) : out.replace(re, rep);
  }
  out = out.replace(/^\*\*([^*\n]+)\*\*$/gim, (full, inner) => {
    const zh = localizeThinkingBoldHeading(inner);
    return zh !== inner.trim() ? `**${zh}**` : full;
  });
  return out;
}

/** 展示层：保留原文，仅将常见英文检索句式加上中文标签（不删 Search results / I'll search for） */
export function localizeWebSearchProcessForDisplay(
  text: string,
  opts?: { completed?: boolean; preferredQuery?: string }
): string {
  let out = sanitizeWebSearchProcessText(text || '', opts?.preferredQuery)
    .replace(/^Search results for\s*"([^"]*)"\s*:?/gim, '检索结果：「$1」')
    .replace(/^I'll search for\s*"([^"]*)"\s*:?/gim, '正在检索：「$1」')
    .replace(/^I will search for\s*"([^"]*)"\s*:?/gim, '正在检索：「$1」')
    .replace(/^Let me search for\s*"([^"]*)"\s*:?/gim, '正在检索：「$1」')
    .replace(/^Searching for\s*"([^"]*)"\s*:?/gim, '正在检索：「$1」')
    .replace(/^Here are the search results\s*:?/gim, '检索结果如下：');
  if (opts?.completed) {
    out = out.replace(/^正在检索：/gm, '检索完成：');
  }
  return out;
}

/** 面向用户的中文分节回答（含一、二、三或 ### 标题），勿当作检索列表 */
export function looksLikeChineseStructuredAnswer(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (/^#{1,3}\s*[一二三四五六七八九十\d]+[、．.]/.test(t)) return true;
  if (/^#{1,3}\s*第[一二三四五六七八九十\d]+/.test(t)) return true;
  if (/\n#{1,3}\s*[一二三四五六七八九十\d]+[、．.]/.test(t)) return true;
  if (/^[一二三四五六七八九十]+[、．.]/.test(t)) return true;
  return false;
}

function looksLikeNumberedSearchList(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (looksLikeChineseStructuredAnswer(t)) return false;
  if (/^\d+[.、．]\s/m.test(t) && /https?:\/\//i.test(t)) return true;
  return (
    /^\d+[.、．]\s+\*\*/m.test(t) ||
    /^\d+[.、．]\s+[^\n]+\n\s*https?:\/\//im.test(t) ||
    (/https?:\/\/[^\s]+%[0-9A-Fa-f]{2}/i.test(t) && /^\d+[.、．]\s/m.test(t))
  );
}

/** 正文含长链接/百分号编码 URL，多为未总结的检索粘贴 */
export function mainHasRawSearchCitation(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (/https?:\/\/[^\s]{120,}/i.test(t)) return true;
  if (/https?:\/\/[^\s]*(?:%[0-9A-Fa-f]{2}){2,}/i.test(t)) return true;
  return false;
}

/** 替换字符 / 常见乱码（UTF-8 解码失败） */
export function hasReplacementCharMojibake(text: string): boolean {
  return /\uFFFD/.test(text || '') || /[\uE000-\uF8FF]/.test(text || '');
}

const TRAD_ONLY_CHARS = /[體臺廣縣區醫學舊車點訪藝術館麗江廢棄]/;

/** 繁体特征明显且缺少简体分节结构 → 倾向未按提示词本地化 */
export function isLikelyTraditionalChineseHeavy(text: string): boolean {
  const t = (text || '').trim();
  if (!t || t.length < 24) return false;
  const tradHits = (t.match(new RegExp(TRAD_ONLY_CHARS.source, 'g')) || []).length;
  if (tradHits < 2) return false;
  if (looksLikeChineseStructuredAnswer(t)) return false;
  return true;
}

/** 正文是否含连续问号占位（模型未写出具体数值） */
export function hasQuestionMarkPlaceholder(text: string): boolean {
  const t = (text || '').replace(/\r\n/g, '\n');
  return /(?:^|\n)\s*[\?？]{4,}\s*(?:\n|$)/m.test(t) || /[\?？]{6,}/.test(t);
}

/** 展示层：去掉替换字符、问号占位行与孤立乱码 */
export function sanitizeAssistantDisplayText(text: string): string {
  const placeholderHint = '（该指标在检索摘要中无法可靠解析，请查看「检索来源」。）';
  return (text || '')
    .replace(/\uFFFD/g, '')
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (/^[\?？]{3,}$/.test(trimmed)) return placeholderHint;
      return line.replace(/[\?？]{5,}/g, '（数值暂未解析）');
    })
    .join('\n');
}

/** 无「正在检索」时从检索标题推断并补全过程行 */
export function ensureWebSearchProcessLines(webSearch: string): string {
  const text = (webSearch || '').trim();
  if (!text) return text;
  if (/^(正在检索|i'?ll search for|i will search for|let me search|searching for)/im.test(text)) {
    return text;
  }
  const m =
    text.match(/^Search results for\s*"([^"]*)"/im) ||
    text.match(/^检索结果：「([^」]*)」/m);
  if (!m) return text;
  return `I'll search for "${m[1]}".\n\n${text}`;
}

/** 展示层：过程（正在检索）与来源列表分开 */
export function splitWebSearchForDisplay(text: string): { process: string; sources: string } {
  const normalized = ensureWebSearchProcessLines((text || '').trim());
  if (!normalized) return { process: '', sources: '' };

  const lines = normalized.split('\n');
  const processLines: string[] = [];
  const sourceLines: string[] = [];
  let inSources = false;

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (inSources && sourceLines.length) sourceLines.push('');
      continue;
    }
    if (isInternalPromptBoilerplateLine(t)) continue;
    if (!inSources && isSearchProcessLine(t) && !isSearchResultHeaderLine(t)) {
      processLines.push(line);
      continue;
    }
    if (isSearchResultHeaderLine(t)) {
      inSources = true;
      continue;
    }
    if (/^\d+[.、．]\s/.test(t) || /^Source:\s*https?:\/\//i.test(t)) {
      inSources = true;
      sourceLines.push(line);
      continue;
    }
    if (inSources) {
      sourceLines.push(line);
      continue;
    }
    if (/https?:\/\//i.test(t)) {
      inSources = true;
      sourceLines.push(line);
      continue;
    }
    if (!isInternalPromptBoilerplateLine(t)) processLines.push(line);
  }

  return {
    process: sanitizeWebSearchProcessText(processLines.join('\n').trim()),
    sources: sourceLines.join('\n').trim(),
  };
}

/** 联网首轮：用实际发出的检索词补「正在检索」过程行 */
export function augmentWebSearchWithProbeQuery(composed: string, probeQuery: string): string {
  const q = (probeQuery || '').trim();
  if (!q) return composed;
  const sections = parseAssistantMessage(composed);
  let ws = ensureWebSearchProcessLines(sections.webSearch);
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasProbeIntent =
    new RegExp(`search for\\s*"${escaped}"`, 'i').test(ws) || new RegExp(`「${escaped}」`).test(ws);
  if (!hasProbeIntent) {
    const probeLine = `I'll search for "${q}".`;
    ws = ws ? `${probeLine}\n\n${ws}` : probeLine;
  }
  ws = sanitizeWebSearchProcessText(ws, q);
  return composeAssistantMessage({ ...sections, webSearch: ws });
}

function isSearchResultHeaderLine(line: string): boolean {
  const t = (line || '').trim();
  return (
    /^search results for\s*"/i.test(t) ||
    /^here are the search results/i.test(t) ||
    /^检索结果：「/.test(t) ||
    /^检索结果如下/.test(t)
  );
}

/** Gemini 等模型在正文里写的中文思考标题（非 [思考过程] 标记） */
function isChineseThinkingHeaderLine(line: string): boolean {
  const t = (line || '').trim();
  if (!t) return false;
  if (isSearchProcessLine(t)) return false;
  return (
    /自然语言思考过程/.test(t) ||
    /^#{1,3}\s*[\u4e00-\u9fffA-Za-z0-9]{0,12}思考[\u4e00-\u9fff]*/.test(t) ||
    /^[\u4e00-\u9fffA-Za-z]{0,8}思考过程\s*[：:]/u.test(t) ||
    /^\*\*[\u4e00-\u9fff][^*\n]{0,48}\*\*\s*[：:]?$/u.test(t)
  );
}

function isThinkingProcessLine(line: string): boolean {
  const t = (line || '').trim();
  if (!t) return false;
  if (isSearchProcessLine(t)) return false;
  return (
    isChineseThinkingHeaderLine(t) ||
    /^\*\*[A-Za-z][^*]+\*\*/.test(t) ||
    /^I(?:'m| am| need| will|'ll|'ve)\b/i.test(t) ||
    /^My goal\b/i.test(t) ||
    /^Let me\b/i.test(t)
  );
}

/** 思考段结束、面向用户的正文开始 */
function isLikelyFinalAnswerStartLine(line: string): boolean {
  const t = (line || '').trim();
  if (!t) return false;
  if (isChineseThinkingHeaderLine(t) || isThinkingProcessLine(t)) return false;
  if (isSearchProcessLine(t)) return false;
  if (/^根据(您|你|以上|检索|搜索|分析|现有|所查)/.test(t)) return true;
  if (/^以下(是|为|将)/.test(t)) return true;
  if (/^综上[，,]/.test(t)) return true;
  if (/^#{1,3}\s+[^#]/.test(t) && !/思考|分析搜索|组织回答|检索过程/.test(t)) return true;
  return false;
}

/** 从正文首部拆出 Gemini 中文思考块（联网检索已单独进过程区时常见） */
function extractChineseThinkingPrefixFromMain(main: string): { main: string; thinking: string } {
  const text = (main || '').replace(/\r\n/g, '\n').trim();
  if (!text) return { main: '', thinking: '' };

  const lines = text.split('\n');
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (isChineseThinkingHeaderLine(lines[i].trim())) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return { main: text, thinking: '' };

  let answerIdx = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (!ln) continue;
    if (isLikelyFinalAnswerStartLine(ln)) {
      answerIdx = i;
      break;
    }
  }

  const thinking = lines.slice(headerIdx, answerIdx).join('\n').trim();
  const before = lines.slice(0, headerIdx).join('\n').trim();
  const tail = lines.slice(answerIdx).join('\n').trim();
  if (!thinking || thinking.length < 6) return { main: text, thinking: '' };

  const mainOut = [before, tail].filter(Boolean).join('\n\n').trim();
  return { main: mainOut, thinking };
}

function isSearchProcessLine(line: string): boolean {
  const t = (line || '').trim();
  if (!t) return false;
  return (
    isSearchResultHeaderLine(t) ||
    /^i'?ll search for\s*"/i.test(t) ||
    /^i will search for\s*"/i.test(t) ||
    /^let me search\b/i.test(t) ||
    /^searching for\b/i.test(t) ||
    /^no results found\b/i.test(t) ||
    /web search results/i.test(t) ||
    /^正在检索/.test(t)
  );
}

function isWebSearchEvidenceLine(line: string): boolean {
  const t = (line || '').trim();
  if (!t) return false;
  if (isSearchResultHeaderLine(t)) return true;
  if (/^source:\s*https?:\/\//i.test(t)) return true;
  if (/^https?:\/\//i.test(t)) return true;
  if (/^\d+\.\s+\*\*.*\*\*\s*$/i.test(t)) return true;
  if (/^\d+\.\s+https?:\/\//i.test(t)) return true;
  return false;
}

/**
 * 「思考+联网」并存时：
 * - 把「I'll search.../Searching...」这类推理过程移动到思考区
 * - 联网区仅保留真实检索结果/来源证据，避免看起来像“思考丢失”
 */
function rebalanceWebSearchAndThinking(
  webSearch: string,
  thinking: string,
  collectApiReasoning?: boolean
): { webSearch: string; thinking: string } {
  const wsText = (webSearch || '').replace(/\r\n/g, '\n').trim();
  if (!wsText) return { webSearch: '', thinking: (thinking || '').trim() };
  if (!collectApiReasoning) return { webSearch: wsText, thinking: (thinking || '').trim() };

  const lines = wsText.split('\n');
  const webLines: string[] = [];
  const movedThinkingLines: string[] = [];
  let hasEvidence = false;

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      webLines.push(line);
      continue;
    }
    const evidence = isWebSearchEvidenceLine(t);
    if (evidence) {
      hasEvidence = true;
      webLines.push(line);
      continue;
    }
    if (isSearchProcessLine(t)) {
      movedThinkingLines.push(t);
      continue;
    }
    webLines.push(line);
  }

  const nextWebSearch = hasEvidence ? webLines.join('\n').trim() : '';
  const movedThinking = movedThinkingLines.join('\n').trim();
  const baseThinking = (thinking || '').trim();
  const nextThinking = [movedThinking, baseThinking].filter(Boolean).join('\n\n').trim();
  return { webSearch: nextWebSearch, thinking: nextThinking };
}

/** 从正文中拆出「检索过程块」（含 Search results 列表） */
export function extractWebSearchBlockFromMain(main: string): { main: string; webSearch: string } {
  const text = (main || '').replace(/\r\n/g, '\n').trim();
  if (!text) return { main: '', webSearch: '' };

  if (!/^search results for\s*"/i.test(text) && !/^i'?ll search for\s*"/i.test(text)) {
    const lines = text.split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      if (isSearchProcessLine(lines[i])) {
        start = i;
        break;
      }
    }
    if (start < 0) return { main: text, webSearch: '' };

    let end = start;
    while (end < lines.length) {
      const ln = lines[end].trim();
      if (!ln) {
        if (end + 1 < lines.length && !isSearchProcessLine(lines[end + 1])) {
          const nxt = lines[end + 1].trim();
          const zh = (nxt.match(/[\u4e00-\u9fa5]/g) || []).length;
          if (zh >= 6 && !isSearchProcessLine(nxt) && !isThinkingProcessLine(nxt)) break;
        }
        end++;
        continue;
      }
      if (
        end > start &&
        !isSearchProcessLine(ln) &&
        !/https?:\/\//i.test(ln) &&
        !/^\d+\.\s/.test(ln)
      ) {
        const zh = (ln.match(/[\u4e00-\u9fa5]/g) || []).length;
        if (zh >= 6 && !isThinkingProcessLine(ln)) break;
      }
      end++;
    }
    const webSearch = lines.slice(start, end).join('\n').trim();
    const rest = [...lines.slice(0, start), ...lines.slice(end)].join('\n').trim();
    return { main: rest, webSearch };
  }

  const lines = text.split('\n');
  let splitAt = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (!ln) continue;
    if (isSearchProcessLine(ln) || isThinkingProcessLine(ln)) continue;
    const zh = (ln.match(/[\u4e00-\u9fa5]/g) || []).length;
    if (zh >= 6) {
      splitAt = i;
      break;
    }
  }
  if (splitAt >= lines.length) return { main: '', webSearch: text };
  const webSearch = lines.slice(0, splitAt).join('\n').trim();
  const rest = lines.slice(splitAt).join('\n').trim();
  return { main: rest, webSearch };
}

function headLooksLikeChineseAnswer(head: string): boolean {
  if (/^#{1,3}\s*[一二三四五六七八九十\d]+[、．.]/.test(head)) return true;
  if (/^#{1,3}\s*第[一二三四五六七八九十\d]+/.test(head)) return true;
  if ((head.match(/[\u4e00-\u9fa5]/g) || []).length >= 24) return true;
  return false;
}

/** 从正文拆出模型写在 content 里的思考（含 Gemini 中文「思考过程」标题段） */
export function extractThinkingBlockFromMain(main: string): { main: string; thinking: string } {
  const text = (main || '').replace(/\r\n/g, '\n').trim();
  if (!text) return { main: '', thinking: '' };

  const zhPrefix = extractChineseThinkingPrefixFromMain(text);
  if (zhPrefix.thinking.trim()) return zhPrefix;

  const lines = text.split('\n');
  let splitAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (!ln) continue;
    if (isSearchProcessLine(ln)) continue;
    const zh = (ln.match(/[\u4e00-\u9fa5]/g) || []).length;
    if (isThinkingProcessLine(ln)) continue;
    if (zh >= 4) {
      splitAt = i;
      break;
    }
  }
  if (splitAt <= 0) return { main: text, thinking: '' };

  const head = lines.slice(0, splitAt).join('\n').trim();
  const tail = lines.slice(splitAt).join('\n').trim();
  if (!head || head.length < 12) return { main: text, thinking: '' };
  if (headLooksLikeChineseAnswer(head)) return { main: text, thinking: '' };

  const hasThinkingCue = head.split('\n').some((l) => isThinkingProcessLine(l.trim()));
  if (!hasThinkingCue) return { main: text, thinking: '' };

  const headZh = (head.match(/[\u4e00-\u9fa5]/g) || []).length;
  const headLen = head.replace(/\s/g, '').length;
  if (headLen > 0 && headZh / headLen > 0.12) return { main: text, thinking: '' };

  return { main: tail || text, thinking: head };
}

/** 展示/渲染前：若缺少 [思考过程] 标记，尝试从正文再拆一次（兼容旧消息与 Gemini 中文思考） */
export function resolveAssistantDisplaySections(text: string): AssistantMessageSections {
  const first = parseAssistantMessage(text || '');
  if (first.thinking.trim() || !first.main.trim()) return first;
  const normalized = normalizeAssistantStream({
    content: text || '',
    apiReasoning: '',
    collectApiReasoning: false,
    allowWebSearchExtractFromMain: true,
  });
  if (normalized.thinking.trim()) return normalized;
  return first;
}

export function isLikelyRawWebSearchDump(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (/^no results found\b[.!?。！？]*$/i.test(t)) return true;
  if (/^未找到相关结果[。！？!?.]*$/.test(t)) return true;
  if (/^Search results for\s*"/i.test(t)) return true;
  if (/^检索结果：「/.test(t)) return true;
  if (/Here are the search results/i.test(t)) return true;
  const hits = [
    /\n\d+\.\s+\*\*.*\*\*\s*\n\s*https?:\/\//i.test(t),
    /No results found/i.test(t),
    /web search results/i.test(t),
  ].filter(Boolean).length;
  return hits >= 2;
}

export function isLikelyTooShortMainAnswer(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return true;
  if (t.length <= 24) return true;
  if (/^no results found\b[.!?。！？]*$/i.test(t)) return true;
  if (/^未找到相关结果[。！？!?.]*$/.test(t)) return true;
  return false;
}

/** 流式/最终：统一拆成 正文 + 联网检索 + 思考 */
export function normalizeAssistantStream(params: {
  content: string;
  apiReasoning?: string;
  collectApiReasoning?: boolean;
  /** 已有独立 reasoning 流时，勿再从正文启发式拆思考（避免正文缺段） */
  skipExtractThinkingFromMain?: boolean;
  /** 仅在启用联网搜索时，才从正文启发式抽取检索过程，避免把思考误判为检索 */
  allowWebSearchExtractFromMain?: boolean;
}): AssistantMessageSections {
  const parsed = parseAssistantMessage(params.content || '');
  let main = parsed.main;
  let webSearch = parsed.webSearch;
  let thinking = parsed.thinking;

  if (params.collectApiReasoning && (params.apiReasoning || '').trim()) {
    thinking = thinking
      ? `${thinking}\n\n${params.apiReasoning!.trim()}`.trim()
      : params.apiReasoning!.trim();
  }

  if (params.allowWebSearchExtractFromMain !== false) {
    const ws = extractWebSearchBlockFromMain(main);
    main = ws.main;
    webSearch = webSearch ? `${webSearch}\n\n${ws.webSearch}`.trim() : ws.webSearch;
  }

  const hasApiReasoning = !!(params.apiReasoning || '').trim();
  if (!params.skipExtractThinkingFromMain && !(params.collectApiReasoning && hasApiReasoning)) {
    const th = extractThinkingBlockFromMain(main);
    main = th.main;
    thinking = thinking ? `${thinking}\n\n${th.thinking}`.trim() : th.thinking;
  }

  webSearch = sanitizeWebSearchProcessText(ensureWebSearchProcessLines(webSearch));
  const rebalanced = rebalanceWebSearchAndThinking(webSearch, thinking, params.collectApiReasoning);
  webSearch = rebalanced.webSearch;
  thinking = rebalanced.thinking;

  return { main, webSearch, thinking };
}

export function isDetailRichUserQuestion(question: string): boolean {
  const q = (question || '').trim();
  return /行程|攻略|第[一二三四五六七八九十\d]+天|第二天|第三天|几日游|规划|安排|景点/.test(q);
}

/** 正文多处用省略号敷衍（常见于模型偷懒或上文被截断后的模仿） */
export function isLikelyEllipsisHeavyAnswer(main: string, userQuestion = ''): boolean {
  const t = (main || '').trim();
  if (!t || !isDetailRichUserQuestion(userQuestion)) return false;
  const ellipsisCount = (t.match(/\.{3,}|…/g) || []).length;
  if (ellipsisCount >= 2) return true;
  if (/第[一二三四五六七八九十\d]+天[^。\n]{0,80}(…|\.{3,})/m.test(t)) return true;
  return false;
}

/** 正文几乎全是编号检索列表/链接，没有面向用户的中文回答（列表内中文摘要不算正文） */
export function isLikelyMainOnlySearchDump(main: string): boolean {
  const t = (main || '').trim();
  if (!t) return false;
  if (looksLikeChineseStructuredAnswer(t)) return false;
  if (/^Search results for\s*"/i.test(t) || /^检索结果：「/.test(t)) return true;
  if (mainHasRawSearchCitation(t) && /^\d+[.、．]\s/m.test(t)) return true;

  const firstNumIdx = t.search(/^\d+[.、．]\s/m);
  if (firstNumIdx < 0) {
    return looksLikeNumberedSearchList(t) || (mainHasRawSearchCitation(t) && !/^[一二三四五六七八九十]+[、．.]/.test(t));
  }

  const tail = t.slice(firstNumIdx).trim();
  const tailIsSearchList =
    looksLikeNumberedSearchList(tail) ||
    (isLikelyRawWebSearchDump(tail) && /https?:\/\//i.test(tail)) ||
    mainHasRawSearchCitation(tail);

  if (firstNumIdx > 0) {
    const head = t.slice(0, firstNumIdx).trim();
    if (tailIsSearchList) {
      if (head.length < 80 || !looksLikeChineseStructuredAnswer(head)) return true;
      const headLines = head.split(/\n+/).filter((l) => l.trim()).length;
      if (headLines <= 2 && !/^#{1,3}\s/m.test(head)) return true;
    }
    if (
      head.length >= 36 &&
      /[\u4e00-\u9fa5]{10,}/.test(head) &&
      !/^Search results/i.test(head) &&
      !tailIsSearchList
    ) {
      return false;
    }
  }

  const numberedHits = (t.match(/^\d+[.、．]\s+/gm) || []).length;
  return numberedHits >= 2 || (firstNumIdx === 0 && looksLikeNumberedSearchList(t));
}

/** 联网首轮若仅有检索快照、缺少中文正文 → 需二次总结 */
export function needsWebSearchSynthesisPass(
  sections: AssistantMessageSections,
  userQuestion = ''
): boolean {
  const main = (sections.main || '').trim();
  const process = (sections.webSearch || '').trim();
  if (!process && isLikelyRawWebSearchDump(main)) return true;
  if (process && isLikelyTooShortMainAnswer(main)) return true;
  if (!main && process) return true;
  if (main && isLikelyRawWebSearchDump(main) && main.length < 200) return true;
  if (isLikelyMainOnlySearchDump(main)) return true;
  if (main && mainHasRawSearchCitation(main) && !looksLikeChineseStructuredAnswer(main)) return true;
  if (main && hasReplacementCharMojibake(main)) return true;
  if (main && hasQuestionMarkPlaceholder(main)) return true;
  if (main && isLikelyTraditionalChineseHeavy(main)) return true;
  if (isLikelyEllipsisHeavyAnswer(main, userQuestion)) return true;
  return false;
}

/** 联网首轮：先合并正文里的检索列表，再判断是否需要总结 */
export function prepareWebSearchFirstPassContent(
  composed: string,
  userQuestion = ''
): {
  content: string;
  sections: AssistantMessageSections;
  needsSummarize: boolean;
} {
  const content = consolidateWebSearchDumpContent(composed);
  const sections = parseAssistantMessage(content);
  return {
    content,
    sections,
    needsSummarize: needsWebSearchSynthesisPass(sections, userQuestion),
  };
}

/** 首轮若把检索列表写在正文里，合并进 webSearch 以便总结后仍能展示「检索来源」 */
export function consolidateWebSearchSections(sections: AssistantMessageSections): AssistantMessageSections {
  let { main, webSearch, thinking } = sections;
  const mainTrim = (main || '').trim();
  if (
    mainTrim &&
    !looksLikeChineseStructuredAnswer(mainTrim) &&
    (isLikelyRawWebSearchDump(mainTrim) || looksLikeNumberedSearchList(mainTrim))
  ) {
    webSearch = webSearch ? `${webSearch}\n\n${mainTrim}`.trim() : mainTrim;
    main = '';
  }
  webSearch = sanitizeWebSearchProcessText(ensureWebSearchProcessLines(webSearch));
  return { main, webSearch, thinking };
}

export function consolidateWebSearchDumpContent(composed: string): string {
  const sections = normalizeAssistantStream({
    content: composed,
    apiReasoning: '',
    collectApiReasoning: false,
  });
  return composeAssistantMessage(consolidateWebSearchSections(sections));
}

/** 从思考过程区摘取可读中文句（总结失败但推理区有完整分析时） */
function extractChineseProseFromThinking(thinking: string, userQuestion = ''): string {
  const lines = stripInternalPromptBoilerplate(stripLeakedSearchBlocks(thinking))
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const prose: string[] = [];
  for (const ln of lines) {
    if (/^i'?ll search/i.test(ln)) continue;
    if (/^search results/i.test(ln)) continue;
    if (/^https?:\/\//i.test(ln)) continue;
    if (/^Source:/i.test(ln)) continue;
    if (/^正在检索：|^检索完成：|^检索结果/.test(ln)) continue;
    if (/^[-*•]\s/.test(ln) && ln.length < 28) continue;
    if (/[\u4e00-\u9fff]{6,}/.test(ln) && ln.length >= 16) prose.push(ln);
    if (prose.length >= 14) break;
  }
  if (prose.length < 2) return '';
  const body = prose.slice(-10).join('\n\n');
  const q = (userQuestion || '').trim();
  return q
    ? `根据分析整理如下（完整推理见上方「思考过程」）：\n\n${body}`
    : body;
}

/** 从检索过程区摘取可读中文句，作二次总结失败时的兜底正文 */
function extractChineseProseFromSearchDump(webSearch: string, userQuestion = ''): string {
  const lines = stripLeakedSearchBlocks(webSearch)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const prose: string[] = [];
  for (const ln of lines) {
    if (/^i'?ll search/i.test(ln)) continue;
    if (/^search results/i.test(ln)) continue;
    if (/^here are the search results/i.test(ln)) continue;
    if (/^https?:\/\//i.test(ln)) continue;
    if (/^Source:/i.test(ln)) continue;
    if (/^\d+[.、．]\s*$/.test(ln)) continue;
    if (/^正在检索：|^检索完成：|^检索结果/.test(ln)) continue;
    if (/[\u4e00-\u9fff]{6,}/.test(ln) && ln.length >= 12) prose.push(ln);
    if (prose.length >= 8) break;
  }
  if (!prose.length) return '';
  const body = prose.slice(0, 6).join('\n');
  const q = (userQuestion || '').trim();
  return q
    ? `根据联网检索到的公开资料，整理如下（更多链接与摘要见上方「联网检索」）：\n\n${body}`
    : `根据检索资料整理如下：\n\n${body}`;
}

/**
 * 合并/总结后若正文为空但过程区有内容：从合成原文或检索区恢复可见正文，避免只显示 [联网检索] 卡片。
 */
export function ensureAssistantSectionsHaveMain(
  sections: AssistantMessageSections,
  opts?: { synthesizedRaw?: string; userQuestion?: string }
): AssistantMessageSections {
  let main = (sections.main || '').trim();
  const webSearch = (sections.webSearch || '').trim();
  const thinking = (sections.thinking || '').trim();

  const adoptCandidate = (raw: string) => {
    const t = stripInternalPromptBoilerplate(stripLeakedSearchBlocks(raw.replace(/\r\n/g, '\n'))).trim();
    if (!t || t.length < 16) return;
    const withoutMarkers = t
      .replace(/\n\n\[联网检索\][\s\S]*/i, '')
      .replace(/\n\n\[思考过程\][\s\S]*/i, '')
      .trim();
    const parsed = parseAssistantMessage(withoutMarkers || t);
    let candidate = (parsed.main || '').trim();
    if (!candidate && withoutMarkers) candidate = withoutMarkers;
    if (!candidate || isLikelyTooShortMainAnswer(candidate)) return;
    if (isLikelyRawWebSearchDump(candidate) && !looksLikeChineseStructuredAnswer(candidate)) return;
    if (isLikelyMainOnlySearchDump(candidate)) return;
    main = candidate;
  };

  if (main.length >= 20 && !isLikelyTooShortMainAnswer(main) && /[\u4e00-\u9fff]{4,}/.test(main)) {
    return consolidateWebSearchSections({ main, webSearch, thinking });
  }

  if (opts?.synthesizedRaw?.trim()) adoptCandidate(opts.synthesizedRaw);

  if (main.length < 20 && webSearch.trim()) {
    const fallback = extractChineseProseFromSearchDump(webSearch, opts?.userQuestion);
    if (fallback) main = fallback;
  }

  if (main.length < 20 && thinking.trim()) {
    const fromThinking = extractChineseProseFromThinking(thinking, opts?.userQuestion);
    if (fromThinking) main = fromThinking;
  }

  if (
    main.length < 20 &&
    (webSearch.trim() || thinking.trim()) &&
    !isLikelyTooShortMainAnswer(main)
  ) {
    const q = (opts?.userQuestion || '').trim();
    main = q
      ? `本次未能生成独立正文摘要，请展开上方「联网检索」与「思考过程」查看详情，或直接重试提问。\n\n（您的问题：${q.slice(0, 120)}）`
      : '本次未能生成独立正文摘要，请展开上方「联网检索」与「思考过程」查看详情，或重新发送提问。';
  }

  return consolidateWebSearchSections({ main, webSearch, thinking });
}

/** 助手回复是否有用户可见正文（不含仅过程区） */
export function assistantReplyHasVisibleMain(content: string): boolean {
  const main = (parseAssistantMessage(content || '').main || '').trim();
  if (!main) return false;
  return !isLikelyTooShortMainAnswer(main);
}

/** 保存前统一补齐正文，避免界面只剩 [联网检索]/[思考过程] */
export function guardAssistantReplyContent(
  content: string,
  opts?: { synthesizedRaw?: string; userQuestion?: string }
): string {
  const sections = parseAssistantMessage(content || '');
  const ensured = ensureAssistantSectionsHaveMain(sections, opts);
  return composeAssistantMessage(ensured);
}

export function mergeWithWebSearchProcess(
  synthesizedMain: string,
  priorDump: string,
  apiReasoning?: string,
  collectApiReasoning?: boolean,
  opts?: { userQuestion?: string }
): string {
  const prior = consolidateWebSearchSections(
    normalizeAssistantStream({
      content: priorDump,
      apiReasoning: '',
      collectApiReasoning: false,
    })
  );
  const next = normalizeAssistantStream({
    content: synthesizedMain,
    apiReasoning,
    collectApiReasoning,
    skipExtractThinkingFromMain: !!(collectApiReasoning && (apiReasoning || '').trim()),
  });
  const mergedSections = consolidateWebSearchSections({
    main: next.main,
    webSearch: prior.webSearch || next.webSearch,
    thinking: [prior.thinking, next.thinking].filter(Boolean).join('\n\n').trim(),
  });
  const ensured = ensureAssistantSectionsHaveMain(mergedSections, {
    synthesizedRaw: synthesizedMain,
    userQuestion: opts?.userQuestion,
  });
  return composeAssistantMessage(ensured);
}

/** 发给上游的历史：去掉过程区，避免重复灌入检索原文 */
export function stripAssistantProcessForHistory(content: string): string {
  return parseAssistantMessage(content).main.trim();
}

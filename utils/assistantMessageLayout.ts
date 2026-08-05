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

/**
 * 提取原生 <think> / <thinking> / <reasoning> 标签包裹的思考内容。
 * 兼容标签跨 chunk 未闭合的情况（调用方需维护 buffer 继续传入）。
 * 参考：Dify / GitHub Copilot LLM Gateway 对 reasoning 标签的分离处理。
 */
export function extractNativeThinkTags(text: string): { main: string; thinking: string; openTag?: string } {
  const t = (text || '').replace(/\r\n/g, '\n');
  const thinkMatch = t.match(/<(think|thinking|reasoning)>([\s\S]*?)<\/\1>/i);
  if (thinkMatch) {
    const thinking = thinkMatch[2].trim();
    const main = t.replace(thinkMatch[0], '').trim();
    return { main, thinking };
  }
  // 未闭合：检测开头是否已有开放标签
  const openMatch = t.match(/<(think|thinking|reasoning)>\s*([\s\S]*)$/i);
  if (openMatch) {
    return { main: '', thinking: openMatch[2].trim(), openTag: openMatch[1] };
  }
  return { main: t, thinking: '' };
}

export function parseAssistantMessage(text: string): AssistantMessageSections {
  let rest = (text || '').replace(/\r\n/g, '\n');
  let webSearch = '';
  let thinking = '';

  // 先处理原生 <think> 标签，再处理项目自定义的 [思考过程] 标记
  const nativeThink = extractNativeThinkTags(rest);
  if (nativeThink.thinking) {
    thinking = nativeThink.thinking;
    rest = nativeThink.main;
  }

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
    if (marker === ASSISTANT_MARKER_WEB_SEARCH) {
      webSearch = webSearch ? `${webSearch}\n\n${body}`.trim() : body;
    } else {
      thinking = thinking ? `${thinking}\n\n${body}`.trim() : body;
    }
    if (nextMarkerIdx >= 0) {
      const tail = block.slice(nextMarkerIdx);
      const tailMatch = tail.match(/^\n\n\[(联网检索|思考过程)\]\n([\s\S]*)$/);
      if (tailMatch) {
        const tailBody = tailMatch[2].trim();
        if (tailMatch[1] === '联网检索' && !webSearch) webSearch = tailBody;
        else if (tailMatch[1] === '思考过程' && !thinking) thinking = tailBody;
      }
    }
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

/**
 * 判断一段文本更像是「推理/思考过程」还是「面向用户的回答正文」。
 * Gemini / AiTop 在某些思考模式下会把正文片段（如开篇结论、分节论证）放进
 * reasoning_content / thinking_content 字段，导致正文被误收入思考卡。
 * 参考 DeepSeek / OpenAI 官方 UI 的处理：只有当内容明确包含思考线索时才归入
 * thinking；否则即使它来自 reasoning 字段，也应合并到 main 保证答案完整。
 */
function isLikelyReasoningContent(text: string): boolean {
  const t = (text || '').replace(/\r\n/g, '\n').trim();
  if (!t) return false;

  const zhReasoningVerbs = /(?:分析|思考|推理|规划|反思|评估|探索|判断|细化|界定|考量|梳理|推导|论证|总结思路)/;
  const hasDirectAnswerStatement = /(?:是|否|适合|不适合|可以|不可以|支持|不支持|能|不能|会|不会|建议|推荐|结论)[，,。：:\s]*$/m.test(t);

  // 按行检查：只要出现典型思考/推理线索行，就整体视为 reasoning。
  // 注意：不用 isChineseThinkingHeaderLine，因为它会把任何加粗中文行都误判为思考标题。
  const zhReasoningKeywords = /^(?:\*\*)?(?:正在|让我|我需要)?(?:分析|思考|推理|规划|反思|评估|探索|判断|细化|界定|考量|梳理|推导|论证|总结思路)(?:过程|步骤|请求|分析|中|一下|：|:|$)/;
  const enReasoningKeywords = /^\*\*(?:Analyzing|Analysis|Planning|Researching|Synthesizing|Thinking|Reasoning|Thought process|Brainstorming|Reflecting|Drafting|Evaluating|Exploring|Assessing|Determining|Considering|Refining)\b/i;
  const reasoningCues = [
    /自然语言思考过程/,
    zhReasoningKeywords,
    enReasoningKeywords,
    /^让我(?:先|来|们)?(?:分析|思考|推理|梳理|推导|想想|考虑一下|重新审视|再检查|再想想)/,
    /^我需要(?:先|进一步)?(?:分析|思考|推理|梳理|推导|重新审视|再检查|再评估)/,
    // 中文内心独白 / 自我修正 / 自我质疑（模型常把这类内容混进 reasoning 字段）
    /^(?:嗯|呃|啊|哦|哎|好吧?|不过|但是|等等|不对|没错|其实|实际上|老实说|坦白讲|仔细想想|深入思考|换个角度|重新审视)/,
    /^(?:这(?:个|里|样|点|个问题|件事|种情况)|那(?:个|样|么)|上述|前面|之前|刚才)/,
    /^(?:我(?:现在|接下来|应该|需要|想|觉得|认为|发现|意识到|注意到|漏掉|忽略|忘记))/,
    /^(?:可能|也许|大概|似乎|好像|未必|不一定|假设|如果|是否|能否|会不会)/,
    /(?:重新|再次|进一步|换个|调整|修正|更正|修改|补充|完善|优化|细化)(?:分析|思考|推理|评估|检查|核对|审视|考虑|梳理|推导|计算|判断)/,
    /^(?:第一步|第二步|第三步|第[一二三四五六七八九十\d]+步|首先|其次|接着|然后|接下来|最后|最终|综上|总结)/,
    /^I(?:'m| am| need| will|'ll|'ve)\b/i,
    /^My goal\b/i,
    /^Let me\b/i,
    /^Here (?:is|are) my (?:thought|reasoning|analysis|thinking)/i,
  ];
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  const hasThinkingCueLine = lines.some((ln) => reasoningCues.some((p) => p.test(ln)));
  if (hasThinkingCueLine) return true;

  // 短句只包含思考动词、没有直接答案断言，也视为 reasoning（如「正在分析用户购房问题」）
  if (t.length <= 40 && zhReasoningVerbs.test(t) && !hasDirectAnswerStatement) return true;

  // 短句是内心独白或自我修正，也视为 reasoning
  const shortSelfTalkPattern = /^(?:嗯|呃|啊|哦|不对|等等|让我想想|我再看看|我再想想|重新来|修正一下|更正|补充一下)/;
  if (t.length <= 40 && shortSelfTalkPattern.test(t) && !hasDirectAnswerStatement) return true;

  // 没有任何思考线索，且包含面向用户的答案结构（分节标题、结论句、编号列表），
  // 更倾向于正文，不归入 thinking
  const hasAnswerStructure = /#{1,3}\s+[^#\n]+/.test(t) || /^\d+[.、．]\s+\*\*/m.test(t);
  if (hasAnswerStructure || hasDirectAnswerStatement) return false;

  // 默认保守：没有明确思考线索的短文本，倾向于是答案片段
  return false;
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
  // Gemini 思考模式下常见的答案起始标记
  if (/^最终[的的]?.*(?:结果|答案|计算|路程|距离|总)[：:]/u.test(t)) return true;
  if (/^总共.*(?:为|是)[：:]?/u.test(t)) return true;
  if (/^根据(?:以上)?(?:分析|计算|推导)[，,]/u.test(t)) return true;
  if (/^答[：:]/u.test(t)) return true;
  if (/^答案为[：:]/u.test(t)) return true;
  if (/^#{1,3}\s*(?:最终|答案|结果|总结)/u.test(t)) return true;
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

/**
 * 计算短文本 a 被长文本 b 包含的 n-gram 覆盖率（默认 10-gram）。
 * 用于判断 thinking 中的某个片段是否已经在 main 中完整出现过。
 */
function ngramCoverage(a: string, b: string, n = 10): number {
  const sa = (a || '').replace(/\s+/g, '');
  const sb = (b || '').replace(/\s+/g, '');
  if (!sa || !sb || sa.length < n) return 0;
  // 快速失败：a 的首 n-gram 都不在 b 中，则覆盖率必然为 0
  if (!sb.includes(sa.slice(0, n))) return 0;
  let match = 0;
  const total = sa.length - n + 1;
  for (let i = 0; i < total; i++) {
    if (sb.includes(sa.slice(i, i + n))) match++;
  }
  return total > 0 ? match / total : 0;
}

/**
 * 将文本按常见中文/英文标点拆分为句子（保留末尾标点）。
 */
function splitSentences(text: string): string[] {
  const s = (text || '').trim();
  if (!s) return [];
  const sentences: string[] = [];
  const re = /[^。！？.!?]+[。！？.!?]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const part = m[0].trim();
    if (part) sentences.push(part);
  }
  const tail = s.slice(re.lastIndex).trim();
  if (tail) sentences.push(tail);
  return sentences;
}

/**
 * 判断 thinking 中的某个句子是否已在 main 中出现过。
 */
function sentenceIsDuplicate(sentence: string, mainParas: string[]): boolean {
  const s = sentence.trim();
  if (!s || s.length < 10) return false;
  return mainParas.some((mp) => {
    const mpTrim = mp.trim();
    if (!mpTrim) return false;
    if (mpTrim.includes(s)) return true;
    if (s.includes(mpTrim) && mpTrim.length >= 15) return true;
    return ngramCoverage(s, mpTrim) >= 0.85;
  });
}

/**
 * 当 thinking 中开始出现面向用户的最终答案组织语言时（如"整理一下"、"综上"、
 * "最终回答"），将后续内容截断。模型常把腹稿与最终答案同时输出，若 main 已经
 * 包含完整答案，thinking 中重复写一遍会降低阅读体验。
 */
function truncateThinkingAtAnswerStart(thinking: string): string {
  const t = thinking.replace(/\r\n/g, '\n').trim();
  const answerStartPatterns = [
    /(?:^|\n)\s*那?(?:整理|总结|归纳)一下[：:]?\s*(?=\n|$)/,
    /(?:^|\n)\s*(?:综上|所以|因此|于是)[，,。：:\s]*(?=\n|$)/,
    /(?:^|\n)\s*(?:最终|最后)的?(?:回答|答案|回复|结论)[：:]?\s*(?=\n|$)/,
    /(?:^|\n)\s*(?:组织|梳理)(?:一下|语言)[：:]?\s*(?=\n|$)/,
    /(?:^|\n)\s*(?:回复|回答)(?:如下|可以这样)[：:]?\s*(?=\n|$)/,
  ];
  let earliest = -1;
  for (const re of answerStartPatterns) {
    const m = re.exec(t);
    if (m && (earliest < 0 || m.index < earliest)) {
      earliest = m.index;
    }
  }
  if (earliest > 0) return t.slice(0, earliest).trim();
  return t;
}

/**
 * 部分模型（典型如 DouBao Seed 2.0）会把面向用户的完整答案又完整写入 reasoning 字段，
 * 导致 thinking 与 main 大面积重复展示。本函数先按段落检测：若整个段落与 main 高度重复
 * 则整段移除；否则按句子去重，移除 thinking 段落中已在 main 出现过的结论句，保留真正
 * 属于推理过程的片段，提升阅读体验。
 *
 * 参考：DeepSeek/DouBao 等国产推理模型常把「腹稿」与最终答案同时输出，商业产品
 *（如 Claude/ChatGPT 官方客户端）通常只展示精简 reasoning；此处通过去重避免
 * 同一答案在 UI 上出现两次。
 */
function deduplicateThinkingFromMain(thinking: string, main: string): string {
  const t = (thinking || '').replace(/\r\n/g, '\n').trim();
  const m = (main || '').replace(/\r\n/g, '\n').trim();
  if (!t || !m) return t;

  const mainParas = m.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const keptParas: string[] = [];

  for (const para of t.split(/\n\s*\n/)) {
    const p = para.trim();
    if (!p) continue;
    // 空段落或纯分隔线保留
    if (/^[\s\-=*]+$/.test(p)) {
      keptParas.push(p);
      continue;
    }

    // 1) 整个段落与 main 某段落高度重复，直接丢弃
    const wholeDuplicate = mainParas.some((mp) => {
      if (p === mp) return true;
      const minLen = Math.min(p.length, mp.length);
      if (minLen < 20) return false;
      return ngramCoverage(p, mp) >= 0.82 || ngramCoverage(mp, p) >= 0.82;
    });
    if (wholeDuplicate) continue;

    // 2) 句子级别去重：段落内部分句子与 main 重复时，仅移除这些句子
    const sentences = splitSentences(p);
    if (sentences.length <= 1) {
      keptParas.push(p);
      continue;
    }
    const keptSentences = sentences.filter((s) => !sentenceIsDuplicate(s, mainParas));
    const reduced = keptSentences.join('').trim();
    // 若去重后该段落剩余内容不足原段落的 25%，说明该段落基本在复述答案，丢弃
    if (reduced.length < p.length * 0.25) continue;
    keptParas.push(reduced);
  }

  let result = keptParas.join('\n\n').trim();
  // 去重后剩余内容不足原 thinking 的 15%，说明整段都是答案复述，直接清空 thinking
  // 避免零散句子影响阅读。
  if (result.length < t.length * 0.15) return '';
  // 最终防御：若 main 已含完整答案且 thinking 仍明显更长，截断 thinking 中
  // 面向用户的最终答案组织语言（如"整理一下"、"综上"之后的内容），避免同一
  // 答案在 UI 上出现两次（典型如 DouBao Seed 2.0 把腹稿和最终答案都写进 reasoning）。
  if (result.length > 0 && m.length > 0 && result.length > m.length * 1.2) {
    result = truncateThinkingAtAnswerStart(result);
    if (result.length < t.length * 0.15) return '';
    // 截断后仍明显超过 main 长度，按句子边界保留前面的推理片段，避免 thinking 喧宾夺主。
    if (result.length > m.length * 1.5) {
      const maxKeep = Math.max(m.length, 240);
      const sentences = splitSentences(result);
      let preview = '';
      for (const s of sentences) {
        if (preview.length + s.length > maxKeep) break;
        preview += s;
      }
      const trimmed = preview.trim();
      return trimmed && trimmed.length < result.length ? `${trimmed}...` : trimmed;
    }
  }
  return result;
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

/**
 * 思考关闭时：剥离正文里泄漏的英文/中文推理前缀，仅保留面向用户的回答。
 * 不误伤「Hello + 中文自我介绍」等无思考特征行的正常双语正文。
 */
export function stripLeakedThinkingFromMainWhenDisabled(main: string): string {
  const text = (main || '').replace(/\r\n/g, '\n').trim();
  if (!text) return text;

  const extracted = extractThinkingBlockFromMain(text);
  const tail = (extracted.main || '').trim();
  const head = (extracted.thinking || '').trim();
  if (!head || !tail || tail === text) return text;

  const tailLooksLikeAnswer =
    /[\u4e00-\u9fff]{4,}/.test(tail) ||
    tail.split('\n').some((ln) => isLikelyFinalAnswerStartLine(ln.trim())) ||
    looksLikeChineseStructuredAnswer(tail);

  if (!tailLooksLikeAnswer) return text;
  if (isLikelyTooShortMainAnswer(tail) && !/[\u4e00-\u9fff]{6,}/.test(tail)) return text;
  return tail;
}

/**
 * 未开联网/思考时：把过程区正文合并回 main，避免误存/误显 [联网检索]/[思考过程] 卡片。
 */
export function flattenAssistantSectionsWhenProcessDisabled(
  sections: AssistantMessageSections,
  opts?: { webSearchEnabled?: boolean; thinkingEnabled?: boolean }
): AssistantMessageSections {
  const webSearchEnabled = opts?.webSearchEnabled !== false;
  const thinkingEnabled = opts?.thinkingEnabled !== false;
  let main = (sections.main || '').trim();
  let webSearch = (sections.webSearch || '').trim();
  let thinking = (sections.thinking || '').trim();

  if (!webSearchEnabled && webSearch) {
    main = [main, webSearch].filter(Boolean).join('\n\n').trim();
    webSearch = '';
  }
  if (!thinkingEnabled && thinking) {
    main = [main, thinking].filter(Boolean).join('\n\n').trim();
    thinking = '';
  }
  if (!thinkingEnabled && main) {
    main = stripLeakedThinkingFromMainWhenDisabled(main);
  }
  return { main, webSearch, thinking };
}

/** 展示/渲染前：若缺少 [思考过程] 标记，尝试从正文再拆一次（兼容旧消息与 Gemini 中文思考） */
export function resolveAssistantDisplaySections(
  text: string,
  opts?: { allowLegacyThinkingExtract?: boolean }
): AssistantMessageSections {
  const first = parseAssistantMessage(text || '');
  if (first.thinking.trim() || !first.main.trim()) return first;
  if (!opts?.allowLegacyThinkingExtract) return first;
  // 未开联网时不从正文启发式抽检索块，避免误显 [联网检索] 卡片
  const normalized = normalizeAssistantStream({
    content: text || '',
    apiReasoning: '',
    collectApiReasoning: false,
    allowWebSearchExtractFromMain: false,
    allowThinkingExtractFromMain: true,
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
  /** 仅在启用思考时，才从正文启发式拆思考块（展示层兼容旧消息可显式 true） */
  allowThinkingExtractFromMain?: boolean;
}): AssistantMessageSections {
  const parsed = parseAssistantMessage(params.content || '');
  let main = parsed.main;
  let webSearch = parsed.webSearch;
  let thinking = parsed.thinking;

  if (params.collectApiReasoning && (params.apiReasoning || '').trim()) {
    const apiReasoning = params.apiReasoning!.trim();
    // Gemini / AiTop 偶尔把正文片段（如开篇结论、分节论证）塞进 reasoning 字段，
    // 若直接归入 thinking 会导致用户正文缺失/被截断。仅当内容明确像推理时才保留。
    if (isLikelyReasoningContent(apiReasoning)) {
      thinking = thinking ? `${thinking}\n\n${apiReasoning}`.trim() : apiReasoning;
    } else {
      main = main ? `${main}\n\n${apiReasoning}`.trim() : apiReasoning;
    }
  }

  // 去重：部分模型（如 DouBao Seed 2.0）会把完整答案又写入 reasoning，
  // 导致 thinking 与 main 重复展示。移除 thinking 中已在 main 出现过的段落。
  thinking = deduplicateThinkingFromMain(thinking, main);

  if (params.allowWebSearchExtractFromMain !== false) {
    const ws = extractWebSearchBlockFromMain(main);
    main = ws.main;
    webSearch = webSearch ? `${webSearch}\n\n${ws.webSearch}`.trim() : ws.webSearch;
  }

  const hasApiReasoning = !!(params.apiReasoning || '').trim();
  const allowThinkingExtract =
    params.allowThinkingExtractFromMain ?? !!params.collectApiReasoning;
  if (
    allowThinkingExtract &&
    !params.skipExtractThinkingFromMain &&
    !(params.collectApiReasoning && hasApiReasoning)
  ) {
    // 思考提取：统一走保守的顶部推理前缀识别。
    // 不再按「总结/结论」等尾部标记做 bottom-up 拆分，避免把结构化的正文答案
    // （如 ### 1. ... ### 总结）误判为 thinking 过程。
    // 参考：OpenAI/Claude/DeepSeek 官方 UI 均依赖 API 独立 reasoning 字段或原生
    // <think>/<reasoning> 标签，不会从普通正文中逆向拆分结论段。
    const th = extractThinkingBlockFromMain(main);
    if (th.thinking.trim()) {
      main = th.main;
      thinking = thinking ? `${thinking}\n\n${th.thinking}`.trim() : th.thinking;
    }
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

/** 联网首轮正文疑似"引导语式截断"（冒号收尾承诺下文却无实质内容，如"以下是今天广州的天气情况："）→ 需二次总结 */
export function isLikelyTruncatedLeadInMain(main: string): boolean {
  const t = (main || '').trim();
  if (!t || t.length > 200) return false;
  if (!/[：:]\s*$/.test(t)) return false;
  return /(以下是|如下|情况如下|一起来看|来看看|为您整理|为你整理|介绍如下)/.test(t);
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
  if (process && isLikelyTruncatedLeadInMain(main)) return true;
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
export function consolidateWebSearchSections(
  sections: AssistantMessageSections,
  opts?: { webSearchEnabled?: boolean }
): AssistantMessageSections {
  let { main, webSearch, thinking } = sections;
  const mainTrim = (main || '').trim();
  const webSearchEnabled = opts?.webSearchEnabled !== false;
  if (
    webSearchEnabled &&
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
  opts?: {
    synthesizedRaw?: string;
    userQuestion?: string;
    /** 本轮是否启用联网；false 时勿用检索区兜底文案 */
    webSearchEnabled?: boolean;
    /** 本轮是否启用思考；false 时勿用思考区兜底正文 */
    thinkingEnabled?: boolean;
  }
): AssistantMessageSections {
  const flattened = flattenAssistantSectionsWhenProcessDisabled(sections, opts);
  let main = (flattened.main || '').trim();
  let webSearch = (flattened.webSearch || '').trim();
  let thinking = (flattened.thinking || '').trim();

  const adoptCandidate = (raw: string) => {
    const t = stripInternalPromptBoilerplate(stripLeakedSearchBlocks(raw.replace(/\r\n/g, '\n'))).trim();
    if (!t || t.length < 16) return;
    const parsedFull = parseAssistantMessage(t);
    const withoutMarkers = t
      .replace(/\n\n\[联网检索\][\s\S]*/i, '')
      .replace(/\n\n\[思考过程\][\s\S]*/i, '')
      .trim();
    const parsed = parseAssistantMessage(withoutMarkers || t);
    let candidate = (parsed.main || '').trim();
    if (!candidate && parsedFull.webSearch.trim()) candidate = parsedFull.webSearch.trim();
    if (!candidate && parsedFull.thinking.trim()) candidate = parsedFull.thinking.trim();
    if (!candidate && withoutMarkers) candidate = withoutMarkers;
    if (!candidate || isLikelyTooShortMainAnswer(candidate)) return;
    if (isLikelyRawWebSearchDump(candidate) && !looksLikeChineseStructuredAnswer(candidate)) return;
    if (isLikelyMainOnlySearchDump(candidate)) return;
    main = candidate;
  };

  if (main.length >= 20 && !isLikelyTooShortMainAnswer(main) && /[\u4e00-\u9fff]{4,}/.test(main)) {
    return consolidateWebSearchSections({ main, webSearch, thinking }, opts);
  }

  if (opts?.synthesizedRaw?.trim()) adoptCandidate(opts.synthesizedRaw);

  const webSearchEnabled = opts?.webSearchEnabled !== false;
  const thinkingEnabled = opts?.thinkingEnabled !== false;

  if (main.length < 20 && webSearch.trim() && webSearchEnabled) {
    const fallback = extractChineseProseFromSearchDump(webSearch, opts?.userQuestion);
    if (fallback) main = fallback;
  }

  if (main.length < 20 && thinking.trim() && thinkingEnabled) {
    const fromThinking = extractChineseProseFromThinking(thinking, opts?.userQuestion);
    if (fromThinking) main = fromThinking;
  }

  const hasProcessPanels =
    (webSearch.trim() && webSearchEnabled) || (thinking.trim() && thinkingEnabled);
  if (main.length < 20 && hasProcessPanels && !isLikelyTooShortMainAnswer(main)) {
    const q = (opts?.userQuestion || '').trim();
    const panelHint =
      webSearchEnabled && thinkingEnabled
        ? '「联网检索」与「思考过程」'
        : webSearchEnabled
          ? '「联网检索」'
          : thinkingEnabled
            ? '「思考过程」'
            : '过程区';
    main = q
      ? `本次未能生成独立正文摘要，请展开上方${panelHint}查看详情，或直接重试提问。\n\n（您的问题：${q.slice(0, 120)}）`
      : `本次未能生成独立正文摘要，请展开上方${panelHint}查看详情，或重新发送提问。`;
  }

  return consolidateWebSearchSections({ main, webSearch, thinking }, opts);
}

/** 从原始流文本恢复可见正文（未开联网/思考时合并过程区） */
export function recoverAssistantReplyFromRaw(
  raw: string,
  opts?: {
    userQuestion?: string;
    webSearchEnabled?: boolean;
    thinkingEnabled?: boolean;
  }
): string {
  const flattened = flattenAssistantSectionsWhenProcessDisabled(parseAssistantMessage(raw || ''), opts);
  let main = (flattened.main || '').trim();
  if (!main && (raw || '').trim()) {
    main = (raw || '').trim();
  }
  return guardAssistantReplyContent(composeAssistantMessage({ main, webSearch: '', thinking: '' }), {
    synthesizedRaw: raw,
    ...opts,
  });
}

/** 助手回复是否有用户可见正文（不含仅过程区） */
export function assistantReplyHasVisibleMain(
  content: string,
  opts?: {
    webSearchEnabled?: boolean;
    thinkingEnabled?: boolean;
    rawFallback?: string;
  }
): boolean {
  const visibleMain = (text: string): string => {
    const flat = flattenAssistantSectionsWhenProcessDisabled(parseAssistantMessage(text || ''), opts);
    return (flat.main || '').trim();
  };
  let main = visibleMain(content || '');
  if ((!main || isLikelyTooShortMainAnswer(main)) && (opts?.rawFallback || '').trim()) {
    main = visibleMain(opts!.rawFallback!);
    if (!main || isLikelyTooShortMainAnswer(main)) {
      main = (opts!.rawFallback || '').trim();
    }
  }
  if (!main) return false;
  if (!isLikelyTooShortMainAnswer(main)) return true;
  // 显式无效模式（未找到结果类）维持原判定，仍触发恢复/降级
  if (/^no results found\b[.!?。！？]*$/i.test(main)) return false;
  if (/^未找到相关结果[。！？!?.]*$/.test(main)) return false;
  // 短但实质有效的回复（暗号/简短确认，如"银河流星2026""已记住""OK"）视为可见正文，
  // 避免误触发模型降级链与思考内容回填；仅放宽本可见性判定，isLikelyTooShortMainAnswer 全局阈值不变
  return /[\u4e00-\u9fff]{2,}/.test(main) || /[A-Za-z0-9]{2,}/.test(main);
}

/** 保存前统一补齐正文，避免界面只剩 [联网检索]/[思考过程] */
export function guardAssistantReplyContent(
  content: string,
  opts?: {
    synthesizedRaw?: string;
    userQuestion?: string;
    webSearchEnabled?: boolean;
    thinkingEnabled?: boolean;
  }
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

/**
 * 把助手消息中的过程区压缩成摘要，保留关键来源 URL 和检索词，供多轮对话历史使用。
 * 避免完全剥离导致用户追问「你刚才引用的链接」时 fallback 模型看不到上下文。
 */
export function compressAssistantProcessForHistory(content: string): string {
  const sections = parseAssistantMessage(content);
  const main = sections.main.trim();
  const webSearch = sections.webSearch.trim();
  const thinking = sections.thinking.trim();
  const parts: string[] = [];
  if (main) parts.push(main);

  if (webSearch) {
    const lines = webSearch.split('\n').map((l) => l.trim()).filter(Boolean);
    const queries = lines
      .filter((l) => /^(Search results for|I'll search for|Here are the search results|正在检索)\s*[：:]?\s*/i.test(l))
      .map((l) => l.replace(/^[^"「]*["「]([^"」]+)["」].*$/, '$1').trim())
      .filter(Boolean);
    const urls = lines
      .filter((l) => /^https?:\/\//i.test(l) || /^Source:\s*https?:\/\//i.test(l))
      .map((l) => l.replace(/^Source:\s*/i, '').trim())
      .slice(0, 3);
    const summaryParts: string[] = [];
    if (queries.length) summaryParts.push(`曾检索：${queries.join('；')}`);
    if (urls.length) summaryParts.push(`来源：${urls.join('、')}`);
    if (summaryParts.length) parts.push(`[${summaryParts.join('；')}]`);
  }

  if (thinking && thinking.length > 0) {
    // 思考过程通常很长，只保留一句摘要
    const firstLine = thinking.split('\n').find((l) => l.trim())?.trim() || '';
    if (firstLine && firstLine.length <= 80) {
      parts.push(`[思考：${firstLine}]`);
    }
  }

  return parts.join('\n').trim();
}

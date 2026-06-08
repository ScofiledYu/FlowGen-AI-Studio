/**
 * 联网首轮检索词：优先 LLM 对话改写（decontextualize），失败时用极简规则兜底。
 * 参考 RAG query rewriting：避免用正则猜测「天气/学校/时间」意图。
 */

export const WEB_SEARCH_PROBE_MAX_LEN = 120;
export const WEB_SEARCH_PROBE_REWRITE_TIMEOUT_MS = 10_000;
/** 改写专用模型（短、无思考泄漏）；与用户对话模型解耦 */
export const WEB_SEARCH_PROBE_REWRITE_MODEL = 'claude-sonnet-4-6';

export type WebSearchDialogueTurn = { role: 'user' | 'assistant'; content: string };

const WEAK_SINGLE_TERMS = new Set([
  '对比',
  '比较',
  '如何',
  '什么',
  '为什么',
  '怎么样',
  '分析',
  '总结',
  '搜索',
  '查询',
]);

/** 短指令型追问（无新话题实体）：需拼接近期对话 */
const SHORT_FOLLOW_UP_RE =
  /表格|对比|总结|再查|做成|继续|刚才|上面|^(用|再|请|帮|麻烦)/;

export function sanitizeWebSearchQueryText(text: string): string {
  return (text || '')
    .replace(/【[^】]+】/g, ' ')
    .replace(/请结合以下对话[^。]*/g, ' ')
    .replace(/[？?！!。，,；;：:\n\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compactWebSearchQuery(text: string, maxLen = WEB_SEARCH_PROBE_MAX_LEN): string {
  const t = sanitizeWebSearchQueryText(text);
  if (!t) return '';
  return t.length <= maxLen ? t : t.slice(0, maxLen);
}

export function isWeakWebSearchQuery(query: string): boolean {
  const t = (query || '').trim();
  if (!t || t.length <= 3) return true;
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length === 1 && WEAK_SINGLE_TERMS.has(tokens[0])) return true;
  if (tokens.every((tok) => WEAK_SINGLE_TERMS.has(tok) || tok.length <= 1)) return true;
  return false;
}

export function needsContextualProbeFallback(latestUserText: string): boolean {
  const t = sanitizeWebSearchQueryText(latestUserText);
  if (!t) return true;
  if (isWeakWebSearchQuery(t)) return true;
  if (t.length <= 24 && SHORT_FOLLOW_UP_RE.test(t)) return true;
  return false;
}

/** 从近期轮次拼一条可检索的自然语言（含助手里的实体，不做领域关键词表） */
export function buildContextualProbeFromTurns(
  latestUserText: string,
  turns: WebSearchDialogueTurn[] = []
): string {
  const latest = sanitizeWebSearchQueryText(latestUserText);
  const parts: string[] = [];
  if (latest) parts.push(latest);
  for (const t of turns.slice(-5)) {
    const s = sanitizeWebSearchQueryText(t.content).slice(0, 140);
    if (!s) continue;
    if (parts.some((p) => p.includes(s) || s.includes(p))) continue;
    parts.push(s);
  }
  return compactWebSearchQuery(parts.join(' '));
}

/** 极简兜底：本轮原话；短追问则拼接近期对话 */
export function buildWebSearchProbeQueryFallback(
  latestUserText: string,
  turns: WebSearchDialogueTurn[] = []
): string {
  const latest = sanitizeWebSearchQueryText(latestUserText);
  if (latest && !needsContextualProbeFallback(latest)) {
    return compactWebSearchQuery(latest);
  }

  if (!needsContextualProbeFallback(latest)) {
    return compactWebSearchQuery(latest);
  }

  const priorUser = turns
    .filter((t) => t.role === 'user')
    .map((t) => sanitizeWebSearchQueryText(t.content))
    .filter((c) => c && c !== latest);

  for (let i = priorUser.length - 1; i >= 0; i--) {
    const prev = priorUser[i];
    if (!prev || prev === latest || isWeakWebSearchQuery(prev)) continue;
    const merged = [prev, latest].filter(Boolean).join(' ');
    const q = compactWebSearchQuery(merged);
    if (q && !isWeakWebSearchQuery(q)) return q;
  }

  const contextual = buildContextualProbeFromTurns(latestUserText, turns);
  if (contextual && !isWeakWebSearchQuery(contextual)) return contextual;

  return compactWebSearchQuery(latest || priorUser.join(' '));
}

/** 拒绝思考标题、纯英文短语等无效改写 */
export function isPlausibleSearchQuery(query: string): boolean {
  const t = (query || '').trim();
  if (!t || t.length < 4) return false;
  if (!/[\u4e00-\u9fa5]/.test(t)) return false;
  if (/^\*\*[^*]+\*\*$/.test(t)) return false;
  if (/^(Defining|Refining|Analyzing|Understanding)\b/i.test(t)) return false;
  if (/检索不对|你再查|Search results for/i.test(t)) return false;
  if (/检索查询改写|你是.*改写/.test(t)) return false;
  return !isWeakWebSearchQuery(t);
}

function buildRewritePrompt(turns: WebSearchDialogueTurn[], latestUserText: string): string {
  const latest = (latestUserText || '').trim();
  const lines = turns
    .slice(-6)
    .map((t) => `${t.role === 'user' ? '用户' : '助手'}：${t.content.trim()}`)
    .filter((l) => l.length > 3);
  const dlg = lines.length ? `【对话】\n${lines.join('\n')}\n\n` : '';
  return (
    `你是检索查询改写器。根据对话，将用户最后一问改写成一条适合搜索引擎的中文查询。\n` +
    `要求：只输出一行查询（≤80字）；保留专有名词；纠正检索时按真实问题改写；禁止解释、JSON、引号、英文标题。\n\n` +
    dlg +
    `【最后一问】\n${latest}\n\n` +
    `查询：`
  );
}

function parseStreamPayloadLine(line: string): string | null {
  const t = (line || '').trim();
  if (!t || t === '[DONE]') return null;
  return t.startsWith('data:') ? t.slice(5).trim() : t;
}

function getStreamTextChunk(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const d = data as Record<string, unknown>;
  if (typeof d.content === 'string' && d.content) return d.content;
  if (d.code || d.success === false) return '';
  if (typeof d.text === 'string' && d.text) return d.text;
  const delta = d.delta as Record<string, unknown> | undefined;
  if (typeof delta?.content === 'string' && delta.content) return delta.content;
  return '';
}

function normalizeRewriteOutput(raw: string): string {
  let t = (raw || '').trim();
  t = t.replace(/^(?:查询|检索查询)[：:]\s*/i, '').trim();
  t = t.replace(/^【检索查询】\s*/i, '').trim();
  t = t.replace(/^["'「『]|["'」』]$/g, '').trim();
  const lines = t.split(/\n/).map((l) => l.replace(/^\*\*|\*\*$/g, '').trim()).filter(Boolean);
  const pick =
    lines.find((l) => isPlausibleSearchQuery(l)) ||
    lines.find((l) => /[\u4e00-\u9fa5]/.test(l) && l.length >= 4) ||
    lines[0] ||
    '';
  return compactWebSearchQuery(pick);
}

/** 调用同源 AiTop 流式接口做检索词改写（webSearch: false，Claude 无思考泄漏） */
export async function rewriteWebSearchProbeQueryViaLlm(params: {
  url: string;
  apiKey: string;
  model?: string;
  chatId: string;
  turns: WebSearchDialogueTurn[];
  latestUserText: string;
  timeoutMs?: number;
}): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), params.timeoutMs ?? WEB_SEARCH_PROBE_REWRITE_TIMEOUT_MS);
  const rewriteModel = params.model || WEB_SEARCH_PROBE_REWRITE_MODEL;
  try {
    const res = await fetch(params.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': params.apiKey },
      body: JSON.stringify({
        id: params.chatId,
        message: buildRewritePrompt(params.turns, params.latestUserText),
        model: rewriteModel,
        tip: ' ',
        thinking: false,
        webSearch: false,
      }),
      signal: ac.signal,
    });
    if (!res.ok) return null;
    if (!res.body) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const raw of lines) {
        const pl = parseStreamPayloadLine(raw);
        if (!pl) continue;
        try {
          const data = JSON.parse(pl) as Record<string, unknown>;
          if (data.success === false) return null;
          content += getStreamTextChunk(data);
        } catch {
          if (!pl.startsWith('{')) content += pl;
        }
      }
    }
    const tail = parseStreamPayloadLine(buffer);
    if (tail) {
      try {
        content += getStreamTextChunk(JSON.parse(tail));
      } catch {
        if (!tail.startsWith('{')) content += tail;
      }
    }
    const q = normalizeRewriteOutput(content);
    return isPlausibleSearchQuery(q) ? q : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveWebSearchProbeQuery(params: {
  url: string;
  apiKey: string;
  model: string;
  rewriteModel?: string;
  chatId: string;
  turns: WebSearchDialogueTurn[];
  latestUserText: string;
  tailAppend?: string;
  enableLlmRewrite?: boolean;
}): Promise<string> {
  const latest = [params.latestUserText, params.tailAppend].filter(Boolean).join(' ').trim();

  if (params.enableLlmRewrite !== false) {
    const rewritten = await rewriteWebSearchProbeQueryViaLlm({
      url: params.url,
      apiKey: params.apiKey,
      model: params.rewriteModel || WEB_SEARCH_PROBE_REWRITE_MODEL,
      chatId: params.chatId,
      turns: params.turns,
      latestUserText: latest,
    });
    if (rewritten) {
      console.warn('[chat] web search probe LLM rewrite', { query: rewritten.slice(0, 120) });
      return rewritten;
    }
    console.warn('[chat] web search probe LLM rewrite skipped, using fallback');
  }

  const fallback = buildWebSearchProbeQueryFallback(latest, params.turns);
  console.warn('[chat] web search probe fallback', { query: fallback.slice(0, 120) });
  return fallback;
}

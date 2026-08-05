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

/** 明确指代或依赖对话上下文的表述：命中后结合历史补全省略实体 */
const CONTEXT_DEPENDENT_RE = /它|这些|那些|上述|这种情况|上述问题|这里|那里|刚才|之前|后来|结果|未来|现在/;

/**
 * 用户在问「当前助手是谁 / 哪个模型」——会话元问题，禁止联网。
 * 原因：联网检索会把 DeepSeek 等带成 Claude 等其他产品名（已复现）。
 * 允许句末带短困惑追问（如「你是哪个模型 你删除做什么」）。
 * 不匹配「Claude 是哪个公司的」等外部产品调研（句首为第三方品牌且较长）。
 */
export function isAssistantIdentityQuestion(text: string): boolean {
  const t = (text || '').trim().toLowerCase();
  if (!t || t.length > 120) return false;
  // 外部产品调研：句首即第三方品牌 → 允许联网
  if (
    /^(claude|gpt|chatgpt|gemini|deepseek|豆包|qwen|openai|anthropic|google|微软|microsoft)\b/i.test(
      t
    ) &&
    !/^(你是|who\s+are\s+you)/i.test(t)
  ) {
    return false;
  }
  if (
    /你是(谁|哪个模型|什么模型|哪款模型|什么\s*ai|哪个\s*ai|哪一个模型)/i.test(t) ||
    /你(叫什么|的名字是什么|属于哪个模型)/i.test(t) ||
    /(which|what)\s+model\s+are\s+you|who\s+are\s+you|what(?:'s| is)\s+your\s+name/i.test(t)
  ) {
    return true;
  }
  // 短自我介绍请求；「你能做什么」过宽，不纳入（避免误关联网）
  if (/介绍一下你自己|自我介绍一下/.test(t) && t.length <= 40) return true;
  return false;
}

/**
 * 问候 / 身份 / 致谢等：不需要检索，也不应把历史话题改写成查询。
 * 与 ChatPanel isLightweightPrompt 对齐（国际常见开场 + 身份元问题）。
 */
export function isNonSearchableChatUtterance(text: string): boolean {
  const t = (text || '').trim().toLowerCase();
  if (!t || t.length > 120) return false;
  if (isAssistantIdentityQuestion(t)) return true;
  if (/^(你好|嗨|hi|hello|嘿|在吗|你是谁|测试|test|ok)[\s!,.，。!?？]*$/i.test(t)) return true;
  if (
    /^(你好|嗨|hi|hello|嘿)[，,\s]*(你是谁|请问你是谁|who\s*are\s*you)[\s!,.，。!?？]*$/i.test(t)
  ) {
    return true;
  }
  if (/^(who\s*are\s*you|what(?:'s| is)\s+your\s+name|how\s+are\s+you)[\s!,.？?]*$/i.test(t)) {
    return true;
  }
  if (/^(谢谢|thanks|thank\s*you|再见|bye|goodbye)[\s!,.，。!?？]*$/i.test(t)) return true;
  return false;
}

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

export function needsContextualProbeFallback(
  latestUserText: string,
  turns?: WebSearchDialogueTurn[]
): boolean {
  const t = sanitizeWebSearchQueryText(latestUserText);
  if (!t) return true;
  if (isWeakWebSearchQuery(t)) return true;
  if (t.length <= 24 && SHORT_FOLLOW_UP_RE.test(t)) return true;
  // 有历史对话时，短句含隐含指代/省略实体，需要上下文补全
  if (turns?.length && t.length <= 30 && CONTEXT_DEPENDENT_RE.test(t)) return true;
  return false;
}

/**
 * 模型降级 fallback 路径：把改写后的独立检索问题显式注入 message，
 * 让 fallback 模型即使不走 probe 首轮，也能明确知道需要联网检索什么。
 * 参考：LangChain RunnableWithFallbacks 应在 whole-runnable 级别为不同模型准备不同 prompt；
 * Hugging Face Chat UI LLM Router 在模型切换时显式保留工具/搜索上下文。
 */
export function buildFallbackSearchAwareMessage(
  baseMessage: string,
  searchQuery: string,
  latestUserText?: string
): string {
  const q = (searchQuery || '').trim();
  if (!q) return baseMessage;
  const userQ = (latestUserText || '').trim();
  const parts = [
    '【联网搜索已开启】请基于以下“独立检索问题”和完整对话上下文，先进行网络检索，再给出完整回答。',
    `需要检索的问题：${q}`,
  ];
  if (userQ && userQ !== q) {
    parts.push(`用户原始追问：${userQ}`);
  }
  parts.push('--- 以下为完整对话上下文 ---', baseMessage);
  return parts.join('\n\n');
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
  // 问候等：绝不拼历史（与 resolveWebSearchProbeQuery 双保险）
  if (isNonSearchableChatUtterance(latestUserText) || isNonSearchableChatUtterance(latest)) {
    return compactWebSearchQuery(latest || latestUserText);
  }
  if (latest && !needsContextualProbeFallback(latest, turns)) {
    return compactWebSearchQuery(latest);
  }

  const priorUser = turns
    .filter((t) => t.role === 'user')
    .map((t) => sanitizeWebSearchQueryText(t.content))
    .filter((c) => c && c !== latest);

  // 优先把上一轮用户完整问题与当前追问拼接，补全省略的主语/实体
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

/**
 * Topic-shift 后校验：如果 LLM 改写后的 query 引入了原句没有的历史实体，且原句本身不含指代词，
 * 说明 LLM 可能过度联想，应回退到原句。
 * 参考 Perplexity AST/intent-enhanced rewriting 中的 topic-shift detection。
 */
function isQueryOverInfluencedByHistory(
  rewritten: string,
  latestUserText: string,
  turns: WebSearchDialogueTurn[]
): boolean {
  const r = (rewritten || '').trim();
  const l = (latestUserText || '').trim();
  if (!r || !l) return false;

  // 原句含指代词 → 允许改写引入历史实体
  if (/[它这那此其这这些那些][个种样类些]?|上述|之前|前面|之前.*[问题话题]|刚才|之前.*提到/i.test(l)) {
    return false;
  }

  // 提取历史中的用户实体（简单关键词提取）
  const historyTexts = turns
    .filter((t) => t.role === 'user')
    .map((t) => t.content)
    .join(' ');
  const historyEntities = (historyTexts.match(/[\u4e00-\u9fa5]{3,}/g) || []).filter(
    (w) => !/怎么|什么|为什么|多少|哪里|如何|怎样|吗|呢|吧/i.test(w)
  );

  // 如果改写后的 query 含历史实体但原句不含，判定为过度联想
  for (const entity of historyEntities) {
    if (r.includes(entity) && !l.includes(entity)) {
      // 但该实体也可能是专有名词（如地名），需要出现在改写中是合理的
      // 宽松条件：如果实体长度 <= 4 且原句 <= 10 字，允许改写
      if (l.length <= 10 && entity.length <= 4) continue;
      return true;
    }
  }
  return false;
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
    `要求：\n` +
    `1. 只输出一行查询（≤80字），禁止解释、JSON、引号、英文标题。\n` +
    `2. 保留专有名词（地名、人名、产品名、机构名等）。\n` +
    `3. 如果最后一问缺少主语、宾语或包含隐含指代（如“它/这/那/未来/这种情况/上述问题”），必须从对话历史中补全主语和实体，改写成不依赖上下文也能独立理解的查询。\n` +
    `4. 如果最后一问已经独立完整、包含全新实体且没有指代词（如用户主动切换话题到深圳天气），禁止引入上一轮的北京/东北等历史实体，只基于最后一问本身改写。\n` +
    `5. 若最后一问是问候、问你是谁/哪个模型、致谢、闲聊（如「你好」「你是哪个模型」「谢谢」），与检索无关：只输出最后一问原文，禁止用历史话题改写。\n\n` +
    `示例：\n` +
    `历史：用户：介绍一下东北经济振兴的难点。助手：东北经济面临…\n` +
    `最后一问：你认为未来会成为怎样的地位？\n` +
    `查询：东北地区未来会成为怎样的经济地位？\n\n` +
    `历史：用户：广州今天天气怎么样？助手：广州今天多云…\n` +
    `最后一问：那明天呢？\n` +
    `查询：广州明天天气怎么样？\n\n` +
    `历史：用户：深中梅香和深中龙华升学率对比。助手：深中梅香…\n` +
    `最后一问：用表格再对比一下。\n` +
    `查询：深中梅香和深中龙华升学率对比表格\n\n` +
    `历史：用户：北京今天天气怎么样？助手：北京今天晴…\n` +
    `最后一问：深圳今天天气怎么样？\n` +
    `查询：深圳今天天气怎么样？\n\n` +
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

  // 问候等非检索句：禁止 LLM/历史拼接改写（防「你好你是谁」→ 上一轮 Claude Code 话题）
  if (isNonSearchableChatUtterance(params.latestUserText) || isNonSearchableChatUtterance(latest)) {
    const q = compactWebSearchQuery(sanitizeWebSearchQueryText(params.latestUserText || latest));
    console.warn('[chat] web search probe skip rewrite (non-searchable)', {
      query: q.slice(0, 120),
    });
    return q || compactWebSearchQuery(latest);
  }

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
      // Topic-shift 后校验：LLM 过度联想时回退到原句
      if (isQueryOverInfluencedByHistory(rewritten, latest, params.turns || [])) {
        console.warn('[chat] web search probe LLM rewrite over-influenced by history', {
          rewritten: rewritten.slice(0, 120),
          latest: latest.slice(0, 120),
        });
      } else {
        // 若 LLM 对上下文依赖型追问未做改写，fallback 拼接历史通常更可靠
        const rewrittenNorm = sanitizeWebSearchQueryText(rewritten);
        const latestNorm = sanitizeWebSearchQueryText(latest);
        if (
          rewrittenNorm === latestNorm &&
          params.turns?.length &&
          needsContextualProbeFallback(latest, params.turns)
        ) {
          console.warn('[chat] web search probe LLM returned unchanged for context-dependent query', {
            query: rewritten.slice(0, 120),
          });
        } else {
          console.warn('[chat] web search probe LLM rewrite', { query: rewritten.slice(0, 120) });
          return rewritten;
        }
      }
    }
    console.warn('[chat] web search probe LLM rewrite skipped, using fallback');
  }

  const fallback = buildWebSearchProbeQueryFallback(latest, params.turns);
  console.warn('[chat] web search probe fallback', { query: fallback.slice(0, 120) });
  return fallback;
}

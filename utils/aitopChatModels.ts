/** AiTop `llm/see` 聊天模型注册表（UI id ↔ API model 名） */

export type AitopTimeoutFamily = 'gemini' | 'claude';

export type AitopModelCapabilities = {
  /** 是否支持联网搜索 */
  webSearch: boolean;
  /** 是否支持思考模式（开启=深思考） */
  thinking: boolean;
  /** 是否支持视觉输入 */
  vision: boolean;
  /** 模型最大上下文长度（按 token 估算） */
  maxTokens: number;
  /** 是否可作为 fallback 目标 */
  supportsFallback: boolean;
};

export type AitopChatModelDef = {
  uiId: string;
  name: string;
  icon: string;
  apiModelName: string;
  displayLabel: string;
  logSlug: string;
  timeoutFamily: AitopTimeoutFamily;
  /** SSE 错误时附加 Gemini 不可用提示 */
  useGeminiUnavailableHint?: boolean;
  /** 模型能力矩阵，用于 UI 开关、fallback 路由、参数透传 */
  capabilities: AitopModelCapabilities;
};

export const AITOP_LLM_API = {
  BASE_URL: 'https://aitop100-api.hytch.com',
  URL: '/aitop-llm-see',
  API_KEY: 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma',
  USER_ID: '297409',
} as const;

export const QWEN_CHAT_UI_ID = 'qwen';

/** 与 AITOP 文档一致：https://docs.qingque.cn/... llm/see model 字段 */
export const AITOP_CHAT_MODELS: readonly AitopChatModelDef[] = [
  {
    uiId: 'gemini-3-pro',
    name: 'Gemini 3.1 Pro',
    icon: '💎',
    apiModelName: 'gemini-3.1-pro-preview:streamGenerateContent',
    displayLabel: 'Gemini 3.1 Pro',
    logSlug: 'gemini',
    timeoutFamily: 'gemini',
    useGeminiUnavailableHint: true,
    capabilities: { webSearch: true, thinking: true, vision: false, maxTokens: 128000, supportsFallback: true },
  },
  {
    uiId: 'claude-4.5',
    name: 'Claude 4.6',
    icon: '🎯',
    apiModelName: 'claude-sonnet-4-6',
    displayLabel: 'Claude 4.6',
    logSlug: 'claude',
    timeoutFamily: 'claude',
    // Claude 4.6: AiTop 上游对 thinking=true 支持不稳定（同日多次测试出现 10001「出了一些问题未能回复」，见 skill.md §10.65），暂禁用
    capabilities: { webSearch: true, thinking: false, vision: false, maxTokens: 200000, supportsFallback: true },
  },
  {
    uiId: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    icon: '🐋',
    apiModelName: 'deepseek-v4-pro-260425',
    displayLabel: 'DeepSeek V4 Pro',
    logSlug: 'deepseek',
    timeoutFamily: 'claude',
    capabilities: { webSearch: true, thinking: true, vision: false, maxTokens: 128000, supportsFallback: true },
  },
  {
    uiId: 'doubao-seed-2.0',
    name: 'DouBao Seed 2.0',
    icon: '🌱',
    apiModelName: 'doubao-seed-2-0-pro-260215',
    displayLabel: 'DouBao Seed 2.0',
    logSlug: 'doubao',
    timeoutFamily: 'claude',
    capabilities: { webSearch: true, thinking: true, vision: false, maxTokens: 128000, supportsFallback: true },
  },
] as const;

export const AITOP_CHAT_FALLBACK_ORDER: readonly string[] = [
  'claude-4.5',
  'gemini-3-pro',
  'deepseek-v4-pro',
  'doubao-seed-2.0',
  QWEN_CHAT_UI_ID,
];

export function getAitopChatModel(uiId: string): AitopChatModelDef | undefined {
  return AITOP_CHAT_MODELS.find((m) => m.uiId === uiId);
}

export function isAitopLlmUiModel(uiId: string): boolean {
  return AITOP_CHAT_MODELS.some((m) => m.uiId === uiId);
}

export function isQwenChatUiModel(uiId: string): boolean {
  return uiId === QWEN_CHAT_UI_ID;
}

/** 获取模型能力矩阵（Qwen 作为未在 AITOP_CHAT_MODELS 中注册的兜底模型，能力固定） */
export function getAitopModelCapabilities(uiId: string): AitopModelCapabilities {
  if (isQwenChatUiModel(uiId)) {
    return { webSearch: false, thinking: false, vision: false, maxTokens: 128000, supportsFallback: false };
  }
  return getAitopChatModel(uiId)?.capabilities || {
    webSearch: true,
    thinking: true,
    vision: false,
    maxTokens: 128000,
    supportsFallback: true,
  };
}

export function normalizeChatModelId(modelId: string): string {
  if (modelId === 'gemini3pro') return 'gemini-3-pro';
  if (modelId === 'claude45') return 'claude-4.5';
  if (modelId === QWEN_CHAT_UI_ID) return QWEN_CHAT_UI_ID;
  if (AITOP_CHAT_MODELS.some((m) => m.uiId === modelId)) return modelId;
  return 'claude-4.5';
}

export function chatModelDisplayLabel(modelId: string): string {
  const id = normalizeChatModelId(modelId);
  if (id === QWEN_CHAT_UI_ID) return 'Qwen';
  return getAitopChatModel(id)?.displayLabel || id;
}

export function chatModelFallbackChain(primaryUiId: string): string[] {
  if (primaryUiId === QWEN_CHAT_UI_ID) return [];
  return AITOP_CHAT_FALLBACK_ORDER.filter((id) => id !== primaryUiId);
}

export function buildChatAiModelsForUi(): Array<{ id: string; name: string; icon: string }> {
  return [
    ...AITOP_CHAT_MODELS.map((m) => ({ id: m.uiId, name: m.name, icon: m.icon })),
    { id: QWEN_CHAT_UI_ID, name: 'Qwen', icon: '🤖' },
  ];
}

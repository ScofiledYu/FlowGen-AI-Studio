/** AiTop `llm/see` 聊天模型注册表（UI id ↔ API model 名） */

export type AitopTimeoutFamily = 'gemini' | 'claude';

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
  },
  {
    uiId: 'claude-4.5',
    name: 'Claude 4.6',
    icon: '🎯',
    apiModelName: 'claude-sonnet-4-6',
    displayLabel: 'Claude 4.6',
    logSlug: 'claude',
    timeoutFamily: 'claude',
  },
  {
    uiId: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    icon: '🐋',
    apiModelName: 'deepseek-v4-pro-260425',
    displayLabel: 'DeepSeek V4 Pro',
    logSlug: 'deepseek',
    timeoutFamily: 'claude',
  },
  {
    uiId: 'doubao-seed-2.0',
    name: 'DouBao Seed 2.0',
    icon: '🌱',
    apiModelName: 'doubao-seed-2-0-pro-260215',
    displayLabel: 'DouBao Seed 2.0',
    logSlug: 'doubao',
    timeoutFamily: 'claude',
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

/** 从面板 numberOfImages（「1张」「2条」「3」等）解析生成数量，默认 1，上限 max。 */
export function parsePanelGenerateCount(raw: unknown, max = 4): number {
  const s = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
  const m = s.match(/(\d+)/);
  const n = m ? parseInt(m[1], 10) : 1;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.max(1, Math.min(max, n));
}

/** 读取节点顶层 numberOfImages；缺失时按模型从 modelConfigs 回退。 */
export function resolvePanelGenerateCount(data: {
  numberOfImages?: string;
  selectedModel?: string;
  modelConfigs?: Record<string, unknown>;
}, max = 4): number {
  if (data.numberOfImages) {
    return parsePanelGenerateCount(data.numberOfImages, max);
  }
  const model = String(data.selectedModel || '').trim();
  const configs = data.modelConfigs || {};
  const cfg =
    (configs[model] as { numberOfImages?: string } | undefined) ||
    (configs.image2 as { numberOfImages?: string } | undefined);
  return parsePanelGenerateCount(cfg?.numberOfImages, max);
}

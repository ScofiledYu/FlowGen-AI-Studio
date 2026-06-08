import type { SeedanceAspectRatioSetting, SeedanceTextRefAspectRatio } from '../types';

/** Seedance 2.0 文生 / 参考生视频：面板可选顺序（16:9 默认，排第一） */
export const SEEDANCE_TEXT_REF_ASPECT_RATIOS: readonly SeedanceTextRefAspectRatio[] = [
  '16:9',
  '1:1',
  '4:3',
  '21:9',
  '9:16',
  '3:4',
];

const RATIO_SET = new Set<string>(SEEDANCE_TEXT_REF_ASPECT_RATIOS);

/** Seedance 2.0 面板默认分辨率 */
export function getSeedanceDefaultResolution(
  model: string | undefined
): '480p' | '720p' | '1080p' {
  if (model === 'seedance2.0 (高质量版)') return '1080p';
  if (model === 'seedance2.0 (急速版)') return '720p';
  return '480p';
}

/** Seedance 面板默认视频比例 */
export function getSeedanceDefaultAspectRatio(
  model: string | undefined
): SeedanceAspectRatioSetting {
  if (model === 'seedance1.5-pro') return '自动匹配';
  if (model === 'seedance2.0 (高质量版)' || model === 'seedance2.0 (急速版)') return '16:9';
  return '1:1';
}

/** 文生/参考 tab：非法或旧「自动匹配」回落为 16:9 */
export function normalizeSeedanceAspectForTextRef(
  raw: string | undefined
): SeedanceTextRefAspectRatio {
  if (raw && RATIO_SET.has(raw)) return raw as SeedanceTextRefAspectRatio;
  return '16:9';
}

const SEEDANCE20_MODELS = new Set([
  'seedance2.0 (高质量版)',
  'seedance2.0 (急速版)',
]);

export function isSeedance20Model(model: string | undefined): boolean {
  return SEEDANCE20_MODELS.has(model || '');
}

/** 仅「未设置 / 自动匹配 / 非法」时写入默认 16:9；用户选的 1:1 等有效比例不覆盖 */
export function shouldMigrateSeedance20AspectToDefault(raw: string | undefined): boolean {
  const s = raw?.trim();
  if (!s || s === '自动匹配') return true;
  return !RATIO_SET.has(s);
}

/**
 * 仅在字段未设置时补 2.0 面板默认（选中节点时跑一次，不抢用户已点的 480p / 1:1）。
 */
export function getSeedance20PanelDefaultsPatch(data: {
  selectedModel?: string;
  seedanceResolution?: string;
  seedanceAspectRatio?: string;
}): Partial<{
  seedanceResolution: '480p' | '720p' | '1080p';
  seedanceAspectRatio: SeedanceAspectRatioSetting;
}> | null {
  const model = data.selectedModel;
  if (!isSeedance20Model(model)) return null;

  const patch: Partial<{
    seedanceResolution: '480p' | '720p' | '1080p';
    seedanceAspectRatio: SeedanceAspectRatioSetting;
  }> = {};
  const curRes = data.seedanceResolution?.trim() as '480p' | '720p' | '1080p' | undefined;

  if (!curRes) {
    patch.seedanceResolution = getSeedanceDefaultResolution(model);
  }

  if (shouldMigrateSeedance20AspectToDefault(data.seedanceAspectRatio)) {
    patch.seedanceAspectRatio = getSeedanceDefaultAspectRatio(model);
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

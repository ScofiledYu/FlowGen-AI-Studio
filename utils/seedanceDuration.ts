import type { SeedanceDurationLabel } from '../types';

export const SEEDANCE_DURATION_MIN = 4;
/** Seedance 1.5 Pro / 2.0 共用滑杆与解析上限（秒） */
export const SEEDANCE_DURATION_MAX = 15;
/** 未设置或无法解析时的默认秒数（滑杆默认停在 5s） */
export const SEEDANCE_DURATION_DEFAULT_SECONDS = 5;
export const SEEDANCE_DURATION_DEFAULT_LABEL = '5s' as SeedanceDurationLabel;

/** 从节点存储的字符串（如 5s）解析为整数秒，并按 maxSec 钳位；空/无效为默认 5s */
export function parseSeedanceDurationSeconds(raw: string | undefined, maxSec: number = SEEDANCE_DURATION_MAX): number {
  const s = String(raw ?? '').trim();
  if (!s) return SEEDANCE_DURATION_DEFAULT_SECONDS;
  const m = s.match(/(\d+)/);
  const n = m ? parseInt(m[1], 10) : NaN;
  if (!Number.isFinite(n)) return SEEDANCE_DURATION_DEFAULT_SECONDS;
  return Math.min(maxSec, Math.max(SEEDANCE_DURATION_MIN, n));
}

export function formatSeedanceDurationLabel(sec: number, maxSec: number = SEEDANCE_DURATION_MAX): SeedanceDurationLabel {
  const s = Math.min(maxSec, Math.max(SEEDANCE_DURATION_MIN, Math.round(sec)));
  return `${s}s` as SeedanceDurationLabel;
}

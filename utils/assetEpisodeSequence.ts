/** 资产库集数 ep001–ep100、场次 seq001–seq100 */
export const ASSET_EPISODE_OPTIONS = Array.from({ length: 100 }, (_, i) =>
  `ep${String(i + 1).padStart(3, '0')}`
);

export const ASSET_SEQUENCE_OPTIONS = Array.from({ length: 100 }, (_, i) =>
  `seq${String(i + 1).padStart(3, '0')}`
);

export function normalizeAssetEpisode(raw?: string): string {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return '';
  const m = s.match(/^ep(\d{1,3})$/i);
  if (!m) return '';
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > 100) return '';
  return `ep${String(n).padStart(3, '0')}`;
}

export function normalizeAssetSequence(raw?: string): string {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return '';
  const m = s.match(/^seq(\d{1,3})$/i);
  if (!m) return '';
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > 100) return '';
  return `seq${String(n).padStart(3, '0')}`;
}

/** 支持 ep005 / 5 / 005 等模糊匹配 */
export function filterEpisodeSequenceOptions(options: string[], query: string): string[] {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return options;
  const digits = q.replace(/\D/g, '');
  return options.filter((opt) => {
    if (opt.toLowerCase().includes(q)) return true;
    if (!digits) return false;
    const optDigits = opt.replace(/\D/g, '');
    return optDigits.includes(digits) || optDigits === digits.padStart(3, '0');
  });
}

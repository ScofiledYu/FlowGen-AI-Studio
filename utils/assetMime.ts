/** 与 server/flowgen/assetMime.mjs 扩展名表一致（前端展示用） */
const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

export function normalizeAssetMime(mime: string | undefined, hint?: string): string {
  const raw = (mime || '').trim().toLowerCase();
  if (raw.startsWith('image/') || raw.startsWith('video/')) return raw;
  const name = (hint || '').trim();
  const extMatch = name.match(/(\.[a-z0-9]+)(?:\?|$)/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';
  if (ext && EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
  return raw || 'application/octet-stream';
}

export function isImageAssetMime(mime: string | undefined, hint?: string): boolean {
  return normalizeAssetMime(mime, hint).startsWith('image/');
}

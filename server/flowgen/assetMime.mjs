import path from 'path';

const EXT_TO_MIME = {
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
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
};

/**
 * 浏览器/代理上传时 mimetype 常为 application/octet-stream，需按扩展名纠正。
 * @param {string | undefined} mime
 * @param {string | undefined} fileName
 */
export function normalizeAssetMime(mime, fileName) {
  const raw = String(mime || '').trim().toLowerCase();
  if (raw.startsWith('image/') || raw.startsWith('video/')) return raw;
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (ext && EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
  return raw || 'application/octet-stream';
}

export function isImageAssetMime(mime, fileName) {
  return normalizeAssetMime(mime, fileName).startsWith('image/');
}

export function isVideoAssetMime(mime, fileName) {
  return normalizeAssetMime(mime, fileName).startsWith('video/');
}

/**
 * 画布节点预览图：仅存磁盘，不写入 MySQL 大字段；workspace JSON 里只保留短 URL。
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { uploadsDir, ensureDataDirs } from './store.mjs';

export function nodeMediaDir(projectId) {
  return path.join(uploadsDir(projectId), 'node-media');
}

/**
 * @param {string} projectId
 * @param {Buffer} buffer
 * @param {string} [originalName]
 * @param {string} [mime]
 */
export function saveNodeMediaFile(projectId, buffer, originalName = 'image.png', mime = 'application/octet-stream') {
  ensureDataDirs();
  const ext = path.extname(originalName || '') || guessExtFromMime(mime);
  const mediaId = `${randomUUID()}${ext}`;
  const dir = nodeMediaDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, mediaId);
  fs.writeFileSync(fp, buffer);
  const url = `/flowgen-api/projects/${projectId}/node-media/${encodeURIComponent(mediaId)}/file`;
  return { mediaId, fileName: mediaId, url, localPath: path.relative(uploadsDir(projectId), fp).replace(/\\/g, '/') };
}

/**
 * @param {string} projectId
 * @param {string} mediaId
 */
export function resolveNodeMediaFilePath(projectId, mediaId) {
  const safe = path.basename(decodeURIComponent(mediaId));
  if (!safe || safe !== decodeURIComponent(mediaId)) return null;
  if (!/^[0-9a-f-]{36}\.[a-z0-9]+$/i.test(safe)) return null;
  const fp = path.join(nodeMediaDir(projectId), safe);
  if (!fp.startsWith(nodeMediaDir(projectId))) return null;
  return fp;
}

function guessExtFromMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return '.png';
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
  if (m.includes('webp')) return '.webp';
  if (m.includes('gif')) return '.gif';
  if (m.includes('mp4')) return '.mp4';
  if (m.includes('webm')) return '.webm';
  return '.bin';
}

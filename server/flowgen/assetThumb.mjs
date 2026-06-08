import fs from 'fs';
import path from 'path';
import { isImageAssetMime } from './assetMime.mjs';

export const ASSET_THUMB_SUFFIX = '-flowgen-thumb.jpg';
export const ASSET_THUMB_WIDTH = 384;

export function assetThumbFileName(assetFileName) {
  const base = path.basename(assetFileName, path.extname(assetFileName));
  return `${base}${ASSET_THUMB_SUFFIX}`;
}

export function assetThumbPath(uploadDir, assetFileName) {
  return path.join(uploadDir, assetThumbFileName(assetFileName));
}

export function deleteAssetThumbIfExists(uploadDir, assetFileName) {
  if (!assetFileName) return;
  const tp = assetThumbPath(uploadDir, assetFileName);
  try {
    if (fs.existsSync(tp)) fs.unlinkSync(tp);
  } catch {
    /* ignore */
  }
}

/**
 * 生成网格用 JPEG 缩略图（需 optional dependency sharp）。
 * @returns {Promise<boolean>}
 */
export async function ensureAssetThumbFile(sourcePath, thumbPath, mime, fileName) {
  if (!isImageAssetMime(mime, fileName || sourcePath)) return false;
  if (!sourcePath || !fs.existsSync(sourcePath)) return false;
  if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0) return true;
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    return false;
  }
  try {
    await sharp(sourcePath)
      .rotate()
      .resize(ASSET_THUMB_WIDTH, ASSET_THUMB_WIDTH, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82, progressive: true })
      .toFile(thumbPath);
    return fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0;
  } catch (e) {
    console.warn('[flowgen] asset thumb failed:', e?.message || e);
    try {
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    } catch {
      /* ignore */
    }
    return false;
  }
}

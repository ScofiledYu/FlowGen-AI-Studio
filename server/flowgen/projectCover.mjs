/**
 * 项目列表封面：存磁盘 uploads/{projectId}/project-cover.*，库内只存短 URL。
 */
import fs from 'fs';
import path from 'path';
import { uploadsDir, ensureDataDirs } from './store.mjs';

const COVER_BASENAME = 'project-cover';

export function resolveProjectCoverFile(projectId) {
  const dir = path.join(uploadsDir(projectId));
  if (!fs.existsSync(dir)) return null;
  const names = fs.readdirSync(dir).filter((n) => n.startsWith(`${COVER_BASENAME}.`));
  if (!names.length) return null;
  return path.join(dir, names[0]);
}

/**
 * @param {string} projectId
 * @param {Buffer} buffer
 * @param {string} [mime]
 * @param {string} [originalName]
 */
export function saveProjectCoverFile(projectId, buffer, mime = 'image/jpeg', originalName = 'cover.jpg') {
  ensureDataDirs();
  const dir = uploadsDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(originalName || '') || guessExtFromMime(mime);
  const fileName = `${COVER_BASENAME}${ext}`;
  const fp = path.join(dir, fileName);
  for (const old of fs.readdirSync(dir).filter((n) => n.startsWith(`${COVER_BASENAME}.`))) {
    if (old !== fileName) {
      try {
        fs.unlinkSync(path.join(dir, old));
      } catch {
        /* ignore */
      }
    }
  }
  fs.writeFileSync(fp, buffer);
  return `/flowgen-api/projects/${projectId}/cover/file`;
}

/** API 列表用：库内若为 data:/blob: 等临时地址，磁盘有 project-cover 时改回短链 */
export function normalizeProjectCoverImageForApi(projectId, coverImage) {
  const raw = typeof coverImage === 'string' ? coverImage.trim() : '';
  if (!raw) return null;
  const ephemeral =
    raw.startsWith('data:') || raw.startsWith('blob:') || raw.startsWith('flowgen-local:');
  const fileUrl = `/flowgen-api/projects/${projectId}/cover/file`;
  if (ephemeral) {
    const fp = resolveProjectCoverFile(projectId);
    return fp && fs.existsSync(fp) ? fileUrl : null;
  }
  if (raw.includes('/cover/file')) return fileUrl;
  return raw;
}

export function deleteProjectCoverFile(projectId) {
  const fp = resolveProjectCoverFile(projectId);
  if (fp) {
    try {
      fs.unlinkSync(fp);
    } catch {
      /* ignore */
    }
  }
}

function guessExtFromMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return '.png';
  if (m.includes('webp')) return '.webp';
  if (m.includes('gif')) return '.gif';
  return '.jpg';
}

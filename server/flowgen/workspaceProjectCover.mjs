/**
 * 从 workspace 画布节点挑选可展示的图片，写入项目列表封面 project-cover.*。
 */
import fs from 'fs';
import { saveProjectCoverFile } from './projectCover.mjs';
import { isManualProjectCover, markProjectCoverSource } from './projectCoverMeta.mjs';
import { resolveNodeMediaFilePath } from './nodeMedia.mjs';
import { getStorageMode, loadStore, saveStore } from './store.mjs';
import { updateProjectCoverImage } from './repos/projectsRepo.mjs';

function isVideoLikeUrl(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  return (
    /\.(mov|mp4|webm|avi|mkv|m4v)(\?|$)/i.test(u) ||
    /videosgenerations|\/video\//i.test(u)
  );
}

/**
 * @param {unknown[]} nodes
 * @returns {string | null}
 */
export function pickWorkspaceCoverCandidateUrl(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return null;
  /** @type {{ url: string; score: number }[]} */
  const ranked = [];
  const push = (url, score) => {
    if (typeof url !== 'string') return;
    const s = url.trim();
    if (!s || s.startsWith('data:') || s.startsWith('blob:')) return;
    if (!s.startsWith('http') && !s.startsWith('/flowgen-api/')) return;
    ranked.push({ url: s, score });
  };

  for (const n of nodes) {
    const d = n?.data && typeof n.data === 'object' ? n.data : {};
    if (typeof d.videoPosterDataUrl === 'string') push(d.videoPosterDataUrl, 5);
    if (Array.isArray(d.referenceImages)) {
      for (const u of d.referenceImages) push(u, 8);
    }
    if (Array.isArray(d.jimengImages)) {
      for (const u of d.jimengImages) push(u, 9);
    }
    if (typeof d.imagePreview === 'string') {
      push(d.imagePreview, isVideoLikeUrl(d.imagePreview) ? 40 : 10);
    }
    const thumbs = d.generatedThumbnails;
    if (Array.isArray(thumbs)) {
      for (let i = thumbs.length - 1; i >= 0; i--) {
        const t = thumbs[i];
        if (!t || typeof t !== 'object') continue;
        if (t.type === 'video') push(t.posterDataUrl, 12);
        else push(t.url, 11);
      }
    }
  }

  ranked.sort((a, b) => a.score - b.score);
  const best = ranked.find((r) => !isVideoLikeUrl(r.url)) || ranked[0];
  return best?.url || null;
}

/**
 * @param {string} projectId
 * @param {string} src
 * @returns {Promise<Buffer | null>}
 */
async function readCoverSourceBuffer(projectId, src) {
  const s = src.trim();
  const nodeMediaRe = /\/flowgen-api\/projects\/[^/]+\/node-media\/([^/]+)\/file/i;
  const m = s.match(nodeMediaRe);
  if (m) {
    const fp = resolveNodeMediaFilePath(projectId, decodeURIComponent(m[1]));
    if (fp && fs.existsSync(fp)) return fs.readFileSync(fp);
    return null;
  }
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const res = await fetch(s, { signal: AbortSignal.timeout(25000) });
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.startsWith('video/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} projectId
 * @param {unknown[] | undefined} nodes
 */
export async function syncProjectCoverFromWorkspaceGraph(projectId, nodes) {
  const store = loadStore();
  const p = store.projects.find((x) => x.id === projectId);
  if (!p) return;
  if (isManualProjectCover(p.extendedJson)) return;

  const list = Array.isArray(nodes) ? nodes : [];
  // 空画布保存时不要清空已有封面（运行中/清洗后短暂 0 节点曾误删封面）
  if (list.length === 0) return;

  const src = pickWorkspaceCoverCandidateUrl(list);
  if (!src) return;

  const buffer = await readCoverSourceBuffer(projectId, src);
  if (!buffer || buffer.length === 0) return;

  const url = saveProjectCoverFile(projectId, buffer, 'image/jpeg', 'workspace-cover.jpg');
  p.coverImage = url;
  p.extendedJson = markProjectCoverSource(p.extendedJson || {}, 'auto');
  p.updatedAt = new Date().toISOString();
  if (getStorageMode() === 'relational') {
    await updateProjectCoverImage(projectId, url);
  } else {
    saveStore(store);
  }
}

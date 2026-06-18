/**
 * 历史工具：曾从画布节点挑选封面候选 URL。
 * 项目封面现仅允许管理员/项目管理员通过 POST /projects/:id/cover 上传，保存 workspace 不再自动改封面。
 */

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

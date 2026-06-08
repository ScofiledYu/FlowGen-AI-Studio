/**
 * 分析旧工程 JSON：模拟 sanitize + hydrate 后还有多少节点主预览为空。
 * 用法: node scripts/analyze-project-hydrate.mjs <path-to-json>
 */
import { readFileSync } from 'fs';
import { sanitizePersistValueDeep } from '../utils/persistSanitize.mjs';

const MOV = 'movNode';
const INPUT = 'inputNode';

function isEphemeral(val, keyHint = '') {
  if (typeof val !== 'string') return false;
  if (val.startsWith('blob:')) return true;
  if (/^data:video\//i.test(val)) return true;
  if (/^data:audio\//i.test(val)) return true;
  if (!val.startsWith('data:')) return false;
  const stripKeys = new Set([
    'imagePreview',
    'firstFrameImage',
    'lastFrameImage',
    'firstFrameImageUrl',
    'lastFrameImageUrl',
    'klingOmniVideoPreviewUrl',
    'klingOmniVideoUrl',
    'url',
    'src',
    'imageUrl',
  ]);
  if (stripKeys.has(keyHint)) return true;
  return val.length > 8192;
}

function isPersistable(val) {
  if (typeof val !== 'string' || !val.trim()) return false;
  if (isEphemeral(val)) return false;
  return val.startsWith('/flowgen-api/') || /^https?:\/\//i.test(val);
}

function isVideoUrl(url) {
  return (
    /\.(mov|mp4|webm|avi|mkv|flv|wmv|m4v)(\?|$)/i.test(url) ||
    /^https?:\/\/.+\/video/i.test(url) ||
    /\/video\//i.test(url)
  );
}

function pickPersistableMainPreviewUrl(data, nodeType) {
  const preferVideo = nodeType === MOV;
  const candidates = [];
  const push = (val, keyHint) => {
    if (typeof val !== 'string') return;
    const s = val.trim();
    if (!isPersistable(s)) return;
    if (!candidates.includes(s)) candidates.push(s);
  };
  const frameKeys = [
    'firstFrameImageUrl',
    'lastFrameImageUrl',
    'klingOmniVideoUrl',
    'klingOmniVideoPreviewUrl',
    'klingOmniInstructionVideoUrl',
    'klingOmniInstructionVideoPreviewUrl',
  ];
  for (const k of frameKeys) push(data[k], k);
  for (const u of data.referenceImages || []) push(u, 'url');
  for (const u of data.jimengImages || []) push(u, 'url');
  const gp = data.generationParams;
  if (gp && typeof gp === 'object') {
    for (const k of frameKeys) push(gp[k], k);
    for (const u of gp.referenceImages || []) push(u, 'url');
    for (const u of gp.jimengImages || []) push(u, 'url');
    for (const k of ['resourceUrl', 'outputUrl', 'videoUrl', 'imageUrl']) push(gp[k], k);
  }
  const thumbs = data.generatedThumbnails;
  if (Array.isArray(thumbs)) {
    for (let i = thumbs.length - 1; i >= 0; i--) {
      const row = thumbs[i];
      if (!row || typeof row !== 'object') continue;
      const url = row.url;
      const kind = row.type;
      if (typeof url !== 'string') continue;
      const s = url.trim();
      if (!isPersistable(s)) continue;
      if (preferVideo && kind === 'video') candidates.unshift(s);
      else if (!preferVideo && kind !== 'video') candidates.unshift(s);
      else candidates.push(s);
    }
  }
  if (preferVideo) return candidates.find(isVideoUrl) ?? candidates[0];
  return candidates.filter((u) => !isVideoUrl(u))[0];
}

function hydrateNode(node) {
  if (!node?.data) return node;
  const preview = node.data.imagePreview;
  if (typeof preview === 'string' && preview.trim() && !isEphemeral(preview, 'imagePreview')) {
    return node;
  }
  const picked = pickPersistableMainPreviewUrl(node.data, node.type);
  if (!picked) return node;
  return { ...node, data: { ...node.data, imagePreview: picked } };
}

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/analyze-project-hydrate.mjs <project.json>');
  process.exit(1);
}

const parsed = JSON.parse(readFileSync(path, 'utf8'));
const nodes = parsed.nodes || [];
const stats = {
  file: path,
  total: nodes.length,
  previewData: 0,
  previewBlob: 0,
  previewHttps: 0,
  previewEmpty: 0,
  hasThumbsHttps: 0,
  hasFrameUrlHttps: 0,
  emptyAfterSanitize: 0,
  fixedByHydrate: 0,
  stillEmptyAfterHydrate: 0,
  stillEmptyInputOnly: 0,
  sampleStillEmpty: [],
};

for (const n of nodes) {
  const p = n?.data?.imagePreview;
  if (typeof p === 'string' && p.startsWith('data:')) stats.previewData++;
  else if (typeof p === 'string' && p.startsWith('blob:')) stats.previewBlob++;
  else if (typeof p === 'string' && /^https?:/i.test(p)) stats.previewHttps++;
  else stats.previewEmpty++;

  const thumbs = n?.data?.generatedThumbnails;
  if (Array.isArray(thumbs) && thumbs.some((t) => typeof t?.url === 'string' && /^https?:/i.test(t.url))) {
    stats.hasThumbsHttps++;
  }
  if (n?.data?.firstFrameImageUrl && /^https?:/i.test(String(n.data.firstFrameImageUrl))) {
    stats.hasFrameUrlHttps++;
  }

  const sanitized = sanitizePersistValueDeep(n);
  const sp = sanitized?.data?.imagePreview;
  const emptyAfterSanitize = !sp || isEphemeral(sp, 'imagePreview');
  if (emptyAfterSanitize) stats.emptyAfterSanitize++;

  const hydrated = hydrateNode(sanitized);
  const hp = hydrated?.data?.imagePreview;
  const fixed = emptyAfterSanitize && hp && !isEphemeral(hp, 'imagePreview');
  if (fixed) stats.fixedByHydrate++;
  if (emptyAfterSanitize && !fixed) {
    stats.stillEmptyAfterHydrate++;
    if (n.type === INPUT) stats.stillEmptyInputOnly++;
    if (stats.sampleStillEmpty.length < 8) {
      stats.sampleStillEmpty.push({
        id: n.id,
        type: n.type,
        label: n.data?.label,
        imageName: n.data?.imageName,
        thumbCount: Array.isArray(n.data?.generatedThumbnails) ? n.data.generatedThumbnails.length : 0,
        pickedWouldBe: pickPersistableMainPreviewUrl(sanitized?.data || {}, n.type) || null,
      });
    }
  }
}

console.log(JSON.stringify(stats, null, 2));

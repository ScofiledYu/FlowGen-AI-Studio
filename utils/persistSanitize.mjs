/**
 * Strip ephemeral / oversized media from workspace & localStorage snapshots.
 * Keeps http(s), /flowgen-api/... (服务器磁盘 node-media / 素材库), 外链；去掉 blob: 与超大 data:。
 * 本机预览用 imageLocalRef + IndexedDB；临时 blob/data 的 imagePreview 不入库。
 */

/** data: URLs longer than this are never persisted (tiny SVG icons may remain) */
export const FLOW_MAX_PERSIST_DATA_URL_CHARS = 8192;
export const FLOW_MAX_PERSIST_STORYBOARD_IMAGES = 120;
export const FLOW_MAX_PERSIST_CHAT_MESSAGES = 80;
export const FLOW_MAX_PERSIST_CHAT_MESSAGE_CHARS = 12000;

const STRIP_DATA_URL_KEYS = new Set([
  'posterDataUrl',
  'videoPosterDataUrl',
  'imagePreview',
  'firstFrameImage',
  'lastFrameImage',
  'firstFrameImageUrl',
  'lastFrameImageUrl',
  'klingOmniVideoPreviewUrl',
  'klingOmniVideoUrl',
  'klingOmniInstructionVideoPreviewUrl',
  'klingOmniInstructionVideoUrl',
]);

/**
 * @param {string} val
 * @param {string} [keyHint]
 */
/** 视频截帧封面：允许更大 data:image 入库，避免旧节点播放后封面被清理导致缩略图消失 */
export const FLOW_MAX_PERSIST_POSTER_DATA_URL_CHARS = 2 * 1024 * 1024;

export function shouldStripPersistString(val, keyHint = '') {
  if (typeof val !== 'string') return false;
  if (val.startsWith('blob:')) return true;
  if (/^data:video\//i.test(val)) return true;
  if (/^data:audio\//i.test(val)) return true;
  if (!val.startsWith('data:')) return false;
  if (keyHint === 'videoPosterDataUrl' || keyHint === 'posterDataUrl') {
    if (/^data:image\/(jpeg|jpg|png|webp)/i.test(val) && val.length <= FLOW_MAX_PERSIST_POSTER_DATA_URL_CHARS) {
      return false;
    }
    return true;
  }
  if (STRIP_DATA_URL_KEYS.has(keyHint)) return true;
  if (keyHint === 'url' || keyHint === 'src' || keyHint === 'imageUrl') return true;
  return val.length > FLOW_MAX_PERSIST_DATA_URL_CHARS;
}

/**
 * @param {unknown} val
 * @param {string} [keyHint]
 */
/**
 * @param {string} val
 */
function stripEphemeralQueryFromPersistUrl(val) {
  if (typeof val !== 'string' || !/[?&](access_token|token)=/i.test(val)) return val;
  try {
    const u = new URL(val, 'http://localhost');
    u.searchParams.delete('access_token');
    u.searchParams.delete('token');
    const qs = u.searchParams.toString();
    if (val.startsWith('/') && !/^https?:\/\//i.test(val)) {
      return u.pathname + (qs ? `?${qs}` : '');
    }
    return `${u.origin}${u.pathname}${qs ? `?${qs}` : ''}`;
  } catch {
    return val
      .replace(/([?&])(?:access_token|token)=[^&]*/gi, '$1')
      .replace(/\?&/g, '?')
      .replace(/[?&]$/g, '');
  }
}

export function sanitizePersistValueDeep(val, keyHint = '') {
  if (typeof val === 'string') {
    if (shouldStripPersistString(val, keyHint)) return undefined;
    return stripEphemeralQueryFromPersistUrl(val);
  }
  if (Array.isArray(val)) {
    return val
      .map((v) => sanitizePersistValueDeep(v, keyHint))
      .filter((v) => v !== undefined);
  }
  if (val && typeof val === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      const sv = sanitizePersistValueDeep(v, k);
      if (sv === undefined) continue;
      out[k] = sv;
    }
    return out;
  }
  return val;
}

/**
 * @param {unknown} images
 */
export function sanitizeStoryboardImagesForPersist(images) {
  if (!Array.isArray(images)) return [];
  return images
    .filter((img) => typeof img === 'string' && !shouldStripPersistString(img, 'url'))
    .slice(-FLOW_MAX_PERSIST_STORYBOARD_IMAGES);
}

/**
 * @param {unknown} chat
 */
export function sanitizeChatForPersist(chat) {
  if (!chat || typeof chat !== 'object') return chat;
  const c = /** @type {Record<string, unknown>} */ (chat);
  const messages = Array.isArray(c.messages) ? c.messages : [];
  const trimmed = messages.slice(-FLOW_MAX_PERSIST_CHAT_MESSAGES).map((m) => {
    if (!m || typeof m !== 'object') return m;
    const msg = /** @type {Record<string, unknown>} */ ({ ...m });
    if (typeof msg.content === 'string' && msg.content.length > FLOW_MAX_PERSIST_CHAT_MESSAGE_CHARS) {
      msg.content = msg.content.slice(0, FLOW_MAX_PERSIST_CHAT_MESSAGE_CHARS);
    }
    if (typeof msg.imageUrl === 'string' && shouldStripPersistString(msg.imageUrl, 'imageUrl')) {
      delete msg.imageUrl;
    }
    if (Array.isArray(msg.imageUrls)) {
      msg.imageUrls = msg.imageUrls.filter(
        (u) => typeof u === 'string' && !shouldStripPersistString(u, 'imageUrl')
      );
      if (msg.imageUrls.length === 0) delete msg.imageUrls;
    }
    return msg;
  });
  return { ...c, messages: trimmed };
}

/**
 * @param {unknown} payload workspace PUT body payload
 */
export function sanitizeWorkspacePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const p = /** @type {Record<string, unknown>} */ ({ ...payload });
  if (p.graph && typeof p.graph === 'object') {
    const g = /** @type {Record<string, unknown>} */ ({ ...p.graph });
    if (Array.isArray(g.nodes)) {
      g.nodes = g.nodes.map((n) => sanitizePersistValueDeep(n)).filter(Boolean);
    }
    g.storyboardImages = sanitizeStoryboardImagesForPersist(g.storyboardImages);
    p.graph = g;
  }
  if (p.chat && typeof p.chat === 'object') {
    p.chat = sanitizeChatForPersist(p.chat);
  }
  if (p.chatByUser && typeof p.chatByUser === 'object') {
    /** @type {Record<string, unknown>} */
    const next = {};
    for (const [uid, slice] of Object.entries(p.chatByUser)) {
      next[uid] = sanitizeChatForPersist(slice);
    }
    p.chatByUser = next;
  }
  return p;
}

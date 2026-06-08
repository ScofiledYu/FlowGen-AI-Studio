import { shouldStripPersistString } from './persistSanitize';
import { uploadNodeMedia } from '../services/flowgenApi';

/** 浏览器临时预览 → 需落盘为服务器本地文件后再写入 workspace */
export function isEphemeralMediaUrl(val: unknown, keyHint = ''): boolean {
  if (typeof val !== 'string' || !val.trim()) return false;
  return shouldStripPersistString(val, keyHint);
}

/** 已是可长期引用的地址（服务器 node-media、素材库、外链） */
export function isPersistableMediaUrl(val: unknown): boolean {
  if (typeof val !== 'string' || !val.trim()) return false;
  const s = val.trim();
  if (isEphemeralMediaUrl(s)) return false;
  if (s.startsWith('/flowgen-api/')) return true;
  if (/^https?:\/\//i.test(s)) return true;
  return false;
}

const MEDIA_FIELD_KEYS = new Set([
  'imagePreview',
  'firstFrameImage',
  'lastFrameImage',
  'firstFrameImageUrl',
  'lastFrameImageUrl',
  'klingOmniVideoPreviewUrl',
  'klingOmniVideoUrl',
  'klingOmniInstructionVideoPreviewUrl',
  'klingOmniInstructionVideoUrl',
  'videoPosterDataUrl',
  'posterDataUrl',
  'url',
  'src',
  'imageUrl',
]);

type UploadFn = (blob: Blob, filename: string) => Promise<string | null>;

async function blobFromEphemeralUri(uri: string): Promise<Blob | null> {
  try {
    const res = await fetch(uri);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

function guessFilename(uri: string, keyHint: string): string {
  if (keyHint.includes('video') || /^data:video\//i.test(uri)) return 'clip.mp4';
  if (/^data:audio\//i.test(uri)) return 'audio.mp3';
  const m = uri.match(/\.(png|jpe?g|webp|gif|mp4|webm)(\?|$)/i);
  if (m) return `media.${m[1].toLowerCase()}`;
  return 'image.png';
}

async function materializeString(
  val: string,
  keyHint: string,
  upload: UploadFn,
  cache: Map<string, string>
): Promise<string> {
  if (!isEphemeralMediaUrl(val, keyHint)) return val;
  const cached = cache.get(val);
  if (cached) return cached;
  const blob = await blobFromEphemeralUri(val);
  if (!blob || blob.size === 0) return val;
  const url = await upload(blob, guessFilename(val, keyHint));
  if (!url) return val;
  cache.set(val, url);
  return url;
}

async function materializeValue(val: unknown, keyHint: string, upload: UploadFn, cache: Map<string, string>): Promise<unknown> {
  if (typeof val === 'string') {
    return materializeString(val, keyHint, upload, cache);
  }
  if (Array.isArray(val)) {
    const next = await Promise.all(val.map((v) => materializeValue(v, keyHint, upload, cache)));
    return next.filter((v) => v !== undefined);
  }
  if (val && typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      const hint = MEDIA_FIELD_KEYS.has(k) ? k : keyHint;
      const sv = await materializeValue(v, hint, upload, cache);
      if (sv === undefined) continue;
      out[k] = sv;
    }
    return out;
  }
  return val;
}

/** 将节点 data 中的 blob/data 预览替换为 /flowgen-api/.../node-media/... 短链接 */
export async function materializeNodeDataEphemeralMedia<T extends Record<string, unknown>>(
  data: T,
  upload: UploadFn
): Promise<T> {
  const cache = new Map<string, string>();
  const next = (await materializeValue(data, '', upload, cache)) as T;
  return next;
}

/** 将截帧得到的 data:image 封面上传为 node-media 短链，避免刷新后 sanitize 丢失 */
export async function materializePosterDataUrl(
  poster: string | null | undefined,
  projectId: string | undefined | null
): Promise<string | undefined> {
  const s = (poster || '').trim();
  if (!s) return undefined;
  if (!/^data:image\//i.test(s)) return s;
  const pid = (projectId || '').trim();
  if (!pid) return s;
  try {
    const blob = await blobFromEphemeralUri(s);
    if (!blob || blob.size === 0) return s;
    const { url } = await uploadNodeMedia(pid, blob, 'video-poster.jpg');
    return url || s;
  } catch {
    return s;
  }
}

export function nodeDataHasEphemeralMedia(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const walk = (val: unknown, keyHint: string): boolean => {
    if (typeof val === 'string') return isEphemeralMediaUrl(val, keyHint);
    if (Array.isArray(val)) return val.some((v) => walk(v, keyHint));
    if (val && typeof val === 'object') {
      return Object.entries(val).some(([k, v]) => walk(v, MEDIA_FIELD_KEYS.has(k) ? k : keyHint));
    }
    return false;
  };
  return walk(data, '');
}
